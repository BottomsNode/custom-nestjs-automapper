/**
 * The IR (AD-2).
 *
 * `ResolutionNode` is a CLOSED discriminated union on `kind`. Every back-end
 * switches exhaustively with a `never` check and no `default` arm. Adding a
 * kind is a breaking change to core and must update every back-end in the same
 * commit.
 *
 * Exhaustiveness over `kind` is necessary and NOT sufficient — a back-end can
 * satisfy `never` and still drop a field by returning nothing for a wrapper
 * kind. `children()` plus the leaf-coverage obligation is the other half.
 *
 * AD-1's compensating clause is why these nodes are fat: back-ends are denied
 * descriptors, so the planner denormalises onto each node every descriptor-
 * derived fact any back-end needs. A back-end missing a fact is a planner
 * defect, never a licence to reach across.
 */

import type { ClassLike, FieldKind, Provenance } from '../descriptor/types.js';
import type { PathSegment } from '../dto/path.js';

/** Descriptor-derived facts carried on every node so no back-end reads a descriptor. */
export interface NodeFacts {
  /** Declared type of the destination field. */
  readonly type: FieldKind;
  readonly nullable: boolean;
  readonly enumValues?: readonly unknown[];
  /** Provenance of the *source* field, when the node reads one. */
  readonly provenance?: Provenance;
  /** Adapter that described the source. Surfaces in diagnostics (AD-5). */
  readonly producedBy: string;
}

interface NodeBase {
  /** Destination property name. Always a property name, never a native name (AD-15). */
  readonly field: string;
  readonly facts: NodeFacts;
  /**
   * Source paths this node reads, lowered to segments (AD-12). Never a dotted
   * string — the same string reads as relation traversal to one back-end and
   * JSON interior to another.
   */
  readonly deps: readonly (readonly PathSegment[])[];
}

/** Direct copy of one source field. */
export interface CopyNode extends NodeBase {
  readonly kind: 'copy';
  readonly from: readonly PathSegment[];
}

/** Derived from declared deps by a user function. */
export interface ComputeNode extends NodeBase {
  readonly kind: 'compute';
  readonly fn: (source: unknown) => unknown;
}

/** Async derived value. Forces the plan async (AD-9). */
export interface ResolveNode extends NodeBase {
  readonly kind: 'resolve';
  readonly fn: (source: unknown) => Promise<unknown>;
}

/** Fixed value; reads nothing. */
export interface ConstantNode extends NodeBase {
  readonly kind: 'constant';
  readonly value: unknown;
}

/**
 * Deliberately unmapped. Present in the plan on purpose — an ignore must be
 * distinguishable from a typo, and the explainer must be able to say which.
 */
export interface IgnoreNode extends NodeBase {
  readonly kind: 'ignore';
}

/** To-one relation. `childPlan` is linked by value in the sealed closure (AD-10). */
export interface NestedNode extends NodeBase {
  readonly kind: 'nested';
  readonly target: ClassLike;
  readonly relation: readonly PathSegment[];
  readonly childPlanKey: string;
}

/** To-many relation. */
export interface CollectionNode extends NodeBase {
  readonly kind: 'collection';
  readonly target: ClassLike;
  readonly relation: readonly PathSegment[];
  readonly childPlanKey: string;
}

/**
 * Context gate. A WRAPPER node carrying its child, never a flag on another node
 * — so `visible(p1, visible(p2, x))` has exactly one representation and the
 * top-level node count still equals the destination field count.
 */
export interface GatedNode extends NodeBase {
  readonly kind: 'gated';
  readonly predicate: (ctx: unknown) => boolean;
  readonly child: ResolutionNode;
}

export type ResolutionNode =
  | CopyNode
  | ComputeNode
  | ResolveNode
  | ConstantNode
  | IgnoreNode
  | NestedNode
  | CollectionNode
  | GatedNode;

export type NodeKind = ResolutionNode['kind'];

/**
 * The single well-known recursion accessor (AD-2).
 *
 * Back-ends are folds over this, never flat switches — a flat switch passes the
 * `never` check while silently dropping whatever a wrapper kind contains.
 */
export function children(node: ResolutionNode): readonly ResolutionNode[] {
  switch (node.kind) {
    case 'gated':
      return [node.child];
    case 'copy':
    case 'compute':
    case 'resolve':
    case 'constant':
    case 'ignore':
    case 'nested':
    case 'collection':
      return [];
    default: {
      const exhaustive: never = node;
      throw new Error(`unhandled node kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Walks a node and all descendants, parents first. */
export function walk(node: ResolutionNode): ResolutionNode[] {
  const out: ResolutionNode[] = [node];
  for (const child of children(node)) out.push(...walk(child));
  return out;
}

/** True when this node or any descendant is async (AD-9 operates on the closure of these). */
export function isNodeAsync(node: ResolutionNode): boolean {
  return walk(node).some((n) => n.kind === 'resolve');
}

/** True when this node or any descendant gates on context (AD-10's requiresContext). */
export function isNodeGated(node: ResolutionNode): boolean {
  return walk(node).some((n) => n.kind === 'gated');
}
