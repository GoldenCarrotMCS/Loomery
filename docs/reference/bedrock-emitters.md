# Reference — Bedrock emitters, model resolver, ModelEngine conversion

> Part of the Loomery reference set. See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the flow, and
> [pipeline-and-stages.md](pipeline-and-stages.md) for which stage calls which emitter.
>
> Read this before touching anything under `packages/core/src/bedrock/`, `resolve/`, or `modelengine/`.

**The cross-cutting coordinate fact.** Java models are authored in a 0–16 block space, Y-up, Z-south, with the
item centred on its own origin once placed. Bedrock geometry is Y-up, Z-north, and its attachable bone rig
mirrors the item-slot bone about X. Loomery therefore (a) mirrors X, (b) offsets Z by −8, and (c) negates Java
rotation angles. The `modelengine/` converters **omit the ±8 item offsets entirely** because entity models are
authored around the entity origin.

---

## 1. `packages/core/src/bedrock/geometry.ts` — Java elements → Bedrock geometry

Converts Java block-model elements into a Bedrock `minecraft:geometry` (1.16.0 or 1.21.0) whose cubes hang off a
fixed four-bone chain, remapping per-face UVs out of Java texture space into an atlas tile's pixel space. Used by
both `geometryStage` (`items-3d`) and `blocksStage` (`blocks`).

```ts
export const BONE_ROOT = "geysercmd";
export const BONE_X = "geysercmd_x";
export const BONE_Y = "geysercmd_y";
export const BONE_Z = "geysercmd_z";

export interface GeometryBuild {
  geometry: object;
  /** True if any face used a UV rotation (requires newer format on the client). */
  usedUvRotation: boolean;
}

export function buildGeometry(
  identifier: string,
  elements: JavaElement[],
  faceTexture: (element: JavaElement, face: JavaFaceName) => AtlasPlacement | undefined,
  atlasSize: { width: number; height: number },
  options?: { flipFacing?: boolean; textureSize?: [number, number] },
): GeometryBuild

export function defaultUv(
  face: JavaFaceName,
  from: [number, number, number],
  to: [number, number, number],
): [number, number, number, number]
```

Private: `interface BedrockFaceUv { uv: [number, number]; uv_size: [number, number] }`;
`interface BedrockCube { origin; size; pivot?; rotation?; uv: Partial<Record<JavaFaceName, BedrockFaceUv>> }`;
helpers `flip180AboutY(cubes)`, `wrapUvRotation(deg)`, `wrapDegrees(deg)`.

### Coordinate transform (per element, after rescale baking)

```
origin = [ 8 - to.x ,  from.y ,  from.z - 8 ]
size   = [ to.x - from.x , to.y - from.y , to.z - from.z ]
pivot  = [ 8 - rot.origin.x ,  rot.origin.y ,  rot.origin.z - 8 ]   // only when rotating
```

- X is **mirrored about the model centre** (8) — the Java↔Bedrock handedness flip.
- Y passes through untouched.
- Z is translated by −8 (Bedrock's Z origin is the block centre, Java's is the corner). Note it is `from.z - 8`, so
  the cube's *near* Z face is the origin face — there is **no Z mirror**.
- `pivot` is emitted **only** inside the rotation branch; a non-rotated cube has no `pivot` key at all.
- Size is not mirrored, so a renderer composes `origin … origin+size` from the mirrored min-corner — which is why X
  uses `8 - to.x` while the other axes use `from`.

### Rotation

```
axis === "x" → [ -angle, 0, 0 ]
axis === "y" → [  0, -angle, 0 ]
axis === "z" → [  0, 0, angle ]
```

Guard: rotation is emitted only when `element.rotation !== undefined && angle !== 0 && Number.isFinite(angle)`.
`null`/`NaN` in the rotation array makes Bedrock reject the whole geometry (item renders invisible).
`JavaElement.rotation` is **single-axis only**; the flip logic depends on that.

### `rescale` baking

Java's `"rescale": true` scales the element by `1/cos(angle)` on the axes perpendicular to the rotation axis, about
the rotation origin. Bedrock has no rescale flag, so it is baked into `from`/`to` **before** the origin/size math and
**before** UV defaulting:

```
f = 1 / cos(|angle| · π/180)          // degrees, absolute value
axisIndex = { x: 0, y: 1, z: 2 }[element.rotation.axis]
v'[i] = i === axisIndex ? v[i] : origin[i] + (v[i] - origin[i]) * f
```

Applied only when `rescale === true && angle !== 0`. **Invariant: UVs default from the *unscaled* `from`/`to`** —
rescale moves vertices, not texture coordinates.

### UV mapping — the central gotcha

For each face in the order `["north","south","east","west","up","down"]`:

1. `face.texture` is resolved by the caller's `faceTexture` callback, returning an `AtlasPlacement
   { x, y, width, height }` — the tile's pixel offset and original pixel size in the stitched atlas.
2. `uvRaw = face.uv ?? defaultUv(faceName, element.from, element.to)`.
3. **Divisor selection:** `explicitUv !== undefined ? texSizeU/texSizeV : 16`. An explicit `face.uv` is authored in
   `texture_size` space (HD models use e.g. `[128,128]`); an omitted `uv` uses Java's auto-UV, which is always in
   0–16 block space. Each is normalized by a **different** divisor.
4. `sx = placement.width / divU`, `sy = placement.height / divV`.
5. Emitted: `uv = [placement.x + u1*sx, placement.y + v1*sy]`,
   `uv_size = [(u2-u1)*sx, (v2-v1)*sy]`.
6. `face.rotation !== undefined && face.rotation !== 0` → add `uv_rotation` and set `usedUvRotation = true`.

`defaultUv` — Java's per-face auto-UV origin convention, all in 0–16:

| face | `[u1, v1, u2, v2]` |
| --- | --- |
| `down` | `[x1, 16 - z2, x2, 16 - z1]` |
| `up` | `[x1, z1, x2, z2]` |
| `north` | `[16 - x2, 16 - y2, 16 - x1, 16 - y1]` |
| `south` | `[x1, 16 - y2, x2, 16 - y1]` |
| `west` | `[z1, 16 - y2, z2, 16 - y1]` |
| `east` | `[16 - z2, 16 - y2, 16 - z1, 16 - y1]` |

Bedrock uses the same per-face origin convention, which is why no per-face swap is applied on the normal path.
Faces with no `element.faces[name]` entry, or whose texture resolves to no placement, are silently skipped (no `uv`
key). `face.tintindex`, `face.cullface` and `element.shade` are ignored.

### The bone chain

```json
"bones": [
  { "name": "geysercmd",
    "binding": "c.item_slot == 'head' ? 'head' : q.item_slot_to_bone_name(c.item_slot)",
    "pivot": [0, 8, 0] },
  { "name": "geysercmd_x", "parent": "geysercmd",   "pivot": [0, 8, 0] },
  { "name": "geysercmd_y", "parent": "geysercmd_x", "pivot": [0, 8, 0] },
  { "name": "geysercmd_z", "parent": "geysercmd_y", "pivot": [0, 8, 0], "cubes": [ ... ] }
]
```

- `[0, 8, 0]` is the centre of a 0–16 item model after the X-mirror/Z−8 transform (X −8…8, Y 0…16, Z −8…8) — the
  pivot Java rotates an item about.
- `binding` attaches the rig to whichever bone the current item slot maps to (the head special case exists because
  `item_slot_to_bone_name('head')` is not the head bone). No `parent` on the root → it chains to the implicit root.
- The chain exists so a Java display transform decomposes into **one rotation per axis with a fixed application
  order**: the deepest bone rotates first, so `geysercmd_z` → `_y` → `_x` → root reproduces Java's X-then-Y-then-Z
  composition. All four share the same pivot so every axis rotation happens about the model centre.

### Description and bounds

- `format_version` is `"1.21.0"` when `usedUvRotation`, else `"1.16.0"`. `flip180AboutY` can introduce a
  `uv_rotation` on `up`/`down`; its return value is folded into `usedUvRotation` so the version is not understated.
- `visible_bounds_width = Math.max(4, Math.ceil((maxHorizontal * 2) / 16) + 1)`
- `visible_bounds_height = Math.max(4.5, Math.ceil((maxY - minY) / 16) + 1.5)`
- `visible_bounds_offset = [0, (minY + maxY) / 32, 0]`
- Accumulators start at `maxHorizontal = 16`, `minY = 0`, `maxY = 16`; `maxHorizontal` is the max |x| and |z| over
  origin and origin+size. The 4.5 floor is deliberate — large models pop out of view at screen edges if undersized.
- `options.textureSize` defaults to `[16, 16]`.
- No `material_instances` and no per-face material keys are emitted; the single atlas texture plus the attachable's
  `materials.default` (or the terrain texture for blocks) covers rendering.
- Empty `elements` yields a geometry with an empty cube list on `geysercmd_z` — **callers must check**, and
  `modelEngineInput` does.

### `flip180AboutY` — crossbow re-aim

Applied only when `options.flipFacing === true`; the only caller that sets it is `geometryStage` for host item
`minecraft:crossbow` (Bedrock's native first-person crossbow hold points the item bone opposite Java's, so a
converted crossbow renders string-outward). Mutates in place:

```
cx = (minX + maxX)/2 ,  cz = (minZ + maxZ)/2            // from pre-flip extents
origin   = [ 2*cx - (origin.x + size.x) , origin.y , 2*cz - (origin.z + size.z) ]
pivot    = [ 2*cx - pivot.x , pivot.y , 2*cz - pivot.z ]
rotation = [ rx === 0 ? 0 : -rx , ry === 0 ? 0 : wrapDegrees(ry + 180) , rz === 0 ? 0 : -rz ]
swap("north","south");  swap("east","west")
up/down: uv_rotation = wrapUvRotation((uv_rotation ?? 0) + 180); delete the key when it lands on 0
```

- Origin becomes the *far* corner, because after a 180° turn the far corner is the near one.
- The Y case (`ry + 180`) is load-bearing: reflecting a Y-splayed part's position alone leaves it angled the
  original way (crossbow limbs), so the model reads 180° off. `wrapDegrees` maps to `(−180, 180]`.
- Faces are **swapped, not mirrored**: Bedrock's per-face `uv` keys are world directions, so moving the mesh alone
  leaves the artwork on the original side. The XZ point-reflection is a rigid 180° turn for an axis-aligned box,
  hence a swap with no mirroring; up/down keep their pixels but need a half-turn `uv_rotation`. `swap` deletes keys
  that ended up `undefined`.
- Returns `true` iff it actually added a non-zero `uv_rotation` to any up/down face.
- `wrapUvRotation(deg) = ((deg % 360) + 360) % 360`; the doc comment says Bedrock accepts 0/90/180/270 only but the
  function does not enforce that.

Verified by `packages/core/test/geometryFlip.test.ts`: unflipped front bar `z = -8`, back bar `z = 6`; Java `+22.5°`
Y → Bedrock `[0, -22.5, 0]`, flipped → `[0, 157.5, 0]`.

### Callers

- `geometryStage` — id `geometry.geyser_custom.${name}`, `{ flipFacing, textureSize: resolved.textureSize }`, written
  to `models/entity/geyser_custom/<name>.geo.json` via `fitFilePath`; reports
  `approximated: "face UV rotation used — requires Bedrock 1.21+ client"` when `usedUvRotation`.
- `blocksStage` — id `geometry.geyser_custom.block_${name}`, no options, written to
  `models/blocks/geyser_custom/<name>.geo.json`, always reported `approximated` with "non-cube block model converted
  with item-style geometry math — verify orientation in-game". The extra bones are harmless for blocks.

---

## 2. `packages/core/src/bedrock/attachable.ts`

Emits Bedrock attachable definitions (`minecraft:attachable`, `format_version: "1.10.0"`) for held/worn custom items,
plus the two render controllers needed for animated (flipbook) and bow-pull textures.

```ts
export function buildItemAttachable(options: {
  identifier: string;
  material: string;
  texture: string;
  geometry: string;
  animations: Record<string, string>;
  extraTextures?: Record<string, string>;
  renderController?: string;
}): object

export function buildFlipbookRenderController(options: {
  id: string;
  frameShortnames: string[];
  fps: number;
}): object

export function buildBowPullRenderController(options: {
  id: string;
  frameShortnames: string[];
  stageThresholds: number[];
  geometryShortnames?: string[];
}): object

export function buildBowPullAttachable(options: {
  identifier: string;
  material: string;
  textures: Record<string, string>;
  geometries: Record<string, string>;
  animations: Record<string, string>;
  renderController: string;
  scale: number;
}): object
```

### `buildItemAttachable` — emitted structure

```json
{ "format_version": "1.10.0",
  "minecraft:attachable": { "description": {
    "identifier": "<identifier>",
    "materials": { "default": "<material>", "enchanted": "<material>" },
    "textures": { "default": "<texture>",
                  "enchanted": "textures/misc/enchanted_item_glint",
                  ...(extraTextures ?? {}) },
    "geometry": { "default": "<geometry>" },
    "scripts": {
      "pre_animation": [
        "v.main_hand = c.item_slot == 'main_hand';",
        "v.off_hand = c.item_slot == 'off_hand';",
        "v.head = c.item_slot == 'head';"
      ],
      "animate": [
        { "thirdperson_main_hand": "v.main_hand && !c.is_first_person" },
        { "thirdperson_off_hand":  "v.off_hand && !c.is_first_person" },
        { "firstperson_main_hand": "v.main_hand && c.is_first_person" },
        { "firstperson_off_hand":  "v.off_hand && c.is_first_person" },
        { "head": "v.head" }
      ]
    },
    "animations": "<animations>",
    "render_controllers": [ "<renderController ?? 'controller.render.item_default'>" ]
  } } }
```

- `material` is passed through verbatim from `ctx.options.attachableMaterial` — no validation. Both `default` and
  `enchanted` get the same material string; the glint is distinguished only by the `enchanted` **texture** shortname.
- **The five `animate` keys must exactly match the `animationKey`s emitted by `animations.ts`** or the animation
  silently never plays.
- `extraTextures` exists for flipbook frames; `geometryStage` passes `{ frame1: path, … }` with shortnames
  `frame1…frame{n-1}` (there is no `frame0` — frame 0 is `default`).
- The `texture` path is written **without extension**, e.g. `textures/geyser_custom/atlases/<name>`.
- `identifier` must equal the mapping's `bedrock_identifier`; the file name is derived separately by
  `attachablePath()` in `geometryStage`, because Bedrock locates the file by the id inside it.

### `buildFlipbookRenderController`

```json
{ "format_version": "1.10.0",
  "render_controllers": { "<id>": {
    "arrays": { "textures": { "Array.frames": ["Texture.<n>", …] } },
    "geometry": "Geometry.default",
    "materials": [ { "*": "Material.default" } ],
    "textures": [ "Array.frames[math.mod(math.floor(q.life_time * <fps>), <count>)]" ]
  } } }
```

`count = frameShortnames.length`; `fps` is interpolated raw (no `toFixed`). Bedrock attachables have no native
animated texture; `geometryStage` computes `fps = (timelineFrames * 20) / durationTicks` so a subsampled timeline
still plays at real-time speed, and only emits this controller when `timelineFrames > 1`.

### `buildBowPullRenderController`

Builds a nested ternary ladder, **outermost = highest threshold**, reproducing Java `range_dispatch`
("highest threshold ≤ value" wins). The loop runs `for (let i = 0; i < n; i++)` with `frameIndex = i + 1` (frame 0 =
standby), so after the loop the last-written (highest) threshold is outermost; the standby test wraps everything:

```
expr = "(v.charge_amount <= 0.0 ? 0 : (v.charge_amount >= t[n-1] ? n : (… (v.charge_amount >= t[0] ? 1 : 0) …)))"
```

Thresholds use `.toFixed(4)`; the standby literal is `0.0`. Textures: `Array.frames[<expr>]`. When
`geometryShortnames` is provided it also registers `arrays.geometries → Array.geos` and sets
`geometry = "Array.geos[<expr>]"`; otherwise `geometry` stays `"Geometry.default"`. `materials` is always
`[{ "*": "Material.default" }]`.

### `buildBowPullAttachable`

Same shape as `buildItemAttachable`, but `textures` is `{ ...textures, enchanted: "textures/misc/enchanted_item_glint" }`,
`geometry` is `{ ...geometries }` (multiple shortnames), `render_controllers` is the required `renderController`, and
`pre_animation` gains a fourth line:

```
v.charge_amount = q.main_hand_item_use_duration * <chargeMultiplier.toFixed(4)>;
```

with `const chargeMultiplier = 20 * options.scale;`. Bedrock's `query.main_hand_item_use_duration` is in **seconds**;
Java's `use_duration`-driven bow `range_dispatch` has `scale = 0.05` and its pre-scale value is in ticks, so
`seconds × (20 × scale)` reproduces Java's post-scale `[0,1]` value. `chargeMultiplier` is `1.0` for the vanilla bow
scale.

> Key-ordering difference: bow-pull `textures` are spread **before** `enchanted`, so a caller-supplied `enchanted`
> would be overwritten; `buildItemAttachable` has the literal `enchanted` first, so an `extraTextures.enchanted`
> would win there.

---

## 3. `packages/core/src/bedrock/animations.ts`

Turns a Java model's `display` transforms into static Bedrock attachable animations — one per item slot — driving the
same four-bone rig.

```ts
export interface BuiltAnimations {
  /** animations file content (animations/<name>.animation.json). */
  file: object;
  /** animation key → full animation identifier, for the attachable. */
  refs: Record<string, string>;
}

export function buildDisplayAnimations(
  name: string,
  display: Partial<Record<JavaDisplayContext, JavaDisplayTransform>>,
  options?: { headLift?: number },
): BuiltAnimations
```

Private: `type Vec3`, `interface SlotSpec { animationKey; javaContext; baseRotation?; basePosition; baseScale?;
valueScale; leftHand }`, `const SLOTS: SlotSpec[]`, `function fallbackContext(display, context)`.

### The per-slot table (verbatim constants)

| `animationKey` | `javaContext` | `baseRotation` | `basePosition` | `baseScale` | `valueScale` | `leftHand` |
| --- | --- | --- | --- | --- | --- | --- |
| `thirdperson_main_hand` | `thirdperson_righthand` | `[90, 0, 0]` | `[0, 13, -3]` | — | `1` | `false` |
| `thirdperson_off_hand` | `thirdperson_lefthand` | `[90, 0, 0]` | `[0, 13, -3]` | — | `1` | `true` |
| `firstperson_main_hand` | `firstperson_righthand` | `[90, 60, -40]` | `[0, 15, 2]` | `1.4` | `1` | `false` |
| `firstperson_off_hand` | `firstperson_lefthand` | `[180, 0, 180]` | `[-18.5, 18.3, 15]` | `1.2` | `1` | `true` |
| `head` | `head` | *(key absent)* | `[0, 19.9, 0]` | — | `0.625` | `false` |

- `basePosition`/`baseRotation`/`baseScale` are **Bedrock's own** hand/head placement for that slot (what turns the
  item-slot bone's frame into Java's item space).
- `valueScale` scales the *authored Java transform's* translation and scale: `1` for hands, `0.625` for `head`
  (head-slot display values are authored in skull space and shrink by the render scale).
- `firstperson_off_hand` deliberately gets its own base pose (not the main hand's) — it sits on the other side of the
  screen, facing the other way.
- `head` is the only slot with no `baseRotation` key (Bedrock's head bone already provides the orientation) and it
  accepts `options.headLift`.
- Animation id format: `` `animation.geyser_custom.${name}.${slot.animationKey}` `` — `name` here is the *file-safe*
  name produced by `fitPathName(safeName(modelId), ATLAS_TEXTURE_RESERVED)`, so the id and the file name always agree.

### Transform → animation

```ts
const java = display[slot.javaContext] ?? fallbackContext(display, slot.javaContext);
const rotation = java?.rotation ?? [0,0,0];
const translation = java?.translation ?? [0,0,0];
const scale = java?.scale ?? [1,1,1];
const vs = slot.valueScale;
const mirror = slot.leftHand ? -1 : 1;
const lift = slot.animationKey === "head" ? (options?.headLift ?? 0) : 0;
```

Emitted per animation:

```json
{ "loop": true,
  "bones": {
    "geysercmd":   { "position": [bx, by + lift, bz], "rotation": <baseRotation?>, "scale": <baseScale?> },
    "geysercmd_x": { "rotation": [-rotation[0], 0, 0],
                     "position": [-mirror * translation[0] * vs,
                                   translation[1] * vs,
                                   translation[2] * vs],
                     "scale": [scale[0]*vs, scale[1]*vs, scale[2]*vs]   // omitted when identity
                   },
    "geysercmd_y": { "rotation": [0, -mirror * rotation[1], 0] },
    "geysercmd_z": { "rotation": [0, 0,  mirror * rotation[2]] }
  } }
```

**Invariants, precisely:**

- Only the X bone gets a `position`; `_y`/`_z` carry rotation only. The root's rotation applies to everything below
  it, so folding the Java translation into the **root** position would apply it in Bedrock's hand frame instead of
  Java's item frame (a 90° axis swap for the third-person pose). Hence: base pose (including `basePosition`) on the
  root, Java transform on `_x`.
- Translation X: `-mirror * t[0] * vs` — the leading minus is Bedrock's mirror of Java's X, and `mirror` flips it back
  for the left hand. Y and Z pass through with `vs` only.
- Rotation: X is `-rotation[0]` on `_x` (no `mirror`, deliberately asymmetric), Y is `-mirror * rotation[1]` on `_y`,
  Z is `+mirror * rotation[2]` on `_z`. The `mirror` factor implements Java's `ItemTransform.apply` left-hand mirror:
  **negate X translation and the Y/Z rotations**. The authored `*_lefthand` values are pre-mirror, so feeding them
  through the right-hand formula puts the item on the wrong side facing the wrong way.
- Bone `scale` is emitted **only if** any of `scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1 || vs !== 1` — so a
  head-slot animation always carries a `0.625` X-bone scale even for an identity transform, and hand slots with
  identity scale emit no `scale` key.
- **All five animations are always emitted** (`loop: true`), one per `SLOTS` entry, regardless of whether the model
  defines that context — a missing context degrades to the identity transform, not to a missing animation.
- File wrapper: `{ format_version: "1.8.0", animations: { "<id>": <animation> } }`.

### `fallbackContext`

Java falls back left→right hand contexts when one is missing: `thirdperson_lefthand → thirdperson_righthand`,
`firstperson_lefthand → firstperson_righthand`, everything else `undefined`. The fallback is applied **after**
`mirror = -1`, so the left-hand slot mirrors a right-hand-authored transform exactly as Java's renderer does.

### `headLift`

`options.headLift` (geometryStage passes `12` for HMCCosmetics back cosmetics) is added only to the head slot's root Y
position. Units are geometry units (16 = one block); Bedrock renders armor-stand head items lower than Java and `+12`
≈ the observed gap. `geometryStage` emits an `approximated` line asking users to report over/under-shoot. Everything
outside the head slot ignores `headLift`.

---

## 4. `packages/core/src/bedrock/armor.ts`

Fixed templates for custom armor pieces (reusing the vanilla humanoid armor geometries + custom layer textures) and
elytra.

```ts
export type ArmorPiece = "helmet" | "chestplate" | "leggings" | "boots";

export const ARMOR_SLOTS: Record<ArmorPiece, string> = {
  helmet: "head",
  chestplate: "chest",
  leggings: "legs",
  boots: "feet",
};

export function buildArmorAttachable(options: { identifier: string; piece: ArmorPiece; texture: string }): object
export function buildElytraAttachable(options: { identifier: string; texture: string }): object
```

Private constants:

```ts
const LAYER_VISIBILITY: Record<ArmorPiece, string> = {
  helmet:     "variable.helmet_layer_visible = 0.0;",
  chestplate: "variable.chest_layer_visible = 0.0;",
  leggings:   "variable.leg_layer_visible = 0.0;",
  boots:      "variable.boot_layer_visible = 0.0;",
};

const ARMOR_GEOMETRY: Record<ArmorPiece, string> = {
  helmet:     "geometry.player.armor.helmet",
  chestplate: "geometry.player.armor.chestplate",
  leggings:   "geometry.player.armor.leggings",
  boots:      "geometry.player.armor.boots",
};
```

- `buildArmorAttachable`: `format_version: "1.20.60"` (1.20.60+ enables trim/glint support on attachables, matching
  vanilla armor attachables). `materials` = `{ default: "armor", enchanted: "armor_enchanted" }`;
  `textures` = `{ default: <texture>, enchanted: "textures/misc/enchanted_item_glint" }`;
  `geometry.default = ARMOR_GEOMETRY[piece]`; `scripts.parent_setup = LAYER_VISIBILITY[piece]` hides the player skin's
  own overlay layer under the piece; `render_controllers: ["controller.render.armor"]`. No `animations`.
- `buildElytraAttachable`: `format_version: "1.10.0"`; `materials` = `{ default: "elytra", enchanted: "elytra_glint" }`
  (note the glint **material** is `elytra_glint` but the glint **texture** is still the standard one);
  `geometry.default = "geometry.elytra"` (hardcoded); `render_controllers: ["controller.render.armor"]`; no `scripts` block.

---

## 5. `packages/core/src/bedrock/manifest.ts`

```ts
export function deterministicUuid(seed: string): string

export interface ManifestOptions {
  name: string;
  description: string;
  version?: [number, number, number];
  minEngineVersion?: [number, number, number];
}
export function buildManifest(options: ManifestOptions): object
```

`deterministicUuid`: `sha256(seed)` via `@noble/hashes/sha2`, take `hash.slice(0, 16)`, force UUID v4 shape
(`bytes[6] = (bytes[6]! & 0x0f) | 0x40`, `bytes[8] = (bytes[8]! & 0x3f) | 0x80`), lowercase hex, `8-4-4-4-12`.
**Deliberately not random**: re-converting the same pack name produces the same UUIDs, so Bedrock treats the result as
an **update** rather than a new pack.

```json
{ "format_version": 2,
  "header": { "name": …, "description": …,
              "uuid": deterministicUuid("header:" + name),
              "version": <version>, "min_engine_version": [1, 21, 0] },
  "modules": [ { "type": "resources",
                 "uuid": deterministicUuid("module:" + name),
                 "version": <version> } ] }
```

Two distinct seeds; `min_engine_version` defaults to `[1, 21, 0]`; header and module share the version tuple.

`timestampVersion()`:

```ts
const seconds = Math.floor(Date.now() / 1000);
return [1, Math.floor(seconds / 65536) % 65536, seconds % 65536];
```

Major pinned to `1`; the 32-bit seconds counter split across two 16-bit fields, so the version increases
monotonically in seconds until the high field wraps after ~136 years.

> **Resolution is seconds, not minutes, and that is intentional.** At minute resolution a convert→test→re-convert
> cycle inside one minute produced a version the client had already seen, so the client kept serving the cached pack
> and the change looked ignored. Bedrock caches packs by UUID+version; stable UUID + bumping version forces a
> re-download without users clearing the resource cache.

Consumed by `packagingStage` as `buildManifest({ name: ctx.options.packName, description })`.

---

## 6. `packages/core/src/resolve/modelResolver.ts`

Follows a Java item/block model's `parent` chain, merging textures/elements/display, resolving `#texture`
indirections, classifying the model, and inferring the vanilla host item.

```ts
export type ModelKind = "sprite" | "sprite_handheld" | "geometry" | "builtin_entity" | "unknown";

export interface ResolvedModel {
  id: string;
  kind: ModelKind;
  textures: Record<string, string>;
  elements: JavaElement[] | undefined;
  textureSize: [number, number] | undefined;
  display: Partial<Record<JavaDisplayContext, JavaDisplayTransform>>;
  terminalParent: string | undefined;
  chain: string[];
}

export function resolveModel(
  pack: JavaPack,
  id: string,
  cache?: Map<string, ResolvedModel | undefined>,
): ResolvedModel | undefined

export function resolveTextureRef(textures: Record<string, string>, ref: string): string | undefined
export function inferHostItemFromModel(
  pack: JavaPack,
  modelId: string,
  cache?: Map<string, string | undefined>,
): string | undefined
export function spriteLayers(resolved: ResolvedModel): string[]
```

Private: `modelAssetPath(id)`, `loadModel(pack, id)`, `resolveModelUncached(pack, id)`, `resolveTextureRefs(textures)`,
`inferHostItemImpl(pack, modelId)`, `hostItemFromModelId(id)`.

Asset path: `modelAssetPath(id)` → `` `assets/${loc.namespace}/models/${loc.path}.json` ``.

### Parent-chain algorithm

```
chain = [] ; models = [] ; terminalParent = undefined
current = id
for (depth = 0; current !== undefined && depth < 32; depth++):
    model = loadModel(pack, current)                       // pack JSON first
    if model === undefined:
        if NOT (isGeneratedParent(current) || isHandheldParent(current) || isBuiltinEntityParent(current)):
            model = lookupBuiltinModel(current)            // builtinModels.ts
            if model === undefined && isVanillaItemParent(current):
                model = { parent: "minecraft:item/generated" }        // synthesized stub
            if model !== undefined && model.textures === undefined && isVanillaItemParent(current):
                loc = parseResourceLocation(current)
                model = { ...model, textures: { layer0: `${loc.namespace}:${loc.path}` } }
        if model === undefined:
            terminalParent = current
            break
    chain.push(current) ; models.push(model) ; current = model.parent
if models.length === 0: return undefined
```

- **Depth cap 32.** A parent cycle (`a → b → a`) is **not detected as an error** — the loop simply runs 32 iterations,
  pushing duplicates, and returns a bogus-but-finite result with a 32-entry `chain` and `terminalParent === undefined`.
  Downstream code that iterates `chain` must tolerate repeats.
- **The generic-parent short-circuit** is what makes vanilla terminal markers stay terminal: they are never looked up
  in the builtin library and never synthesized, so they end the loop with `terminalParent` set, and are the sole source
  of `sprite`/`sprite_handheld`/`builtin_entity` classification.
- Everything else falls through to `lookupBuiltinModel`, which covers block families and the handheld item list.
- **Vanilla-item stub synthesis** handles any `minecraft:item/<name>` that is neither in the pack nor in
  `BUILTIN_MODELS`. It lets `inferHostItemFromModel` find the host item in the chain and gives non-handheld items the
  correct `sprite` classification. Handheld-family items must be in `BUILTIN_MODELS` precisely so they route to
  `item/handheld*` instead of this stub.
- **The `layer0` back-fill** is a separate bug fix: a model pointing straight at e.g. `minecraft:item/apple` used to
  resolve to zero layers (the stub has no textures) and was dropped. The stub now gets
  `textures: { layer0: "<ns>:<path>" }`. A child model's own `layer0` still wins in the merge.
- `terminalParent` is only assigned in the break; a chain that ends because `model.parent === undefined` leaves it
  `undefined`.

### Merging

- **Textures** — merged **child-first** (iterate `models` backwards with `Object.assign`), so the child wins per key.
  Then `resolveTextureRefs(textures)` resolves every value in place.
- **Elements** — the first model *in child→parent order* with `elements !== undefined` wins **wholesale** (no
  per-element merge). `textureSize` is taken from that same model.
  **Gotcha:** if the child defines `elements` but not `texture_size`, `textureSize` is `undefined` while the parent may
  have had one — `buildGeometry` then falls back to `[16,16]`.
- **Display** — same child-wins-per-context backward merge. This is a per-context `Object.assign`, so a child that
  defines `thirdperson_righthand` with only a `rotation` **fully replaces** the parent's `thirdperson_righthand` object
  (no field-level merge).

### Texture variable substitution (`#textures`)

- A non-`#` ref returns itself unchanged.
- A `#name` ref walks `textures[name]` while the value still starts with `#`, tracking a `Set<string>` of seen keys.
- Returns `undefined` on a **cycle** or a **missing key**.

`resolveTextureRefs` applies it in place; when a value resolves to `undefined`, the **original `#…` string is left in
the map**. Invariant: a `ResolvedModel.textures` value may still start with `#` for a broken model. Callers guard this
— `spriteLayers` skips `#`-prefixed layers, and `geometryStage`/`blocksStage` filter atlas placements.

### Classification (`kind`)

1. `elements !== undefined && elements.length > 0` → `"geometry"`.
2. else `terminalParent !== undefined`:
   - `isGeneratedParent` → `"sprite"`
   - `isHandheldParent` → `"sprite_handheld"` (`item/handheld`, `item/handheld_rod`, `item/handheld_mace`, with and
     without the `minecraft:` prefix)
   - `isBuiltinEntityParent` → `"builtin_entity"`
   - `isVanillaItemParent` → `"sprite"`
   - else → `"unknown"` (a vanilla block parent etc.)
3. else if `Object.keys(textures).length > 0` → `"sprite"`.
4. otherwise `"unknown"`.

This file does **not** read blockstates — it is purely model-level. Blockstate→model resolution happens upstream
(`itemsStage` / `blocksStage` supply `variant.model`), and the "vanilla block parent" hole is covered by
`BUILTIN_MODELS`, giving such models real `elements` and hence `"geometry"` via test 1.

### `inferHostItemFromModel`

- `hostItemFromModelId(id)`: `undefined` unless `isVanillaItemParent(id)`; otherwise `minecraft:<path after "item/">`.
- `inferHostItemImpl` order: the **model id itself first** (covers `special`-type `base` refs and direct vanilla model
  references whose file isn't in the pack), then `resolveModel`, then candidates
  `[resolved.terminalParent, ...resolved.chain.slice(1).reverse()]` — deepest non-requested ancestor first (`chain[0]`
  is the requested model and is deliberately skipped). First candidate that yields a host item wins.
- Both public entry points take an optional memo `Map` and cache **`undefined` as a value too** (they use `has` before
  `get`).

### `spriteLayers`

Walks `layer0`, `layer1`, … consecutively, **stopping at the first missing key** (so `layer0` + `layer2` yields only
`layer0`, deliberately), skipping any value that still starts with `#`. If nothing was collected, falls back to the
first non-`#` of `texture`, `all`, `particle` (that exact precedence).

---

## 7. `packages/core/src/modelengine/bbmodel.ts`

Types + parsing primitives for Blockbench `.bbmodel` files (ModelEngine / MythicMobs mob models).

```ts
export function isCube(el: BbElement): boolean

export interface BbExtractedTexture {
  index: number; name: string; bytes: Uint8Array;
  width: number; height: number; animated: boolean; frameTime: number;
}
export function extractTextures(model: BbModel): BbExtractedTexture[]
export function sanitizeTextureName(name: string): string
```

Key shapes: `BbModel { resolution?, elements?, outliner?, textures?, animations?, name? }`;
`BbElement { uuid, name?, type?, from?, to?, origin?, rotation?, inflate?, faces? }` (only `type: "cube"` is
convertible; meshes/locators skipped); `BbOutlinerNode = string | BbGroup`, where the string is an **element uuid**;
`BbGroup { uuid, name, origin?, rotation?, children? }`; `BbTexture { name?, width?, height?, source?, frame_time?,
animation? }` (source is a `data:image/png;base64,…` URI); `BbAnimation { name, loop?, length?, animators? }` with
animators keyed by **bone uuid**, each holding `BbKeyframe { channel, time, interpolation?, data_points? }`.

`.bbmodel` structure: `resolution` = UV authoring space (becomes Bedrock `texture_width`/`texture_height`);
`elements` = a **flat** cube list; `outliner` = the bone tree referencing elements **by uuid string**; `textures` =
embedded base64 images referenced from faces **by array index**.

- `isCube`: `(el.type ?? "cube") === "cube" && el.from !== undefined && el.to !== undefined`.
- `extractTextures`:
  - iterates `model.textures ?? []` with index `i`; skips entries whose `source` isn't a string;
  - strips a data-URI prefix only when `comma >= 0 && src.startsWith("data:")`;
  - `base64Decode` failure or `bytes.length === 0` → entry skipped entirely;
  - dimensions: `tex.width > 0 ? tex.width : (model.resolution?.width ?? 16)`, same for height;
  - **`animated` heuristic**: `tex.animation === true || height > width` (a texture taller than wide is a vertical
    flipbook strip); `frameTime = tex.frame_time ?? 1`; name = `sanitizeTextureName(tex.name ?? \`texture_${i}\`)`.
  - **The compacted-index invariant**: `index` preserves the position in the bbmodel's own `textures` array, but the
    returned list drops unusable entries, so the two must never be conflated. `modelEngineInput.ts` builds
    `byIndex = new Map(textures.map((t) => [t.index, t]))` and looks faces up through it.
- `sanitizeTextureName`: `name.replace(/\.png$/i, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")`,
  falling back to `"texture"` when empty (`"###"` would otherwise yield the empty string and a file literally called
  `.png`). The same regex body appears as `sanitize()` in `bbmodelAnimation.ts` (returns `undefined` instead of a
  fallback) and `sanitizeId()` in `modelEngineInput.ts` (fallback `"model"`).
- `base64Decode` is environment-agnostic (no `atob`/`Buffer`). `s = input.replace(/[^A-Za-z0-9+/]/g, "")` strips `=`
  padding and whitespace together, so the later `endsWith("=")` padding checks **never fire** — the decoded length can
  be up to 2 bytes long, carrying trailing zeros past the real image end. Benign in practice (the bbmodel's
  width/height are trusted and the PNG decoder reads its own IEND), but **do not assume `bytes.length` is exact**.

---

## 8. `packages/core/src/modelengine/bbmodelGeometry.ts` — Blueprint vs Bedrock

Converts a `.bbmodel` outliner/elements into a **Bedrock entity** `minecraft:geometry`, returning the auxiliary maps
the animation converter and `config.json` need.

```ts
export interface GeometryBuild {
  geometry: BedrockGeometry;
  boneNames: Map<string, string>;          // bbmodel group uuid → final bone name
  boneTextures: Map<string, Set<number>>;  // bone name → bbmodel texture indices
}
export function bbmodelToGeometry(model: BbModel, identifier: string): GeometryBuild
```

> **Name collision:** both this file and `bedrock/geometry.ts` export an interface named `GeometryBuild` with different
> shapes. Any module importing both must alias.

### Naming

- Blueprint side: bones come from `outliner` **groups** (`BbGroup.name`). Element names are never used for bone names —
  elements only supply cubes and `faces[].texture` indices.
- Bedrock side: names must match `[a-z0-9_]` and be unique. `uniqueBone(name, uuid, used)`:
  ```
  base = (name ?? "bone").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
         || `bone_${uuid.slice(0, 8)}`
  candidate = base ; for (i = 2; used.has(candidate); i++) candidate = `${base}_${i}` ; used.add(candidate)
  ```
  So `"Body Part"` → `body_part`, collisions get `_2`, `_3`, …, and an all-punctuation name falls back to
  `bone_<uuid's first 8 chars>`.
- A **loose root element** (a bare uuid string directly in `outliner`) has no group, so the walker wraps it in a bone
  literally named `"root"`, pivot `[0,0,0]`, created lazily and appended **at the end**. This hardcoded `"root"`
  **bypasses `uniqueBone`**, so it can collide with a group legitimately named `root` — in that case two bones share
  the name.

### Transform (Blueprint → Bedrock)

```
pivot (bone) = mirror(node.origin ?? [0,0,0]) = [ -x, y, z ]
cube.origin  = [ -to.x , from.y , from.z ]        // mirrored min-corner uses -to.x
cube.size    = [ to.x - from.x , to.y - from.y , to.z - from.z ]
cube.pivot   = mirror(el.origin ?? [0,0,0])
rotation     = [ -rx , -ry , rz ]                 // X and Y flip sign, Z unchanged
```

Blockbench model space is mirrored on X relative to Bedrock, so every X coordinate is negated and X/Y rotations flip
sign — the same transform item geometry uses, **minus the item-only `[8,·,8]` hand-centering offset** (entity models
are authored around the entity origin). This is the single most important difference from `bedrock/geometry.ts`:
no `8 -` and no `- 8`.

- `boneRotation` returns `undefined` when the euler is missing **or every component is exactly 0**, so no `rotation`
  key is emitted for an identity group.
- `elementToCube` emits `pivot` when `rot !== undefined || (el.origin !== undefined && el.rotation !== undefined)`.
- `inflate` is copied only when present and non-zero.
- `resW`/`resH` are accepted by `elementToCube` and then explicitly discarded (`void resW; void resH;`) — face UVs are
  already in the model's `resolution` space, which is published as `texture_width`/`texture_height`, so they map
  straight through.
- Face UV: `cube.uv[faceName] = { uv: [u1,v1], uv_size: [u2-u1, v2-v1] }` **only when `face.uv !== undefined`**;
  `BbFace.rotation` is **dropped** (no `uv_rotation` for entity geometry; format stays `1.16.0`).

### Walk order and bounds

```
walk(node: BbGroup, parentName):
  boneName = uniqueBone(node.name, node.uuid, usedNames) ; boneNames.set(node.uuid, boneName)
  pivot = mirror(node.origin ?? [0,0,0]) ; bone = { name: boneName, pivot }
  if (parentName !== undefined) bone.parent = parentName
  rot = boneRotation(node.rotation) ; if (rot) bone.rotation = rot
  for child of node.children ?? []:
     string → elementsById lookup ; if isCube(el): fold el.faces[].texture numbers into texSet,
              cube = elementToCube(el) ; if defined push and fold into minY/maxY/maxHoriz
     object → walk(child, boneName)
  if (cubes.length > 0) bone.cubes = cubes
  if (texSet.size > 0) boneTextures.set(boneName, texSet)
  bones.push(bone)                       // post-order; children already pushed
```

- `boneTextures` collects every `faces[].texture` numeric index on cubes directly under that bone (null/missing
  ignored). It becomes `binding_bones` in `config.json`.
- Bounds accumulators: `minY = 0`, `maxY = 0`, `maxHoriz = 4` (note: horizontal starts at 4, unlike item geometry's 16).
- `texture_width`/`texture_height` = `model.resolution.width/height` when `> 0`, else 16.
- `visible_bounds_width = Math.max(4, Math.ceil((maxHoriz * 2) / 16) + 1)`;
  `visible_bounds_height = Math.max(4, Math.ceil((maxY - minY) / 16) + 1)` (item version uses a `4.5` floor and `+1.5`);
  `visible_bounds_offset = [0, (minY + maxY) / 32, 0]`.
- `format_version` is hardcoded `"1.16.0"` — no 1.21 upgrade path, because no `uv_rotation` is ever emitted here.

**Gotchas:** non-cube elements (`mesh`, `locator`, `null`) are dropped silently; a group with zero convertible cubes
still becomes a bone (intentional, so animations have something to bind to); a model whose entire outliner is
empty/non-cube ends with `bones.length === 0`, which `modelEngineInput.ts` turns into a `"no convertible cubes/bones"`
failure.

---

## 9. `packages/core/src/modelengine/bbmodelAnimation.ts`

```ts
export interface BedrockAnimations {
  format_version: string;
  animations: Record<string, BedrockAnimation>;
}
export function bbmodelToAnimations(
  model: BbModel,
  modelId: string,
  boneNames: Map<string, string>,
): BedrockAnimations | undefined
```

Private: `BedrockAnimation { loop?, animation_length?, bones }`; `BedrockBoneChannels` (each channel a
`Record<string, [number,number,number]>`, i.e. **time-key string → vec3**); `keyframeValue(kf)`, `num(v)`,
`timeKey(t)`, `sanitize(name)`.

```
if ((model.animations ?? []).length === 0) return undefined
for anim of model.animations:
   bones = {}
   for [boneUuid, animator] of Object.entries(anim.animators ?? {}):
       boneName = boneNames.get(boneUuid) ?? sanitize(animator.name)
       if (boneName === undefined) continue
       channels = {}
       for kf of animator.keyframes ?? []:
           value = keyframeValue(kf) ; if undefined continue
           time = timeKey(kf.time)
           channels[kf.channel] ??= {} ; channels[kf.channel][time] = value
       if (channels.rotation || channels.position || channels.scale) bones[boneName] = channels
   if (Object.keys(bones).length === 0) continue
   base = `animation.${modelId}.${sanitize(anim.name) ?? "anim"}`
   name = base ; for (i = 2; name in animations; i++) name = `${base}_${i}`     // seen across the WHOLE file
   animations[name] = { loop: anim.loop === "loop" || anim.loop === true ? true : undefined,
                        animation_length: anim.length, bones }
if (Object.keys(animations).length === 0) return undefined
return { format_version: "1.8.0", animations }
```

- **Animation naming** mirrors the item path: `animation.<modelId>.<sanitized name>`, deduped **globally within the
  file**. `"attack.1"` and `"attack_1"` both sanitize to `attack_1` and the second would silently replace the first,
  losing an animation the MythicMobs config still references. The check is `name in animations`, so the suffix search
  sees earlier animations from the same file.
- **Bone binding** is uuid-first with `sanitize(animator.name)` as fallback. An animator matching neither is dropped.
  Consequence: the name fallback can produce a bone name that doesn't exist in the geometry, in which case Bedrock
  ignores that channel.
- **Only `data_points[0]` is used** — a keyframe with several data points contributes one value; no averaging or
  interpolation. **`interpolation` is never emitted** ("Keyframes become a time → value map (linear); catmullrom
  smoothing is not reproduced"), so all smoothing becomes Bedrock's default.
- **Time keys** are `String(t)` via `timeKey`, with a `"0.0"` fallback for non-finite times. Integer times therefore
  serialize as `"0"`, `"1"`, not `"0.0"`/`"1.0"`. Later keyframes at the same time overwrite earlier ones.
- **Value transforms** per channel: `rotation → [-x, -y, z]`, `position → [-x, y, z]`, `scale → [x, y, z]`. `num()`
  accepts a number or a numeric string (`Number.parseFloat`, non-finite → `0`), because Blockbench sometimes stores
  MoLang/string expressions; anything unparseable becomes `0` rather than being dropped.
- `loop` is emitted as `true` only for `"loop"`/`true`; `"once"`, `"hold"` and `false` produce `undefined`, which
  `JSON.stringify` omits.

Verified by `packages/core/test/modelengine.test.ts`.

---

## 10. `packages/core/src/modelengine/modelEngineInput.ts` — the emitted `input/` layout

```ts
export interface ModelEngineResult {
  /** Files keyed by path under `input/` (e.g. "input/drone/drone.geo.json"). */
  files: Map<string, Uint8Array>;
  models: { id: string; source: string; textures: number; animations: number }[];
  failed: { source: string; reason: string }[];
}
export function buildModelEngineInput(sources: VirtualFs | VirtualFs[]): ModelEngineResult
```

### Emitted layout

For each converted model with final id `modelId` (and `dir = \`input/${modelId}\``):

| path | content | condition |
| --- | --- | --- |
| `input/<modelId>/<modelId>.geo.json` | `JSON.stringify(geometry)` (no indent) | always |
| `input/<modelId>/<textureName>.png` | extracted image bytes | one per usable texture |
| `input/<modelId>/config.json` | `JSON.stringify(config, null, 2)` | always |
| `input/<modelId>/<modelId>.animation.json` | `JSON.stringify(animations)` (no indent) | only when `bbmodelToAnimations` returned a value |

- `<modelId>` = `uniqueId(sanitizeId(model.name ?? baseName(path)), usedIds)`: lowercase, non-`[a-z0-9_]` → `_`, trim
  leading/trailing `_`, fallback `"model"`, then `_2`/`_3`… on collision **across all scanned sources**. `baseName`
  strips directories and a case-insensitive trailing `.bbmodel`.
- Texture file names run through `uniqueId` with a **per-model** `usedTextureNames` Set — `"Body.png"` and `"body"`
  both sanitize to `body`, and one would silently overwrite the other, collapsing both into a single config entry.
- Geometry identifier is `` `geometry.${modelId}` ``; bails with `failed.push({ reason: "no convertible cubes/bones" })`
  when `geometry["minecraft:geometry"][0].bones.length === 0`, **before** writing anything.
- Unparseable JSON → `failed.push({ source: path, reason: "unparseable .bbmodel JSON" })`.
- Model list order follows `vfs.list({ suffix: ".bbmodel" })` per source, sources in the given order. Models are
  parsed with `parseLenientJson` (the pipeline deliberately tolerates non-strict JSON).

### Source scanning and dedup

A single VFS is normalized to an array, then `scanVfs` runs per source with two shared Sets: `usedIds` (model-id
uniqueness across sources) and `seenSourcePaths` (a path converted once even if it appears in several bundles).

Call site: `pipeline.ts` builds `meSources = [inputVfs, ...readZipDetailed(zip).vfs for each options.pluginConfigZips]`
(unreadable config zips are swallowed — "main-pack scan still runs"), then `writeZip(meVfs)` and reports
`modelengine_input.zip — unzip into extensions/geysermodelengineextension/input/ (needs the GeyserModelEngine extension
+ plugin)`. If `models.length === 0`, no zip is produced; `failed` entries are reported as `skipped` under the
`modelengine` stage.

### `config.json` shape

```ts
interface ModelConfig {
  per_texture_uv_size: Record<string, [number, number]>;           // always present
  anim_textures: Record<string, { fps: number; frames: number }>;   // always present (may be {})
  binding_bones?: Record<string, string[]>;                        // only when >1 texture
}
```

> The interface mirrors the extension's `ModelConfig` via its `@SerializedName` values, **snake_case**. GSON silently
> ignores keys it has no field for, so a wrong name doesn't fail — the option just never takes effect. A typo here is
> silent.

- `per_texture_uv_size[texName] = [resW, resH]` for **every** texture, using the *model* resolution (same `> 0` else
  16 rule). UVs are authored in resolution space, so the extension must not fall back to a 16×16 assumption on HD
  textures.
- `anim_textures[texName]` only for `tex.animated`:
  `frames = tex.width > 0 ? Math.max(1, Math.floor(tex.height / tex.width)) : 1`;
  `fps = 20 / Math.max(1, tex.frameTime)` (Blockbench `frame_time` is in ticks; the extension wants frames/second).
- `binding_bones` is emitted **only when `textures.length > 1`** (single-texture models default to "all bones").
  Built as `textureName → boneName[]` by walking `boneTextures` and mapping each index through
  `byIndex.get(idx)?.name`; indices with no surviving extracted texture are skipped. Indexing the compacted `textures`
  array directly "shifts every binding once one texture is skipped and the mob renders with swapped skins" — hence the
  `byIndex` Map keyed on `BbExtractedTexture.index`. An empty object means the key is not added at all.
- Top-level key order is always `per_texture_uv_size`, `anim_textures`, then optionally `binding_bones`.

`ModelEngineResult.models` entries: `{ id, source: path, textures: textures.length,
animations: Object.keys(animations.animations).length }` (0 when no animation file was produced). The pipeline prints
these as `<id>: <n> texture(s), <m> animation(s)`.

---

## 11. `packages/core/src/data/builtinModels.ts`

The fallback library of vanilla model parents a pack references without shipping them.

```ts
export const BUILTIN_MODELS: Record<string, JavaModel>
export function lookupBuiltinModel(id: string): JavaModel | undefined
```

`lookupBuiltinModel` normalizes with `id.includes(":") ? id : \`minecraft:${id}\``.

**Block family** (mirrors vanilla display transforms and cube/cross structure):

| key | parent | contents |
| --- | --- | --- |
| `minecraft:block/block` | — | `display` only: `gui {rotation:[30,225,0], translation:[0,0,0], scale:[0.625,0.625,0.625]}`, `ground {[0,0,0],[0,3,0],[0.25,0.25,0.25]}`, `fixed {[0,0,0],[0,0,0],[0.5,0.5,0.5]}`, `thirdperson_righthand {[75,45,0],[0,2.5,0],[0.375,0.375,0.375]}`, `firstperson_righthand {[0,45,0],[0,0,0],[0.4,0.4,0.4]}`, `firstperson_lefthand {[0,225,0],[0,0,0],[0.4,0.4,0.4]}` |
| `minecraft:block/cube` | `block/block` | one element `[0,0,0]→[16,16,16]`, six faces each `{ texture: "#<same name>", cullface: "<same name>" }` |
| `minecraft:block/cube_all` | `block/cube` | `particle/down/up/north/east/south/west` → `#all` |
| `minecraft:block/cube_column` | `block/cube` | `particle`, N/E/S/W → `#side`; `down`, `up` → `#end` |
| `minecraft:block/cube_bottom_top` | `block/cube` | `particle`, N/E/S/W → `#side`; `down → #bottom`; `up → #top` |
| `minecraft:block/orientable_with_bottom` | `block/cube` | `particle`, `north → #front`; `down → #bottom`; `up → #top`; E/S/W → `#side` |
| `minecraft:block/orientable` | `block/orientable_with_bottom` | `bottom: "#top"` |
| `minecraft:block/cross` | `block/block` | `textures: { particle: "#cross" }`; two elements: `[0.8,0,8]→[15.2,16,8]` with `rotation {origin:[8,8,8], axis:"y", angle:45, rescale:true}`, `shade:false`, faces `north`/`south` `uv [0,0,16,16]` → `#cross`; and `[8,0,0.8]→[8,16,15.2]` with `angle:-45`, faces `west`/`east` |
| `minecraft:block/tinted_cross` | `block/cross` | parent only |

**Vanilla item parents — only the handheld family is listed**, by design: all other vanilla items parent to
`item/generated`, which the resolver synthesizes, so they need no entry. These must be listed because they must route
to `item/handheld*` for `sprite_handheld` classification:

- `minecraft:item/handheld` → `diamond_sword`, `iron_sword`, `golden_sword`, `netherite_sword`, `stone_sword`,
  `wooden_sword`, all six `*_pickaxe`, all six `*_axe`, all six `*_shovel`, all six `*_hoe`, plus `stick`, `blaze_rod`,
  `bone`, `shears`, `flint_and_steel`, `brush` (32 entries).
- `minecraft:item/handheld_rod` → `fishing_rod`, `carrot_on_a_stick`, `warped_fungus_on_a_stick`.
- `minecraft:item/handheld_mace` → `minecraft:item/mace`.

Each item entry carries **only the `parent` field**. Consequences: the resolver's chain walk uses them purely to reach
the generic terminal parent for `kind`, and `inferHostItemFromModel` uses the specific vanilla name to infer the host
item for custom-namespace modern items. A vanilla item model found in the pack still wins (the chain loads pack JSON
first).

**Gotcha:** these item stubs have no `textures`, so a model that parents *only* to e.g. `minecraft:item/diamond_sword`
and defines no `layer0` gets the `layer0` back-fill — and that layer points at the *model* path
(`minecraft:item/diamond_sword`), not at a texture path.

---

## 12. Quick reference

**Bone names:** `geysercmd`, `geysercmd_x`, `geysercmd_y`, `geysercmd_z`, all with `pivot: [0, 8, 0]`; root `binding` is
`c.item_slot == 'head' ? 'head' : q.item_slot_to_bone_name(c.item_slot)`.

**Animation keys (must match attachable `animate` entries):** `thirdperson_main_hand`, `thirdperson_off_hand`,
`firstperson_main_hand`, `firstperson_off_hand`, `head`; ids `animation.geyser_custom.<name>.<key>`.

**Slot base constants:** `[90,0,0]/[0,13,-3]`, `[90,0,0]/[0,13,-3]`, `[90,60,-40]/[0,15,2]/1.4`,
`[180,0,180]/[-18.5,18.3,15]/1.2`, head `[0,19.9,0]` with `valueScale 0.625`; backpack head lift `12`.

**Format versions emitted:** item geometry `1.16.0`/`1.21.0`; entity geometry `1.16.0`; attachable `1.10.0`; armor
attachable `1.20.60`; elytra attachable `1.10.0`; display animations `1.8.0`; bbmodel animations `1.8.0`; render
controllers `1.10.0`; manifest `format_version: 2`, `min_engine_version [1,21,0]`.

**Render controller ids:** item default `controller.render.item_default`; armor `controller.render.armor`; flipbook
`controller.render.gc_<name>`; bow pull supplied by the caller (`controller.render.gc_bow_<name>` via `bowPullStage`).

**Output paths:** `models/entity/geyser_custom/<name>.geo.json`, `models/blocks/geyser_custom/<name>.geo.json`,
`animations/geyser_custom/<name>.animation.json`, `attachables/geyser_custom/<name>.json`,
`render_controllers/geyser_custom/<name>.render_controllers.json`, `textures/geyser_custom/atlases/<name>.png`
(frames `<name>_f<f>.png`), `textures/geyser_custom/blocks/<name>.png`.

**ModelEngine output paths:** `input/<modelId>/<modelId>.geo.json`, `input/<modelId>/<modelId>.animation.json`,
`input/<modelId>/<textureName>.png`, `input/<modelId>/config.json`, zipped as `modelengine_input.zip` for
`extensions/geysermodelengineextension/input/`.

**Public re-exports** from `packages/core/src/index.ts`: only `deterministicUuid`, `buildManifest`, `resolveTextureRef`,
`inferHostItemFromModel`, `buildBowPullRenderController`, `buildBowPullAttachable`. The rest are internal imports from
`convert/stages/*`.

**Tests covering this code:** `test/geometryFlip.test.ts` (flip math, Y rotation +180), `test/modelengine.test.ts`
(mirrored cube + UV passthrough, `binding_bones`, animation value signs).

**Known sharp edges:** (1) `resolveModel` has no cycle detection beyond the 32-iteration cap; (2) `resolveTextureRefs`
leaves unresolved `#refs` in place; (3) `buildGeometry`'s per-face divisor depends on whether `uv` was authored (16 vs
`texture_size`); (4) `base64Decode`'s padding detection is dead code, so decoded length can be up to 2 bytes long;
(5) `config.json` keys are snake_case and GSON silently ignores wrong names; (6) `bbmodelGeometry.ts` and
`bedrock/geometry.ts` both export `GeometryBuild`; (7) the loose-root bone name `"root"` bypasses `uniqueBone`;
(8) item geometry X uses `8 - to.x` while entity geometry X uses `-to.x`.
