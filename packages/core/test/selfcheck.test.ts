import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertPack } from "../src/convert/pipeline.js";
import { readZip, readZipDetailed } from "../src/io/zip.js";

/**
 * Structural end-to-end check.
 *
 * The other suites assert per-asset behaviour; this one fails when the *pack as
 * a whole* is structurally wrong — a broken manifest, an atlas entry pointing at
 * a texture that was never written, unparseable generated JSON, an attachable
 * referencing a geometry that does not exist. Those are the failures users
 * report as "it installed but nothing shows", and none of them were caught
 * before this file existed.
 *
 * It runs the real `make-fixture.mjs` builder, so the fixture stays the single
 * source of a feature-complete sample pack (2D legacy items, a 3D item, a modern
 * item definition, an animated block, sounds, lang).
 */
function buildFixture(): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "loomery-selfcheck-"));
  try {
    const out = join(dir, "fixture-pack.zip");
    const script = fileURLToPath(new URL("../scripts/make-fixture.mjs", import.meta.url));
    execFileSync(process.execPath, [script, out], { stdio: "pipe" });
    return new Uint8Array(readFileSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generated pack structure", () => {
  it("converts the feature-complete fixture into a structurally valid Bedrock pack", async () => {
    const result = await convertPack(buildFixture(), { packName: "Selfcheck" });
    const { vfs: out, failed } = readZipDetailed(result.mcpack);
    const paths = out.list();

    // 1. Every entry in the archive is readable.
    expect(failed).toEqual([]);
    expect(paths.length).toBeGreaterThan(0);

    // 2. The manifest is present, parses, and carries the Bedrock header shape.
    const manifestText = out.readText("manifest.json");
    expect(manifestText).toBeDefined();
    const manifest = JSON.parse(manifestText!) as any;
    expect(manifest.format_version).toBe(2);
    expect(typeof manifest.header.name).toBe("string");
    expect(manifest.header.name.length).toBeGreaterThan(0);
    expect(typeof manifest.header.description).toBe("string");
    expect(manifest.header.uuid).toMatch(UUID_RE);
    expect(Array.isArray(manifest.modules)).toBe(true);
    expect(manifest.modules.length).toBeGreaterThan(0);
    // Header and module must not share a uuid — Bedrock rejects such a pack.
    expect(manifest.modules[0].uuid).not.toBe(manifest.header.uuid);
    expect(manifest.modules[0].uuid).toMatch(UUID_RE);
    expect(Array.isArray(manifest.header.version)).toBe(true);
    expect(Array.isArray(manifest.header.min_engine_version)).toBe(true);
    expect(out.has("pack_icon.png")).toBe(true);

    // 3. No generated JSON is malformed — a bad file is one the client ignores
    //    a piece of, with no error surfaced anywhere.
    for (const path of paths.filter((p) => p.endsWith(".json"))) {
      expect(() => JSON.parse(out.readText(path)!), `${path} is not valid JSON`).not.toThrow();
    }

    // 4. Every texture an atlas references exists in the pack (except vanilla
    //    built-in paths, which intentionally live outside it).
    for (const atlasPath of ["textures/item_texture.json", "textures/terrain_texture.json"]) {
      const text = out.readText(atlasPath);
      if (text === undefined) continue;
      const atlas = JSON.parse(text) as { texture_data?: Record<string, { textures?: string }> };
      for (const [key, entry] of Object.entries(atlas.texture_data ?? {})) {
        expect(typeof entry.textures, `${atlasPath} entry "${key}" has no texture path`).toBe("string");
        if (entry.textures!.startsWith("textures/")) {
          expect(out.has(`${entry.textures}.png`), `${atlasPath} "${key}" → missing ${entry.textures}.png`).toBe(true);
        }
      }
    }

    // 5. Attachables reference geometries that were actually emitted. Bedrock
    //    locates both by scanning and reading the id inside, so a wrong id is
    //    silently inert rather than an error.
    const geometryIds = new Set<string>();
    for (const path of paths.filter((p) => p.startsWith("models/") && p.endsWith(".geo.json"))) {
      const doc = JSON.parse(out.readText(path)!) as any;
      for (const g of doc["minecraft:geometry"] ?? []) {
        if (typeof g?.description?.identifier === "string") geometryIds.add(g.description.identifier);
      }
    }
    const attachables = paths.filter((p) => p.startsWith("attachables/") && p.endsWith(".json"));
    expect(attachables.length).toBeGreaterThan(0);
    for (const path of attachables) {
      const doc = JSON.parse(out.readText(path)!) as any;
      const desc = doc["minecraft:attachable"]?.description;
      expect(typeof desc?.identifier, `${path} has no identifier`).toBe("string");
      expect(desc.identifier).toContain(":");
      for (const geometry of Object.values((desc?.geometry ?? {}) as Record<string, string>)) {
        if (geometry.startsWith("geometry.geyser_custom.")) {
          expect(geometryIds.has(geometry), `${path} references unknown ${geometry}`).toBe(true);
        }
      }
    }

    // 6. The conversion itself reported no internal errors.
    expect(result.report.entries.filter((e) => e.status === "error")).toEqual([]);

    // 7. The fixture exercises the 2D, 3D, modern-definition and flipbook paths,
    //    so a healthy run must produce mappings, geometry and a flipbook file.
    expect(result.geyserMappings).toBeDefined();
    expect(geometryIds.size).toBeGreaterThan(0);
    expect(out.has("textures/flipbook_textures.json")).toBe(true);
  }, 120_000);

  it("produces a deterministic manifest identity for the same pack name", async () => {
    // Bedrock keys installed packs by uuid, so two conversions of one pack must
    // agree — otherwise every re-conversion installs a duplicate.
    const fixture = buildFixture();
    const first = await convertPack(fixture, { packName: "Deterministic" });
    const second = await convertPack(fixture, { packName: "Deterministic" });
    const uuidOf = (bytes: Uint8Array): string => {
      const { vfs } = readZipDetailed(bytes);
      return (JSON.parse(vfs.readText("manifest.json")!) as any).header.uuid;
    };
    expect(uuidOf(first.mcpack)).toBe(uuidOf(second.mcpack));
    expect(uuidOf(first.mcpack)).toMatch(UUID_RE);
  }, 120_000);

  it("emits a pack the reader can open even when optimization is off", async () => {
    // optimizePack: false skips the dead-file sweep and the rewrite pass, so a
    // file that only exists because the sweep removed a duplicate would show up
    // here as an unreferenced or missing entry.
    const result = await convertPack(buildFixture(), { packName: "Unoptimized", optimizePack: false });
    const out = readZip(result.mcpack);
    expect(out.has("manifest.json")).toBe(true);
    expect(JSON.parse(out.readText("manifest.json")!).format_version).toBe(2);
    for (const path of out.list().filter((p) => p.endsWith(".json"))) {
      expect(() => JSON.parse(out.readText(path)!), `${path} is not valid JSON`).not.toThrow();
    }
  }, 120_000);
});
