/**
 * Dual ESM + CJS build for one package (AD-20).
 *
 * AD-11: emit with the TypeScript 6.x line, consumed via the npm alias
 * `@typescript/typescript6`. The 7.x line ships no compiler API, so it cannot
 * produce .d.ts and cannot back `@nx/js:tsc`. It is a type-check target only.
 *
 * Two passes:
 *   1. ESM + declarations  -> dist/
 *   2. CommonJS            -> dist/cjs/  (+ a nested package.json marking the
 *                             directory CommonJS, so Node resolves it correctly
 *                             even though the package itself is "type": "module")
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const tsc6 = join(cwd, '..', '..', 'scripts', 'tsc6.mjs');

function run(label, args) {
  process.stdout.write(`  ${label} … `);
  try {
    execFileSync(process.execPath, [tsc6, ...args], { cwd, stdio: 'pipe' });
    process.stdout.write('ok\n');
  } catch (err) {
    process.stdout.write('FAILED\n');
    const out = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
    console.error(out.trim() || err.message);
    process.exit(1);
  }
}

if (existsSync(join(cwd, 'dist'))) rmSync(join(cwd, 'dist'), { recursive: true, force: true });

run('esm + types', ['-p', 'tsconfig.build.json']);
run('cjs        ', ['-p', 'tsconfig.cjs.json']);

mkdirSync(join(cwd, 'dist', 'cjs'), { recursive: true });
writeFileSync(
  join(cwd, 'dist', 'cjs', 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
);

console.log('  dual output written to dist/ (esm+types) and dist/cjs/ (commonjs)');
