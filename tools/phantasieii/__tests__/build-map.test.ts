import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  OUTDOOR_FILE_NAMES,
  buildWorldFromSections,
  poiTypeForTile,
  sectionCellToWorld,
  sectionOrigin,
} from '../build-map.ts';
import {
  OUTDOOR_SECTION_HEIGHT,
  OUTDOOR_SECTION_WIDTH,
  SECTION_NUMBER_BY_BLOCK_P2,
  WORLD_WIDTH_P2,
  PHANTASIE2_OUTDOOR,
  decodeMapsInt,
  decodeOutdoorSection,
  type OutdoorSection,
} from '../../../src/assets/formats/outdoor.ts';

const DISK1 = resolve('data/phantasieii/atarist/extracted/disk1');
const DISK2 = resolve('data/phantasieii/atarist/extracted/disk2');
function readOutdoorFile(name: string): Uint8Array {
  const viaDisk1 = resolve(DISK1, name);
  const path = existsSync(viaDisk1) ? viaDisk1 : resolve(DISK2, name);
  return new Uint8Array(readFileSync(path));
}

const SECTIONS: { section: number; decoded: OutdoorSection }[] = OUTDOOR_FILE_NAMES.map(
  (file, block) => ({
    section: SECTION_NUMBER_BY_BLOCK_P2[block],
    decoded: decodeOutdoorSection(readOutdoorFile(file), PHANTASIE2_OUTDOOR),
  }),
);
const GRIDS = decodeMapsInt(new Uint8Array(readFileSync(resolve(DISK1, 'MAPS.INT'))), PHANTASIE2_OUTDOOR);
const BUILT = buildWorldFromSections(SECTIONS, GRIDS);

describe('outdoor file list (dungeon-format.md §8.6.1/§8.6.2)', () => {
  it('is the 17 shipped sections in MAPS.INT block order, sparse over a 32-slot mosaic', () => {
    expect(OUTDOOR_FILE_NAMES).toHaveLength(17);
    expect(OUTDOOR_FILE_NAMES[0]).toBe('OUT1.DAT');
    expect(OUTDOOR_FILE_NAMES).not.toContain('OUT4.DAT');
    expect(OUTDOOR_FILE_NAMES.slice(-2)).toEqual(['OUT30.DAT', 'OUT31.DAT']);
  });
});

describe('section placement (dungeon-format.md §8.2.1/§8.6.3, axis-corrected 2026-08-11 — 8-wide east-west, 4-tall north-south mosaic)', () => {
  it('lays the sections out 8 wide east-west (from the east) at strides of 25/19', () => {
    // Section 1 is the easternmost section in the north.
    expect(sectionOrigin(1)).toEqual({ x: 175, y: 0 });
    expect(sectionOrigin(2)).toEqual({ x: 175, y: 19 });
    // Section 5 is one mosaic column further west than section 1.
    expect(sectionOrigin(5)).toEqual({ x: 150, y: 0 });
    // Section 17 starts the second (western) landmass — mosaic index 4 of 8,
    // with index 3 (sections 13-16) entirely unshipped: the empty band
    // splitting the two landmasses is east-west, not the north/south split
    // an earlier, axis-mislabelled version of this test assumed.
    expect(sectionOrigin(17)).toEqual({ x: 75, y: 0 });
    expect(sectionOrigin(31)).toEqual({ x: 0, y: 38 });
    expect(sectionCellToWorld(31, OUTDOOR_SECTION_WIDTH - 1, OUTDOOR_SECTION_HEIGHT - 1)).toEqual({
      x: 0,
      y: 57,
    });
  });

  it('rejects a cell outside the 20x26 section grid', () => {
    expect(() => sectionCellToWorld(1, 20, 0)).toThrow(RangeError);
    expect(() => sectionCellToWorld(1, 0, 26)).toThrow(RangeError);
  });

  it('agrees cell-for-cell with assembleWorld over every shipped section, seams aside', () => {
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
    expect(checked).toBe(17 * 520);
    // dungeon-format.md §8.6.3: 440 shared seam cells, 377 (85.7%) agree
    // exactly once the fog flag is stripped.
    expect(overwritten).toBeLessThanOrEqual(440 - 377);
  });
});

describe('POI classification (dungeon-format.md §8.6.4 — same dispatch order as P1)', () => {
  it('reads the engine`s dispatch order off the tile code', () => {
    expect(poiTypeForTile(40)).toBe('town');
    expect(poiTypeForTile(50)).toBe('dungeon');
    expect(poiTypeForTile(66)).toBe('text');
    expect(poiTypeForTile(67)).toBe('bump');
    expect(poiTypeForTile(68)).toBe('silent');
    expect(poiTypeForTile(41)).toBe('other');
  });
});

describe('world POI table built from real bytes', () => {
  it('places all 70 in-range records, with the real type split', () => {
    const counts: Record<string, number> = {};
    for (const poi of BUILT.pois) counts[poi.type] = (counts[poi.type] ?? 0) + 1;
    expect(BUILT.pois).toHaveLength(70);
    expect(counts).toEqual({ town: 10, dungeon: 15, text: 42, bump: 2, other: 1 });
  });

  it('lands every marker inside the world grid (no marker falls off the sparse mosaic)', () => {
    for (const poi of BUILT.pois) {
      expect(poi.x).toBeGreaterThanOrEqual(0);
      expect(poi.x).toBeLessThan(BUILT.world.width);
      expect(poi.y).toBeGreaterThanOrEqual(0);
      expect(poi.y).toBeLessThan(BUILT.world.height);
    }
  });

  it('gives the ten town markers a clean 1..10 index — a materially cleaner result than P1\'s', () => {
    const towns = BUILT.pois.filter((p) => p.type === 'town');
    expect(towns).toHaveLength(10);
    expect(towns.map((t) => t.index).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(towns.every((t) => t.label === `Town ${t.index}`)).toBe(true);
  });

  it('gives the 15 dungeon-class cells 8 distinct ids matching the real DNG1-DNG8 count, including the 8-cell ring around id 7', () => {
    const dungeons = BUILT.pois.filter((p) => p.type === 'dungeon');
    expect(dungeons).toHaveLength(15);
    const bySection = new Set(dungeons.map((d) => d.section)).size;
    expect(bySection).toBe(8);
    const idCounts: Record<number, number> = {};
    for (const d of dungeons) idCounts[d.index] = (idCounts[d.index] ?? 0) + 1;
    expect(Object.keys(idCounts)).toHaveLength(8);
    // OUT28.DAT (id 7): a ring of 8 cells around one entrance.
    expect(idCounts[7]).toBe(8);
  });

  it('never invents a town or dungeon name', () => {
    for (const poi of BUILT.pois.filter((p) => p.type === 'town' || p.type === 'dungeon')) {
      expect(poi.message).toBeUndefined();
    }
  });

  it('resolves all 42 text POIs to at least one non-empty message line', () => {
    const texts = BUILT.pois.filter((p) => p.type === 'text');
    expect(texts).toHaveLength(42);
    for (const poi of texts) {
      expect(poi.message).toBeDefined();
      expect(poi.message!.length).toBeGreaterThan(0);
      expect(poi.label).not.toBe('');
    }
  });

  it('sorts markers north-to-south so overlay draw order is stable', () => {
    const keys = BUILT.pois.map((p) => p.y * WORLD_WIDTH_P2 + p.x);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
  });
});
