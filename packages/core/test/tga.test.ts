import { describe, expect, it } from "vitest";
import { createImage, type RgbaImage } from "../src/image/png.js";
import { encodeTga } from "../src/image/tga.js";

/**
 * Bedrock's legacy entity textures (banners, villager and zombie-villager
 * professions, a few mobs) ship as `.tga`, so the converter has to write that
 * format for them. These decode the bytes back by hand rather than trusting the
 * encoder, because a TGA that is merely "close" renders as garbage or not at all.
 */
function readTga(bytes: Uint8Array): { width: number; height: number; pixels: number[][] } {
  const width = bytes[12]! | (bytes[13]! << 8);
  const height = bytes[14]! | (bytes[15]! << 8);
  const pixelDepth = bytes[16]!;
  const descriptor = bytes[17]!;
  const topOrigin = (descriptor & 0x20) !== 0;

  const pixels: number[][] = [];
  for (let i = 0; i < width * height; i++) {
    const p = 18 + i * (pixelDepth / 8);
    pixels.push([bytes[p + 2]!, bytes[p + 1]!, bytes[p]!, bytes[p + 3]!]);
  }
  // Each row is a 4-tuple [r,g,b,a]; return them in top-down order.
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const src = topOrigin ? y : height - 1 - y;
    rows.push(...pixels.slice(src * width, src * width + width));
  }
  return { width, height, pixels: rows };
}

describe("TGA encoder", () => {
  it("writes an uncompressed 32-bit BGRA image Bedrock can read", () => {
    const image = createImage(2, 2);
    image.data.set([255, 0, 0, 255], 0); // opaque red, top-left
    const tga = encodeTga(image);

    expect(tga[2]).toBe(2); // uncompressed true-colour
    expect(tga[16]).toBe(32);
    expect(tga[12]! | (tga[13]! << 8)).toBe(2);
    expect(tga[14]! | (tga[15]! << 8)).toBe(2);
    expect(tga.length).toBe(18 + 2 * 2 * 4);
  });

  it("stores channels as BGRA and flips alpha for Bedrock's convention", () => {
    const image = createImage(1, 1);
    // Opaque red in PNG terms: alpha 255. Bedrock TGA wants alpha 0 for opaque.
    image.data.set([255, 0, 0, 255], 0);
    const [r, g, b, a] = readTga(encodeTga(image)).pixels[0]!;
    expect([r, g, b]).toEqual([255, 0, 0]);
    expect(a).toBe(0);

    const clear = createImage(1, 1); // transparent
    expect(readTga(encodeTga(clear)).pixels[0]![3]).toBe(255);
  });

  it("keeps rows in the right order for a bottom-left origin image", () => {
    // Row 0 red, row 1 green — the encoder writes bottom-up, so a naive reader
    // (the one above) has to flip it back to recover the original order.
    const image = createImage(1, 2);
    image.data.set([255, 0, 0, 255], 0);
    image.data.set([0, 255, 0, 255], 4);
    const { pixels } = readTga(encodeTga(image));
    expect(pixels[0]!.slice(0, 3)).toEqual([255, 0, 0]);
    expect(pixels[1]!.slice(0, 3)).toEqual([0, 255, 0]);

    // And the file itself really is bottom-up: the green row is stored first,
    // as BGRA with the alpha channel flipped.
    const tga = encodeTga(image);
    expect([tga[18], tga[19], tga[20], tga[21]]).toEqual([0, 255, 0, 0]);
    expect([tga[22], tga[23], tga[24], tga[25]]).toEqual([0, 0, 255, 0]);
  });

  it("round-trips a larger image losslessly (modulo the alpha convention)", () => {
    const image: RgbaImage = createImage(32, 16);
    for (let i = 0; i < 32 * 16; i++) {
      image.data[i * 4] = (i * 7) % 256;
      image.data[i * 4 + 1] = (i * 13) % 256;
      image.data[i * 4 + 2] = (i * 29) % 256;
      image.data[i * 4 + 3] = i % 2 === 0 ? 255 : 0; // opaque / transparent
    }
    const back = readTga(encodeTga(image));
    for (let i = 0; i < 32 * 16; i++) {
      const expectedAlpha = image.data[i * 4 + 3] === 255 ? 0 : 255;
      expect(back.pixels[i]!.slice(0, 4)).toEqual([
        image.data[i * 4]!,
        image.data[i * 4 + 1]!,
        image.data[i * 4 + 2]!,
        expectedAlpha,
      ]);
    }
  });
});
