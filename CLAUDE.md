# CLAUDE.md

Loomery — a **Java Edition → Bedrock Edition Minecraft resource pack converter**. Upload a Java `.zip` in the browser
(or POST it to the HTTP API) and get back a Bedrock `.mcpack` plus Geyser mapping files.

**Before you read any source, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).** It explains the whole flow in a few
minutes and links into the reference set. The reference docs exist so you don't have to open fourteen stage files to
change one of them.

---

## Commands

```bash
pnpm install
pnpm dev             # web UI on http://localhost:5173
pnpm test            # all three packages (core: 39 files incl. a structural end-to-end check)
pnpm test:coverage   # core coverage report (not enforced)
pnpm typecheck       # tsc --noEmit across all three packages
pnpm build           # production web build (apps/web/dist); core emits nothing

pnpm --filter @loomery/core test:watch
pnpm --filter @loomery/api start        # HTTP API, PORT=3000
```

CI (`.github/workflows/ci.yml`) runs `typecheck` + `test` on every push and PR; deploy publishes `apps/web/dist` to
`gh-pages`. A red test blocks the deploy.---

## Layout

```
packages/core/src/
  io/         VirtualFs + resilient zip reader/writer + tar.gz
  java/       JavaPack, model types, item definitions, plugin config parsers
  resolve/    model parent-chain resolution, host-item inference
  bedrock/    geometry, attachable, animations, armor, manifest emitters
  convert/    convertPack + 15 pipeline stages  ← start here
  image/      PNG codec, atlas packer, icon renderer, TGA, zopfli
  modelengine/  .bbmodel → GeyserModelEngine input bundle
  data/       vanilla rename tables (textures 810+405+580 entries, sounds 1303) + builtin models
  report/     ConversionReport, Timings
  util/       path budgeting, content hashing
packages/core/test/    31 flat vitest files, no shared helpers
packages/core/scripts/ fixture builders, benchmarks, cpuprofile analyzer
apps/web/              Vite + React, conversion in Web Workers (comlink)
apps/api/              node:http server (no framework)
```

Dependency graph: `core` ← `web`, `core` ← `api`. **Core has no build step** — `main`/`types`/`exports` point at
`src/index.ts` and Vite/tsx compile the TS directly.

---

## The one thing to understand

`convertPack(zipBytes, options, progress)` in `packages/core/src/convert/pipeline.ts` merges any uploaded packs into one
`VirtualFs`, then runs **15 stages in a fixed order** over a shared mutable `ConversionContext`:

```
textures → entity-composites → items → bow-pull → items-3d → armor → blocks
        → flipbooks → sounds → lang → fonts → gui → paintings → packaging → optimize
```

The order is load-bearing (data dependencies, not preference). Before moving or adding a stage, read
[docs/reference/pipeline-and-stages.md §1.4](docs/reference/pipeline-and-stages.md).

Failure model: **pre-flight checks throw** (nothing readable / not a pack), everything else is **reported**, not thrown
— a stage that throws is caught, recorded as `error(stage.name, "(stage)", …)`, and the pipeline continues. Anything
not converted must leave a `ReportEntry` with a reason.

---

## House rules (these will bite you)

1. **Relative imports always end in `.js`** even though the files are `.ts` (`from "./convert/pipeline.js"`). Universal
   in this repo. No exceptions, no extensionless imports.
2. **`noUncheckedIndexedAccess` is on** — index reads need `!` or `?? 0`. This is why the codebase is full of `!`.
3. **`decodeCached` returns a SHARED image.** Anything that tints, bleeds, blends, blits or rotates must use
   `decodeCachedForEdit` (or `cloneImage`) first.
4. **`JavaPack.readJson` is memoized and shared.** Treat the returned object as immutable.
5. **Read-only parses use `parseLenientJson`; anything you re-serialise uses `parseStrictJson`.** The lenient parser
   salvages truncated JSON, and salvaging into a rewrite silently promotes garbage to content.
6. **Every generated pack path goes through `fitPathName`/`fitFilePath`** with an explicit reserved budget —
   `MAX_PACK_PATH = 79` (Bedrock warns at 80).
7. **Never trust a length from an untrusted archive.** Zip entries are inflated without using `uncompressedSize`.
8. **Terminate your workers.** Both web pools have `dispose()`; `App.tsx` terminates the conversion worker on unmount.
   Worker leaks have been fixed twice here.
9. **`safeName` lives in `itemsStage.ts`** and is imported by four other stages — changing it renames files everywhere.
10. **`buildDefinition` (itemsStage) is the single choke point** for `geyserMappings.items`,
    `usedBedrockIdentifiers` and `displayEntityMappings`. `geometryStage` calls it too.
11. **Stage names double as report keys and progress labels**, and they are not always the pipeline's idea of the stage:
    `items` also emits `"items-hints"`, and `pipeline.ts` adds `"ingest"`, `"merge"`, `"furniture"`, `"config-nudge"`,
    `"modelengine"`.
12. **Config-zip hints go through `optionsFromHints(hints, configZips)`** (`convert/optionsFromHints.ts`). It is the
    single implementation shared by `apps/web/src/worker/convert.worker.ts` and `apps/api/src/server.ts` — the two once
    drifted by hand-merging these fields, which silently disabled furniture scale correction on the API path. If you add
    a hint field, add it there (and to `test/optionsFromHints.test.ts`, which asserts the full set).
    `apps/api` still has no worker pools, so its PNG work is single-threaded.

---

## Tests

- `packages/core/test/*.test.ts`, flat, one file per feature. Vitest with **no config file**, so `globals` is off —
  import `{ describe, expect, it }` explicitly.
- **There is no shared helper module.** The canonical `fixtureZip(files)` builder is copy-pasted verbatim across ~12
  files. Match that style rather than introducing `test/helpers.ts`.
- Standard pattern: build a zip in memory → `await convertPack(zip, { packName })` → `readZip(result.mcpack)` → assert
  on `out.has(path)` / parsed JSON → assert on `result.report.summary`.
- Failure cases: `await expect(convertPack(...)).rejects.toThrow("...")`.
- Test names are assertive lowercase sentences that often enshrine the bug fixed
  ("plays multi-strip items at correct per-texture speeds (no 2x bug)").
- Apps have **no tests** at all.

---

## Comments and style

The dominant comment style is **why, not what** — most non-obvious blocks name the real-world case that forced them
(an Oraxen pack with lying zip sizes, ItemsAdder's invalid PNG checksums, Nexo's UUID model ids). **Preserve those
comments when editing**; they are the only record of why the code is shaped that way.

Style: camelCase files, PascalCase classes, verb-first function names (`buildGeometry`, `inferHostItemFromModel`),
≈100-char lines, 2-space indent, double quotes, trailing commas, semicolons. No linter or formatter is configured —
match the surrounding code.

---

## Docs map

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The full picture: flow, stages, key abstractions, principles |
| [docs/reference/pipeline-and-stages.md](docs/reference/pipeline-and-stages.md) | Every stage's inputs, outputs, output paths, report strings, constants; `ConvertOptions`/`ConversionContext` field by field |
| [docs/reference/io-and-java.md](docs/reference/io-and-java.md) | VirtualFs, zip/tar readers, JSONC parsing, JavaPack, variant extraction, plugin config parsers, datapacks, path budgeting, hashing |
| [docs/reference/bedrock-emitters.md](docs/reference/bedrock-emitters.md) | Coordinate/UV math, the bone rig, attachables, display animations, armor, manifest, the resolver, `.bbmodel` conversion |
| [docs/reference/image-and-apps.md](docs/reference/image-and-apps.md) | PNG codec, atlas, icon renderer, report/timings, the vanilla tables, the React app, the worker pools, the API |
| [docs/conventions.md](docs/conventions.md) | Testing, scripts, tsconfig, ESM rules, style, and a checklist for adding code |
| [docs/suggestions.md](docs/suggestions.md) | Proposed features and improvements, with rationale and rough cost |
