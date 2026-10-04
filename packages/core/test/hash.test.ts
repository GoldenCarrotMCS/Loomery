import { describe, expect, it } from "vitest";
import { fastHash, fastHashString } from "../src/util/hash.js";

const bytes = (values: number[]): Uint8Array => new Uint8Array(values);

/**
 * xorshift32 — deterministic per-seed filler, so the collision sweep below is
 * reproducible (a flaky dedup test would be worse than none).
 */
function filler(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

describe("fastHash", () => {
  it("always returns 16 lowercase hex characters", () => {
    for (const length of [0, 1, 3, 4, 5, 8, 17, 64, 1023]) {
      const hash = fastHash(filler(length + 1, length));
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("returns the same digest for the same bytes, and different digests for different bytes", () => {
    const a = bytes([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = bytes([1, 2, 3, 4, 5, 6, 7, 9]);
    expect(fastHash(a)).toBe(fastHash(a));
    expect(fastHash(a)).not.toBe(fastHash(b));
  });

  it("gives buffers that differ only in length different digests", () => {
    // Length is folded into both lanes' seeds, so a prefix is not a prefix of
    // the digest — dedup keys must not collide across truncated uploads.
    expect(fastHash(bytes([7]))).not.toBe(fastHash(bytes([7, 0])));
    expect(fastHash(bytes([1, 2, 3]))).not.toBe(fastHash(bytes([1, 2, 3, 0])));
    expect(fastHash(bytes([1, 2, 3, 4]))).not.toBe(fastHash(bytes([1, 2, 3, 4, 0])));
  });

  it("pins the known digests, so a change to the mixing is a visible test failure", () => {
    // Locked deliberately: these keys address generated pack paths, and a
    // silent change would rename every file a user already installed.
    expect(fastHash(bytes([]))).toBe("811c9dc5c2b2ae35");
    expect(fastHash(bytes([97, 98, 99]))).toBe("57bf9b1230646a9a");
    expect(fastHash(bytes([0, 1, 2, 3]))).toBe("9730c3d3ba5919c7");
    expect(fastHash(bytes([0, 1, 2, 3, 4, 5, 6, 7]))).toBe("354f42c9e2980029");
    // 5 bytes = one whole word plus a 1-byte tail, exercising both loops.
    expect(fastHash(bytes([1, 2, 3, 4, 5]))).toBe("949c84e2271b1a2e");
    expect(fastHashString("minecraft:item/diamond_sword")).toBe("6c68de561dc8de1e");
  });

  it("reads only the view's window, not the whole backing buffer", () => {
    // Zip reads and subarray() hand out byteOffset-into-larger-buffer slices.
    // A Uint32Array view would misread these, which is why the implementation
    // uses DataView over (buffer, byteOffset, length).
    const backing = new Uint8Array(32);
    backing.set([9, 9, 9, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0);
    const windowed = backing.subarray(4, 12);
    expect(fastHash(windowed)).toBe(fastHash(bytes([1, 2, 3, 4, 5, 6, 7, 8])));
    // Same bytes at an odd (unaligned) offset must also agree.
    const unaligned = backing.subarray(5, 13);
    expect(fastHash(unaligned)).toBe(fastHash(bytes([2, 3, 4, 5, 6, 7, 8, 9])));
  });

  it("does not collide across a few thousand distinct atlas-sized buffers", () => {
    // The dedup claim in the module comment: same bytes → same key, different
    // bytes → different key, at the scale of one pack's stitched atlases.
    const seen = new Map<string, number>();
    for (let seed = 1; seed <= 3000; seed++) {
      const hash = fastHash(filler(seed, 128));
      const previous = seen.get(hash);
      expect(previous).toBeUndefined();
      seen.set(hash, seed);
    }
    expect(seen.size).toBe(3000);
  });

  it("hashes a string by its UTF-8 bytes", () => {
    expect(fastHashString("abc")).toBe(fastHash(bytes([97, 98, 99])));
    // Non-ASCII goes through the encoder, not char codes.
    expect(fastHashString("é")).toBe(fastHash(new TextEncoder().encode("é")));
    expect(fastHashString("a")).not.toBe(fastHashString("b"));
  });
});
