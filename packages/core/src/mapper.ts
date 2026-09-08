import { AdapterRegistry } from './descriptor/registry.js';
import type { ClassLike, FieldSelection, SchemaAdapter } from './descriptor/types.js';
import { AutomapperError, fail } from './diagnose/automapper-error.js';
import { isWriteDto } from './dto/pick.js';
import {
  compile,
  newOpState,
  type ChildLookup,
  type CompiledPlan,
  type TypeConverters,
} from './emit/codegen.js';
import { isNodeAsync } from './plan/node.js';
import { buildPlan, type MappingPlan } from './plan/planner.js';
import { writeDropReason } from './policy.js';
import { projectionFor, type ProjectOptions } from './project/projector.js';
import { schemaOf, type OpenApiSchema, type SchemaOptions } from './schema/openapi.js';

export interface PlanReport {
  readonly ok: boolean;
  readonly pairs: readonly string[];
  readonly diagnostics: readonly AutomapperError[];
}

export interface MapOptions<Ctx> {
  readonly ctx?: Ctx;
}

export interface MapperOptions {
  /**
   * Applied to every field of a declared type — `{ date: v => v.toISOString() }`
   * converts all dates at once. Possible only because each node carries its
   * type, so it needs no per-field repetition.
   */
  readonly convert?: TypeConverters;
}

/**
 * Declare → seal → serve (AD-16).
 *
 * `seal()` is the only place plans are built, so a broken mapping fails at
 * boot rather than on the request that happens to hit it.
 */
export class Mapper<Ctx = unknown> {
  private readonly registry = new AdapterRegistry();
  private readonly declared = new Set<ClassLike>();
  private readonly plans = new Map<ClassLike, MappingPlan>();
  private readonly compiled = new Map<ClassLike, CompiledPlan>();
  private sealed = false;

  constructor(private readonly options: MapperOptions = {}) {}

  use(adapter: SchemaAdapter): this {
    this.assertUnsealed('use');
    this.registry.use(adapter);
    return this;
  }

  /** Records a DTO. Resolves nothing — descriptors are read at seal. */
  register(...dtos: ClassLike[]): this {
    this.assertUnsealed('register');
    for (const dto of dtos) this.declared.add(dto);
    return this;
  }

  /**
   * Builds every plan, then closes over the DTOs their relations reference
   * (CAP-6) so a nested pair never has to be registered by hand.
   *
   * Returns diagnostics; the caller decides process lifetime (AD-8).
   */
  seal(): PlanReport {
    const diagnostics: AutomapperError[] = [];
    const queue = [...this.declared];

    while (queue.length > 0) {
      const dto = queue.shift()!;
      if (this.plans.has(dto)) continue;

      const result = buildPlan(dto, this.registry);
      if (!result.ok) {
        diagnostics.push(...result.diagnostics);
        continue;
      }
      this.plans.set(dto, result.plan);

      // Auto-registration happens here and nowhere else (AD-16).
      for (const node of result.plan.nodes) {
        if (node.kind === 'nested' || node.kind === 'collection') queue.push(node.target);
      }
    }

    this.link();
    this.sealed = true;

    return {
      ok: diagnostics.length === 0,
      pairs: [...this.plans.values()].map((p) => p.key),
      diagnostics,
    };
  }

  /**
   * Links child plans by value and settles isAsync over the closure (AD-9).
   *
   * The fixpoint is a separate pass because a parent is async when any child
   * is, and a cyclic group has to agree on one answer — neither is knowable
   * while a single pair is being lowered.
   */
  private link(): void {
    const byDest = this.plans;

    for (const plan of byDest.values()) {
      for (const node of plan.nodes) {
        if (node.kind === 'nested' || node.kind === 'collection') {
          node.childPlan = byDest.get(node.target);
        }
      }
    }

    for (let changed = true; changed; ) {
      changed = false;
      for (const plan of byDest.values()) {
        if (plan.isAsync) continue;
        const async = plan.nodes.some(
          (n) =>
            isNodeAsync(n) ||
            ((n.kind === 'nested' || n.kind === 'collection') &&
              (n.childPlan as MappingPlan | undefined)?.isAsync === true),
        );
        if (async) {
          (plan as { isAsync: boolean }).isAsync = true;
          changed = true;
        }
      }
    }
  }

  isSealed(): boolean {
    return this.sealed;
  }

  map<D>(source: unknown, dto: ClassLike<D>, options: MapOptions<Ctx> = {}): D {
    const plan = this.planFor(dto, 'map');
    if (plan.isAsync) throw fail('REGISTRY_UNSEALED', { destType: dto, operation: 'map (async plan — use mapAsync)' });
    return this.compiledFor(dto).invoke(source, options.ctx, newOpState()) as D;
  }

  /**
   * Maps an untrusted request body, rejecting any key the DTO does not accept.
   *
   * `map` trusts its source; this does not. Silently ignoring extra keys is
   * how mass assignment gets through, so unknown and database-owned fields are
   * an error rather than a no-op.
   */
  mapInput<D>(body: unknown, dto: ClassLike<D>, options: MapOptions<Ctx> = {}): D {
    const plan = this.planFor(dto, 'mapInput');
    if (!isWriteDto(dto)) {
      throw fail('DEST_NOT_RUNTIME_CLASS', { destType: dto });
    }

    const accepted = plan.nodes.map((n) => n.field);
    const rejected =
      body && typeof body === 'object'
        ? Object.keys(body as object).filter((k) => !accepted.includes(k))
        : [];

    if (rejected.length > 0) {
      throw fail('INPUT_FIELDS_REJECTED', { destType: dto, rejected, accepted });
    }
    return this.map(body, dto, options);
  }

  mapArray<D>(source: readonly unknown[], dto: ClassLike<D>, options: MapOptions<Ctx> = {}): D[] {
    return source.map((item) => this.map(item, dto, options));
  }

  async mapAsync<D>(source: unknown, dto: ClassLike<D>, options: MapOptions<Ctx> = {}): Promise<D> {
    this.planFor(dto, 'mapAsync');
    return (await this.compiledFor(dto).invoke(source, options.ctx, newOpState())) as D;
  }

  mapArrayAsync<D>(source: readonly unknown[], dto: ClassLike<D>, options: MapOptions<Ctx> = {}): Promise<D[]> {
    return Promise.all(source.map((item) => this.mapAsync(item, dto, options)));
  }

  projectionFor(dto: ClassLike, options: ProjectOptions = {}): FieldSelection {
    return projectionFor(this.planFor(dto, 'projectionFor'), options);
  }

  /** ORM-native find options. Throws if the source's adapter cannot translate. */
  nativeProjectionFor(dto: ClassLike, options: ProjectOptions = {}): unknown {
    const plan = this.planFor(dto, 'nativeProjectionFor');
    const adapter = this.registry.find(plan.source);
    if (!adapter?.toNativeProjection) {
      throw fail('NO_ADAPTER', { type: plan.source as ClassLike, registered: this.registry.names() });
    }
    return adapter.toNativeProjection(projectionFor(plan, options), plan.source);
  }

  /** OpenAPI schema for a DTO (CAP-9). */
  schemaOf(dto: ClassLike, options: SchemaOptions = {}): OpenApiSchema {
    return schemaOf(this.planFor(dto, 'schemaOf'), options);
  }

  /**
   * Which of a DTO's source fields a client may supply, and why the rest are
   * refused (CAP-8).
   *
   * Returns names rather than a generated class: a DTO's static type has to
   * exist at declaration time, so a class built at seal could never be typed.
   * Emitting a typed write DTO needs the CLI codegen path.
   */
  reverseOf(dto: ClassLike): { writable: string[]; dropped: Array<{ field: string; reason: string }> } {
    const plan = this.planFor(dto, 'reverseOf');
    const fields = this.registry.describe(plan.source).fields;
    const dropped: Array<{ field: string; reason: string }> = [];
    const writable: string[] = [];

    for (const field of fields) {
      const reason = writeDropReason(field);
      if (reason) dropped.push({ field: field.name, reason });
      else writable.push(field.name);
    }
    return { writable, dropped };
  }

  planOf(dto: ClassLike): MappingPlan | undefined {
    return this.plans.get(dto);
  }

  /** Emitted source for a pair — what CAP-4's diagnostics show. */
  sourceOf(dto: ClassLike): string | undefined {
    return this.compiled.get(dto)?.source;
  }

  private planFor(dto: ClassLike, operation: string): MappingPlan {
    if (!this.sealed) throw fail('REGISTRY_UNSEALED', { destType: dto, operation });
    const plan = this.plans.get(dto);
    if (!plan) {
      throw fail('MAPPING_NOT_FOUND', {
        sourceType: dto,
        destType: dto,
        typeCandidates: [...this.plans.keys()],
      });
    }
    return plan;
  }

  /** Compiled lazily, but only over the sealed closure (AD-16). */
  private compiledFor(dto: ClassLike): CompiledPlan {
    let entry = this.compiled.get(dto);
    if (!entry) {
      const lookup: ChildLookup = (target) => this.compiledFor(target as ClassLike);
      entry = compile(this.plans.get(dto)!, lookup, this.options.convert ?? {});
      this.compiled.set(dto, entry);
    }
    return entry;
  }

  private assertUnsealed(operation: string): void {
    if (this.sealed) throw fail('REGISTRY_SEALED', { operation });
  }
}
