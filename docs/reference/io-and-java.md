# Reference — IO layer & Java pack parsing

> Part of the Loomery reference set. See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the end-to-end flow and
> [pipeline-and-stages.md](pipeline-and-stages.md) for what consumes these APIs.
>
> **How to use this document.** It is written so you do not have to open these files to make a change in
> a *different* module. Paths are repo-relative. Signatures are copied verbatim. Where a behaviour is
> surprising or was added to fix a real bug, the reason is recorded here so you do not "clean it up".

Everything in `packages/core/src/io/` and `packages/core/src/java/` is **pure with respect to the
filesystem**: the only inputs are `VirtualFs` / `Uint8Array`, and no module in this layer writes files.
The only mutable state is the memo caches inside `JavaPack` and `CraftEngineState`.

---

## 1. IO layer

### 1.1 `packages/core/src/io/vfs.ts` — in-memory virtual filesystem

A `Map<string, Uint8Array>`-backed FS used for both the parsed Java pack and the Bedrock pack under
construction, so core never touches Node/browser FS APIs.

```ts
export class VirtualFs {
  constructor(private minifyJson = false)
  static normalize(path: string): string
  has(path: string): boolean
  read(path: string): Uint8Array | undefined
  readText(path: string): string | undefined
  write(path: string, data: Uint8Array): void
  writeText(path: string, text: string): void
  writeJson(path: string, value: unknown, pretty = true): void
  delete(path: string): boolean
  list(options?: { prefix?: string; suffix?: string }): string[]
  get size(): number
  entries(): IterableIterator<[string, Uint8Array]>
}
```

Private state: `files: Map<string, Uint8Array>`, `sortedPaths: string[] | null`,
`decoder = new TextDecoder("utf-8")`, `encoder = new TextEncoder()`, `minifyJson: boolean`.

**Invariants and gotchas**

- **Path normalization** (`VirtualFs.normalize`): `path.replace(/\\/g, "/").replace(/^\/+/, "")`.
  Backslashes become forward slashes; *all* leading slashes are stripped. Applied on every
  `has`/`read`/`write`/`delete`, and to `list`'s `prefix` (but **not** `suffix`). There is no
  `.`/`..` collapsing and **no case folding** — paths are case-sensitive as stored.
- **Cache invalidation is conditional.** `write` only calls `invalidate()` (setting `sortedPaths = null`)
  when the key is **new**; overwriting an existing path does not invalidate. Stages routinely overwrite
  paths they just enumerated (the optimizer re-encodes textures in place), and invalidating forced a
  full re-sort of every path. `delete` invalidates only when something was actually removed.
- `list()` returns a **sorted** (`Array.prototype.sort`, i.e. UTF-16 code-unit order) snapshot copy,
  built lazily and reused. Filtering is `startsWith`/`endsWith`.
- `readText` decodes with a non-fatal `TextDecoder` — malformed bytes become U+FFFD, never a throw.
- `writeJson` indent logic: `minifyJson ? undefined : (pretty ? 2 : undefined)`. So the `minifyJson`
  constructor flag forces compact JSON for **every** stage, not just packaging.
- `entries()` iterates the raw Map in **insertion order** (not sorted) — this is what `writeZip` consumes
  (zip entry order in the output therefore follows write order, not alphabetical order).

### 1.2 `packages/core/src/io/zipReader.ts` — resilient central-directory zip reader

Reads a zip the way the Minecraft client does — trusting only the central directory and reading each
entry defensively — so "pack protection" archives (corrupted local headers, entries with lying sizes,
prepended junk) still load instead of aborting.

```ts
export interface ZipEntry { name: string; data: Uint8Array }
export interface ZipReadResult {
  entries: ZipEntry[];
  /** Entries listed in the central directory that could not be extracted. */
  failed: { name: string; reason: string }[];
}
export function readZipResilient(bytes: Uint8Array): ZipReadResult
```

Constants: `EOCD_SIG = 0x06054b50`, `CDIR_SIG = 0x02014b50`, `LOCAL_SIG = 0x04034b50`,
`ZIP64_EOCD_SIG = 0x06064b50`, `ZIP64_LOCATOR_SIG = 0x07064b50`,
`MAX_ENTRY_SIZE = 512 * 1024 * 1024`.

**Algorithm**

1. EOCD is found by scanning **backwards from `bytes.length - 22`** for the *last* `EOCD_SIG`
   (protection tools plant fake earlier records). Missing → `throw new Error("not a zip file (no
   end-of-central-directory record)")`.
2. Reads `totalEntries` (u16 @ `eocd+10`), `cdirSize` (u32 @ `eocd+12`), `claimedCdirOffset` (u32 @ `eocd+16`).
3. **ZIP64 path**: if any of the three equals its sentinel (`0xffff`, `0xffffffff`, `0xffffffff`), calls
   `findZip64Eocd`. ItemsAdder/Nexo packs routinely exceed 65,535 entries.
4. `findZip64Eocd` checks the 20-byte locator at `eocd - 20` first and reads a 64-bit offset at
   `locator + 8` via `getBigUint64`; on failure it **scans backwards from `eocd - 56`** for
   `ZIP64_EOCD_SIG` (prepended junk breaks relative offsets). Reads `totalEntries` @ `+32`,
   `cdirSize` @ `+40`, `cdirOffset` @ `+48`.
5. **Shift correction**: if `cdirOffset >= bytes.length` or `getUint32(cdirOffset) !== CDIR_SIG`, the real
   start is deduced as `guess = eocd - cdirSize`; if that carries `CDIR_SIG` it is used, otherwise
   `throw new Error("central directory not found")`. Then `shift = cdirOffset - claimedCdirOffset` is
   added to every entry's `localOffset`.
6. Central-directory entry parsing: loop runs while `i < totalEntries && ptr + 46 <= bytes.length` and the
   signature still matches (else `break`). Fields: `method` @ +10, `compressedSize` @ +20,
   `uncompressedSize` @ +24, `nameLength` @ +28, `extraLength` @ +30, `commentLength` @ +32,
   `localOffset` @ +42. `ptr += 46 + nameLength + extraLength + commentLength`.
7. **Skipped**: names ending in `/`, zero-length names (directories), and **any duplicate name** — first wins.
8. If `result.entries.length === 0` after the loop → `throw new Error("no readable entries in zip")`.

**`extractEntry(...)` (not exported)**

- Throws `"local header out of bounds"`, `"corrupt local header signature"`, or
  `"entry data out of bounds (lying sizes)"`.
- **Never allocates from the uncompressed-size field.** Oraxen sets `0xFFFFFFFF` everywhere, which makes
  size-trusting extractors allocate 4 GB; `inflateSync` determines the real size instead. The
  `uncompressedSize` parameter is accepted and **unused**.
- `method === 0` → `compressed.slice()`; `method === 8` → `inflateSync(compressed)`; else
  `throw new Error(\`unsupported compression method ${method}\`)`.
- Per-entry failures are caught and pushed to `failed`; they never abort the archive.

### 1.3 `packages/core/src/io/zip.ts` — archive entry point + writer

Public front door for reading any pack archive (dispatches gzip→tar, else zip) into a `VirtualFs`, and the
writer that turns a `VirtualFs` back into a zip.

```ts
export interface ReadZipResult {
  vfs: VirtualFs;
  failed: { name: string; reason: string }[];
}
export function readZipDetailed(bytes: Uint8Array): ReadZipResult
export function readZip(bytes: Uint8Array): VirtualFs
export function writeZip(vfs: VirtualFs): Uint8Array
```

- `readZipDetailed` first calls `isGzip(bytes)`; on true it **delegates to `readTarGzDetailed`** (which
  shares the `ReadZipResult` shape, so that interface is defined here but also produced by `tar.ts`).
- `readZip` is `readZipDetailed(bytes).vfs` — the `failed` list is discarded.
- `writeZip` builds a **null-prototype** tree (`Object.create(null) as Zippable`) because entry names come
  from untrusted archives and assigning `__proto__` on a normal object literal would invoke the inherited
  setter and silently drop the file. Compression: `/\.(png|ogg|jpg|jpeg|zip|mcpack)$/i` → `{ level: 0 }`
  (stored raw), everything else `{ level: 9 }` (JSON is pre-minified, so max deflate is cheap).

### 1.4 `packages/core/src/io/tar.ts` — gzipped-tar reader

Reads `.tar.gz` / `.tgz` (e.g. a `git archive` of a pack) into the same `ReadZipResult` shape, parsing
ustar/pax/GNU tar by hand.

```ts
export function isGzip(bytes: Uint8Array): boolean
export function parseTar(bytes: Uint8Array): { name: string; data: Uint8Array }[]
export function readTarGzDetailed(bytes: Uint8Array): ReadZipResult
```

Constants: `BLOCK = 512`.

- `isGzip`: first two bytes `0x1f 0x8b`.
- `readTarGzDetailed` always returns `failed: []` — tar reading has no per-entry failure channel; malformed
  input simply stops early.
- `readOctal(block, offset, length)` supports **base-256** encoding (`(first & 0x80) !== 0` → big-endian,
  high bit as marker). GNU tar encodes values over 8 GiB this way; the old `parseInt` path returned 0,
  advanced one block, and interpreted payload as headers, filling the pack with garbage entries.
- `parseTar` reads `size` @ 124 (12 bytes) and `typeflag` @ 156. Handles `'L'` (GNU longname), `'x'`/`'g'`
  (pax, matched with `/\d+ path=([^\n]*)\n/`), and `0x00`/`'0'` (regular). For regular files, `prefix`
  comes from `readStr(header, 345, 155)` and the name is `prefix ? \`${prefix}/${base}\` : base`.
  **Directory-as-regular-file entries (empty name or trailing `/`) are dropped here**, matching the zip
  reader — without this the two readers disagreed and phantom entries reached the merge report.
- Advance: `pos = dataStart + Math.ceil(size / BLOCK) * BLOCK`.

### 1.5 `packages/core/src/java/json.ts` — JSONC-tolerant parsing

```ts
export function parseLenientJson<T = unknown>(text: string): T | undefined
export function parseStrictJson<T = unknown>(text: string): T | undefined
```

Both strip a leading BOM (`text.replace(/^﻿/, "")`) and call jsonc-parser's
`parse(text, errors, { allowTrailingComma: true, disallowComments: false })`.

- **`parseLenientJson`** returns `undefined` only if `result === undefined && errors.length > 0`.
  Comments, trailing commas and truncated documents are all tolerated. **Use for reads.**
- **`parseStrictJson`** returns `undefined` if `errors.length > 0` — *any* recovery disqualifies. Comments
  and trailing commas are still accepted ("those are normal in hand-written pack JSON and are not damage").

> **House rule.** Use the lenient parser for read-only stages, and the strict parser **wherever a parse
> result is about to be re-serialised** (`mergeJavaPacks` additive files). Salvage silently becomes the new
> content otherwise — a truncated `{"a.hit":{"sounds":[` "recovers" to `{"a.hit":{"sounds":[]}}` and that
> recovered garbage is then written back as the truth.

### 1.6 `packages/core/src/java/mcmeta.ts` — frame duration normalization

```ts
export function frameTicks(value: unknown): number
```

Accepts a numeric string too (`Number(value.trim())` — `Number.isFinite` does not coerce, so `"3"` used to
fall through to 1). Non-number/non-finite → `1`; otherwise `Math.max(1, Math.round(n))`. ItemsAdder writes
`"frametime": 2.1`, and fractional values produce non-integer array lengths downstream, so this is
normalized once at *every* read site (geometry, flipbooks, items, bow-pull).

---

## 2. Java pack model

### 2.1 `packages/core/src/java/model.ts` — model JSON types + parent classifiers

Pure types plus small classifiers; no I/O.

```ts
export interface JavaModel {
  parent?: string;
  textures?: Record<string, string>;
  elements?: JavaElement[];
  overrides?: JavaOverride[];
  display?: Partial<Record<JavaDisplayContext, JavaDisplayTransform>>;
  ambientocclusion?: boolean;
  gui_light?: "front" | "side";
  texture_size?: [number, number];
}
export interface JavaElement {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: { origin: [number, number, number]; axis: "x" | "y" | "z"; angle: number; rescale?: boolean };
  faces?: Partial<Record<JavaFaceName, JavaFace>>;
  shade?: boolean;
}
export type JavaFaceName = "north" | "south" | "east" | "west" | "up" | "down";
export interface JavaFace { uv?: [number, number, number, number]; texture: string; rotation?: 0 | 90 | 180 | 270; tintindex?: number; cullface?: string }
export type JavaDisplayContext =
  | "thirdperson_righthand" | "thirdperson_lefthand" | "firstperson_righthand"
  | "firstperson_lefthand" | "gui" | "head" | "ground" | "fixed";
export interface JavaDisplayTransform { rotation?: [number, number, number]; translation?: [number, number, number]; scale?: [number, number, number] }
export interface JavaOverride { predicate: Record<string, number>; model: string }
export function isGeneratedParent(id: string): boolean
export function isHandheldParent(id: string): boolean
export function isBuiltinEntityParent(id: string): boolean
export function isVanillaItemParent(id: string): boolean
```

- `JavaModel.texture_size` documents that `uv` is authored against this resolution (default `[16, 16]`).
  HD models set e.g. `[128, 128]`, so faces must be normalized by **this** value, not a hardcoded 16.
  (Consumed in `image/modelRender.ts` and `bedrock/geometry.ts`.)
- Parent sets are private, and include **both** spellings (namespaced and bare):
  - `GENERATED_PARENTS`: `minecraft:item/generated`, `item/generated`, `minecraft:builtin/generated`, `builtin/generated`.
  - `HANDHELD_PARENTS`: `minecraft:item/handheld`, `item/handheld`, `.../handheld_rod`, `.../handheld_mace` (+ bare forms).
  - `isBuiltinEntityParent` is a literal comparison against `minecraft:builtin/entity` / `builtin/entity`.
- **`isVanillaItemParent(id)`**: splits on the first `:`, defaults the namespace to `minecraft`, rejects any
  other namespace, requires the path to start with `item/`, and returns
  `!isGeneratedParent && !isHandheldParent && !isBuiltinEntityParent`. These are specific vanilla item models
  (`minecraft:item/diamond_sword`) used as parents to inherit display transforms; the resolver classifies
  them as sprites so the variant converts instead of being skipped as "unknown".

### 2.2 `packages/core/src/java/javaPack.ts` — indexed pack view + root detection

```ts
export interface PackMcmeta { pack?: { pack_format?: number; description?: unknown } }
export interface ResourceLocation { namespace: string; path: string }
export function parseResourceLocation(id: string, defaultNamespace = "minecraft"): ResourceLocation
export function findPackRoot(vfs: VirtualFs): string
export class JavaPack {
  readonly vfs: VirtualFs
  readonly root: string
  readonly mcmeta: PackMcmeta | undefined
  readonly packFormat: number
  static open(vfs: VirtualFs): JavaPack
  namespaces(): string[]
  read(relPath: string): Uint8Array | undefined
  readText(relPath: string): string | undefined
  readJson<T = unknown>(relPath: string): T | undefined
  has(relPath: string): boolean
  list(options?: { prefix?: string; suffix?: string }): string[]
  assetPath(category: "textures" | "models" | "items" | "equipment", id: string, ext: string): string
}
```

- `parseResourceLocation` splits on the **first** `:`; no colon → `{ namespace: defaultNamespace, path: id }`.
  No validation, no lowercasing.
- **`findPackRoot(vfs)`**, in order:
  1. `vfs.has("pack.mcmeta")` → `""`.
  2. Collect `metaRoots` from `vfs.list({ suffix: "pack.mcmeta" })` where `path.split("/")` has exactly
     `parts.length === 2 && parts[1] === "pack.mcmeta"` → `parts[0] + "/"`. The exact-basename check exists
     because the suffix filter also matches `Backup/oldpack.mcmeta`; a stray file naming a directory as root
     would hide the real assets and emit an empty pack from a run that looked successful. **Exactly one
     candidate** → return it.
  3. If `vfs.list({ prefix: "assets/" }).length > 0` → `""`.
  4. Otherwise collect `top` prefixes (`path.slice(0, slash + 1)`) for paths starting with `top + "assets/"`;
     return the single one if unambiguous, else `""`.
  - Rationale: a Nexo `pack/` working directory keeps its `pack.mcmeta` in the generated zip *beside* the
    assets, leaving the assets tree as the only marker. Only an unambiguous single candidate counts.
- The `JavaPack` constructor is **private**; `JavaPack.open(vfs)` is the only entry. It reads
  `root + "pack.mcmeta"` with `parseLenientJson<PackMcmeta>`; `packFormat = this.mcmeta?.pack?.pack_format ?? 0`.
- `namespaces()`: memoized in `cachedNamespaces`. Walks `vfs.list({ prefix: root + "assets/" })`, takes the
  first segment after the prefix, returns a **sorted** deduped array. An `assets/<ns>` *file* (not
  directory) would be included; empty namespaces are skipped.
- `read`/`readText`/`has`/`list` all prefix with `this.root`; `list` strips `this.root.length` off the
  returned paths so results are **root-relative**.
- **`readJson` is memoized** in `private readonly jsonCache = new Map<string, unknown>()`, keyed by the
  root-relative `relPath`. **Callers must treat the result as immutable** — the same object is shared across
  passes (bow-pull detection, variant extraction, parent-chain resolution). The cache stores `undefined`
  for missing/unparseable files, so a later write to the vfs would not be seen.
- **`assetPath(category, id, ext)`** builds `assets/${loc.namespace}/${category}/${loc.path}${ext}`. An alias
  fallback applies **only when `category === "textures"`** and the plain path is absent: it looks up
  `${namespace}:${path}` in `spriteAliases()` and returns the alias's path. ItemsAdder publishes every custom
  texture under an atlas alias (`{"type":"single","resource":"set:foo","sprite":"ia:12"}`), so without this
  the whole pack resolves to missing textures.
- **`spriteAliases()`** (private, memoized in `aliasCache`): scans `this.list({ suffix: ".json" })` filtered by
  `/^assets\/[^/]+\/atlases\//`, reads `{ sources?: { type?: string; resource?: string; sprite?: string }[] }`,
  and for each source with `type === "single"`, a defined `resource`, and a defined `sprite` **different from**
  `resource`, maps `${sprite.namespace}:${sprite.path}` → `resource`.

### 2.3 `packages/core/src/java/itemVariants.ts` — variant extraction + bow-pull grouping

Turns both legacy `overrides` (`assets/<ns>/models/item/*.json`) and modern 1.21.4+ item definitions
(`assets/<ns>/items/*.json`) into a flat `ItemVariant` list of Geyser v2 mapping predicates, and separately
detects bow-draw groups.

```ts
export type VariantPredicate =
  | { type: "condition"; property: string; expected?: boolean; component?: string; index?: number }
  | { type: "match"; property: string; value: string }
  | { type: "range_dispatch"; property: string; threshold: number; scale?: number; normalize?: boolean };

export interface ItemVariant {
  baseItem: string | undefined;
  model: string;
  source: { kind: "legacy"; customModelData: number } | { kind: "modern"; itemModelId: string };
  predicates: VariantPredicate[];
  priority?: number;
  origin: string;
}
export interface VariantExtraction {
  variants: ItemVariant[];
  unsupported: { origin: string; reason: string }[];
}
export function extractLegacyVariants(pack: JavaPack, bowPullConsumed?: Set<string>): VariantExtraction
export function extractModernVariants(pack: JavaPack, bowPullConsumed?: Set<string>): VariantExtraction

export interface BowPullStage { pull: number; model: string }
export interface BowPullGroup {
  baseItem?: string;
  itemModelId?: string;
  modelKey: string;
  isModern: boolean;
  standbyModel: string;
  stages: BowPullStage[];
  scale: number;
  origin: string;
}
export function extractBowPullGroups(pack: JavaPack): {
  groups: BowPullGroup[];
  consumedKeys: Set<string>;
  consumedModernKeys: Set<string>;
}
```

**`extractLegacyVariants`**

1. For each `ns` of `pack.namespaces()`, prefix `assets/${ns}/models/item/`, list `{ prefix, suffix: ".json" }`.
2. `pack.readJson<JavaModel>(path)`; skip unless `model.overrides` is non-empty.
3. `itemName = path.slice(prefix.length, -".json".length)` (nested subfolders become `a/b`);
   `baseItem = ns === "minecraft" ? \`minecraft:${itemName}\` : undefined` — **overrides in non-minecraft
   namespaces never attach to a vanilla item**.
4. If `baseItem` is in `bowPullConsumed`, the whole item is skipped.
5. Per override: `cmd = predicate["custom_model_data"]`, plus `extraPredicates` from
   `legacyOverridePredicates`. With a `cmd` → variant `{ kind: "legacy", customModelData: cmd }`, with
   `baseItem` and `origin: path` (**no `priority`**). Without `cmd` but with extra predicates **and** a
   defined `baseItem` → variant `{ kind: "modern", itemModelId: baseItem }` (a vanilla-behaviour retexture,
   e.g. a damaged-elytra skin). Otherwise an `unsupported` entry whose reason embeds
   `Object.keys(predicate).join(", ") || "empty"`.

**`legacyOverridePredicates` mapping**

| Java predicate key | Emitted |
| --- | --- |
| `firework` ≠ 0 (checked **first**) | `{ type: "match", property: "charge_type", value: "rocket" }` |
| else `charged` ≠ 0 | `{ type: "match", property: "charge_type", value: "arrow" }` |
| `charged === 0` | no predicate; reason `"charged: 0" (uncharged crossbow) can't be expressed as a Geyser match predicate — model used for every charge state` |
| `damaged`, `broken` | `{ type: "condition", property: key, expected: value !== 0 }` |
| `damage` | `{ type: "range_dispatch", property: "damage", threshold: value, normalize: true }` |
| `cast` | `{ type: "condition", property: "fishing_rod_cast", expected: value !== 0 }` |
| `custom_model_data` | handled by the caller (skipped) |
| anything else | `unsupported` reason `` `unsupported extra predicate "${key}" ignored` `` |

`charged`/`firework` fold into a single `charge_type` match because v2 cannot express negation.

**Geyser property tables (module-private)**

- `GEYSER_CONDITIONS`: `broken→broken`, `damaged→damaged`, `custom_model_data→custom_model_data`,
  `has_component→has_component`, `"fishing_rod/cast"→fishing_rod_cast`.
- `GEYSER_MATCH_PROPERTIES`: `charge_type`, `trim_material`, `context_dimension`, `custom_model_data`.
- `GEYSER_MATCH_VALUES`: `{ charge_type: new Set(["arrow", "rocket"]) }` — Geyser resolves these via
  `Enum.valueOf`, and Java's `charge_type` has a third case `none` that Geyser lacks.
- `GEYSER_RANGE_PROPERTIES`: `damage→damage`, `count→count`, `custom_model_data→custom_model_data`,
  `"bundle/fullness"→bundle_fullness`. Deliberately omits `time`, `compass`, `crossbow/pull`, `use_duration`.

**`extractModernVariants(pack, bowPullConsumed?)`**

- Prefix `assets/${ns}/items/`; `itemModelId = \`${ns}:${name}\``; skip if in `bowPullConsumed`.
- No `model` node → `unsupported` reason `"items asset without model node"`.
- `baseItem = ns === "minecraft" ? \`minecraft:${name}\` : undefined`.
- Delegates to `flattenNode(asset.model, [], { pack: itemModelId, baseItem, origin: path, out })`.

**`flattenNode`** — node type normalized as `(node.type ?? "").replace(/^minecraft:/, "")`:

- `"model"`: string `node.model` → push a variant. Non-string `model` is silently dropped.
- `"composite"`: `unsupported` `` `composite model — only the first of ${models.length} sub-models is converted` ``,
  then recurses into `models[0]` only (Bedrock cannot layer models on one item).
- `"condition"`: property namespace-stripped, `geyserProperty = GEYSER_CONDITIONS[property]`. `extra` becomes
  `{ component }` for `has_component` when `node.component` is a string, `{ index }` for
  `custom_model_data` with numeric `node.index`, else `{}`. If `geyserProperty === undefined || extra === undefined`
  → `unsupported` with reason `condition "${property}" has no "component" to test — default (false) branch used`
  or `condition "${property}" not supported by Geyser — default (false) branch used, "${property}" state keeps
  the default look on Bedrock`, and flattens **`on_false` only**. The `has_component`-without-component case is
  deliberately unsupported rather than emitting an unloadable mappings file.
- `"range_dispatch"`: unsupported property → report `range_dispatch on "${property}" not supported by Geyser —
  fallback model used for all values` and flatten `fallback`. Supported → read Java `scale` from `node["scale"]`
  if numeric, sort `entries` **ascending by `threshold`**, flatten each with `priority = (priority ?? 0) + i + 1`.
  The `fallback` is flattened with `priority ?? 0` — **lowest priority**, because it matches when no threshold does.
- `"select"`: unsupported property → report `select on "${property}" not supported by Geyser — fallback model used
  for all cases` + `fallback`. Supported → `whens = Array.isArray(c.when) ? c.when : [c.when]`; non-primitive
  `when` → `unsupported` `select case with non-primitive "when" on ${property} — skipped`. If
  `GEYSER_MATCH_VALUES[geyserProperty]` exists and lacks `whenStr.toLowerCase()` → `unsupported`
  `` `select case "${whenStr}" on ${property} has no Geyser equivalent — that state keeps the default look on Bedrock` ``.
  Otherwise emit `{ type: "match", property: geyserProperty, value }` with
  `value = allowed !== undefined ? whenStr.toLowerCase() : whenStr` — **the canonical lowercased constant, not
  the pack's spelling** (Geyser's `Enum.valueOf` on `"ARROW"` would throw and take the whole definition down).
  Priority `(priority ?? 0) + caseIndex` so cases outrank the fallback.
- `"special"`: always reports first (`` `special model type (${...}) — uses ${node.base ?? "?"} as base model` ``)
  and pushes a variant using `node.base` when it is a string.
- `"empty"`: returns nothing. `default`: `unsupported` `` `unsupported item model node type "${node.type ?? "(none)"}"` ``.

**Bow-pull detection — `extractBowPullGroups(pack)`**

`standbyModelOf(node)` returns `node.model` only when the type is `model` and `model` is a string.
`pullStagesOf(node)` builds stages with `fallback` as `pull: 0`, each via `standbyModelOf` (returns
`undefined` if any stage model isn't a plain model), sorts ascending by `pull`, and returns `undefined` unless
`stages.length >= 2`.

- *Legacy pass* — only `ns === "minecraft"`. Splits overrides into those with a `pulling` predicate
  (`pull = typeof predicate["pull"] === "number" ? predicate["pull"] : 0`, skipping `pulling === 0`) and any
  override **without** `pulling`. Requires `pulling.length > 0 && !hasNonPulling`. Emits a group with
  `baseItem = minecraft:${itemName}`, `modelKey = standbyModel = \`${ns}:item/${itemName}\``, `isModern: false`,
  stages sorted by `pull`, `scale: 0.05` (vanilla pull predicate: 0..1 over a ~20-tick draw), `origin: path`.
  Adds `baseItem` to `consumedKeys`.
- *Modern pass* — root node type (namespace-stripped) must be `condition` with property exactly `using_item`;
  `standbyModelOf(root.on_false)` must be defined; `on_true` must exist and be a `range_dispatch` whose property
  is exactly `use_duration` (bows use `use_duration`; crossbows use `crossbow/pull` and put a charge-state
  `select` in `on_false`, which stays on the normal pipeline). `pullStagesOf(on_true)` must yield ≥ 2 stages.
  `itemModelId = modelKey = \`${ns}:${name}\``, `isModern: true`,
  `scale = typeof onTrue["scale"] === "number" ? onTrue["scale"] : 1`. Adds `itemModelId` to `consumedModernKeys`.

**Ordering guarantee.** `ItemVariant.priority` exists because Java `range_dispatch` picks the highest threshold
≤ value, so higher-threshold entries must be checked first. The priority is copied verbatim onto the emitted
mapping by `itemsStage` (`if (variant.priority !== undefined) definition.priority = variant.priority;`).

**Feeding back.** `extractLegacyVariants` and `extractBowPullGroups` **both** iterate all legacy item models.
The bow pass runs first and its `consumedKeys`/`consumedModernKeys` are passed back in as `bowPullConsumed`.

### 2.4 `packages/core/src/java/definitionHost.ts` — host item inferred from dispatch property

```ts
export function inferHostItemFromDefinition(
  pack: JavaPack,
  itemModelId: string,
  cache?: Map<string, string | undefined>,
): string | undefined
```

**Problem solved.** Most custom models parent to `minecraft:item/generated` or `item/handheld`, which name
hundreds of vanilla items and so identify nothing. But a definition branching on `minecraft:charge_type` can
only be a crossbow, and `fishing_rod/cast` only a fishing rod — so a retextured crossbow announces itself with
no config or datapack input.

**Why it runs last.** It replaces the blunt `modernBaseItem` fallback, never a known answer. Confirmed by the
`itemsStage` order: config hint → `inferHostItemFromModel` (parent chain) → `inferHostItemFromDefinition`
(modern only) → `ctx.options.modernBaseItem`.

**Tables** (documented as derived mechanically from the vanilla client's 1,537 item definitions, 26.2, by
counting which items dispatch on each property):

`PROPERTY_HOST`:

| property | host |
| --- | --- |
| `minecraft:use_duration` | `minecraft:bow` |
| `minecraft:use_cycle` | `minecraft:brush` |
| `minecraft:time` | `minecraft:clock` |
| `minecraft:context_dimension` | `minecraft:clock` |
| `minecraft:crossbow/pull` | `minecraft:crossbow` |
| `minecraft:charge_type` | `minecraft:crossbow` |
| `minecraft:broken` | `minecraft:elytra` |
| `minecraft:fishing_rod/cast` | `minecraft:fishing_rod` |

Explicitly **absent**, with disqualified counts: `local_time` (2), `compass` (2), `has_component` (2),
`using_item` (5), `block_state` (12), `bundle/has_selected_item` (17), `display_context` (26), `trim_material` (29).

`COMPONENT_HOST = { "minecraft:lodestone_tracker": "minecraft:compass" }` — weaker, consulted second.
`minecraft:dyed_color` is excluded because dyeing is common to leather armor too, so a retextured leather set
would be mis-hosted as wolf armor.

**Algorithm**

1. Cache hit check on `itemModelId` (in practice `ctx.definitionHostItems` — deliberately a *separate* map from
   the parent-chain cache `inferredHostItems`, because a cached `undefined` keyed by *model* id could suppress
   the *item-model* lookup for packs that use the same string for both).
2. `parseResourceLocation(itemModelId)` → `pack.readJson(\`assets/${loc.namespace}/items/${loc.path}.json\`)`;
   undefined → `undefined`.
3. `collect(node, properties, components)` walks the whole document (arrays and objects). For every
   `[key, value]` where the value is a string and the key is exactly `property` or `component`, it normalizes
   (`value.includes(":") ? value : \`minecraft:${value}\``) and adds to the set. **The whole subtree is walked**,
   so nested branch nodes count.
4. `PROPERTY_HOST` is consulted over `properties` first, then `COMPONENT_HOST` over `components` — Set iteration
   is insertion order, so among several matching properties the first encountered wins.

### 2.5 `packages/core/src/java/mergePacks.ts` — multi-pack merge

Merges several Java resource packs into one tree the way the client would with all of them enabled: additive
files deep-merged, everything else single-owner with conflicts reported.

```ts
export interface MergeInput { name: string; bytes: Uint8Array }
export interface MergeConflict { path: string; kept: string; overridden: string[] }
export interface MergedFile { path: string; sources: number; shadowedKeys: string[] }
export interface MergeResult {
  vfs: VirtualFs;
  unreadable: { pack: string; name: string; reason: string }[];
  failedPacks: string[];
  conflicts: MergeConflict[];
  mergedFiles: MergedFile[];
  packs: { name: string; files: number }[];
}
export function mergeJavaPacks(inputs: MergeInput[]): MergeResult
```

Private: `interface Contribution { pack: string; doc: unknown; bytes: Uint8Array }`.

**Priority: list order, first wins** — matching Minecraft's top-of-list-overrides behaviour.

1. Open each input via `readZipDetailed`; record `read.failed` into `unreadable` with the pack name; push
   `{ name, vfs, root: findPackRoot(read.vfs) }` to `opened` and `{ name, files }` to `result.packs`. A throw
   pushes the name to `failedPacks` and an `unreadable` entry with reason `"unreadable archive"` or the message.
2. **Single-input short circuit**: `if (opened.length === 1) { result.vfs = opened[0]!.vfs; return result; }` —
   the vfs is returned **untouched, not even re-serialised**, so a one-pack conversion behaves exactly as before
   merging existed (lenient parsing + rewriting would otherwise discard unparseable content before any stage saw it).
3. Multi-pack: for each pack in priority order, for each path (raw, not root-relative): skip if
   `!path.startsWith(pack.root)`; `rel = path.slice(pack.root.length)`; skip `rel === ""`. Root stripping is
   essential — otherwise `JavaPack.open` resolves one root and everything under the others is invisible with no
   conflict and no error.
   - Additive → append a `Contribution` to `additive.get(rel)`.
   - Otherwise → `owners: Map<string, string[]>`; the first supplier writes the bytes and records `[pack.name]`.
     Later suppliers push their name, and if the existing bytes differ (`sameBytes`) a conflict is recorded via
     `recordConflict`. **Byte-identical duplicates are not conflicts** (shared upstream asset).
4. Additive combination, after every contributor is known:
   - One contributor → write its bytes verbatim.
   - Any contribution with `doc === undefined` (unparseable) → **fall back to single-owner semantics**: write
     `first.bytes` and record conflicts for later contributors whose bytes differ. Otherwise a later pack's
     *parsed* copy would overwrite an earlier pack's unparseable one, inverting priority silently.
   - Otherwise `mergeAdditive(path, docs, shadowed)`, serialized with `JSON.stringify(combined)` (compact).

**`isAdditive(path)`**: `path === "pack.mcmeta" || path.endsWith("/pack.mcmeta")` — always additive. Otherwise
must end in `.json` and match one of:

- `/(?:^|\/)assets\/[^/]+\/sounds\.json$/`
- `/(?:^|\/)assets\/[^/]+\/lang\/[^/]+\.json$/`
- `/(?:^|\/)assets\/[^/]+\/atlases\/[^/]+\.json$/`
- `/(?:^|\/)assets\/[^/]+\/font\/[^/]+\.json$/`

**`mergeAdditive(path, docs, shadowed)`** dispatches: `pack.mcmeta` → `mergePackMeta`;
`/assets/<ns>/atlases/` → `mergeListField(docs, "sources")`; `/assets/<ns>/font/` →
`mergeListField(docs, "providers")`; everything else (sounds.json, lang) → `mergeKeys(docs, shadowed)`.

- `mergeKeys`: shallow key union, first contributor wins, duplicate keys pushed once into `shadowed`
  (guarded by `!shadowed.includes(key)`).
- `mergeListField`: non-target keys are taken from the first pack that has them; the target array is
  concatenated across packs, deduping entries by `JSON.stringify(entry)` fingerprint so a shared upstream file
  isn't stitched/drawn twice.
- `mergePackMeta`: every top-level section is carried over (`language`, `filter`, … — not just `pack`/`overlays`);
  `pack` keys are first-contributor-wins; the declared format range only ever **widens**; overlay entries are
  unioned by their `directory` string. Output sets `pack_format` (max seen), `min_format`, `max_format`, and —
  when both exist — `supported_formats: [min, max]` (it must agree with the widened range or the client rejects
  the pack on the versions the range just gained). `overlays` is emitted as `{ entries: overlays }` only when
  non-empty.
- `formatRange(pack)` accepts `supported_formats` as a two-element array, an object with `min_inclusive` /
  `max_inclusive`, or a single number, and folds in `pack_format`.

---

## 3. Config parsers

### 3.1 `packages/core/src/java/configShared.ts` — shared hint model + value parsers

The hint record every plugin parser fills, plus the value-coercion helpers they share — kept separate so
parsers depend on it one-way rather than on each other.

```ts
export interface FurnitureTransform { none: boolean; scale: number; context?: JavaDisplayContext }
export interface VanillaModelItem { key: string; baseItem: string; itemModel: string }
export interface ConfigHints {
  baseItems: Record<string, string>;
  displayNames: Record<string, string>;
  equippables: Record<string, { asset: string; slot: string }>;
  colors: Record<string, number>;
  cmdKeys: Record<string, string>;
  backpacks: string[];
  furniture: string[];
  furnitureTransforms: Record<string, FurnitureTransform>;
  vanillaModelItems: VanillaModelItem[];
  files: number;
  items: number;
}
export function displayContextOf(raw: unknown): JavaDisplayContext | undefined
export function isNoneTransform(raw: unknown): boolean
export function stripNamespace(id: string): string
export function parseScaleMagnitude(scale: unknown): number
export function stripFormatting(raw: unknown): string | undefined
export function parseColor(raw: unknown): number | undefined
export function asRecord(value: unknown): Record<string, unknown> | undefined
```

**Keying invariant.** Every map is keyed the way the pipeline looks items up: the config key, the `item_model`
path, and the model file's **last path segment** — all namespace-stripped and lowercased.
`stripNamespace` takes everything after the first `:` (or the whole string) and lowercases it.

- `cmdKeys` is keyed `"minecraft:material|cmd"` → item key, for packs dispatching on `custom_model_data`.
- `backpacks` are HMCCosmetics BACKPACK entries — armor-stand head items Bedrock renders lower than Java.
- `DISPLAY_CONTEXTS` maps the plugin spelling to the model `display` key, stripping `_`, whitespace and `-` and
  uppercasing first: `FIXED→fixed`, `HEAD→head`, `GUI→gui`, `GROUND→ground`, `THIRDPERSONLEFTHAND→
  thirdperson_lefthand`, `THIRDPERSONRIGHTHAND→thirdperson_righthand`, `FIRSTPERSONLEFTHAND→
  firstperson_lefthand`, `FIRSTPERSONRIGHTHAND→firstperson_righthand`. `NONE` and unknown → `undefined`.
- `parseScaleMagnitude` accepts a number, a comma-separated string, or an array, and takes the **largest
  absolute** finite component; `1` when absent/unparseable.
- `stripFormatting`: `.replace(/[§&][0-9a-fk-orx]/gi, "").replace(/<[^<>]+>/g, "").trim()`, returning `undefined`
  if empty. Strips both legacy `&c`/`§c` codes and MiniMessage tags (`<red>`, `<#FF8C00>`, `<!i>`).
- `parseColor` accepts, in order: an **integer** → `raw & 0xffffff`; a 3-element array of ints 0–255 →
  `(r << 16) | (g << 8) | b`; a string matching `/^#?([0-9a-fA-F]{6})$/` → hex; a string matching
  `/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/` with all ≤ 255; a string matching `/^\d{7,}$/` (packed decimal,
  e.g. oxywire `"10568504"`) → `n & 0xffffff`. The 7+ digit threshold exists because a 6-digit value is ambiguous
  with bare hex. All results masked to `0xffffff`.
- `asRecord`: `null`/non-object/**array** → `undefined` — the "array is not a record" guard used everywhere.

### 3.2 `packages/core/src/java/oraxen.ts` — Oraxen/Nexo/ItemsAdder/HMCCosmetics YAML parser

```ts
export type OraxenHints = ConfigHints
export function parseOraxenConfigZip(zipBytes: Uint8Array): OraxenHints
export function parseOraxenConfigZips(zips: Uint8Array[]): OraxenHints
```

**Entry point flow (`parseOraxenConfigZips`)**

1. Initialize `hints` with every field empty, plus `backpackSet` and `furnitureSet: Set<string>`.
2. **Template pre-pass across *all* zips first**: `collectTemplates(zipBytes, templates)` — so `template:`
   references (Nexo templates carrying material/model, often in a separate core file) resolve regardless of
   file/zip order.
3. Then `parseOne(zipBytes, hints, backpackSet, furnitureSet, templates, craftEngine)` per zip, sharing one
   `CraftEngineState`.
4. **Backpack cmd resolution**: for each ref containing `"|"` and present in `hints.cmdKeys`, add the resolved key.
5. `finalizeCraftEngine(craftEngine, furnitureSet, hints)`.
6. `hints.backpacks = [...backpackSet].filter((k) => !k.includes("|"))`; `hints.furniture = [...furnitureSet]`.

`listYaml(vfs)` = `[...vfs.list({ suffix: ".yml" }), ...vfs.list({ suffix: ".yaml" })]` — CraftEngine packs use
`.yaml`, the rest `.yml`.

`collectTemplates`: loads every YAML with js-yaml `load` in a try/catch (`continue` on throw) and stores every
**top-level** object entry under `key.toLowerCase()`, plus every entry of the root `items:` section. Only object
values (non-null, non-array) are stored. This is what makes ItemsAdder's `variant_of` and Nexo's `template`
resolvable.

`templateRef(obj)` = `obj["template"]` if a string, else `obj["variant_of"]` if a string.

`resolveTemplate(key, value, templates)`: follows the `template`/`variant_of` chain with a `seen` set on
lowercased refs (cycle-safe). Then `chain.reverse()` is deep-merged root-first, then the item's own fields are
merged on top; `template`/`variant_of` are deleted. Finally `substitutePlaceholders(obj, key)` replaces the
literal `/<item_id>/g` with the item key in every string, recursively. `deepMerge` merges objects recursively
and **overwrites** arrays/scalars.

**`parseOne`**

1. Reads the zip. **`if (isDatapack(vfs)) parseDatapack(vfs, hints);`** — deliberately *not* an early return: one
   upload can hold both a zipped `plugins/` folder and a companion datapack.
2. For each YAML: `load` in try/catch (`continue` on failure); skip null/non-object/array roots.
3. **`if (isCraftEngineDoc(root))`** → `parseCraftEngineDoc(...)`; bump `files`/`items` if it returned > 0;
   `continue` (CraftEngine's sections collide with ItemsAdder's `items:` but mean different things).
4. Otherwise the generic `register(key, value)` closure:
   - **Skips pure template definitions**: `value["template"] === true`.
   - Reads, in order: `extractMaterial` → `base = \`minecraft:${material.toLowerCase()}\``; `extractDisplayName`;
     `extractColor`; `extractModelAliases`; `extractIsFurniture`; `extractFurnitureTransform` (only if furniture).
   - **Early return if nothing identifying**: `base === undefined && displayName === undefined && aliases.length === 0
     && !isFurniture`. Material is optional (ItemsAdder 1.21.4+ items declare only an `item_model`).
   - Writes `hints.baseItems[lowerKey]`, `displayNames`, `equippables`, `colors`.
   - `extractCmd` → if a number **and** `base !== undefined`: `hints.cmdKeys[\`${base}|${cmd}\`] = lowerKey`, and if
     the pair is in `backpackSet`, add `lowerKey` too.
   - Furniture → `furnitureSet.add(lowerKey)` and `hints.furnitureTransforms[lowerKey] = transform`.
   - **Every alias gets the same treatment**.
5. **HMCCosmetics pre-pass** over root values: `kind = obj["type"] ?? obj["slot"]` must be a string whose
   `.toUpperCase()` **includes** `"BACKPACK"`. Then `obj["item"]` must be an object:
   `material` containing `":"` → `backpackSet.add(stripNamespace(material))`;
   `material` without `":"` **and** numeric `model-data` → `backpackSet.add(\`minecraft:${material.toLowerCase()}|${modelData}\`)`.
6. **ItemsAdder layout**: `root["items"]` object → `register(key, resolveTemplate(key, value, templates))` per entry.
7. **Oraxen/Nexo layout**: every top-level key except `"items"` and `"info"` → the same treatment.

**Field extractors (all private)**

- `extractMaterial(item)`: `obj["material"]`, else `resource.material`, else — when `resource.generate === true` —
  the literal `"PAPER"`. Returned only if a string matching `/^[A-Za-z_]+$/`.
- `extractModelAliases(item)`: `stripNamespace` of, in order: `Components.item_model`; top-level `item-model` ??
  `item_model` (pushing both the full path *and* its last `/` segment); `Pack.model`; `resource.model_path`'s last
  segment (ItemsAdder `item/ruby_sword` → `ruby_sword`).
- `extractColor(item)`: top-level `color`, else `Components.dyed_color` → `parseColor`.
- `extractIsFurniture(item)`: true if any section named `Mechanics`, `mechanics`, `behaviours`, `behaviors` is an
  object containing the key `furniture`.
- `extractFurnitureTransform(item)`: same four section names; takes `section.furniture`, then `furniture.properties`
  if an object else `furniture` itself, and reads `display_transform` ?? `displayTransform` plus `scale`.
  **The first matching section wins.**
- `extractCmd(item)`: `Pack.custom_model_data`, only if a number.
- `extractEquippable(item)`: `Components.equippable`, asset from `asset_id` ?? `model`, plus `slot`;
  returns `{ asset: stripNamespace(asset), slot: slot.toLowerCase() }`.
- `extractDisplayName(item)`: `stripFormatting(obj["displayname"] ?? obj["customname"] ?? obj["display_name"] ??
  obj["itemname"] ?? obj["name"])`.

**Covered paths**: `plugins/Oraxen/items/*.yml`, Nexo `items/*.yml`, ItemsAdder `contents/<ns>/configs/*.yml`,
CraftEngine `configuration/*.yml`, HMCCosmetics cosmetics YAML. There is **no hard-coded path filter inside the
zip** — *every* `.yml`/`.yaml` anywhere in the zip is loaded and heuristically classified.

### 3.3 `packages/core/src/java/craftEngine.ts` — CraftEngine

```ts
export interface CraftEngineState {
  furnitureRefs: Set<string>;
  refTransforms: Map<string, FurnitureTransform>;
  aliasesByKey: Map<string, string[]>;
}
export function newCraftEngineState(): CraftEngineState
export function isCraftEngineDoc(root: Record<string, unknown>): boolean
export function parseCraftEngineDoc(root: Record<string, unknown>, hints: ConfigHints, state: CraftEngineState): number
export function finalizeCraftEngine(state: CraftEngineState, furnitureSet: Set<string>, hints: ConfigHints): void
```

External format (as documented in the module header):

```yaml
items:
  default:ruby_sword:
    material: golden_sword          # the vanilla host item
    custom_model_data: 10001        # root-level, not nested under Pack
    item_model: default:ruby_sword  # root-level; defaults to the item id
    texture: minecraft:item/custom/ruby_sword   # simplified model
    model:                          # or a full model tree / bare path
      type: minecraft:model
      path: minecraft:item/custom/ruby_sword
    data:
      item_name: "<!i><#FF8C00>Ruby Sword"
      dyed_color: 255,128,64
      equippable: { slot: head, asset_id: minecraft:topaz }
    settings:
      equipment: { asset_id: default:topaz, slot: head }
    behavior:
      type: furniture_item
      furniture: default:bench      # id reference, or an inline definition

furniture:
  default:bench:
    settings: { item: default:bench }
    variants:
      ground:
        elements:
          - item: default:bench_model      # the item the display entity holds
            display_transform: none
            scale: 1,1,1
```

- **`isCraftEngineDoc(root)`** — true if `asRecord(root["furniture"]) !== undefined`, or
  `asRecord(root["equipments"]) !== undefined`, or `items` is a record whose keys **all contain `":"`**
  (ItemsAdder, the other plugin with an `items:` section, uses bare keys).
- **`registerItem(id, item, hints, state)`** — `key = stripNamespace(id)`; `aliases = modelAliases(id, item).filter(a => a !== key)`;
  `base` from `item["material"]` only when it matches `/^[A-Za-z_]+$/`; `data = asRecord(item["data"]) ?? {}`;
  `displayName` from `data["item_name"] ?? data["custom_name"] ?? data["display_name"]`; `color = parseColor(data["dyed_color"])`;
  `equippable = extractEquippable(item, data)`. Returns `false` (not counted) if
  `base === undefined && displayName === undefined && aliases.length === 0`. Writes base/displayName/color/equippable
  for `[key, ...aliases]` and records `state.aliasesByKey.set(key, aliases)`.
  `vanillaModel = vanillaItemModel(item["item_model"])`; if defined and `base` defined and `vanillaModel !== base` →
  `hints.vanillaModelItems.push({ key, baseItem: base, itemModel: vanillaModel })`. `cmd = item["custom_model_data"]`;
  if a number and `base` defined → `hints.cmdKeys[\`${base}|${cmd}\`] = key`. Then
  `registerFurnitureBehavior(key, item, state)`.
- **`modelAliases(id, item)`** collects `stripNamespace` plus last-`/`-segment for, in order:
  `item["item_model"] ?? id`; `item["texture"]`; `item["model"]` when a string else `asRecord(item["model"])?.["path"]`;
  then every entry of the `models` and `textures` **arrays** (multi-slot materials like bow/crossbow/fishing rod list
  one per state). Nested branch nodes (condition/select/…) are **not** walked — their children are variant states of
  the same item, resolved from the pack's own item definition JSON.
- **`vanillaItemModel(value)`** — `undefined` for non-strings/empty; namespace defaults to `minecraft`, lowercased;
  requires namespace exactly `minecraft` and path matching `/^[a-z0-9_]+$/`; returns `minecraft:${path}`.
- **`extractEquippable(item, data)`** tries `asRecord(data["equippable"])` then
  `asRecord(asRecord(item["settings"])?.["equipment"])`; the first source with string `asset_id` **and** string `slot` wins.
- **`registerFurnitureBehavior(key, item, state)`** — `raw = item["behavior"] ?? item["behaviors"]`, normalized to an
  array of records. For each behavior with `type === "furniture_item"`: `state.furnitureRefs.add(key)`; if
  `behavior["furniture"]` is a record, `registerFurniture(key, inline, state)`.
- **`registerFurniture(id, furniture, state)`** — `settingsItem = asRecord(furniture["settings"])?.["item"]`; if a
  string, `furnitureRefs.add(stripNamespace(settingsItem))`, **else** add `stripNamespace(id)`.
  For each `furniture["variants"]` value and each entry of its `elements` array, reading `element["item"]` as a string:
  `ref = stripNamespace(elementItem)`; add to `furnitureRefs`; `if (state.refTransforms.has(ref)) continue;` —
  **first variant wins**, since `ground` is listed first by convention and is the placement Bedrock players see most.
- **`finalizeCraftEngine`** applies each ref's transform to `[ref, ...(state.aliasesByKey.get(ref) ?? [])]`. This is why
  a furniture block may live in a different file from the item it displays: refs are collected across every file and
  resolved once all items are known.

### 3.4 `packages/core/src/java/datapack.ts` — vanilla datapack base-item extraction

Extracts base-item hints from a vanilla **datapack**, where the host-item binding is scattered across loot tables,
recipes, advancements and functions rather than declared in a YAML.

```ts
export function isDatapack(vfs: VirtualFs): boolean
export function parseDatapack(vfs: VirtualFs, hints: ConfigHints): number
```

Where bindings live:

```
loot_table   {"type":"minecraft:item","name":"minecraft:chiseled_quartz_block",
              "functions":[{"function":"minecraft:set_components",
                            "components":{"minecraft:item_model":"stellarity:altar_of_the_sacred"}}]}
advancement  {"display":{"icon":{"id":"minecraft:book",
                                 "components":{"item_model":"stellarity:endonomicon"}}}}
recipe       {"result":{"id":"minecraft:poisonous_potato","components":{...}}}
function     give @s minecraft:iron_sword[minecraft:item_model="cnk:netherite_knife"]
```

Plus `villager_trade` and `item_modifier`, which the generic walk covers without new code.

- `isDatapack(vfs)`: any path with `dataCategory(path) !== undefined`.
- `dataCategory(path)`: requires the `.json`/`.mcfunction` suffix; `parts = path.split("/")`;
  `at = parts.indexOf("data")`; requires `at !== -1 && at <= 1` (root for a plain pack, one deeper for an overlay such
  as `overlay_26_1/data/...`) and `parts.length >= at + 4`; returns `canonicalCategory(parts[at + 2])`.
- `CATEGORY_ALIASES` (plural → singular, pre-1.21 → 1.21+): `loot_tables→loot_table`, `recipes→recipe`,
  `advancements→advancement`, `functions→function`, `item_modifiers→item_modifier`, `predicates→predicate`,
  `structures→structure`, `tags→tags`. Both spellings resolve to the same category.
- `SOURCE_RANK` (higher wins): `loot_table: 4`, `recipe: 4`, `item_modifier: 3`, `villager_trade: 3`, `function: 2`,
  `advancement: 1`; `DEFAULT_RANK = 2` for anything else. Rationale: an advancement icon is decoration and may use a
  stand-in item, while a loot table or recipe result is what the player actually receives.

**Regexes**

- `ITEM_ID = /^(?:minecraft:)?([a-z0-9_]+)$/` — item ids never contain `/`, which keeps model paths
  (`stellarity:block/altar`) and function ids (`cnk:basin/main`) from being mistaken for one.
- `COMMAND_ITEM_ID = /(?:\bid\s*:\s*["']?|\b(?:give\s+\S+|with)\s+)(?:minecraft:)?([a-z0-9_]+)["']?\s*[[,}]/g`
- `COMMAND_ITEM_MODEL = /["']?(?:minecraft:)?item_model["']?\s*[:=]\s*["']([^"']+)["']/g`

**`parseDatapack(vfs, hints): number`** — returns the number of distinct item models bound to a host item.

1. Seeds `scan.lootItems = indexLootTables(vfs)`.
2. For every path with a `dataCategory`: `rank = SOURCE_RANK[category] ?? DEFAULT_RANK`; `.json` → `parseLenientJson`
   then `walk(doc, undefined, rank, scan)`; `.mcfunction` → `scanFunction(text, SOURCE_RANK["function"]!, scan)`.
3. Apply to `hints`, **never overwriting**: `if (hints.baseItems[key] !== undefined) continue;` — a plugin config that
   named the material outright is more authoritative. Only counted bindings increment `bound`.
4. `shortAliases(scan.bindings)` → `hints.baseItems[alias] ??= base`; item models live in subfolders
   (`stellarity:_particle/spark` → `assets/stellarity/items/_particle/spark.json`) and the pipeline looks up by either
   the full path or the last segment.
5. `hints.displayNames[key] ??= name`; `hints.colors[key]` only if undefined; `hints.equippables[key] ??= equippable`.

**`indexLootTables(vfs)`** — for every `.json` whose `dataCategory` is `loot_table`, parses it, computes
`lootTableId(path)`, takes `firstEntry(doc)`, and files it into `direct` (kind `item`) or `refs` (kind `ref`). Then
flattens chains with a `seen` set (packs may be cyclic). Motivating example: `food/candy/base.json` yields
`minecraft:poisonous_potato` while `food/candy/black.json` is a `{"type":"minecraft:loot_table","value":"cnk:food/candy/base"}`
reference that layers an `item_model` on top — without following the reference those variants are unresolvable.

- `lootTableId(path)`: `"data/cnk/loot_table/food/candy/base.json"` → `"cnk:food/candy/base"`.
- `firstEntry(node)`: recursive, arrays walked in order; returns `{ kind: "item", value }` for `stripNamespace(type) === "item"`
  when `itemIdOf(obj)` resolves, `{ kind: "ref", value: value.trim().toLowerCase() }` for `loot_table` with a non-empty
  string `value`. Then descends into children **skipping the `"components"` key**. Only the first entry is used —
  tables mixing several host items can't be reduced to one binding.

**`shortAliases(bindings)`** — for each key with a `/`, `leaf = key.slice(key.lastIndexOf("/") + 1)`; skip empty leaves,
leaves that are themselves a binding, and already-conflicted leaves; if two different bases claim the same leaf, delete
the alias and mark it conflicted. **An ambiguous alias is worse than none.**

**`walk(node, base, rank, scan)`** — arrays recurse in order; non-records return.
`scope = itemIdOf(obj) ?? lootRefItem(obj, scan) ?? base` — any object naming a vanilla item re-scopes its whole subtree,
so `components` nested under a loot-table `functions` array still bind to the entry's item. Then
`asRecord(obj["components"])` → `applyComponents(components, scope, rank, scan)`, and recurse into every key except `components`.

- `lootRefItem(obj, scan)`: for an object whose `stripNamespace(type) === "loot_table"` with a string `value`, returns
  `scan.lootItems.get(value.trim().toLowerCase())`.
- `itemIdOf(obj)`: tries fields `["id", "name", "item"]` **in that order**; each must match `ITEM_ID` after
  `.trim().toLowerCase()`; **`air` is skipped** (the "no item" placeholder); returns `minecraft:${match[1]}`.
- `applyComponents(components, base, rank, scan)`: `model = component(components, "item_model")` must be a non-empty
  string; `key = stripNamespace(model.trim())`. If `base !== undefined`, store `{ base, rank }` when there is no existing
  binding **or `rank > existing.rank`** (ties keep the earlier). Then `item_name` → `plainText` → `scan.names` (first wins);
  `dyed_color` → `dyedColor` → `scan.colors` (first wins); `equippable` → `scan.equippables` (first wins).
- `component(components, name)` = `components[\`minecraft:${name}\`] ?? components[name]` — both spellings occur, often
  in the same file.
- `plainText(value)`: string → trimmed or `undefined`; array → first part that flattens; object → `fallback` then `text`.
  A bare `translate` key is deliberately ignored ("block.stellarity.ashen_froglight" is an id, not a name) unless a
  `fallback` is supplied.
- `dyedColor(value)`: number → `value & 0xffffff`; record → `parseColor(obj["rgb"])` (pre-1.21.5 shape); else `parseColor(value)`.

**`scanFunction(text, rank, scan)`** — the linear counterpart of `walk`. Early-outs unless the whole text contains
`item_model`; per line, skips lines without it. Collects `ids` as `{ at: m.index, item: m[1] }` from `COMMAND_ITEM_ID`
(both `lastIndex` reset to 0 before each `exec` loop), skipping `air`. For each `COMMAND_ITEM_MODEL` match, skips macro
placeholders (`model.includes("$(")`) and empties; then the binding is the **nearest item id written before the model**
(`if (id.at < m.index) base = ... else break`). No id earlier on the line → the whole line is skipped.

> **Per-line scoping is a safety property.** `summon item_display … {item: {id: "minecraft:cobblestone", components:
> {"minecraft:item_model": "cnk:booze_bottle"}}}` binds correctly, whereas `data modify entity @s item.components."minecraft:item_model"
> set value "cnk:basin"` names no item on the line and is correctly left unbound instead of latching onto an earlier line's id.

---

## 4. Utilities

### 4.1 `packages/core/src/util/packPath.ts` — Bedrock path-length budgeting

```ts
export const MAX_PACK_PATH = 79;
export function fitPathName(name: string, reserved: number): string
export function fitFilePath(dir: string, name: string, suffix: string): string
```

- `MAX_PACK_PATH = 79` — Bedrock warns at 80 characters and some platforms fail to read such paths.
  Private `HASH_CHARS = 8`.
- Motivation: obfuscating plugins replace model ids with UUIDs (Nexo ships
  `nexo:0c702f35-4d5e-4593-b3c8-8efed2ddd7a7`), 41 characters after `safeName` runs.
- `fitPathName(name, reserved)`: `budget = MAX_PACK_PATH - reserved`. Names that fit are returned **untouched**, so
  ordinary packs keep descriptive file names. Otherwise `hash = fastHashString(name).slice(0, 8)` — the **full** name is
  hashed, so names sharing a prefix (exactly the UUID case) can't collide once truncated. If `budget <= hash.length + 1`
  it returns **the bare hash** (truncating further would give two models the same file and still exceed the limit).
  Otherwise `name.slice(0, budget - hash.length - 1).replace(/_+$/, "") + "_" + hash`.
- `fitFilePath(dir, name, suffix)`: `dir + fitPathName(name, dir.length + suffix.length) + suffix`.
  **Contract: `dir` must end with `/` and `suffix` must start with `.`** — there is no assertion; violating it silently
  produces a bad path. Used for animations, geometries, render controllers and attachables, which Bedrock locates by
  scanning the folder and reading the id inside, so their file names only need uniqueness.
- Concrete budgets live in `itemsStage.ts`: `ICON_PATH_RESERVED = "textures/geyser_custom/_rrggbb.png".length` and
  `HELD_FRAME_PATH_RESERVED = "textures/geyser_custom/anim/_99.png".length`.

### 4.2 `packages/core/src/util/hash.ts` — content hash for dedup keys

```ts
export function fastHash(data: Uint8Array): string
export function fastHashString(text: string): string
```

- **Two independent FNV-1a lanes**: `h1` seeded `0x811c9dc5 ^ data.length`, `h2` seeded `0xc2b2ae35 ^ data.length`;
  multipliers `0x01000193` and `0x85ebca77`. Output is
  `(h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")` — always 16 hex chars.
- Collision odds across a pack's textures are ~1e-12; sha256 measured ~12 s on a large pack, and dedup needs
  "same bytes → same key", not tamper resistance.
- **Word-wise mixing**: `words = data.length >>> 2`; a `DataView` over `data.buffer, data.byteOffset, words << 2` mixes
  32-bit words with `getUint32(w << 2, true)` — one `imul` pair per four bytes instead of per byte (~3.3x faster;
  36 ms → 11 ms per 32 MiB). `DataView` rather than a `Uint32Array` view because unaligned and byteOffset-into-larger-buffer
  slices arrive from zip and `subarray` reads. The explicit little-endian `true` keeps the word order host-independent, so
  generated pack paths are stable across platforms.
- Tail bytes are mixed one at a time with the same multipliers.
- `fastHashString(text)` = `fastHash(new TextEncoder().encode(text))`.

---

## 5. Cross-file notes worth citing

- **`findPackRoot` is shared by `JavaPack.open` and `mergeJavaPacks`** — `mergePacks.ts` calls it directly on each input
  vfs and again implicitly through `JavaPack.open` on the merged tree. Any change to root detection affects both.
- **Hint lookup order for a variant's host item** (in `itemsStage`): (1) config hint by any of the item's name keys;
  (2) `inferHostItemFromModel(ctx.java, variant.model, ctx.inferredHostItems)` — model parent chain; (3) for
  `source.kind === "modern"` only, `inferHostItemFromDefinition(ctx.java, variant.source.itemModelId, ctx.definitionHostItems)`;
  (4) `ctx.options.modernBaseItem` with an `approximated` report and `ctx.fallbackBaseItemHits++`. Steps 2 and 3 use
  **separate caches on purpose** (keyed by model id vs item-model id) because a pack may name both the same, and a cached
  `undefined` from the parent-chain walk would otherwise suppress the definition lookup.
- **Two jsonc entry points, one rule**: `parseLenientJson` for read-only stages, `parseStrictJson` wherever a parse result
  gets re-serialised.
- **`safeName` lives in `convert/stages/itemsStage.ts`** (not in `util/packPath.ts`):
  `id.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")`. Note it does *not* split on `:`, so
  `nexo:0c702f35-…` keeps its `_`-joined form, which is what makes the UUID 41 characters.
- **Public surface** (`packages/core/src/index.ts`) exports: `parseOraxenConfigZip`, `parseOraxenConfigZips`, `OraxenHints`;
  `mergeJavaPacks`, `MergeInput`, `MergeResult`, `MergeConflict`; `isDatapack`, `parseDatapack`; `extractBowPullGroups`,
  `BowPullGroup`, `BowPullStage`. `extractLegacyVariants` / `extractModernVariants` / `inferHostItemFromDefinition` /
  `JavaPack` / `parseLenientJson` are **not** re-exported — they are consumed internally by `convert/`, so changing their
  signatures only breaks in-repo callers.
