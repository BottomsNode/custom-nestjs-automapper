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
export { Pick, extend, isDtoClass, FIELDS, RESOLVERS, SOURCE } from './dto/pick.js';

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
