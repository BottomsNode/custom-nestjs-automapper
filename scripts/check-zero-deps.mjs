/**
 * AD-6 / AD-20 enforcement.
 *
 * `core` must declare no runtime dependencies of any kind, and no adapter may
 * depend on another adapter. These are architectural invariants, so they are
 * asserted in CI rather than trusted to review.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname — the latter leaves percent-encoding, which
// breaks on any path containing a space.
const PACKAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages');

/** Packages that are adapters — none may import another. */
const ADAPTERS = new Set(['@nestjs-automapper/typeorm']);

const failures = [];

const dirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const dir of dirs) {
  const manifestPath = join(PACKAGES_DIR, dir, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    failures.push(`packages/${dir}: no readable package.json`);
    continue;
  }

  const deps = Object.keys(pkg.dependencies ?? {});
  const peers = Object.keys(pkg.peerDependencies ?? {});

  if (pkg.name === '@nestjs-automapper/core') {
    if (deps.length > 0) {
      failures.push(`core declares dependencies: ${deps.join(', ')} — AD-6 requires none`);
    }
    if (peers.length > 0) {
      failures.push(`core declares peerDependencies: ${peers.join(', ')} — AD-6 requires none`);
    }
  }

  if (ADAPTERS.has(pkg.name)) {
    const otherAdapters = [...deps, ...peers].filter((d) => ADAPTERS.has(d) && d !== pkg.name);
    if (otherAdapters.length > 0) {
      failures.push(`${pkg.name} depends on another adapter: ${otherAdapters.join(', ')} — AD-6 forbids it`);
    }
  }

  if (pkg.name === '@nestjs-automapper/nestjs' && [...deps, ...peers].includes('@nestjs-automapper/typeorm')) {
    failures.push('nestjs depends on typeorm — AD-6 forbids it');
  }
}

if (failures.length > 0) {
  console.error('Dependency invariants violated:\n');
  for (const f of failures) console.error('  - ' + f);
  console.error('');
  process.exit(1);
}

console.log(`Dependency invariants hold across ${dirs.length} packages (AD-6, AD-20).`);
