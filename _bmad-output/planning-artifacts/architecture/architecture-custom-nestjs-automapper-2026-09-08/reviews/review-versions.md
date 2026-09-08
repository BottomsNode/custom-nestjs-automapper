# Reality-Check Review — Versions & Toolchain Claims

**Target:** `ARCHITECTURE-SPINE.md` (`architecture-custom-nestjs-automapper-2026-09-08`)
**Reviewer role:** independent verification against the live npm registry and the web
**Review date:** 2026-09-08
**Method:** `curl https://registry.npmjs.org/<pkg>` parsed as JSON (`dist-tags`, `time`, per-version manifests); published tarballs downloaded and inspected directly; GitHub REST API; vendor documentation. No claim below rests on recollection.

---

## Verdict

The Stack table is **accurate** — every version listed is the current `latest` on npm as of 2026-09-08, and nothing is yanked or deprecated. The two load-bearing technical claims in AD-11 (TypeScript 7 ships no compiler API; `@automapper/classes` needs a compiler-API transformer plugin) both **check out against primary evidence**. The problems are not factual errors in the table — they are *framing* problems in AD-11 and *unrecorded* constraints that will bite during Phase 0.

Two findings are material: AD-11 is written as a permanent structural fact but has a vendor-announced expiry of roughly October 2026, and its competitive inference ("the incumbent structurally cannot") is stronger than the evidence supports.

---

## 1. Stack table — version-by-version

Raw `dist-tags` + `time` from `registry.npmjs.org`, retrieved 2026-09-08.

| Row | Doc claims | Registry `latest` | Published | Verdict |
| --- | --- | --- | --- | --- |
| TypeScript (emit) | `6.0.3` | `7.0.2` is `latest`; `6.0.3` is the last **stable 6.x** | 2026-04-16T23:38:27Z | **Correct.** 6.0.3 is genuinely the terminal 6.x stable. Nothing after it in the 6 line. |
| TypeScript (check target) | `7.0.2` | `7.0.2` | 2026-07-08T15:55:18Z | **Correct.** `next` = `7.1.0-dev.20260907.1`; `rc` = `7.0.1-rc`. No 7.0.3. |
| Nx | `23.2.0` | `23.2.0` | 2026-09-02T15:40:28Z | **Correct.** 6 days old at doc date. `previous` = 22.7.9. |
| pnpm | `12.3.4` | `12.3.4` | 2026-09-04T14:20:10Z | **Correct.** 4 days old. Note `latest-11` = `11.26.0` published 2026-09-06 — *after* 12.3.4, so the 11 line is still actively maintained. |
| Vitest | `5.0.0` | `5.0.0` | 2026-09-03T12:24:30Z | **Correct.** 5 days old. `V4` tag still live at `4.1.11` (2026-08-18). |
| `@nestjs/common` / `core` / `testing` | `12.0.1` | `12.0.1` | 2026-08-27T07:28–07:30Z | **Correct.** |
| `@nestjs/swagger` | `12.0.1` | `12.0.1` | 2026-08-28T08:14:26Z | **Correct.** |
| `typeorm` | `1.1.1` | `1.1.1` | 2026-09-01T11:02:28Z | **Correct.** `legacy` = 0.3.31, `beta` = 1.0.0-beta.3. |
| `reflect-metadata` | `0.2.2` | `0.2.2` | 2024-03-29T01:38:46Z | **Correct but note:** unpublished for ~2.5 years. Still the ecosystem standard — `@nestjs/swagger@12.0.1` declares `reflect-metadata: ^0.1.12 \|\| ^0.2.0` as a peer, so it has not been dropped. |

No package in the table is deprecated. I checked every 6.x/7.x TypeScript version manifest for a `deprecated` field — none present.

### Finding V-1 (Medium) — the table pins exact versions where a published library needs ranges

Three of eight rows are less than a week old at authoring time (Nx 23.2.0, pnpm 12.3.4, Vitest 5.0.0), and two of those are brand-new majors. That is defensible for a greenfield build substrate, but the table records exact pins with no floor/range policy. For a library whose whole product is `peerDependencies`, the shipped range matters more than the pin: `typeorm@1.1.1` versus `^1.0.0`, `@nestjs/common@12.0.1` versus `^12.0.0`. The spine does not say which. Recommend a "peer range" column, or a one-line rule ("peers are declared as `^major`; devDeps are pinned").

### Finding V-2 (Medium) — no Node engine floor is recorded, and the transitive floor is Node 22.13

Composed from the manifests I pulled:

- `typeorm@1.1.1` `engines`: `"node": "^20.19.0 || ^22.13.0 || >=24.11.0"`
- Vitest 5.0 raises its runtime requirement to **Node 22 / Vite 6.4** (per the Vitest 5 announcement)

The effective floor for the dev toolchain is therefore Node 22.13, and for consumers ≥20.19. The spine records neither. For a library that publishes `.d.ts` and `engines`, this is a real interface decision missing from the Stack section.

---

## 2. AD-11 — "TypeScript 7.0 ships no compiler API"

### Confirmed, and the breakage list is exactly right

Each named victim was verified against a primary or vendor source, not a blog aggregate:

**`nest build` / nest-cli** — `nestjs/nest-cli` issue **#3479**, "Support TypeScript 7: adapt CLI to work without the programmatic Compiler API", opened **2026-07-11**, still **open**. The named missing exports are `getParsedCommandLineOfConfigFile`, `createProgram`, `createWatchProgram`, `getPreEmitDiagnostics`. Breaks `nest build`, `nest start`, `nest start --watch`, for both the default `tsc` builder and the SWC builder. A related PR (#3478) only added an error message telling users to install TypeScript 6 — it did not fix compatibility.
<https://github.com/nestjs/nest-cli/issues/3479>

**`@nestjs/swagger` CLI plugin** — verified directly from the published tarball for `@nestjs/swagger@12.0.1`. The plugin is unambiguously a compiler-API consumer:

```
package/dist/plugin/compiler-plugin.d.ts:1:   import * as ts from 'typescript';
package/dist/plugin/utils/ast-utils.js:3:     import { ObjectFlags, SyntaxKind, TypeFlags,
                                               TypeFormatFlags } from 'typescript';
```

**`ts-jest`** — official ts-jest docs now carry a dedicated "Using TypeScript 7" page. It states TypeScript 7 "has no compatible JavaScript API, and ts-jest will stop early with an actionable configuration error" if you point its `compiler` option at the native build.
<https://kulshekhar.github.io/ts-jest/docs/next/guides/typescript-7>

**`ts-loader`** — `TypeStrong/ts-loader` issue **#1702**, "Support for TypeScript 7"; the loader fails because APIs it relies on (e.g. `ts.sys`) are no longer exposed.
<https://github.com/TypeStrong/ts-loader/issues/1702>

**type-aware ESLint** — `typescript-eslint` issue **#10940** ("Use TS 7 (tsgo / typescript-go) for type information") was **closed as not planned**. Blockers cited: ESLint has no async parser support, tsgo is async, and serialization across the boundary is unsolved. The current alternative is `oxlint` + `tsgolint`, covering 59 of 61 type-aware rules.
<https://github.com/typescript-eslint/typescript-eslint/issues/10940>

**Nx itself** — Nx publishes a knowledge-base article on exactly this. It confirms `@nx/js/typescript` plugin, `@nx/js:tsc` in legacy workspaces, `vite` and `typescript-eslint` all still require the classic API, and that `compiler: 'tsgo'` only swaps the build command — graph and tsconfig analysis still hard-require the classic API.
<https://nx.dev/docs/kb/typescript-7>

**TypeScript 6.0 as the terminal JS line** — TypeScript 6.0 shipped **2026-03-23** and is officially the final release built on the JavaScript codebase; the Strada compiler API is replaced by the new Corsa API in 7.0.
<https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/>

### Confirmed: the recommended split is current mainstream guidance

The spine's rule — *emit on 6.x, type-check the published `.d.ts` on 7.x in CI* — is not the author's invention. It is the pattern Nx, ts-jest, and the NestJS community all publish today. Nx's own KB gives the canonical form:

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

The NestJS-specific writeup uses the same shape with `npx -y -p typescript@7 tsc --noEmit` for the CI check. AD-11's rule is, essentially, the industry consensus.

### Finding AD11-1 (High) — AD-11 states a temporary condition as a structural one, with no expiry recorded

Microsoft's position, quoted in nest-cli#3479, is that the programmatic API is **"expected to return in TypeScript 7.1, but there is no confirmed timeline."** Independent coverage puts 7.1 at roughly **October 2026** — one to two months after this document's date. `typescript@next` is already publishing `7.1.0-dev.*` nightlies daily (latest at review time: `7.1.0-dev.20260907.1`, 2026-09-07).

AD-11 reads as a permanent architectural fact: *"TypeScript 7.0 is a native Go port that ships no compiler API."* True of 7.0. Very likely false of 7.1, within the lifetime of Phase 0. An invariant that expires in six weeks and does not say so will be quietly wrong in the repo, and the "no plugin" guarantee it justifies will look over-argued when 7.1 lands.

**Recommendation:** keep the rule, restate the rationale as time-boxed. Something like: *"As of 7.0.2, the compiler API is absent; Microsoft expects it to return in 7.1 (~Oct 2026, unconfirmed). Re-evaluate this AD when 7.1 ships. The no-plugin guarantee stands regardless of 7.1, because it is justified by consumer build-coupling, not only by API availability."* That last clause is what makes the AD survive the event.

### Finding AD11-2 (Medium) — the split's actual mechanism is npm aliasing, which the Stack table cannot express

You cannot install `typescript@6.0.3` and `typescript@7.0.2` under the same name. Every published recipe uses aliases, and the 6.x side of the alias is a **separate package**, `@typescript/typescript6`, whose `latest` is **`6.0.2`** (published 2026-07-06) — one patch *behind* the `6.0.3` the Stack table names (2026-04-16). Note the odd ordering: the compat shim was cut from 6.0.2, after 6.0.3 already existed on the `typescript` package.

So "TypeScript (emit) 6.0.3" is achievable only if you *don't* co-install 7 locally (CI reaching for 7 via `npx` instead), which is a legitimate choice but a different one from the Nx/ts-jest recipe. The spine does not say which it means. This is the single most likely place for Phase 0 to lose a day.

Registry evidence:
```
@typescript/typescript6  dist-tags: {"latest": "6.0.2"}   6.0.2 → 2026-07-06T18:06:47Z
@typescript/native-preview dist-tags: {"latest": "7.0.0-dev.20260707.2"}
typescript               dist-tags: {"latest": "7.0.2", "beta": "6.0.0-beta",
                                     "next": "7.1.0-dev.20260907.1"}
```

**Recommendation:** add the literal `devDependencies` block to the Stack section. It is two lines and it removes all ambiguity.

---

## 3. The `@automapper/classes` transformer-plugin claim

This is the load-bearing positioning claim, so I verified it from the published artifact rather than from documentation.

### The factual half: CONFIRMED, strongly

`@automapper/classes@9.0.2` (`latest`, published **2026-07-16T19:10:34Z**) manifest:

```json
"exports": {
  "./transformer-plugin": {
    "types": "./transformer-plugin/index.d.mts",
    "import": "./transformer-plugin/index.mjs",
    "default": "./transformer-plugin/index.mjs"
  }
},
"peerDependencies": {
  "typescript": "^6.0.0",
  "@automapper/core": "^9.0.2",
  "reflect-metadata": "^0.1.14 || ^0.2.0"
}
```

The plugin ships, and its peer range **tops out at TypeScript 6** — it does not admit 7 at all. I extracted the tarball and read the entry point. Line 2 of `transformer-plugin/index.mjs`:

```js
import { ModuleKind, NodeBuilderFlags, SyntaxKind, TypeFlags, TypeFormatFlags,
         getAllJSDocTags, getDecorators, isArrayTypeNode, isClassDeclaration,
         isGetAccessorDeclaration, isImportDeclaration, isPropertyDeclaration,
         isSourceFile, isTypeNode, visitEachChild, visitNode } from "typescript";
```

and the body drives a live `TypeChecker` (`typeChecker.getTypeAtLocation`, `typeChecker.typeToTypeNode(..., NodeBuilderFlags.NoTruncation)`). This is a textbook classic-compiler-API consumer — AST visitors plus type resolution, exactly the surface 7.0 removed.

Corroborating: upstream **attempted** TS7 and gave up. `nartc/mapper` PR **#635, "Chore/9.0 typescript 7"**, opened 2026-07-10, **closed 2026-07-15 without being merged** (`merged_at: null`). The 9.0.2 changelog entry (2026-07-16) mentions only "declare astro dependency", "declare config dependencies", "resolve strategy types from local core" — no TypeScript 7 work shipped. The repo is not archived (`archived: false`, last push 2026-08-08, 1007 stars, 3 open issues), so this is an active project that tried and did not land it.

**So: the plugin exists, it is API-dependent, and it cannot run on a bare TypeScript 7 install. The spine is right on the facts.**

### Finding AD11-3 (High) — the inference drawn from those facts is overstated

AD-11 concludes: *"Requiring no plugin is therefore not only ergonomics — it is what keeps this library working on a toolchain where the incumbent structurally cannot."*

That does not follow from what I verified. Under the standard alias setup — the same one this architecture needs for its *own* emit — `typescript` resolves to 6.x, and `@automapper/classes/transformer-plugin` works exactly as it always did. So does `nest build`. The incumbent is excluded only from a *pure, TS-7-only* toolchain, and no such NestJS toolchain currently exists: `nest build` itself is broken there (issue #3479, open), as is `@nestjs/swagger`'s plugin, `ts-jest`, and `@nx/js:tsc`. There is presently nowhere for this library to run that the incumbent cannot also run.

Worse for the argument, when 7.1 restores the API (Finding AD11-1), the incumbent's plugin becomes portable again — possibly before 2.0 ships. The differentiator as written has a plausible expiry date.

The honest and much more durable version of the claim is about **build coupling**, not capability:

> A transformer plugin couples the consumer's build to a compiler-API-stable TypeScript and to a specific builder configuration. Every toolchain migration — 6→7, tsc→tsgo, webpack→SWC — is a migration the consumer must re-solve. Requiring no plugin means consumers inherit none of that.

That claim is true today, stays true after 7.1, and does not depend on predicting Microsoft's roadmap. **Recommend rewriting the final sentence of AD-11 along those lines.** The *rule* ("must never require a transformer plugin") is well-founded and should not change — only its justification.

---

## 4. The `tsup` rejection

### Correct on the numbers, and understated on severity

Registry, `tsup`:
```
dist-tags: {"latest": "8.5.1"}
8.5.1 → 2025-11-12T21:21:42Z
modified: 2025-11-12T21:21:43Z
```

Exactly the date the spine cites. From 2026-09-08 that is **9 months 27 days** — "roughly ten months stale" is accurate. There is only one dist-tag; no `next`, no maintenance branch.

But "stale" undersells it. The `egoist/tsup` README now carries an explicit notice:

> "This project is not actively maintained anymore. Please consider using tsdown instead. Read more in the migration guide."

<https://github.com/egoist/tsup>

**Recommendation:** replace "roughly ten months stale" with the maintainer's own words. "Stale" invites someone to re-litigate the decision in six months; "the maintainer has declared it unmaintained and points to a successor" closes it permanently. If a bundler is ever reconsidered, `tsdown` — not `tsup` — is the thing to evaluate.

### The Nx half: CONFIRMED

From the `@nx/js@23.2.0` tarball, `executors.json`:

```
["copy-workspace-modules", "tsc", "swc", "node",
 "prune-lockfile", "release-publish", "verdaccio"]
```

`@nx/js:tsc` and `@nx/js:swc` both exist and ship in the version the spine names. Nx 23.2.0 is 6 days old, so "actively maintained" is beyond dispute.

### Finding TSUP-1 (Low, but worth one line) — choosing `@nx/js:tsc` *reinforces* the TS-6 pin

Per Nx's own KB, `@nx/js:tsc` and the `@nx/js/typescript` plugin are themselves classic-compiler-API consumers. Selecting Nx executors for emit therefore hard-binds the build to TypeScript 6.x — which is what AD-11 already mandates, so there is no conflict. But the two decisions are currently written as independent (AD-11 in Invariants, Nx in a Stack footnote) when they are actually the same constraint appearing twice. Cross-reference them so nobody "modernises" the builder later without realising it is load-bearing for AD-11.

---

## 5. `typeorm` 1.x — did the metadata API survive the major?

**Yes. Completely. Every single symbol the architecture depends on is present.** This was the highest-risk item on the list — a 0.3 → 1.0 major on the package that the entire `typeorm` adapter and AD-10's projector are built on — so I read the type definitions out of the published `typeorm@1.1.1` tarball rather than trusting docs.

`package/data-source/DataSource.d.ts`:
```
 73:  readonly entityMetadatas: EntityMetadata[];
 78:  readonly entityMetadatasMap: Map<EntityTarget<any>, EntityMetadata>;
171:  hasMetadata(target: EntityTarget<any>): boolean;
177:  getMetadata(target: EntityTarget<any>): EntityMetadata;
```

`package/metadata/ColumnMetadata.d.ts` — every flag named in the review brief, all present, all still plain `boolean`:
```
 38:  propertyName: string;
 58:  isPrimary: boolean;
 62:  isGenerated: boolean;
 66:  isNullable: boolean;
 70:  isSelect: boolean;
 82:  generationStrategy?: "uuid" | "increment" | "rowid";
169:  databaseName: string;
207:  isCreateDate: boolean;
211:  isUpdateDate: boolean;
215:  isDeleteDate: boolean;
```

`package/metadata/RelationMetadata.d.ts`:
```
 27:  inverseEntityMetadata: EntityMetadata;
 42:  relationType: RelationType;
 56:  propertyName: string;
149:  isOwning: boolean;
221:  joinColumns: ColumnMetadata[];
228:  inverseJoinColumns: ColumnMetadata[];
```

`package/metadata/EntityMetadata.d.ts`:
```
 71:  target: Function | string;
107:  tableName: string;
190:  ownColumns: ColumnMetadata[];
194:  columns: ColumnMetadata[];
267:  primaryColumns: ColumnMetadata[];
275:  relations: RelationMetadata[];
```

The `typeorm` adapter's `describe()` can be written against 1.1.1 with no shimming. `isDeleteDate` (soft-delete) and `isSelect` (the column-level exclusion flag that AD-10's `FieldSelection` needs to respect) both survived, which were the two most plausible casualties.

Nothing deprecated; `latest` is a live line with nightly `dev` builds (`1.1.1-nightly.20260907`).

---

## 6. Things I could not confirm — reported as findings, not assumed away

Per the brief, inability to confirm is itself a result.

1. **Whether TypeScript 7.1 will actually restore the full API, and when.** Microsoft's language is "expected"; nest-cli#3479 records "no confirmed timeline"; secondary sources say ~October 2026. `7.1.0-dev` nightlies exist but I did not verify that they export `createProgram`. **This is the load-bearing uncertainty under Finding AD11-1** and the spine should record it as an open risk rather than resolving it in either direction.

2. **Whether `@nx/js:tsc@23.2.0` emits correct `.d.ts` for this package layout under TypeScript 6.0.3 specifically.** `@nx/js@23.2.0` declares no `typescript` dependency or peer at all (peers are only `@swc/cli` and `verdaccio`), so the supported TS range is unstated by the package. Nx's KB implies 6.x via the alias recipe. **Unverified by execution** — this should be the first thing Phase 0 proves, before any interface work.

3. **Whether Vitest 5.0.0 is stable enough to adopt.** It is genuinely `latest` and genuinely 5 days old. The announcement documents breaking changes to test discovery, mocking, config defaults, browser support, and programmatic config resolution. I found no evidence of a 5.0.1 regression release, but five days is not enough signal either way. The `V4` tag (`4.1.11`) remains published as a live fallback.

4. **Whether `@nestjs/common@12` still needs `reflect-metadata` at all** given TypeScript 6's standard-decorator direction. Partially confirmed: `@nestjs/swagger@12.0.1` still declares it as a peer, and the NestJS + TS7 writeup confirms `experimentalDecorators`/`emitDecoratorMetadata` still emit the `design:paramtypes` that Nest's injector reads at boot. So the spine's placement (peer of the `nestjs` package only) looks right. Not independently proven for `@nestjs/core` 12.

5. **No `@nestjs-automapper/*` package exists on npm yet.** Expected for a greenfield 2.0, and not a defect — but it means the name is unclaimed and unverified as available. Worth a five-second check before Phase 0.

---

## Summary of findings

| ID | Severity | Finding | Action |
| --- | --- | --- | --- |
| AD11-1 | High | AD-11 states a condition Microsoft expects to end in TS 7.1 (~Oct 2026) as a permanent structural fact; no expiry recorded | Time-box the rationale; re-anchor the no-plugin rule on build coupling so it survives 7.1 |
| AD11-3 | High | "a toolchain where the incumbent structurally cannot [work]" is overstated — under the standard alias setup the incumbent's plugin works fine, and no TS-7-only NestJS toolchain exists today | Rewrite the closing sentence around consumer build-coupling, not capability |
| AD11-2 | Medium | The 6/7 split requires npm aliasing via `@typescript/typescript6` (`latest` = 6.0.2, behind the 6.0.3 in the table); the Stack table cannot express it | Add the literal `devDependencies` alias block |
| V-1 | Medium | Exact pins with no peer-range policy, on a library whose product is its peers | Add a peer-range column or a one-line rule |
| V-2 | Medium | No Node engine floor recorded; transitive floor is Node 22.13 (Vitest 5) / ≥20.19 (typeorm 1.1.1) | Record `engines` for published packages and for the dev toolchain |
| TSUP-1 | Low | `tsup` is not merely "stale" — the maintainer declares it unmaintained and points to `tsdown`; also, `@nx/js:tsc` is itself a TS-6-API consumer, making the Nx choice load-bearing for AD-11 | Quote the maintainer's notice; cross-reference Nx choice to AD-11 |

**Nothing in the Stack table needs a version change.** Every claim I could check against primary evidence held. The corrections above are about framing, expiry, and unrecorded constraints — not about the author having trusted a stale memory on versions. On that specific test, the document passes.

---

## Sources

**Registry (authoritative, JSON `dist-tags` + `time`, retrieved 2026-09-08)**
- `https://registry.npmjs.org/typescript`
- `https://registry.npmjs.org/nx` · `https://registry.npmjs.org/@nx%2Fjs/23.2.0`
- `https://registry.npmjs.org/pnpm`
- `https://registry.npmjs.org/vitest`
- `https://registry.npmjs.org/typeorm` · `https://registry.npmjs.org/typeorm/1.1.1`
- `https://registry.npmjs.org/reflect-metadata`
- `https://registry.npmjs.org/tsup`
- `https://registry.npmjs.org/@nestjs%2Fcommon` · `@nestjs%2Fcore` · `@nestjs%2Fswagger` · `@nestjs%2Ftesting`
- `https://registry.npmjs.org/@automapper%2Fclasses/9.0.2` · `@automapper%2Fcore`
- `https://registry.npmjs.org/@typescript%2Ftypescript6` · `@typescript%2Fnative-preview`

**Tarballs downloaded and read directly**
- `@automapper/classes@9.0.2` → `transformer-plugin/index.mjs`
- `typeorm@1.1.1` → `metadata/*.d.ts`, `data-source/DataSource.d.ts`
- `@nestjs/swagger@12.0.1` → `dist/plugin/**`
- `@nx/js@23.2.0` → `executors.json`, `package.json`

**GitHub API**
- `https://api.github.com/repos/nartc/mapper` (archived: false, pushed 2026-08-08)
- `https://api.github.com/repos/nartc/mapper/issues/635` (PR "Chore/9.0 typescript 7", closed unmerged 2026-07-15)

**Web**
- <https://github.com/nestjs/nest-cli/issues/3479> — nest build under TS7, open since 2026-07-11
- <https://github.com/TypeStrong/ts-loader/issues/1702> — ts-loader TS7 support
- <https://github.com/typescript-eslint/typescript-eslint/issues/10940> — closed as not planned
- <https://kulshekhar.github.io/ts-jest/docs/next/guides/typescript-7> — official ts-jest TS7 guide
- <https://nx.dev/docs/kb/typescript-7> — Nx: use TS 7.0 alongside TS 6.0
- <https://nx.dev/docs/technologies/typescript/executors> — @nx/js executors
- <https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/> — TS 6.0, final JS-based release
- <https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html>
- <https://github.com/egoist/tsup> — "not actively maintained anymore… use tsdown instead"
- <https://vitest.dev/blog/vitest-5.html> — Vitest 5.0, 2026-09-03
- <https://fernforge.github.io/devnotes/nestjs-typescript-7/> — NestJS + TS7: what works, what doesn't
- <https://github.com/nrwl/nx/issues/36104> · <https://github.com/nrwl/nx/discussions/36329> — Nx + TS7
- <https://oxc.rs/blog/2026-07-22-type-aware-linting-stable> — oxlint/tsgolint as the TS7 type-aware lint path
- <https://github.com/nartc/mapper> · <https://automapperts.netlify.app/misc/transformer-plugin/>
