/**
 * Lowering: descriptors + resolvers → `MappingPlan` (AD-12, AD-13).
 *
 * Returns aggregated diagnostics for mapping-content defects, since CAP-4
 * promises a full report. Throws only for structural defects. A returned plan
 * is total — there is no `unresolved` kind for back-ends to handle.
 */

import type { AdapterRegistry } from '../descriptor/registry.js';
import type { ClassLike, FieldMeta, RelationMeta, TypeDescriptor } from '../descriptor/types.js';
import { AutomapperError, fail } from '../diagnose/automapper-error.js';
import type { PathSegment } from '../dto/path.js';
import { FIELDS, RESOLVERS, SOURCE, isDtoClass, isWriteDto } from '../dto/pick.js';
import type { AnyResolver } from '../dto/resolver.js';
import { writeDropReason } from '../policy.js';
import {
  children,
  isNodeAsync,
  isNodeGated,
  type NodeFacts,
  type ResolutionNode,
} from './node.js';

export interface MappingPlan {
  readonly key: string;
  readonly source: ClassLike;
  readonly dest: ClassLike;
  /** Exactly one top-level node per declared destination field (AD-2). */
  readonly nodes: readonly ResolutionNode[];
  /** AD-9. Nested closure folds in at seal; a leaf plan is its own fixpoint. */
  readonly isAsync: boolean;
  /** AD-10: projection without context is an error when this is true. */
  readonly requiresContext: boolean;
}

export type PlanResult =
  | { readonly ok: true; readonly plan: MappingPlan }
  | { readonly ok: false; readonly diagnostics: readonly AutomapperError[] };

export const planKey = (source: ClassLike, dest: ClassLike): string =>
  `${source.name}::${dest.name}`;

export function buildPlan(
  dest: ClassLike,
  registry: AdapterRegistry,
  sourceOverride?: ClassLike,
): PlanResult {
  // Structural defects throw: without a field registry there is nothing to plan.
  if (!isDtoClass(dest)) throw fail('DEST_NOT_RUNTIME_CLASS', { destType: dest });

  const dto = dest as unknown as {
    [FIELDS]: readonly string[];
    [RESOLVERS]: Readonly<Record<string, AnyResolver>>;
    [SOURCE]: ClassLike | undefined;
  };

  const source = sourceOverride ?? dto[SOURCE];
  if (!source) throw fail('DEST_NOT_RUNTIME_CLASS', { destType: dest });

  const sourceDesc = registry.describe(source);
  const byName = new Map(sourceDesc.fields.map((f) => [f.name, f]));
  const candidates = [...byName.keys(), ...sourceDesc.relations.map((r) => r.name)];

  const diagnostics: AutomapperError[] = [];
  const nodes: ResolutionNode[] = [];
  const isWrite = isWriteDto(dest);

  for (const field of dto[FIELDS]) {
    // AD-14: a database-owned field on a write DTO is a rejection, not a
    // silent exclusion — otherwise nothing tells the developer it was ignored.
    const meta = byName.get(field);
    if (isWrite && meta) {
      const reason = writeDropReason(meta);
      if (reason) {
        diagnostics.push(
          fail('WRITE_FIELD_REJECTED', {
            destType: dest,
            sourceType: source,
            field,
            reason,
            adapter: sourceDesc.producedBy,
          }),
        );
        continue;
      }
    }

    const resolver = dto[RESOLVERS][field];
    const node = resolver
      ? lowerResolver(field, resolver, sourceDesc, registry, dest, diagnostics)
      : lowerCopy(field, byName.get(field), sourceDesc, dest, candidates, diagnostics);
    if (node) nodes.push(node);
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };

  return {
    ok: true,
    plan: {
      key: planKey(source, dest),
      source,
      dest,
      nodes,
      isAsync: nodes.some(isNodeAsync),
      requiresContext: nodes.some(isNodeGated),
    },
  };
}

/** A field with no resolver copies from the source field of the same name (AD-15: exact match). */
function lowerCopy(
  field: string,
  meta: FieldMeta | undefined,
  sourceDesc: TypeDescriptor,
  dest: ClassLike,
  candidates: readonly string[],
  diagnostics: AutomapperError[],
): ResolutionNode | undefined {
  if (!meta) {
    diagnostics.push(
      fail('FIELD_UNRESOLVED', {
        destType: dest,
        sourceType: sourceDesc.type,
        field,
        adapter: sourceDesc.producedBy,
        nameCandidates: candidates,
      }),
    );
    return undefined;
  }
  const from: PathSegment[] = [{ kind: 'field', name: meta.name }];
  return { kind: 'copy', field, from, deps: [from], facts: factsFor(meta, sourceDesc) };
}

function lowerResolver(
  field: string,
  resolver: AnyResolver,
  sourceDesc: TypeDescriptor,
  registry: AdapterRegistry,
  dest: ClassLike,
  diagnostics: AutomapperError[],
): ResolutionNode | undefined {
  const deps: (readonly PathSegment[])[] = [];
  for (const path of resolver.deps) {
    const lowered = lowerPath(path, sourceDesc, registry);
    if (!lowered) {
      diagnostics.push(
        fail('DEP_UNKNOWN', {
          destType: dest,
          sourceType: sourceDesc.type,
          field,
          path,
          adapter: sourceDesc.producedBy,
          nameCandidates: sourceDesc.fields.map((f) => f.name),
        }),
      );
      continue;
    }
    deps.push(lowered);
  }

  // The first dep's field metadata is the best available provenance for a
  // derived field; a computed value has no provenance of its own.
  const firstDep = resolver.deps[0];
  const meta = firstDep ? sourceDesc.fields.find((f) => f.name === firstDep.split('.')[0]) : undefined;
  const facts = meta ? factsFor(meta, sourceDesc) : bareFacts(sourceDesc);

  switch (resolver.kind) {
    case 'auto':
    case 'from': {
      const from = deps[0];
      if (!from) return undefined; // a diagnostic was already recorded
      return { kind: 'copy', field, from, deps, facts };
    }
    case 'compute':
      return { kind: 'compute', field, fn: resolver.fn as (s: unknown) => unknown, deps, facts };
    case 'resolve':
      return {
        kind: 'resolve',
        field,
        fn: resolver.fn as (s: unknown) => Promise<unknown>,
        deps,
        facts,
      };
    case 'constant':
      return { kind: 'constant', field, value: resolver.constant, deps: [], facts };
    case 'ignore':
      return { kind: 'ignore', field, deps: [], facts };
    case 'nested':
    case 'collection': {
      const target = resolver.target?.() as ClassLike | undefined;
      if (!target) return undefined;

      // The relation defaults to the destination field name; `deps` only
      // carries a path when the two differ.
      const relPath = resolver.deps[0] ?? field;
      const relation = lowerPath(relPath, sourceDesc, registry);
      if (!relation) {
        diagnostics.push(
          fail('DEP_UNKNOWN', {
            destType: dest,
            sourceType: sourceDesc.type,
            field,
            path: relPath,
            adapter: sourceDesc.producedBy,
            nameCandidates: sourceDesc.relations.map((r) => r.name),
          }),
        );
        return undefined;
      }
      const relMeta = sourceDesc.relations.find((r) => r.name === relPath);
      return {
        kind: resolver.kind,
        field,
        target,
        relation,
        deps: [relation],
        facts: { type: 'unknown', nullable: relMeta?.nullable ?? true, producedBy: sourceDesc.producedBy },
      };
    }

    case 'gated': {
      const inner = resolver.child;
      if (!inner || !resolver.predicate) return undefined;
      const child = lowerResolver(field, inner, sourceDesc, registry, dest, diagnostics);
      if (!child) return undefined;
      return { kind: 'gated', field, predicate: resolver.predicate, child, deps, facts };
    }
    default: {
      const exhaustive: never = resolver.kind;
      throw new Error(`unhandled resolver kind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Dotted string → `PathSegment[]` (AD-12). Done once, here; back-ends never
 * parse a path. A JSON segment is terminal: projection selects the column and
 * never descends into its interior.
 */
function lowerPath(
  path: string,
  from: TypeDescriptor,
  registry: AdapterRegistry,
): PathSegment[] | undefined {
  const parts = path.split('.');
  const segments: PathSegment[] = [];
  let current: TypeDescriptor | undefined = from;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined || current === undefined) return undefined;

    if (/^\d+$/.test(part)) {
      segments.push({ kind: 'index' });
      continue;
    }

    // Annotated explicitly: `current` is reassigned from a descriptor derived
    // through this very lookup, which makes TS infer these circularly.
    const relation: RelationMeta | undefined = current.relations.find((r) => r.name === part);
    if (relation) {
      const target: ClassLike = relation.target();
      segments.push({ kind: 'relation', name: part, target });
      current = registry.find(target) ? registry.describe(target) : undefined;
      continue;
    }

    const field = current.fields.find((f) => f.name === part);
    if (!field) return undefined;

    if (field.type === 'json') {
      segments.push({ kind: 'json', name: part, interior: parts.slice(i + 1) });
      return segments;
    }

    segments.push({ kind: 'field', name: part });
    current = undefined; // a scalar terminates the path
  }

  return segments;
}

function factsFor(meta: FieldMeta, desc: TypeDescriptor): NodeFacts {
  return {
    type: meta.type,
    nullable: meta.nullable,
    provenance: meta.provenance,
    producedBy: desc.producedBy,
    ...(meta.enumValues ? { enumValues: meta.enumValues } : {}),
  };
}

function bareFacts(desc: TypeDescriptor): NodeFacts {
  return { type: 'unknown', nullable: true, producedBy: desc.producedBy };
}

export { children };
