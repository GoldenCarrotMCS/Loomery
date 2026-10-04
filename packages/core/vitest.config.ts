import { defineConfig } from "vitest/config";

/**
 * Vitest config for the conversion engine.
 *
 * Deliberately minimal. The suite previously ran on Vitest defaults (no config
 * file at all), and that is still the behaviour here — the only addition is the
 * coverage provider, so `pnpm test:coverage` produces a report without
 * affecting a normal `pnpm test` run.
 *
 * No thresholds are enforced: coverage is a map of what is untested, not a gate.
 * Several modules (image/zopfliPng, the wasm recompression path) are still
 * uncovered and failing CI over them would only encourage shallow tests.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        // Declaration-only shims and pure data tables: the tables are exercised
        // through the stages that read them, and their own files are thousands
        // of literal entries that would drown the report.
        "src/types/**",
        "src/data/**",
      ],
    },
  },
});
