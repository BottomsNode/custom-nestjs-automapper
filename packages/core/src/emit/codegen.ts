/**
 * Codegen back-end (AD-3).
 *
 * One specialised function per plan, built once and reused, so the hot path
 * does no metadata lookup. v1 called this "compiled" but re-read metadata on
 * every property of every call; this actually emits.
 *
 * AD-3, and the reason it is an AD rather than a style note: field names reach
 * this code from ORM metadata and user config. A column named `a"; process.exit()`
 * is a syntax error at best and arbitrary execution at worst. So:
 *   - property access is bracket notation with JSON.stringify-ed keys,
 *   - every identifier in the source comes from a fixed alphabet here,
 *   - resolver functions are passed in as closure arguments and are NEVER
 *     stringified into the body.
 * No string that originated outside this file is ever emitted as code.
 */

import { fail } from '../diagnose/automapper-error.js';
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

export interface CompiledPlan {
  readonly key: string;
  readonly isAsync: boolean;
  /** The emitted source. Kept for diagnostics — CAP-4 can show what actually ran. */
  readonly source: string;
  readonly invoke: (source: unknown, ctx?: unknown) => unknown;
}

export function compile(plan: MappingPlan): CompiledPlan {
  const fns: Array<(s: unknown) => unknown> = [];
  const consts: unknown[] = [];
  const preds: Array<(ctx: unknown) => boolean> = [];
  const body: string[] = [];

  for (const node of plan.nodes) {
    body.push(...emit(node, { fns, consts, preds, isAsync: plan.isAsync }));
  }

  const source = [
    `const ${DST} = new ${CTOR}();`,
    ...body.map((line) => line),
    `return ${DST};`,
  ].join('\n');

  const factory = new Function(
    CTOR,
    FNS,
    CONSTS,
    PREDS,
    `return ${plan.isAsync ? 'async ' : ''}function (${SRC}, ${CTX}) {\n${source}\n};`,
  ) as (
    Ctor: unknown,
    f: unknown[],
    k: unknown[],
    p: unknown[],
  ) => (s: unknown, c?: unknown) => unknown;

  return {
    key: plan.key,
    isAsync: plan.isAsync,
    source,
    invoke: factory(plan.dest, fns, consts, preds),
  };
}

interface Slots {
  fns: Array<(s: unknown) => unknown>;
  consts: unknown[];
  preds: Array<(ctx: unknown) => boolean>;
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
    case 'copy':
      return [`${target} = ${access(node.from)};`];

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

    case 'nested':
    case 'collection':
      throw fail('DEST_NOT_RUNTIME_CLASS', { destType: node.target });

    default: {
      const exhaustive: never = node;
      throw new Error(`unhandled node kind: ${JSON.stringify(exhaustive)}`);
    }
  }
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
