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
 * Sections tile into a world grid 4 deep **north-south**
 * (`newSection = section - 4*dRow - dCol`; P1 `game+0x184BA`, P2 addr
 * `0x66BA` — byte-identical arithmetic) with adjacent sections **sharing
 * one row and one column**, giving strides of 25 (east-west) and 19
 * (north-south) — see `WORLD_SECTION_STRIDE_EW`'s doc comment for the full
 * axis derivation (dungeon-format.md §8.2.1/§8.3.2's 2026-08-11
 * correction; an earlier version of this file had the two axes swapped).
 * P1's 18 sections fill a 5-wide x 4-tall mosaic (126 x 77 cells); P2's 17
 * sections are scattered over an 8-wide x 4-tall mosaic (201 x 77 cells).
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

/**
 * World-assembly geometry, from `newSection = section - 4*dRow - dCol`
 * (`ChangeSection`, `game+0x184BA` / `PHANT.PRG` addr `0x66BA`, identical in
 * both games).
 *
 * **Axis correction (dungeon-format.md §8.2.1/§8.3.2, 2026-08-11):** `dCol`
 * steps a section by exactly ±1 and is **north-south**; `dRow` steps by ±4
 * and is **east-west** — the opposite of this module's own earlier
 * assumption. So within the flat section numbering, `(section-1) % 4` is
 * the north-south position inside one east-west "file" of 4 sections, and
 * `floor((section-1)/4)` is the east-west position, counting from the
 * **east** (section 1 is the easternmost; higher section numbers run west).
 * `ChangeSection`'s arrival-coordinate arms fix the sign: `section-4` is
 * the eastern neighbour, `section+4` western, `section-1` northern,
 * `section+1` southern.
 *
 * A section's own local grid is `OUTDOOR_SECTION_HEIGHT` (26) cells wide
 * **east-west** and `OUTDOOR_SECTION_WIDTH` (20) cells tall **north-south**
 * — those two constant names describe the *file's* row/column axes, not
 * compass directions (`OUTDOOR_SECTION_HEIGHT` is the east-west extent).
 * Adjacent sections share one edge, so the world strides are one less than
 * each extent. The north-south mosaic count is hardcoded by the engine's
 * `asl.w #2` (`*4`) and is therefore the same 4 for both games; only the
 * east-west count differs per game (`OutdoorLayout.worldSectionsEW`).
 */
export const WORLD_SECTION_STRIDE_EW = OUTDOOR_SECTION_HEIGHT - 1; // 25
export const WORLD_SECTION_STRIDE_NS = OUTDOOR_SECTION_WIDTH - 1; // 19
export const WORLD_SECTIONS_NS = 4;
export const WORLD_HEIGHT =
  (WORLD_SECTIONS_NS - 1) * WORLD_SECTION_STRIDE_NS + OUTDOOR_SECTION_WIDTH; // 77

/**
 * Phantasie II ships 17 `OUT*.DAT` files, and `MAPS.INT` (8,840 bytes) is
 * 17 x 520 in the same ordinal order. The numbers are sparse: the mosaic is
 * still 4 sections north-south (`asl.w #2` at `PHANT.PRG` addr `0x66D0`),
 * but only 17 of its 32 slots ship a file. Every section edge that faces an
 * absent slot is pure ocean (class 10) in 29 of 30 cases — see §8.6.3. The
 * missing east-west strip (mosaic index 3, sections 13-16) splits the
 * shipped sections into two separate landmasses, east and west — not a
 * north/south split, per the axis correction above.
 */
export const SECTION_NUMBER_BY_BLOCK_P2: readonly number[] = [
  1, 2, 3, 5, 6, 7, 8, 11, 12, 17, 18, 22, 26, 27, 28, 30, 31,
];
export const WORLD_SECTION_COUNT_P2 = SECTION_NUMBER_BY_BLOCK_P2.length; // 17
export const MAPS_INT_SIZE_P2 = WORLD_SECTION_COUNT_P2 * OUTDOOR_GRID_SIZE; // 8840
export const WORLD_SECTIONS_EW_P2 = 8;
export const WORLD_WIDTH_P2 =
  (WORLD_SECTIONS_EW_P2 - 1) * WORLD_SECTION_STRIDE_EW + OUTDOOR_SECTION_HEIGHT; // 201

export const WORLD_SECTIONS_EW_P1 = 5;
export const WORLD_WIDTH_P1 =
  (WORLD_SECTIONS_EW_P1 - 1) * WORLD_SECTION_STRIDE_EW + OUTDOOR_SECTION_HEIGHT; // 126

/**
 * The two games differ only in the record size, the display-list offset,
 * the section roster and how far the roster extends east-west; everything
 * else in the format is byte-identical.
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
  /** Mosaic columns east-west the section numbers span (game-specific). */
  worldSectionsEW: number;
  /** Assembled world width in cells (east-west; north-south is the fixed `WORLD_HEIGHT`). */
  worldWidth: number;
  /**
   * Byte offset of the twelve-entry terrain icon bank **within that game's
   * own executable** (`game` for P1, `PHANT.PRG` for P2). Both are
   * `iconIndex * 128 + base`, plane-major 16 x 16 x 4bpp — see §8.2.4a /
   * §8.6.8.
   */
  iconBankOffset: number;
  /** English name per terrain class, indexed by class (0-11). */
  terrainClassNames: readonly string[];
}

/**
 * The outdoor terrain-icon bank in the Phantasie I `game` executable:
 * DATA hunk 69 `+0x294`, i.e. file offset `0x196BC`. The display list's
 * `iconIndex` is scaled by 128 (`asl.l #7` at `game+0x1713C`) and added to
 * this base.
 */
export const OUTDOOR_ICON_BANK_OFFSET = 0x196bc;

/**
 * The same bank in Phantasie II's `PHANT.PRG`: address `0x21DD6`, i.e. file
 * offset `0x21DF2` (GEMDOS 28-byte header). The group draw routine at addr
 * `0x545A` does `ext.l d0; asl.l #7; add.l #$21DD6` and hands the result to
 * VDI `vsf_udpat(handle, pattern, 4)` — see dungeon-format.md §8.6.8.
 *
 * Nine of the twelve entries are **byte-identical** to P1's bank at exactly
 * the offsets this base predicts, which is what confirms base, stride,
 * ordering and plane layout all at once.
 */
export const OUTDOOR_ICON_BANK_OFFSET_P2 = 0x21df2;

/**
 * English names for Phantasie I's twelve terrain classes
 * (dungeon-format.md §8.3.3a). Confirmed from three agreeing oracles: the
 * class's own rendered icon, the movement-cost ramp at `game+0x18022`, and
 * the Phantasie I rulebook's terrain key. Classes 4 and 5 have no icon —
 * they are drawn as the town/inn and dungeon markers instead
 * (`game+0x1702C`).
 */
export const TERRAIN_CLASS_NAMES: readonly string[] = [
  'Grassland',
  'Forest',
  'Hills',
  'Mountains',
  'Town',
  'Dungeon',
  'Path',
  'Mist',
  'Desert',
  'Desert',
  'Ocean',
  'Lake',
];

/**
 * Phantasie II's twelve classes (dungeon-format.md §8.6.8a). Classes
 * 0-6, 9 and 10 keep P1's names because their bank entries are
 * byte-identical and P2's movement-cost ramp (addr `0x6110`) is
 * instruction-for-instruction P1's. Classes 7, 8 and 11 are P2's three
 * **new** terrains, which the shared rulebook's "NEW TERRAIN FEATURES"
 * section names as exactly Molten Lava, Mist and Dark Voids.
 */
export const TERRAIN_CLASS_NAMES_P2: readonly string[] = [
  'Grassland',
  'Forest',
  'Hills',
  'Mountains',
  'Town',
  'Dungeon',
  'Path',
  'Dark Void',
  'Molten Lava',
  'Desert',
  'Ocean',
  'Mist',
];

export const PHANTASIE1_OUTDOOR: OutdoorLayout = {
  fileSize: OUTDOOR_FILE_SIZE,
  displayListOffset: OUTDOOR_DISPLAY_LIST_OFFSET,
  sectionNumberByBlock: SECTION_NUMBER_BY_BLOCK,
  mapsIntSize: MAPS_INT_SIZE,
  worldSectionsEW: WORLD_SECTIONS_EW_P1,
  worldWidth: WORLD_WIDTH_P1,
  iconBankOffset: OUTDOOR_ICON_BANK_OFFSET,
  terrainClassNames: TERRAIN_CLASS_NAMES,
};

export const PHANTASIE2_OUTDOOR: OutdoorLayout = {
  fileSize: OUTDOOR_FILE_SIZE_P2,
  displayListOffset: OUTDOOR_DISPLAY_LIST_OFFSET_P2,
  sectionNumberByBlock: SECTION_NUMBER_BY_BLOCK_P2,
  mapsIntSize: MAPS_INT_SIZE_P2,
  worldSectionsEW: WORLD_SECTIONS_EW_P2,
  worldWidth: WORLD_WIDTH_P2,
  iconBankOffset: OUTDOOR_ICON_BANK_OFFSET_P2,
  terrainClassNames: TERRAIN_CLASS_NAMES_P2,
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
 * Assemble sections into the north-up world grid (P1: 126 x 77,
 * P2: 201 x 77 — width is east-west and varies per game; height is
 * north-south and is always 77, since both games stack sections 4 deep
 * north-south).
 *
 * `grids` is keyed by `maps.int` block index; the section number (and hence
 * the world slot) comes from the layout's `sectionNumberByBlock`.
 * `(section-1) % 4` is the north-south mosaic index (0 = north),
 * `floor((section-1)/4)` the east-west index (0 = east — see
 * `WORLD_SECTION_STRIDE_EW`'s doc comment). Within a section, file column
 * `col` (0-19) is the north-south offset and file row `fileRow` (0-25)
 * maps to the east-west offset as `25 - fileRow` (higher file row is
 * further west). Adjacent sections share one edge, so later sections
 * overwrite the shared cells. Tile codes are flag-stripped so pre-revealed
 * sections are comparable with the rest; 98.2% of P1's 552 shared seam
 * cells (sections 1-16) and 99.5% of P2's 440 then agree on terrain class.
 */
export function assembleWorld(
  grids: readonly Uint8Array[],
  layout: OutdoorLayout = PHANTASIE1_OUTDOOR,
): AssembledWorld {
  const { sectionNumberByBlock, worldSectionsEW, worldWidth } = layout;
  const cells = new Uint8Array(worldWidth * WORLD_HEIGHT);
  for (let block = 0; block < grids.length && block < sectionNumberByBlock.length; block++) {
    const slot = sectionNumberByBlock[block] - 1;
    const ewIndex = Math.floor(slot / WORLD_SECTIONS_NS);
    const nsIndex = slot % WORLD_SECTIONS_NS;
    const originX = (worldSectionsEW - 1 - ewIndex) * WORLD_SECTION_STRIDE_EW;
    const originY = nsIndex * WORLD_SECTION_STRIDE_NS;
    const grid = grids[block];
    for (let fileRow = 0; fileRow < OUTDOOR_SECTION_HEIGHT; fileRow++) {
      const localX = OUTDOOR_SECTION_HEIGHT - 1 - fileRow;
      for (let col = 0; col < OUTDOOR_SECTION_WIDTH; col++) {
        cells[(originY + col) * worldWidth + (originX + localX)] = revealedTileCode(
          grid[fileRow * OUTDOOR_SECTION_WIDTH + col],
        );
      }
    }
  }
  return { width: worldWidth, height: WORLD_HEIGHT, cells };
}

// ---------------------------------------------------------------------------
// Outdoor icon bank and section rendering — dungeon-format.md §8.2.4a
// ---------------------------------------------------------------------------

/**
 * Each entry is a `graphics.library` **multi-coloured area-fill pattern**,
 * not a sprite: the two draw routines set `rp->AreaPtrn = iconAddress` and
 * `rp->AreaPtSz = -4` (`game+0x1F392`/`0x1F39A`), and a negative
 * `AreaPtSz` means `2^4 = 16` rows per plane, 16 pixels wide, one 16-word
 * block per bitplane with the planes stored consecutively.
 *
 * Phantasie II reaches the identical byte layout through the Atari ST's own
 * GEM VDI instead: `vsf_udpat(handle, pattern, planes = 4)` (VDI opcode
 * 112, wrapper at `PHANT.PRG` addr `0x1A3C6`) with the workstation opened
 * at interior style `FIS_USER` (`work_in[7] = 4`, addr `0x52C6`). A VDI
 * multi-plane user fill pattern is `16 * planes` words, 16 words per plane,
 * planes consecutive — the same 128 bytes, same order.
 */
export const OUTDOOR_ICON_WIDTH = 16;
export const OUTDOOR_ICON_HEIGHT = 16;
export const OUTDOOR_ICON_PLANES = 4;
export const OUTDOOR_ICON_SIZE =
  (OUTDOOR_ICON_WIDTH / 8) * OUTDOOR_ICON_HEIGHT * OUTDOOR_ICON_PLANES; // 128

/** Indices 0-11 — one per terrain class; nothing in any display list exceeds 11. */
export const OUTDOOR_ICON_COUNT = 12;

/**
 * `P1_PALETTE_SLOT_OFFSETS[2]` (file `0x1949C`, hunk 69 `+0x74`) is the
 * world-map palette: the only two `SetPalette` call sites in the
 * world-map hunk are `pea $74.l` at `game+0x16FB8` and `game+0x1793E`.
 */
export const OUTDOOR_PALETTE_SLOT = 2;

/**
 * Decode one 16 x 16 icon to palette indices (row-major, 256 entries).
 * `gameExe` is the whole executable — Phantasie I's `game` (the default
 * bank offset) or Phantasie II's `PHANT.PRG` (pass
 * `OUTDOOR_ICON_BANK_OFFSET_P2`).
 */
export function decodeOutdoorIcon(
  gameExe: Uint8Array,
  index: number,
  bankOffset: number = OUTDOOR_ICON_BANK_OFFSET,
): Uint8Array {
  if (index < 0 || !Number.isInteger(index)) {
    throw new RangeError(`outdoor icon index must be a non-negative integer, got ${index}`);
  }
  const base = bankOffset + index * OUTDOOR_ICON_SIZE;
  if (base + OUTDOOR_ICON_SIZE > gameExe.length) {
    throw new RangeError(`outdoor icon ${index} runs past the end of the executable`);
  }
  const planeStride = (OUTDOOR_ICON_WIDTH / 8) * OUTDOOR_ICON_HEIGHT; // 32
  const pixels = new Uint8Array(OUTDOOR_ICON_WIDTH * OUTDOOR_ICON_HEIGHT);
  for (let plane = 0; plane < OUTDOOR_ICON_PLANES; plane++) {
    for (let y = 0; y < OUTDOOR_ICON_HEIGHT; y++) {
      const at = base + plane * planeStride + y * 2;
      const word = (gameExe[at] << 8) | gameExe[at + 1];
      for (let x = 0; x < OUTDOOR_ICON_WIDTH; x++) {
        if (word & (0x8000 >> x)) pixels[y * OUTDOOR_ICON_WIDTH + x] |= 1 << plane;
      }
    }
  }
  return pixels;
}

/** Decode all 12 icons, indexed by terrain class. */
export function decodeOutdoorIconBank(
  gameExe: Uint8Array,
  bankOffset: number = OUTDOOR_ICON_BANK_OFFSET,
): Uint8Array[] {
  const icons: Uint8Array[] = [];
  for (let i = 0; i < OUTDOOR_ICON_COUNT; i++) {
    icons.push(decodeOutdoorIcon(gameExe, i, bankOffset));
  }
  return icons;
}

export function terrainClassName(
  code: number,
  names: readonly string[] = TERRAIN_CLASS_NAMES,
): string {
  return names[tileClass(code)] ?? `Class ${tileClass(code)}`;
}

/**
 * Map-display geometry, all from `game+0x173B0`, which stores the four
 * words that `MarkerRect()` (`game+0x16EB8`) multiplies by:
 * `x = fileRow * 12 + 4`, `y = col * 9 + 15`. The background rectangle the
 * same routine builds is `(4, 15, 312, 180)` — and `312 = 26 * 12`,
 * `180 = 20 * 9`, which is what fixes the axis assignment (§8.2.1).
 */
export const OUTDOOR_CELL_WIDTH = 12;
export const OUTDOOR_CELL_HEIGHT = 9;
export const OUTDOOR_MAP_ORIGIN_X = 4;
export const OUTDOOR_MAP_ORIGIN_Y = 15;
export const OUTDOOR_MAP_WIDTH = OUTDOOR_SECTION_HEIGHT * OUTDOOR_CELL_WIDTH; // 312
export const OUTDOOR_MAP_HEIGHT = OUTDOOR_SECTION_WIDTH * OUTDOOR_CELL_HEIGHT; // 180

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Screen rectangle of one grid cell, in the same coordinate space the
 * display list's polygon points use. `fileRow` is the east-west index
 * (0 = the section's *eastern* edge) and `col` the north-south one
 * (0 = north) — see §8.2.1's 2026-08-11 correction.
 *
 * `MarkerRect()` is written in terms of the **engine** row, so the flip
 * `engineRow = 25 - fileRow` belongs here: screen x grows eastward, and
 * file row 0 is the eastern edge.
 */
export function cellScreenRect(fileRow: number, col: number): ScreenRect {
  return {
    x:
      (OUTDOOR_SECTION_HEIGHT - 1 - fileRow) * OUTDOOR_CELL_WIDTH + OUTDOOR_MAP_ORIGIN_X,
    y: col * OUTDOOR_CELL_HEIGHT + OUTDOOR_MAP_ORIGIN_Y,
    w: OUTDOOR_CELL_WIDTH,
    h: OUTDOOR_CELL_HEIGHT,
  };
}

/** Raster of terrain-class indices; `-1` where nothing was painted. */
export interface OutdoorRaster {
  width: number;
  height: number;
  /** Row-major `iconIndex` per pixel, `-1` outside the map rectangle. */
  icons: Int16Array;
}

function fillPolygon(
  icons: Int16Array,
  width: number,
  height: number,
  points: readonly { x: number; y: number }[],
  value: number,
  drawPerimeter: boolean,
): void {
  const n = points.length;
  if (n === 0) return;
  const put = (x: number, y: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) icons[y * width + x] = value;
  };
  if (n === 1) {
    put(points[0].x, points[0].y);
    return;
  }
  // Even-odd scanline fill, matching graphics.library's AreaEnd().
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const crossings: number[] = [];
  for (let y = Math.max(0, minY); y <= Math.min(height - 1, maxY); y++) {
    crossings.length = 0;
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      if (a.y === b.y) continue;
      if (y >= Math.min(a.y, b.y) && y < Math.max(a.y, b.y)) {
        crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.max(0, Math.round(crossings[i]));
      const to = Math.min(width - 1, Math.round(crossings[i + 1]));
      for (let x = from; x <= to; x++) icons[y * width + x] = value;
    }
  }
  // AreaMove/AreaDraw paint the outline too — but only on P1. Phantasie II
  // opens its workstation with `vsf_perimeter(handle, 0)` (VDI opcode 104,
  // wrapper at `PHANT.PRG` addr `0x1A38C`, called with 0 at addr `0x52F4`),
  // so its `v_fillarea` polygons have no outline at all.
  if (!drawPerimeter) return;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      put(Math.round(a.x + t * (b.x - a.x)), Math.round(a.y + t * (b.y - a.y)));
    }
  }
}

/**
 * Replay a section's display list into a raster of terrain-class indices,
 * reproducing `game+0x17124`: `RectFill` the map rectangle with the
 * background icon, then `AreaMove`/`AreaDraw`/`AreaEnd` each group as one
 * filled polygon, in list order.
 *
 * The result is *indices*, not pixels — `renderOutdoorSection()` turns it
 * into palette indices by tiling each class's 16 x 16 pattern.
 */
export function rasteriseOutdoorSection(
  section: OutdoorSection,
  width = 336,
  height = 208,
  drawPerimeter = true,
): OutdoorRaster {
  const icons = new Int16Array(width * height).fill(-1);
  for (let y = OUTDOOR_MAP_ORIGIN_Y; y < OUTDOOR_MAP_ORIGIN_Y + OUTDOOR_MAP_HEIGHT; y++) {
    if (y >= height) break;
    for (let x = OUTDOOR_MAP_ORIGIN_X; x < OUTDOOR_MAP_ORIGIN_X + OUTDOOR_MAP_WIDTH; x++) {
      if (x >= width) break;
      icons[y * width + x] = section.displayList.backgroundIconIndex;
    }
  }
  for (const group of section.displayList.groups) {
    fillPolygon(icons, width, height, group.points, group.iconIndex, drawPerimeter);
  }
  return { width, height, icons };
}

/**
 * Render a section to palette indices. The area pattern is aligned to the
 * RastPort origin, not to the polygon, so a pixel takes
 * `icon[y mod 16][x mod 16]` — which is why cell boundaries are invisible
 * in the real game's map.
 */
export function renderOutdoorSection(
  section: OutdoorSection,
  icons: readonly Uint8Array[],
  width = 336,
  height = 208,
  drawPerimeter = true,
): { width: number; height: number; pixels: Uint8Array } {
  const raster = rasteriseOutdoorSection(section, width, height, drawPerimeter);
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const icon = raster.icons[y * width + x];
      if (icon < 0 || icon >= icons.length) continue;
      pixels[y * width + x] =
        icons[icon][(y % OUTDOOR_ICON_HEIGHT) * OUTDOOR_ICON_WIDTH + (x % OUTDOOR_ICON_WIDTH)];
    }
  }
  return { width, height, pixels };
}
