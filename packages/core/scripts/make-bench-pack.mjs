// Builds a larger synthetic Java resource pack for performance measurement, so
// hot-path changes can be measured rather than guessed at. Complements
// make-fixture.mjs (small and feature-complete) by scaling up the paths a real
// pack actually spends its time in:
//   - 3D geometry conversion: one atlas stitch + alpha bleed + PNG encode per
//     timeline frame, which is the stage the pipeline comments call the hotspot
//   - legacy custom_model_data variant extraction
//
// Usage: node scripts/make-bench-pack.mjs <output.zip> [staticModels] [animModels] [framesPerStrip]
import { zipSync } from "fflate";
import { encode } from "fast-png";
import { writeFileSync } from "node:fs";

const enc = new TextEncoder();
const out = process.argv[2] ?? "bench-pack.zip";
const STATIC_MODELS = Number(process.argv[3] ?? 60);
const ANIM_MODELS = Number(process.argv[4] ?? 40);
const ANIM_FRAMES = Number(process.argv[5] ?? 16);
const STATIC_TEX_SIZE = 64;
const FRAME_SIZE = 32;

const rgb = (n, salt) => [
  (n * 37 + salt * 61) % 256,
  (n * 91 + salt * 29) % 256,
  (n * 53 + salt * 7) % 256,
  255,
];

function pngSolid(w, h, rgba) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return new Uint8Array(encode({ width: w, height: h, data, channels: 4 }));
}

/** Opaque centre with a transparent margin, so alphaBleed has real work to do. */
function pngMasked(w, h, rgba, inset = 2) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= inset && y >= inset && x < w - inset && y < h - inset) {
        data.set(rgba, (y * w + x) * 4);
      }
    }
  }
  return new Uint8Array(encode({ width: w, height: h, data, channels: 4 }));
}

/** Vertical flipbook strip: `frames` stacked tiles, each with a transparent margin. */
function pngStrip(w, h, frames, seed) {
  const data = new Uint8Array(w * h * 4);
  for (let f = 0; f < frames; f++) {
    const c = rgb(seed + f * 13, 5);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        if (x < 2 || y < 2 || x >= w - 2 || y >= w - 2) continue;
        data.set(c, ((f * w + y) * w + x) * 4);
      }
    }
  }
  return new Uint8Array(encode({ width: w, height: h, data, channels: 4 }));
}

const CUBE_FACES = ["north", "south", "east", "west", "up", "down"];

/** Two stacked cube elements whose faces cycle through three textures. */
function cubeElements() {
  return [0, 1].map((e) => ({
    from: [7 - e, e * 4, 7],
    to: [9 + e, e * 4 + 6, 9],
    faces: Object.fromEntries(
      CUBE_FACES.map((f, k) => [f, { uv: [0, 0, 16, 16], texture: `#t${(e + k) % 3}` }]),
    ),
  }));
}

const files = {};
files["pack.mcmeta"] = enc.encode(
  JSON.stringify({ pack: { pack_format: 34, description: "Loomery bench pack" } }),
);
files["pack.png"] = pngSolid(64, 64, [40, 200, 120, 255]);
files["assets/minecraft/textures/item/stick.png"] = pngSolid(16, 16, [160, 130, 90, 255]);

const overrides = [];

for (let i = 0; i < STATIC_MODELS; i++) {
  const texIds = [];
  for (let t = 0; t < 3; t++) {
    texIds.push(`bench:item/s${i}_${t}`);
    files[`assets/bench/textures/item/s${i}_${t}.png`] = pngMasked(
      STATIC_TEX_SIZE,
      STATIC_TEX_SIZE,
      rgb(i, t),
    );
  }
  files[`assets/bench/models/item/s${i}.json`] = enc.encode(
    JSON.stringify({ textures: { t0: texIds[0], t1: texIds[1], t2: texIds[2] }, elements: cubeElements() }),
  );
  overrides.push({ predicate: { custom_model_data: i + 1 }, model: `bench:item/s${i}` });
}

for (let i = 0; i < ANIM_MODELS; i++) {
  const texIds = [];
  for (let t = 0; t < 3; t++) {
    texIds.push(`bench:item/a${i}_${t}`);
    files[`assets/bench/textures/item/a${i}_${t}.png`] = pngStrip(
      FRAME_SIZE,
      FRAME_SIZE * ANIM_FRAMES,
      ANIM_FRAMES,
      i * 17 + t,
    );
    files[`assets/bench/textures/item/a${i}_${t}.png.mcmeta`] = enc.encode(
      JSON.stringify({ animation: { frametime: 2 } }),
    );
  }
  files[`assets/bench/models/item/a${i}.json`] = enc.encode(
    JSON.stringify({ textures: { t0: texIds[0], t1: texIds[1], t2: texIds[2] }, elements: cubeElements() }),
  );
  overrides.push({
    predicate: { custom_model_data: STATIC_MODELS + i + 1 },
    model: `bench:item/a${i}`,
  });
}

files["assets/minecraft/models/item/stick.json"] = enc.encode(
  JSON.stringify({
    parent: "minecraft:item/handheld",
    textures: { layer0: "minecraft:item/stick" },
    overrides,
  }),
);

writeFileSync(out, zipSync(files));
console.log(
  `wrote ${out}: ${STATIC_MODELS} static + ${ANIM_MODELS} animated 3D models ` +
    `(${ANIM_FRAMES} frames/strip) across ${Object.keys(files).length} files`,
);
