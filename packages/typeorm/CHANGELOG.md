# @nestjs-automapper/typeorm

## 2.0.1

### Patch Changes

-   Fix misleading diagnostics. `MAPPING_NOT_FOUND` named the DTO as both source
    and destination and told you to call `createMap()`, a 1.x API. It now names the
    unplanned DTO, lists the planned ones with a did-you-mean, and points at
    `mapper.register()` or `AutomapperModule`'s `dtos`. `CYCLE_REQUIRED_FIELD` no
    longer suggests a `cycles: 'ref'` option that does not exist.

    Repository metadata now points at `nishit-shivdasani/nestjs-automapper`.

-   Updated dependencies
    -   @nestjs-automapper/core@2.0.1

## 2.0.0

### Major Changes

-   First stable release of the 2.0 rebuild. The mapper now reads your ORM's
    schema: mappings are validated at boot and in CI, DTOs drive the `SELECT`,
    and request bodies carrying database-owned fields are rejected.

    Supersedes `custom-automapper@1.x`, which is not source-compatible. See the
    [changelog](https://github.com/nishit-shivdasani/nestjs-automapper/blob/master/CHANGELOG.md)
    and the [migration guide](https://github.com/nishit-shivdasani/nestjs-automapper/blob/master/docs/MIGRATION.md).

### Patch Changes

-   Updated dependencies
    -   @nestjs-automapper/core@2.0.0
