/**
 * Nine-slice border detection.
 *
 * Bedrock assembles its screens from nine-sliced panels: a `textures/ui/*.png`
 * ships beside a `.json` sidecar saying how thick the fixed border is, and the
 * engine stretches only the middle. Java has nothing equivalent — it blits one
 * whole sheet behind a container.
 *
 * So converting a custom GUI panel means answering "where does the border end?"
 * from the image alone. That is what this module does, and it is the only
 * interesting logic in the GUI conversion path: get it wrong and the panel
 * either smears its border across the screen or tiles a stretchable middle.
 *
 * The property tested is the one that makes a nine-slice valid: a border strip
 * must be **constant along its own thickness**. A 3px top border is three
 * horizontal lines that repeat left to right; if column x has two different
 * colours within those three rows, the strip is artwork rather than a border,
 * and slicing it would tear the art.
 */

import type { RgbaImage } from "./png.js";

/** `left, top, right, bottom`, matching Bedrock's array form. */
export type NineSliceBorder = [number, number, number, number];

export interface NineSliceDetection {
  /**
   * Per-side border thickness. Bedrock accepts a single integer for a uniform
   * border or `[left, top, right, bottom]`; {@link uniform} says which form to
   * emit, so a symmetric panel keeps the compact spelling.
   */
  border: NineSliceBorder;
  /** True when all four sides share one thickness. */
  uniform: boolean;
  /** The single-integer form, when {@link uniform}. */
  size: number;
}

/** Cheap pixel compare; both images are always 8-bit RGBA (see png.ts). */
function same(image: RgbaImage, x1: number, y1: number, x2: number, y2: number): boolean {
  const a = (y1 * image.width + x1) * 4;
  const b = (y2 * image.width + x2) * 4;
  const d = image.data;
  return d[a] === d[b] && d[a + 1] === d[b + 1] && d[a + 2] === d[b + 2] && d[a + 3] === d[b + 3];
}

/**
 * Is the strip of thickness `k` constant across its thickness?
 *
 * Sampled rather than exhaustive: a wide panel would otherwise cost w×k pixel
 * comparisons per candidate per side, and for the question being asked —
 * "is this a flat border or artwork" — 48 samples across the strip is already
 * far more evidence than the answer needs.
 */
function stripUniform(image: RgbaImage, side: "top" | "bottom" | "left" | "right", k: number): boolean {
  const { width: w, height: h } = image;
  const SAMPLES = 48;

  if (side === "top" || side === "bottom") {
    const y0 = side === "top" ? 0 : h - k;
    const from = Math.min(k, w - k);
    const to = Math.max(from + 1, w - k);
    const step = Math.max(1, Math.floor((to - from) / SAMPLES));
    for (let x = from; x < to; x += step) {
      for (let y = y0 + 1; y < y0 + k; y++) {
        if (!same(image, x, y0, x, y)) return false;
      }
    }
    return true;
  }

  const x0 = side === "left" ? 0 : w - k;
  const from = Math.min(k, h - k);
  const to = Math.max(from + 1, h - k);
  const step = Math.max(1, Math.floor((to - from) / SAMPLES));
  for (let y = from; y < to; y += step) {
    for (let x = x0 + 1; x < x0 + k; x++) {
      if (!same(image, x0, y, x, y)) return false;
    }
  }
  return true;
}

/** Largest border thickness for one side, or 0 when the side is artwork. */
function sideBorder(image: RgbaImage, side: "top" | "bottom" | "left" | "right", maxK: number): number {
  for (let k = maxK; k >= 2; k--) {
    if (stripUniform(image, side, k)) return k;
  }
  return 0;
}

/**
 * Detect a nine-slice border, or `undefined` when the image is not a panel.
 *
 * `minSize` guards two failure modes at once: a texture smaller than the
 * thinnest legal panel cannot hold a border plus a stretchable middle, and a
 * border thicker than a third of the image would leave nothing to stretch.
 */
export function detectNineSlice(image: RgbaImage, minSize = 8): NineSliceDetection | undefined {
  const { width: w, height: h } = image;
  if (w < minSize || h < minSize) return undefined;

  // A border can never exceed a third of the shorter axis: two opposite borders
  // plus at least one pixel of stretchable middle must fit.
  const maxK = Math.min(Math.floor(Math.min(w, h) / 3), 24);
  if (maxK < 2) return undefined;

  const border: NineSliceBorder = [
    sideBorder(image, "left", maxK),
    sideBorder(image, "top", maxK),
    sideBorder(image, "right", maxK),
    sideBorder(image, "bottom", maxK),
  ];

  // Any zero means that side is not a flat border, so the image is artwork and
  // must be stretched or reworked rather than sliced — saying nothing is more
  // honest than guessing a thickness that would tear it.
  if (border.some((k) => k === 0)) return undefined;

  const uniform = border.every((k) => k === border[0]);
  return { border, uniform, size: border[0]! };
}

/**
 * The sidecar Bedrock reads next to a UI texture.
 *
 * `base_size` is the texture's size in *logical* UI units, not its pixel size —
 * Bedrock slices in the logical space and scales the strips, which is what lets
 * a pack ship a 4× sharpened panel and keep the same sidecar. We emit the pixel
 * size, which is correct for the 1× art this stage writes out.
 */
export function nineSliceSidecar(image: RgbaImage, detection: NineSliceDetection): object {
  return {
    nineslice_size: detection.uniform ? detection.size : detection.border,
    base_size: [image.width, image.height],
  };
}
