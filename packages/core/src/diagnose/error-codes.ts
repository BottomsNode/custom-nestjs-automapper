/**
 * Error payloads (AD-5): open by code, closed per code. Candidate lists stay
 * split by type so a renderer never guesses what it is holding.
 */

import type { ClassLike } from '../descriptor/types.js';

/** Where a declaration was written. Captured by core, never assembled by a host. */
export interface Origin {
  readonly file: string;
  readonly line: number;
}

interface Common {
  readonly sourceType?: ClassLike;
  readonly destType?: ClassLike;
  readonly field?: string;
  readonly adapter?: string;
  readonly origin?: Origin;
  readonly typeCandidates?: readonly ClassLike[];
  readonly nameCandidates?: readonly string[];
}

export interface ErrorPayloads {
  /** No registered adapter — including the built-in DTO adapter — describes a type. */
  NO_ADAPTER: Common & { readonly type: ClassLike; readonly registered: readonly string[] };

  /** A destination field has no source and no explicit resolution (CAP-3). */
  FIELD_UNRESOLVED: Common & { readonly destType: ClassLike; readonly field: string };

  /** A resolver declared a dependency path that does not exist on the source (CAP-10 at runtime). */
  DEP_UNKNOWN: Common & { readonly field: string; readonly path: string };

  /** A path segment cannot be addressed — e.g. a property whose name contains the separator. */
  PATH_UNADDRESSABLE: Common & { readonly path: string; readonly reason: string };

  /** No mapping is registered for a requested pair (CAP-4's headline message). */
  MAPPING_NOT_FOUND: Common & { readonly sourceType: ClassLike; readonly destType: ClassLike };

  /** A write DTO declared a field the write policy drops (AD-14 — a rejection, not a silent exclusion). */
  WRITE_FIELD_REJECTED: Common & { readonly field: string; readonly reason: string };

  /** A cycle exists and the back-edge field is not optional (AD-7). */
  CYCLE_REQUIRED_FIELD: Common & { readonly field: string; readonly cycle: readonly string[] };

  /** Projection was requested for a context-gated plan with no context supplied (AD-10). */
  CONTEXT_REQUIRED: Common & { readonly destType: ClassLike; readonly gatedFields: readonly string[] };

  /** Declaration attempted after seal (AD-16). */
  REGISTRY_SEALED: Common & { readonly operation: string };

  /** A map was attempted before seal (AD-16) — lazy first-call planning is unreachable. */
  REGISTRY_UNSEALED: Common & { readonly operation: string };

  /** The destination is not a runtime-real class, so planning is impossible (AD-13 structural). */
  DEST_NOT_RUNTIME_CLASS: Common & { readonly destType: ClassLike };
}

export type ErrorCode = keyof ErrorPayloads;

/** A single-line summary per code. Detail comes from the payload. */
export const ERROR_HEADLINE: { readonly [K in ErrorCode]: string } = {
  NO_ADAPTER: 'no schema adapter describes this type',
  FIELD_UNRESOLVED: 'destination field has no resolution',
  DEP_UNKNOWN: 'resolver declares a dependency that does not exist on the source',
  PATH_UNADDRESSABLE: 'source path cannot be addressed',
  MAPPING_NOT_FOUND: 'no mapping registered for this pair',
  WRITE_FIELD_REJECTED: 'write DTO declares a database-owned field',
  CYCLE_REQUIRED_FIELD: 'cycle reaches a required field',
  CONTEXT_REQUIRED: 'projection requires context',
  REGISTRY_SEALED: 'registry is sealed',
  REGISTRY_UNSEALED: 'mapper has not been sealed',
  DEST_NOT_RUNTIME_CLASS: 'destination is not a runtime-real class',
};
