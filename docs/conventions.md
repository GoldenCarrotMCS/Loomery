# Conventions — testing, scripts, tooling, code style

> Part of the Loomery reference set. Read this before adding a test, a script, or a source file, so the new code
> matches what is already there.

---

## 1. Repo shape and commands

pnpm monorepo, `pnpm@11.10.0`, workspace globs `packages/*` and `apps/*`, `allowBuilds: { esbuild: true }`.

| Command | What it does |
| --- | --- |
| `pnpm install` | Install |
| `pnpm dev` | `pnpm --filter @loomery/web dev` → Vite on http://localhost:5173 |
| `pnpm build` | `pnpm -r build` (web: `tsc --noEmit && vite build`; core and api: `tsc --noEmit` only) |
| `pnpm test` | `pnpm -r test` — runs the suites in **all three** packages |
| `pnpm test:coverage` | `vitest run --coverage` for core → text report + `coverage/` HTML |
| `pnpm typecheck` | `pnpm -r typecheck` → `tsc --noEmit` in every package |
| `pnpm --filter @loomery/core test:watch` | `vitest` in watch mode |
| `pnpm --filter @loomery/api start` | `tsx src/server.ts`, `PORT` (3000) / `MAX_UPLOAD_BYTES` (512 MB) |

| Suite | Location | Runner |
| --- | --- | --- |
| Core conversion engine | `packages/core/test/*.test.ts` | `vitest run` (39 files) |
| API routes | `apps/api/test/server.test.ts` | `vitest run`, drives a real server on an ephemeral port |
| Web pure modules | `apps/web/test/*.test.ts` | `vitest run` (no DOM environment needed) |

Dependency graph: `core` (leaf) ← `web`, `core` ← `api`. Web and api do not depend on each other.

> **There is no build step producing JS.** `@loomery/core` publishes `main`/`types`/`exports` all pointing at
> `src/index.ts`; its `build` script is just `tsc --noEmit`. Consumers (Vite, tsx) compile the TypeScript source
> directly through the pnpm workspace link.

---

## 2. Testing

### How tests run

- Runner: Vitest. `packages/core/vitest.config.ts` exists **only** to configure the coverage provider — the suite
  otherwise runs on Vitest defaults, so `globals` is **off** and every file imports explicitly:
  `import { describe, expect, it } from "vitest";`. `apps/api` and `apps/web` have no config file at all.
- `packages/core/package.json` has `"type": "module"` and `scripts.test = "vitest run"`.
- CI (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test` on Node 22,
  where `pnpm test` now covers all three packages.
- `packages/core/tsconfig.json` includes both `src/**/*` and `test/**/*`, with `rootDir: "."` and `noEmit: true`.
  `apps/api/tsconfig.json` includes `test` alongside `src`.
- Coverage is available but **not enforced**: `pnpm test:coverage`. No thresholds, deliberately — coverage is a map of
  what is untested, not a gate.

### Layout and naming

- Tests live in `packages/core/test/*.test.ts` — a **flat** directory, no subfolders, one level below the package root.
- Sources live in `packages/core/src/**/*.ts`.
- File names are `<feature>.test.ts` in lowercase/camelCase matching a source concept (`items2d`, `bowPull`,
  `conditionPredicate`, `vanillaTextureMap`).
- Imports target source either through the barrel (`../src/index.js`) or by deep path (`../src/image/png.js`) when the
  module isn't re-exported from the barrel.
- `describe("x", () => { ... })` and `it("...", async () => { ... })` — plain function form, no `describe.only`.

### Test-file inventory

All paths relative to `packages/core/test/`.

| File | Covers |
| --- | --- |
| `accuracy.test.ts` | Regression suite for conversion-fidelity fixes: builtin vanilla parents, rescale baking, armor skins, range_dispatch priority, bounds, blockstate rotations, lang args, display names, missing sounds |
| `armor.test.ts` | Armor texture/attachable conversion; modern equipment assets; legacy layer textures |
| `atlas.test.ts` | `buildAtlas` grid packing — uniform sizes, mixed sizes, no overlap or clipping, single texture |
| `auxStages.test.ts` | Block flipbooks, sounds, lang, bitmap fonts (ascent, aspect ratio, ASCII-sheet protection), paintings |
| `blocks.test.ts` | Custom blocks → Geyser mappings v1, non-cube geometry, block-state registry key ordering, animated block textures |
| `bowPull.test.ts` | Bow-pull render controllers and attachables: vanilla, 2-stage, modern custom-model, mixed sprite/3D rejection, 3D per-stage geometry |
| `conditionPredicate.test.ts` | `has_component` conditions → Geyser predicates, enum-value validation, `select` canonical constants and ranking |
| `craftEngine.test.ts` | CraftEngine YAML/JSON: material, name, colour, cmd, model aliases, furniture variants, equippable |
| `datapack.test.ts` | Datapack loot tables / advancements / functions → host-item hints, overlay dirs, plural dirs, rank precedence |
| `definitionHost.test.ts` | `inferHostItemFromDefinition` unit tests via an in-memory `VirtualFs` + `JavaPack.open` |
| `encodePool.test.ts` | Parallel PNG encoder injection — byte-identity with the in-process path, threshold behaviour |
| `entityComposites.test.ts` | Chest entity composites (single rearrange, double stitch, pre-1.15 untouched) |
| `flipbook.test.ts` | Item flipbook animation atlases and time-indexed render controllers; frame caps |
| `geometryFlip.test.ts` | `buildGeometry` facing flip (crossbow) |
| `gui.test.ts` | GUI conversion end-to-end: nine-sliced panel + sidecar, un-sliced sprite reported `approximated`, vanilla sheet skipped with the structural reason, namespace filter, path budget |
| `hash.test.ts` | `fastHash`/`fastHashString`: determinism, pinned digest vectors, length sensitivity, view-window isolation, collision sweep |
| `iconRender.test.ts` | `renderModelIcon` isometric shading and `alphaBleed` |
| `items2d.test.ts` | The largest 2D suite: legacy cmd, modern definitions, conditions, host inference, tinting, animation |
| `items3d.test.ts` | 3D item geometry/attachable/animations/atlas/mapping; `texture_size` UV honouring |
| `itemsAdderPack.test.ts` | Real ItemsAdder pack quirks: invalid zlib checksums, atlas sprite aliases, fractional frametimes |
| `mergePacks.test.ts` | `mergeJavaPacks` union/conflict/deep-merge semantics, pack.mcmeta widening, malformed archives |
| `modelengine.test.ts` | `.bbmodel` → GeyserModelEngine bundle (mirrored cubes, UV passthrough, `binding_bones`, animation signs) |
| `nineSlice.test.ts` | Border detection: uniform and asymmetric panels, the one-third cap, flat-interior and gradient artwork rejected, sidecar shape |
| `optimize.test.ts` | Lossless optimizer: duplicate merge + reference rewrite, JSON minify, zopfli gating, `optimizePack: false` |
| `optionsFromHints.test.ts` | `optionsFromHints`: carries every hint field, marks the config provided, copies the zips rather than aliasing them |
| `oraxen.test.ts` | The largest file: Oraxen / ItemsAdder / Nexo / HMCCosmetics / oxywire hints, furniture YAML, equippable head detection |
| `packNaming.test.ts` *(apps/web)* | Archive-extension stripping and the `packName`/label/packNames derivations that feed manifest UUIDs |
| `report.test.ts` | `ConversionReport`: summary counting, absent-field behaviour, entry ordering, JSON round-trip |
| `selfcheck.test.ts` | **Structural end-to-end**: builds the real fixture, converts it, and validates the whole pack — manifest shape, every JSON parses, atlas entries resolve to files that exist, attachables reference emitted geometries, no reported errors, deterministic UUIDs |
| `server.test.ts` *(apps/api)* | API routes against a real server on an ephemeral port: health/info/usage, CORS preflight, query validation, empty-body rejection, `packName` sanitization |
| `timings.test.ts` | `Timings` aggregation and the `timeOp`/`timeOpAsync` sink, including the throwing and unarmed paths |
| `packPath.test.ts` | `fitPathName` and the `MAX_PACK_PATH` budget, including UUID-obfuscated model ids |
| `palettePng.test.ts` | Hand-built 4-bit indexed PNG decode (palette + tRNS) |
| `pipeline.test.ts` | `convertPack` end-to-end contract: manifest, renamed + passthrough textures, nested roots, deterministic UUIDs, loud failures, merging |
| `pngEncode.test.ts` | Indexed/grayscale/RGBA encoding, passthrough re-encode, texture-cache copy safety |
| `tar.test.ts` | `.tar.gz` ingest: gzip magic, plain tar, gzipped tar, end-to-end conversion |
| `tga.test.ts` | TGA encoder: BGRA channel order, inverted alpha, row order, round-trip |
| `vanillaModelItems.test.ts` | Plugin items whose `item_model` points at a vanilla model |
| `vanillaTextureMap.test.ts` | The rename tables: blocks, items, corrected wrong values, Loomery-only entries, non-block/item paths, TGA targets |
| `zipReader.test.ts` | Resilient zip reader: corrupted size fields, skip-bad-entry, ZIP64 |

### Fixture conventions

**There is no shared helper module and no fixtures directory.** Every test file re-declares its own locals, and the
same helpers are copy-pasted verbatim across files — that is the de-facto convention. Do not casually introduce a
`test/helpers.ts`; matching the local-declaration style is the path of least surprise.

The canonical zip builder (byte-identical in ~12 files):

```ts
function fixtureZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const tree: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    tree[path] = typeof content === "string" ? new TextEncoder().encode(content) : content;
  }
  return zipSync(tree);
}
```

Variants on the same idea with different names/shapes: `packZip(files: Record<string, string>)` (mergePacks),
`zip(files)` (vanillaModelItems), `configZip` / `datapackZip` (string-only), `packWith(definition, id = "demo:thing"):
JavaPack` (definitionHost), `manyModelsZip(count)` (encodePool), `protectedZip` + `toZip64` (zipReader),
`dupePackZip()` (optimize), `animatedSpriteZip()` (items2d), `buildTar` (tar), `palettePng()` (palettePng).

A PNG helper of the same shape recurs with per-file defaults:

```ts
function png(width = 16, height = 16, rgba = [255, 0, 0, 255]): Uint8Array   // uses encode from fast-png
```

Some files instead hardcode a `TINY_PNG` literal (a 1×1 transparent PNG, `pipeline.test.ts`).

**Two representative patterns, verbatim.**

End-to-end through the zip (`pipeline.test.ts`):

```ts
it("converts a minimal pack: manifest, renamed + passthrough textures", async () => {
  const zip = fixtureZip({
    "pack.mcmeta": JSON.stringify({ pack: { pack_format: 34, description: "Test pack" } }),
    "pack.png": TINY_PNG,
    "assets/minecraft/textures/block/oak_log.png": TINY_PNG,
    "assets/custom/textures/item/ruby.png": TINY_PNG,
  });

  const result = await convertPack(zip, { packName: "Test" });
  const out = readZip(result.mcpack);

  expect(out.has("manifest.json")).toBe(true);
  expect(out.has("textures/blocks/log_oak.png")).toBe(true);
  expect(result.report.summary.error).toBe(0);
  expect(result.report.summary.converted).toBeGreaterThanOrEqual(3);
```

Unit-level, bypassing the zip entirely (`definitionHost.test.ts`):

```ts
function packWith(definition: unknown, id = "demo:thing"): JavaPack {
  const vfs = new VirtualFs();
  const [ns, path] = id.split(":") as [string, string];
  vfs.writeText(`assets/${ns}/items/${path}.json`, JSON.stringify(definition));
  return JavaPack.open(vfs);
}
```

**Standard assertion vocabulary** (reuse these): `readZip(result.mcpack)` → `out.has(path)` / `out.readText(path)` /
`out.readBytes(path)`; `readZipDetailed(bytes).vfs` and `.entries()` for path-by-path inspection; `JSON.parse(...)` on
`manifest.json` or attachables;
`result.report.entries.some((e) => e.stage === "paintings" && e.status === "approximated")`;
`result.report.summary.error` / `.converted`; `result.timings.stages` (checked for `"packaging"` and `"zip.write"`).
Failure cases use `await expect(convertPack(...)).rejects.toThrow("...")`.

Options passed to `convertPack` in tests: `packName`, `packNames`, `optimizePack: false`, `animate2dHeldItems`,
`maxCompression`, frame caps.

**Fixtures.** `packages/core/scripts/make-fixture.mjs` builds a feature-complete sample pack used by
`test/selfcheck.test.ts` (invoked via `execFileSync`, written to a temp dir and deleted). `make-bench-pack.mjs` builds a
perf pack for the benchmarks. Both can also be run by hand:

```bash
node scripts/make-fixture.mjs out.zip                       # from packages/core
node --import tsx scripts/bench-convert.mts out.zip 3
```

There are no committed `.zip` / `.tar.gz` fixtures — `.gitignore` excludes `*.zip`, `*.tar.gz`, `*.tgz` and
`java2bedrockclient.zip`.

### Coverage: well covered vs gaps

**Well covered:** end-to-end `convertPack`; **whole-pack structural validity** (`selfcheck.test.ts` — manifest shape,
every generated JSON parses, atlas entries resolve, attachables reference real geometries); merging semantics (15 cases
incl. conflict reporting and malformed archives); zip/tar resilience and ZIP64; the whole PNG codec matrix; TGA byte
layout; atlas packing; the full vanilla rename table; plugin hint extraction (Oraxen/CraftEngine/ItemsAdder/Nexo/
HMCCosmetics/oxywire); datapack host-item binding; 2D/3D item mappings and Geyser condition predicates; bow-pull;
flipbooks; fonts; sounds; lang; paintings; armor; entity composites; optimizer behaviour; `fastHash`; manifest
generation; `.bbmodel` geometry/animation conversion; the display-animation slot table; report and timing aggregation;
the API's routes and validation; the web app's pack-naming rules.

**Untested (concrete gaps):**

- `src/image/zopfliPng.ts` — exercised only indirectly through `maxCompression`; the `@gfx/zopfli` module itself is
  never unit-tested.
- `src/java/json.ts` — no direct test of the JSONC/comment stripping, only through downstream config tests.
- `src/java/mcmeta.ts` — covered only through flipbook/ItemsAdder assertions; no direct unit test of unusual
  frametime/`interpolate` combinations.
- `src/modelengine/bbmodel.ts` (`extractTextures`, `base64Decode`) and `modelEngineInput.ts` — covered indirectly via
  one end-to-end test; the base64 padding quirk is not asserted.
- `src/io/vfs.ts` — no dedicated test (only used as scaffolding).
- `src/convert/stages/*` — no stage is unit-tested in isolation; all 14 are covered only through `convertPack`.
- **React components have no tests.** `packNaming.ts` is extracted and tested precisely because it holds the logic
  worth testing; the components themselves are not rendered in any test.
- **No worker-pool test with a real `Worker`.** `encodePool.test.ts` injects a fake `PngEncoder`; the pool's dispatch,
  timeout-fallback and `dispose()` paths are not exercised.

---

## 3. Scripts

All under `packages/core/scripts/`. `.mts` files are run with `tsx` (`apps/api` depends on `tsx@^4.19.0`); each `.mts`
header comment says `Usage: node <tsx> scripts/<name>.mts`. Run from the package root. **None are exposed as npm
scripts.**

| Script | Purpose | Invocation | Output |
| --- | --- | --- | --- |
| `make-fixture.mjs` | Builds a small but feature-complete Java pack for manual testing: vanilla retextures, legacy cmd 2D + 3D items, a modern `items/` definition, modern equipment armor + helmet, a flipbook (`magma.png` + `.mcmeta`), `sounds.json` + `.ogg`, `lang/en_us.json`, `pack.png`, `pack.mcmeta` (`pack_format: 34`) | `node scripts/make-fixture.mjs <output.zip>` (default `fixture-pack.zip`) | Writes the zip; logs `wrote <out>` |
| `make-bench-pack.mjs` | Scales up the paths a real pack spends time in — 3D geometry conversion (atlas stitch + alpha bleed + PNG encode per frame) and legacy cmd variant extraction | `node scripts/make-bench-pack.mjs <output.zip> [staticModels] [animModels] [framesPerStrip]` (defaults 60, 40, 16) | Zip with N static + M animated 3D cube overrides on `minecraft:item/stick` |
| `bench-convert.mts` | Times N in-process `convertPack` runs and fingerprints output content, so a hot-path change can be shown "same bytes, less time". Excludes wall-clock-derived entries (`manifest.json` is the `VOLATILE` set — fflate zip timestamps + clock-derived manifest version make a raw .mcpack hash useless) | `npx tsx scripts/bench-convert.mts <pack.zip> [iterations]` (default 3) | iterations; median/best/all ms; `mcpack bytes`; content digest (sha256[:16] of sorted `path hash` lines); a `WARNING: digest is not stable across runs` line if runs disagree; top-8 `stages` by ms; top-10 `ops` by `totalMs` |
| `bench-hash.mts` | Compares `fastHash` implementations over atlas-sized buffers: shipped byte-wise 2-lane vs two word-wise variants | `npx tsx scripts/bench-hash.mts [buffers] [width] [height]` (defaults 2700, 96, 32) | Per-impl ms and MiB/s; **throws** `Error("<name> is not deterministic")` or `Error("<name> collided: n/N")` |
| `bench-indexed.mts` | Micro-benchmark for the indexed PNG encode path, separating colour-counting/mapping cost from the deflate call | `npx tsx scripts/bench-indexed.mts [width] [height] [pixels]` (defaults 96, 32, 964) | `encodeIndexedPng total`, `zlibSync(level 9) alone`, non-deflate remainder |
| `bench-png.mts` | Measures two tuning decisions for the indexed encoder: deflate level (4/6/9) over real palette-index scanlines, and `fastHash` over atlas pixel data | `npx tsx scripts/bench-png.mts [images] [width] [height]` (defaults 964, 96, 32) | Deflate-level table with `+x% vs level 9` deltas; `fastHash` ms |
| `analyze-profile.mjs` | Aggregates a V8 `.cpuprofile` into self-time by function so a hot path is identified from data instead of guessed at | `node scripts/analyze-profile.mjs <file.cpuprofile> [topN]` (default 25) | `total sampled: Nms` then `  <ms>  <%>  <functionName>  @ <file basename>:<line>`, hottest first |

Other scripts in the same directory (not documented above): `convert-file.mts`, `debug-model.mts`, `dump-fonts.mts`,
`extract-file.mts`, `extract-icons.mts`, `extract-many.mts`, `find-display.mts`, `grep-refs.mts`, `inspect-zip.mts`,
`render-variants.mts`, `repro-icon.mts`, `tex-sizes.mts`, `validate-mcpack.mts`.

---

## 4. TypeScript and tooling

`tsconfig.base.json` is the only shared base; `packages/core`, `apps/web` and `apps/api` all extend it:

```json
{ "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "lib": ["ES2022"],
  "strict": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true, "forceConsistentCasingInFileNames": true,
  "esModuleInterop": true, "skipLibCheck": true, "resolveJsonModule": true, "isolatedModules": true }
```

Per-package deltas: core `rootDir: "."`, `noEmit: true`, includes `src/**/*` + `test/**/*`; web adds
`DOM`/`DOM.Iterable`/`WebWorker` libs, `jsx: react-jsx`, `types: ["vite/client"]`; api adds `types: ["node"]` (the only
package with `@types/node`).

Two flags are **load-bearing** and explain a lot of the code's appearance:

- **`noUncheckedIndexedAccess`** — why the source and tests are full of `!` on index reads (`bytes[12]!`,
  `buffers[0]!`) and `?? 0` guards. New code must satisfy this or it won't typecheck.
- **`noFallthroughCasesInSwitch`** — why `faceCorners` in `modelRender.ts` relies on exhaustive `switch` returns with
  no `default`.

### ESM import rules

**Relative imports always carry a `.js` extension, and it is universal.** Every relative import in `src/` and `test/`
uses it (`from "./convert/pipeline.js"`, `from "../src/image/png.js"`). A scan finds **zero** extensionless and
**zero** `.ts`-suffixed relative imports. This is despite `moduleResolution: "bundler"` tolerating extensionless — treat
`.js`-even-though-it's-`.ts` as a hard house rule.

Bare/package imports have no extension: `"fflate"`, `"fast-png"`, `"js-yaml"`, `"@noble/hashes"`, `"vitest"`.

`isolatedModules: true` means type-only re-exports must use `export type { ... }` / `import type { ... }`.

### Path aliases

**None.** No `paths` aliases and no `baseUrl` anywhere. Cross-package imports use the workspace name `@loomery/core`;
within a package, relative `.js` imports. Cross-cutting types are pulled in by literal relative path instead of an
alias — both apps set `"include": ["src", "../../packages/core/src/types"]`.

### Lint / format

**None present.** No `.eslintrc*`, no `eslint.config.*`, no `.prettierrc*`, no `.editorconfig`, no `lint` script in any
package.json, and CI runs only typecheck + test. Formatting is enforced by convention, not tooling: ≈100-character
lines, 2-space indent, double quotes, trailing commas, semicolons.

---

## 5. Code style

**Naming.** camelCase file names (`itemsStage.ts`, `vanillaTextureMap.ts`, `modelEngineInput.ts`); PascalCase for
exported classes (`VirtualFs`, `JavaPack`, `ConversionReport`, `Timings`); camelCase for functions and locals.

Verb-first function names that say what they produce: `convertPack`, `buildAtlas`, `buildManifest`, `buildGeometry`,
`buildBowPullRenderController`, `inferHostItemFromDefinition`, `mergeJavaPacks`, `parseDatapack`, `remapVanillaTexture`,
`fitPathName`, `encodeIndexedPng`, `alphaBleed`. Booleans read as predicates (`isDatapack`, `isGzip`, `has`, `animated`).
Stage modules all end in `Stage.ts` and are named after the pipeline stage (`blocksStage`, `soundsStage`).

**Barrel.** `src/index.ts` is the public surface, a hand-curated list mixing value and `type` exports in one statement
(`export { convertPack, type ConvertResult } from "./convert/pipeline.js";`). Internals not needed by the apps
(`definitionHost`, `hash`, `atlas`, `tga`, …) are deliberately **not** re-exported — tests import those by deep path.

**Comments are *why*, not *what*.** The dominant style is a block comment above a helper explaining the failure mode
being defended against, usually referencing the concrete real-world case. Scripts open with a multi-line rationale plus
a `Usage:` line. Test names are full assertive sentences in lowercase with punctuation, often enshrining the bug that
was fixed:

- `"plays multi-strip items at correct per-texture speeds (no 2x bug)"`
- `"drops a partial key rather than emitting a state Geyser would reject"`
- `"never replaces Bedrock's ASCII sheet to honour a few decorative overrides"`
- `"hands mutating callers a private copy, not the shared decode"`

**Error handling — a deliberate split:**

- **Throw** for programmer/unrecoverable errors at API boundaries. `convertPack` rejects with a message-bearing
  `Error` ("fails loudly on an upload it cannot read, instead of shipping an empty pack"), and tests assert
  `await expect(convertPack(...)).rejects.toThrow(...)`. Scripts do the same on a failed invariant
  (`bench-hash.mts`).
- **Report, don't throw** for recoverable per-item problems: they become `ReportEntry` records with a `stage` and a
  `ConversionStatus` and roll up into `report.summary`. A stage that throws is caught by the pipeline loop, recorded as
  `error(stage.name, "(stage)", …)`, and conversion continues.
- Guard clauses with early `return`/`continue` and no `else` are the norm.

**Defensive parsing.** JSON/config readers tolerate the messy reality of real packs — bare and namespaced spellings,
pre-1.21 plural directories, version overlays, corrupt zip size fields, invalid PNG zlib checksums, fractional mcmeta
frametimes — and **every one of those tolerances has a test**. When adding a tolerance, add the test.

**Performance.** Nothing is changed on a hunch — every tuning decision has a script and a rationale comment (deflate
level, `fastHash` shape, the geometry-stage hot path), and `bench-convert.mts`'s deterministic content digest exists
specifically to make "same bytes, faster" claims verifiable.

---

## 6. Adding code: a checklist

1. **New stage?** Add it to `STAGES` in `convert/pipeline.ts`, give it a `name` that doubles as its report/`progress`
   label, and check the ordering section in
   [reference/pipeline-and-stages.md](reference/pipeline-and-stages.md#14-stage-order-and-why-it-is-forced) before
   deciding where it goes. Stages that write into `itemTextures`/`terrainTextures` must run before `packaging`; stages
   that read the finished pack must run after it.
2. **New output path?** Route it through `fitPathName`/`fitFilePath` with an explicit `reserved` budget — Bedrock
   warns at 80 characters (`MAX_PACK_PATH = 79`).
3. **New shared state?** Add the field to `ConversionContext` in `context.ts` with a doc comment saying which stage
   writes it and which reads it.
4. **Reading a texture you will mutate?** Use `decodeCachedForEdit` (or clone), never `decodeCached`. If you are
   changing a function whose output addresses generated pack paths (`fastHash`, `fitPathName`, `safeName`), expect to
   update pinned test vectors — `test/hash.test.ts` is the model for that.
5. **Reading a pack JSON you will re-serialise?** Use `parseStrictJson`. Read-only uses `parseLenientJson`.
6. **New option?** Add it to `ConvertOptions`, give it a default in `DEFAULT_OPTIONS`, coalesce it in the `opts` object
   inside `convertPack`, and thread it through the web worker (`apps/web/src/worker/convert.worker.ts`) and the API
   (`apps/api/src/server.ts`) if it should be user-settable. **If it comes from plugin-config hints, add it to
   `optionsFromHints` instead** (`packages/core/src/convert/optionsFromHints.ts`) — both callers use that helper, and
   hand-merging the fields is exactly how `furnitureTransforms` went missing on the API path once already.
7. **New test?** Put it in `packages/core/test/<feature>.test.ts`, declare the helpers locally, and name the `it` as an
   assertive sentence describing the behaviour you just fixed.
8. **New emitted artifact?** Add it to `ConvertResult`, then to `ResultView.tsx`'s download matrix and `apps/api`'s
   bundle — and remember `apps/api` currently drops `modelEngineInput`.
