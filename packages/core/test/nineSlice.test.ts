import { describe, expect, it } from "vitest";
import { detectNineSlice, nineSliceSidecar } from "../src/image/nineSlice.js";
import { createImage, type RgbaImage } from "../src/image/png.js";

const BORDER: [number, number, number, number] = [24, 28, 34, 255];
const FILL: [number, number, number, number] = [210, 210, 215, 255];

function put(image: RgbaImage, x: number, y: number, rgba: [number, number, number, number]): void {
  const i = (y * image.width + x) * 4;
  image.data[i] = rgba[0];
  image.data[i + 1] = rgba[1];
  image.data[i + 2] = rgba[2];
  image.data[i + 3] = rgba[3];
}

/** A panel: flat interior, with `[left, top, right, bottom]`-thick borders. */
function panel(w: number, h: number, sides: [number, number, number, number]): RgbaImage {
  const [left, top, right, bottom] = sides;
  const image = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x >= left && x < w - right && y >= top && y < h - bottom;
      put(image, x, y, inside ? FILL : BORDER);
    }
  }
  return image;
}

describe("detectNineSlice", () => {
  it("measures a uniform border", () => {
    const result = detectNineSlice(panel(32, 32, [4, 4, 4, 4]));
    expect(result).toBeDefined();
    expect(result!.border).toEqual([4, 4, 4, 4]);
    expect(result!.uniform).toBe(true);
    expect(result!.size).toBe(4);
  });

  it("takes the largest thickness whose strip is still flat", () => {
    // A 6px border means rows 0–5 are one colour and row 6 is the fill. The
    // detector must land on 6: 7 would fold a fill row into the border, and 5
    // would leave a slice of border in the stretchable middle.
    const result = detectNineSlice(panel(40, 40, [6, 6, 6, 6]));
    expect(result!.border).toEqual([6, 6, 6, 6]);
  });

  it("reports each side separately when the border is asymmetric", () => {
    // Asymmetric borders are exactly why Bedrock accepts the array form.
    const result = detectNineSlice(panel(48, 48, [3, 5, 7, 2]));
    expect(result).toBeDefined();
    expect(result!.border).toEqual([3, 5, 7, 2]);
    expect(result!.uniform).toBe(false);
  });

  it("caps the border at a third of the shorter axis", () => {
    // A 14px border on a 30px image is not a legal panel — two opposite borders
    // plus a stretchable middle will not fit — so the measurement must stop at
    // the cap of 10 and never report 14.
    const result = detectNineSlice(panel(30, 30, [14, 14, 14, 14]));
    expect(result).toBeDefined();
    expect(result!.size).toBeLessThanOrEqual(Math.floor(30 / 3));
    expect(result!.size).toBe(10);
  });

  it("returns undefined when no legal border thickness fits", () => {
    // Below three pixels tall there is no room for two borders and a middle, so
    // even though every strip is flat, no measurement is valid.
    expect(detectNineSlice(panel(5, 5, [2, 2, 2, 2]))).toBeUndefined();
  });

  it("returns undefined for artwork with no flat border", () => {
    const image = createImage(32, 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        put(image, x, y, [x * 7, y * 7, (x + y) * 3, 255]);
      }
    }
    expect(detectNineSlice(image)).toBeUndefined();
  });

  it("returns undefined when only some sides have a flat border", () => {
    // A gradient across the top edge but flat sides: the top cannot be sliced,
    // and claiming it could would tear the art rather than stretch it.
    const image = panel(32, 32, [4, 4, 4, 4]);
    for (let x = 0; x < 32; x++) put(image, x, 1, [x * 8, 0, 0, 255]);
    expect(detectNineSlice(image)).toBeUndefined();
  });

  it("returns undefined for an image too small to be a panel", () => {
    expect(detectNineSlice(panel(4, 4, [2, 2, 2, 2]))).toBeUndefined();
    expect(detectNineSlice(panel(7, 7, [2, 2, 2, 2]))).toBeUndefined();
  });

  it("rejects a one-pixel border, which any image would pass", () => {
    // A 1px strip is trivially "flat", so accepting it would claim a nine-slice
    // for every icon in the pack and change how Bedrock renders all of them.
    const image = createImage(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const edge = x === 0 || y === 0 || x === 15 || y === 15;
        put(image, x, y, edge ? BORDER : [x * 11, y * 11, 60, 255]);
      }
    }
    expect(detectNineSlice(image)).toBeUndefined();
  });

  it("ignores a flat interior, which is not evidence of a border", () => {
    // A completely uniform image: every strip is flat, so the detector would
    // happily return the maximum. That is harmless — slicing a solid colour
    // renders identically — but the measured value must still respect the cap.
    const image = createImage(24, 24);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) put(image, x, y, FILL);
    const result = detectNineSlice(image);
    expect(result).toBeDefined();
    expect(result!.size).toBeLessThanOrEqual(8);
  });

  it("handles a rectangular panel, not just a square one", () => {
    // A container sheet is 176×166 in Java; the same border on both axes is the
    // common case, so the shorter axis must not win the cap in a way that
    // truncates the longer one's measurement.
    const result = detectNineSlice(panel(176, 166, [4, 4, 4, 4]));
    expect(result!.border).toEqual([4, 4, 4, 4]);
  });

  it("respects a caller-supplied minimum size", () => {
    expect(detectNineSlice(panel(12, 12, [3, 3, 3, 3]), 16)).toBeUndefined();
    expect(detectNineSlice(panel(12, 12, [3, 3, 3, 3]), 8)).toBeDefined();
  });
});

describe("nineSliceSidecar", () => {
  it("emits the integer form for a uniform border", () => {
    const image = panel(32, 32, [4, 4, 4, 4]);
    const sidecar = nineSliceSidecar(image, detectNineSlice(image)!) as any;
    expect(sidecar.nineslice_size).toBe(4);
    expect(sidecar.base_size).toEqual([32, 32]);
  });

  it("emits the array form for an asymmetric border", () => {
    const image = panel(48, 48, [3, 5, 7, 2]);
    const sidecar = nineSliceSidecar(image, detectNineSlice(image)!) as any;
    expect(sidecar.nineslice_size).toEqual([3, 5, 7, 2]);
    expect(sidecar.base_size).toEqual([48, 48]);
  });

  it("uses the pixel size as base_size, which is right for 1x art", () => {
    // base_size is in logical UI units; since this stage writes the source
    // pixels out unscaled, the two coincide.
    const image = panel(176, 166, [4, 4, 4, 4]);
    const sidecar = nineSliceSidecar(image, detectNineSlice(image)!) as any;
    expect(sidecar.base_size).toEqual([176, 166]);
  });

  it("serializes to a sidecar Bedrock can read", () => {
    const image = panel(32, 32, [4, 4, 4, 4]);
    const text = JSON.stringify(nineSliceSidecar(image, detectNineSlice(image)!));
    const parsed = JSON.parse(text) as any;
    expect(typeof parsed.nineslice_size).toBe("number");
    expect(Array.isArray(parsed.base_size)).toBe(true);
    expect(Object.keys(parsed).sort()).toEqual(["base_size", "nineslice_size"]);
  });
});
