import { describe, expect, it } from "vitest";
import { optionsFromHints } from "../src/convert/optionsFromHints.js";
import type { ConfigHints } from "../src/java/configShared.js";
import type { ConvertOptions } from "../src/convert/context.js";

function emptyHints(): ConfigHints {
  return {
    baseItems: {},
    displayNames: {},
    equippables: {},
    colors: {},
    cmdKeys: {},
    backpacks: [],
    furniture: [],
    furnitureTransforms: {},
    vanillaModelItems: [],
    files: 0,
    items: 0,
  };
}

describe("optionsFromHints", () => {
  it("carries every hint field the pipeline reads, not a subset", () => {
    // The API and the web worker both call this. When the two merged hints by
    // hand they drifted, and furnitureTransforms + pluginConfigZips were lost on
    // the API path — which silently disabled furniture scale correction and
    // ModelEngine blueprint scanning. Naming the fields here means dropping one
    // again is a test failure rather than a quiet behaviour change.
    const hints = emptyHints();
    hints.baseItems = { ruby_sword: "minecraft:diamond_sword" };
    hints.displayNames = { ruby_sword: "Ruby Sword" };
    hints.equippables = { ruby_boots: { asset: "akira", slot: "feet" } };
    hints.colors = { ruby_sword: 0xff0000 };
    hints.cmdKeys = { "minecraft:paper|10001": "ruby_sword" };
    hints.backpacks = ["travel_bag"];
    hints.furniture = ["bench"];
    hints.furnitureTransforms = { bench: { none: false, scale: 1.4, context: "fixed" } };
    hints.vanillaModelItems = [{ key: "golden_apple_item", baseItem: "minecraft:paper", itemModel: "minecraft:apple" }];

    const zip = new Uint8Array([1, 2, 3]);
    const options = optionsFromHints(hints, [zip]);

    expect(options.baseItemHints).toEqual(hints.baseItems);
    expect(options.displayNameHints).toEqual(hints.displayNames);
    expect(options.equippableHints).toEqual(hints.equippables);
    expect(options.colorHints).toEqual(hints.colors);
    expect(options.cmdItemKeys).toEqual(hints.cmdKeys);
    expect(options.backpackItems).toEqual(hints.backpacks);
    expect(options.furnitureItems).toEqual(hints.furniture);
    expect(options.furnitureTransforms).toEqual(hints.furnitureTransforms);
    expect(options.vanillaModelItems).toEqual(hints.vanillaModelItems);

    // Every field of HintOptions must appear above; adding one to the type
    // without asserting it here fails the typecheck on this object.
    const exhaustive: Record<keyof ReturnType<typeof optionsFromHints>, true> = {
      baseItemHints: true,
      displayNameHints: true,
      equippableHints: true,
      cmdItemKeys: true,
      vanillaModelItems: true,
      colorHints: true,
      backpackItems: true,
      furnitureItems: true,
      furnitureTransforms: true,
      configZipProvided: true,
      pluginConfigZips: true,
    };
    expect(Object.keys(exhaustive).sort()).toEqual(Object.keys(options).sort());
  });

  it("marks the config as provided, so the config-nudge banner does not fire", () => {
    const options = optionsFromHints(emptyHints(), [new Uint8Array([1])]);
    expect(options.configZipProvided).toBe(true);
  });

  it("copies the config zips instead of aliasing the caller's bytes", () => {
    // The zips are kept raw for the .bbmodel scan, and the web worker transfers
    // (neuters) its originals after this runs — an alias would hand the pipeline
    // an empty buffer and silently drop every ModelEngine blueprint.
    const original = new Uint8Array([1, 2, 3]);
    const options = optionsFromHints(emptyHints(), [original]);
    expect(options.pluginConfigZips).toHaveLength(1);
    expect(options.pluginConfigZips![0]).not.toBe(original);
    expect(Array.from(options.pluginConfigZips![0]!)).toEqual([1, 2, 3]);
    original.fill(0);
    expect(Array.from(options.pluginConfigZips![0]!)).toEqual([1, 2, 3]);
  });

  it("returns an empty zip list when there are no config zips", () => {
    const options = optionsFromHints(emptyHints(), []);
    expect(options.pluginConfigZips).toEqual([]);
  });

  it("produces fields that are assignable to ConvertOptions", () => {
    // Guards the consumer pattern (Object.assign into Partial<ConvertOptions>).
    const options: Partial<ConvertOptions> = { packName: "demo" };
    Object.assign(options, optionsFromHints(emptyHints(), []));
    expect(options.packName).toBe("demo");
    expect(options.configZipProvided).toBe(true);
  });
});
