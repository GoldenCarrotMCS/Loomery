# Loomery — Architecture

> **New here?** Read [CLAUDE.md](../CLAUDE.md) first (the 60-second orientation). This document is the full picture
> of how a pack flows through the system.
>
> Reference set: [pipeline-and-stages.md](reference/pipeline-and-stages.md) ·
> [io-and-java.md](reference/io-and-java.md) · [bedrock-emitters.md](reference/bedrock-emitters.md) ·
> [image-and-apps.md](reference/image-and-apps.md) · [conventions.md](conventions.md) ·
> [suggestions.md](suggestions.md)

---

## 1. What Loomery is

A **Java Edition → Bedrock Edition resource pack converter**. You upload a Java `.zip` and get back:

| Artifact | What it is |
| --- | --- |
| `<pack>.mcpack` | A Bedrock resource pack (a zip) |
| `geyser_mappings.json` | Geyser Custom Item API **v2** mappings (`format_version: 2`) |
| `geyser_blocks.json` | Geyser custom-block mappings (`format_version: 1`) |
| `geyser_displayentity_mappings.yml` | GeyserDisplayEntity extension mappings for furniture |
| `geyserdisplayentity_config.yml` | Companion `config.yml` that seats furniture on the floor |
| `modelengine_input.zip` | `input/<model>/` folders for the GeyserModelEngine extension |
| `conversion_report.json` | Per-asset status: converted / approximated / skipped / error, with reasons and timings |

The point of the whole design: a Bedrock client cannot be sent a Java pack, and a server cannot be sent a *stack* of
resource packs, so Loomery resolves names, geometry, coordinates, IDs and animation semantics and emits one Bedrock
pack plus the mapping files that tell Geyser how to make server-side custom items look right.

Three ways to run it, all sharing the same engine:

- **Web** (`apps/web`) — Vite + React. Conversion runs in Web Workers; files never leave the browser. Static-hostable.
- **HTTP API** (`apps/api`) — a small `node:http` server for automation.
- **Core library** (`packages/core`) — `convertPack()` is the single entry point, environment-agnostic (no Node or
  browser APIs; only `Uint8Array` in, `Uint8Array` out).

---

## 2. Repo layout

```
loomery/
├── packages/core/                 # the conversion engine — the only package with tests
│   ├── src/
│   │   ├── io/                    # VirtualFs, resilient zip reader, zip writer, tar.gz reader
│   │   ├── java/                  # Java pack parsing: JavaPack, models, item definitions, plugin configs
│   │   ├── resolve/               # model parent-chain resolution + host-item inference
│   │   ├── bedrock/               # Bedrock emitters: geometry, attachables, animations, armor, manifest
│   │   ├── convert/               # convertPack + the 15 pipeline stages
│   │   ├── image/                 # PNG codec, atlas packer, isometric icon renderer, TGA, zopfli
│   │   ├── modelengine/           # .bbmodel → GeyserModelEngine input bundle
│   │   ├── data/                  # vanilla rename tables (textures, sounds) + builtin model library
│   │   ├── report/                # ConversionReport + Timings
│   │   └── util/                  # path budgeting, content hashing
│   ├── test/                      # 31 flat vitest files
│   └── scripts/                   # fixture builders, benchmarks, profiler
├── apps/web/                      # Vite + React UI, worker pools
└── apps/api/                      # node:http server
```

Dependency graph: `core` ← `web`, `core` ← `api`. Web and api do not depend on each other.
**Core has no build step** — `main`/`types`/`exports` point at `src/index.ts` and consumers compile the TS directly.

---

## 3. End-to-end flow

```
  File[] / HTTP body
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ convertPack(zipBytes, options, progress)        convert/pipeline.ts  │
│                                                                      │
│  0. mergeJavaPacks(inputs)      — N Java packs → one VirtualFs       │
│     └── fails loudly if nothing readable                             │
│  1. JavaPack.open(mergedVfs)    — find pack root, index namespaces   │
│  2. build the ConversionContext (shared mutable state, see §4)       │
│  3. run the 15 stages in a fixed order, timing each                  │
│  4. post-steps: pendingGeometry check, furniture/modelengine report  │
│  5. writeZip(ctx.bedrock) → .mcpack                                  │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
  ConvertResult { mcpack, geyserMappings, geyserBlockMappings,
                  displayEntityMappings, displayEntityConfig,
                  modelEngineInput, report, timings }
```

### The 15 stages

```
textures → entity-composites → items → bow-pull → items-3d → armor → blocks
        → flipbooks → sounds → lang → fonts → gui → paintings → packaging → optimize
```

Each stage is `{ name: string; run(ctx): void | Promise<void> }`. Stage names double as progress labels and as
`ReportEntry.stage` values.

| # | Stage | Reads | Writes into the context |
| --- | --- | --- | --- |
| 1 | `textures` | every `assets/**/*.png` | `ctx.bedrock` (vanilla remaps) |
| 2 | `entity-composites` | `textures/entity/chest/*` **from `ctx.bedrock`** | `ctx.bedrock` |
| 3 | `items` | pack, options, caches | `bowPullGroups`, `pendingGeometry`, `itemTextures`, `geyserMappings.items`, `definitionTextures`, `usedBedrockIdentifiers`, `fallbackBaseItemHits`, `displayEntityMappings` |
| 4 | `bow-pull` | `bowPullGroups` | `geyserMappings.items`, `itemTextures`, `definitionTextures` |
| 5 | `items-3d` | `pendingGeometry` | geyser mappings, `itemTextures`, `geometryHandledTextures`, `displayEntityMappings`; **drains `pendingGeometry`** |
| 6 | `armor` | geyser mappings, `definitionTextures` | mutates `def.components["minecraft:equippable"]` |
| 7 | `blocks` | blockstates, models | `geyserBlocks`, `terrainTextures` |
| 8 | `flipbooks` | `.png.mcmeta`, `terrainTextures`, `geometryHandledTextures` | `textures/flipbook_textures.json` |
| 9 | `sounds` | `sounds/**/*.ogg`, `sounds.json` | `.ogg` copies, `sounds/sound_definitions.json` |
| 10 | `lang` | `lang/*.json` | `texts/*.lang`, `texts/languages.json` |
| 11 | `fonts` | `font/*.json`, provider textures | `font/glyph_XX.png` |
| 12 | `paintings` | `textures/painting/*.png` | `textures/painting/kz.png` |
| 13 | `packaging` | `itemTextures`, `terrainTextures` | `manifest.json`, `pack_icon.png`, `item_texture.json`, `terrain_texture.json` |
| 14 | `optimize` | the whole Bedrock VFS | rewrites `ctx.bedrock` in place |

**Why the order is forced** (the full version is in
[reference/pipeline-and-stages.md §1.4](reference/pipeline-and-stages.md#14-stage-order-and-why-it-is-forced)):

1. `textures` must run first so `entity-composites` can read chest textures **back out of the Bedrock VFS**.
2. `items` writes `bowPullGroups` → `bow-pull` consumes it.
3. `items` pushes `pendingGeometry` → `items-3d` drains it. A survivor is reported as an *internal error*.
4. `items`/`items-3d` populate the mappings that `armor` matches against and mutates.
5. `blocks` fills `terrainTextures` → `flipbooks` resolves `atlas_tile` against it via `terrainTextureKey`.
6. `items-3d` fills `geometryHandledTextures` → `flipbooks` uses it to suppress false "skipped" reports.
7. `packaging` must follow every producer of `itemTextures`/`terrainTextures`.
8. `optimize` must be last — its dead-file sweep reads every `.json` in the finished pack.

### Failure model

Two different things, deliberately:

- **Hard throw** — only the pre-flight checks: nothing readable, no files, or an upload that is neither a pack nor
  contains one. These reject `convertPack` with a message that names the likely user mistake.
- **Reported, not thrown** — everything else. A stage that throws is caught by the pipeline loop, recorded as
  `error(stage.name, "(stage)", message)`, and **conversion continues to the next stage**. Per-asset problems become
  `ReportEntry`s with a status of `converted` / `approximated` / `skipped` / `error` plus a human-readable reason.

The report is a first-class product, not a log: it is what the UI's report table, the config-nudge banner, and the
`conversion_report.json` download are built from.

---

## 4. Key abstractions

### `VirtualFs` (`io/vfs.ts`)

A `Map<string, Uint8Array>` with normalization (backslashes → forward slashes, leading slashes stripped; no case
folding). Both the parsed Java pack and the pack under construction are `VirtualFs` instances, which is what keeps core
free of filesystem APIs. Constructed as `new VirtualFs(opts.optimizePack)` for the output, so `optimizePack: true`
minifies every JSON write from the start.

### `JavaPack` (`java/javaPack.ts`)

An indexed, memoized view over a Java pack: finds the pack root (including packs nested one directory deep), lists
namespaces, and resolves asset paths with the ItemsAdder atlas-alias fallback. `readJson` is memoized and **shared** —
callers must treat results as immutable. `findPackRoot` is shared with `mergeJavaPacks`, so a change there affects both.

### `ConversionContext` (`convert/context.ts`)

The mutable state threaded through all stages: the two VFSs, options, report, timings, progress, the accumulators
(`itemTextures`, `terrainTextures`, `geyserMappings`, `geyserBlocks`, `pendingGeometry`, `displayEntityMappings`), and
four memo caches (`textureCache`, `inferredHostItems`, `definitionHostItems`, `resolvedModels`). Every field's role is
tabulated in [reference/pipeline-and-stages.md §1.2](reference/pipeline-and-stages.md#12-conversioncontext--every-field).

### `resolveModel` (`resolve/modelResolver.ts`)

Walks a model's `parent` chain (cap 32), merges textures/elements/display child-first, resolves `#texture` variables,
and classifies the result as `sprite` / `sprite_handheld` / `geometry` / `builtin_entity` / `unknown`. The
classification is what routes a variant to the 2D icon path, the 3D geometry path, or a skip. `BUILTIN_MODELS` supplies
vanilla parents a pack references without shipping.

### The "host item" problem

A custom item in Java is invisible on Bedrock unless Geyser knows which **vanilla item** it replaces. Loomery resolves
this in a strict escalation, first hit wins:

1. `variant.baseItem` — the pack itself (legacy `custom_model_data` on a `minecraft:` model).
2. Plugin config hints (`baseItemHints`) — parsed from Oraxen/Nexo/ItemsAdder/CraftEngine zips.
3. `inferHostItemFromModel` — walk the model's parent chain to a specific vanilla item model.
4. `inferHostItemFromDefinition` — what the 1.21.4+ item definition *dispatches on* (a `charge_type` branch can only
   be a crossbow).
5. `options.modernBaseItem` (default `minecraft:paper`) — the blunt fallback, reported as `approximated` and counted in
   `fallbackBaseItemHits`.

Two or more hits at step 5 with no config zip provided triggers the **config-nudge** banner in the UI.

### Emitters (`bedrock/`)

- `geometry.ts` — Java elements → Bedrock cubes on a fixed four-bone chain (`geysercmd` → `_x` → `_y` → `_z`),
  remapping per-face UVs out of Java texture space into atlas tile pixel space. X is mirrored (`8 - to.x`), Z is
  offset by −8, rotation angles are negated, `rescale` is baked into vertices.
- `animations.ts` — Java `display` transforms → five per-slot animations on that same rig, using Bedrock's own base
  poses plus a per-slot `valueScale`.
- `attachable.ts` / `armor.ts` / `manifest.ts` — attachables, armor templates, and the manifest with
  pack-name-derived deterministic UUIDs and a seconds-resolution version (so a re-convert is an *update*, not a new
  pack).

The single most important invariant: the four bone names are defined in `geometry.ts` and imported by `animations.ts`,
so the rig and the animations cannot drift apart.

### Workers (`apps/web/src/worker/`)

- `convert.worker.ts` — the root comlink worker; parses config zips, builds pools, calls `convertPack`.
- `encodePool.ts` — a lazy `PngEncoder` pool fanned across `clamp(cores - 1, 1, 8)` workers. A job that returns
  `undefined` or times out (30 s) falls back to in-process encoding.
- `zopfliPool.ts` — an eager `PngRecompressor` pool (oxipng in the browser, despite the name). On timeout (12 s) the
  worker is terminated, the original PNG is kept, and the slot is respawned.

Both pools are `dispose()`d in a `finally`, and `App.tsx` terminates the conversion worker on unmount — the codebase has
fixed worker leaks before. Pools use plain `postMessage` with no `SharedArrayBuffer`, deliberately, so the build works
on static hosts that cannot set COOP/COEP headers.

---

## 5. Design principles the codebase follows

1. **Report, don't silently drop.** Anything not converted gets a `ReportEntry` with a reason. Report strings are
   written for the pack author, not for a log reader — they name the file and say what to do about it.
2. **Fail loudly at the boundary, tolerate mess inside.** Pre-flight checks throw with actionable messages; every
   parser tolerates real-world damage (corrupt zip sizes, invalid PNG checksums, fractional frametimes, bare vs
   namespaced keys) and every tolerance has a test.
3. **Never allocate from an untrusted length.** Zip entries are inflated without trusting `uncompressedSize` (Oraxen
   writes `0xFFFFFFFF` everywhere, which would mean a 4 GB allocation).
4. **Determinism matters.** Manifest UUIDs are derived from the pack name, and generated pack paths are stable across
   platforms (`fastHash` is explicitly little-endian). The same input produces the same output.
5. **Lossless by default, opt-in for slower/bigger wins.** `optimizePack` never changes what the client renders;
   `maxCompression` (zopfli/oxipng) is opt-in because it is orders of magnitude slower.
6. **Every performance claim is measured.** Scripts under `packages/core/scripts/`, plus `Timings` with hot-op
   categories surfaced in the UI's performance panel.
7. **Comments explain the bug, not the code.** Most non-obvious blocks in this repo carry a comment naming the
   real-world case that forced them. Preserve those comments when editing.

---

## 6. Where to look next

| You want to… | Read |
| --- | --- |
| Understand what a specific stage does | [reference/pipeline-and-stages.md](reference/pipeline-and-stages.md) |
| Change zip/parsing/VirtualFs/config-hint code | [reference/io-and-java.md](reference/io-and-java.md) |
| Change geometry, attachables, animations, or the resolver | [reference/bedrock-emitters.md](reference/bedrock-emitters.md) |
| Change PNG handling, the tables, the UI, or the API | [reference/image-and-apps.md](reference/image-and-apps.md) |
| Add a test, script, or source file that fits in | [conventions.md](conventions.md) |
| Pick a feature to build | [suggestions.md](suggestions.md) |
