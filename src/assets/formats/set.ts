/**
 * `.SET` world-map + picture container decoder (Phantasie III, Amiga).
 *
 * See docs/phantasie/graphics-formats.md §5. This is Phantasie III's
 * overworld map bundled with the terrain-art picture used to render it —
 * not a generic sprite sheet, despite sharing the `.cmp`/`.csh` family's
 * ST palette convention.
 *
 * The map array's byte -> terrain-panel semantics are an open hypothesis
 * (graphics-formats.md §5.3, TODO `gfx-set-map-semantics`) — this module
 * only decodes the confirmed container layout (header, map array, picture),
 * not any terrain interpretation of the map bytes.
 */

import { decodeBitplaneIndices, type BitplaneConfig } from './bitplane.ts';
import { decodePalette16, type RGB } from './palette.ts';

const HEADER_UNKNOWN_BYTE_OFFSET = 0x0000;
const HEADER_MAP_HEIGHT_OFFSET = 0x0001;
const HEADER_MAP_WIDTH_OFFSET = 0x0002;
const HEADER_PALETTE_OFFSET = 0x0003;
const HEADER_SIZE = 0x0023; // 1 (unknown) + 1 (height) + 1 (width) + 32 (palette)

export const SET_PICTURE_WIDTH = 320;
export const SET_PICTURE_HEIGHT = 200;
export const SET_PICTURE_BITPLANES = 4;

const PICTURE_CONFIG: BitplaneConfig = {
  width: SET_PICTURE_WIDTH,
  height: SET_PICTURE_HEIGHT,
  bitplaneCount: SET_PICTURE_BITPLANES,
  mode: 'interleaved',
  interleave: 2,
};

export interface SetFile {
  /** Meaning not identified — see graphics-formats.md §9. */
  unknownByte: number;
  mapWidth: number;
  mapHeight: number;
  palette: RGB[];
  /** Row-major, `cell[x,y]` at `y*mapWidth+x`. Byte semantics unconfirmed. */
  mapArray: Uint8Array;
  picture: { width: number; height: number; indices: Uint8Array };
}

const PICTURE_COLUMN_BLOCKS = 20; // 320 / 16 pixels-per-block
// The reference decoder's nominal per-block line bound (0..207) never
// actually completes — its own 32,000-byte-count break fires exactly at
// line 200 for the last column-block, since 20 * 200 * 8 = 32,000 exactly.
const PICTURE_LINES_PER_BLOCK = 200;
const PICTURE_BYTES_PER_COLUMN_BLOCK = 8; // x in 0..7

/**
 * Undo the `.SET` picture region's on-disk column-block-major byte order
 * (graphics-formats.md §5.2), producing the standard row-major (stride 160)
 * interleaved buffer that `decodeBitplaneIndices` expects.
 */
export function remapSetPictureBytes(raw: Uint8Array): Uint8Array {
  const bytesPerBlock = PICTURE_LINES_PER_BLOCK * PICTURE_BYTES_PER_COLUMN_BLOCK; // 1,600
  const buffer = new Uint8Array(raw.length);
  for (let p = 0; p < raw.length; p++) {
    const columnBlock = Math.floor(p / bytesPerBlock);
    const withinBlock = p % bytesPerBlock;
    const line = Math.floor(withinBlock / PICTURE_BYTES_PER_COLUMN_BLOCK);
    const x = withinBlock % PICTURE_BYTES_PER_COLUMN_BLOCK;
    const target = columnBlock * PICTURE_BYTES_PER_COLUMN_BLOCK + x + line * (PICTURE_COLUMN_BLOCKS * 8);
    buffer[target] = raw[p];
  }
  return buffer;
}

export function decodeSet(data: Uint8Array): SetFile {
  const unknownByte = data[HEADER_UNKNOWN_BYTE_OFFSET];
  const mapHeight = data[HEADER_MAP_HEIGHT_OFFSET];
  const mapWidth = data[HEADER_MAP_WIDTH_OFFSET];
  const palette = decodePalette16(data, HEADER_PALETTE_OFFSET, 'st');

  const mapOffset = HEADER_SIZE;
  const mapSize = mapWidth * mapHeight;
  const mapArray = data.slice(mapOffset, mapOffset + mapSize);

  // The 32,000 picture-data bytes are NOT already laid out in the target
  // interleaved buffer's row-major (stride-160) order on disk — they are
  // stored in an odd column-block-major order (graphics-formats.md §5.2:
  // "for column-block c in 0..19: for line in 0..199: for x in 0..7:
  // consume one byte", deposited at `buffer[c*8 + x + line*160]`). Remap
  // before handing off to the standard §1 Interleaved pixel formula.
  const pictureOffset = mapOffset + mapSize;
  const rawPictureBytes = data.subarray(pictureOffset, pictureOffset + 32000);
  const interleavedBuffer = remapSetPictureBytes(rawPictureBytes);
  const indices = decodeBitplaneIndices(interleavedBuffer, 0, PICTURE_CONFIG);

  return {
    unknownByte,
    mapWidth,
    mapHeight,
    palette,
    mapArray,
    picture: { width: SET_PICTURE_WIDTH, height: SET_PICTURE_HEIGHT, indices },
  };
}
