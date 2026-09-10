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

/** What `seal()` found. */
export interface PlanReport {
  /** `true` when every registered mapping resolved. */
  readonly ok: boolean;
  /** The planned mappings, as `Source::Dto`, including nested DTOs. */
  readonly pairs: readonly string[];
  /** One error per problem found. Empty when `ok`. */
  readonly diagnostics: readonly AutomapperError[];
}

export interface MapOptions<Ctx> {
  /** Context passed to `visible()` predicates. */
  readonly ctx?: Ctx;
}

export interface MapperOptions {
  /**
   * Converters applied to every field of a given type.
   *
   * @example
   * ```ts
   * new Mapper({ convert: { date: (v) => (v as Date).toISOString() } });
   * ```
   */
  readonly convert?: TypeConverters;
}

/**
 * Maps sources to DTOs with plans that are built and checked once, at `seal()`.
 *
 * Lifecycle: `use()` adapters and `register()` DTOs, then `seal()`, then map.
 * A broken mapping is reported by `seal()`, before any data is mapped. In
 * NestJS, `AutomapperModule` does all of this for you.
 *
 * @typeParam Ctx - The context type passed to `visible()` predicates.
 *
 * @example
 * ```ts
 * const mapper = new Mapper().use(typeorm(dataSource)).register(UserDto);
 *
 * const report = mapper.seal();
 * if (!report.ok) throw report.diagnostics[0];
 *
 * const dto = mapper.map(user, UserDto);
 * ```
 */
export class Mapper<Ctx = unknown> {
  private readonly registry = new AdapterRegistry();
  private readonly declared = new Set<ClassLike>();
  private readonly plans = new Map<ClassLike, MappingPlan>();
  private readonly compiled = new Map<ClassLike, CompiledPlan>();
  private sealed = false;

  constructor(private readonly options: MapperOptions = {}) {}

  /**
   * Adds a schema adapter. When several describe the same type, the first one
   * added wins.
   *
   * @throws AutomapperError `REGISTRY_SEALED` after `seal()`.
   */
  use(adapter: SchemaAdapter): this {
    this.assertUnsealed('use');
    this.registry.use(adapter);
    return this;
  }

  /**
   * Registers top-level DTOs to plan at `seal()`. DTOs reached through
   * `nested()` or `collection()` are registered automatically.
   *
   * @throws AutomapperError `REGISTRY_SEALED` after `seal()`.
   */
  register(...dtos: ClassLike[]): this {
    this.assertUnsealed('register');
    for (const dto of dtos) this.declared.add(dto);
    return this;
  }

  /**
   * Builds and checks every registered mapping, plus the nested DTOs they
   * reference. Mapping is only possible after this.
   *
   * Never throws for a broken mapping. It returns the problems in
   * `diagnostics` and leaves it to you whether to stop the process.
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

  /** Whether `seal()` has run. */
  isSealed(): boolean {
    return this.sealed;
  }

  /**
   * Maps one trusted source object, such as an ORM entity, to `dto`.
   *
   * @throws AutomapperError `REGISTRY_UNSEALED` before `seal()` or when `dto`
   * is async (use `mapAsync()`), and `MAPPING_NOT_FOUND` when `dto` was never
   * registered.
   */
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
   *
   * @param dto - A DTO declared with `Write()`.
   * @throws AutomapperError `INPUT_FIELDS_REJECTED`, whose payload lists the
   * `rejected` and `accepted` keys, and `DEST_NOT_RUNTIME_CLASS` when `dto` is
   * not a `Write` DTO.
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

  /** `map()` over an array. */
  mapArray<D>(source: readonly unknown[], dto: ClassLike<D>, options: MapOptions<Ctx> = {}): D[] {
    return source.map((item) => this.map(item, dto, options));
  }

  /**
   * Maps a DTO that has `resolve()` fields, or reaches TypeORM lazy relations,
   * awaiting them. Also works for synchronous DTOs.
   */
  async mapAsync<D>(source: unknown, dto: ClassLike<D>, options: MapOptions<Ctx> = {}): Promise<D> {
    this.planFor(dto, 'mapAsync');
    return (await this.compiledFor(dto).invoke(source, options.ctx, newOpState())) as D;
  }

  /** `mapAsync()` over an array, with the elements mapped concurrently. */
  mapArrayAsync<D>(source: readonly unknown[], dto: ClassLike<D>, options: MapOptions<Ctx> = {}): Promise<D[]> {
    return Promise.all(source.map((item) => this.mapAsync(item, dto, options)));
  }

  /**
   * The source fields and relations `dto` reads, in a form no ORM owns.
   * Computed fields contribute their declared dependencies. `fields: []`
   * means none.
   *
   * @throws AutomapperError `CONTEXT_REQUIRED` when `dto` has `visible()`
   * fields and no `ctx` is given.
   */
  projectionFor(dto: ClassLike, options: ProjectOptions = {}): FieldSelection {
    return projectionFor(this.planFor(dto, 'projectionFor'), options);
  }

  /**
   * `projectionFor()` translated into the ORM's own query options. The result
   * is typed `unknown` because it depends on the adapter, so cast it.
   *
   * @example
   * ```ts
   * const options = mapper.nativeProjectionFor(UserDto) as FindManyOptions<User>;
   * const users = await repo.find({ ...options, where: { active: true } });
   * ```
   *
   * @throws AutomapperError `NO_ADAPTER` when the source's adapter cannot
   * translate projections, and `CONTEXT_REQUIRED` as for `projectionFor()`.
   */
  nativeProjectionFor(dto: ClassLike, options: ProjectOptions = {}): unknown {
    const plan = this.planFor(dto, 'nativeProjectionFor');
    const adapter = this.registry.find(plan.source);
    if (!adapter?.toNativeProjection) {
      throw fail('NO_ADAPTER', { type: plan.source as ClassLike, registered: this.registry.names() });
    }
    return adapter.toNativeProjection(projectionFor(plan, options), plan.source);
  }

  /**
   * An OpenAPI schema for `dto`, computed fields included. OpenAPI 3.0 by
   * default; pass `{ version: '3.1' }` for type unions.
   *
   * It needs a sealed mapper, so decorators can't call it. With
   * `@nestjs/swagger`, add the result to the document's `components.schemas`
   * after the app boots.
   */
  schemaOf(dto: ClassLike, options: SchemaOptions = {}): OpenApiSchema {
    return schemaOf(this.planFor(dto, 'schemaOf'), options);
  }

  /**
   * Which fields of `dto`'s source a client may write, and why each of the
   * others is refused (for example `id: 'primary key'`). Use it to inspect the
   * write rules; `Write()` enforces them.
   */
  // Returns names rather than a generated class: a DTO's static type has to
  // exist at declaration time, so a class built at seal could never be typed.
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

  /** The sealed plan for `dto`, for tooling and debugging. */
  planOf(dto: ClassLike): MappingPlan | undefined {
    return this.plans.get(dto);
  }

  /**
   * The source code generated for `dto`'s mapping function, or `undefined`
   * until it has been mapped once. For debugging.
   */
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
