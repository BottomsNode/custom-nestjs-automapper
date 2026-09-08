#!/usr/bin/env node
/**
 * `automapper check <module>` — CAP-3 in CI.
 *
 * Boots the application's Nest context rather than constructing a bare
 * Mapper, so the pair set it validates is the same one the running app seals
 * (AD-16). A check that enumerated a different set would pass while the app
 * still failed to start.
 */

import type { Type } from '@nestjs/common';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';

async function check(modulePath: string, exportName: string): Promise<number> {
  const { NestFactory } = await import('@nestjs/core');
  const loaded = (await import(pathToFileURL(resolvePath(modulePath)).href)) as Record<
    string,
    unknown
  >;

  const moduleClass = loaded[exportName];
  if (typeof moduleClass !== 'function') {
    console.error(`automapper check: '${exportName}' is not exported from ${modulePath}`);
    return 2;
  }

  try {
    // Constructing the context instantiates the seal provider, which throws
    // if any mapping is unresolved.
    const app = await NestFactory.createApplicationContext(moduleClass as Type, { logger: false });
    await app.close();
    console.log('automapper check: all mappings resolve');
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// Not top-level await: the CommonJS build does not allow it.
void (async (): Promise<void> => {
  const [command, modulePath, exportName = 'AppModule'] = process.argv.slice(2);

  if (command !== 'check' || !modulePath) {
    console.error('usage: automapper check <path-to-compiled-module> [ExportName=AppModule]');
    process.exit(2);
  }

  process.exit(await check(modulePath, exportName));
})();
