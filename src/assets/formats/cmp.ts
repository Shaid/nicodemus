/**
 * `.CMP` / `.CSH` RLE-compressed bitmap decoder (Phantasie III, Amiga).
 *
 * See docs/phantasie/graphics-formats.md §4. `.CSH` is byte-for-byte the
 * same container format as `.CMP` — both are handled by this module.
 *
 * **A file's own header palette is not always the palette it renders
 * under.** `PhantasieIII`'s loader parks every `.cmp` header palette in one
 * shared global and the *caller* decides what to do with it; six of the
 * seven sprite banks never get theirs installed at all. Pass
 * `options.palette` for those. Full evidence: graphics-formats.md §4.5.
 */

import { bitplaneByteOffset, decodeBitplaneIndices, type BitplaneConfig } from './bitplane.ts';
import { decodePalette16, indicesToRGBA, type RGB } from './palette.ts';

export const CMP_WIDTH = 320;
export const CMP_HEIGHT = 200;
export const CMP_BITPLANES = 4;
export const CMP_INTERLEAVE = 2;
/** One strip == one full bitplane's worth of bytes: width/8 * height. */
export const CMP_STRIP_SIZE = (CMP_WIDTH / 8) * CMP_HEIGHT;
export const CMP_BUFFER_SIZE = CMP_STRIP_SIZE * CMP_BITPLANES;

const HEADER_PALETTE_OFFSET = 0x0000;
const HEADER_COMPRESSED_SIZE_OFFSET = 0x0020;
const HEADER_TYPE_OFFSET = 0x0022;
const HEADER_RLE_STREAM_OFFSET = 0x0023;

const BITPLANE_CONFIG: BitplaneConfig = {
  width: CMP_WIDTH,
  height: CMP_HEIGHT,
  bitplaneCount: CMP_BITPLANES,
  mode: 'interleaved',
  interleave: CMP_INTERLEAVE,
};

/** Vertical (2) fills a column of 200 lines before moving to the next byte
 *  column; horizontal (1) fills a row of 40 byte-columns before moving to
 *  the next line. See graphics-formats.md §4.3. */
export type CmpInterleaveType = 1 | 2;

export interface CmpImage {
  width: number;
  height: number;
  /**
   * The palette this image is actually displayed under. Equal to
   * `headerPalette` unless a caller supplied an override — which the
   * monster/race sprite banks require, since the game never installs their
   * own header palettes (see `decodeCmp`'s doc comment and
   * graphics-formats.md §4.5).
   */
  palette: RGB[];
  /** The file's own 32-byte header palette, always decoded, regardless of
   *  whether the game ever installs it. */
  headerPalette: RGB[];
  /** One palette-index byte per pixel, row-major. */
  indices: Uint8Array;
  interleaveType: CmpInterleaveType;
  /** Bytes of RLE stream actually consumed — for cross-checking against the
   *  header's declared compressed-data size (compressedSize - 1). */
  rleBytesConsumed: number;
}

/** Sequential big-endian byte/word reader over a fixed buffer + start offset. */
class ByteStreamReader {
  private readonly data: Uint8Array;
  private readonly start: number;
  private pos: number;
  constructor(data: Uint8Array, start: number) {
    this.data = data;
    this.start = start;
    this.pos = start;
  }
  readU8(): number {
    return this.data[this.pos++];
  }
  readU16BE(): number {
    const v = (this.data[this.pos] << 8) | this.data[this.pos + 1];
    this.pos += 2;
    return v;
  }
  get bytesConsumed(): number {
    return this.pos - this.start;
  }
}

/**
 * Decompress one 8,000-byte strip (one bitplane) of RLE data into `buffer`
 * (the shared 32,000-byte interleaved output buffer), using the byte-order
 * for the given submode. Byte-for-byte match to graphics-formats.md §4.2's
 * opcode semantics; the (byteX, line) traversal order for each submode
 * (§4.3) is expressed here as two nested-loop orderings over the same
 * `bitplaneByteOffset` formula used to *read* the finished buffer (§1),
 * rather than as a literal register-increment translation — both orderings
 * visit every one of the strip's 8,000 (byteX, line) positions exactly
 * once, which is the only property the final image depends on.
 */
function decompressStrip(
  reader: ByteStreamReader,
  plane: number,
  buffer: Uint8Array,
  type: CmpInterleaveType,
): void {
  const rowBytes = CMP_WIDTH / 8; // 40 byte-columns per line
  let byteX = 0;
  let line = 0;
  let written = 0;

  const advance = () => {
    if (type === 2) {
      // Vertical: walk down a byte-column before moving to the next one.
      line++;
      if (line >= CMP_HEIGHT) {
        line = 0;
        byteX++;
      }
    } else {
      // Horizontal: walk across a line before moving to the next one.
      byteX++;
      if (byteX >= rowBytes) {
        byteX = 0;
        line++;
      }
    }
  };

  while (written < CMP_STRIP_SIZE) {
    const opcode = reader.readU8();
    let runLength: number;
    let repeatByte: boolean;
    if (opcode === 0) {
      runLength = reader.readU16BE();
      repeatByte = true;
    } else if (opcode >= 0x80) {
      runLength = 256 - opcode;
      repeatByte = true;
    } else {
      runLength = opcode;
      repeatByte = false;
    }

    let value = 0;
    let first = true;
    for (let k = 0; k < runLength; k++) {
      if (first || !repeatByte) {
        value = reader.readU8();
        first = false;
      }
      const offset = bitplaneByteOffset(byteX, line, plane, BITPLANE_CONFIG);
      buffer[offset] = value;
      written++;
      if (written < CMP_STRIP_SIZE) advance();
    }
  }
}

/**
 * Decompress the RLE stream into the raw 32,000-byte interleaved bitplane
 * buffer (before pixel assembly). Exposed separately from `decodeCmp` so
 * the byte-level RLE algorithm can be tested independently of palette
 * lookup / bitplane pixel assembly.
 */
export function decompressCmpBuffer(
  data: Uint8Array,
  rleStreamOffset: number,
  type: CmpInterleaveType,
): { buffer: Uint8Array; bytesConsumed: number } {
  const buffer = new Uint8Array(CMP_BUFFER_SIZE);
  const reader = new ByteStreamReader(data, rleStreamOffset);
  for (let plane = 0; plane < CMP_BITPLANES; plane++) {
    decompressStrip(reader, plane, buffer, type);
  }
  return { buffer, bytesConsumed: reader.bytesConsumed };
}

/**
 * Read just the 32-byte header palette of a `.cmp`/`.csh` file, without
 * decompressing it. Cheap enough to call on `heros.cmp` purely to obtain
 * the encounter palette every sprite bank renders under
 * (`P3_ENCOUNTER_PALETTE_BANK` in `sprite-bank.ts`).
 */
export function decodeCmpHeaderPalette(data: Uint8Array): RGB[] {
  return decodePalette16(data, HEADER_PALETTE_OFFSET, 'amigaFromSt');
}

export interface DecodeCmpOptions {
  /**
   * Render under this palette instead of the file's own header palette.
   *
   * Required for the six non-`heros` sprite banks: `PhantasieIII` parks
   * every loaded `.cmp`'s header palette in one shared 32-byte global
   * (`palScratch`, DATA hunk `+0x2AEE`), and only banks 0/1/2 get theirs
   * copied out to a slot afterwards — of which **only slot 0 (heros.cmp)
   * is ever installed**. See graphics-formats.md §4.5.
   */
  palette?: RGB[];
}

/** Decode a full `.cmp`/`.csh` file into a palette + palette-index image. */
export function decodeCmp(data: Uint8Array, options: DecodeCmpOptions = {}): CmpImage {
  const headerPalette = decodeCmpHeaderPalette(data);
  const palette = options.palette ?? headerPalette;
  const compressedSize =
    (data[HEADER_COMPRESSED_SIZE_OFFSET] << 8) | data[HEADER_COMPRESSED_SIZE_OFFSET + 1];
  const type = data[HEADER_TYPE_OFFSET];
  if (type !== 1 && type !== 2) {
    throw new Error(`Unknown CMP interleave type byte: ${type} (expected 1 or 2)`);
  }

  const { buffer, bytesConsumed } = decompressCmpBuffer(data, HEADER_RLE_STREAM_OFFSET, type);

  // Structural cross-check: the header declares compressedSize counting
  // from the type byte inclusive, so the RLE stream itself should be
  // exactly compressedSize - 1 bytes (graphics-formats.md §4.1).
  const expectedRleBytes = compressedSize - 1;
  if (bytesConsumed !== expectedRleBytes) {
    throw new Error(
      `CMP RLE stream length mismatch: consumed ${bytesConsumed} bytes, ` +
        `header declares ${expectedRleBytes} (compressedSize=${compressedSize})`,
    );
  }

  const indices = decodeBitplaneIndices(buffer, 0, BITPLANE_CONFIG);
  return {
    width: CMP_WIDTH,
    height: CMP_HEIGHT,
    palette,
    headerPalette,
    indices,
    interleaveType: type,
    rleBytesConsumed: bytesConsumed,
  };
}

export function cmpToRGBA(image: CmpImage): Uint8Array {
  return indicesToRGBA(image.indices, image.palette, false);
}
