/**
 * Generic bitplane pixel-extraction primitive shared by every Phantasie
 * image format (`.pic`, `.pat`, `.cmp`/`.csh`, `.set`).
 *
 * See docs/phantasie/graphics-formats.md §1: both the classic Amiga
 * contiguous-bitplane layout ("Planar", used by Phantasie I's raw `.pic`/
 * `.pat` files) and the Atari-ST word-interleaved-by-2 layout
 * ("Interleaved", inherited unchanged by Phantasie III's `.cmp`/`.csh`/
 * `.set` container) reduce to one pixel-extraction formula, parameterised
 * by (width, height, bitplane count, mode, interleave size).
 */

export type BitplaneMode = 'planar' | 'interleaved';

export interface BitplaneConfig {
  width: number;
  height: number;
  bitplaneCount: number;
  mode: BitplaneMode;
  /**
   * Interleave size in bytes. Only meaningful for 'interleaved' mode — the
   * ST container format always uses 2 (word-interleave-by-2). Ignored for
   * 'planar' mode, where the equivalent value is derived from `width`.
   */
  interleave?: number;
}

function interleaveSizeOf(config: BitplaneConfig): number {
  return config.mode === 'planar' ? config.width / 8 : (config.interleave ?? 2);
}

function scanlineStrideOf(config: BitplaneConfig): number {
  return config.mode === 'planar' ? config.width / 8 : (config.width / 8) * config.bitplaneCount;
}

function bitplaneStrideOf(config: BitplaneConfig): number {
  return config.mode === 'planar'
    ? (config.width * config.height) / 8
    : (config.interleave ?? 2);
}

/**
 * Byte offset (relative to the start of the raw bitplane buffer) holding
 * the bit for pixel-byte-column `byteX` (= `x >> 3`), row `y`, bitplane
 * `plane`. Ground truth: graphics-formats.md §1's generic pixel formula.
 */
export function bitplaneByteOffset(
  byteX: number,
  y: number,
  plane: number,
  config: BitplaneConfig,
): number {
  const interleaveSize = interleaveSizeOf(config);
  const scanlineStride = scanlineStrideOf(config);
  const bitplaneStride = bitplaneStrideOf(config);
  return (
    (byteX % interleaveSize) +
    Math.floor(byteX / interleaveSize) * (config.bitplaneCount * interleaveSize) +
    plane * bitplaneStride +
    y * scanlineStride
  );
}

/**
 * Total byte size of a raw bitplane buffer for the given config (no
 * header/palette/padding) — `width/8 * height * bitplaneCount`, the same
 * formula regardless of mode, since both layouts store exactly
 * `bitplaneCount` full planes' worth of bits, just ordered differently.
 */
export function bitplaneBufferSize(config: BitplaneConfig): number {
  return (config.width / 8) * config.height * config.bitplaneCount;
}

/**
 * Decode a raw bitplane buffer into one palette-index byte per pixel,
 * row-major (`width * height` bytes, index = `y * width + x`).
 */
export function decodeBitplaneIndices(
  data: Uint8Array,
  offset: number,
  config: BitplaneConfig,
): Uint8Array {
  const { width, height, bitplaneCount } = config;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byteX = x >> 3;
      const bitShift = 7 - (x % 8);
      let colorIndex = 0;
      for (let plane = 0; plane < bitplaneCount; plane++) {
        const byteOffset = offset + bitplaneByteOffset(byteX, y, plane, config);
        const byte = data[byteOffset] ?? 0;
        const bit = (byte >> bitShift) & 1;
        colorIndex |= bit << plane;
      }
      out[y * width + x] = colorIndex;
    }
  }
  return out;
}

/**
 * Crop a rectangular region out of a row-major palette-index buffer
 * (e.g. one grid cell out of a decoded sprite-bank picture — see
 * `sprite-bank.ts`).
 */
export function cropIndices(
  indices: Uint8Array,
  sourceWidth: number,
  rect: { x: number; y: number; width: number; height: number },
): Uint8Array {
  const out = new Uint8Array(rect.width * rect.height);
  for (let row = 0; row < rect.height; row++) {
    const srcStart = (rect.y + row) * sourceWidth + rect.x;
    out.set(indices.subarray(srcStart, srcStart + rect.width), row * rect.width);
  }
  return out;
}
