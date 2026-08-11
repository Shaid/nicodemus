/**
 * `.SET` world-map + picture container decoder (Phantasie III, Amiga).
 *
 * See docs/phantasie/graphics-formats.md §5. This is Phantasie III's
 * overworld map bundled with the terrain-art picture used to render it —
 * not a generic sprite sheet, despite sharing the `.cmp`/`.csh` family's
 * ST palette convention.
 *
 * **Map array byte -> terrain semantics (graphics-formats.md §5.3):
 * solved, code-traced.** Each map-cell byte is a **tile index into a
 * 250-entry bank of 16 x 16 x 4bpp tiles** that occupies the whole 32,000-
 * byte "picture" region (250 * 128 = 32,000 exactly). The tile blitter at
 * hunk-0 addr `0x3834` proves it instruction by instruction: it clamps the
 * value to 250 (`cmpi.w #$fa` / `move.w #$fa`), multiplies by 128
 * (`asl.w #7`), adds the `.set` picture-buffer pointer the loader stashed
 * in hunk-1 `$290C`, and then runs 16 iterations of "four consecutive
 * words -> the four screen bitplanes, advance one scanline". So a tile is
 * 16 rows x (plane0, plane1, plane2, plane3) words = 128 bytes, in the
 * standard Amiga interleaved-bitplane tile layout.
 *
 * This supersedes the earlier "the map byte is an X pixel-column index
 * into a 320x200 picture" reading. That hypothesis produced a plausible
 * continent silhouette only because both readings are monotone in the byte
 * value: the on-disk order is tile-major, and `remapSetPictureBytes`
 * happens to lay 12.5 consecutive tiles down each 16-pixel-wide column
 * strip of the 320x200 view, so "pixel column v" and "tile v" land in
 * neighbouring terrain regions. Rendering the map through the real tile
 * bank produces the actual game world (ocean, forest, mountain, desert,
 * roads and rivers, all as recognisable 16 x 16 art) rather than a
 * one-colour-per-cell approximation.
 *
 * `picture` (the 320x200 view) is retained because §5.2's byte-order fix
 * is a real, separately verified property of the file, and the 320x200
 * screen-format buffer is what the loader's `Read()` literally fills — but
 * it cuts a tile in half at every other column-strip boundary, so anything
 * that wants terrain art must use `tiles`, not `picture`.
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

/** Tile geometry the blitter at hunk-0 addr `0x3834` hardcodes. */
export const SET_TILE_WIDTH = 16;
export const SET_TILE_HEIGHT = 16;
/** 16 rows x 4 bitplane words — the `asl.w #7` stride at addr `0x3858`. */
export const SET_TILE_BYTES = 128;
/** 32,000 / 128 — and the blitter's own clamp ceiling (`cmpi.w #$fa`). */
export const SET_TILE_COUNT = 250;

export interface SetTileBank {
  count: number;
  tileWidth: number;
  tileHeight: number;
  /** Tile `t`'s pixel `(x, y)` at `(t * tileHeight + y) * tileWidth + x`. */
  indices: Uint8Array;
}

export interface SetFile {
  /** Read and discarded by the game — see graphics-formats.md §5.4. */
  unknownByte: number;
  mapWidth: number;
  mapHeight: number;
  palette: RGB[];
  /** Row-major, `cell[x,y]` at `y*mapWidth+x`; each byte a `tiles` index. */
  mapArray: Uint8Array;
  /** The real terrain art: 250 16x16 tiles the map array indexes into. */
  tiles: SetTileBank;
  /**
   * The same 32,000 bytes viewed as one 320x200x4bpp screen buffer. Faithful
   * to §5.2's byte order but NOT a coherent picture — see the module comment.
   */
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
  // `amigaFromSt`, not `st`: this is the Amiga port, whose one and only
  // palette path (`setPalette()`, PhantasieIII+0x11D6) doubles each 3-bit
  // ST nibble into an OCS 4-bit register before LoadRGB4. See
  // graphics-formats.md §2's 2026-08-11 correction block.
  const palette = decodePalette16(data, HEADER_PALETTE_OFFSET, 'amigaFromSt');

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
    tiles: decodeSetTiles(rawPictureBytes),
    picture: { width: SET_PICTURE_WIDTH, height: SET_PICTURE_HEIGHT, indices },
  };
}

/**
 * Split the `.set` picture region into the 250 16x16x4bpp terrain tiles the
 * blitter at hunk-0 addr `0x3834` consumes. Tile `t` starts at byte
 * `t * 128`; within it, row `r` is four big-endian plane words at
 * `+ r * 8`, and pixel `x` of that row is bit `15 - x` of each word, plane
 * 0 contributing the least-significant bit (the blitter writes the words to
 * screen bitplanes 0..3 in source order, plane strides 0/8000/16000/24000).
 */
export function decodeSetTiles(rawTileBank: Uint8Array): SetTileBank {
  const count = Math.floor(rawTileBank.length / SET_TILE_BYTES);
  const indices = new Uint8Array(count * SET_TILE_WIDTH * SET_TILE_HEIGHT);
  for (let tile = 0; tile < count; tile++) {
    const tileBase = tile * SET_TILE_BYTES;
    for (let row = 0; row < SET_TILE_HEIGHT; row++) {
      const rowBase = tileBase + row * 8;
      const p0 = (rawTileBank[rowBase] << 8) | rawTileBank[rowBase + 1];
      const p1 = (rawTileBank[rowBase + 2] << 8) | rawTileBank[rowBase + 3];
      const p2 = (rawTileBank[rowBase + 4] << 8) | rawTileBank[rowBase + 5];
      const p3 = (rawTileBank[rowBase + 6] << 8) | rawTileBank[rowBase + 7];
      const out = (tile * SET_TILE_HEIGHT + row) * SET_TILE_WIDTH;
      for (let x = 0; x < SET_TILE_WIDTH; x++) {
        const bit = 15 - x;
        indices[out + x] =
          ((p0 >> bit) & 1) | (((p1 >> bit) & 1) << 1) | (((p2 >> bit) & 1) << 2) | (((p3 >> bit) & 1) << 3);
      }
    }
  }
  return { count, tileWidth: SET_TILE_WIDTH, tileHeight: SET_TILE_HEIGHT, indices };
}

/**
 * The tile a map-cell byte selects. The blitter clamps at 250 rather than
 * 249 (`cmpi.w #$fa,$10(a5)` / `ble` / `move.w #$fa`), which would read one
 * tile past the bank — a real off-by-one in the original, unreachable in
 * practice because the shipped map array's values top out at 241. Clamped
 * to the last real tile here so callers can index `indices` safely.
 */
export function setTileIndexForMapValue(value: number, tileCount = SET_TILE_COUNT): number {
  const clamped = value > SET_TILE_COUNT ? SET_TILE_COUNT : value;
  return Math.min(Math.max(clamped, 0), tileCount - 1);
}

/**
 * Blit a grid of tile-index cells — any width/height, not just the
 * overworld's 50 x 75 — into one flat image. The same per-cell blit the
 * game's own tile blitter (hunk-0 addr `0x3834`) does, just for a whole
 * grid at once. Shared by the overworld renderer
 * (`tools/phantasieiii/build-map.ts`) and the castle/Netherworld plane
 * renderer (`tools/phantasieiii/build-castle-maps.ts`), which index the
 * same tile bank a `PLNn` file's cells reference (`pln.ts`'s module
 * comment has the byte-exact proof it's the same bank).
 */
export function renderTileGrid(
  tiles: SetTileBank,
  cells: ArrayLike<number>,
  gridWidth: number,
  gridHeight: number,
): { width: number; height: number; pixels: Uint8Array } {
  const width = gridWidth * tiles.tileWidth;
  const height = gridHeight * tiles.tileHeight;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const tile = setTileIndexForMapValue(cells[y * gridWidth + x], tiles.count);
      for (let row = 0; row < tiles.tileHeight; row++) {
        const src = (tile * tiles.tileHeight + row) * tiles.tileWidth;
        pixels.set(
          tiles.indices.subarray(src, src + tiles.tileWidth),
          (y * tiles.tileHeight + row) * width + x * tiles.tileWidth,
        );
      }
    }
  }
  return { width, height, pixels };
}

/**
 * Lay the tile bank out as a single sheet image, `columns` tiles per row —
 * the form the pipeline bakes to PNG and the viewer blits cells out of.
 */
export function renderSetTileSheet(
  bank: SetTileBank,
  columns: number,
): { width: number; height: number; indices: Uint8Array } {
  const rows = Math.ceil(bank.count / columns);
  const width = columns * bank.tileWidth;
  const height = rows * bank.tileHeight;
  const indices = new Uint8Array(width * height);
  for (let tile = 0; tile < bank.count; tile++) {
    const ox = (tile % columns) * bank.tileWidth;
    const oy = Math.floor(tile / columns) * bank.tileHeight;
    for (let row = 0; row < bank.tileHeight; row++) {
      const src = (tile * bank.tileHeight + row) * bank.tileWidth;
      indices.set(bank.indices.subarray(src, src + bank.tileWidth), (oy + row) * width + ox);
    }
  }
  return { width, height, indices };
}
