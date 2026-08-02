/**
 * Raw uncompressed `.pic` full-screen picture decoder (Phantasie I, Amiga).
 *
 * See docs/phantasie/graphics-formats.md §3: no header, no palette, no
 * compression — the entire file is raw pixel data in classic Amiga
 * contiguous-bitplane order (`bitplane.ts`'s 'planar' mode).
 *
 * No in-game palette has been confirmed for these files (TODO
 * `gfx-pic-palette`) — only the P1 monster/race palette at `game+0x194BC`
 * is confirmed, and it is not established to be the same palette a
 * title/town screen uses. `picGreyscalePalette()` reproduces the neutral
 * 16-level greyscale substitute used during the original RE pass to
 * confirm layout/legibility; callers that want to *try* the monster/race
 * palette can pass `exe-data.ts`'s `readP1Palette()` result instead, but
 * that is an unverified guess, not a confirmed decode.
 */

import { decodeBitplaneIndices, bitplaneBufferSize, type BitplaneConfig } from './bitplane.ts';
import { indicesToRGBA, type RGB } from './palette.ts';

export interface PicImage {
  width: number;
  height: number;
  indices: Uint8Array;
}

/** The two confirmed `.pic` dimensions, keyed by file size (graphics-formats.md §3). */
const PIC_DIMENSIONS_BY_SIZE: Record<number, { width: number; height: number }> = {
  32000: { width: 320, height: 200 }, // cover1/cover2/decor/final/pelnor.pic
  7040: { width: 176, height: 80 }, // logo.pic
};

export function decodePic(data: Uint8Array): PicImage {
  const dims = PIC_DIMENSIONS_BY_SIZE[data.length];
  if (!dims) {
    throw new Error(
      `Unrecognised .pic file size: ${data.length} bytes (expected 32000 or 7040 — see graphics-formats.md §3)`,
    );
  }
  const config: BitplaneConfig = { width: dims.width, height: dims.height, bitplaneCount: 4, mode: 'planar' };
  // Structural cross-check: width/8 * height * bitplanes must reproduce the
  // exact file size (graphics-formats.md §3's independent confirmation).
  const expectedSize = bitplaneBufferSize(config);
  if (expectedSize !== data.length) {
    throw new Error(`Internal error: computed .pic buffer size ${expectedSize} != file size ${data.length}`);
  }
  const indices = decodeBitplaneIndices(data, 0, config);
  return { width: dims.width, height: dims.height, indices };
}

/**
 * Neutral 16-level greyscale palette — used because no in-game palette has
 * been confirmed for full-screen `.pic` pictures. Sufficient to confirm
 * layout/legibility, not real in-game colour.
 */
export function picGreyscalePalette(): RGB[] {
  const colors: RGB[] = [];
  for (let i = 0; i < 16; i++) {
    const v = Math.round((i / 15) * 255);
    colors.push({ r: v, g: v, b: v });
  }
  return colors;
}

export function picToRGBA(image: PicImage, palette: RGB[] = picGreyscalePalette()): Uint8Array {
  return indicesToRGBA(image.indices, palette, false);
}
