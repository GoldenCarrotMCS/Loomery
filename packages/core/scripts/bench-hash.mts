// Compares fastHash implementations over atlas-sized buffers. The shipped
// byte-wise two-lane version is the baseline; the word-wise variant would only
// be worth adopting if it is a genuine multiple faster while staying
// deterministic and collision-safe for dedup keys.
//
// Usage: node <tsx> scripts/bench-hash.mts [buffers] [width] [height]
import { fastHash } from "../src/util/hash.js";

const [nArg, wArg, hArg] = process.argv.slice(2);
const COUNT = Number(nArg ?? 2700);
const W = Number(wArg ?? 96);
const H = Number(hArg ?? 32);

/** Word-wise two-lane FNV-style mix over 32-bit words, then a tail pass. */
function fastHashWord(data: Uint8Array): string {
  const len = data.length;
  const words = len >>> 2;
  const view = new DataView(data.buffer, data.byteOffset, len);
  let h1 = 0x811c9dc5 ^ len;
  let h2 = 0xc2b2ae35 ^ len;
  for (let w = 0; w < words; w++) {
    const v = view.getUint32(w << 2, true);
    h1 = Math.imul(h1 ^ v, 0x01000193);
    h2 = Math.imul(h2 ^ v, 0x85ebca77);
  }
  for (let i = words << 2; i < len; i++) {
    const b = data[i]!;
    h1 = Math.imul(h1 ^ b, 0x01000193);
    h2 = Math.imul(h2 ^ b, 0x85ebca77);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** Single-lane 32-bit variant — fewer imuls per word, wider mixing. */
function fastHashWord1(data: Uint8Array): string {
  const len = data.length;
  const words = len >>> 2;
  const view = new DataView(data.buffer, data.byteOffset, len);
  let h = 0x811c9dc5 ^ len;
  for (let w = 0; w < words; w++) {
    h = Math.imul(h ^ view.getUint32(w << 2, true), 0x01000193);
  }
  for (let i = words << 2; i < len; i++) h = Math.imul(h ^ data[i]!, 0x01000193);
  return ((h >>> 0) >>> 0).toString(16).padStart(8, "0");
}

const buffers = Array.from({ length: COUNT }, (_, i) => {
  const b = new Uint8Array(W * H * 4);
  // xorshift per buffer, so each one is genuinely distinct data rather than a
  // periodic pattern that would (correctly) collapse to the same hash.
  let s = (i + 1) * 2654435761 >>> 0;
  for (let p = 0; p < b.length; p++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    b[p] = s & 0xff;
  }
  return b;
});

// Sanity: every implementation must be stable and separate distinct inputs.
const impls = [
  ["byte-wise 2-lane (shipped)", fastHash],
  ["word-wise 2-lane", fastHashWord],
  ["word-wise 1-lane", fastHashWord1],
] as const;

for (const [name, fn] of impls) {
  const first = fn(buffers[0]!);
  if (first !== fn(buffers[0]!)) throw new Error(`${name} is not deterministic`);
  const distinct = new Set(buffers.map((b) => fn(b))).size;
  if (distinct !== COUNT) throw new Error(`${name} collided: ${distinct}/${COUNT}`);
}

console.log(`buffers: ${COUNT}  ${W}x${H} (${(COUNT * W * H * 4 / 1024 / 1024).toFixed(0)} MiB total)\n`);
for (const [name, fn] of impls) {
  for (let i = 0; i < 100; i++) fn(buffers[i % buffers.length]!);
  const t0 = performance.now();
  let sink = 0;
  for (const b of buffers) sink += fn(b).length;
  const ms = performance.now() - t0;
  const mib = (COUNT * W * H * 4) / 1024 / 1024;
  console.log(
    `  ${name.padEnd(28)} ${ms.toFixed(0).padStart(5)}ms   ${(mib / (ms / 1000)).toFixed(0).padStart(5)} MiB/s   (sink ${sink})`,
  );
}
