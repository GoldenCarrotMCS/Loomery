// Measures the two tuning decisions behind the indexed PNG encoder, so they can
// be made on data rather than taste:
//   1. deflate level — time AND output bytes for levels 4/6/9 over the actual
//      palette-index scanlines the encoder produces
//   2. fastHash — byte-wise two-lane vs word-wise, over atlas-sized buffers
//
// Usage: node <tsx> scripts/bench-png.mts [images] [width] [height]
import { zlibSync } from "fflate";
import { fastHash } from "../src/util/hash.js";

const [nArg, wArg, hArg] = process.argv.slice(2);
const COUNT = Number(nArg ?? 964);
const W = Number(wArg ?? 96);
const H = Number(hArg ?? 32);

/** Pixel-art atlas: 32x32 tiles of a few flat colours with a transparent gutter. */
function makeAtlas(seed: number): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lx = x % 32;
      const ly = y % 32;
      if (lx < 2 || ly < 2 || lx > 29 || ly > 29) continue; // gutter stays transparent
      const band = (x / 32) | 0;
      const shade = ((lx / 8) | 0) + ((ly / 8) | 0); // a handful of flats per tile
      const o = (y * W + x) * 4;
      rgba[o] = (seed * 13 + band * 40 + shade * 8) & 0xff;
      rgba[o + 1] = (seed * 7 + band * 24 + shade * 6) & 0xff;
      rgba[o + 2] = (seed * 29 + band * 55 + shade * 4) & 0xff;
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

const keyOf = (d: Uint8Array, o: number): number =>
  ((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0;

/** The exact scanline layout encodeIndexedPng feeds to zlibSync (depth 8). */
function toRawIndexed(rgba: Uint8Array): Uint8Array {
  const palette: number[] = [];
  const indexOf = new Map<number, number>();
  for (let o = 0; o < rgba.length; o += 4) {
    const k = keyOf(rgba, o);
    if (!indexOf.has(k)) {
      indexOf.set(k, palette.length);
      palette.push(k);
    }
  }
  const raw = new Uint8Array((W + 1) * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      raw[y * (W + 1) + 1 + x] = indexOf.get(keyOf(rgba, (y * W + x) * 4))!;
    }
  }
  return raw;
}

const images = Array.from({ length: COUNT }, (_, i) => makeAtlas(i % 128));
const raws = images.map(toRawIndexed);
const colours = images.map((img) => {
  const s = new Set<number>();
  for (let o = 0; o < img.length; o += 4) s.add(keyOf(img, o));
  return s.size;
});
console.log(
  `images: ${COUNT}  ${W}x${H}  distinct colours: min ${Math.min(...colours)} / max ${Math.max(...colours)}`,
);

console.log("\n--- deflate level (same input, identical pixels) ---");
const baseline = (() => {
  let bytes = 0;
  for (const raw of raws) bytes += zlibSync(raw, { level: 9 }).length;
  return bytes;
})();
for (const level of [4, 6, 9] as const) {
  // Warm up, then measure.
  for (let i = 0; i < 50; i++) zlibSync(raws[i % raws.length]!, { level });
  const t0 = performance.now();
  let bytes = 0;
  for (const raw of raws) bytes += zlibSync(raw, { level }).length;
  const ms = performance.now() - t0;
  const delta = (((bytes - baseline) / baseline) * 100).toFixed(2);
  console.log(
    `  level ${level}: ${ms.toFixed(0).padStart(4)}ms   ${(bytes / 1024).toFixed(1).padStart(7)}KiB total` +
      `   ${delta === "0.00" ? "baseline" : `+${delta}% vs level 9`}`,
  );
}

console.log("\n--- fastHash over atlas pixel data ---");
for (let i = 0; i < 50; i++) fastHash(images[i % images.length]!);
let t0 = performance.now();
let sink = 0;
for (const img of images) sink += fastHash(img).length;
console.log(`  byte-wise 2-lane: ${(performance.now() - t0).toFixed(0)}ms  (sink ${sink})`);
