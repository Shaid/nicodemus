import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  OUTDOOR_FILE_NAMES,
  buildWorldFromSections,
  poiTypeForTile,
  sectionCellToWorld,
  sectionOrigin,
  sectionPoisToWorld,
} from '../build-map.ts';
import {
  OUTDOOR_SECTION_HEIGHT,
  OUTDOOR_SECTION_WIDTH,
  SECTION_NUMBER_BY_BLOCK,
  WORLD_HEIGHT,
  WORLD_WIDTH_P1,
  decodeMapsInt,
  decodeOutdoorSection,
  type OutdoorSection,
} from '../../../src/assets/formats/outdoor.ts';

const DATA_DIR = resolve('data/phantasie/amiga');
const readData = (name: string) => new Uint8Array(readFileSync(resolve(DATA_DIR, name)));

const SECTIONS: { section: number; decoded: OutdoorSection }[] = OUTDOOR_FILE_NAMES.map(
  (file, block) => ({
    section: SECTION_NUMBER_BY_BLOCK[block],
    decoded: decodeOutdoorSection(readData(file)),
  }),
);
const GRIDS = decodeMapsInt(readData('maps.int'));
const BUILT = buildWorldFromSections(SECTIONS, GRIDS);

describe('outdoor file list (dungeon-format.md §8.3.1)', () => {
  it('is the 18 shipped sections in maps.int block order, skipping out17', () => {
    expect(OUTDOOR_FILE_NAMES).toHaveLength(18);
    expect(OUTDOOR_FILE_NAMES).not.toContain('out17.dat');
    expect(OUTDOOR_FILE_NAMES.slice(-3)).toEqual(['out16.dat', 'out18.dat', 'out19.dat']);
  });
});

describe('section placement (dungeon-format.md §8.2.1/§8.3.2, axis-corrected 2026-08-11)', () => {
  it('lays the sections out 5 wide east-west (from the east) at strides of 25/19', () => {
    // Section 1 is the easternmost section in the north (mosaic slot 0).
    expect(sectionOrigin(1)).toEqual({ x: 100, y: 0 });
    expect(sectionOrigin(4)).toEqual({ x: 100, y: 57 });
    // Section 5 is one mosaic column further west than section 1.
    expect(sectionOrigin(5)).toEqual({ x: 75, y: 0 });
    // The westernmost column (17-20, the walled-off Styx region): 18 sits
    // north of 19, both hugging the world's west edge (x = 0).
    expect(sectionOrigin(18)).toEqual({ x: 0, y: 19 });
    expect(sectionOrigin(19)).toEqual({ x: 0, y: 38 });
    // Section 16's south-west corner cell reaches the world's south edge —
    // its own mosaic slot (south-east quadrant) has no further neighbour
    // south, and section 20 (its western neighbour) ships no file.
    expect(sectionCellToWorld(16, OUTDOOR_SECTION_WIDTH - 1, OUTDOOR_SECTION_HEIGHT - 1)).toEqual({
      x: 25,
      y: WORLD_HEIGHT - 1,
    });
    // Section 19's own cell (19, 25) lands on the world's west edge (x = 0)
    // — consistent with the westernmost column being sections 17-20.
    expect(sectionCellToWorld(19, OUTDOOR_SECTION_WIDTH - 1, OUTDOOR_SECTION_HEIGHT - 1)).toEqual({
      x: 0,
      y: 57,
    });
  });

  it('rejects a cell outside the 20x26 section grid', () => {
    expect(() => sectionCellToWorld(1, 20, 0)).toThrow(RangeError);
    expect(() => sectionCellToWorld(1, 0, 26)).toThrow(RangeError);
  });

  it('agrees cell-for-cell with assembleWorld over every shipped section', () => {
    // The strongest check available on the placement math: every one of the
    // 18 x 520 section cells must land on the world cell that carries its
    // code, except where a later, overlapping section owns the shared edge.
    const { world } = BUILT;
    let checked = 0;
    let overwritten = 0;
    for (let block = 0; block < SECTIONS.length; block++) {
      const { section } = SECTIONS[block];
      const grid = GRIDS[block];
      for (let row = 0; row < OUTDOOR_SECTION_HEIGHT; row++) {
        for (let col = 0; col < OUTDOOR_SECTION_WIDTH; col++) {
          const { x, y } = sectionCellToWorld(section, col, row);
          checked++;
          const own = grid[row * OUTDOOR_SECTION_WIDTH + col] % 120;
          if (world.cells[y * world.width + x] !== own) overwritten++;
        }
      }
    }
    expect(checked).toBe(18 * 520);
    // Only seam cells may differ, and only 64 of the 552 shared cells
    // disagree once the fog flag is stripped (§8.3.2: 488 agree exactly).
    expect(overwritten).toBeLessThanOrEqual(64);
  });
});

describe('POI classification (dungeon-format.md §8.2.2)', () => {
  it('reads the engine`s dispatch order off the tile code', () => {
    expect(poiTypeForTile(40)).toBe('town');
    expect(poiTypeForTile(160)).toBe('town'); // still a town while unexplored
    expect(poiTypeForTile(50)).toBe('dungeon');
    expect(poiTypeForTile(51)).toBe('dungeon');
    expect(poiTypeForTile(66)).toBe('text');
    expect(poiTypeForTile(67)).toBe('bump');
    expect(poiTypeForTile(68)).toBe('silent');
    expect(poiTypeForTile(41)).toBe('other');
  });
});

describe('world POI table built from real bytes', () => {
  it('places all 101 in-range records, with the documented type split', () => {
    const counts: Record<string, number> = {};
    for (const poi of BUILT.pois) counts[poi.type] = (counts[poi.type] ?? 0) + 1;
    expect(BUILT.pois).toHaveLength(101);
    // 99 of the 101 sit on a dispatching tile (§8.2.2's bijection); the two
    // strays are the stale records at out12 (14,14) and out13 (19,8).
    expect(counts).toEqual({ text: 60, bump: 15, silent: 4, town: 10, dungeon: 10, other: 2 });
  });

  it('lands every marker inside the world grid on its own tile code', () => {
    const { world, pois } = BUILT;
    const offGrid: string[] = [];
    const mismatched: string[] = [];
    for (const poi of pois) {
      if (poi.x < 0 || poi.x >= world.width || poi.y < 0 || poi.y >= world.height) {
        offGrid.push(`s${poi.section} (${poi.col},${poi.row})`);
        continue;
      }
      if (world.cells[poi.y * world.width + poi.x] !== poi.tile) {
        mismatched.push(`s${poi.section} (${poi.col},${poi.row})`);
      }
    }
    expect(offGrid).toEqual([]);
    // Two POIs sit on column 19 — a seam the eastern neighbour overwrites.
    expect(mismatched).toEqual(['s13 (19,8)', 's9 (19,10)']);
  });

  it('gives the ten dungeon markers ids 1-10, one per section', () => {
    const dungeons = BUILT.pois.filter((p) => p.type === 'dungeon');
    expect(dungeons.map((d) => d.index).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(new Set(dungeons.map((d) => d.section)).size).toBe(10);
    // Record byte +3 is non-zero only here.
    expect(dungeons.every((d) => d.param > 0)).toBe(true);
  });

  it('never invents a town name and labels towns by record index only', () => {
    const towns = BUILT.pois.filter((p) => p.type === 'town');
    expect(towns).toHaveLength(10);
    expect(towns.every((t) => t.label === `Town ${t.index}`)).toBe(true);
    expect(towns.every((t) => t.message === undefined)).toBe(true);
  });

  it('captions text markers with their own resolved message line', () => {
    // out2.dat's record at (6,4): index 10 -> two lines from slot 0.
    const poi = sectionPoisToWorld(2, SECTIONS[1].decoded).find(
      (p) => p.col === 6 && p.row === 4,
    );
    expect(poi).toBeDefined();
    expect(poi!.type).toBe('text');
    expect(poi!.message).toEqual(['A MAGNIFICENT GATEWAY IS SET', 'INTO THE MOUNTAIN']);
    expect(poi!.label).toBe('A MAGNIFICENT GATEWAY IS SET');
    expect([poi!.x, poi!.y]).toEqual([121, 25]);
  });

  it('sorts markers north-to-south so overlay draw order is stable', () => {
    const keys = BUILT.pois.map((p) => p.y * WORLD_WIDTH_P1 + p.x);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
  });
});
