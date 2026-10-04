// Micro-benchmark for the indexed PNG encode path, to separate the cost of the
// colour-counting/mapping loops from the deflate call they feed. Representative
// of what the geometry stage encodes: small RGBA atlases with a limited palette.
//
// Usage: node <tsx> scripts/bench-indexed.mts [width] [height] [pixels]
import { zlibSync } from "fflate";
import { createImage, encodeIndexedPng, type RgbaImage } from "../src/image/png.js";

const [wArg, hArg, nArg] = process.argv.slice(2);
const width = Number(wArg ?? 96);
const height = Number(hArg ?? 32);
const count = Number(nArg ?? 964);

/** Atlas-like image: `tiles` opaque colour blocks with a transparent margin. */
function makeAtlas(seed: number): RgbaImage {
  const img = createImage(width, height);
  const { data } = img;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x % 32 < 2 || y % 32 < 2) continue; // transparent gutter
      const band = (x / 32) | 0;
      const o = (y * width + x) * 4;
      data[o] = (seed * 13 + band * 40) % 256;
      data[o + 1] = (seed * 7 + y * 3) % 256;
      data[o + 2] = (seed * 29 + x * 5) % 256;
      data[o + 3] = 255;
    }
  }
  return img;
}

const images = Array.from({ length: count }, (_, i) => makeAtlas(i % 128));

// Warm up.
for (let i = 0; i < 50; i++) encodeIndexedPng(images[i % images.length]!);

let t0 = performance.now();
let bytes = 0;
for (const img of images) bytes += encodeIndexedPng(img)?.length ?? 0;
const total = performance.now() - t0;

// Isolate deflate: re-deflate the same raw byte volume at the same level.
const raw = new Uint8Array(Math.ceil((width + 1) * height));
t0 = performance.now();
let zbytes = 0;
for (let i = 0; i < count; i++) zbytes += zlibSync(raw, { level: 9 }).length;
const deflateOnly = performance.now() - t0;

console.log(`images: ${count}  ${width}x${height}`);
console.log(`encodeIndexedPng total : ${total.toFixed(0)}ms  (${(total / count * 1000).toFixed(0)}µs each, ${bytes} bytes)`);
console.log(`zlibSync(level 9) alone: ${deflateOnly.toFixed(0)}ms  (${(deflateOnly / count * 1000).toFixed(0)}µs each, ${zbytes} bytes)`);
console.log(`non-deflate remainder  : ${(total - deflateOnly).toFixed(0)}ms`);
