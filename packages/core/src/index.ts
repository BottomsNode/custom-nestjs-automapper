export type {
  ClassLike,
  Instantiable,
  FieldKind,
  Provenance,
  FieldMeta,
  RelationMeta,
  TypeDescriptor,
  FieldSelection,
  SchemaAdapter,
} from './descriptor/types.js';
export { NO_PROVENANCE } from './descriptor/types.js';

export type { Path, PathSegment } from './dto/path.js';
export { PATH_SEPARATOR } from './dto/path.js';

export type { Resolver, ResolverKind, AnyResolver } from './dto/resolver.js';
export { auto, from, compute, resolve, constant, ignore, visible } from './dto/resolver.js';

export type { DtoClass, DtoStatics, AsyncBrand } from './dto/pick.js';
export { Pick, Write, extend, isDtoClass, isWriteDto, FIELDS, RESOLVERS, SOURCE, WRITE } from './dto/pick.js';

// --- descriptors & adapter arbitration (AD-17) ---
export { AdapterRegistry, dtoAdapter } from './descriptor/registry.js';

// --- diagnostics (AD-5) ---
export { AutomapperError, fail, nearest } from './diagnose/automapper-error.js';
export type { ErrorCode, ErrorPayloads, Origin } from './diagnose/error-codes.js';
export { ERROR_HEADLINE } from './diagnose/error-codes.js';

// --- the IR (AD-2) ---
export type {
  ResolutionNode,
  NodeKind,
  NodeFacts,
  CopyNode,
  ComputeNode,
  ResolveNode,
  ConstantNode,
  IgnoreNode,
  NestedNode,
  CollectionNode,
  GatedNode,
} from './plan/node.js';
export { children, walk, isNodeAsync, isNodeGated } from './plan/node.js';

// --- lowering (AD-12, AD-13) ---
export type { MappingPlan, PlanResult } from './plan/planner.js';
export { buildPlan, planKey } from './plan/planner.js';

// --- codegen back-end (AD-3) ---
export type { CompiledPlan } from './emit/codegen.js';
export { compile } from './emit/codegen.js';

// --- projection back-end (AD-10) ---
export { projectionFor, mergeSelection, EMPTY_SELECTION } from './project/projector.js';
export type { ProjectOptions } from './project/projector.js';

// --- facade ---
export { Mapper } from './mapper.js';
export type { PlanReport, MapOptions } from './mapper.js';

// --- direction policy (AD-14) ---
export { writeDropReason, writableFields, isHiddenOnRead } from './policy.js';

// --- OpenAPI back-end (CAP-9) ---
export { schemaOf } from './schema/openapi.js';
export type { OpenApiSchema, SchemaOptions, OpenApiVersion } from './schema/openapi.js';
export { nested, collection } from './dto/resolver.js';
export { newOpState, MAX_DEPTH } from './emit/codegen.js';
export type { OpState, ChildLookup } from './emit/codegen.js';
export { defaultTo } from './dto/resolver.js';
export type { TypeConverters } from './emit/codegen.js';
export type { MapperOptions } from './mapper.js';
