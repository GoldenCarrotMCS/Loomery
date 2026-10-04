import { describe, expect, it } from "vitest";
import { encode } from "fast-png";
import { zipSync } from "fflate";
import { convertPack } from "../src/convert/pipeline.js";
import { readZip } from "../src/io/zip.js";

/** Flat RGBA PNG, so a test can build a panel without a fixture file. */
function png(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(paint(x, y), (y * width + x) * 4);
    }
  }
  return new Uint8Array(encode({ width, height, data, channels: 4 }));
}

/** A nine-sliceable panel: `k`-thick border, flat interior. */
function panelPng(size: number, k: number): Uint8Array {
  return png(size, size, (x, y) =>
    x >= k && x < size - k && y >= k && y < size - k ? [210, 210, 215, 255] : [24, 28, 34, 255],
  );
}

/** Artwork with no flat border, so it cannot be sliced. */
function artworkPng(size: number): Uint8Array {
  return png(size, size, (x, y) => [x * 7, y * 7, (x + y) * 3, 255]);
}

function fixtureZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const tree: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    tree[path] = typeof content === "string" ? new TextEncoder().encode(content) : content;
  }
  return zipSync(tree);
}

const MCMETA = JSON.stringify({ pack: { pack_format: 34, description: "GUI test" } });

describe("GUI conversion", () => {
  it("writes a custom panel plus a nine-slice sidecar Bedrock can read", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": MCMETA,
      "assets/mypack/textures/gui/container/panel.png": panelPng(32, 4),
    });

    const result = await convertPack(zip, { packName: "Gui" });
    const out = readZip(result.mcpack);

    const texture = out.list().find((p) => p.startsWith("textures/ui/") && p.endsWith("panel.png"));
    expect(texture).toBeDefined();
    const sidecarPath = texture!.replace(/\.png$/, ".json");
    expect(out.has(sidecarPath)).toBe(true);

    const sidecar = JSON.parse(out.readText(sidecarPath)!) as any;
    expect(sidecar.nineslice_size).toBe(4);
    expect(sidecar.base_size).toEqual([32, 32]);

    // The report must name both files, since a pack author needs to know where
    // the sidecar went and why a texture gained two outputs.
    const entry = result.report.entries.find((e) => e.status === "converted" && e.stage === "gui" && e.source.includes("panel.png"));
    expect(entry).toBeDefined();
    expect(entry!.outputs!.some((o) => o.endsWith(".json"))).toBe(true);
    expect(entry!.detail).toContain("nine-slice");
  });

  it("copies artwork as a UI texture with no sidecar, and says why", async () => {
    // No sidecar is the correct answer for a gradient: Bedrock stretches it,
    // which is what a button face or icon wants. Claiming a slice here would
    // tear the art, so the report has to explain the omission.
    const zip = fixtureZip({
      "pack.mcmeta": MCMETA,
      "assets/mypack/textures/gui/sprites/button.png": artworkPng(32),
    });

    const result = await convertPack(zip, { packName: "Gui" });
    const out = readZip(result.mcpack);

    const texture = out.list().find((p) => p.startsWith("textures/ui/") && p.endsWith("button.png"));
    expect(texture).toBeDefined();
    expect(out.has(texture!.replace(/\.png$/, ".json"))).toBe(false);

    const entry = result.report.entries.find((e) => e.stage === "gui" && e.source.includes("button.png"));
    expect(entry!.status).toBe("approximated");
    expect(entry!.detail).toContain("stretch");
  });

  it("reports a vanilla GUI sheet as skipped with the structural reason", async () => {
    // icons.png is one 256×256 atlas on Java and a dozen files on Bedrock. The
    // report has to say that rather than silently dropping it, and the reason
    // must name nine-slicing so a pack author knows what to do instead.
    const zip = fixtureZip({
      "pack.mcmeta": MCMETA,
      "assets/minecraft/textures/gui/icons.png": artworkPng(64),
    });

    const result = await convertPack(zip, { packName: "Gui" });
    const entry = result.report.entries.find((e) => e.stage === "gui" && e.source.includes("icons.png"));
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("skipped");
    expect(entry!.detail).toContain("nine-sliced");
    expect(readZip(result.mcpack).list().some((p) => p.startsWith("textures/ui/"))).toBe(false);
  });

  it("remaps the vanilla GUI files Bedrock keeps under the same meaning", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": MCMETA,
      "assets/minecraft/textures/gui/options_background.png": panelPng(16, 4),
    });

    const result = await convertPack(zip, { packName: "Gui" });
    const out = readZip(result.mcpack);
    expect(out.has("textures/ui/options_background.png")).toBe(true);
    // A vanilla passthrough must not gain a sidecar: the file it replaces has
    // its own slicing defined by Bedrock, and second-guessing it would change
    // how the options screen renders.
    expect(out.has("textures/ui/options_background.json")).toBe(false);
  });

  it("honours the namespace filter", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": MCMETA,
      "assets/mypack/textures/gui/container/panel.png": panelPng(32, 4),
      "assets/other/textures/gui/container/panel.png": panelPng(32, 4),
    });

    const result = await convertPack(zip, { packName: "Gui", namespaces: ["mypack"] });
    const ui = readZip(result.mcpack).list().filter((p) => p.startsWith("textures/ui/"));
    expect(ui.some((p) => p.includes("mypack"))).toBe(true);
    expect(ui.some((p) => p.includes("other"))).toBe(false);
  });

  it("keeps generated UI paths inside Bedrock's path limit", async () => {
    // A nested sprite path becomes one long name, and Bedrock warns at 80
    // characters — the same budget every other stage fits through fitPathName.
    const deep = `assets/mypack/textures/gui/sprites/very/deeply/nested/containers/wardrobe_panel/background/${"x".repeat(60)}.png`;
    const zip = fixtureZip({ "pack.mcmeta": MCMETA, [deep]: panelPng(32, 4) });

    const result = await convertPack(zip, { packName: "Gui" });
    const ui = readZip(result.mcpack).list().filter((p) => p.startsWith("textures/ui/"));
    expect(ui.length).toBeGreaterThan(0);
    for (const path of ui) {
      expect(path.length).toBeLessThanOrEqual(79);
    }
  });

  it("survives a pack with no GUI assets at all", async () => {
    // The stage runs on every conversion, including a pack that has no GUI art,
    // so it must report nothing rather than an empty-or-broken entry.
    const zip = fixtureZip({
      "pack.mcmeta": MCMETA,
      "assets/minecraft/textures/item/golden_apple.png": panelPng(16, 4),
    });

    const result = await convertPack(zip, { packName: "Gui" });
    expect(result.report.entries.filter((e) => e.stage === "gui")).toEqual([]);
    expect(result.report.summary.error).toBe(0);
  });

  it("does not treat a GUI texture as a vanilla texture to remap", async () => {
    // texturesStage remaps assets/minecraft/textures/**, and gui/ is in its
    // category list. The GUI stage must own these files, or they would be
    // written twice — once un-sliced by texturesStage and once here.
    const zip = fixtureZip({
      "pack.mcmeta": MCMETA,
      "assets/minecraft/textures/gui/icons.png": artworkPng(32),
    });

    const result = await convertPack(zip, { packName: "Gui" });
    const out = readZip(result.mcpack);
    expect(out.has("textures/gui/icons.png")).toBe(false);
  });
});
