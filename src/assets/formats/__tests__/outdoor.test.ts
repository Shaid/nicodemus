import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  MAPS_INT_SIZE,
  OUTDOOR_FILE_SIZE,
  OUTDOOR_GRID_SIZE,
  OUTDOOR_SECTION_HEIGHT,
  OUTDOOR_SECTION_WIDTH,
  SECTION_NUMBER_BY_BLOCK,
  TILE_CLASS_DUNGEON,
  TILE_OCEAN,
  TILE_TOWN,
  TILE_UNEXPLORED_FLAG,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  assembleWorld,
  decodeMapsInt,
  decodeOutdoorSection,
  gridOffsetForEngineRow,
  hasPoiRecord,
  isTileUnexplored,
  messageSlotsForIndex,
  poiMessage,
  revealedTileCode,
  tileAt,
  tileClass,
  tileMovementCost,
  tileVariant,
} from '../outdoor.ts';

const DATA_DIR = resolve('data/phantasie/amiga');
const readData = (name: string) => new Uint8Array(readFileSync(resolve(DATA_DIR, name)));

/** Ordinal order — there is no `out17.dat`, and no `maps.int` block for one. */
const OUT_FILES = [...Array.from({ length: 16 }, (_, i) => `out${i + 1}.dat`), 'out18.dat', 'out19.dat'];

describe('maps.int — the concatenated master world map (dungeon-format.md §8.3.1)', () => {
  it('is exactly 18 section grids of 520 bytes, with no header or footer', () => {
    const mapsInt = readData('maps.int');
    expect(mapsInt.length).toBe(9360);
    expect(mapsInt.length).toBe(MAPS_INT_SIZE);
    expect(18 * OUTDOOR_GRID_SIZE).toBe(9360);
    expect(decodeMapsInt(mapsInt)).toHaveLength(18);
  });

  it('block k is byte-identical to the k-th out*.dat grid, all 18, zero mismatches', () => {
    const grids = decodeMapsInt(readData('maps.int'));
    const mismatches: string[] = [];
    OUT_FILES.forEach((name, block) => {
      const fileGrid = readData(name).subarray(0, OUTDOOR_GRID_SIZE);
      if (!grids[block].every((b, i) => b === fileGrid[i])) mismatches.push(name);
    });
    expect(mismatches).toEqual([]);
  });

  it('maps block 16/17 to sections 18/19, not 17/18', () => {
    expect(SECTION_NUMBER_BY_BLOCK).toHaveLength(18);
    expect(SECTION_NUMBER_BY_BLOCK[15]).toBe(16);
    expect(SECTION_NUMBER_BY_BLOCK[16]).toBe(18);
    expect(SECTION_NUMBER_BY_BLOCK[17]).toBe(19);
  });
});

describe('out*.dat region layout (dungeon-format.md §8.2)', () => {
  it('is 2500 bytes and its four decoded regions abut exactly', () => {
    for (const name of OUT_FILES) {
      const data = readData(name);
      expect(data.length, name).toBe(OUTDOOR_FILE_SIZE);
      const section = decodeOutdoorSection(data);
      expect(section.grid.length, name).toBe(520);
      expect(section.rawPois.length, name).toBe(15);
      expect(section.textLines.length, name).toBe(10);
    }
    // 520 grid + 15*5 records + 10*40 lines = 995, then 5 pad, then the list.
    expect(520 + 15 * 5 + 10 * 40).toBe(995);
  });

  it('parses a display list terminated inside the file in every section', () => {
    for (const name of OUT_FILES) {
      const { displayList } = decodeOutdoorSection(readData(name));
      expect(displayList.backgroundIconIndex, name).toBe(10);
      expect(displayList.groups.length, name).toBeGreaterThan(0);
      expect(displayList.endOffset, name).toBeLessThan(OUTDOOR_FILE_SIZE);
      for (const group of displayList.groups) {
        for (const point of group.points) {
          // The list plots into a 320x200 screen. y never exceeds 199 in the
          // whole corpus; a handful of x values sit a few pixels past the
          // right edge (clipped at draw time).
          expect(point.y, name).toBeLessThanOrEqual(199);
          expect(point.x, name).toBeLessThanOrEqual(324);
        }
      }
    }
  });

  it('reads out1.dat`s first text line and first POI record from real bytes', () => {
    const data = readData('out1.dat');
    // Text block starts at 595; the first slot is 40 bytes ending in NUL.
    expect(data[595 + 39]).toBe(0x00);
    const section = decodeOutdoorSection(data);
    expect(section.textLines[0]).toBe('TO THE WEST IS A BUILDING CALLED');
    expect(section.textLines[1]).toBe("'THE RED PONY INN'");

    // Record 0 lives at 520; its (col,row) must select a real landmark tile.
    expect(Array.from(data.subarray(520, 525))).toEqual([0x0f, 0x0c, 0x0c, 0x00, 0x00]);
    const poi = section.rawPois[0];
    expect([poi.col, poi.row]).toEqual([15, 12]);
    expect(tileAt(section.grid, poi.col, poi.row)).toBe(66);
    // index 12 -> two lines starting at slot 2.
    expect(poiMessage(section, poi)).toEqual(['YOU ARE ON A PATH,', 'TO THE EAST LIES A SMALL TOWN']);
  });
});

describe('POI table <-> landmark-tile bijection (dungeon-format.md §8.2.2)', () => {
  it('every event tile in the corpus has exactly one record, and vice versa', () => {
    let eventCells = 0;
    let matched = 0;
    const cellsWithoutRecord: string[] = [];
    const recordsOffEventTile: string[] = [];

    for (const name of OUT_FILES) {
      const section = decodeOutdoorSection(readData(name));
      const cells = new Set<string>();
      for (let row = 0; row < OUTDOOR_SECTION_HEIGHT; row++) {
        for (let col = 0; col < OUTDOOR_SECTION_WIDTH; col++) {
          if (hasPoiRecord(tileAt(section.grid, col, row))) cells.add(`${col},${row}`);
        }
      }
      eventCells += cells.size;

      const recorded = new Set<string>();
      for (const poi of section.pois) {
        const key = `${poi.col},${poi.row}`;
        if (cells.has(key)) recorded.add(key);
        else recordsOffEventTile.push(`${name} ${key}`);
      }
      matched += recorded.size;
      for (const key of cells) if (!recorded.has(key)) cellsWithoutRecord.push(`${name} ${key}`);
    }

    expect(eventCells).toBe(99);
    expect(matched).toBe(99);
    expect(cellsWithoutRecord).toEqual([]);
    // Two stale records in otherwise-empty slots; see §8.2.2.
    expect(recordsOffEventTile).toHaveLength(2);
  });

  it('resolves every text-feature record to non-empty text, 60/60', () => {
    let resolved = 0;
    const failures: string[] = [];
    for (const name of OUT_FILES) {
      const section = decodeOutdoorSection(readData(name));
      for (const poi of section.pois) {
        const tile = tileAt(section.grid, poi.col, poi.row);
        if (tileVariant(tile) !== 6) continue;
        const slots = messageSlotsForIndex(poi.index);
        const lines = poiMessage(section, poi);
        if (lines.length !== slots.length || lines.some((line) => line === '')) {
          failures.push(`${name} (${poi.col},${poi.row}) index=${poi.index}`);
        } else {
          resolved++;
        }
      }
    }
    expect(failures).toEqual([]);
    expect(resolved).toBe(60);
  });

  it('finds ten town cells and ten dungeon-class cells, each with one record', () => {
    let towns = 0;
    const dungeonIndices: number[] = [];
    for (const name of OUT_FILES) {
      const section = decodeOutdoorSection(readData(name));
      for (const poi of section.pois) {
        const tile = revealedTileCode(tileAt(section.grid, poi.col, poi.row));
        if (tile === TILE_TOWN) towns++;
        else if (tileClass(tile) === TILE_CLASS_DUNGEON) {
          dungeonIndices.push(poi.index);
          // The secondary parameter is non-zero only here.
          expect(poi.param, `${name} (${poi.col},${poi.row})`).toBeGreaterThan(0);
        }
      }
    }
    expect(towns).toBe(10);
    expect(dungeonIndices.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('tile-code decomposition (dungeon-format.md §8.3.3)', () => {
  it('splits the +120 unexplored flag per section, all-or-nothing', () => {
    const preRevealed: number[] = [];
    for (let block = 0; block < OUT_FILES.length; block++) {
      const grid = readData(OUT_FILES[block]).subarray(0, OUTDOOR_GRID_SIZE);
      const hidden = Array.from(grid).filter(isTileUnexplored).length;
      // Never mixed: a section is entirely revealed or entirely hidden.
      expect([0, OUTDOOR_GRID_SIZE], OUT_FILES[block]).toContain(hidden);
      expect(TILE_UNEXPLORED_FLAG).toBe(120);
      if (hidden === 0) preRevealed.push(SECTION_NUMBER_BY_BLOCK[block]);
    }
    expect(preRevealed).toEqual([1, 5]);
  });

  it('reproduces the engine`s class/variant split and movement cost', () => {
    // (25 - engineRow) * 20 + col, game+0x16C7C.
    expect(gridOffsetForEngineRow(0, 25)).toBe(0);
    expect(gridOffsetForEngineRow(19, 0)).toBe(519);

    expect(tileClass(186)).toBe(6);
    expect(tileVariant(186)).toBe(6);
    expect(revealedTileCode(186)).toBe(66);
    // (class+1)*75 for classes 0-3, else 60.
    expect([0, 10, 20, 30, 40].map(tileMovementCost)).toEqual([75, 150, 225, 300, 60]);
  });

  it('encodes message length in the index the way the renderer branches', () => {
    expect(messageSlotsForIndex(6)).toEqual([6]);
    expect(messageSlotsForIndex(12)).toEqual([2, 3]);
    expect(messageSlotsForIndex(20)).toEqual([0, 1, 2]);
  });
});

describe('world assembly (dungeon-format.md §8.3.2)', () => {
  it('is 77 x 126 at strides of 19 and 25', () => {
    expect(WORLD_WIDTH).toBe(4 * 19 + 1);
    expect(WORLD_HEIGHT).toBe(5 * 25 + 1);
    const world = assembleWorld(decodeMapsInt(readData('maps.int')));
    expect(world.cells.length).toBe(77 * 126);

    // The whole continent is framed by the impassable ocean class.
    const topRow = Array.from(world.cells.subarray(0, WORLD_WIDTH));
    expect(topRow.every((v) => tileClass(v) === tileClass(TILE_OCEAN))).toBe(true);
  });

  it('agrees on terrain class across 98% of the shared seam cells', () => {
    const grids = decodeMapsInt(readData('maps.int'));
    const at = (block: number, col: number, row: number) => grids[block][row * OUTDOOR_SECTION_WIDTH + col];
    let shared = 0;
    let sameClass = 0;
    for (let block = 0; block < 16; block++) {
      const col = block % 4;
      const row = Math.floor(block / 4);
      if (col < 3) {
        for (let r = 0; r < OUTDOOR_SECTION_HEIGHT; r++, shared++) {
          if (tileClass(at(block, 19, r)) === tileClass(at(block + 1, 0, r))) sameClass++;
        }
      }
      if (row < 3) {
        for (let c = 0; c < OUTDOOR_SECTION_WIDTH; c++, shared++) {
          if (tileClass(at(block, c, 25)) === tileClass(at(block + 4, c, 0))) sameClass++;
        }
      }
    }
    expect(shared).toBe(552);
    expect(sameClass).toBe(542);
  });
});
