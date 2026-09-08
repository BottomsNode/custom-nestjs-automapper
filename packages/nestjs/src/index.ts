/**
 * NestJS integration — Phase 5.
 *
 * AD-16: AutomapperModule.onModuleInit calls mapper.seal(). That is the single
 * place plans are built, nested pairs are closed over, and CAP-3 becomes real.
 */
export const PACKAGE_NAME = '@nestjs-automapper/nestjs';
