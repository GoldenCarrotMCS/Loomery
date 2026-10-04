import type { RgbaImage } from "./png.js";

/**
 * Minimal TGA (Truevision) writer — Bedrock's legacy entity textures (banners,
 * villager professions, a few mobs) ship as `.tga`, and the client looks them up
 * by that extension. Writing PNG bytes under a `.tga` name gets nothing.
 *
 * Emits uncompressed 32-bit BGRA (image type 2) with a bottom-left origin
 * (descriptor bit 5 clear), which is what Bedrock's own banner textures use and
 * what every TGA reader accepts. Bedrock also ships RLE and top-left variants,
 * so it reads both — the uncompressed form is chosen here because it is the one
 * that cannot be got subtly wrong.
 *
 * Bedrock's alpha convention is inverted relative to PNG: a TGA alpha of 0 is
 * opaque and 255 is transparent. Callers pass RGBA, so the channel is flipped
 * on the way out.
 */
export function encodeTga(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const header = 18;
  const out = new Uint8Array(header + width * height * 4);

  out[2] = 2; // uncompressed true-color
  out[12] = width & 0xff;
  out[13] = (width >> 8) & 0xff;
  out[14] = height & 0xff;
  out[15] = (height >> 8) & 0xff;
  out[16] = 32; // bits per pixel
  out[17] = 8; // 8 alpha bits, bottom-left origin

  // Rows run bottom-to-top for a bottom-left origin image.
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    let dst = header + y * width * 4;
    for (let x = 0; x < width; x++) {
      const p = src + x * 4;
      out[dst] = data[p + 2]!; // B
      out[dst + 1] = data[p + 1]!; // G
      out[dst + 2] = data[p]!; // R
      out[dst + 3] = 255 - data[p + 3]!; // A, flipped
      dst += 4;
    }
  }
  return out;
}
