# Running the tests

The test suite is **not committed**. It lives on your machine only, and no
`.spec.ts`, `.test-d.ts`, or test tooling is tracked by git or shipped to npm.

That means a fresh clone has no tests. To run them you need the local files and
the test dependencies, neither of which the manifests declare:

```bash
pnpm add -Dw vitest @vitest/coverage-v8
pnpm add -D --filter @nestjs-automapper/typeorm sql.js
pnpm add -D --filter @nestjs-automapper/nestjs @nestjs/testing

npx vitest run
```

`.gitignore` covers `*.spec.ts`, `*.test-d.ts`, and `vitest.config.*`, so
adding tests back will not accidentally commit them.

## What CI still checks

Without tests, CI verifies what remains verifiable:

- typecheck on the TypeScript 6 emit line
- typecheck on the TypeScript 7 line, which consumers will be on
- dual ESM + CJS build of all three packages
- the dependency invariants (`core` declares nothing; no adapter imports another)

That catches compile-level regressions and packaging mistakes. It does not
catch behavioural ones — a mapping that compiles but produces the wrong object
will reach a release. Worth knowing when reviewing a change.
