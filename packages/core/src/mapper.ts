import { AdapterRegistry } from './descriptor/registry.js';
import type { ClassLike, FieldSelection, SchemaAdapter } from './descriptor/types.js';
import { AutomapperError, fail } from './diagnose/automapper-error.js';
import { isWriteDto } from './dto/pick.js';
import { compile, type CompiledPlan } from './emit/codegen.js';
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

  /** Builds every plan. Returns diagnostics; the caller decides process lifetime (AD-8). */
  seal(): PlanReport {
    const diagnostics: AutomapperError[] = [];

    for (const dto of this.declared) {
      const result = buildPlan(dto, this.registry);
      if (result.ok) this.plans.set(dto, result.plan);
      else diagnostics.push(...result.diagnostics);
    }

    this.sealed = true;
    return {
      ok: diagnostics.length === 0,
      pairs: [...this.plans.values()].map((p) => p.key),
      diagnostics,
    };
  }

  isSealed(): boolean {
    return this.sealed;
  }

  map<D>(source: unknown, dto: ClassLike<D>, options: MapOptions<Ctx> = {}): D {
    const plan = this.planFor(dto, 'map');
    if (plan.isAsync) throw fail('REGISTRY_UNSEALED', { destType: dto, operation: 'map (async plan — use mapAsync)' });
    return this.compiledFor(dto).invoke(source, options.ctx) as D;
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
    return (await this.compiledFor(dto).invoke(source, options.ctx)) as D;
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
      throw fail('NO_ADAPTER', { type: plan.source, registered: this.registry.names() });
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
      entry = compile(this.plans.get(dto)!);
      this.compiled.set(dto, entry);
    }
    return entry;
  }

  private assertUnsealed(operation: string): void {
    if (this.sealed) throw fail('REGISTRY_SEALED', { operation });
  }
}
