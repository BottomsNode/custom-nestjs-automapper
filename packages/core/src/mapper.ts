import { AdapterRegistry } from './descriptor/registry.js';
import type { ClassLike, FieldSelection, SchemaAdapter } from './descriptor/types.js';
import { AutomapperError, fail } from './diagnose/automapper-error.js';
import { compile, type CompiledPlan } from './emit/codegen.js';
import { buildPlan, type MappingPlan } from './plan/planner.js';
import { projectionFor, type ProjectOptions } from './project/projector.js';

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
