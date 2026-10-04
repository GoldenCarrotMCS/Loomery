// Aggregates a V8 .cpuprofile into self-time by function, so a hot path can be
// identified from data instead of guessed at. Used for the geometry-stage work.
//
// Usage: node scripts/analyze-profile.mjs <file.cpuprofile> [topN]
import fs from "node:fs";

const [file, topArg] = process.argv.slice(2);
const topN = Number(topArg ?? 25);
const profile = JSON.parse(fs.readFileSync(file, "utf8"));

const { nodes, samples, timeDeltas } = profile;
const byId = new Map(nodes.map((n) => [n.id, n]));

// Self time: attribute each sample's delta to the node that was on the stack.
const self = new Map();
for (let i = 0; i < samples.length; i++) {
  const id = samples[i];
  const dt = timeDeltas[i] ?? 0;
  self.set(id, (self.get(id) ?? 0) + dt);
}

// Roll self time up to a readable key: file basename + function name.
const rows = new Map();
for (const [id, us] of self) {
  const node = byId.get(id);
  if (node === undefined) continue;
  const cf = node.callFrame ?? {};
  const url = (cf.url ?? "").replace(/^.*[\\/]/, "");
  const key = `${cf.functionName || "(anonymous)"}  @ ${url || "?"}:${(cf.lineNumber ?? -1) + 1}`;
  rows.set(key, (rows.get(key) ?? 0) + us);
}

const total = [...rows.values()].reduce((a, b) => a + b, 0);
const sorted = [...rows.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
console.log(`total sampled: ${(total / 1000).toFixed(0)}ms\n`);
console.log("self time, hottest first:");
for (const [key, us] of sorted) {
  const pct = ((us / total) * 100).toFixed(1);
  console.log(`  ${(us / 1000).toFixed(0).padStart(6)}ms ${pct.padStart(5)}%  ${key}`);
}
