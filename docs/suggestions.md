# Feature suggestions

Proposals for what to build next, ordered so the cheap high-value work comes first. Every item names the files it
touches and the reason it matters, so an agent can pick one up without re-deriving the context.

Legend — **Effort:** S (hours) · M (a day or two) · L (a week+) · **Risk:** how likely a change is to affect existing
output.

---

## A. Close the drift between the API and the web app

The API was written early and did not follow the web worker as features landed. These are the cheapest real wins in the
repo.

### A1. Bring `apps/api` level with `apps/web` — **DONE**

`apps/api/src/server.ts` now sets every hint field (including `furnitureTransforms` and `pluginConfigZips`), bundles
`modelengine_input.zip`, and has an accurate `USAGE` string. What remains open is **the Node-side parallel encoder**:
the API still passes no `pngEncoder`/`recompressor`, so PNG work runs sequentially on the single Node thread. Doing that
properly means a `node:worker_threads` pool, which interacts awkwardly with the `tsx` loader — worth doing, but it is a
separate change from the field drift.

### A2. Share the option-building logic — **DONE**

`optionsFromHints(hints, configZips)` in `packages/core/src/convert/optionsFromHints.ts` is now the single
implementation, called by both `convert.worker.ts` and `server.ts`. It is exported from `@loomery/core` and locked by
`test/optionsFromHints.test.ts`, which asserts every field of its return type is present and that the config zips are
copied rather than aliased.

### A3. Surface `oxipngLevel` correctly in the API — **Effort S · Risk none**

`oxipngLevel` is validated (1–6) and then ignored, because the Node path uses zopfli, which takes no level. Either
accept and ignore it *documented in `USAGE`*, or — better — move the Node recompression path onto `@jsquash/oxipng` too
so both paths behave the same and the level means something. A shared `recompressor` factory in core would also let the
API's worker-thread pool (A1) reuse the same code path as the browser's.

### A4. `/healthz` should report readiness — **Effort S · Risk none**

Currently returns a constant `"ok"`. For container deployments it would be more useful to report the resolved
`MAX_UPLOAD_BYTES` and whether the zopfli/oxipng wasm initialised, since "the wasm never loaded" is a known failure
mode on the browser side (`optimizeStage`'s `zopfliNote` already has a string for exactly this).

---

## B. Fill the testing gaps

The suite is strong where it exists (31 files, dense behavioural coverage) but entire modules have never been tested,
and the apps have no tests at all.

### B1. Unit-test `fastHash` — **DONE**

`packages/core/test/hash.test.ts` now covers determinism, digest shape, length sensitivity, view-window isolation
(unaligned `subarray` input), UTF-8 string hashing, a 3,000-buffer collision sweep, and **pinned digest vectors** so a
change to the mixing is a visible failure rather than a silent rename of every generated pack path.

Still open in this area: `image/zopfliPng.ts` and the wasm recompression path have no direct unit test.

### B2. Test the exporter/encoder modules directly — **DONE**

Direct unit tests now exist for `bedrock/manifest.ts` (`test/manifest.test.ts`), `bedrock/animations.ts`
(`test/displayAnimations.test.ts`), `modelengine/bbmodelGeometry.ts` + `bbmodelAnimation.ts`
(`test/bbmodelGeometry.test.ts`), and `report/report.ts` + `report/timings.ts` (`test/report.test.ts` +
`test/timings.test.ts`). The entity coordinate transform (`-to.x`, no ±8 offset) is asserted explicitly, since that
difference from item geometry is the most important divergence between the two files.

Still uncovered: `image/zopfliPng.ts` and the wasm recompression path, `modelengine/bbmodel.ts`'s `extractTextures`
and `base64Decode`, `java/json.ts`, `java/mcmeta.ts`, `io/vfs.ts`.

### B3. Test stages in isolation — **Effort M · Risk none**

All 14 stages are covered only end-to-end through `convertPack`. Two or three focused tests on the trickiest stage
internals would pay for themselves: `blocksStage.normalizeStateKey` rejection paths, `optimizeStage`'s dead-file sweep
(the current coverage is a single `ruby.png` assertion in `pipeline.test.ts`), and `fontsStage`'s cell-scaling math.

### B4. Give the apps a test harness — **DONE (first slice)**

- **API:** `apps/api/src/server.ts` now exports `createServer()`, and the listen call is guarded by an entry-point
  check, so importing the module no longer binds port 3000. `apps/api/test/server.test.ts` (9 cases) drives a real
  server on an ephemeral port: routes, CORS preflight, query validation, empty-body rejection, and `packName`
  sanitization. `apps/api` has a `test` script and is covered by `pnpm test`.
- **Web:** the logic worth testing was extracted out of the component into `apps/web/src/packNaming.ts` — archive
  extension stripping and the `packName`/label/packNames derivations, which feed manifest UUIDs.
  `apps/web/test/packNaming.test.ts` (14 cases) covers it, including the "two different merges must not collide"
  property. `apps/web` has a `test` script and is covered by `pnpm test`.

Still open: the React components themselves are not rendered in any test, and neither worker pool is tested against a
real `Worker` (dispatch, timeout fallback, `dispose`). Those need a DOM environment / worker shim and are a larger
piece of work than the extractions above.

### B5. Promote `validate-mcpack.mts` into a real check — **DONE**

Rather than wiring the ad-hoc script into CI, the checks were promoted into `packages/core/test/selfcheck.test.ts`
(3 cases), which runs in `pnpm test`: it builds the real fixture with `make-fixture.mjs`, converts it, and asserts the
whole pack is structurally valid — manifest shape and UUID rules, every generated JSON parses, every `item_texture` /
`terrain_texture` entry resolves to a file that exists, every attachable references an emitted geometry, no reported
errors, deterministic manifest identity across runs, and the same holds with `optimizePack: false`. This is a strictly
stronger guarantee than per-file assertions and it needs no extra CI step. `validate-mcpack.mts` remains as a manual
inspection tool for a real pack.

### B6. Add coverage reporting — **DONE**

`packages/core/vitest.config.ts` configures the v8 provider (the only non-default setting in the suite — it otherwise
still runs on Vitest defaults). `pnpm test:coverage` produces a text report plus a `coverage/` HTML directory. **No
thresholds are enforced**, deliberately: coverage is a map of what is untested, not a gate, and failing CI over the
known gaps in §B2 would only encourage shallow tests. The provider is pinned to the `2.x` line to match the repo's
vitest (`@vitest/coverage-v8@5.x` requires vitest 3 and fails at startup with
`does not provide an export named 'BaseCoverageProvider'`).

---

## C. Converter gaps that users hit

These are features the README currently lists as unsupported, or where a real-world pattern silently degrades.

### C1. `blocks.json` emission for vanilla block retextures — **Effort M · Risk medium**

Vanilla block retextures work today by writing a renamed file into `textures/blocks/`. That covers the common case, but
Bedrock resolves some block faces through `blocks.json` (carried-through legacy names, and blocks whose Bedrock texture
name can't be reached by a directory remap). Emitting a merged `blocks.json` would close the long tail of "my block
retexture converted but doesn't show".

This is also the natural place to expose per-block *sound* and *destruction* overrides that Java packs can express and
Bedrock only reads from `blocks.json`.

### C2. Multipart blockstates — **Effort M · Risk medium**

`blocksStage` reports `multipart blockstates are not yet supported` and skips. Multipart is how fences, walls, panes,
vines, chests and most decorative blocks are defined, so a large fraction of custom blocks is currently unconvertible.
The work is in resolving `when` conditions into Geyser `state_overrides` (the machinery already exists for `variants`),
and deciding how to represent the union of several models — likely as one geometry per surviving state combination.

### C3. Expand past the seven `MECHANIC_BLOCKS` — **Effort M · Risk low**

`blocksStage` only knows `note_block`, `tripwire`, `mushroom_stem`/`brown_mushroom_block`/`red_mushroom_block`/
`chorus_plant`, `cave_vines`, `cave_vines_plant` and `sugar_cane` — the vanilla blocks with enough states to host
custom block mappings. That list is the *entire* supported set for Geyser custom blocks. Adding more (e.g. `tripwire`,
`sculk_sensor`-style state-rich blocks, or a user-configurable "use this block as the host" option) directly widens
what the tool can convert. A configurable host block would be the single highest-leverage change here.

### C4. `builtin/entity` items — **Effort L · Risk medium**

Items whose model parents to `minecraft:builtin/entity` (chest, shield, trident, banner, shulker box, bed, conduit,
decorated pot) are reported as skipped: "needs hardcoded geometry, not yet supported". The fix is a small library of
Bedrock geometries for those shapes (the vanilla Bedrock pack has them) plus a mapping from the Java `builtin/entity`
item to the Bedrock geometry + the item's `display` transforms. This would unblock a common category of custom items —
retextured shields and tridents especially.

### C5. TTF / `ttf` font providers — **Effort L · Risk low**

`fontsStage` skips any non-`bitmap` provider: "font provider type "ttf" has no Bedrock equivalent". Bedrock has no
runtime font loading, but it *does* have glyph sheets — so a TTF provider could be rasterised into a glyph page at
conversion time (the stage already computes cell size, ascent handling and nearest-neighbour blitting). Rendering text
in the browser or Node would need a font rasteriser dependency, which is the main cost. Worth doing because TTF fonts
are common in modern packs for custom UI text.

### C6. Custom GUI — **DONE (panels)** · core shaders still open

Custom **panels** now convert: `guiStage` writes `textures/ui/*.png` and measures
the panel's nine-slice border from the image itself (`image/nineSlice.ts`), emitting the
`{ nineslice_size, base_size }` sidecar Bedrock reads beside it. A sprite with no flat border is
copied without a sidecar and reported `approximated`, because stretching is the correct behaviour for a
button face or an icon.

Vanilla GUI **sheets** stay skipped, with the real reason: Java blits one 256×256 `icons.png` behind a
screen while Bedrock composes the HUD from a dozen separate files plus a JSON UI layout. Slicing the
atlas mechanically needs a hand-written tile map per sheet, and guessing one would put the wrong art in
every HUD slot.

Core shaders remain open, and the two notes below still stand for them:

- **(M)** Ship a *report category* that names exactly what was dropped and suggests the Bedrock-side
  substitute (some shader effects map onto Bedrock's `fogs`, material `render_method`, or an overlay
  texture layer). Turning an opaque skip into actionable guidance is most of the value.
- **(L)** Emulate the common subset of core shaders — solid-colour overlay shaders and simple screen
  tints are the ones packs actually use — by baking the effect into the affected textures, the same way
  `colorHints` already bakes a dye colour into a 2D icon.

### C7. Painting and font-page partial overrides — **Effort M · Risk low**

`paintingsStage` warns that overriding *some* paintings makes the rest invisible, because the whole `kz.png` atlas is
rebuilt and the unoverridden slots are left transparent. Same shape of problem for glyph page 0, which is deliberately
never emitted. Both are correct-but-lossy. A clean fix: let the user optionally supply a vanilla Bedrock resource pack
(or just the relevant atlas) as an input, and composite the pack's overrides on top. With that input present, partial
overrides become non-destructive. Without it, the current behaviour and warning stay.

### C8. Per-item control over held-sprite animation — **Effort S · Risk low**

`animate2dHeldItems` is a single global boolean, and the documentation is careful that it is a trade-off (a flat card
replaces Bedrock's native extruded held sprite). In practice a pack wants it for a handful of showcase items and not for
the rest. Accept a namespace or item-id list, or honour a per-item marker in `sprites.json`, so the trade-off can be
made selectively.

### C9. More item-plugin parsers — **Effort S each · Risk low**

The config layer (`java/oraxen.ts`, `java/craftEngine.ts`, `java/datapack.ts`) covers Oraxen, Nexo, ItemsAdder,
CraftEngine, HMCCosmetics, oxywire, and datapacks. Candidates with similar shapes: **ExecutableItems**, **MythicMobs**
item configs (already read for `.bbmodel`, not for items), **ItemEdit**, and **EcoItems**. Each is a self-contained
parser plus a test file, and the escalation in `resolveBaseItem` means a new parser only ever *improves* host-item
resolution — it cannot make an existing conversion worse.

### C10. Report which datapack/config a hint came from — **Effort S · Risk none**

`ConfigHints` currently aggregates into flat maps with no provenance. When two sources disagree, there is no way to
tell the user which one won. Recording the origin per map entry and including it in the `items-hints` report detail
would make "why is this item mapped under the wrong base item" answerable from the report alone.

---

## D. New capabilities

### D1. A CLI package (`packages/cli`) — **Effort M · Risk low**

The engine is already environment-agnostic and `apps/api/src/test-convert.ts` is essentially a CLI prototype. A real
`loomery convert <pack.zip> --config <plugin.zip> --out dist/` with `--watch`, `--report json|html`, and a progress
bar would make the tool usable in build pipelines without standing up the HTTP server. `test-convert.ts` shows every
piece needed.

### D2. A 3D preview in the web UI — **Effort L · Risk low**

`renderModelIcon` already projects Java elements isometrically with the GUI display transform applied. The same
projection with a drag-to-rotate camera would let a user verify a converted 3D item — orientation, flip direction, UV
placement — **before** downloading and installing the pack. This is the highest-value product feature available, because
the current verification loop is "convert → download → install → open Minecraft → look at it → repeat", and the
converter's most subtle behaviours (the crossbow 180° flip, the backpack head lift, furniture seating) are exactly the
ones that need a visual check.

### D3. Report diffing — **Effort M · Risk none**

Converting the same pack after an edit and comparing `conversion_report.json` files ("these 12 items went from
approximated to converted; these 3 newly fail") would make iterative pack development far faster and would give the
regression-oriented tests a data-driven counterpart.

### D4. HTML report output — **Effort S · Risk none**

`conversion_report.json` is machine-readable but not pleasant to read. The `ResultView` table already knows how to
render it (status icons, filters, detail column) — emitting a standalone HTML file with the same layout would make the
report shareable in a bug thread, which is where it is most needed.

### D5. Folder upload in the web UI — **Effort S · Risk low**

`DropZone` accepts files only. `webkitdirectory` (or `DataTransferItem.webkitGetAsEntry()` for drops) would let a user
pick the unpacked pack folder directly — a common workflow, since a pack edited in place is usually a folder, not a zip.
The merge machinery already handles nested roots.

### D6. Merge conflict resolution UI — **Effort M · Risk low**

Merging reports conflicts but always resolves them "first upload wins". Since the `DropZone` staging list already has
reorder buttons, surfacing per-path conflicts *after* a conversion (with a "make pack N win this path" control) would
turn a report line into a fix. Today the only remedy is to reorder the whole upload and re-run.

---

## E. Performance and scale

### E1. Per-namespace conversion — **Effort M · Risk low**

`options.namespaces` already exists in `ConvertOptions` but is not exposed in the UI. Exposing it (and adding an
"incremental" mode that keeps previously converted namespaces) would let a large server pack be converted in pieces
rather than all at once — the single biggest practical limitation on pack size today.

### E2. Enable wasm threads when COOP/COEP are available — **Effort M · Risk low**

The worker pools deliberately use no `SharedArrayBuffer` so the build works on static hosts. When the deployment *can*
set the headers (self-hosted, the API), detecting `crossOriginIsolated` and enabling shared-memory encoders would
remove the copy cost on large atlases. The current design is a good default; this is an opportunistic upgrade.

### E3. Stream the output zip — **Effort M · Risk medium**

`writeZip` builds the whole archive in memory, and `App` holds both the input pack(s) and the result at once. For a
1 GB upload that is a lot of resident memory (which is exactly why `DropZone` has a 1 GB total cap). A streaming writer
that emits entries as stages finish would lower the ceiling considerably.

### E4. A persistent cache for the big tables — **Effort S · Risk low**

`vanillaTextureMap.ts` (2074 lines) and `vanillaSoundMap.ts` (1326 lines) are parsed as JS modules on every load. They
are small enough not to matter on desktop, but on mobile the initial parse is measurable. Moving them to JSON fetched
lazily (or compressed) would cut the first-load cost. Low priority.

---

## F. Process

### F1. Keep these docs honest — **Effort S, recurring · Risk none**

The reference set under `docs/` will drift. Cheap countermeasures: a note in the PR template to update the affected
reference file, and a CI check that the file paths mentioned in the docs still exist. The docs are written to be the
*first* thing an agent reads rather than a summary of the code, so drift costs more here than in a typical repo.

### F2. Attribution is load-bearing — **Effort S · Risk none**

Several tables are ported from MIT-licensed projects, and the specific corrections (the three known-wrong entries, the
PackConverter resolver bug) are documented in-code and asserted in tests. Any regeneration of those tables must
preserve the provenance markers (`// --- Ported from GeyserMC/PackConverter's mappings/textures.json (MIT).`) and keep
`test/vanillaTextureMap.test.ts` passing. Worth stating in the PR template alongside F1.

---

## G. Considered and not proposed

- **Reverse conversion (Bedrock → Java).** Structurally a different tool; Bedrock's render-controller-driven animation
  and attachable rig have no clean Java equivalent, so the round trip would lose the very features this converter
  exists to produce.
- **Shipping vanilla Bedrock assets to fix partial overrides.** The painting atlas and glyph pages would be perfect
  fixes for §C7, but redistributing Mojang assets is not something this project should do. Hence the "user supplies the
  vanilla pack" framing there.
- **Bundling a font rasteriser into core.** It would make §C5 easier but would push a large dependency into the
  environment-agnostic core package. Better as an optional peer or a small separate package.
