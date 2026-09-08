/**
 * Codegen back-end (AD-3). One emitted function per plan.
 *
 * Field names arrive from ORM metadata, so they are untrusted input to a code
 * generator: keys are bracketed string literals, identifiers come from a fixed
 * alphabet below, and resolvers are closure arguments — never stringified.
 */

import { fail } from '../diagnose/automapper-error.js';
import type { FieldKind } from '../descriptor/types.js';
import type { PathSegment } from '../dto/path.js';
import type { MappingPlan } from '../plan/planner.js';
import { children, type ResolutionNode } from '../plan/node.js';

/** Emitter-controlled identifiers. Nothing user-supplied ever becomes one. */
const SRC = 's';
const DST = 'd';
const CTX = 'c';
const FNS = 'f';
const CONSTS = 'k';
const PREDS = 'p';
const CTOR = 'D';
const KIDS = 'n';   // child mappers, resolved lazily so cycles compile
const CONV = 'v';   // type converters, applied by declared field type
const OP = 'o';     // per-operation state (AD-7)

export interface CompiledPlan {
  readonly key: string;
  readonly isAsync: boolean;
  /** The emitted source. Kept for diagnostics — CAP-4 can show what actually ran. */
  readonly source: string;
  readonly invoke: (source: unknown, ctx?: unknown, op?: OpState) => unknown;
}

/**
 * Per-operation state (AD-7). Created per top-level map, discarded on return,
 * so nothing can go stale between requests.
 *
 * One identity map does the work of a visited set and a memo: the destination
 * is inserted BEFORE its fields are filled, so a cycle finds the in-progress
 * instance instead of recursing, and a shared reference maps once and is
 * shared. That is why no separate ancestor chain is needed.
 */
export interface OpState {
  readonly seen: Map<object, unknown>;
  depth: number;
}

export const MAX_DEPTH = 25;

export const newOpState = (): OpState => ({ seen: new Map(), depth: 0 });

/** Resolves a child's compiled plan on first use, so cyclic pairs can compile. */
export type ChildLookup = (target: unknown) => CompiledPlan | undefined;

/**
 * Converters applied to every field of a declared type — `date` to an ISO
 * string, say. Only expressible because the plan carries each field's type
 * (AD-1); without descriptors this would have to be repeated per field.
 */
export type TypeConverters = Partial<Record<FieldKind, (value: unknown) => unknown>>;

export function compile(
  plan: MappingPlan,
  lookup: ChildLookup = () => undefined,
  converters: TypeConverters = {},
): CompiledPlan {
  const fns: Array<(s: unknown) => unknown> = [];
  const consts: unknown[] = [];
  const preds: Array<(ctx: unknown) => boolean> = [];
  const kids: Array<(s: unknown, c: unknown, o: OpState) => unknown> = [];
  const convs: Array<(v: unknown) => unknown> = [];
  const body: string[] = [];

  for (const node of plan.nodes) {
    body.push(...emit(node, { fns, consts, preds, kids, convs, lookup, converters, isAsync: plan.isAsync }));
  }

  const source = [
    `${OP} = ${OP} || { seen: new Map(), depth: 0 };`,
    `if (${SRC} == null) return ${SRC};`,
    `const prior = ${OP}.seen.get(${SRC});`,
    `if (prior !== undefined) return prior;`,
    `if (++${OP}.depth > ${MAX_DEPTH}) { ${OP}.depth--; return undefined; }`,
    `const ${DST} = new ${CTOR}();`,
    // Registered before the fields are filled, so a cycle resolves to this
    // instance instead of recursing forever.
    `${OP}.seen.set(${SRC}, ${DST});`,
    ...body,
    `${OP}.depth--;`,
    `return ${DST};`,
  ].join('\n');

  const factory = new Function(
    CTOR,
    FNS,
    CONSTS,
    PREDS,
    KIDS,
    CONV,
    `return ${plan.isAsync ? 'async ' : ''}function (${SRC}, ${CTX}, ${OP}) {
${source}
};`,
  ) as (
    Ctor: unknown,
    f: unknown[],
    k: unknown[],
    p: unknown[],
    n: unknown[],
    v: unknown[],
  ) => (s: unknown, c?: unknown, o?: OpState) => unknown;

  return {
    key: plan.key,
    isAsync: plan.isAsync,
    source,
    invoke: factory(plan.dest, fns, consts, preds, kids, convs),
  };
}

interface Slots {
  fns: Array<(s: unknown) => unknown>;
  consts: unknown[];
  preds: Array<(ctx: unknown) => boolean>;
  kids: Array<(s: unknown, c: unknown, o: OpState) => unknown>;
  convs: Array<(v: unknown) => unknown>;
  lookup: ChildLookup;
  converters: TypeConverters;
  isAsync: boolean;
}

/**
 * Emits the statements for one node.
 *
 * A fold over `children()`, not a flat switch (AD-2): a flat switch satisfies
 * the `never` check and still drops whatever a wrapper kind contains.
 */
function emit(node: ResolutionNode, slots: Slots): string[] {
  const key = lit(node.field);
  const target = `${DST}[${key}]`;

  switch (node.kind) {
    case 'copy': {
      const convert = slots.converters[node.facts.type];
      if (!convert) return [`${target} = ${access(node.from)};`];
      const slot = slots.convs.push(convert) - 1;
      return [`${target} = ${CONV}[${slot}](${access(node.from)});`];
    }

    case 'compute':
      return [`${target} = ${FNS}[${slots.fns.push(node.fn) - 1}](${SRC});`];

    case 'resolve':
      // AD-9 guarantees the enclosing function is async whenever any node is.
      return [`${target} = await ${FNS}[${slots.fns.push(node.fn) - 1}](${SRC});`];

    case 'constant':
      return [`${target} = ${CONSTS}[${slots.consts.push(node.value) - 1}];`];

    case 'ignore':
      // AD-18: the constructor already assigned every declared key, so an
      // ignored field is present and undefined. Never `delete`.
      return [];

    case 'gated': {
      const slot = slots.preds.push(node.predicate) - 1;
      const inner = children(node).flatMap((child) => emit(child, slots));
      return [`if (${PREDS}[${slot}](${CTX})) {`, ...inner.map((l) => `  ${l}`), `}`];
    }

    case 'nested': {
      const slot = pushChild(node.target, slots);
      // A lazy relation holds a Promise; awaiting is what stops the mapper
      // writing the promise object into the DTO.
      const value = node.isLazy ? `await ${access(node.relation)}` : access(node.relation);
      return [`${target} = ${KIDS}[${slot}](${value}, ${CTX}, ${OP});`];
    }

    case 'collection': {
      const slot = pushChild(node.target, slots);
      const items = node.isLazy ? `await ${access(node.relation)}` : access(node.relation);
      return [
        `const items_${slot} = ${items};`,
        `${target} = Array.isArray(items_${slot})`,
        `  ? items_${slot}.map(function (e) { return ${KIDS}[${slot}](e, ${CTX}, ${OP}); })`,
        `  : [];`,
      ];
    }

    default: {
      const exhaustive: never = node;
      throw new Error(`unhandled node kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Child mappers are resolved on first call, not at compile time: a pair that
 * refers to itself would otherwise need its own compiled form to exist before
 * it could be compiled.
 */
function pushChild(target: unknown, slots: Slots): number {
  let resolved: CompiledPlan | undefined;
  return (
    slots.kids.push((s, c, o) => {
      resolved ??= slots.lookup(target);
      if (!resolved) throw fail('MAPPING_NOT_FOUND', { sourceType: target as never, destType: target as never });
      return resolved.invoke(s, c, o);
    }) - 1
  );
}

/**
 * Builds a null-safe accessor from lowered segments.
 *
 * A `json` segment is terminal — it reads the column and never descends into
 * the interior, which is the whole reason paths are lowered before they reach
 * a back-end (AD-12).
 */
function access(segments: readonly PathSegment[]): string {
  let expr = SRC;
  for (const segment of segments) {
    switch (segment.kind) {
      case 'field':
      case 'relation':
      case 'json':
        expr += `?.[${lit(segment.name)}]`;
        break;
      case 'index':
        // Arrays are read whole; an element index only appears inside a
        // collection node, which is not emitted yet.
        break;
      default: {
        const exhaustive: never = segment;
        throw new Error(`unhandled segment kind: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  return expr;
}

/**
 * The only place a runtime string becomes part of the emitted source, and it
 * is always a string literal in value position — never an identifier, never a
 * property name written bare.
 */
function lit(value: string): string {
  return JSON.stringify(value);
}
