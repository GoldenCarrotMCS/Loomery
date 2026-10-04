# Reference — `convertPack`, the context, and all 15 stages

> Part of the Loomery reference set. See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the end-to-end flow,
> [io-and-java.md](io-and-java.md) for what feeds these stages, and [bedrock-emitters.md](bedrock-emitters.md)
> for the geometry/animation emitters the 3D stages call.
>
> This is the document to read before touching **any** file under `packages/core/src/convert/`. It records each
> stage's data dependencies, output paths, report strings and magic numbers, so a change here doesn't require
> re-reading fourteen files.

---

## 1. `packages/core/src/convert/context.ts` — the contract

### 1.1 `ConvertOptions`, field by field

| Field | Type | Default | What it changes |
| --- | --- | --- | --- |
| `packName` | `string` | pipeline supplies `"Converted Pack"` | `manifest.json` `header.name` + module UUID seed; `resource_pack_name` in `item_texture.json`/`terrain_texture.json` |
| `packNames` | `string[]` | `[]` | Report-only: names the uploads in merge accounting (falls back to `pack 1`, `pack 2`) |
| `attachableMaterial` | `string` | `"entity_alphatest_one_sided"` | `material` on every generated attachable — 3D items, bow-pull, held sprite animation |
| `animate2dHeldItems` | `boolean` | `false` | Opt-in flat-card attachable so a single-layer animated sprite animates while HELD (replaces Bedrock's extruded held sprite) |
| `namespaces` | `string[]` | `[]` (empty = all) | Namespace filter |
| `modernBaseItem` | `string` | `"minecraft:paper"` | Host item for modern item-model assets with no statically-knowable base item; also the string in the config-nudge report |
| `baseItemHints` | `Record<string,string>` | `{}` | item-model name (lowercase, no ns) → java item id, e.g. `"ruby_sword" → "minecraft:diamond_sword"` |
| `displayNameHints` | `Record<string,string>` | `{}` | item-model name → display name (colour codes stripped) |
| `equippableHints` | `Record<string,{asset:string;slot:string}>` | `{}` | item-model name → armor link; drives the deterministic armor match in `armorStage` |
| `cmdItemKeys` | `Record<string,string>` | `{}` | Key format is exactly `` `${baseItem}|${cmdValue}` `` |
| `vanillaModelItems` | `VanillaModelItem[]` | `[]` | Plugin items wearing a vanilla item model on another material; consumed by `vanillaModelVariants()` |
| `colorHints` | `Record<string,number>` | `{}` | item-model name → `0xRRGGBB` fixed dye colour baked into 2D icons |
| `backpackItems` | `string[]` | `[]` | Config item keys worn as back cosmetics → `headLift: 12` |
| `furnitureItems` | `string[]` | `[]` | Config keys placed as display-entity furniture → GeyserDisplayEntity mappings |
| `furnitureTransforms` | `Record<string,FurnitureTransform>` | `{}` | Per-key placement hints (`context` / `none`) |
| `maxAnimationFrames` | `number` | `0` (0 = unlimited) | Caps flipbook timeline frames in `geometryStage` |
| `optimizePack` | `boolean` | `true` | Lossless optimizer; **also** selects `new VirtualFs(true)` (minify JSON) |
| `maxCompression` | `boolean` | `false` | Opt-in zopfli recompression (~12%, ~0.7 s/file) |
| `recompressor?` | `PngRecompressor` | absent | Worker pool for zopfli; absent → in-process sequential |
| `pngEncoder?` | `PngEncoder` | absent | Worker pool for atlas/icon encodes |
| `configZipProvided?` | `boolean` | `false` | Suppresses the config-nudge |
| `pluginConfigZips?` | `Uint8Array[]` | absent | Scanned for `.bbmodel` blueprints **only**; not part of the coalesced `opts` object |

Supporting types:

```ts
export interface PngEncoder { encode(images: RawImage[]): Promise<Uint8Array[]> }
export interface RawImage { width: number; height: number; data: Uint8Array }
export interface PngRecompressor {
  run(pngs: Uint8Array[], onProgress?: (done: number, total: number) => void): Promise<(Uint8Array | undefined)[]>
}
```

`packName` is the one field **not** in `DEFAULT_OPTIONS` (which is typed `Omit<ConvertOptions, "packName">`).
Note the documentation quirk: `ConvertOptions.packName`'s doc comment says it defaults to the Java pack description
or zip name, but the coercion in `convertPack` wins and the real default is `"Converted Pack"`.

### 1.2 `ConversionContext` — every field

Shared state threaded through all stages:

| Field | Type | Notes |
| --- | --- | --- |
| `java` | `JavaPack` | Input, read-only |
| `bedrock` | `VirtualFs` | Output pack under construction |
| `options` | `ConvertOptions` | |
| `report` | `ConversionReport` | |
| `timings` | `Timings` | |
| `progress` | `ProgressCallback` | |
| `itemTextures` | `Map<string,{textures:string}>` | Flushed by `packaging` to `textures/item_texture.json` |
| `terrainTextures` | `Map<string,{textures:string}>` | Flushed by `packaging` to `textures/terrain_texture.json` |
| `geyserMappings` | `GeyserMappingsV2` | Init `{format_version: 2, items: {}}` |
| `geyserBlocks` | `Record<string,GeyserBlockDefinition>` | Init `{}` |
| `pendingGeometry` | `PendingGeometry[]` | Init `[]`; produced by `items`, drained by `items-3d` |
| `definitionTextures` | `Map<GeyserItemDefinition,string[]>` | Java texture ids each definition's model referenced |
| `usedBedrockIdentifiers` | `Set<string>` | Bare identifier names (no namespace) |
| `textureCache` | `Map<string,RgbaImage\|undefined>` | Keyed by **Java VFS path** |
| `geometryHandledTextures` | `Set<string>` | Read by `flipbooks` to suppress false skips |
| `bowPullGroups` | `BowPullGroup[]` | Written by `items`, consumed by `bow-pull` |
| `fallbackBaseItemHits` | `number` | Drives the config-nudge |
| `configZipProvided` | `boolean` | |
| `displayEntityMappings` | (array, see below) | |
| `inferredHostItems` | `Map<string,string\|undefined>` | Keyed by **model** id |
| `definitionHostItems` | `Map<string,string\|undefined>` | Keyed by **item-model** id — deliberately separate |
| `resolvedModels` | `Map<string,ResolvedModel\|undefined>` | Memoizes `resolveModel` per conversion |

```ts
export interface PendingGeometry {
  variant: import("../java/itemVariants.js").ItemVariant;
  resolved: import("../resolve/modelResolver.js").ResolvedModel;
}

export interface GeyserMappingsV2 {
  format_version: 2;
  items: Record<string, GeyserItemDefinition[]>;
}
```

`displayEntityMappings` entries: `{ key, type, identifier, modelData?, vanillaScale?, scaleMultiplier?, yOffset? }`.

`GeyserItemDefinition` (the v2 mapping shape emitted per variant):

```ts
{
  type: "definition" | "legacy" | "group";
  model?: string;
  custom_model_data?: number;
  bedrock_identifier?: string;
  display_name?: string;
  priority?: number;
  predicate?: unknown;
  predicate_strategy?: "and" | "or";
  bedrock_options?: { icon?, display_handheld?, allow_offhand?, creative_category?, creative_group?, protection_value?, tags? };
  components?: Record<string, unknown>;
  definitions?: GeyserItemDefinition[];
}
```

`GeyserBlockDefinition`: `{ name, display_name?, geometry?: {identifier}, material_instances?, only_override_states?, state_overrides?, destructible_by_mining?, light_emission? }`;
`GeyserMaterialInstance`: `{ texture, render_method?, face_dimming?, ambient_occlusion? }`.

### 1.3 `ProgressCallback` contract

```ts
export type ProgressCallback = (stage: string, done: number, total: number) => void;
```

Invoked from `convertPack` **exactly twice per stage**: `ctx.progress(stage.name, 0, 1)` before `await stage.run(ctx)`,
and `ctx.progress(stage.name, 1, 1)` after timing. Stages additionally self-report *fractional* progress inside `run()`:

- `textures`: every 100th file (`done % 100 === 0`), then a final `(paths.length, paths.length)`.
- `items`: every 25th variant, then a final `(variants.length, variants.length)`.
- `armor` / `bow-pull` / `items-3d`: per set/group/model, `(done, total)`.
- `optimize`: only during zopfli — `ctx.progress("optimize", done, total)` from the pool callback, or `(++done, candidates.length)` sequentially, then a final `(candidates.length, candidates.length)`.

**No percentage is computed in the pipeline.** `ConvertResult` carries no percent; the host/UI derives it from
`(done, total)` and the fixed stage order. The stage-name strings double as progress labels and as `ReportEntry.stage` values.

### 1.4 Stage order and why it is forced

```ts
const STAGES: PipelineStage[] = [
  texturesStage,          // "textures"
  entityCompositesStage,  // "entity-composites"
  itemsStage,             // "items"
  bowPullStage,           // "bow-pull"
  geometryStage,          // "items-3d"
  armorStage,             // "armor"
  blocksStage,            // "blocks"
  flipbooksStage,         // "flipbooks"
  soundsStage,            // "sounds"
  langStage,              // "lang"
  fontsStage,             // "fonts"
  guiStage,               // "gui"
  paintingsStage,         // "paintings"
  packagingStage,         // "packaging"
  optimizeStage,          // "optimize"
];
```

1. **`textures` first** — it must write `textures/entity/chest/*.png` into `ctx.bedrock` before `entity-composites`
   can read those bytes back out. Nothing else depends on it: custom-namespace textures are re-encoded by their
   consuming stage, not copied.
2. **`items` before `bow-pull`** — `itemsStage` *writes* `ctx.bowPullGroups` and strips those keys from the normal
   variant extraction. `bowPullStage` returns immediately when `groups.length === 0`.
3. **`items` before `items-3d`** — `itemsStage` pushes into `ctx.pendingGeometry`; `geometryStage` groups by model and
   drains the queue (`ctx.pendingGeometry.length = 0`). Any survivor after all stages is reported as
   `internal error: 3D variant not consumed by the geometry stage`.
4. **`items`/`items-3d` before `armor`** — `armorStage` matches armor pieces against `ctx.geyserMappings.items` and the
   `ctx.definitionTextures` side table, both populated earlier, then mutates `def.components["minecraft:equippable"]`.
5. **`blocks` before `flipbooks`** — `flipbooksStage` imports `terrainTextureKey` from `blocksStage` and resolves
   `atlas_tile` against `ctx.terrainTextures`, which `blocksStage` filled.
6. **`items-3d` before `flipbooks`** — `geometryStage` adds every loaded texture to `ctx.geometryHandledTextures`, which
   `flipbooksStage` consults.
7. **`packaging` after every producer of `itemTextures`/`terrainTextures`** — items, items-3d, bow-pull, blocks.
8. **`optimize` last** — it needs the complete Bedrock VFS to sweep dead files, merge duplicates, rewrite references and
   re-encode passthrough PNGs. Its dead-sweep reads every `.json`, so it must follow packaging.

### 1.5 How the report and timings are assembled

- `const timings = new Timings()`, `beginTimings(timings)` before the loop, `finishTimings()` in a `finally`.
- Per stage: `const start = now(); try { await stage.run(ctx) } catch (err) { ctx.report.error(stage.name, "(stage)", message) } timings.stage(stage.name, now() - start)`.
  **A thrown stage is not fatal** — it becomes an `error` entry with source literally `"(stage)"`, and the loop continues.
- After the loop: `zipStart = now(); writeZip(ctx.bedrock); timings.stage("zip.write", now() - zipStart)` — a pseudo-stage
  with no progress events.
- `Timings.toJSON()` → `{ totalMs, stages: [{name, ms}], ops: [{category, count, totalMs}] }`; `totalMs` is the rounded sum
  of stage ms; `ops` is sorted descending by `totalMs`. Hot-op categories recorded today: `"png.encode.pool"`,
  `"atlas.hash"`, `"geometry.build"`, `"json.write"`.
- `report.toJSON()` → `{ summary: {converted, approximated, skipped, error}, entries: ReportEntry[] }`.
- Returned `ConvertResult`: `mcpack`; `geyserMappings` (`JSON.stringify(ctx.geyserMappings, null, 2)`, only when
  `items` is non-empty); `geyserBlockMappings` (`{format_version: 1, blocks}`, only when non-empty);
  `displayEntityMappings` (YAML); `displayEntityConfig` (emitted together with the mappings); `modelEngineInput`
  (zip, only when `.bbmodel` models were found); `report`; `timings`.

### 1.6 Non-stage report sources in `pipeline.ts`

| Stage key | When | Status |
| --- | --- | --- |
| `"ingest"` | each unreadable pack from `mergeJavaPacks` | `error`, detail `could not extract from zip: ${reason}` |
| `"merge"` | only when `merge.packs.length > 1` | `converted` for the summary and clean files; `approximated` for shadowed keys and path conflicts |
| `"items-3d"` | leftover `ctx.pendingGeometry` | `skipped`, `internal error: 3D variant not consumed by the geometry stage` |
| `"furniture"` | `displayEntityMappings.length > 0` | `converted`, `` `${n} furniture item(s) from plugin configs` `` |
| `"config-nudge"` | `ctx.fallbackBaseItemHits >= 2 && !ctx.configZipProvided` | `approximated` |
| `"modelengine"` | bbmodel scan | `converted` / `skipped` |

Report caps: `MAX_REPORTED_CONFLICTS = 40` (then a `"${n} more conflicting path(s)"` roll-up),
`MAX_REPORTED_SHADOWED_KEYS = 12` (then `, …`).

**Hard throws from `convertPack`** (not report entries — these are the only two pre-flight checks that throw):

- `Nothing to convert: could not read ${names} — not a zip/mcpack archive, or corrupt`
- `Nothing to convert: the upload contained no files`
- `Nothing to convert: ${names} has no assets folder and no pack.mcmeta. Upload the resource pack itself — the zip or
  folder that contains assets/ — not a plugin config or a parent directory.`

### 1.7 GeyserDisplayEntity emission

`HIDE_TYPE_DEFAULTS = ["minecraft:bone"]`.

`buildDisplayEntityConfig` always emits, alongside the mappings:

```yaml
general:
  use-legacy-models: true
  height: 1.7
  y-offset: -0.5
  vanilla-scale: false
  vanilla-scale-multiplier: 1
  hand: false
hide-types: [...]
```

Any furniture base item that lands in `hide-types` is removed from it, so the furniture isn't hidden too.

Per-entry YAML (`buildDisplayEntityYaml`) writes `type`, then **either** `model-data` + `item-identifier: "none"`
when `modelData` is defined, **or** `item-identifier: "<identifier>"`; then `displayentityoptions:` with
`y-offset` (`toFixed(3)`), `vanilla-scale`, `vanilla-scale-multiplier` (`toFixed(4)`, `0` when off), `hand: false`.

---

## 2. Stage by stage

### 2.1 `texturesStage` — `"textures"` · position 1

**Reads** `ctx.java` only: `ctx.java.list({prefix:"assets/", suffix:".png"})` and `ctx.java.read`.
**Writes** `ctx.bedrock.write(target, data)` at each `remap.outputPaths` entry.

Algorithm — a single loop over every `.png` under `assets/`:

- `done % 100 === 0` → progress.
- Path starts with `assets/minecraft/textures/` → `remapVanillaTexture(path)`:
  - `undefined` → take the first path segment after the prefix as `category`. If `!VANILLA_TEXTURE_CATEGORIES.has(category)`
    → `continue` silently (custom content dumped in the `minecraft` namespace). Else if `!HANDLED_BY_STAGE.has(category)` →
    `skipped("textures", path, \`vanilla ${category} textures have no Bedrock equivalent yet\`)`. Then `continue`.
  - Defined → `readTexture()` = `sanitizePng(ctx.java.read(path))` (repairs invalid zlib CRC emitted by ItemsAdder exports);
    `continue` when undefined.
  - `remap.outputPaths` is split into `tgaTargets` (`.tga`) and `pngTargets`. PNG targets get raw bytes; TGA targets get
    `encodeTga(decodePng(data))` — Bedrock ships legacy entity textures as `.tga` and looks them up by that extension, so
    PNG bytes under a `.tga` name render nothing.
  - `remap.exact === true` → `converted(path, remap.outputPaths)`; else `approximated(path, "no explicit rename rule —
    copied with same filename (correct for most modern textures)", remap.outputPaths)`.
- **Anything not under `assets/minecraft/textures/` is deliberately not copied.** The item/geometry/armor/blocks/fonts
  stages re-encode what they reference into `textures/geyser_custom/`, and flipbooks copies animated custom block
  textures on demand. This avoids ~1000+ dead textures on a big ItemsAdder pack (~1200 cited).
- `.mcmeta` files are **not** copied here.

Constants: `VANILLA_TEXTURE_CATEGORIES = {block, item, entity, environment, colormap, misc, models, map, gui, particle,
painting, font, mob_effect, trims, effect}`; `HANDLED_BY_STAGE = {painting, font}` (silent — their own stage converts them).

**Invariant:** this stage is the only producer of `textures/entity/chest/*` for `entityCompositesStage`.

### 2.2 `entityCompositesStage` — `"entity-composites"` · position 2

**Reads** `ctx.java.packFormat`, and **reads back from `ctx.bedrock`** (`textures/entity/chest/<name>.png`).
**Writes** the rearranged/stitched chest textures.

- Early return when `ctx.java.packFormat < 5` (Java 1.15 / pack_format 5 changed the chest layout; older packs already
  match Bedrock).
- `SINGLE_CHESTS = ["normal","trapped","ender","christmas"]` → decode, `factor = Math.max(1, Math.floor(image.width / 64))`,
  `out = createImage(64*factor, 64*factor)`, `applyOps(out, SINGLE_CHEST_OPS, factor, {left:image, right:image})`, write in place.
- `DOUBLE_CHESTS = [["normal_left","normal_right","double_normal"],["trapped_left","trapped_right","trapped_double"],
  ["christmas_left","christmas_right","christmas_double"]]` — the third element is used verbatim, so only the first pair has
  the `double_` prefix. Canvas is `128*factor × 64*factor`.

**Coordinate math.** `Op = {sx,sy,w,h, t:"rot180"|"flipV"|"none", dx,dy, src?:"left"|"right"}`; every rect is in 64-px space
and multiplied by `factor` at crop and blit time. `SINGLE_CHEST_OPS` is 13 ops (12 face regions + a 6×6 `none` at `0,0`);
`DOUBLE_CHEST_OPS` is 19 ops drawing from explicit `left`/`right` sources into the 128-wide canvas (destinations reach `dx=73`).
`rot180` ← `rotate180`, `flipV` ← `flipVertical`. Region source rects like `sx:42, w:14` in a 64-wide sheet deliberately cross
the 64 boundary in the Java layout.

**Edge cases:** missing source file → silent `continue` (no report). Decode/transform failure →
`ctx.report.error("entity-composites", path, message)`.

Provenance: region math ported from ConvertJavaTextureToBedrock (rtm516/ozelot379).

### 2.3 `itemsStage` — `"items"` · position 3 · async

The largest stage, and the one that decides every custom item's identity.

**Reads:** `ctx.java`, `ctx.options` (`pngEncoder`, `animate2dHeldItems`, `cmdItemKeys`, `displayNameHints`, `baseItemHints`,
`colorHints`, `vanillaModelItems`, `furnitureItems`, `modernBaseItem`, `attachableMaterial`), `ctx.itemTextures`,
`ctx.resolvedModels`, `ctx.inferredHostItems`, `ctx.definitionHostItems`, `ctx.usedBedrockIdentifiers`, `ctx.textureCache`.

**Writes:** `ctx.bowPullGroups`, `ctx.pendingGeometry`, `ctx.itemTextures`, `ctx.geyserMappings.items`, `ctx.definitionTextures`,
`ctx.usedBedrockIdentifiers`, `ctx.fallbackBaseItemHits`, `ctx.displayEntityMappings`, plus `ctx.bedrock` files.

**Output files:** `textures/geyser_custom/<name>.png` (or `<name>_<hex>.png` when a colour hint is baked); for held animation,
`textures/geyser_custom/anim/<name>_<i>.png`, `models/entity/geyser_custom/<name>_held.geo.json`,
`animations/geyser_custom/<name>_held.animation.json`, `render_controllers/geyser_custom/<name>_held.render_controllers.json`,
`attachables/geyser_custom/<safeName(identifier-suffix)>.json`.

**Algorithm:**

1. `extractBowPullGroups(ctx.java)` → `{groups, consumedKeys, consumedModernKeys}`; assign `ctx.bowPullGroups`.
2. `extractLegacyVariants(ctx.java, consumedKeys)` + `extractModernVariants(ctx.java, consumedModernKeys)`; unsupported entries
   are consolidated by `reason` in a `Map<string,string[]>` — one origin → `skipped(origin, reason)`; many →
   `skipped(\`${origins.length} assets\`, \`${reason} (×${origins.length})\`)`.
3. `variants = [...legacy.variants, ...modern.variants, ...vanillaModelVariants(ctx, modern.variants)]`.
4. Dedupe with `dedupeKey = \`${variant.baseItem ?? "?"}|${JSON.stringify(variant.source)}|${variant.model}|${JSON.stringify(variant.predicates)}\``
   — keying on `predicates.length` alone collapsed variants sharing a model with different threshold values.
5. Progress every 25; `convertVariant` wrapped in try/catch → `error("items", \`${variant.origin} → ${variant.model}\`, msg)`.
6. Flush `encodeJobs`: use `ctx.options.pngEncoder` when present **and** `encodeJobs.length >= ENCODE_POOL_THRESHOLD (24)`,
   else `encodePng` inline.

**`convertVariant` decision tree** (after `resolveModel(ctx.java, variant.model, ctx.resolvedModels)`):

| Resolved kind | Action |
| --- | --- |
| `undefined` | `skipped(origin, \`model ${variant.model} not found in pack (vanilla or missing)\`)` |
| `"sprite"` / `"sprite_handheld"` | `convertSpriteVariant` |
| `"geometry"` | `ctx.pendingGeometry.push({variant, resolved})` — **no report entry here** |
| `"builtin_entity"` | `skipped(origin, "builtin/entity model (chest/shield/trident style) — needs hardcoded geometry, not yet supported")` |
| default | `skipped(origin, \`unclassifiable model (terminal parent: ${resolved.terminalParent ?? "none"})\`)` |

**Sprite path.** `TINTED_BASE_ITEMS` = leather helmet/chestplate/leggings/boots/horse_armor, potion, splash_potion,
lingering_potion, tipped_arrow, filled_map, firework_star — these get a colour lookup via `findColorHint`. With a hint →
`converted` on stage key **`"items-hints"`** with `` `config colour #${...} baked into layer0` ``; without → `approximated`
with `<baseItem> tints layer0 server-side on Java — the tint cannot be applied statically, icon may look uncoloured
(add "color:" to the plugin config to bake it)`.

- `spriteLayers(resolved)` empty → `skipped(origin, "sprite model has no layer textures")`.
- Name: `fitPathName(safeName(variant.model), ICON_PATH_RESERVED)` where
  `ICON_PATH_RESERVED = "textures/geyser_custom/_rrggbb.png".length`; `iconKey = \`${name}_${colorHint.toString(16)}\`` when
  tinted, else `name`; `outPath = \`textures/geyser_custom/${iconKey}.png\``.
- **Builtin-icon short-circuit** (`bedrockBuiltinIcon`): only when there is no colour hint, only if *none* of the layers ships
  in the pack (`ctx.java.has(assetPath)`), and `layer0` is `minecraft:item/*` present in `ITEM_RENAMES` → registers
  `ctx.itemTextures[iconKey] = {textures: \`textures/items/<bedrockName>\`}` and reports `converted(origin, [\`${builtinIcon}
  (Bedrock's built-in texture)\`])` — **no file written**.
- Layer decode via `decodeCached(ctx.java.read.bind(ctx.java), texPath, ctx.textureCache)`; missing layer →
  `approximated(origin, \`layer texture ${layerId} missing from pack — layer dropped\`)`; all missing →
  `skipped(origin, "no layer textures found in pack")`.
- Animated strip (`img.height > img.width && ctx.java.has(texPath + ".mcmeta")`) → `firstFrame(img)` +
  `approximated(origin, \`animated icon ${layerId} — Bedrock item icons cannot animate, first frame used\`)`.
- Tint path clones first (`cloneImage`) — the shared cache decode must not be dyed in place.
- `compositeLayers(images)` then `alphaBleed(icon)`. **No padding**: the `compositeLayers` padding option is deliberately
  unused (padding shrinks the visible art; a 16×17 sprite would render at half size).
- `ctx.itemTextures.set(iconKey, {textures: \`textures/geyser_custom/${iconKey}\`})` — the map value is the **extension-less**
  path while the VFS write adds `.png`.
- Held animation only when `ctx.options.animate2dHeldItems && layers.length === 1`. `emitHeldSpriteAnimation` computes
  `size = strip.width`, `count = Math.floor(strip.height / size)`, bails when `count < 2`; frames are raw slices of
  `size*size*4` bytes; `fps = 20 / anim.frametime`; the flat card element is `from:[0,0,7.5] to:[16,16,8.5]` with
  `north`+`south` faces textured `#0`; geometry id `geometry.geyser_custom.${name}_held`; render controller id
  `` `controller.render.gc_${name}_held` ``; note string `` `held animation: ${count} frames @ ${fps.toFixed(1)} fps
  (icon stays first-frame)` ``. Frame-name budget: `HELD_FRAME_PATH_RESERVED = "textures/geyser_custom/anim/_99.png".length`.

**`vanillaModelVariants`** dedupes on `` `${item.baseItem}|${item.itemModel}` ``; if the pack's modern variants already cover
`itemModelId`, those are re-hosted (`{...v, baseItem: item.baseItem, origin}`); otherwise a variant is synthesised with
`model: \`minecraft:item/${path}\``, `source: {kind:"modern", itemModelId}`, `predicates: []`, and
`origin = \`plugin item ${item.key} (${item.baseItem} wearing ${item.itemModel})\``.

**`buildDefinition` (exported; also called by `geometryStage`)** — the single choke point for `ctx.geyserMappings.items`,
`ctx.usedBedrockIdentifiers` and `ctx.displayEntityMappings`:

- `cmdValue` = legacy `source.customModelData`, or the `range_dispatch`/`custom_model_data` predicate's `threshold`.
- `configKey = ctx.options.cmdItemKeys[\`${baseItem}|${cmdValue}\`]`.
- `nameKeys` order: `[configKey?, modern itemModelId path lowercased?, model path last segment lowercased]`; first hit in
  `displayNameHints` wins.
- Identifier priority: `configKey` → non-`minecraft` modern item-model path → model path, each through `safeName`.
  Collision handling: `identifierName = \`${base}_${safeName(variant.model)}\``, then `` `${base}_${safeName(variant.model)}_${i}` ``
  from `i = 2` while `usedBedrockIdentifiers.has(...)`. The registry stores the **bare** name while the emitted id is
  `` `geyser_custom:${identifierName}` ``.
- Definition shape: `type: variant.source.kind === "legacy" ? "legacy" : "definition"`, `bedrock_identifier`,
  `display_name: hintedName ?? prettyName(variant.model)`, `bedrock_options: {icon, display_handheld, allow_offhand: true,
  protection_value?}`; legacy gets `custom_model_data`, modern gets `model: source.itemModelId`; `predicates.length > 0` →
  `predicate` + `predicate_strategy: "and"`; plus `priority?`. Finally `(ctx.geyserMappings.items[baseItem] ??= []).push(definition)`.
- **Furniture side-effect**: when `ctx.options.furnitureItems.length > 0` and any `nameKeys` entry is in the list, pushes
  `{key: identifierName, type: baseItem, identifier: identifierName, modelData: cmdValue?, vanillaScale, scaleMultiplier, yOffset}`.
  Preferring the legacy `model-data` match is deliberate — it matches the placed item's cmd directly rather than relying on
  Geyser having already translated it.

**`resolveBaseItem` order** (each success reported on stage key **`"items-hints"`**): `variant.baseItem` → `baseItemHints`
(modern item-model path, then model last segment) → `inferHostItemFromModel` (detail
`host item inferred from model parent chain: ${inferred}`) → `inferHostItemFromDefinition` (modern only, detail
`host item inferred from the item definition's dispatch property: ${fromDefinition}`) → `approximated("items", …,
\`item-model asset has no fixed host item — mapped under ${ctx.options.modernBaseItem}; upload your Oraxen/Nexo/ItemsAdder/
CraftEngine config zip, a datapack, or change the "modern base item" option\`)` and `ctx.fallbackBaseItemHits++`.

**Helpers (exported):** `safeName(id) = id.toLowerCase().replace(/[^a-z0-9_]+/g,"_").replace(/^_+|_+$/g,"")`;
`prettyName` splits on `[_\-]` and capitalises. `readSpriteAnimation` requires `strip.height > strip.width`.

> `safeName` is imported by `armorStage`, `blocksStage`, `bowPullStage` and `geometryStage`. **Any edit there changes file
> names in all four stages.**

### 2.4 `bowPullStage` — `"bow-pull"` · position 4

**Reads:** `ctx.bowPullGroups`, `ctx.options` (`attachableMaterial`, `baseItemHints`, `displayNameHints`),
`ctx.usedBedrockIdentifiers`, `ctx.java`, `ctx.inferredHostItems`, `ctx.textureCache`.

**Output files:** `textures/geyser_custom/bow_<name>_<shortname>.png`; `textures/geyser_custom/icons/bow_<name>.png` (3D icon);
`models/entity/geyser_custom/bow_<name>[_<shortname>].geo.json`; `animations/geyser_custom/bow_<name>.animation.json`;
`render_controllers/geyser_custom/bow_<name>.render_controllers.json`; `attachables/geyser_custom/<safeName("bow_<name>")>.json`.

Per group:

- `uniqueBowName` loops `i` from 2 while `usedBedrockIdentifiers.has(\`bow_${name}\`)`, reserving the name **before any write**
  so truncated names can't make two groups overwrite each other's files.
- Base name `fitPathName(safeName(group.itemModelId ?? group.baseItem ?? group.standbyModel), BOW_TEXTURE_RESERVED)` where
  `BOW_TEXTURE_RESERVED = "textures/geyser_custom/bow__pulling_2.png".length`.
- `modelIds = [group.standbyModel, ...group.stages.map(s => s.model)]`; `shortname` is `"default"` for index 0, `` `pull${i}` ``
  otherwise. Any unresolved model → `skipped(origin, \`model ${id} not found in pack\`)` and **the whole group aborts** (the
  already-reserved name is not released).
- `kinds` must be all-sprite/`sprite_handheld` or exactly `{"geometry"}`; mixed → `skipped(origin, \`bow-pull stages mix sprite
  and 3D models (${kinds}) — not supported\`)`.
- Sprite builder: `layer0` of each stage via `spriteLayers`; empty → `skipped(stage.resolved.id, "sprite bow model has no
  layer0 texture")`. Shared quad element `from:[0,0,8] to:[16,16,8]` with `north`+`south` faces, `uv:[0,0,16,16]`, texture
  `#default`. Aspect mismatch is tested cross-multiplied (`img.width * stdImg.height !== stdImg.width * img.height`) →
  `approximated(stage0.resolved.id, \`${n} pull stage texture(s) have a different aspect ratio to the standby frame — all
  frames share one quad, so those render stretched\`)`.
- 3D builder: per stage, collect face texture ids, `buildAtlas`, `alphaBleed`, write one atlas per stage; per-stage geometry id
  `geometry.geyser_custom.bow_<name>_<shortname>`; icon from `renderModelIcon(..., resolved.display["gui"])`.
- Render controller `controller.render.gc_bow_<name>` gets `frameShortnames`, `stageThresholds = group.stages.map(s => s.pull)`,
  and `geometryShortnames` only when `is3d`.
- Mapping: `modelKey` = `group.modelKey` for modern, else a re-normalised `"ns:path"`; `baseItem` via `resolveBowBaseItem`
  (explicit → `baseItemHints` → `inferHostItemFromModel` → `"minecraft:bow"`); `displayName` via `resolveBowDisplayName`
  (hint → title-cased last path segment → `"Bow"`).
- Report `converted` on `"bow-pull"` with `...built.outputs, attachablePath`,
  `` `mapped under ${baseItem}; ${3D|sprite} bow, ${n} frames (standby + ${n-1} pull stages)` ``, plus the fixed NOTE:
  `NOTE: draw animation uses q.main_hand_item_use_duration — verify in-game; tune the charge multiplier if frames don't align`.

Non-obvious: `loadFirstFrame` crops a flipbook strip; `registerIcon` **reuses an already-written stage texture as the icon**
(no new PNG); 3D stages call `buildGeometry` with `faceTexture` resolved through `atlas.placements.get(id)`.

### 2.5 `geometryStage` — `"items-3d"` · position 5 · async

**Reads:** `ctx.pendingGeometry`, `ctx.options` (`pngEncoder`, `maxAnimationFrames`, `backpackItems`, `cmdItemKeys`,
`attachableMaterial`, `furnitureTransforms`, `baseItemHints`), `ctx.java` (`sprites.json`, models, textures, mcmeta),
`ctx.textureCache`, `ctx.itemTextures`, `ctx.inferredHostItems`, `ctx.usedBedrockIdentifiers`.

**Writes:** `ctx.geometryHandledTextures` (every loaded texture path), `ctx.itemTextures`, `ctx.geyserMappings.items`,
`ctx.definitionTextures`, `ctx.usedBedrockIdentifiers`, `ctx.displayEntityMappings`, and clears `ctx.pendingGeometry`.

**Output files:** `textures/geyser_custom/atlases/<name>.png` (frame 0) and `<name>_f<f>.png` for later timeline slots;
`textures/geyser_custom/icons/<name>.png`; `models/entity/geyser_custom/<name>.geo.json`;
`animations/geyser_custom/<name>.animation.json`; `render_controllers/geyser_custom/<name>.render_controllers.json`
(only when `timelineFrames > 1`); `attachables/geyser_custom/<safeName(id-suffix)>.json`.

Name budget: `ATLAS_TEXTURE_RESERVED = "textures/geyser_custom/atlases/_f99.png".length`.

Steps:

1. Group `pendingGeometry` into `byModel` keyed on `pending.variant.model`, then `ctx.pendingGeometry.length = 0`.
2. Build `spritesJson` once (`ctx.java.readJson<Record<string,string>>("sprites.json") ?? {}`); `atlasCache:
   Map<fastHashKey, path>` is **global to the stage**; per-stage `textureCache: Map<textureId, LoadedTexture|undefined>`.
3. Progress per model; try/catch → `error("items-3d", modelId, msg)`.
4. Flush encodes through `pngEncoder` when present and `encodeJobs.length >= ENCODE_POOL_THRESHOLD (24)`, wrapped in
   `timeOpAsync("png.encode.pool", …)`.

**`convertModel`:**

1. Collect distinct face texture ids via `resolveTextureRef(resolved.textures, face.texture)`; zero →
   `skipped(modelId, "3D model has no textured faces")`.
2. `loadTexture` memoized per texture id. Missing → `approximated(modelId, \`texture ${id} missing — magenta placeholder used\`)`
   and a 2×2 magenta/black checker from `missingTexture()`.

3. **Timeline math — the load-bearing part:**

   - `animated = frames.length > 1` textures; `unit = animated.map(t=>t.frametime).reduce(gcd)` (else `1`).
   - `durationTicks = Math.max(1, animated.map(t => t.frames.length * t.frametime).reduce(lcm, 1))` — **LCM, not max**, so every
     strip returns to frame 0 simultaneously, the only seamless loop point. `lcm` is guarded: `a<=0||b<=0` → `Math.max(1,a,b)`,
     product capped at `MAX_TIMELINE_TICKS = 600`.
   - `fullSlots = Math.ceil(durationTicks / unit)`; `frameCap = ctx.options.maxAnimationFrames > 0 ? maxAnimationFrames : fullSlots`;
     `timelineFrames = Math.min(fullSlots, frameCap)`; `fps = (timelineFrames * 20) / durationTicks`.
   - Per timeline frame `f`: `ticks = (f * durationTicks) / timelineFrames`; per texture
     `idx = Math.floor(ticks / tex.frametime) % tex.frames.length`. Insertion order of `loaded` is stable, so atlas placements
     are identical frame to frame.
   - Two-level dedup: `selectionCache` on the `"id:idx|id:idx"` selection key (frame 0 is never served from it), then
     `atlasCache` on `` `${w}x${h}:${fastHash(image.data)}` `` — **dimensions are part of the key**; same bytes at a different
     shape must not be reused or UVs sample the wrong region. `atlas.hash` is timed with `timeOp`.

4. Geometry id `geometry.geyser_custom.${name}`; `flipFacing = groupBaseItem(ctx, group) === "minecraft:crossbow"` — crossbows
   render backward on Bedrock, so the geometry is re-aimed 180°. `buildGeometry` is called with
   `{flipFacing, textureSize: resolved.textureSize}`, timed as `geometry.build`; the JSON write is timed as `json.write`.
5. Animations via `buildDisplayAnimations(name, resolved.display, isBackpack ? {headLift: 12} : undefined)`. Backpacks are
   detected by matching `backpackItems` against modern item-model path / model last segment / `cmdItemKeys[baseItem|cmd]`; a hit
   reports `approximated(modelId, "back cosmetic (HMCCosmetics backpack): head position lifted +12 units to compensate Bedrock
   armor-stand rendering — report over/under-shoot for tuning")`.
6. Render controller when `timelineFrames > 1`: id `controller.render.gc_${name}`, shortnames `["default","frame1",…]`,
   `extraTextures["frame<f>"] = framePaths[f]`.
7. Icon via `pickIcon`: `sprites.json[modelId]` override decoded with plain `decodePng`, else
   `renderModelIcon(..., resolved.display["gui"], 64, resolved.textureSize ?? [16,16])`; `alphaBleed`; written to
   `textures/geyser_custom/icons/<name>.png`; registered as `<name>_icon`.
8. Per variant: `buildDefinition(...)` with `furnitureVanillaScale`, `furnitureScaleMultiplier`, `furnitureYOffset`;
   `ctx.definitionTextures.set(definition, [...textureIds])`; the head-cosmetic rule sets
   `definition.components["minecraft:equippable"] = {slot:"head"}`; one attachable per unique `bedrock_identifier`.

**Furniture placement (the subtle part):**

- `furnitureTransformForGroup` matches group keys against `ctx.options.furnitureTransforms` with the same key ladder as items
  (`cmdItemKeys`, modern item-model path, model last segment).
- `furnitureContext = furnitureTransform?.context ?? ("fixed" if the transform isn't `none` and `resolved.display.fixed.scale`
  has any component with `Math.abs(v-1) > 0.01`)`.
- `furnitureDisplayScale = parseScaleMagnitude(resolved.display[furnitureContext]?.scale)`;
  `furnitureVanillaScale = Math.abs(scale-1) > 0.001`; `furnitureScaleMultiplier = vanillaScale ? scale : 0`.
- `furnitureYOffset = furnitureTransform?.none === true && elements.length > 0 ? furnitureSeatOffset(elements) : 0`,
  where `furnitureSeatOffset = -((minY+maxY)/2/16)` over all element `from[1]`/`to[1]` — 1 Java unit = 1/16 block, so a model
  centred at y=8 yields 0.
- **Documented invariant:** the extension's `vanilla-scale` entity scale is the *only* scale the attached model gets (bone
  scale does not reach an attachable). Multiplying it in measured exactly 2× too big for a 0.5-scale piece, so the multiplier
  is the display scale alone.

**Report tail:** animated → `converted` with `` `animated: ${timelineFrames} frames @ ${fps.toFixed(1)} fps via render
controller` `` plus a ` (subsampled from ${maxSourceFrames} source frames)` note when capped; static with `geo.usedUvRotation`
→ `approximated(modelId, "face UV rotation used — requires Bedrock 1.21+ client", outputs)`; else plain `converted`.

**Flipbook split math** (`loadTextureUncached`): frame height = `image.width`; `stripCount = Math.floor(image.height / frameH)`;
`baseTime = frameTicks(meta.animation.frametime)`; frames map numbers to `{index, ticks: baseTime}` and objects to
`{index: f.index, ticks: frameTicks(f.time ?? baseTime)}`. `interpolate === true` → resample on a 1-tick grid blending
`cur`→`next` with `t = s/ticks` (frame 0 uses `cur` un-blended), `frametime: 1`. Otherwise → `unit = gcd of all ticks` and
frames repeated `ticks/unit` times. `blendImages` bails to a copy of `a` on size mismatch.

### 2.6 `armorStage` — `"armor"` · position 6

**Reads:** `ctx.java` (`assets/<ns>/equipment/*.json`, `assets/<ns>/textures/models/armor/*.png`),
`ctx.options.equippableHints`, `ctx.geyserMappings.items`, `ctx.definitionTextures`, `ctx.textureCache`.

**Output files:** `textures/geyser_custom/armor/<set.name>_layer1.png` / `_layer2` / `_wings`;
`attachables/geyser_custom/armor/<name>.json`. `ARMOR_TEXTURE_RESERVED = "textures/geyser_custom/armor/_layer1.png".length`.

**Detection:**

1. Modern equipment assets under `assets/<ns>/equipment/`, skipping `ns === "minecraft" && VANILLA_MATERIALS.has(name)` (plain
   retextures — `texturesStage` already remapped their layer textures). Requires `asset.layers !== undefined`. Texture path
   template `assets/${loc.namespace}/textures/entity/equipment/${kind}/${loc.path}.png` for kinds `humanoid`,
   `humanoid_leggings`, `wings` — it reads `[0]` of each array.
2. Legacy `assets/<ns>/textures/models/armor/<material>_layer_<N>.png` matched by `/^(.+?)_layer_(\d)\.png$/`, again skipping
   vanilla materials in `minecraft`. `layer === "1"` → `set.layer1 ??= path`, else `layer2 ??= path`.
3. Set id is `` `${ns}:${material}` ``; `name = fitPathName(safeName(\`${ns}_${material}\`), ARMOR_TEXTURE_RESERVED)`.
4. `VANILLA_MATERIALS = {leather, chainmail, iron, gold, golden, diamond, netherite, turtle, elytra, turtle_scute,
   armadillo_scute, wolf}`.

**Texture emission:** per `layer1`/`layer2`/`wings` present — `decodeCached`; missing →
`approximated(set.origin, \`${key} texture ${src} missing from pack\`)`; animated strip → `firstFrame`, else `cloneImage`
(never mutate the cache); `alphaBleed`; write `<out>.png`.

**Piece loop** (`PIECES = ["helmet","chestplate","leggings","boots"]`; `layerKey = piece === "leggings" ? "layer2" : "layer1"`;
`slot = ARMOR_SLOTS[piece]`):

- Match 1 (deterministic): `equippableHints[name].asset === material && hint.slot === slot`.
- Match 2 (heuristic) against the lowercased definition name + lowercased `definitionTextures`:
  `materialHit = name includes material || any texture includes material || (namespace !== "minecraft" && (name includes namespace
  || any texture includes namespace))`; `pieceHit = name includes piece || any texture includes piece`; require
  `materialHit && pieceHit`.
- No match → a standalone attachable `geyser_custom:${set.name}_${piece}` written with `buildArmorAttachable`, reported
  `approximated(set.origin, \`no item mapping matched ${material} ${piece} — standalone attachable ${identifier} emitted\`)`.
- Match → attachable path `fitFilePath("attachables/geyser_custom/armor/", safeName(def.bedrock_identifier!), ".json")` and
  `def.components = {...def.components, "minecraft:equippable": {slot: ARMOR_SLOTS[piece]}}`.

**Elytra:** only when `texturePaths.wings` exists; hint slot `"chest"`; the heuristic adds `kindHit` over
`["elytra","wings","cape"]`; no match → `geyser_custom:${set.name}_elytra` + `no item mapping matched ${material} elytra —
standalone attachable emitted`; matches get `{slot: "chest"}`.

`ARMOR_SLOTS` (from `bedrock/armor.ts`): helmet→`head`, chestplate→`chest`, leggings→`legs`, boots→`feet`.

**Invariant:** the final `converted` report is gated on `outputs.length > 0` (layer textures were written), *not* on any item
mapping having matched — a set with no match still reports its files.

### 2.7 `blocksStage` — `"blocks"` · position 7

**Reads:** `ctx.java` (`assets/minecraft/blockstates/<block>.json`, models, textures), `ctx.resolvedModels`, `ctx.textureCache`,
`ctx.terrainTextures`.

**Writes:** `ctx.geyserBlocks`, `ctx.terrainTextures`, `ctx.bedrock` files.

**Output files:** `textures/geyser_custom/blocks/<name>.png`, `models/blocks/geyser_custom/<name>.geo.json` (note the
`models/blocks/` root — unlike the item stages' `models/entity/`).
`BLOCK_TEXTURE_PATH_RESERVED = "textures/geyser_custom/blocks/.png".length`.

Iterates `MECHANIC_BLOCKS`; reads `assets/minecraft/blockstates/<block>.json`. `variants === undefined` → if `multipart !== undefined`
report `skipped(path, "multipart blockstates are not yet supported")`, then continue. Per variant:

- Array-valued variants take `[0]`.
- Skip when the model file isn't in the pack (`ctx.java.has("assets/<ns>/models/<path>.json")`) — only shipped models are custom.
- `builtByModel` memoizes the built definition per model id (a note_block maps a dozen state combos to one model; rebuilding
  re-stitched the atlas, re-alpha-bled and re-encoded at zlib 9 each time, all to the same path). `undefined` memo →
  `skipped(\`${path} [${stateKey}]\`, \`model ${variant.model} has no usable elements/textures\`)`.
- **Rotation:** `rx = normalizeAngle(-(variant.x ?? 0))`, `ry = normalizeAngle(-(variant.y ?? 0))` — Java rotates clockwise,
  Bedrock counter-clockwise. Non-zero → `def["transformation"] = {rotation: [rx, ry, 0]}`. The base definition strips
  `transformation` so a rotated variant doesn't become the block default.
- `normalizeStateKey` must produce **every** property of the block, sorted by property name, values lowercased
  (`values.size !== properties.length` → reject). Rejection → `skipped(\`${path} [${stateKey}]\`, \`blockstate key doesn't name
  every ${block} property (${properties.join(", ")}) — Geyser looks the full state up in its registry and rejects the block if
  it's missing\`)`. Rationale: Geyser rebuilds `<block>[<key>]` and looks it up in a registry keyed by `BlockState.toString()`
  in `Blocks`-table order (alphabetical for these blocks); Nexo writes `instrument=harp,powered=false,note=0`, which must be
  reordered.
- Emits `ctx.geyserBlocks["minecraft:<block>"] = {...base, only_override_states: true, state_overrides: overrides}` and
  `converted(path, [\`${converted} custom block state(s) mapped\`])`. `base` is the first successfully-converted variant
  (`name ?? safeName(variant.model)`).

`MECHANIC_BLOCKS`: `note_block: [instrument, note, powered]`, `tripwire: [attached, disarmed, east, north, powered, south, west]`,
`mushroom_stem`/`brown_mushroom_block`/`red_mushroom_block`/`chorus_plant`: `[down, east, north, south, up, west]`,
`cave_vines: [age, berries]`, `cave_vines_plant: [berries]`, `sugar_cane: [age]`.

**`buildBlockDefinition`:**

- Full-cube test: exactly one element whose `from` is all `0` and `to` is all `16`. Then per face of
  `FULL_CUBE_FACES = ["up","down","north","south","east","west"]` resolve textures.
  - Single unique texture → `materials["*"] = {texture: key, render_method: "alpha_test"}`.
  - Multiple → one material per face plus a wildcard fallback set to `Object.values(materials)[0]` (Bedrock needs `"*"`).
  - `geometry: {identifier: "minecraft:geometry.full_block"}`.
- Non-cube → `buildAtlas` of the face textures (flipbook strips cropped to first frame), `alphaBleed`, write `<atlasPath>.png`,
  register via `registerTerrainTextureRaw(ctx, \`gcb_${name}\`, atlasPath)`, build geometry `geometry.geyser_custom.block_${name}`
  in `models/blocks/geyser_custom/<name>.geo.json`, and report `approximated(modelId, "non-cube block model converted with
  item-style geometry math — verify orientation in-game")`. `material_instances: {"*": {texture: textureKey, render_method: "alpha_test"}}`.

**`terrainTextureKey(textureId)` (exported, for `flipbooksStage`)** =
`` `gcb_${fitPathName(safeName(textureId), BLOCK_TEXTURE_PATH_RESERVED)}` ``. `registerTerrainTexture` returns the existing key
unchanged when `terrainTextures.has(key)`, and uses `decodeCachedForEdit` (not `decodeCached`) because `alphaBleed` writes into
the image and the cached instance is shared. `registerTerrainTextureRaw` always creates a fresh key, suffixing `_2`, `_3`, …
while taken — a non-cube model and a face texture can `safeName` to the same string (`oraxen:block/ruby_block` both ways), and
repointing the existing key would make the earlier block render this one's atlas.

### 2.8 `flipbooksStage` — `"flipbooks"` · position 8

**Reads:** `ctx.java` (`.png.mcmeta` files, textures), `ctx.terrainTextures`, `ctx.geometryHandledTextures`.
**Writes:** `ctx.bedrock.writeJson("textures/flipbook_textures.json", flipbooks)` — an **array**, not an object.

Iterates `ctx.java.list({prefix:"assets/", suffix:".png.mcmeta"})`; parses with `parseLenientJson`; skips when
`meta?.animation === undefined`. `texturePath = path.slice(0, -".mcmeta".length)`.

- **Vanilla path** (`assets/minecraft/textures/block/`): `remapVanillaTexture(texturePath)`; skip when undefined.
  `remap.outputPaths[0]` is used (block textures map to exactly one Bedrock path and are never TGA). Entry:
  `flipbook_texture = remapPath.slice(0, -".png".length)`, `atlas_tile = remapPath.slice("textures/blocks/".length, -".png".length)`,
  `ticks_per_frame = frameTicks(anim.frametime)`. `frames` → indices only (`typeof f === "number" ? f : f.index`); any frame object
  carrying `time` → `approximated(path, "per-frame times not supported on Bedrock — uniform frametime used")`.
  `interpolate === true` → `blend_frames = true`.
- **Custom block path**: regex `/^assets\/([^/]+)\/textures\/block\/(.+)$/` → `textureId = \`${ns}:block/${name without .png}\`` →
  `atlasTile = terrainTextureKey(textureId)`; **skip when `ctx.terrainTextures.get(atlasTile)` is undefined** (blocksStage never
  registered it). Otherwise reuse `registered.textures` verbatim as `flipbook_texture` — inventing a tile name from the filename
  produced a key Bedrock couldn't resolve *and* shipped a duplicate texture the optimizer couldn't sweep.
- **Other custom textures**: skipped unless `texturePath.includes("/textures/item/")` **and**
  unless `ctx.geometryHandledTextures.has(texturePath)` → `skipped(path, "animation on a non-block texture — Bedrock only
  animates atlas textures via flipbook_textures.json")`.

### 2.9 `soundsStage` — `"sounds"` · position 9

**Reads:** `ctx.java` (`assets/<ns>/sounds/**/*.ogg`, `assets/<ns>/sounds.json`).
**Writes:** `.ogg` copies and `sounds/sound_definitions.json`.

Per namespace — copy every `.ogg` under `assets/<ns>/sounds/`; when `ns === "minecraft"` also land the same bytes where Bedrock's
own definitions look (`sounds/<path>.ogg` with no namespace, often a different path). Then read `assets/<ns>/sounds.json`;
`eventId = ns === "minecraft" ? event : \`${ns}:${event}\``. Each sound entry: string → `{name}`; missing-file check →
`approximated(\`assets/${ns}/sounds.json → ${eventId}\`, \`references ${loc.namespace}:${loc.path} which is not in the pack
(vanilla Java sound?) — will be silent on Bedrock\`)`. The emitted name is `` `sounds/${loc.namespace}/${loc.path}` `` with
`volume`/`pitch`/`stream` copied only when defined. `sounds.length === 0` → the event is dropped.

**`mapCategory`:** identity for `master, music, record, weather, hostile, neutral, player, block, ambient`;
`voice → "ui"` (closest Bedrock category); `default → "neutral"`.

Output JSON: `{format_version: "1.14.0", sound_definitions: definitions}` — a **string** version literal, written only when at
least one definition exists. This file is also the gate the optimizer uses for sound sweeping.

### 2.10 `langStage` — `"lang"` · position 10

**Reads:** `ctx.java.namespaces()`, `assets/<ns>/lang/*.json`. **Writes:** `texts/<bedrockCode>.lang`, `texts/languages.json`.

Merges every namespace's `lang/<code>.json` into `locales: Map<bedrockCode, Map<key,value>>` (later namespaces override earlier
keys; non-string values dropped). Unparseable file → `error(path, "could not parse lang file")`. Early return when
`locales.size === 0`.

Value conversion: `.replace(/%(\d+)\$[sdefgxXcboh]/g, "%$1")` (Java positional args → Bedrock `%1`), then
`.replace(/\r?\n/g, "\\n")`. A real newline must become the literal escape `\n` and **not** `%1`, which is a positional parameter
and would substitute an argument into the line break. Written as `lines.join("\n") + "\n"`; `texts/languages.json` =
`[...locales.keys()].sort()`.

`toBedrockLocale`: lowercase, split on `_`; two parts → `xx_YY` (uppercased region); otherwise unchanged.

### 2.11 `fontsStage` — `"fonts"` · position 11
**Reads:** `ctx.java` (`assets/<ns>/font/*.json`, provider textures), `ctx.textureCache`.
**Writes:** `font/glyph_XX.png` per page (`hexPage = page.toString(16).toUpperCase().padStart(2,"0")`).

**Pass 1 (collect)** — per namespace, per `assets/<ns>/font/*.json` with `providers`:

- Non-`bitmap` provider → `skipped(path, \`font provider type "${provider.type}" has no Bedrock equivalent\`)`. Missing
  `file`/`chars` → silent continue.
- `loc = parseResourceLocation(provider.file.replace(/\.png$/, ""))`, `texPath = assets/<ns>/textures/<path>.png`; decode failure →
  `skipped(path, \`bitmap font texture ${provider.file} missing\`)`.
- `ascent = provider.ascent ?? 0`; `Math.abs(ascent) > MAX_SANE_ASCENT (64)` → count the codepoints into `hiddenGlyphs` and drop
  the provider (packs hide glyphs with e.g. `ascent: -42069`; rendering them normally would make deliberately hidden elements
  visible).
- Grid: `rows = provider.chars.length`, `cols = [...provider.chars[0]].length`, `cellW = Math.floor(image.width/cols)`,
  `cellH = Math.floor(image.height/rows)`. Per char: skip `cp === 0 || cp === 32` (padding), skip `cp > 0xffff`; first definition
  wins via `taken`; `page = cp >> 8`, `index = cp & 0xff`; `height = provider.height ?? 8`.
- Per file with glyphs → `approximated(path, \`${glyphs} glyph(s) placed at native resolution with the Java ascent baked into the
  cell — height scaling and space-provider offsets have no Bedrock equivalent\`)`; per file with hidden glyphs → `skipped(path,
  \`${hiddenGlyphs} glyph(s) hidden in Java by an off-screen ascent (|ascent| > ${MAX_SANE_ASCENT}) — Bedrock cannot offset that
  far, so they are dropped rather than shown\`)`.

**Pass 2 (per page)** — `RESERVED_PAGES = new Set([0x00])`, so page 0 (Basic Latin + Latin-1) is **never** emitted, reported
`skipped(\`glyph page U+${hexPage}xx\`, \`${all.length} glyph(s) override ordinary text characters — emitting this page would
replace Bedrock's own sheet and blank every character the pack doesn't define\`)`.

- `medianHeight = Math.max(1, heights[heights.length >> 1])` (upper-middle of the sorted list — no averaging for even counts).
- `cell = Math.min(MAX_CELL (128), Math.max(16, ...all.map(g => Math.max(g.w, g.h))))` → sheet `cell*16 × cell*16`. `MAX_CELL`
  rationale: desktop caps pack textures at 4096, lower on mobile, and a sheet over the cap takes every glyph on the page with it.
- `perUnit = (cell * MEDIAN_COVERAGE (0.75)) / medianHeight`; `topAscent = Math.max(...all.map(g => g.ascent))`.
- Per glyph: `wanted = Math.min(g.height * perUnit, cell) / g.h`; `scale = Math.min(wanted, cell / g.w)` — **whichever bound
  binds first** (clamping axes separately keeps full height while squashing width, which is how a 4:1 banner got drawn into a
  square). `scale < wanted * 0.9` increments `widthBound`. `drawW = Math.max(1, Math.round(g.w*scale))`,
  `drawH = Math.max(1, Math.round(g.h*scale))`, `dyOff = Math.max(0, Math.min(Math.round((topAscent - g.ascent) * perUnit),
  cell - drawH))`, `dx = (g.index % 16) * cell`, `dy = Math.floor(g.index / 16) * cell + dyOff`.
- Any `widthBound` → `approximated(\`glyph page U+${hexPage}xx\`, \`${widthBound} wide glyph(s) (banners, rank pills) render
  shorter than their Java height — a Bedrock glyph is confined to one square cell, so width runs out first and scaling to the
  declared height would squash them\`)`.
- `scaledBlit` is nearest-neighbour (pixel-art glyphs; bilinear blurs 8px icons at cell scale) and clips on all four edges.

**Invariant:** source resolution is deliberately absent from `perUnit` — Java scales a provider texture to its `height`, so an
8px and a 96px source with the same `height` must land the same size.

### 2.12 `guiStage` — `"gui"` · position 12

**Reads:** `ctx.java` (`assets/<ns>/textures/gui/**/*.png`), `ctx.options` (`namespaces`, `pngEncoder`), `ctx.textureCache`.
**Writes:** `textures/ui/<name>.png` and, for a detected panel, `textures/ui/<name>.json`.

**Why this stage exists.** The two editions build screens differently, and the stage encodes that rather than pretending
a rename would do it:

- **Java** blits one sheet per screen — a custom container is a single 176×166 `textures/gui/container/style.png`, and
  the HUD is one 256×256 `icons.png` atlas of sprite tiles.
- **Bedrock** assembles screens in JSON UI out of **nine-sliced panels**. Every `textures/ui/*.png` carries a sidecar
  `.json` declaring how thick the fixed border is; the engine keeps the border and stretches the middle.

**Algorithm.** One walk over `assets/`, matching `/^assets\/([^/]+)\/textures\/gui\/(.+)\.png$/`:

- `namespace === "minecraft"` → look up `VANILLA_GUI_TARGETS` (only `options_background` and `light_dirt_background`;
  a deliberately short table, since an entry is a claim that the art lines up). A hit is copied **byte-for-byte**, not
  re-encoded, and gets **no sidecar** — the file it replaces already has its slicing defined by Bedrock. A miss is
  `skipped` with the structural reason: Bedrock composes those screens from separate panels plus a JSON UI layout, so
  one sheet cannot map onto them.
- Custom namespace → `decodeCached` (read-only; the shared decode is safe), then `detectNineSlice`.
  - **Panel detected** → `textures/ui/<name>.png` plus `textures/ui/<name>.json` carrying
    `{ nineslice_size, base_size }`, reported `converted` with one entry naming both outputs.
  - **No panel** → `textures/ui/<name>.png` with **no sidecar**, reported `approximated`: Bedrock stretches a texture
    that has no sidecar, which is exactly right for a button face or an icon. Claiming a slice here would tear the art.
- Names go through `fitPathName(safeName(...), UI_PATH_RESERVED)` where `UI_PATH_RESERVED = "textures/ui/.json".length`.

**Encoding is batched.** Jobs accumulate and flush through `ctx.options.pngEncoder` when there are
`ENCODE_POOL_THRESHOLD (24)` or more, timed as `png.encode.pool`; below that they encode in-process. A pack with a
hundred GUI sprites would otherwise encode every one on the main thread.

**`texturesStage` cooperation.** `gui` is in both `VANILLA_TEXTURE_CATEGORIES` and `HANDLED_BY_STAGE`, so
`texturesStage` neither remaps nor reports these files — this stage owns them, and a double report would be noise.

**Nine-slice detection** lives in `image/nineSlice.ts` and is the only interesting logic on this path. It tests the
property that makes a slice valid: **a border strip must be constant along its own thickness**. A 3px top border is
three horizontal lines repeating left to right; if a column holds two colours within those three rows, the strip is
artwork and slicing it would tear it. The search runs `k` from `min(floor(min(w,h)/3), 24)` down to 2, so it finds the
largest legal border, and a single-pixel border is rejected because any image would pass it.

### 2.13 `paintingsStage` — `"paintings"` · position 13

**Reads:** `ctx.java.list({prefix:"assets/minecraft/textures/painting/", suffix:".png"})`, `ctx.textureCache`.
**Writes:** `textures/painting/kz.png` (one combined atlas) — only when at least one known painting was decoded.

Unknown name → `skipped(path, \`unknown painting "${name}" — not in the Bedrock kz.png atlas\`)`.
`scale = Math.max(scale, Math.round(img.width / slot[2]))`; `cappedScale = Math.min(Math.max(1, scale), MAX_ATLAS_SCALE (16))`;
when clamped → `approximated("textures/painting/kz.png", \`source paintings are ${scale}× the atlas slot size; downscaled to
${cappedScale}× so the atlas stays within Bedrock's ${256*16}px texture limit\`)` (4096). Canvas `createImage(256*scale, 256*scale)`;
each painting `scaleNearest(img, w*scale, h*scale)` blitted row by row at `(x*scale, y*scale)`; per painting
`converted(prefix+name+".png", ["textures/painting/kz.png"])`.

`PAINTING_SLOTS` is a 26-entry `Record<string,[x,y,w,h]>` in the pre-1.14 `paintings_kristoffer_zetterstrand.png` layout
(`kebab [0,0,16,16]` … `skeleton [192,64,64,48]`, `donkey_kong [192,112,64,48]`). Gaps: `wasteland [96,0]`, `back [192,0]`.

When `images.size < Object.keys(PAINTING_SLOTS).length` → `approximated("textures/painting/kz.png", \`pack overrides
${images.size} painting(s); the rest of the atlas is transparent — non-overridden paintings will be invisible on Bedrock.
Provide all paintings to avoid this.\`)`. A 4096px HD painting in a 16px slot would ask for factor 256 and a 65536² image
(~17 GB), which aborts the conversion — hence the cap.

### 2.14 `packagingStage` — `"packaging"` · position 13

**Reads:** `ctx.java.mcmeta?.pack?.description`, `ctx.java.read("pack.png")`, `ctx.options.packName`, `ctx.options.optimizePack`,
`ctx.itemTextures`, `ctx.terrainTextures`.

**Writes:** `manifest.json`; `pack_icon.png` (only when `pack.png` exists — reports `converted("packaging", "pack.png",
["pack_icon.png"])`); `textures/item_texture.json` (only when `itemTextures.size > 0`); `textures/terrain_texture.json`
(only when `terrainTextures.size > 0`).

Description fallback: `` `Converted from Java Edition by Loomery` `` when the Java description isn't a string.

Bedrock shapes: `{resource_pack_name, texture_name: "atlas.items", texture_data: Object.fromEntries(itemTextures)}`; terrain adds
`padding: 8`, `num_mip_levels: 4`, `texture_name: "atlas.terrain"`. Every call passes `!ctx.options.optimizePack` as the `pretty`
argument — but when `optimizePack` is true the VFS itself is in minify mode, so the argument is only meaningful in the
un-optimized path.

### 2.15 `optimizeStage` — `"optimize"` · position 14 · last · async

**Reads:** `ctx.options` (`optimizePack`, `maxCompression`, `recompressor`, `pngEncoder`), `ctx.java.namespaces()`, and the whole
`ctx.bedrock`. **Writes:** rewrites `ctx.bedrock` in place; one `converted("optimize", "lossless pack optimization", [...])` entry.
Early return when `!ctx.options.optimizePack`.

**Step 0 — dead-file elimination.** `referenced = collectReferencedTextures(ctx)` — a regex sweep
`/textures\/[A-Za-z0-9_\-./]+/g` over every `.json` in the pack, normalized by `stripExt`. Every `textures/**/*.png` not under a
`VANILLA_TEXTURE_ROOTS` prefix and not referenced is deleted.

- `VANILLA_TEXTURE_ROOTS = [textures/blocks/, textures/items/, textures/entity/, textures/environment/, textures/colormap/,
  textures/misc/, textures/models/, textures/map/, textures/painting/, textures/particle/, textures/gui/, textures/ui/,
  textures/trims/, textures/flame_atlas/]`.
- The sound sweep is gated on `ctx.bedrock.has("sounds/sound_definitions.json")` — a pack can ship `.ogg`s with no `sounds.json`
  (the server plays them by path via Geyser), and sweeping on that emptiness once deleted every sound while the report still
  listed each as converted. Only paths whose second segment is one of `ctx.java.namespaces()` are judged; vanilla replacements
  sit at un-namespaced paths the client's own definitions reference.
- `collectReferencedSounds` only inspects JSON paths containing `"sound"` and appends `.ogg` to each
  `/sounds\/[A-Za-z0-9_\-./]+/g` match.
- Report text is a single line: `` `${swept} unreferenced texture(s) removed, ${merged} duplicate texture(s) merged, ${reencoded}
  texture(s) re-encoded smaller, ${zopfliNote}, JSON minified — ${formatBytes(before - after)} saved (${before} → ${after} bytes
  uncompressed)` ``, emitted only when `before > after`. `zopfliNote` branches: max compression off → `max compression off (enable
  it for ~12% more off large textures)`; `zopflied === 0 && ctx.options.recompressor !== undefined` → `0 recompressed — this
  browser could not run the optimizer wasm; use the CLI/API for guaranteed max compression`; else
  `` `${zopflied} large texture(s) recompressed` ``.

**Step 1 — duplicate merge.** Hash every non-vanilla-root `textures/**/*.png` with `fastHash`; later duplicates are deleted and
recorded in `rewrites` as `stripExt(path) → stripExt(canonical)` (extension-less, matching how references are written).

**Step 2 — passthrough re-encode.** `passthrough` = every `.png` **not** starting with one of `GENERATED_PNG_PREFIXES =
["textures/geyser_custom/", "font/", "textures/painting/", "textures/entity/chest/"]` — those already came out of `encodePng`, so
re-encoding is deterministic busy-work. Batching is by `chunkByPixels` against `DECODE_PIXEL_BUDGET = 16 * 1024 * 1024` pixels
(~64 MB RGBA regardless of file size), with dimensions read from the IHDR (offsets 16/20, 24-byte minimum, nominal `16*16` when
unreadable). Decode failures are swallowed (ship the original). Encoder choice: pool when `encoder !== undefined &&
decoded.length >= ENCODE_POOL_MIN (8)`, else `encodePng`. Written only when `encoded[j].length < d.origLen`.

> **Losslessness caveat:** `decodePng` quantizes >8-bit channels, so 16-bit sources are visually but not bit-identical; 8-bit
> sources round-trip exactly.

**Step 3 — reference rewrite.** Only when `rewrites.size > 0`; every `.json` is parsed with `parseLenientJson` (unparseable files
are left untouched — never corrupt a file we can't parse) and re-stringified **compact** via
`JSON.stringify(rewriteStrings(value, rewrites))`, which replaces string values that *exactly* match a rewritten path, recursing
through arrays and objects.

**Step 4 — zopfli** (`ctx.options.maxCompression`). Candidates are every `.png` with `bytes.length >= ZOPFLI_MIN_BYTES (4096)`.
With a `recompressor` pool → `pool.run(all, (done,total) => ctx.progress("optimize", done, total))`; else a dynamic
`await import("../../image/zopfliPng.js")` and sequential `zopfliRecompressPng` — the dynamic import exists so the browser build
never loads the wasm. Per-file failure swallowed.

---

## 3. Cross-cutting notes

1. **`safeName` is exported from `itemsStage.ts`** and imported by `armorStage`, `blocksStage`, `bowPullStage`, `geometryStage`.
2. **`buildDefinition` (itemsStage) is exported** and called by `geometryStage`. It is the single choke point for
   `ctx.geyserMappings.items`, `ctx.usedBedrockIdentifiers` and `ctx.displayEntityMappings`.
3. **`terrainTextureKey` (blocksStage) is exported** purely for `flipbooksStage`.
4. **Path budgets** are all `fitPathName(name, reserved)`; `fitFilePath` is used for files Bedrock locates by their internal
   identifier. `MAX_PACK_PATH = 79`, hash suffix `HASH_CHARS = 8`.
5. **`textureCache` aliasing**: `decodeCached` returns a shared instance (mutators must `cloneImage` first — the items tint path
   and armor do); `decodeCachedForEdit` exists for the one place that wants to mutate.
6. **`frameTicks`** normalizes fractional/string `frametime` to `Math.max(1, Math.round(n))` at every read site.
7. **Report stage keys are not always the pipeline stage name**: `items` also emits `"items-hints"`; `items-3d` also gets the
   pipeline-level "internal error" entry; `pipeline.ts` adds `"ingest"`, `"merge"`, `"furniture"`, `"config-nudge"`, `"modelengine"`.
8. **`ctx.bedrock` is constructed with `new VirtualFs(opts.optimizePack)`** — so with `optimizePack: true`, every stage's `writeJson`
   emits compact JSON from the start, which is why `optimizeStage` has no JSON-minification pass of its own.
9. **`convertPack` never throws on a single failing stage** — the loop catches, reports `error(stage.name, "(stage)", …)`, and
   continues. Only the two pre-flight "Nothing to convert" checks throw.
