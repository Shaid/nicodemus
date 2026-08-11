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
  WORLD_WIDTH_P1,
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
  OUTDOOR_ICON_BANK_OFFSET,
  OUTDOOR_ICON_COUNT,
  OUTDOOR_ICON_SIZE,
  OUTDOOR_MAP_HEIGHT,
  OUTDOOR_MAP_WIDTH,
  TERRAIN_CLASS_NAMES,
  cellScreenRect,
  decodeOutdoorIcon,
  rasteriseOutdoorSection,
  terrainClassName,
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

describe('world assembly (dungeon-format.md §8.2.1/§8.3.2, axis-corrected 2026-08-11)', () => {
  it('is 126 x 77 (east-west x north-south) at strides of 25 and 19', () => {
    expect(WORLD_WIDTH_P1).toBe(4 * 25 + 26);
    expect(WORLD_HEIGHT).toBe(3 * 19 + 20);
    const world = assembleWorld(decodeMapsInt(readData('maps.int')));
    expect(world.cells.length).toBe(126 * 77);

    // The world's eastern edge (x = width-1, section 1's own fileRow-0
    // column) is open ocean the whole way down — the strongest single
    // edge invariant available, and specific to the corrected orientation:
    // an axis-swapped assembly would put a different, non-uniform edge here.
    const eastEdge: number[] = [];
    for (let y = 0; y < world.height; y++) eastEdge.push(world.cells[y * world.width + world.width - 1]);
    expect(eastEdge.every((v) => tileClass(v) === tileClass(TILE_OCEAN))).toBe(true);
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

describe('outdoor icon bank (dungeon-format.md §8.2.4a)', () => {
  const gameExe = new Uint8Array(readFileSync(resolve(DATA_DIR, 'game')));

  it('sits at game+0x196BC — DATA hunk 69 (file 0x19428) plus the 0x294 the code adds', () => {
    expect(OUTDOOR_ICON_BANK_OFFSET).toBe(0x19428 + 0x294);
    expect(OUTDOOR_ICON_SIZE).toBe(128);
  });

  it('decodes 16x16x4bpp plane-major, giving indices in 0..15', () => {
    for (let i = 0; i < OUTDOOR_ICON_COUNT; i++) {
      const px = decodeOutdoorIcon(gameExe, i);
      expect(px).toHaveLength(256);
      for (const v of px) expect(v).toBeLessThanOrEqual(15);
    }
  });

  it('icon 0 (Grassland) is a two-colour dither of palette index 12 on 0', () => {
    // Planes 0 and 1 are all zero and planes 2/3 hold the same 32 bytes, so
    // every set pixel is 0b1100 = 12 and every clear one is 0.
    const px = decodeOutdoorIcon(gameExe, 0);
    const used = new Set(px);
    expect([...used].sort((a, b) => a - b)).toEqual([0, 12]);
    expect(px.filter((v) => v === 12)).toHaveLength(50);
  });

  it('icon 10 (Ocean) has no transparent-looking index-0 pixel at all', () => {
    const px = decodeOutdoorIcon(gameExe, 10);
    expect([...new Set(px)].sort((a, b) => a - b)).toEqual([4, 7, 14]);
  });

  it('every icon index any shipped display list uses is inside the 12-entry bank', () => {
    const used = new Set<number>();
    for (const name of OUT_FILES) {
      const section = decodeOutdoorSection(readData(name));
      used.add(section.displayList.backgroundIconIndex);
      for (const g of section.displayList.groups) used.add(g.iconIndex);
    }
    expect(Math.max(...used)).toBe(OUTDOOR_ICON_COUNT - 1);
    expect(used.has(4)).toBe(false); // towns are markers, not fills
    expect(used.has(5)).toBe(false); // dungeons too
  });

  it('names all twelve classes', () => {
    expect(TERRAIN_CLASS_NAMES).toHaveLength(OUTDOOR_ICON_COUNT);
    expect(terrainClassName(0)).toBe('Grassland');
    expect(terrainClassName(100)).toBe('Ocean'); // ocean tile code
    expect(terrainClassName(220)).toBe('Ocean'); // ...and its unexplored form
  });
});

describe('display-list icon index == terrain class (dungeon-format.md §8.2.4a)', () => {
  it('reproduces the map: 99%+ of cells sample their own class from the raster', () => {
    let total = 0;
    let hits = 0;
    for (const name of OUT_FILES) {
      const section = decodeOutdoorSection(readData(name));
      const raster = rasteriseOutdoorSection(section);
      for (let fileRow = 0; fileRow < OUTDOOR_SECTION_HEIGHT; fileRow++) {
        for (let col = 0; col < OUTDOOR_SECTION_WIDTH; col++) {
          const cls = tileClass(section.grid[fileRow * OUTDOOR_SECTION_WIDTH + col]);
          if (cls === 4 || cls === 5) continue; // drawn as markers, never filled
          const rect = cellScreenRect(fileRow, col);
          const x = rect.x + Math.floor(rect.w / 2);
          const y = rect.y + Math.floor(rect.h / 2);
          total++;
          if (raster.icons[y * raster.width + x] === cls) hits++;
        }
      }
    }
    expect(total).toBe(9328);
    expect(hits).toBe(9271);
  });

  it('the background is always the ocean class', () => {
    for (const name of OUT_FILES) {
      const section = decodeOutdoorSection(readData(name));
      expect(section.displayList.backgroundIconIndex).toBe(10);
    }
  });

  it('the map rectangle is exactly 26 cells wide by 20 tall', () => {
    expect(OUTDOOR_MAP_WIDTH).toBe(312);
    expect(OUTDOOR_MAP_HEIGHT).toBe(180);
    // file row 0 is the section's *eastern* edge, so it maps to the right
    expect(cellScreenRect(25, 0)).toEqual({ x: 4, y: 15, w: 12, h: 9 });
    expect(cellScreenRect(0, 19)).toEqual({ x: 304, y: 186, w: 12, h: 9 });
  });
});

describe('POI +3/+4 are the dungeon entry cell (dungeon-format.md §8.2.2a)', () => {
  it('+3 lands on the only cell-215 marker in each of the ten dungeons', () => {
    const entries: { dungeon: number; x: number; y: number }[] = [];
    for (const name of OUT_FILES) {
      const section = decodeOutdoorSection(readData(name));
      for (const poi of section.pois) {
        const tile = section.grid[poi.row * OUTDOOR_SECTION_WIDTH + poi.col];
        if (tileClass(tile) === TILE_CLASS_DUNGEON) {
          entries.push({ dungeon: poi.index, x: poi.param, y: poi.unused });
        }
      }
    }
    expect(entries).toHaveLength(10);
    expect(entries.map((e) => e.dungeon).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    for (const { dungeon, x, y } of entries) {
      const grid = readData(`dng${dungeon}`).subarray(0, 33 * 38);
      expect(grid[y * 33 + x]).toBe(215);
      // and it is the first such marker in the file
      expect(grid.indexOf(215)).toBe(y * 33 + x);
    }
  });
});
