import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { encode } from "fast-png";
import { convertPack, parseOraxenConfigZips, readZip } from "../src/index.js";

/**
 * Plugin items that borrow a vanilla item's look. CraftEngine (and others) put
 * a custom item on a cheap material and point `item_model` — or the pack's own
 * definition — at a vanilla model, so Java renders an apple without the pack
 * shipping one. Bedrock got nothing for these and showed the material (paper).
 */
function zip(files: Record<string, Uint8Array | string>): Uint8Array {
  const tree: Record<string, Uint8Array> = {};
  for (const [p, c] of Object.entries(files)) tree[p] = typeof c === "string" ? new TextEncoder().encode(c) : c;
  return zipSync(tree);
}
const png = () => new Uint8Array(encode({ width: 16, height: 16, data: new Uint8Array(1024).fill(90), channels: 4 }));
const mcmeta = JSON.stringify({ pack: { pack_format: 46 } });

type Mapping = { type: string; model?: string; custom_model_data?: number; bedrock_options: { icon: string } };
function mappings(result: Awaited<ReturnType<typeof convertPack>>): Record<string, Mapping[]> {
  return JSON.parse(result.geyserMappings ?? '{"items":{}}').items;
}
function atlas(result: Awaited<ReturnType<typeof convertPack>>): Record<string, { textures: string }> {
  return JSON.parse(readZip(result.mcpack).readText("textures/item_texture.json")!).texture_data;
}

describe("plugin items wearing vanilla item models", () => {
  it("maps a pack definition that points at a vanilla model, using Bedrock's own texture", async () => {
    const result = await convertPack(zip({
      "pack.mcmeta": mcmeta,
      "assets/myitems/items/golden_snack.json": JSON.stringify({ model: { type: "minecraft:model", model: "minecraft:item/apple" } }),
    }));
    const entry = Object.values(mappings(result)).flat().find((m) => m.model === "myitems:golden_snack");
    expect(entry).toBeDefined();
    expect(atlas(result)[entry!.bedrock_options.icon]).toEqual({ textures: "textures/items/apple" });
  });

  it("maps a legacy override to a vanilla model, renaming to Bedrock's texture name", async () => {
    const result = await convertPack(zip({
      "pack.mcmeta": mcmeta,
      "assets/minecraft/models/item/paper.json": JSON.stringify({
        parent: "minecraft:item/generated",
        textures: { layer0: "minecraft:item/paper" },
        overrides: [{ predicate: { custom_model_data: 7 }, model: "minecraft:item/golden_carrot" }],
      }),
    }));
    const entry = mappings(result)["minecraft:paper"]!.find((m) => m.custom_model_data === 7)!;
    // Java golden_carrot is carrot_golden on Bedrock.
    expect(atlas(result)[entry.bedrock_options.icon]).toEqual({ textures: "textures/items/carrot_golden" });
  });

  it("still composites from the pack when the pack does ship the vanilla texture", async () => {
    const result = await convertPack(zip({
      "pack.mcmeta": mcmeta,
      "assets/myitems/items/golden_snack.json": JSON.stringify({ model: { type: "minecraft:model", model: "minecraft:item/apple" } }),
      "assets/minecraft/textures/item/apple.png": png(),
    }));
    const entry = Object.values(mappings(result)).flat().find((m) => m.model === "myitems:golden_snack")!;
    expect(atlas(result)[entry.bedrock_options.icon]!.textures).toMatch(/^textures\/geyser_custom\//);
  });

  it("maps a CraftEngine item whose item_model is a vanilla id, under its material", async () => {
    const hints = parseOraxenConfigZips([zip({
      "resources/demo/configuration/items.yml": `
items:
  demo:golden_snack:
    material: paper
    item_model: minecraft:apple
    data:
      item_name: "Golden Snack"
  demo:plain_paper:
    material: paper
    item_model: minecraft:paper
`,
    })]);
    // Pointing item_model at the material itself is just the vanilla item.
    expect(hints.vanillaModelItems).toEqual([
      { key: "golden_snack", baseItem: "minecraft:paper", itemModel: "minecraft:apple" },
    ]);

    const result = await convertPack(zip({ "pack.mcmeta": mcmeta }), {
      vanillaModelItems: hints.vanillaModelItems,
      displayNameHints: hints.displayNames,
      configZipProvided: true,
    });
    const entry = mappings(result)["minecraft:paper"]!.find((m) => m.model === "minecraft:apple")!;
    expect(entry.type).toBe("definition");
    expect(atlas(result)[entry.bedrock_options.icon]).toEqual({ textures: "textures/items/apple" });
  });

  it("reuses the pack's override of that vanilla definition, re-hosted on the material", async () => {
    const result = await convertPack(zip({
      "pack.mcmeta": mcmeta,
      "assets/minecraft/items/apple.json": JSON.stringify({ model: { type: "minecraft:model", model: "myitems:item/fancy_apple" } }),
      "assets/myitems/models/item/fancy_apple.json": JSON.stringify({ parent: "minecraft:item/generated", textures: { layer0: "myitems:item/fancy_apple" } }),
      "assets/myitems/textures/item/fancy_apple.png": png(),
    }), {
      vanillaModelItems: [{ key: "golden_snack", baseItem: "minecraft:paper", itemModel: "minecraft:apple" }],
    });
    const onPaper = mappings(result)["minecraft:paper"]!.find((m) => m.model === "minecraft:apple")!;
    expect(atlas(result)[onPaper.bedrock_options.icon]!.textures).toBe("textures/geyser_custom/myitems_item_fancy_apple");
  });
});
