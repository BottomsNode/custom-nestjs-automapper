export { Mapper } from './core/mapper';
export { MappingProfile, MappingBuilder } from './core/mapping-profile';
export { createMappingContext } from './core/mapping-context';
export { MappingConfigurator } from './core/mapping-config';

// Types
export type {
    ClassType,
    MapperFunction,
    AsyncMapperFunction,
    MappingConfig,
    MappingRegistryEntry,
    MappingEntryOptions,
    NamingConvention,
    MappingContext,
    ConditionalMapping,
    TransformOptions,
    MappingResult,
    ValidationRule,
    MappingError
} from './core/types';

// Decorators
export {
    AutoMap,
    MapProperty,
    MapNested,
    Transform,
    Ignore,
    Default,
    DateFormat,
    Validate,
    Mappable,
    MapProfile,
    AUTO_MAP_METADATA_KEY,
    MAP_PROPERTY_METADATA_KEY,
    MAP_NESTED_METADATA_KEY,
    TRANSFORM_METADATA_KEY,
    MAPPABLE_CLASS_METADATA_KEY
} from './decorators';

// Utilities
export { deepClone } from './utils/deep-clone.util';
export { getPropertyByPath, setPropertyByPath } from './utils/property-path.util';
export { isObject, isArray, isEnumValue } from './utils/type-check.util';
export { convertNamingConvention } from './utils/naming-convention.util';
export { validateProperty } from './utils/validation.util';

// Mapping helpers
export {
    mapFrom,
    mapFromArray,
    condition,
    ignore,
    transform,
    formatDate,
    nullToDefault,
    concat,
    compute
} from './utils/mapper-helpers.util';

// Strategies
export { ArrayMappingStrategy } from './strategies/array.strategy';
export { EnumMappingStrategy } from './strategies/enum.strategy';
export { PolymorphicMappingStrategy } from './strategies/polymorphic.strategy';
