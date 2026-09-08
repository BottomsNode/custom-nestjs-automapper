/**
 * Runs the TypeScript 6.x compiler (AD-11's emit line).
 *
 * Invoked through its library entry rather than `node_modules/.bin/tsc`,
 * because that bin is the 7.x line: the alias package `@typescript/typescript6`
 * deliberately exposes `tsc6`, so `tsc` unqualified is TypeScript 7 and would
 * silently type-check on the wrong compiler and emit nothing.
 *
 * Note the version skew: the alias package is published as 6.0.2 but ships
 * compiler 6.0.3.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const entry = join(root, 'node_modules', 'typescript', 'lib', 'tsc.js');

if (!existsSync(entry)) {
  console.error(
    'TypeScript 6.x not found. Expected the alias `typescript: npm:@typescript/typescript6@6.x` in the workspace root.',
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const shipped = require(join(root, 'node_modules', 'typescript', 'package.json'));
if (!/^6\./.test(shipped.version) && process.env['AUTOMAPPER_ALLOW_TS_DRIFT'] !== '1') {
  console.error(
    `Expected the 6.x line for emit (AD-11) but resolved ${shipped.name}@${shipped.version}.`,
  );
  process.exit(1);
}

try {
  execFileSync(process.execPath, [entry, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
} catch (err) {
  process.exit(typeof err.status === 'number' ? err.status : 1);
}
