/**
 * TypeORM schema adapter for @nestjs-automapper.
 *
 * AD-6: this package imports `core` and nothing else from the workspace.
 * `typeorm` is a peer dependency — the app owns the ORM version.
 */
export { typeorm, toFindOptions, ADAPTER_NAME } from './typeorm.adapter.js';
export type { TypeOrmProjection } from './typeorm.adapter.js';
