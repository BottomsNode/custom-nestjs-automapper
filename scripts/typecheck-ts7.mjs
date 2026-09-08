/**
 * AD-11: CI must additionally type-check under the TypeScript 7.x line.
 *
 * 7.0 is the native Go port. It ships no compiler API, so it cannot build the
 * packages — but it can and must check them, because consumers will be on it.
 * A construct that 6.x accepts and 7.x rejects is a break we ship to users.
 *
 * Revisit trigger (AD-11): when a stable 7.x exposes a compiler API, this
 * script and the alias in the root package.json collapse into the normal build.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const cwd = process.cwd();
const root = join(cwd, '..', '..');

// The 7.x line is installed under the alias `typescript7`.
const candidates = [
  join(root, 'node_modules', 'typescript7', 'bin', 'tsc'),
  join(root, 'node_modules', 'typescript7', 'lib', 'tsc.js'),
];
const entry = candidates.find(existsSync);

if (!entry) {
  console.error('typescript7 is not installed. Expected the alias `typescript7: npm:typescript@7.x` in the workspace root.');
  process.exit(1);
}

try {
  // tsconfig.build.json, not tsconfig.json: it excludes tests, which are
  // local-only and not part of what consumers compile against.
  execFileSync(process.execPath, [entry, '-p', 'tsconfig.build.json', '--noEmit'], { cwd, stdio: 'pipe' });
  console.log('  ts7 typecheck ok');
} catch (err) {
  const out = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
  console.error('  ts7 typecheck FAILED');
  console.error(out.trim() || err.message);
  process.exit(1);
}
