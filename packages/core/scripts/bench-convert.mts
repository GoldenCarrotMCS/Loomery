// Times N conversions of a pack in-process AND fingerprints the output, so a
// hot-path change can be shown to be "same bytes, less time" rather than
// assumed.
//
// A raw hash of the .mcpack is useless for that comparison: fflate stamps every
// zip entry with the current time, and manifest.json carries a clock-derived
// version (deliberately — it forces Bedrock clients to re-download a
// re-converted pack). So the fingerprint below covers the CONTENT of each entry
// with those volatile paths excluded.
//
// Usage: node <tsx> scripts/bench-convert.mts <pack.zip> [iterations]
import fs from "node:fs";
import { createHash } from "node:crypto";
import { convertPack, readZipDetailed } from "../src/index.js";

const [input, iterationsArg] = process.argv.slice(2);
if (!input) {
  console.error("usage: bench-convert.mts <pack.zip> [iterations]");
  process.exit(1);
}
const iterations = Number(iterationsArg ?? 3);
const bytes = new Uint8Array(fs.readFileSync(input));

/** Entries whose content is derived from the wall clock on every run. */
const VOLATILE = new Set(["manifest.json"]);

function contentDigest(mcpack: Uint8Array): { digest: string; perPath: Map<string, string> } {
  const { vfs } = readZipDetailed(mcpack);
  const perPath = new Map<string, string>();
  for (const [path, data] of vfs.entries()) {
    perPath.set(path, createHash("sha256").update(data).digest("hex").slice(0, 12));
  }
  const lines = [...perPath.entries()]
    .filter(([p]) => !VOLATILE.has(p))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([p, h]) => `${p} ${h}`)
    .join("\n");
  return { digest: createHash("sha256").update(lines).digest("hex").slice(0, 16), perPath };
}

// Warm up once so JIT and wasm init are not billed to the measured runs.
let last = await convertPack(bytes, { packName: "bench" });

const times: number[] = [];
const digests: string[] = [];
for (let i = 0; i < iterations; i++) {
  const t0 = performance.now();
  last = await convertPack(bytes, { packName: "bench" });
  times.push(performance.now() - t0);
  digests.push(contentDigest(last.mcpack).digest);
}

const sorted = [...times].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)]!;
const unique = new Set(digests);
console.log(`iterations: ${iterations}`);
console.log(`median: ${median.toFixed(0)}ms   best: ${sorted[0]!.toFixed(0)}ms   all: ${times.map((t) => t.toFixed(0)).join(", ")}`);
console.log(`mcpack bytes: ${last.mcpack.length}`);
console.log(`content digest (non-volatile entries): ${digests[digests.length - 1]}`);
if (unique.size > 1) {
  // Two runs of the SAME code disagreeing means something else is
  // nondeterministic beyond the excluded paths — worth knowing before any
  // comparison is trusted.
  console.log(`  WARNING: digest is not stable across runs (${unique.size} distinct): ${[...unique].join(", ")}`);
}

console.log("\nstages:");
for (const s of [...last.timings.stages].sort((a, b) => b.ms - a.ms).slice(0, 8)) {
  if (s.ms > 0) console.log(`  ${s.name.padEnd(20)} ${String(s.ms).padStart(5)}ms`);
}
console.log("ops:");
for (const o of last.timings.ops.slice(0, 10)) {
  console.log(`  ${o.category.padEnd(20)} ${String(o.totalMs).padStart(5)}ms  (${o.count}×)`);
}
