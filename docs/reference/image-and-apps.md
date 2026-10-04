# Reference — Image layer, reporting, vanilla tables, web & API apps

> Part of the Loomery reference set. See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the flow and
> [pipeline-and-stages.md](pipeline-and-stages.md) for the stages that call into this layer.

---

## Part A — Core image layer, reporting, entry point

### A1. `packages/core/src/image/png.ts`

Imports: `decode` from `fast-png`, `UPNG` default from `upng-js`, `{ unzlibSync, zlibSync }` from `fflate`,
`{ timeOp }` from `../report/timings.js`.

```ts
/** Always 8-bit RGBA. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array; // width * height * 4
}
```

**Invariant:** 8-bit RGBA only; `data.length === width * height * 4` always.

| Signature | Notes |
| --- | --- |
| `decodePng(bytes: Uint8Array): RgbaImage` | Wraps `decodePngUntimed` in `timeOp("png.decode", …)` |
| `decodeCached(read: (path: string) => Uint8Array \| undefined, path: string, cache: Map<string, RgbaImage \| undefined>): RgbaImage \| undefined` | Memoizes on `cache`. Returns the **shared** instance — mutators must not be applied. Catches decode errors and caches `undefined` (one bad file never aborts a stage) |
| `decodeCachedForEdit(read, path, cache): RgbaImage \| undefined` | `decodeCached` + `cloneImage`. Use from any caller that mutates |
| `cloneImage(image: RgbaImage): RgbaImage` | `data.slice()` |
| `repairPngStream(bytes: Uint8Array): Uint8Array \| undefined` | Rebuilds only the IDAT stream with a valid adler32; other chunks byte-copied. `undefined` if not PNG / no IDAT / inflate fails |
| `sanitizePng(bytes: Uint8Array): Uint8Array` | Returns `bytes` unchanged when `pngChecksumValid`, else `repairPngStream(bytes) ?? bytes` |
| `encodePng(image: RgbaImage): Uint8Array` | Strategy: grayscale (type 0) vs indexed (type 3) vs UPNG RGBA, smallest wins |
| `pngChunk(type: string, data: Uint8Array): Uint8Array` | `len(4) + type(4) + data + crc32(4)`, total `12 + data.length` |
| `encodeIndexedPng(image: RgbaImage): Uint8Array \| undefined` | `undefined` when >256 colours |
| `encodeGrayscalePng(image: RgbaImage): Uint8Array \| undefined` | `undefined` unless every pixel is fully opaque and `r === g === b` |
| `createImage(width: number, height: number): RgbaImage` | Zero-filled |
| `scaleNearest(src: RgbaImage, width: number, height: number): RgbaImage` | Returns `src` itself when dimensions already match (no copy) |
| `blendOver(base: RgbaImage, top: RgbaImage): void` | In-place, sizes must match |
| `tint(image: RgbaImage, rgb: number): void` | In-place multiply by `0xRRGGBB` |
| `firstFrame(image: RgbaImage): RgbaImage` | Crops a vertical flipbook to `width × width`. When `height <= width` returns a copy |
| `alphaBleed(image: RgbaImage): void` | In-place 1-pixel 4-connected fill of transparent pixels from opaque neighbours. Order: right, left, down, up |
| `crop(image, x, y, w, h): RgbaImage` | Clips both axes; out-of-bounds rows skipped |
| `rotate180(image: RgbaImage): RgbaImage` | |
| `flipVertical(image: RgbaImage): RgbaImage` | |
| `blit(dst: RgbaImage, src: RgbaImage, x: number, y: number): void` | Overwrite, no blending, clipped to dst |
| `compositeLayers(layers: RgbaImage[]): RgbaImage` | Throws `new Error("no layers to composite")` on empty. Single layer → copy. Otherwise `blendOver` bottom-first into `max(w) × max(h)`, each layer `scaleNearest`-ed up |

**Non-exported internals:**

- `decodePngUntimed` — on `decode` throw, retries `decode(repairPngStream(bytes))`; rethrows the original error if repair
  fails.
- `PALETTE_FALLBACK = [0, 0, 0, 255]` — used for palette indices the PNG does not define.
- `pngChecksumValid` — compares the trailing 4 bytes of the zlib stream against `adler32(raw)`. Returns `true` on any
  parse uncertainty (deferring failure to the decoder).
- `adler32` (mod `65521`), `concat`, `crc32` (polynomial `0xedb88320`, lazily built `CRC_TABLE`), `assemblePng`.
- `PNG_SIGNATURE = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]`.
- `GRAY_DEPTHS = [{depth:1,step:255},{depth:2,step:85},{depth:4,step:17},{depth:8,step:1}]`.

**Constants and behaviours to preserve:**

- Palette/indexed bit-depth selection: `count <= 2 ? 1 : count <= 4 ? 2 : count <= 16 ? 4 : 8`.
- Bail rule: `if (seen.size === 256) return undefined;` — the 257th distinct colour sends the image to the RGBA path.
- `zlibSync(raw, { level: 9 })` for indexed/grayscale IDAT; `{ level: 1 }` in `repairPngStream`.
- `out[9] = 3` (indexed colour type) / `out[9] = 0` (grayscale) in IHDR.
- Fast path: depth 8 + channels 4 + `src.length === out.length` → a single `out.set(src)`.
- Palette entry sort: transparent entries first (shortest tRNS), then frequency descending; `Array#sort` stability
  preserves first-seen order on ties.
- `alphaBleed` never writes alpha, so source-set membership is visit-order independent.
- The PNG-checksum repair exists because ItemsAdder / "texture protection" tooling ships PNGs with a wrong IDAT zlib
  checksum that Minecraft's lenient loader ignores.

> **Mutation safety is opt-in.** `decodeCached` returns the shared instance; `tint`, `alphaBleed`, `blendOver` and
> `blit` mutate in place → anything mutating must go through `decodeCachedForEdit` or clone explicitly.

### A2. `packages/core/src/image/atlas.ts`

```ts
export interface AtlasPlacement {
  x: number;      // Pixel offset of this texture's tile in the atlas
  y: number;
  width: number;  // Original texture size in pixels
  height: number;
}
export interface Atlas {
  image: RgbaImage;
  placements: Map<string, AtlasPlacement>;
}
export function buildAtlas(textures: Map<string, RgbaImage>): Atlas
```

Timing category: `timeOp("atlas.build", …)`.

- Throws `new Error("atlas needs at least one texture")` when empty.
- `shelfWidth = Math.ceil(Math.sqrt(ids.length)) * maxW` where `maxW = Math.max(...widths)`.
- Order: `ids.sort((a, b) => textures.get(b)!.height - textures.get(a)!.height)` — height descending, stable.
- Shelf packer: new row when `x > 0 && x + tex.width > shelfWidth` → `y += shelfH; x = 0; shelfH = 0`.
- `placements` is a `Map` keyed by texture id, so packing order never affects geometry UVs.
- Final size: `atlasW = max over rows of x`, `atlasH = y + shelfH`; then `blit` each placement.
- For uniform tile sizes the layout is byte-identical to the older `ceil(sqrt(n)) × maxW` grid.

### A3. `packages/core/src/image/modelRender.ts`

```ts
export interface FaceTextureLookup {
  (element: JavaElement, face: JavaFaceName): { image: RgbaImage; uv: [number, number, number, number] } | undefined;
}
export function renderModelIcon(
  elements: JavaElement[],
  lookup: FaceTextureLookup,
  guiDisplay: JavaDisplayTransform | undefined,
  size = 64,
  textureSize: [number, number] = [16, 16],
): RgbaImage
```

Timing category: `timeOp("icon.render", …)`.

Private: `FACE_SHADE: Record<JavaFaceName, number> = { up: 1.0, down: 0.5, north: 0.8, south: 0.8, east: 0.6,
west: 0.6 }`; `faceCorners(face, from, to)` (corner order matches Java UV orientation, `u1v1` = top-left);
`rotate(v, axis, degrees, origin)`; `interface ProjectedFace { pts; depth; uv; image; shade }`;
`renderModelIconUntimed`; `drawTriangle(target, pts, uvs, texture, shade)`.

- Default GUI rotation: `const rotationDeg = guiDisplay?.rotation ?? [30, 225, 0];` with `const center: Vec3 = [8,8,8];`
- Rotation order: `R = Rx·Ry·Rz`, applied Z first then Y then X — matching vanilla `ItemTransform` (verified against
  in-game GUI renders).
- Fit: `const span = Math.max(maxX - minX, maxY - minY) || 1; const scale = (size * 0.92) / span;` — the `0.92` margin
  is the only fit constant.
- `toScreen` flips Y: `size - ((y - minY) * scale + offY)`.
- Painter's algorithm: `faces.sort((a, b) => a.depth - b.depth)`, `depth = sum(z of 4 corners) / 4`.
- Each quad → two triangles: `0-1-2` and `0-2-3`, UVs `(u1,v1)(u2,v1)(u2,v2)(u1,v2)`.
- UVs are normalized to 0–1 by the caller, so `drawTriangle` is resolution-agnostic.
- `element.shade === false → shade = 1.0`; otherwise `FACE_SHADE[faceName]`.
- Nearest-neighbour sampling only; no mipmaps, no filtering.
- Alpha cutout inside `drawTriangle`: `const alpha = texture.data[si + 3]!; if (alpha < 8) continue;`
- Barycentric screen-space interpolation (no perspective divide), with `px = x + 0.5, py = y + 0.5`.

### A4. `packages/core/src/image/zopfliPng.ts`

```ts
export async function zopfliRecompressPng(bytes: Uint8Array): Promise<Uint8Array | undefined>
```

Single export. Returns the rebuilt PNG only when smaller than the input; `undefined` on invalid input or no win.

- `const MAX_RAW_BYTES = 4 * 1024 * 1024;` — files whose inflated scanline data exceeds this are skipped ("would make
  zopfli take forever").
- `const numiterations = raw.length <= 64 * 1024 ? 10 : 5;`
- Rejects input shorter than `8 + 12` bytes and anything not starting with the PNG signature.
- Chunk walk: all IDATs collapse into a single `"idat"` slot in `ordered`, preserving relative chunk order.
- `if (packed.length >= zlibData.length) return undefined;` then a final `out.length < bytes.length` guard.

> The browser pool uses `@jsquash/oxipng`, **not** this function. This is the node/in-process path.

### A5. `packages/core/src/image/tga.ts`

```ts
export function encodeTga(image: RgbaImage): Uint8Array
```

- 18-byte header; output length `18 + width * height * 4`.
- `out[2] = 2` (uncompressed true-colour), `out[16] = 32` (bpp), `out[17] = 8` (8 alpha bits, bottom-left origin,
  descriptor bit 5 clear).
- Width/height little-endian at offsets 12–15.
- Rows written bottom-to-top (`const src = (height - 1 - y) * width * 4;`).
- Channel order B, G, R, then **alpha flipped**: `out[dst + 3] = 255 - data[p + 3]!;`
- Bedrock's legacy entity textures (banners, villager professions, a few mobs) are looked up by the `.tga` extension;
  writing PNG bytes under a `.tga` name renders nothing. Bedrock's alpha convention is inverted relative to PNG
  (0 = opaque, 255 = transparent).
- Consumer: `texturesStage` branches on `TGA_TEXTURE_OUTPUTS`.

### A6. `packages/core/src/report/report.ts`

```ts
export type ConversionStatus = "converted" | "approximated" | "skipped" | "error";

export interface ReportEntry {
  /** Pipeline stage that produced this entry, e.g. "textures", "items-2d". */
  stage: string;
  /** Source path or logical identifier in the Java pack. */
  source: string;
  status: ConversionStatus;
  /** Output path(s) in the Bedrock pack, when applicable. */
  outputs?: string[];
  /** Human-readable explanation, mandatory for approximated/skipped/error. */
  detail?: string;
}

export class ConversionReport {
  readonly entries: ReportEntry[] = [];
  add(entry: ReportEntry): void;
  converted(stage: string, source: string, outputs?: string[]): void;
  approximated(stage: string, source: string, detail: string, outputs?: string[]): void;
  skipped(stage: string, source: string, detail: string): void;
  error(stage: string, source: string, detail: string): void;
  toJSON(): { summary: Record<ConversionStatus, number>; entries: ReportEntry[] };
}
```

- `converted` omits `detail` entirely; `skipped`/`error` omit `outputs` (field absent, not `undefined`).
- `toJSON` initializes all four statuses to `0` and counts by `e.status`, so the summary always has exactly 4 keys.
- `"config-nudge"` stage entries are read by `ResultView`'s `ConfigNudgeBanner`.

### A7. `packages/core/src/report/timings.ts`

```ts
export interface OpStat { count: number; totalMs: number; }

export class Timings {
  readonly stages: { name: string; ms: number }[] = [];
  readonly ops = new Map<string, OpStat>();
  stage(name: string, ms: number): void;      // pushes { name, ms: Math.round(ms) }
  record(category: string, ms: number): void;  // increments count, adds totalMs
  toJSON(): { totalMs: number; stages: { name; ms }[]; ops: { category; count; totalMs }[] };
}

export function beginTimings(timings: Timings): void;   // sets module-global `active`
export function finishTimings(): void;                  // clears `active`
export function timeOp<T>(category: string, fn: () => T): T;
export async function timeOpAsync<T>(category: string, fn: () => Promise<T>): Promise<T>;
```

- Module state: `let active: Timings | undefined;` — the hot-op sink is **global and single-flight**.
- Clock resolved once at module load from `globalThis.performance?.now` else `Date.now`.
- `timeOp`/`timeOpAsync` early-return `fn()` when `active === undefined` (zero overhead) and record in a `finally`, so
  throwing functions are still timed.
- `toJSON().totalMs = Math.round(sum of stage ms)`; `ops` sorted descending by `totalMs`.
- **Documented caveat:** the sink assumes one conversion in flight. Overlapping `convertPack` calls at await points
  (e.g. concurrent API requests) can misattribute hot-op costs. Output is never affected — only metrics.
- Observable op categories: `"png.decode"`, `"png.encode.gray"`, `"png.encode.indexed"`, `"png.encode.rgba"`,
  `"atlas.build"`, `"icon.render"`, plus `"png.encode.pool"`, `"atlas.hash"`, `"geometry.build"`, `"json.write"` from
  the stages.

### A8. `packages/core/src/index.ts` — the full public surface

```ts
export { convertPack, type ConvertResult } from "./convert/pipeline.js";
export type { ConvertOptions, ProgressCallback } from "./convert/context.js";
export { VirtualFs } from "./io/vfs.js";
export { readZip, readZipDetailed, writeZip, type ReadZipResult } from "./io/zip.js";
export { JavaPack, parseResourceLocation } from "./java/javaPack.js";
export { resolveTextureRef, inferHostItemFromModel } from "./resolve/modelResolver.js";
export { ConversionReport, type ReportEntry, type ConversionStatus } from "./report/report.js";
export { Timings } from "./report/timings.js";
export type { PngRecompressor, PngEncoder, RawImage } from "./convert/context.js";
export { zopfliRecompressPng } from "./image/zopfliPng.js";
export { encodePng, decodeCached } from "./image/png.js";
export { deterministicUuid, buildManifest } from "./bedrock/manifest.js";
export { parseOraxenConfigZip, parseOraxenConfigZips, type OraxenHints } from "./java/oraxen.js";
export { mergeJavaPacks, type MergeInput, type MergeResult, type MergeConflict } from "./java/mergePacks.js";
export { isDatapack, parseDatapack } from "./java/datapack.js";
export { extractBowPullGroups, type BowPullGroup, type BowPullStage } from "./java/itemVariants.js";
export { buildBowPullRenderController, buildBowPullAttachable } from "./bedrock/attachable.js";
```

Not re-exported (internal; tests import by deep path): `buildGeometry`, `defaultUv`, `buildItemAttachable`,
`buildFlipbookRenderController`, `buildDisplayAnimations`, `buildArmorAttachable`, `buildElytraAttachable`,
`resolveModel`, `spriteLayers`, `bbmodelToGeometry`, `bbmodelToAnimations`, `buildModelEngineInput`,
`lookupBuiltinModel`, `BUILTIN_MODELS`, `ARMOR_SLOTS`, `buildAtlas`, `renderModelIcon`, `firstFrame`, `encodeTga`,
`extractLegacyVariants`, `extractModernVariants`, `inferHostItemFromDefinition`, `parseLenientJson`,
`remapVanillaTexture`, `remapVanillaSound`.

---

## Part B — Vanilla data tables

`packages/core/src/data/` contains exactly three files: `builtinModels.ts` (see
[bedrock-emitters.md](bedrock-emitters.md) §11), `vanillaSoundMap.ts`, `vanillaTextureMap.ts`.

### B1. `packages/core/src/data/vanillaTextureMap.ts`

| Line | Export | Type | Count |
| --- | --- | --- | --- |
| 16 | `BLOCK_RENAMES` | `Record<string, string>` | 810 |
| 850 | `ITEM_RENAMES` | `Record<string, string>` | 405 |
| 1288 | `EXTRA_TEXTURE_MAP` | `Record<string, string \| string[]>` | 580 |
| 1893 | `TGA_TEXTURE_OUTPUTS` | `Set<string>` | 69 |
| 1965 | `TextureRemapResult` | interface | — |
| 1982 | `remapVanillaTexture` | `(javaPath: string) => TextureRemapResult \| undefined` | — |

Private helpers: `textureOutputPath(relative)` (2059), `armorMaterial(java)` (2070).

```ts
export interface TextureRemapResult {
  /**
   * Bedrock-relative output path(s), e.g. "textures/blocks/log_oak.png". A few
   * Java textures fan out to several Bedrock ones — the creeper skin also feeds
   * the creeper head block, and a cat skin feeds both its Bedrock variants —
   * so this is a list rather than a single path.
   */
  outputPaths: string[];
  /** True when the path was found in a mapping table (exact match). */
  exact: boolean;
}
```

**Key format**

- `BLOCK_RENAMES` / `ITEM_RENAMES`: **bare filename, no directory, no extension**. Java name → Bedrock name.
  Examples: `grass_block_top: "grass_top"`, `dark_oak_log: "log_big_oak"`, `farmland_moist: "farmland_wet"`,
  `elytra_broken: "broken_elytra"`, `tropical_fish: "fish_clownfish_raw"`, `observer_back: "observer_back"` (identity
  by design), `music_disc_relic: "record_relic"`, `white_bed: "bed_white"`.
- `EXTRA_TEXTURE_MAP`: **quoted path below `assets/minecraft/textures/`, no extension**. Java path → Bedrock path
  relative to `textures/`. Examples: `"armadillo/armadillo": "entity/armadillo"`,
  `"armorstand/armorstand": "entity/armor_stand"`, `"banner/border": "entity/banner/banner_border"`,
  `"entity/humanoid/wild": "trims/wild"`, plus the fan-out form `["textures/a","textures/b"]` for creeper/cat skins.
- `TGA_TEXTURE_OUTPUTS`: **quoted Bedrock-relative path without extension** (exactly the `EXTRA_TEXTURE_MAP` value
  form). Covers all 40 banner patterns plus `entity/blaze`, `entity/glow_squid/glow_squid_baby`,
  `entity/slime/magmacube_v2`, and all 15 `entity/villager2/professions/*` and 15
  `entity/zombie_villager2/professions/*`.

**Consumers.** Only `remapVanillaTexture` reads the tables wholesale; it is called by `texturesStage` and
`flipbooksStage`. `itemsStage` imports `ITEM_RENAMES` and reads it directly.

**`remapVanillaTexture` control flow (exact):**

1. `const match = javaPath.match(/^assets\/minecraft\/textures\/([^/]+)\/(.+)\.png$/);` → `undefined` if no match.
2. `switch (category)`:
   - `"block"` → `{ outputPaths: [\`textures/blocks/${renamed ?? name}.png\`], exact: renamed !== undefined }`.
   - `"item"` → `{ outputPaths: [\`textures/items/${renamed ?? name}.png\`], exact: renamed !== undefined }`.
   - `"models"` → matches `/^armor\/(.+?)_layer_(\d)(_overlay)?$/`; output
     `textures/models/armor/${material}_${layer}${overlay ?? ""}.png`, `exact: true`.
   - `"entity"` → matches `/^equipment\/(humanoid|humanoid_leggings)\/(.+)$/`; humanoid → layer `"1"`,
     humanoid_leggings → layer `"2"`; output `textures/models/armor/${material}_${layer}.png`, `exact: true`.
3. `const mapped = EXTRA_TEXTURE_MAP[name];` — **runs before the fallthrough and wins over the per-category guesses**.
   Array values map through `textureOutputPath`, `exact: true`.
4. Fallthrough (no verified mapping), by category: `"environment" | "colormap" | "misc" | "map"` →
   `textures/${category}/${name}.png`, `exact: false`; `"models"` → `textures/models/${name}.png`, `exact: false`;
   `"entity"` → `textures/entity/${name}.png`, `exact: false`; `default` (gui, painting, particle, font, mob_effect,
   trims) → `undefined`, meaning a dedicated stage owns it.

`textureOutputPath` prefixes `textures/`, returns `${path}.png` normally and `${path}.tga` when
`TGA_TEXTURE_OUTPUTS.has(relative)`.

`armorMaterial(java)`: `"chainmail" → "chain"`, `"turtle_scute" → "turtle"`, else identity. Deliberately centralized:
"Getting one wrong ships an armor layer Bedrock never loads."

**Documented strategy (file header):** 3-tier — (1) directory-level remap (`block→blocks`, `item→items`), (2) explicit
filename rename tables for names that differ (Bedrock kept many pre-flattening 1.12 names), (3) everything else passes
through with the same filename, which is correct for most 1.13+ content where Bedrock adopted parity names. Composite
textures (paintings atlas, particles atlas, chest stitching, clock/compass atlases) are handled by dedicated stages,
**not** this table.

`EXTRA_TEXTURE_MAP` header documents: Bedrock's layout diverges structurally — `entity/villager/profession/armorer` is
three directories deep on Java and two on Bedrock; armor moved to a different root entirely
(`entity/equipment/humanoid/*` → `models/armor/*_1`). "Every target here was verified to exist in Mojang's
bedrock-samples pack (11,756 texture paths); entries whose correct target could not be pinned to exactly one real path
were **dropped rather than guessed**."

Ported from GeyserMC/PackConverter's `mappings/textures.json` (MIT), then re-resolved: that file's own resolver doubles
the section name on three-level keys (`entity/banner/border` → `entity/entity/banner/...`), costing it ~6% of its
mappings.

Inline provenance markers exist in both rename tables (line 309 in `BLOCK_RENAMES`, line 995 in `ITEM_RENAMES`):
`// --- Ported from GeyserMC/PackConverter's mappings/textures.json (MIT).` Everything above the marker is Loomery's
own table; everything below came from PackConverter.

**The three known-wrong entries** (locked in by `test/vanillaTextureMap.test.ts`, test
`"carries the corrected values that the ported table proves wrong"`):

- `dark_oak_sapling: "sapling_roofed_oak"` — Bedrock's roofed-oak naming.
- `observer_back: "observer_back"` — the old value was wrong; the correct target happens to be an identity mapping.
- `tropical_fish: "fish_clownfish_raw"` — Bedrock uses the pre-1.13 name.

Entries Loomery keeps that PackConverter's table lacks: `ITEM_RENAMES.white_bed = "bed_white"`,
`ITEM_RENAMES.black_bed = "bed_black"` (PackConverter maps none of the 16 beds — "dropping these would un-name 16
textures"), `BLOCK_RENAMES.grass = "tallgrass"`, `ITEM_RENAMES.music_disc_relic = "record_relic"`,
`ITEM_RENAMES.scute = "turtle_shell_piece"`.

### B2. `packages/core/src/data/vanillaSoundMap.ts`

| Line | Export | Type | Count |
| --- | --- | --- | --- |
| 15 | `SOUND_RENAMES` | `Record<string, string \| string[]>` | 1303 |
| 1322 | `remapVanillaSound` | `(javaPath: string) => string[]` | — |

```ts
/** Bedrock sound paths (no extension) a Java vanilla sound path should be written to. */
export function remapVanillaSound(javaPath: string): string[] {
  const mapped = SOUND_RENAMES[javaPath];
  if (mapped === undefined) return [javaPath];
  return Array.isArray(mapped) ? mapped : [mapped];
}
```

Deliberately simpler than the texture map: **a miss returns the input path unchanged** — no `exact` flag, no
`undefined`.

Both sides are **quoted path strings relative to the sounds root, without extension**. Java ships `.ogg`, Bedrock's own
copies are `.fsb`, but Bedrock loads an `.ogg` dropped at the same path. Java source is
`assets/minecraft/sounds/<key>.ogg`; output is `sounds/<value>.ogg`.

Representative entries:

- `"ambient/cave/cave14": "cave/cave14"` — the canonical divergence example named in the header.
- `"ambient/underwater/additions/animal1": "ambient/underwater/additions_rare/animal1"`.
- `"ambient/underwater/underwater_ambience": "ambient/underwater/loop/underwater_ambience"` — pure directory insert.
- `"block/ancient_debris/break1": ["dig/ancient_debris1", "step/ancient_debris1"]` — one Java sound → two Bedrock paths.
- `"mob/zombified_piglin/zpig3": "mob/zombiepig/zpig3"` — pre-flattening Bedrock namespace.
- `"random/classic_hurt": "random/hurt"`.
- `"random/pop": ["random/pop", "random/pop2"]` — fan-out that includes the source path itself.
- `"ui/cartography_table/drawmap1": ["ui/cartography_table/drawmap1", "block/cartography_table/drawmap1"]` — the
  "also copy to the block namespace" pattern.
- `"ui/toast/in": "random/toast_recipe_unlocking_in"`, `"ui/toast/out": "random/toast_recipe_unlocking_out"`.

Header: replaces are detected as `assets/minecraft/sounds/<java path>.ogg`; Bedrock looks the same sound up at
`sounds/<bedrock path>`; the two layouts often diverge. **"Paths absent here are assumed identical."** — the
load-bearing fallback rule. Ported from PackConverter's `mappings/sounds.json` (MIT) and re-resolved against
bedrock-samples, keeping only entries resolving to exactly one real path. Unlike the texture map, there are **no**
known-wrong entries documented here and no provenance markers inside the body.

The same stage builds `sound_definitions.json` from `sounds.json`, and sound event identifiers keep their Java
namespace so server-side `playsound` commands pass through Geyser unchanged.

---

## Part C — The apps

### C1. `apps/web` — React + Vite SPA

#### C1.1 Package and build config

```json
{ "name": "@loomery/web", "private": true, "type": "module",
  "scripts": { "dev": "vite", "build": "tsc --noEmit && vite build", "typecheck": "tsc --noEmit", "preview": "vite preview" },
  "dependencies": { "@loomery/core": "workspace:*", "@jsquash/oxipng": "^2.3.0", "comlink": "^4.4.1",
                    "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { "@vitejs/plugin-react": "^4.3.0", "typescript": "^5.6.0", "vite": "^5.4.0" } }
```

`build` runs `tsc --noEmit` first, so a type error fails the deploy.
`apps/web/tsconfig.json` adds `lib: ["ES2022","DOM","DOM.Iterable","WebWorker"]`, `jsx: "react-jsx"`, `noEmit: true`,
`types: ["vite/client"]`, `include: ["src", "../../packages/core/src/types"]`.

```ts
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2022", rollupOptions: { output: { manualChunks: { "vendor-react": ["react", "react-dom"] } } } },
  server: { allowedHosts: true },
});
```

- `base: "./"` — relative assets so the same build works at a domain root (tunnel) and under a subpath (GitHub Pages).
- `worker: { format: "es" }` — **required** by the design: all workers are `new Worker(new URL("./x.worker.ts",
  import.meta.url), { type: "module" })`.
- `server.allowedHosts: true` — dev server accepts any Host header.

`index.html`: title `Loomery — Java → Bedrock Resource Pack Converter` (note the in-app `<h1>` says
"Geyser**Converter**", which matches neither the title nor the repo name). Mount `<div id="root">`, script
`/src/main.tsx`. All theming is inline CSS custom properties in a `<style>` block — no CSS file, no Tailwind:
`--bg: #0f1115`, `--panel: #1a1e26`, `--border: #2c3240`, `--accent: #34d399`, `--accent-dim: #10b98122`,
`--text: #e5e7eb`, `--muted: #9ca3af`, `--warn: #fbbf24`, `--err: #f87171`, `color-scheme: dark`.

`main.tsx` renders `<React.StrictMode><App /></React.StrictMode>`. StrictMode double-invokes effects in dev, which is
why the worker-terminate-on-unmount effect must be idempotent.

#### C1.2 `App.tsx` — the state machine

```ts
type Phase =
  | { kind: "idle" }
  | { kind: "converting"; stage: string; done: number; total: number; fileName: string }
  | { kind: "done"; result: ConvertResult; fileName: string; packName: string }
  | { kind: "error"; message: string };
```

| From | Event | To |
| --- | --- | --- |
| `idle` | "Convert pack" clicked with `packFiles.length > 0` | `converting` (`{ stage: "reading files", done: 0, total: 1, fileName: label }`) |
| `converting` | `onProgress` proxy fires (not stale) | `converting` with new `stage/done/total` |
| `converting` | `api.convert(…)` resolves (not stale) | `done` (`{ result, fileName: label, packName }`) |
| `converting` | promise rejects, or worker `onerror`/`onmessageerror` | `error` |
| `converting` | Cancel in `ProgressView` → `cancelConversion()` | `idle` |
| `done` | "Convert another" or `ConfigNudgeBanner`'s "Convert again with config" → `onReset` | `idle` |
| `error` | "Try again" | `idle` |

There is **no transition from `idle` on drop** — dropping merely stages files ("The pack is staged on drop, not
converted").

**React state:** `phase`; `attachableMaterial` (`"entity_alphatest_one_sided"`, select over
`entity_alphatest_one_sided` / `entity_alphatest` / `entity` / `entity_alphablend`); `modernBaseItem`
(`"minecraft:paper"`); `maxAnimationFrames` (`0` Full animation, `20`, `10` balanced, `5` small pack, `1` smallest);
`optimizePack` (`true`); `maxCompression` (`false`, shown only when `optimizePack`); `animate2dHeldItems` (`false`);
`oxipngLevel` (`4`, range 4–6, shown only when `optimizePack && maxCompression`, labels 4 "(fastest)",
6 "(smallest, slowest)", else "(balanced)"); `showOptions` (`false`); `configZips` (`{ name, bytes }[]`);
`packFiles` (`File[]`).

**Refs:**

- `workerRef` — raw handle, used only for `terminate()`.
- `apiRef` — the comlink proxy.
- `runId` — **the staleness guard.** Incremented on every cancel; each run captures `const myRun = runId.current` and
  checks `runId.current !== myRun` before every `setPhase`. Reading the staged files happens before the worker exists,
  so a Cancel in that window terminated nothing and the in-flight run would later overwrite the idle screen.
- `workerFailedRef` — a promise that **rejects** if the worker never starts (`onerror`/`onmessageerror`). A worker
  whose chunk is missing or whose module fails to parse leaves every comlink call pending forever, so the call is
  `Promise.race([failed, api.convert(…)])`. The promise gets `failed.catch(() => {})` attached so browsers don't log an
  unhandled rejection while idle.

Worker error strings (the only strings users see when a worker dies):

- `"The background converter failed to start"` + optional `` `: ${event.message}` `` + `". Reload the page and try
  again — if it keeps happening, your browser may be blocking module workers."`
- `"The background converter sent a message this page could not read. Reload and try again."`

`terminateWorker()` calls `workerRef.current?.terminate()` and nulls all three refs; the unmount effect prevents leaking
a thread. `cancelConversion()` = `runId.current++; terminateWorker(); setPhase({ kind: "idle" })`.

**The conversion call (exact argument order and transferables):**

```ts
api.convert(
  transfer(packs, packs.map((p) => p.buffer)),   // Uint8Array[] — zero-copy
  { packName, packNames, attachableMaterial, modernBaseItem, maxAnimationFrames,
    optimizePack, maxCompression, animate2dHeldItems },
  proxy((stage, done, total) => { … }),          // comlink proxy callback
  configZips.map((c) => { const copy = c.bytes.slice(); return transfer(copy, [copy.buffer]); }),
  oxipngLevel,
)
```

- Pack bytes are read concurrently (`Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())))`) —
  sequential reads left the UI pinned at 0% for seconds on a big stack.
- Config zips are **copied once** before transfer because `configZips` state may be reused on a later conversion and
  `transfer()` neuters the buffer.
- The progress proxy checks `stale()` before `setPhase`, which is how a cancelled run stops writing.

**`packName` derivation (load-bearing — feeds manifest UUIDs):**

```ts
const strip = (n: string): string => n.replace(/\.(zip|mcpack|tgz|tar\.gz)$/i, "");
const packName = files.length === 1
  ? strip(first.name)
  : `Merged: ${files.map((f) => strip(f.name)).join(" + ")}`;
const label = files.length === 1 ? first.name : `${files.length} packs`;
```

`packagingStage` derives both manifest UUIDs from `packName`, so a fixed `"Merged Pack"` gave every merged pack the same
identity and two different merged packs would overwrite each other on the Bedrock client.

**Layout:** header (`h1` "GeyserConverter"), Ko-fi support button, footer with the same link plus a "Source on GitHub"
link. `idle` → `DropZone` + compression-controls panel + plugin-config-zips panel + Advanced options + Convert button
(`disabled={packFiles.length === 0}`). `converting` → `ProgressView`. `done` → `ResultView`. `error` → inline panel with
`<strong>Conversion failed</strong>`, the message, and "Try again".

Exported style constant: `export const buttonStyle: React.CSSProperties` (imported by `ResultView.tsx`). Module-local:
`labelStyle`, `inputStyle`.

#### C1.3 `components/DropZone.tsx`

Props `{ onFiles: (files: File[]) => void; selected: File[] }`. Local `dragging`, `error`; refs `inputRef`,
`dragCounter`.

```ts
const VALID_EXTENSIONS = [".zip", ".mcpack", ".tar.gz", ".tgz"];
const MAX_FILE_SIZE = 512 * 1024 * 1024;      // 512 MB
const MAX_TOTAL_SIZE = 1024 * 1024 * 1024;    // 1 GB
```

- Extension matching is **suffix-based** (`lower.endsWith(ext)`), not by last dot, because of double extensions like
  `.tar.gz`.
- `MAX_TOTAL_SIZE` exists because merging decompresses every pack into one tree at once; several individually-valid
  large packs can exhaust the tab's memory, surfacing as a blank crash.
- Rejection strings: `` `"${file.name}" is not a .zip, .mcpack or .tar.gz` ``,
  `` `"${file.name}" is over 512 MB` ``, `` `"${file.name}" is already added` ``,
  `` `"${file.name}" would take the total over 1024 MB` ``. Joined with `" · "`, and every rejection is reported even
  when part of the same drop was accepted.
- Duplicate detection: `(s.name === f.name && s.size === f.size)`, checked against both `selected` and the incoming
  batch (dropping two copies together would otherwise collide on the React key `${file.name}:${file.size}` and make the
  reorder buttons act on the wrong row).
- Drag handling uses a `dragCounter` to survive child `dragenter`/`dragleave`.
- Staged list per row: priority number, name, size in MB, `↑`/`↓` (disabled at the ends), `✕`. Multi-pack header
  documents merge order: "#1 wins any file two packs both contain. Sounds, language files, atlases and fonts are
  combined instead, so nothing is lost from those."
- File input: `accept=".zip,.mcpack,.tar.gz,.tgz,application/gzip"`, `multiple`, `display: none`, cleared with
  `e.target.value = ""` after each change.
- Module-local `miniButton` uses `var(--fg)`, which is **not defined** in `index.html`'s `:root` — a latent undefined
  variable.

#### C1.4 `components/ProgressView.tsx`

Pure presentational; no state. `const pct = total > 0 ? Math.round((done / total) * 100) : 0;` Renders
`Converting {fileName}…`, `Stage: {stage} ({done}/{total})`, a bar with `transition: "width 0.1s ease"`, and a Cancel
button only when `onCancel` is provided.

#### C1.5 `components/ResultView.tsx`

Props `{ result, packName, onReset }`. State: `filter` (initial `"all"`).

`download(name, data: Uint8Array | string, mime: string)` builds a `Blob` (the `Uint8Array` is passed directly, since
Blob honours a view's `byteOffset`/`byteLength` — this avoids duplicating the whole archive at the one click the user
cannot cheaply retry), creates an `<a download>`, clicks it, and revokes the object URL after 10 s.

```ts
const STATUS_META: Record<string, { icon: string; color: string }> = {
  converted:    { icon: "✅", color: "var(--accent)" },
  approximated: { icon: "⚠️", color: "var(--warn)" },
  skipped:      { icon: "⏭️", color: "var(--muted)" },
  error:        { icon: "❌", color: "var(--err)" },
};
```

**Download button matrix:**

| Condition | Filename | MIME |
| --- | --- | --- |
| always | `` `${packName}.mcpack` `` | `application/zip` |
| `result.geyserMappings !== undefined` | `geyser_mappings.json` | `application/json` |
| `result.geyserBlockMappings !== undefined` | `geyser_blocks.json` | `application/json` |
| `result.displayEntityMappings !== undefined` | `geyser_displayentity_mappings.yml` | `text/yaml` |
| `result.displayEntityConfig !== undefined` | `geyserdisplayentity_config.yml` | `text/yaml` |
| `result.modelEngineInput !== undefined` | `modelengine_input.zip` | `application/zip` |
| always | `conversion_report.json` | `application/json` |
| always | — | "Convert another" → `onReset` |

Sub-components in order: `RequiredPlugins`, `SetupGuide`, `ConfigNudgeBanner`, `PerfPanel`, then the report table.

- **`PerfPanel({ timings })`** — local `open` state; `const stages = [...timings.stages].filter((s) => s.ms > 0)
  .sort((a, b) => b.ms - a.ms);`. Two columns: filtered stages, and `timings.ops.slice(0, 8)` labelled
  `` `${o.category} (${o.count}×)` ``. Toggle label: `` `{open ? "▾" : "▸"} Performance — {fmtMs(total)} total` ``.
- **`fmtMs(ms)`** — `` ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms` ``.
- **`PerfBar({ label, ms, total })`** — pct + label + `` `${fmtMs(ms)} · ${pct}%` `` + a 4px bar.
- **`RequiredPlugins({ result })`** — always lists Geyser and Floodgate download links; adds GeyserDisplayEntity when
  `displayEntityMappings !== undefined`; adds GeyserModelEngine and GeyserUtils when `modelEngineInput !== undefined`.
- **`SetupGuide({ result })`** — numbered sections. `"1. Resource pack + Geyser"` always;
  `"2. Furniture (GeyserDisplayEntity)"` when `displayEntityMappings !== undefined`; the ModelEngine title uses
  `` `${n}. ModelEngine / MythicMobs mobs (GeyserModelEngine)` `` with `n = displayEntityMappings !== undefined ? 3 : 2`.
  Steps quote literal install paths: `packs/`, `custom_mappings/`, `extensions/`,
  `extensions/geyserdisplayentity/Mappings/`, `extensions/geyserdisplayentity/`,
  `extensions/geysermodelengineextension/input/`, `enable-custom-content: true`, `send-floodgate-data: true`, `key.pem`.
  The `enable-custom-content: true` step appears only when `result.geyserBlockMappings !== undefined`. The furniture
  config step is marked **Required** — "its global y-offset/height seat furniture on the floor; without it pieces float
  ~1 block up."
- **`ConfigNudgeBanner({ entries, onReset })`** — finds `entries.find((e) => e.stage === "config-nudge")`; `null` when
  absent. Otherwise a warn-bordered panel titled "Items may not map correctly — upload a plugin config zip".

**Report table:** filter chips `(["all","converted","approximated","skipped","error"] as const)`; chip label
`` `all (${entries.length})` `` or `` `${STATUS_META[s]?.icon ?? ""} ${s} (${summary[s]})` ``. `visible` is memoized.
Rows render `visible.slice(0, 2000)` with `key={i}`; overflow prints
`` …and {visible.length - 2000} more (see report.json) ``. Detail column is
`e.detail ?? (e.outputs && e.outputs.length > 0 ? e.outputs.join("; ") : "")`. Container `maxHeight: 420,
overflowY: "auto"`, sticky header.

#### C1.6 Worker / pool architecture

**Three worker types, two of them pools with the same shape.** All are ES module workers created via
`new Worker(new URL("./…worker.ts", import.meta.url), …)`, all use plain `postMessage` with **no SharedArrayBuffer** —
chosen deliberately so the build works on static hosts (GitHub Pages) that cannot set the COOP/COEP headers wasm
threads need. Only the top-level conversion worker uses comlink; the pools use raw `addEventListener("message")` with
an id-matching protocol.

```ts
export function poolSize(): number {
  const cores = (globalThis.navigator?.hardwareConcurrency ?? 4) as number;
  return Math.max(1, Math.min(8, cores - 1));
}
```

Defined in `zopfliPool.ts` and imported by `convert.worker.ts`, so **both** pools are sized `clamp(cores - 1, 1, 8)`,
leaving one core for the UI.

**`convert.worker.ts`** — the root worker:

```ts
export interface WorkerApi {
  convert(
    zipBytes: Uint8Array | Uint8Array[],
    options: Partial<ConvertOptions>,
    onProgress: (stage: string, done: number, total: number) => void,
    configZips?: Uint8Array[],
    oxipngLevel?: number,
  ): Promise<ConvertResult & { hintCount?: number }>;
}
```

`expose(api)` at the end. Body in order:

1. If `configZips.length > 0`: emit `onProgress("reading plugin configs", 0, 1)`, then `parseOraxenConfigZips(configZips)`
   in a try/catch that re-throws as `` `A plugin config / datapack zip could not be read (${…}). Remove it and convert
   again — the resource pack itself is unaffected.` `` (previously a truncated archive killed a conversion whose actual
   resource pack was fine).
2. Merge hints into options: `baseItemHints`, `displayNameHints`, `equippableHints`, `cmdItemKeys`, `vanillaModelItems`,
   `colorHints`, `backpackItems`, `furnitureItems`, `furnitureTransforms`, `configZipProvided: true`, and
   `pluginConfigZips: configZips.map((z) => z.slice())`. `hintCount = hints.items` returned alongside the result.
3. `const encodePool = createEncodePool(poolSize());` — **lazy** spawn.
4. `onProgress("opening pack", 0, 1);`
5. `const wantsRecompress = options.maxCompression === true && options.optimizePack !== false;` then
   `const pool = wantsRecompress ? createZopfliPool(poolSize(), oxipngLevel ?? 4) : undefined;` — the pool spawns
   **eagerly**, so it is gated on `optimizePack` too (booting eight wasm workers that get terminated unused would put
   wasm init on the critical path of every earlier stage).
6. `options = { ...options, pngEncoder: encodePool }` and, if the pool exists, `recompressor: pool`.
7. `await convertPack(zipBytes, options, (stage, done, total) => onProgress(stage, done, total));`
8. `finally { pool?.dispose(); encodePool.dispose(); }` — both torn down even on throw.

**`encodePool.ts` — `createEncodePool(size): PngEncoder & { dispose(): void }`**

- Workers created lazily in `ensureWorkers()` on first `encode` (`let workers: Worker[] | undefined`,
  `const count = Math.max(1, size)`).
- Dispatch: round-robin pump; `let next = 0; let done = 0;` `pump(worker)` takes `const id = next++` and posts
  `{ id, width, height, data }`.
- **Transferables:** the input buffer is **not** transferred (core keeps the image for the in-process fallback if the
  worker returns `undefined`; structured clone copies it in). The fresh PNG **is** transferred back:
  `postMessage({ id, png }, [png.buffer])`.
- Per-job listeners added and removed on settle: `message`, `error`, `messageerror`.
- **Fallback:** `png === undefined` runs `encodePng(images[id]!)` in-process; a throw there stores `new Uint8Array(0)`.
  `finish` is guarded because it runs inside message/error/timeout handlers of a promise with no reject path — an
  escaping exception would mean `resolve()` is never reached and the conversion hangs with a frozen progress bar.
- **Watchdog:** `setTimeout(…, 30000)` (30 s) per job, tracked in a `Set`. On fire (and when not disposed) it removes
  listeners, falls back in-process, and re-pumps.
- `dispose()` sets `disposed = true`, clears and empties the timer set, terminates every worker, sets
  `workers = undefined`. The dispose guard matters because a timer firing against a terminated pool would run the
  fallback and keep every queued image alive through its closure.

**`encode.worker.ts`** — leaf. Decodes `{ id, width, height, data }`, calls `encodePng` in try/catch, replies
`{ id, png }` transferring `[png.buffer]` when defined.

**`zopfliPool.ts` — `createZopfliPool(size, level = 4): PngRecompressor & { dispose(): void }`**

- Workers spawn **eagerly** in the constructor: `for (let i = 0; i < Math.max(1, size); i++) workers.push(spawn());`
- `const JOB_TIMEOUT_MS = 12000;` — some browsers never initialise the wasm, so a job can hang forever; a real
  recompress of a ≤4 MB texture takes a couple of seconds, so 12 s is generous.
- Dispatch: `pump(worker, slot)` with a slot index; `let next = 0; let done = 0;`; `let settled = false` per job.
- **On timeout:** `settled = true`, remove listener, `worker.terminate()`, `finish(id, undefined)` (**keep the original
  PNG**), then `const replacement = spawn(); workers[slot] = replacement; pump(replacement, slot)` so the pass always
  makes progress.
- **Transferables:** input not transferred (the VFS still holds it and needs it intact when nothing shrinks); the
  result is transferred back at the leaf.
- `onProgress?.(done, pngs.length)` fires on every settle.
- `dispose()` mirrors the encode pool. Previously a timer firing after teardown terminated an already-dead worker and
  spawned a replacement nothing would terminate, leaking a wasm worker per pending job.

**`zopfli.worker.ts`** — leaf. Imports `optimise` from `@jsquash/oxipng/optimise.js`:

```ts
const copy = bytes.slice();
const out = new Uint8Array(await optimise(copy.buffer as ArrayBuffer, { level, interlace: false, optimiseAlpha: false }));
result = out.length < bytes.length ? out : undefined;
```

`bytes.slice()` is needed because oxipng wants a plain ArrayBuffer holding exactly this PNG's bytes. oxipng
(wasm-bindgen) initialises cleanly in the browser "unlike the older emscripten zopfli whose runtime never fired and
hung the pass" — which is why the pool file is still named `zopfli*` while the implementation is oxipng.

> **Naming discrepancy:** the pool names are `zopfli` (`createZopfliPool`, `zopfli.worker.ts`, `zopfliPool.ts`,
> `JOB_TIMEOUT_MS`) but the implementation is `@jsquash/oxipng`. The node/in-process path really is zopfli
> (`@gfx/zopfli` via `zopfliRecompressPng`).

#### C1.7 End-to-end in the browser

`App.startConvert` reads `File[]` → `Uint8Array[]` → transfers to `convert.worker.ts` (comlink) → the worker parses
config zips, builds an encode pool (lazy) and optionally an oxipng pool (eager, gated on
`maxCompression && optimizePack !== false`), then calls `convertPack` from `@loomery/core` → core calls back through
`pngEncoder.encode()` (fanned across the encode pool) and `recompressor.run()` (fanned across the oxipng pool) →
`ConvertResult` with `hintCount` → `App` moves to `done` → `ResultView` offers downloads.

### C2. `apps/api` — Node HTTP API

```json
{ "name": "@loomery/api", "private": true, "type": "module",
  "scripts": { "start": "tsx src/server.ts", "typecheck": "tsc --noEmit", "build": "tsc --noEmit" },
  "dependencies": { "@loomery/core": "workspace:*", "busboy": "^1.6.0", "fflate": "^0.8.3", "tsx": "^4.19.0" },
  "devDependencies": { "@types/busboy": "^1.5.4", "@types/node": "^22.0.0", "typescript": "^5.6.0" } }
```

No HTTP framework — raw `node:http`.

**Env vars:** `PORT` (default `3000`); `MAX_UPLOAD_BYTES` (default `512 * 1024 * 1024`).

**Routes:**

| Method | Path | Behaviour |
| --- | --- | --- |
| `OPTIONS` | any | `204`, no body |
| `GET` | `/` | `200 text/plain` with the `USAGE` string |
| `GET` | `/healthz` | `200 text/plain`, body exactly `"ok"` (unchanged — liveness probes rely on it) |
| `GET` | `/info` | `200 application/json`: `{ status, maxUploadBytes, parallelPng: false, node }` — readiness/limits for orchestrators |
| `POST` | `req.url?.startsWith("/convert")` | `handleConvert` |
| any | anything else | `404 text/plain` with `USAGE` |

> **Module shape.** `createServer()` returns an un-listened `http.Server`, so tests can bind an ephemeral port. The
> listen call is guarded by `import.meta.url === pathToFileURL(process.argv[1]).href`, so importing the module has no
> side effect. `apps/api/test/server.test.ts` drives it this way.

`USAGE`:

```
Loomery API
POST /convert with the Java pack zip (application/zip body, or multipart fields "pack" + optional "config").
Query params: packName, attachableMaterial, modernBaseItem, maxAnimationFrames.
Returns a zip: <packName>.mcpack + geyser_mappings.json + geyser_blocks.json + report.json
```

**CORS headers on every response:** `access-control-allow-origin: *`,
`access-control-allow-methods: POST, GET, OPTIONS`, `access-control-allow-headers: content-type`.

**Body modes** (selected by `req.headers["content-type"] ?? ""`): `multipart/form-data` → `readMultipart(req)`;
otherwise → `readBody(req)` (raw bytes treated as the pack zip).

**Query params:**

| Param | Handling | Validation |
| --- | --- | --- |
| `packName` | `?? "converted_pack"`, then `rawPackName.replace(/[\x00-\x1F\x7F\/\\":]/g, "").slice(0, 80) \|\| "converted_pack"` | Sanitized against header injection and path traversal in the zip entry / `content-disposition` |
| `attachableMaterial` | set only `if (material)` | none |
| `modernBaseItem` | set only `if (baseItem)` | none |
| `maxAnimationFrames` | `if (maxFrames)`, `Number(maxFrames)` | `400 "maxAnimationFrames must be a non-negative number"` |
| `oxipngLevel` | **parsed and validated but unused** | `400 "oxipngLevel must be a number between 1 and 6"`. It is a browser-build knob; this Node path recompresses with zopfli, which takes no level; the range check stays so a caller gets told about a nonsensical value |
| `optimizePack` | `options.optimizePack = optimize !== "false" && optimize !== "0"` when present | |
| `maxCompression` | `options.maxCompression = maxComp === "true" \|\| maxComp === "1"` when present | |

**Multipart fields:** `pack` (required, first file with that name) and `config` (optional, **repeatable** —
`-F config=@nexo.zip -F config=@hmcc.zip`). Unknown field names are silently ignored.

**Errors:**

| Condition | Status | Body |
| --- | --- | --- |
| No pack bytes or zero length | `400` | `missing pack zip (raw body or multipart field "pack")` |
| Bad `maxAnimationFrames` | `400` | `maxAnimationFrames must be a non-negative number` |
| Bad `oxipngLevel` | `400` | `oxipngLevel must be a number between 1 and 6` |
| Raw body over `MAX_UPLOAD` | **500** | `readBody` rejects `new Error("upload too large")` and calls `req.destroy()` — surfaces as 500, not 413 |
| Multipart file over `MAX_UPLOAD` | **500** | Busboy's `fileSize` limit truncates rather than failing, so an explicit `stream.on("limit", () => reject(new Error("upload too large")))` is wired up; otherwise the handler would silently convert the first `MAX_UPLOAD` bytes |
| `convertPack` or anything else throws | `500` (only `if (!res.headersSent)`) | `` `conversion failed: ${err instanceof Error ? err.message : String(err)}` `` and `console.error`d |
| No route matched | `404` | the `USAGE` string |

**Success (`200`):** `content-type: application/zip`,
`content-disposition: attachment; filename="${packName}_bedrock.zip"`, `content-length: out.length`, body
`Buffer.from(out)` where `out = zipSync(bundle, { level: 6 })` from `fflate`.

**Bundle entries:** `` `${packName}.mcpack` `` (always), `report.json` (always),
`geyser_mappings.json` / `geyser_blocks.json` / `geyser_displayentity_mappings.yml` / `geyserdisplayentity_config.yml` /
`modelengine_input.zip` (conditional on the corresponding `ConvertResult` field being present).

**Hint options** come from `optionsFromHints(hints, configZips)` in
`packages/core/src/convert/optionsFromHints.ts` — the same helper the web worker calls, so the two cannot drift. It sets
all eleven hint fields including `furnitureTransforms` and `pluginConfigZips` (copied, so a later transfer cannot neuter
them), plus `configZipProvided: true`.

> **Remaining divergence from the web app.** The API still passes **no** `pngEncoder` and **no** `recompressor`, so both
> worker pools are absent and encoding/recompression run in-process sequentially on the single Node thread.
> `convertPack` is also called with no progress callback. See [../suggestions.md](../suggestions.md) §A1.

All handlers are module-local except `createServer`. `server.listen` runs only when the file is the entry point, so a
test import does not bind a port.

### C3. `apps/api/src/test-convert.ts`

Manual smoke/benchmark script: `tsx test-convert.ts <pack.zip> [configZip.zip ...]`. Defaults when `argv` is short:
`packPath = "packitriedtoconvert.zip"`, `resolvedConfigPaths = configPaths.length > 0 ? configPaths : ["items 2.zip"]`.

Builds `baseOpts: Partial<ConvertOptions>` from parsed config hints, then runs `convertPack` **twice**:

- **Run 1:** `maxCompression: false` → `testpack_nomaxcomp.mcpack`, `report_nomaxcomp.json`; logs elapsed ms,
  `report.summary`, byte size + MB, and the optimize line.
- **Run 2:** `maxCompression: true` → `testpack_maxcomp.mcpack`, `report_maxcomp.json`.
- **Comparison:** both sizes, `((1 - r2.mcpack.length / r1.mcpack.length) * 100).toFixed(1) + "%"` saved, and the ms delta.
- Then dumps `error`, `skipped`, `approximated` entries from run 1 (30 each) via `byStatus` and `dump`.

Helpers `mb(bytes)` and `optimizeLine(entries) = entries.find((e) => e.stage === "optimize")?.outputs?.[0]` — this is
where the `"optimize"` stage name and the convention that its first output is the summary line are pinned.

It calls `parseOraxenConfigZips` unconditionally with no try/catch, so a missing default file throws before any
conversion.

### C4. CI and deploy

`.github/workflows/ci.yml`: single job `check` on push to `main` and on **every** PR — `actions/checkout@v4`,
`pnpm/action-setup@v4`, `actions/setup-node@v4` (Node 22, `cache: pnpm`), then `pnpm install --frozen-lockfile`,
`pnpm typecheck`, `pnpm test`. `pnpm typecheck` is the recursive root script, so it covers core, web and api.
`pnpm test` covers **only** core — web and api have no tests. `pnpm/action-setup@v4` has no `version:` input, so it
reads `packageManager: pnpm@11.10.0` from the root `package.json`.

`.github/workflows/deploy.yml`: job `deploy`, `permissions: contents: write`, concurrency group `deploy-pages` with
`cancel-in-progress: true` so two quick pushes cannot race onto `gh-pages`. Re-runs the full gate
(install → typecheck → test) before `pnpm --filter @loomery/web build`, then publishes `apps/web/dist` to the
`gh-pages` branch via `peaceiris/actions-gh-pages@v4` with `enable_jekyll: false` (Pages ignores directories starting
with an underscore). No `base` override at build time — `vite.config.ts`'s `base: "./"` makes the same build work under
the Pages subpath and at a domain root. Deploy covers **only** the web app; nothing publishes or runs `apps/api`.

`.claude/launch.json`: two configurations — `web` (dev server on port **5173**) and `preview` (vite preview on **4173**
with `--strictPort`, via `pnpm exec`). No configuration for `apps/api`; start it with `pnpm --filter @loomery/api start`.

---

## Cross-cutting notes

1. **Module resolution.** Every internal import carries an explicit `.js` extension (`./png.js`,
   `../report/timings.js`) even though the files are `.ts`, matching `moduleResolution: "bundler"`. Follow this or the
   build breaks.
2. **The hot-op timing sink is global and single-flight.** Any new `timeOp`/`timeOpAsync` category is automatically
   reported through `Timings.toJSON().ops`, and `PerfPanel` shows only the top 8 by `totalMs`. `beginTimings`/
   `finishTimings` must bracket a conversion exactly once; concurrent API requests may misattribute metrics (output
   unaffected).
3. **Mutation safety in the image layer is opt-in.** `decodeCached` hands out the shared instance; only
   `decodeCachedForEdit` returns a private copy. Any new stage that tints, bleeds, blends, blits or rotates must use the
   `…ForEdit` variant or clone explicitly.
4. **Every `Worker` must be terminated.** `dispose()` on both pools also clears the timer `Set`. `App.tsx`'s unmount
   effect terminates the conversion worker.
5. **`noUncheckedIndexedAccess` and `noFallthroughCasesInSwitch` are load-bearing.** The source uses `!` heavily in
   tight pixel/number loops because of the first, and `faceCorners` in `modelRender.ts` relies on exhaustive `switch`
   returns with no `default` (the second flag would otherwise require it).
6. **README line 82 is the canonical attribution note** for the vanilla tables (GeyserMC/PackConverter MIT, and
   ModifiedCommand/ConvertJavaTextureToBedrock), including the three known-wrong entries.
7. **`apps/api` no longer lags `apps/web` on hint fields.** Both call
   `optionsFromHints(hints, configZips)` from `packages/core/src/convert/optionsFromHints.ts`, so the API emits
   `modelengine_input.zip` and honours `furnitureTransforms`/`pluginConfigZips`. What it still lacks is the worker
   pools: all encoding and recompression is single-threaded Node. See [../suggestions.md](../suggestions.md) §A1.
8. **File sizes at this reading:** `vanillaTextureMap.ts` 2074 lines (BLOCK_RENAMES 810, ITEM_RENAMES 405,
   EXTRA_TEXTURE_MAP 580, TGA_TEXTURE_OUTPUTS 69), `vanillaSoundMap.ts` 1326 lines (SOUND_RENAMES 1303),
   `builtinModels.ts` 175 lines.
