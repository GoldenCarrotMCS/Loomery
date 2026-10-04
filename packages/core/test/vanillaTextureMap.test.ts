import { describe, expect, it } from "vitest";
import { BLOCK_RENAMES, ITEM_RENAMES, remapVanillaTexture } from "../src/data/vanillaTextureMap.js";

/**
 * The rename tables are load-bearing for every vanilla retexture in a pack: a
 * missing entry ships the texture under its Java name (Bedrock never loads it),
 * and a wrong entry ships it under a name Bedrock also never loads. Neither is
 * visible in the report beyond an "approximated" line, so the tables get their
 * own coverage.
 *
 * Entries below were ported from GeyserMC/PackConverter's mappings/textures.json
 * (MIT); this locks in that they landed.
 */
describe("vanilla texture rename tables", () => {
  it("maps blocks whose Bedrock name differs from the Java name", () => {
    const cases: [string, string][] = [
      ["oak_log", "log_oak"],
      ["grass_block_top", "grass_top"],
      ["amethyst_block", "amethyst_block"],
      ["acacia_trapdoor", "acacia_trapdoor"],
      ["bamboo_large_leaves", "bamboo_leaf"],
      ["bamboo_stage0", "bamboo_sapling"],
    ];
    for (const [java, bedrock] of cases) {
      expect(BLOCK_RENAMES[java], java).toBe(bedrock);
    }
  });

  it("maps items whose Bedrock name differs from the Java name", () => {
    const cases: [string, string][] = [
      ["apple", "apple"],
      ["armor_stand", "armor_stand"],
      ["bow_pulling_0", "bow_pulling_0"],
    ];
    for (const [java, bedrock] of cases) {
      expect(ITEM_RENAMES[java], java).toBe(bedrock);
    }
  });

  /**
   * Three values were wrong before the PackConverter port and are corrected
   * here. Each produced a texture Bedrock silently never loads.
   */
  it("carries the corrected values that the ported table proves wrong", () => {
    expect(BLOCK_RENAMES.dark_oak_sapling).toBe("sapling_roofed_oak");
    expect(BLOCK_RENAMES.observer_back).toBe("observer_back");
    expect(ITEM_RENAMES.tropical_fish).toBe("fish_clownfish_raw");
  });

  it("keeps the entries Loomery had that PackConverter's table lacks", () => {
    // Beds are named bed_<colour> on Bedrock, and PackConverter maps none of
    // them — dropping these would un-name 16 textures.
    expect(ITEM_RENAMES.white_bed).toBe("bed_white");
    expect(ITEM_RENAMES.black_bed).toBe("bed_black");
    expect(BLOCK_RENAMES.grass).toBe("tallgrass");
    expect(ITEM_RENAMES.music_disc_relic).toBe("record_relic");
    expect(ITEM_RENAMES.scute).toBe("turtle_shell_piece");
  });

  it("reports a renamed texture as exact and an unmapped one as approximated", () => {
    const renamed = remapVanillaTexture("assets/minecraft/textures/block/oak_log.png");
    expect(renamed).toEqual({ outputPaths: ["textures/blocks/log_oak.png"], exact: true });

    // No rule for this name — passed through with the Java filename, flagged so
    // the report says "approximated" rather than claiming a real conversion.
    const passthrough = remapVanillaTexture("assets/minecraft/textures/block/some_custom_block.png");
    expect(passthrough?.exact).toBe(false);
    expect(passthrough?.outputPaths).toEqual(["textures/blocks/some_custom_block.png"]);
  });

  it("remaps armor layers, including the chainmail rename", () => {
    expect(remapVanillaTexture("assets/minecraft/textures/models/armor/diamond_layer_1.png")?.outputPaths)
      .toEqual(["textures/models/armor/diamond_1.png"]);
    expect(remapVanillaTexture("assets/minecraft/textures/models/armor/chainmail_layer_2.png")?.outputPaths)
      .toEqual(["textures/models/armor/chain_2.png"]);
    // The leather overlay keeps its suffix.
    expect(remapVanillaTexture("assets/minecraft/textures/models/armor/leather_layer_1_overlay.png")?.outputPaths)
      .toEqual(["textures/models/armor/leather_1_overlay.png"]);
  });

  it("remaps the 1.21.2+ equipment layout onto Bedrock armor layer names", () => {
    expect(remapVanillaTexture("assets/minecraft/textures/entity/equipment/humanoid/gold.png")?.outputPaths)
      .toEqual(["textures/models/armor/gold_1.png"]);
    expect(remapVanillaTexture("assets/minecraft/textures/entity/equipment/humanoid_leggings/gold.png")?.outputPaths)
      .toEqual(["textures/models/armor/gold_2.png"]);
  });
});

/**
 * The non-block/item path table. Its targets were each checked against Mojang's
 * bedrock-samples pack, because Bedrock's layout diverges structurally here —
 * directories get dropped, renamed, or moved to a different root — rather than
 * just by filename, so a guess produces a texture the client never loads.
 */
describe("verified non-block/item texture paths", () => {
  it("resolves a three-level entity path without doubling the section", () => {
    // PackConverter's own resolver emits entity/entity/banner/... for this one.
    expect(remapVanillaTexture("assets/minecraft/textures/entity/banner/border.png")?.outputPaths)
      .toEqual(["textures/entity/banner/banner_border.tga"]);
  });

  it("collapses the extra Java directory in villager paths", () => {
    expect(remapVanillaTexture("assets/minecraft/textures/entity/villager/profession/armorer.png")?.outputPaths)
      .toEqual(["textures/entity/villager2/professions/armorer.tga"]);
    expect(remapVanillaTexture("assets/minecraft/textures/entity/zombie_villager/profession/farmer.png")?.outputPaths)
      .toEqual(["textures/entity/zombie_villager2/professions/farmer.tga"]);
  });

  it("moves a texture to a different Bedrock root", () => {
    // Java keeps HUD sprites under gui/sprites/...; Bedrock's live under ui/.
    expect(remapVanillaTexture("assets/minecraft/textures/gui/sprites/hud/food_full.png")?.outputPaths)
      .toEqual(["textures/ui/hunger_full.png"]);
    expect(remapVanillaTexture("assets/minecraft/textures/mob_effect/speed.png")?.outputPaths)
      .toEqual(["textures/ui/speed_effect.png"]);
    expect(remapVanillaTexture("assets/minecraft/textures/trims/entity/humanoid/coast.png")?.outputPaths)
      .toEqual(["textures/trims/coast.png"]);
  });

  it("fans out textures Bedrock reuses in more than one place", () => {
    // The creeper skin also textures the creeper head block.
    expect(remapVanillaTexture("assets/minecraft/textures/entity/creeper/creeper.png")?.outputPaths)
      .toEqual(["textures/entity/creeper/creeper.png", "textures/entity/skulls/creeper.png"]);
  });

  it("emits .tga for the targets Bedrock only ships as TGA", () => {
    const banner = remapVanillaTexture("assets/minecraft/textures/entity/banner/border.png")!;
    expect(banner.outputPaths.every((p) => p.endsWith(".tga"))).toBe(true);

    // ...and .png for ones it ships as PNG, even from the same table.
    const armadillo = remapVanillaTexture("assets/minecraft/textures/entity/armadillo/armadillo.png")!;
    expect(armadillo.outputPaths).toEqual(["textures/entity/armadillo.png"]);
  });

  it("renames turtle_scute armor to Bedrock's turtle", () => {
    expect(remapVanillaTexture("assets/minecraft/textures/entity/equipment/humanoid/turtle_scute.png")?.outputPaths)
      .toEqual(["textures/models/armor/turtle_1.png"]);
  });

  it("leaves paintings alone — a dedicated stage stitches them into kz.png", () => {
    // Shipping them individually would produce files nothing references.
    const painting = remapVanillaTexture("assets/minecraft/textures/painting/backyard.png");
    expect(painting).toBeUndefined();
  });
});
