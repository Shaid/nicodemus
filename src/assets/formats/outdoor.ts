/**
 * Phantasie I **and II** outdoor-section decoder: `out*.dat` and the
 * `maps.int` container that holds a pristine copy of their terrain grids.
 *
 * See docs/phantasie/dungeon-format.md §8.2, §8.3 and §8.6. Every offset and
 * constant below is code-confirmed — against the Amiga `game` executable for
 * Phantasie I, and against the Atari ST `PHANT.PRG` for Phantasie II —
 * unless the comment says otherwise.
 *
 * An `out*.dat` file is one fixed-size record, read in a single `Read()`
 * into a single buffer (P1 `game+0x16F0A`, P2 `PHANT.PRG` addr `0x4B88`),
 * so file and buffer offsets agree:
 *
 * | Offset | Size  | Region                                    | P1 reader | P2 reader |
 * |--------|-------|-------------------------------------------|-----------|-----------|
 * | 0      | 520   | Terrain grid, 20 x 26                     | `game+0x16C7C` | `PHANT.PRG` addr `0x48E6` |
 * | 520    | 75    | Point-of-interest table, 15 x 5 B         | `game+0x18340` | addr `0x6528` |
 * | 595    | 400   | Text block, 10 slots x 40 B               | `game+0x18084` | addr `0x615E` |
 * | 995    | 5/505 | Pad / unexplained (P1: 5 B, P2: 505 B)    | — | — |
 * | 1000 (P1) / 1500 (P2) | | Map display list                | `game+0x17124` | addr `0x5028` |
 * | after  | rest  | Authoring residue, never read             | — | — |
 *
 * The grid/POI/text regions are **byte-identical between the two games**;
 * only the display-list offset (1000 vs 1500) and the total file size
 * (2,500 vs 3,000) differ.
 *
 * Both engines *write* these files back on every section exit
 * (P1 `game+0x184C6`, P2 addr `0x66C2`) — they are live save state, not
 * read-only assets. `maps.int` is the pristine master: N of the 520-byte
 * grids back to back, no header, no footer, in ordinal filename order
 * (P1: 18 blocks / 9,360 B; P2: 17 blocks / 8,840 B).
 *
 * Sections tile into a 4-wide world grid (`newSection = section - 4*dRow -
 * dCol`; P1 `game+0x184BA`, P2 addr `0x66BA` — byte-identical arithmetic)
 * with adjacent sections **sharing one row and one column**, giving strides
 * of 19 and 25. P1's 18 sections fill a 4 x 5 mosaic (77 x 126 cells);
 * P2's 17 sections are scattered over a 4 x 8 mosaic (77 x 201 cells).
 */

export const OUTDOOR_FILE_SIZE = 2500;
/** Phantasie II's record is 500 bytes longer (`#$BB8` at `PHANT.PRG` addr `0x4BA8`). */
export const OUTDOOR_FILE_SIZE_P2 = 3000;

export const OUTDOOR_SECTION_WIDTH = 20;
export const OUTDOOR_SECTION_HEIGHT = 26;
export const OUTDOOR_GRID_SIZE = OUTDOOR_SECTION_WIDTH * OUTDOOR_SECTION_HEIGHT; // 520

export const OUTDOOR_GRID_OFFSET = 0;
export const OUTDOOR_POI_OFFSET = 520;
export const OUTDOOR_TEXT_OFFSET = 595;
export const OUTDOOR_DISPLAY_LIST_OFFSET = 1000;
/** `buffer + 0x5DC` (`add.l #$5dc` at `PHANT.PRG` addr `0x531A`). */
export const OUTDOOR_DISPLAY_LIST_OFFSET_P2 = 1500;

export const OUTDOOR_POI_COUNT = 15;
export const OUTDOOR_POI_RECORD_SIZE = 5;

export const OUTDOOR_TEXT_LINE_COUNT = 10;
export const OUTDOOR_TEXT_LINE_SIZE = 40;

/** `maps.int` holds this many 520-byte section grids, in ordinal file order. */
export const WORLD_SECTION_COUNT = 18;
export const MAPS_INT_SIZE = WORLD_SECTION_COUNT * OUTDOOR_GRID_SIZE; // 9360

/**
 * `maps.int` block index -> section number. `maps.int` is packed by ordinal
 * over the files that exist, and neither `out17.dat` nor `out20.dat` ships,
 * so blocks 16 and 17 are sections 18 and 19 — **not** 17 and 18.
 */
export const SECTION_NUMBER_BY_BLOCK: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19,
];

/** World grid geometry, from `newSection = section - 4*dRow - dCol`. */
export const WORLD_COLUMNS = 4;
export const WORLD_ROWS = 5;
/** Adjacent sections share one column / one row, so the strides are w-1 / h-1. */
export const WORLD_SECTION_STRIDE_X = OUTDOOR_SECTION_WIDTH - 1; // 19
export const WORLD_SECTION_STRIDE_Y = OUTDOOR_SECTION_HEIGHT - 1; // 25
export const WORLD_WIDTH = WORLD_COLUMNS * WORLD_SECTION_STRIDE_X + 1; // 77
export const WORLD_HEIGHT = WORLD_ROWS * WORLD_SECTION_STRIDE_Y + 1; // 126

/**
 * Phantasie II ships 17 `OUT*.DAT` files, and `MAPS.INT` (8,840 bytes) is
 * 17 x 520 in the same ordinal order. The numbers are sparse: the mosaic is
 * still 4 columns wide (`asl.w #2` at `PHANT.PRG` addr `0x66D0`), but only
 * 17 of its 32 slots ship a file. Every section edge that faces an absent
 * slot is pure ocean (class 10) in 29 of 30 cases — see §8.6.3.
 */
export const SECTION_NUMBER_BY_BLOCK_P2: readonly number[] = [
  1, 2, 3, 5, 6, 7, 8, 11, 12, 17, 18, 22, 26, 27, 28, 30, 31,
];
export const WORLD_SECTION_COUNT_P2 = SECTION_NUMBER_BY_BLOCK_P2.length; // 17
export const MAPS_INT_SIZE_P2 = WORLD_SECTION_COUNT_P2 * OUTDOOR_GRID_SIZE; // 8840
export const WORLD_ROWS_P2 = 8;
export const WORLD_HEIGHT_P2 = WORLD_ROWS_P2 * WORLD_SECTION_STRIDE_Y + 1; // 201

/**
 * The two games differ only in the record size, the display-list offset and
 * the section roster; everything else in the format is byte-identical.
 */
export interface OutdoorLayout {
  /** Exact `out*.dat` record size. */
  fileSize: number;
  /** Offset of the map display list within the record. */
  displayListOffset: number;
  /** `maps.int` block index -> section number, in ordinal filename order. */
  sectionNumberByBlock: readonly number[];
  /** Exact `maps.int` size (`sectionNumberByBlock.length * 520`). */
  mapsIntSize: number;
  /** Mosaic rows the section numbers span. */
  worldRows: number;
  /** Assembled world height in cells. */
  worldHeight: number;
}

export const PHANTASIE1_OUTDOOR: OutdoorLayout = {
  fileSize: OUTDOOR_FILE_SIZE,
  displayListOffset: OUTDOOR_DISPLAY_LIST_OFFSET,
  sectionNumberByBlock: SECTION_NUMBER_BY_BLOCK,
  mapsIntSize: MAPS_INT_SIZE,
  worldRows: WORLD_ROWS,
  worldHeight: WORLD_HEIGHT,
};

export const PHANTASIE2_OUTDOOR: OutdoorLayout = {
  fileSize: OUTDOOR_FILE_SIZE_P2,
  displayListOffset: OUTDOOR_DISPLAY_LIST_OFFSET_P2,
  sectionNumberByBlock: SECTION_NUMBER_BY_BLOCK_P2,
  mapsIntSize: MAPS_INT_SIZE_P2,
  worldRows: WORLD_ROWS_P2,
  worldHeight: WORLD_HEIGHT_P2,
};

/**
 * Tile codes at or above this are "not yet explored"; the engine subtracts
 * it and writes the tile back when the party reveals a cell
 * (`subi.l #120` at `game+0x1752E`).
 */
export const TILE_UNEXPLORED_FLAG = 120;

/** `cmpi #40` at `game+0x18214` raises `"A TOWN.  ENTER?[YES|NO]"`. */
export const TILE_TOWN = 40;
/** `cmpi #100` at `game+0x17FBE` — ocean, refuses movement. */
export const TILE_OCEAN = 100;
/** Class 5 routes to event 13 (`game+0x1819A`); dungeon entrance, hypothesis. */
export const TILE_CLASS_DUNGEON = 5;

/** Ones digits that mark an event cell rather than a monster-group number. */
export const EVENT_VARIANT_TEXT = 6;
export const EVENT_VARIANT_BUMP = 7;
export const EVENT_VARIANT_NONE = 8;

export interface OutdoorPoi {
  /** Grid column, 0..19. */
  col: number;
  /** Grid row in **file** order, 0..25 (the engine compares `25 - engineRow`). */
  row: number;
  /** Message index for text features; a town/dungeon id for those classes. */
  index: number;
  /** Non-zero only on tile-class-5 records; meaning unidentified. */
  param: number;
  /** Zero in every non-residue record. */
  unused: number;
}

export interface DisplayListGroup {
  iconIndex: number;
  points: { x: number; y: number }[];
}

export interface OutdoorDisplayList {
  backgroundIconIndex: number;
  groups: DisplayListGroup[];
  /** File offset just past the `0xFFFF` terminator; residue starts here. */
  endOffset: number;
}

export interface OutdoorSection {
  /** 520 bytes, `cell[col,row]` at `row * 20 + col`, file row 0 = north. */
  grid: Uint8Array;
  /** Records with a non-zero (col,row) and in-range coordinates. */
  pois: OutdoorPoi[];
  /** All 15 raw records, including empty slots, in file order. */
  rawPois: OutdoorPoi[];
  /** All 10 slots; unused slots decode to an empty string. */
  textLines: string[];
  displayList: OutdoorDisplayList;
}

/** Strip the unexplored flag, giving the revealed tile code 0..119. */
export function revealedTileCode(code: number): number {
  return code % TILE_UNEXPLORED_FLAG;
}

export function isTileUnexplored(code: number): boolean {
  return code >= TILE_UNEXPLORED_FLAG;
}

/** `tile / 10` — the terrain class the engine stores at `h4+0x0C`. */
export function tileClass(code: number): number {
  return Math.floor(revealedTileCode(code) / 10);
}

/** `tile % 10` — monster-group number, or 6/7/8 for event cells (`h4+0x0E`). */
export function tileVariant(code: number): number {
  return revealedTileCode(code) % 10;
}

/** `(class + 1) * 75` for classes 0-3, else 60 (`game+0x18022`). */
export function tileMovementCost(code: number): number {
  const cls = tileClass(code);
  return cls <= 3 ? (cls + 1) * 75 : 60;
}

/**
 * True for the three dispatch paths that look a cell up in the POI table:
 * the variant 6/7/8 event arms (`game+0x18048`), the town prompt on tile 40
 * (`game+0x18214`), and the class-5 event (`game+0x1819A`).
 *
 * Across the 18 shipped sections this predicate selects exactly 99 cells and
 * the POI tables hold exactly 99 matching records, matching cell-for-cell —
 * see dungeon-format.md §8.2.2.
 *
 * The engine's *other* events are parameterless and carry no record: tile 41
 * raises event 9, class 7 raises `variant * 12 + 10`, class 10 event 10 and
 * class 11 event 8, all without consulting the table.
 */
export function hasPoiRecord(code: number): boolean {
  const variant = tileVariant(code);
  return (
    variant === EVENT_VARIANT_TEXT ||
    variant === EVENT_VARIANT_BUMP ||
    variant === EVENT_VARIANT_NONE ||
    revealedTileCode(code) === TILE_TOWN ||
    tileClass(code) === TILE_CLASS_DUNGEON
  );
}

/** Read `grid[row * 20 + col]` in file coordinates. */
export function tileAt(grid: Uint8Array, col: number, row: number): number {
  if (col < 0 || col >= OUTDOOR_SECTION_WIDTH || row < 0 || row >= OUTDOOR_SECTION_HEIGHT) {
    throw new RangeError(
      `tile (${col}, ${row}) outside the ${OUTDOOR_SECTION_WIDTH}x${OUTDOOR_SECTION_HEIGHT} section grid`,
    );
  }
  return grid[row * OUTDOOR_SECTION_WIDTH + col];
}

/**
 * The engine's own accessor: `byteOffset = (25 - engineRow) * 20 + col`
 * (`game+0x16C7C`). The engine's row counts north from the section's
 * southern edge, so it is the mirror of the file row.
 */
export function gridOffsetForEngineRow(col: number, engineRow: number): number {
  return (OUTDOOR_SECTION_HEIGHT - 1 - engineRow) * OUTDOOR_SECTION_WIDTH + col;
}

/**
 * Resolve a POI record's message index to text-block slot numbers
 * (`game+0x18084`): under 10 is one line, 10-19 is two lines from
 * `index - 10`, 20 and up is three lines from `index - 20`.
 */
export function messageSlotsForIndex(index: number): number[] {
  if (index < 10) return [index];
  if (index < 20) return [index - 10, index - 9];
  return [index - 20, index - 19, index - 18];
}

function decodeTextLine(data: Uint8Array, offset: number): string {
  const slot = data.subarray(offset, offset + OUTDOOR_TEXT_LINE_SIZE);
  let end = slot.length;
  for (let i = 0; i < slot.length; i++) {
    // NUL terminates a used slot; 0x0D is the filler byte in unused ones.
    if (slot[i] === 0x00 || slot[i] === 0x0d) {
      end = i;
      break;
    }
  }
  return new TextDecoder('ascii').decode(slot.subarray(0, end)).trim();
}

const DISPLAY_LIST_TERMINATOR = 0xffff;

function decodeDisplayList(data: Uint8Array, startOffset: number): OutdoorDisplayList {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = startOffset;
  const backgroundIconIndex = view.getUint16(p, false);
  p += 2;

  const groups: DisplayListGroup[] = [];
  for (;;) {
    if (p + 2 > data.length) throw new Error('outdoor display list ran past end of file');
    const count = view.getUint16(p, false);
    if (count === DISPLAY_LIST_TERMINATOR) {
      p += 2;
      break;
    }
    if (p + 4 + count * 4 > data.length) {
      throw new Error(`outdoor display list group at ${p} claims ${count} points, past end of file`);
    }
    const iconIndex = view.getUint16(p + 2, false);
    p += 4;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      points.push({ x: view.getUint16(p, false), y: view.getUint16(p + 2, false) });
      p += 4;
    }
    groups.push({ iconIndex, points });
  }
  return { backgroundIconIndex, groups, endOffset: p };
}

/** Decode one `out*.dat` file. Defaults to the Phantasie I layout. */
export function decodeOutdoorSection(
  data: Uint8Array,
  layout: OutdoorLayout = PHANTASIE1_OUTDOOR,
): OutdoorSection {
  if (data.length !== layout.fileSize) {
    throw new Error(`outdoor section must be ${layout.fileSize} bytes, got ${data.length}`);
  }

  const grid = data.slice(OUTDOOR_GRID_OFFSET, OUTDOOR_GRID_OFFSET + OUTDOOR_GRID_SIZE);

  const rawPois: OutdoorPoi[] = [];
  for (let i = 0; i < OUTDOOR_POI_COUNT; i++) {
    const at = OUTDOOR_POI_OFFSET + i * OUTDOOR_POI_RECORD_SIZE;
    rawPois.push({
      col: data[at],
      row: data[at + 1],
      index: data[at + 2],
      param: data[at + 3],
      unused: data[at + 4],
    });
  }
  const pois = rawPois.filter(
    (p) =>
      !(p.col === 0 && p.row === 0) &&
      p.col < OUTDOOR_SECTION_WIDTH &&
      p.row < OUTDOOR_SECTION_HEIGHT,
  );

  const textLines: string[] = [];
  for (let i = 0; i < OUTDOOR_TEXT_LINE_COUNT; i++) {
    textLines.push(decodeTextLine(data, OUTDOOR_TEXT_OFFSET + i * OUTDOOR_TEXT_LINE_SIZE));
  }

  return {
    grid,
    pois,
    rawPois,
    textLines,
    displayList: decodeDisplayList(data, layout.displayListOffset),
  };
}

/** Resolve a POI record's message to the text lines the engine would show. */
export function poiMessage(section: OutdoorSection, poi: OutdoorPoi): string[] {
  return messageSlotsForIndex(poi.index)
    .filter((slot) => slot >= 0 && slot < OUTDOOR_TEXT_LINE_COUNT)
    .map((slot) => section.textLines[slot]);
}

/** Split `maps.int` into its section grids, in ordinal file order. */
export function decodeMapsInt(
  data: Uint8Array,
  layout: OutdoorLayout = PHANTASIE1_OUTDOOR,
): Uint8Array[] {
  if (data.length !== layout.mapsIntSize) {
    throw new Error(`maps.int must be ${layout.mapsIntSize} bytes, got ${data.length}`);
  }
  const grids: Uint8Array[] = [];
  for (let i = 0; i < layout.sectionNumberByBlock.length; i++) {
    grids.push(data.slice(i * OUTDOOR_GRID_SIZE, (i + 1) * OUTDOOR_GRID_SIZE));
  }
  return grids;
}

export interface AssembledWorld {
  width: number;
  height: number;
  /** Row-major, `cell[x,y]` at `y * width + x`, revealed (flag-stripped) codes. */
  cells: Uint8Array;
}

/**
 * Assemble sections into the world grid (P1: 77 x 126, P2: 77 x 201).
 *
 * `grids` is keyed by `maps.int` block index; the section number (and hence
 * the world slot) comes from the layout's `sectionNumberByBlock`. Adjacent
 * sections share one column / one row, so later sections overwrite the
 * shared edge. Tile codes are flag-stripped so pre-revealed sections are
 * comparable with the rest; 98.2% of P1's 552 shared seam cells (sections
 * 1-16) and 99.5% of P2's 440 then agree on terrain class.
 */
export function assembleWorld(
  grids: readonly Uint8Array[],
  layout: OutdoorLayout = PHANTASIE1_OUTDOOR,
): AssembledWorld {
  const { sectionNumberByBlock, worldHeight } = layout;
  const cells = new Uint8Array(WORLD_WIDTH * worldHeight);
  for (let block = 0; block < grids.length && block < sectionNumberByBlock.length; block++) {
    const slot = sectionNumberByBlock[block] - 1;
    const originX = (slot % WORLD_COLUMNS) * WORLD_SECTION_STRIDE_X;
    const originY = Math.floor(slot / WORLD_COLUMNS) * WORLD_SECTION_STRIDE_Y;
    const grid = grids[block];
    for (let row = 0; row < OUTDOOR_SECTION_HEIGHT; row++) {
      for (let col = 0; col < OUTDOOR_SECTION_WIDTH; col++) {
        cells[(originY + row) * WORLD_WIDTH + (originX + col)] = revealedTileCode(
          grid[row * OUTDOOR_SECTION_WIDTH + col],
        );
      }
    }
  }
  return { width: WORLD_WIDTH, height: worldHeight, cells };
}
