# @nestjs-automapper/nestjs

## 2.0.0

### Major Changes

-   First stable release of the 2.0 rebuild. The mapper now reads your ORM's
    schema: mappings are validated at boot and in CI, DTOs drive the `SELECT`,
    and request bodies carrying database-owned fields are rejected.

    Supersedes `custom-automapper@1.x`, which is not source-compatible. See the
    [changelog](https://github.com/nishit-shivdasani/custom-nestjs-automapper/blob/master/CHANGELOG.md)
    and the [migration guide](https://github.com/nishit-shivdasani/custom-nestjs-automapper/blob/master/docs/MIGRATION.md).

### Patch Changes

-   Updated dependencies
    -   @nestjs-automapper/core@2.0.0
