/**
 * The single error type (AD-5). Rendering lives here and nowhere else, so
 * CAP-4's promise holds instead of each package reinterpreting it.
 */

import type { ClassLike } from '../descriptor/types.js';
import { ERROR_HEADLINE, type ErrorCode, type ErrorPayloads, type Origin } from './error-codes.js';

export class AutomapperError<C extends ErrorCode = ErrorCode> extends Error {
  readonly code: C;
  readonly payload: ErrorPayloads[C];

  constructor(code: C, payload: ErrorPayloads[C]) {
    super(render(code, payload));
    this.name = 'AutomapperError';
    this.code = code;
    this.payload = payload;
    Error.captureStackTrace?.(this, AutomapperError);
  }

  is<K extends ErrorCode>(code: K): this is AutomapperError<K> {
    return (this.code as ErrorCode) === code;
  }
}

export function fail<C extends ErrorCode>(code: C, payload: ErrorPayloads[C]): AutomapperError<C> {
  return new AutomapperError(code, payload);
}

const nameOf = (t: ClassLike | undefined): string => t?.name ?? '<unknown>';

/**
 * Renders one error. Layout is not part of the contract; the information is.
 * Every branch must answer three questions: what failed, why, and what to do.
 */
function render<C extends ErrorCode>(code: C, payload: ErrorPayloads[C]): string {
  const p = payload as ErrorPayloads[ErrorCode];
  const lines: string[] = [`${code}: ${ERROR_HEADLINE[code]}`, ''];

  switch (code) {
    case 'MAPPING_NOT_FOUND': {
      const q = p as ErrorPayloads['MAPPING_NOT_FOUND'];
      lines.push(`  no map ${nameOf(q.sourceType)} → ${nameOf(q.destType)}`);
      const others = (q.typeCandidates ?? []).map(nameOf);
      if (others.length > 0) {
        lines.push('', `  registered from ${nameOf(q.sourceType)}: ${others.join(', ')}`);
        const near = nearest(nameOf(q.destType), others);
        if (near) lines.push(`  did you mean ${near}?`);
      } else {
        lines.push('', `  nothing is registered from ${nameOf(q.sourceType)}.`);
      }
      lines.push('', `  register it:  createMap(${nameOf(q.sourceType)}, ${nameOf(q.destType)})`);
      break;
    }

    case 'FIELD_UNRESOLVED': {
      const q = p as ErrorPayloads['FIELD_UNRESOLVED'];
      lines.push(`  ${nameOf(q.destType)}.${q.field} has no source and no resolver`);
      lines.push(...didYouMean(q.nameCandidates, q.field, q.adapter));
      lines.push('', '  resolve it, or mark it ignore().');
      break;
    }

    case 'DEP_UNKNOWN': {
      const q = p as ErrorPayloads['DEP_UNKNOWN'];
      lines.push(`  ${nameOf(q.destType)}.${q.field} declares dep '${q.path}'`);
      lines.push(`  no such path on ${nameOf(q.sourceType)}`);
      lines.push(...didYouMean(q.nameCandidates, q.path, q.adapter));
      break;
    }

    case 'NO_ADAPTER': {
      const q = p as ErrorPayloads['NO_ADAPTER'];
      lines.push(`  nothing describes ${nameOf(q.type)}`);
      lines.push(
        '',
        q.registered.length > 0
          ? `  adapters, in order: ${q.registered.map((n, i) => `[${i}] ${n}`).join(', ')}`
          : '  no adapters are registered.',
      );
      lines.push('', '  register one with mapper.use(), or derive the type with Pick()/extend().');
      break;
    }

    case 'WRITE_FIELD_REJECTED': {
      const q = p as ErrorPayloads['WRITE_FIELD_REJECTED'];
      lines.push(`  ${nameOf(q.destType)}.${q.field} is database-owned (${q.reason})`);
      lines.push('', '  remove it from the write DTO — the database supplies it.');
      break;
    }

    case 'INPUT_FIELDS_REJECTED': {
      const q = p as ErrorPayloads['INPUT_FIELDS_REJECTED'];
      lines.push(`  ${nameOf(q.destType)} does not accept: ${q.rejected.join(', ')}`);
      lines.push(`  accepted: ${q.accepted.join(', ')}`);
      lines.push('', '  remove them from the request — the server owns these values.');
      break;
    }

    case 'CYCLE_REQUIRED_FIELD': {
      const q = p as ErrorPayloads['CYCLE_REQUIRED_FIELD'];
      lines.push(`  cycle: ${q.cycle.join(' → ')}`);
      lines.push(`  ${q.field} is required, so it cannot be omitted`);
      lines.push('', "  make it optional, or set cycles: 'ref' on the map.");
      break;
    }

    case 'CONTEXT_REQUIRED': {
      const q = p as ErrorPayloads['CONTEXT_REQUIRED'];
      lines.push(`  ${nameOf(q.destType)} gates: ${q.gatedFields.join(', ')}`);
      lines.push('  what to fetch depends on context, so context is required');
      lines.push('', '  pass { ctx } to projectionFor().');
      break;
    }

    case 'PATH_UNADDRESSABLE': {
      const q = p as ErrorPayloads['PATH_UNADDRESSABLE'];
      lines.push(`  '${q.path}' — ${q.reason}`);
      break;
    }

    case 'REGISTRY_SEALED': {
      const q = p as ErrorPayloads['REGISTRY_SEALED'];
      lines.push(`  ${q.operation}() after seal()`);
      lines.push('', '  declare every map before the mapper is sealed.');
      break;
    }

    case 'REGISTRY_UNSEALED': {
      const q = p as ErrorPayloads['REGISTRY_UNSEALED'];
      lines.push(`  ${q.operation}() before seal()`);
      lines.push('', '  call seal(), or let AutomapperModule do it on init.');
      break;
    }

    case 'DEST_NOT_RUNTIME_CLASS': {
      const q = p as ErrorPayloads['DEST_NOT_RUNTIME_CLASS'];
      lines.push(`  ${nameOf(q.destType)} exposes no runtime field registry`);
      lines.push('', '  build it with Pick()/extend(), or register an adapter that describes it.');
      break;
    }

    default: {
      const exhaustive: never = code;
      throw new Error(`unhandled error code: ${String(exhaustive)}`);
    }
  }

  if (p.origin) lines.push('', `  declared at ${p.origin.file}:${p.origin.line}`);
  return lines.join('\n');
}

function didYouMean(
  candidates: readonly string[] | undefined,
  actual: string,
  adapter: string | undefined,
): string[] {
  const near = nearest(actual, candidates ?? []);
  if (!near) return [];
  const via = adapter ? ` (adapter: ${adapter})` : '';
  return [`  did you mean '${near}'?${via}`];
}

/** Nearest candidate within an edit distance that scales with the word's length. */
export function nearest(target: string, candidates: readonly string[]): string | undefined {
  const budget = Math.max(2, Math.floor(target.length / 3));
  let best: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate === target) continue;
    const score = editDistance(target.toLowerCase(), candidate.toLowerCase());
    if (score < bestScore && score <= budget) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Levenshtein, two-row. Inputs are identifier-length, so this is not hot. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}

export type { ErrorCode, ErrorPayloads, Origin };
