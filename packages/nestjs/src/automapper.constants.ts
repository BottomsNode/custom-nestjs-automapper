/** DI token for the default Mapper. */
export const MAPPER = Symbol.for('@nestjs-automapper/mapper');

/** Metadata key set by `@MapTo`. */
export const MAP_TO = Symbol.for('@nestjs-automapper/map-to');

/**
 * Token for a named mapper. Apps with more than one mapping context — a
 * tenant per schema, or separate public and admin surfaces — register each
 * under its own name and inject by the same name.
 */
export const getMapperToken = (name?: string): symbol =>
  name === undefined ? MAPPER : Symbol.for(`@nestjs-automapper/mapper:${name}`);
