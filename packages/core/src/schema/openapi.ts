/**
 * OpenAPI back-end (CAP-9). Reads plan nodes only (AD-1).
 *
 * Exists because `extend` removes the syntactic declaration site `@ApiProperty`
 * needs: a computed field has nowhere to hang a decorator, so the schema has to
 * be generated or those fields silently vanish from the docs.
 */

import type { FieldKind } from '../descriptor/types.js';
import { children, type ResolutionNode } from '../plan/node.js';
import type { MappingPlan } from '../plan/planner.js';

export type OpenApiVersion = '3.0' | '3.1';

export interface OpenApiSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface SchemaOptions {
  /** 3.0 emits `nullable: true`; 3.1 emits a type union. Default 3.0 — what @nestjs/swagger produces today. */
  version?: OpenApiVersion;
  /** Sets the schema's `title`. */
  title?: string;
}

const JSON_TYPE: Record<FieldKind, Record<string, unknown>> = {
  string: { type: 'string' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  date: { type: 'string', format: 'date-time' },
  enum: { type: 'string' },
  json: {},
  unknown: {},
};

export function schemaOf(plan: MappingPlan, options: SchemaOptions = {}): OpenApiSchema {
  const version = options.version ?? '3.0';
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const node of plan.nodes) {
    if (node.kind === 'ignore') continue;

    properties[node.field] = propertyOf(node, version);
    if (isRequired(node)) required.push(node.field);
  }

  return {
    type: 'object',
    ...(options.title ? { title: options.title } : {}),
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function propertyOf(node: ResolutionNode, version: OpenApiVersion): Record<string, unknown> {
  const { type, nullable, enumValues } = node.facts;
  const base: Record<string, unknown> = { ...JSON_TYPE[type] };

  if (enumValues && enumValues.length > 0) base['enum'] = [...enumValues];
  if (node.kind === 'collection') return { type: 'array', items: base };
  if (!nullable) return base;

  return version === '3.1'
    ? { ...base, type: [base['type'] ?? 'object', 'null'] }
    : { ...base, nullable: true };
}

/**
 * AD-18's null model, read backwards.
 *
 * A nullable column is `null` on the wire, so the property is present and
 * required. A gated field is `undefined`, which JSON omits — so it is optional
 * regardless of the underlying column.
 */
function isRequired(node: ResolutionNode): boolean {
  if (isGated(node)) return false;
  return !node.facts.nullable;
}

function isGated(node: ResolutionNode): boolean {
  return node.kind === 'gated' || children(node).some(isGated);
}
