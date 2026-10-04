/**
 * Custom GUI conversion: Java GUI panels → Bedrock nine-sliced UI textures.
 *
 * The two editions build screens in fundamentally different ways, and the stage
 * reflects that rather than pretending a rename would do:
 *
 *  - **Java** blits one sheet per screen. A custom container ships a single
 *    176×166 `textures/gui/container/style.png` drawing the whole window, and
 *    the HUD is one 256×256 `icons.png` atlas holding hearts, hunger and armor
 *    as sprite tiles.
 *  - **Bedrock** assembles screens in JSON UI out of nine-sliced panels. The
 *    HUD pieces are separate `textures/ui/heart*.png` files, and every panel
 *    carries a sidecar `.json` declaring its stable border thickness.
 *
 * So two things convert and one does not:
 *
 *  1. A custom panel (a frame with a uniform border and a flat interior) maps
 *     onto exactly what Bedrock wants — {@link detectNineSlice} measures its
 *     border and we write the texture plus the sidecar.
 *  2. A custom 1:1 sprite (a button face, a slot highlight, an icon) is already
 *     at the right granularity, so it copies across unchanged.
 *  3. A vanilla sheet atlas is reported skipped with the real reason. Slicing
 *     `icons.png` into Bedrock's heart/hunger/armor files needs a hand-written
 *     tile map per sheet, and guessing one would ship a HUD with the wrong art
 *     in every slot.
 */

import type { JavaPack } from "../../java/javaPack.js";
import type { ConversionContext, PipelineStage } from "../context.js";
import { decodeCached, encodePng, type RgbaImage } from "../../image/png.js";
import { detectNineSlice, nineSliceSidecar } from "../../image/nineSlice.js";
import { timeOpAsync } from "../../report/timings.js";
import { fitPathName } from "../../util/packPath.js";

/** `textures/ui/<name>.png` — the reserved budget keeps the whole path legal. */
const UI_PATH_RESERVED = "textures/ui/.json".length;

/**
 * Below this many textures it is cheaper to encode in-process than to wake the
 * worker pool — the same threshold the items and geometry stages use.
 */
const ENCODE_POOL_THRESHOLD = 24;

/** Java GUI path below `textures/gui/` → the Bedrock UI texture it matches. */
const VANILLA_GUI_TARGETS: Record<string, string> = {
  // The handful of Java GUI files Bedrock keeps under the same meaning. Kept
  // deliberately short: an entry here is a claim that the art lines up, and the
  // two editions disagree about almost every panel's geometry.
  options_background: "ui/options_background",
  light_dirt_background: "ui/light_dirt_background",
};

export interface GuiStageResult {
  converted: number;
  sliced: number;
  skipped: number;
}

/**
 * Custom-namespace GUI assets: everything under `assets/<ns>/textures/gui/`
 * for a namespace that is not `minecraft`.
 *
 * Modern packs (1.20.2+) put GUI art in `gui/sprites/**` and reference it by
 * sprite id; older ones put it straight in `gui/`. Both are walked, because the
 * layout of the source folder is not what decides whether the art is a panel.
 */
async function runGuiStage(ctx: ConversionContext): Promise<void> {
  const paths = ctx.java.list({ prefix: "assets/", suffix: ".png" });
  /**
   * Encodes are batched rather than written as we walk, so the web build's
   * parallel PNG pool can take them — the same `pngEncoder` seam the items and
   * geometry stages use. A pack with a hundred GUI sprites would otherwise
   * encode every one of them on the single thread that also drives the DOM.
   */
  const jobs: { outPath: string; image: RgbaImage; sidecar?: { path: string; body: object }; detail: string }[] = [];

  for (const path of paths) {
    const match = path.match(/^assets\/([^/]+)\/textures\/gui\/(.+)\.png$/);
    if (match === null) continue;

    const namespace = match[1]!;
    const rel = match[2]!;

    // Vanilla GUI sheets are the case that cannot be sliced mechanically.
    if (namespace === "minecraft") {
      const target = VANILLA_GUI_TARGETS[rel];
      if (target === undefined) {
        ctx.report.skipped(
          "gui",
          path,
          "vanilla GUI sheet — Bedrock assembles these screens from separate nine-sliced panels " +
            "(textures/ui/*.png plus a .json sidecar), so one sheet cannot map onto them. " +
            "Custom panels under your own namespace are converted.",
        );
        continue;
      }
      // A pure passthrough: the bytes are copied, not re-encoded, because the
      // file Bedrock reads is the one the pack shipped.
      const bytes = ctx.java.read(path);
      if (bytes === undefined) continue;
      ctx.bedrock.write(`textures/${target}.png`, bytes);
      ctx.report.converted("gui", path, [`textures/${target}.png`]);
      continue;
    }

    if (ctx.options.namespaces.length > 0 && !ctx.options.namespaces.includes(namespace)) continue;

    // Read-only: the panel is re-encoded but never mutated, so the shared decode
    // is safe here and saves a copy per file.
    const image = decodeCached(ctx.java.read.bind(ctx.java), path, ctx.textureCache);
    if (image === undefined) {
      ctx.report.error("gui", path, "could not decode GUI texture");
      continue;
    }

    // A panel is the one Java shape Bedrock's model already describes, so it is
    // the only one that earns a sidecar.
    const detection = detectNineSlice(image);
    const name = fitPathName(safeName(`${namespace}_${rel.replace(/\//g, "_")}`), UI_PATH_RESERVED);
    const outPath = `textures/ui/${name}.png`;

    if (detection === undefined) {
      // Not a panel: treat it as a sprite. Same bytes, no sidecar — Bedrock
      // stretches a texture without one, which is correct for a button face or
      // an icon, and is the behaviour that needs no guessing.
      jobs.push({
        outPath,
        image,
        detail:
          "copied as a UI texture without a nine-slice sidecar, so Bedrock will stretch it. " +
          "That is right for icons and button faces; give a panel a uniform border if it should slice.",
      });
      continue;
    }

    jobs.push({
      outPath,
      image,
      sidecar: { path: `textures/ui/${name}.json`, body: nineSliceSidecar(image, detection) },
      detail:
        `nine-slice border ${detection.border.join("/")}px measured from the image and written as a ` +
        `sidecar — Bedrock keeps the border and stretches the middle. base_size ${image.width}×${image.height}.`,
    });
  }

  if (jobs.length === 0) return;

  // One batch through the pool when it is worth the message passing, matching
  // the threshold the items and geometry stages use.
  const encoder = ctx.options.pngEncoder;
  const usePool = encoder !== undefined && jobs.length >= ENCODE_POOL_THRESHOLD;
  const encoded = usePool
    ? await timeOpAsync("png.encode.pool", () => encoder.encode(jobs.map((j) => j.image)))
    : jobs.map((j) => encodePng(j.image));

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!;
    const bytes = encoded[i];
    if (bytes === undefined) {
      ctx.report.error("gui", job.outPath, "PNG encode failed");
      continue;
    }
    ctx.bedrock.write(job.outPath, bytes);

    // Exactly one entry per file. Two would double-count the summary and split
    // the story — the reason a texture gained a sidecar is the same reason it
    // was written, so it belongs on one line.
    if (job.sidecar !== undefined) {
      ctx.bedrock.writeJson(job.sidecar.path, job.sidecar.body);
      ctx.report.add({
        stage: "gui",
        source: job.outPath,
        status: "converted",
        outputs: [job.outPath, job.sidecar.path],
        detail: job.detail,
      });
      continue;
    }
    ctx.report.approximated("gui", job.outPath, job.detail, [job.outPath]);
  }
}

/** The GUI stage. Registered in `pipeline.ts` between `fonts` and `paintings`. */
export const guiStage: PipelineStage = {
  name: "gui",
  run: runGuiStage,
};

/** Lowercase, non-identifier runs collapsed, so a path becomes a file name. */
function safeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Exposed for the tests and for any future caller that needs the mapping. */
export { VANILLA_GUI_TARGETS, safeName as safeGuiName };
