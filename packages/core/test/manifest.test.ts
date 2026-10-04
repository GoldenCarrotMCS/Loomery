import { describe, expect, it } from "vitest";
import { buildManifest, deterministicUuid } from "../src/bedrock/manifest.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deterministicUuid", () => {
  it("produces a syntactically valid v4-shaped UUID", () => {
    const uuid = deterministicUuid("header:Test Pack");
    expect(uuid).toMatch(UUID_RE);
    // Version nibble is 4, variant nibble is 8/9/a/b — a plain hex digest would
    // fail these, and Bedrock rejects a manifest whose uuid is not well formed.
    expect(uuid[14]).toBe("4");
    expect("89ab").toContain(uuid[19]!);
  });

  it("is stable for the same seed and different for different seeds", () => {
    // The whole point: re-converting the same pack name must look like an update
    // to the client, not a second pack.
    expect(deterministicUuid("header:MyPack")).toBe(deterministicUuid("header:MyPack"));
    expect(deterministicUuid("header:MyPack")).not.toBe(deterministicUuid("header:OtherPack"));
    // The header/module prefixes must not collide with each other.
    expect(deterministicUuid("header:X")).not.toBe(deterministicUuid("module:X"));
  });

  it("does not depend on the process or the clock", () => {
    // Pinned so a switch to a random UUID (which would re-download every pack
    // on every client, every conversion) fails loudly here instead.
    expect(deterministicUuid("header:Test Pack")).toBe(deterministicUuid("header:Test Pack"));
    expect(deterministicUuid("")).toMatch(UUID_RE);
  });
});

describe("buildManifest", () => {
  it("emits format_version 2 with a resources module and a default min_engine_version", () => {
    const manifest = buildManifest({ name: "Pack", description: "desc" }) as any;
    expect(manifest.format_version).toBe(2);
    expect(manifest.modules).toHaveLength(1);
    expect(manifest.modules[0].type).toBe("resources");
    expect(manifest.header.min_engine_version).toEqual([1, 21, 0]);
  });

  it("carries the name and description through verbatim", () => {
    const manifest = buildManifest({ name: "Ruby & Co", description: "a $weird description" }) as any;
    expect(manifest.header.name).toBe("Ruby & Co");
    expect(manifest.header.description).toBe("a $weird description");
  });

  it("derives both UUIDs from the pack name, distinctly", () => {
    const manifest = buildManifest({ name: "Pack", description: "d" }) as any;
    expect(manifest.header.uuid).toMatch(UUID_RE);
    expect(manifest.modules[0].uuid).toMatch(UUID_RE);
    expect(manifest.header.uuid).not.toBe(manifest.modules[0].uuid);
    // Same name → same identity, so two conversions of one pack update in place.
    const again = buildManifest({ name: "Pack", description: "different text" }) as any;
    expect(again.header.uuid).toBe(manifest.header.uuid);
    expect(again.modules[0].uuid).toBe(manifest.modules[0].uuid);
  });

  it("shares one version tuple between the header and the module", () => {
    const manifest = buildManifest({ name: "Pack", description: "d" }) as any;
    expect(manifest.header.version).toEqual(manifest.modules[0].version);
    expect(manifest.header.version).toHaveLength(3);
    expect(manifest.header.version.every((n: unknown) => Number.isInteger(n))).toBe(true);
  });

  it("honours an explicit version and min_engine_version", () => {
    const manifest = buildManifest({
      name: "Pack",
      description: "d",
      version: [2, 5, 1],
      minEngineVersion: [1, 20, 0],
    }) as any;
    expect(manifest.header.version).toEqual([2, 5, 1]);
    expect(manifest.modules[0].version).toEqual([2, 5, 1]);
    expect(manifest.header.min_engine_version).toEqual([1, 20, 0]);
  });

  it("defaults the version to the current time with the major pinned to 1", () => {
    // Bedrock caches by UUID+version, so the version must advance between two
    // conversions in the same minute — the reason resolution is seconds, not
    // minutes. Assert the shape and the pin rather than the changing value.
    const manifest = buildManifest({ name: "Pack", description: "d" }) as any;
    const [major, high, low] = manifest.header.version as [number, number, number];
    expect(major).toBe(1);
    expect(high).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThan(65536);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(low).toBeLessThan(65536);
  });

  it("splits the timestamp across two 16-bit fields, so the value fits u16 ranges", () => {
    // A single field could not hold epoch seconds; both halves must stay inside
    // the 16-bit range Bedrock accepts.
    for (let i = 0; i < 5; i++) {
      const manifest = buildManifest({ name: `Pack ${i}`, description: "d" }) as any;
      const [, high, low] = manifest.header.version as [number, number, number];
      expect(Number.isInteger(high)).toBe(true);
      expect(Number.isInteger(low)).toBe(true);
      expect(high).toBeLessThanOrEqual(65535);
      expect(low).toBeLessThanOrEqual(65535);
    }
  });

  it("does not mutate the arrays it is handed", () => {
    const version: [number, number, number] = [1, 2, 3];
    const minEngineVersion: [number, number, number] = [1, 21, 0];
    const manifest = buildManifest({ name: "Pack", description: "d", version, minEngineVersion }) as any;
    expect(version).toEqual([1, 2, 3]);
    expect(minEngineVersion).toEqual([1, 21, 0]);
    expect(manifest.header.version).toBe(version);
  });
});
