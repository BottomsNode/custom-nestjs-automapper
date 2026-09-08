/**
 * Projection back-end (AD-10) — CAP-5.
 *
 * Walks the plan and unions the declared deps of every node into a neutral
 * `FieldSelection`. It never inspects the destination class, the registry, or
 * adapter metadata: the plan already carries everything (AD-1).
 *
 * This is why deps are declared rather than inferred. `fullName` is computed
 * from `firstName` and `lastName`, and no amount of looking at the destination
 * would reveal that — a projector that guessed would under-fetch and the field
 * would silently resolve to "undefined undefined".
 */

import type { FieldSelection } from '../descriptor/types.js';
import { fail } from '../diagnose/automapper-error.js';
import type { PathSegment } from '../dto/path.js';
import { children, type ResolutionNode } from '../plan/node.js';
import type { MappingPlan } from '../plan/planner.js';

export const EMPTY_SELECTION: FieldSelection = Object.freeze({
  fields: Object.freeze([]) as readonly string[],
  relations: Object.freeze({}),
});

export interface ProjectOptions {
  readonly ctx?: unknown;
}

/**
 * `fields: []` means EXACTLY NONE, never "everything" — the empty array is not
 * overloaded. `all: true` is the explicit escape hatch.
 */
export function projectionFor(plan: MappingPlan, options: ProjectOptions = {}): FieldSelection {
  // AD-10: projecting the union of all contexts would silently over-fetch,
  // which is the failure CAP-5 exists to prevent and which no review catches.
  if (plan.requiresContext && options.ctx === undefined) {
    throw fail('CONTEXT_REQUIRED', {
      destType: plan.dest,
      sourceType: plan.source,
      gatedFields: plan.nodes.filter((n) => n.kind === 'gated').map((n) => n.field),
    });
  }

  let selection = EMPTY_SELECTION;
  for (const node of plan.nodes) {
    selection = mergeSelection(selection, selectionOf(node, options));
  }
  return selection;
}

/** A fold over `children()`, so a wrapper kind can never drop its subtree (AD-2). */
function selectionOf(node: ResolutionNode, options: ProjectOptions): FieldSelection {
  switch (node.kind) {
    case 'ignore':
    case 'constant':
      // Reads nothing, so it contributes nothing to fetch.
      return EMPTY_SELECTION;

    case 'gated':
      // A gate that fails needs none of its child's columns — the whole point
      // of taking context into account rather than projecting the union.
      return node.predicate(options.ctx)
        ? children(node).reduce((acc, c) => mergeSelection(acc, selectionOf(c, options)), EMPTY_SELECTION)
        : EMPTY_SELECTION;

    case 'copy':
    case 'compute':
    case 'resolve':
    case 'nested':
    case 'collection':
      return node.deps.reduce((acc, dep) => mergeSelection(acc, fromPath(dep)), EMPTY_SELECTION);

    default: {
      const exhaustive: never = node;
      throw new Error(`unhandled node kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** One lowered path → a selection tree. Relations nest; a json segment is terminal. */
function fromPath(segments: readonly PathSegment[]): FieldSelection {
  if (segments.length === 0) return EMPTY_SELECTION;

  const [head, ...rest] = segments;
  if (!head) return EMPTY_SELECTION;

  switch (head.kind) {
    case 'field':
      return { fields: [head.name], relations: {} };

    case 'json':
      // Select the column; never descend into `interior`. Descending would ask
      // the database for columns that do not exist.
      return { fields: [head.name], relations: {} };

    case 'relation': {
      const child = fromPath(rest);
      return { fields: [], relations: { [head.name]: child } };
    }

    case 'index':
      // An array index does not change which columns are needed.
      return fromPath(rest);

    default: {
      const exhaustive: never = head;
      throw new Error(`unhandled segment kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * The single merge implementation (AD-10). Both the projector and any adapter
 * composing selections call this — nobody re-implements it, because two
 * implementations would disagree about `all` and about relation depth.
 */
export function mergeSelection(a: FieldSelection, b: FieldSelection): FieldSelection {
  if (a.all === true || b.all === true) {
    // `all` absorbs this level's fields and propagates to no other level.
    return { fields: [], relations: mergeRelations(a.relations, b.relations), all: true };
  }
  return {
    fields: [...new Set([...a.fields, ...b.fields])],
    relations: mergeRelations(a.relations, b.relations),
  };
}

function mergeRelations(
  a: Readonly<Record<string, FieldSelection>>,
  b: Readonly<Record<string, FieldSelection>>,
): Record<string, FieldSelection> {
  const out: Record<string, FieldSelection> = { ...a };
  for (const [name, selection] of Object.entries(b)) {
    const existing = out[name];
    out[name] = existing ? mergeSelection(existing, selection) : selection;
  }
  return out;
}
