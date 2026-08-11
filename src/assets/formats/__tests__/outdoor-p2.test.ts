import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  MAPS_INT_SIZE_P2,
  OUTDOOR_DISPLAY_LIST_OFFSET_P2,
  OUTDOOR_ICON_BANK_OFFSET,
  OUTDOOR_ICON_BANK_OFFSET_P2,
  OUTDOOR_ICON_COUNT,
  OUTDOOR_ICON_SIZE,
  OUTDOOR_CELL_WIDTH,
  OUTDOOR_CELL_HEIGHT,
  OUTDOOR_MAP_ORIGIN_X,
  OUTDOOR_MAP_ORIGIN_Y,
  OUTDOOR_MAP_WIDTH,
  OUTDOOR_MAP_HEIGHT,
  TERRAIN_CLASS_NAMES_P2,
  OUTDOOR_FILE_SIZE_P2,
  OUTDOOR_GRID_SIZE,
  OUTDOOR_SECTION_HEIGHT,
  OUTDOOR_SECTION_WIDTH,
  OUTDOOR_TEXT_LINE_COUNT,
  PHANTASIE1_OUTDOOR,
  PHANTASIE2_OUTDOOR,
  SECTION_NUMBER_BY_BLOCK_P2,
  TILE_CLASS_DUNGEON,
  TILE_OCEAN,
  TILE_TOWN,
  WORLD_HEIGHT,
  WORLD_WIDTH_P2,
  assembleWorld,
  decodeMapsInt,
  decodeOutdoorIcon,
  decodeOutdoorIconBank,
  decodeOutdoorSection,
  rasteriseOutdoorSection,
  hasPoiRecord,
  poiMessage,
  revealedTileCode,
  tileClass,
} from '../outdoor.ts';

/**
 * Phantasie II (Atari ST) outdoor sections — dungeon-format.md §8.6.
 * Fixtures are the real extracted floppy files.
 */
const DISK1 = resolve('data/phantasieii/atarist/extracted/disk1');
const DISK2 = resolve('data/phantasieii/atarist/extracted/disk2');
const readDisk1 = (name: string) => new Uint8Array(readFileSync(resolve(DISK1, name)));
const readDisk2 = (name: string) => new Uint8Array(readFileSync(resolve(DISK2, name)));

/** Ordinal filename order — the numbers are sparse, `MAPS.INT` is not. */
const OUT_FILES = SECTION_NUMBER_BY_BLOCK_P2.map((n) => `OUT${n}.DAT`);

describe('MAPS.INT — 17 concatenated section grids (dungeon-format.md §8.6.2)', () => {
  it('is exactly 17 grids of 520 bytes, with no header or footer', () => {
    const mapsInt = readDisk1('MAPS.INT');
    expect(mapsInt.length).toBe(8840);
    expect(mapsInt.length).toBe(MAPS_INT_SIZE_P2);
    expect(17 * OUTDOOR_GRID_SIZE).toBe(8840);
    expect(decodeMapsInt(mapsInt, PHANTASIE2_OUTDOOR)).toHaveLength(17);
  });

  it('block k is byte-identical to the k-th OUT*.DAT grid, all 17, zero mismatches', () => {
    const grids = decodeMapsInt(readDisk1('MAPS.INT'), PHANTASIE2_OUTDOOR);
    const mismatches: string[] = [];
    OUT_FILES.forEach((name, block) => {
      const fileGrid = readDisk2(name).subarray(0, OUTDOOR_GRID_SIZE);
      if (!grids[block].every((b, i) => b === fileGrid[i])) mismatches.push(name);
    });
    expect(mismatches).toEqual([]);
  });

  it('packs by ordinal over the files that exist, not by section number', () => {
    expect(SECTION_NUMBER_BY_BLOCK_P2).toEqual([
      1, 2, 3, 5, 6, 7, 8, 11, 12, 17, 18, 22, 26, 27, 28, 30, 31,
    ]);
    // Block 3 is section 5: there is no OUT4.DAT.
    expect(SECTION_NUMBER_BY_BLOCK_P2[3]).toBe(5);
  });

  it('rejects Phantasie I`s MAPS.INT size under the Phantasie II layout', () => {
    expect(() => decodeMapsInt(new Uint8Array(9360), PHANTASIE2_OUTDOOR)).toThrow();
  });
});

describe('OUT*.DAT — the 3000-byte record (dungeon-format.md §8.6.1)', () => {
  it('is 3000 bytes in every shipped file', () => {
    for (const name of OUT_FILES) {
      expect(readDisk2(name).length, name).toBe(OUTDOOR_FILE_SIZE_P2);
    }
    expect(PHANTASIE2_OUTDOOR.fileSize).toBe(3000);
    expect(PHANTASIE1_OUTDOOR.fileSize).toBe(2500);
  });

  it('shares Phantasie I`s grid/POI/text offsets and moves only the display list', () => {
    expect(PHANTASIE2_OUTDOOR.displayListOffset).toBe(1500);
    expect(OUTDOOR_DISPLAY_LIST_OFFSET_P2).toBe(1500);
    expect(PHANTASIE1_OUTDOOR.displayListOffset).toBe(1000);
    // 520 grid + 75 POI + 400 text = 995, identical in both games.
    expect(OUTDOOR_GRID_SIZE + 75 + 400).toBe(995);
  });

  it('parses the display list in all 17 files, background icon 10 everywhere', () => {
    const backgrounds = new Set<number>();
    let points = 0;
    let offScreenY = 0;
    for (const name of OUT_FILES) {
      const section = decodeOutdoorSection(readDisk2(name), PHANTASIE2_OUTDOOR);
      backgrounds.add(section.displayList.backgroundIconIndex);
      for (const group of section.displayList.groups) {
        points += group.points.length;
        offScreenY += group.points.filter((p) => p.y > 199).length;
      }
      expect(section.displayList.endOffset, name).toBeLessThan(OUTDOOR_FILE_SIZE_P2);
    }
    expect([...backgrounds]).toEqual([10]);
    expect(points).toBe(4276);
    // A 320x200 screen: not one plotted point falls below the last scanline.
    expect(offScreenY).toBe(0);
  });

  it('fails to parse the display list at Phantasie I`s offset of 1000', () => {
    for (const name of OUT_FILES) {
      expect(() => decodeOutdoorSection(readDisk2(name), PHANTASIE1_OUTDOOR), name).toThrow();
    }
  });

  it('decodes real text lines at the shared offset of 595', () => {
    const out1 = decodeOutdoorSection(readDisk2('OUT1.DAT'), PHANTASIE2_OUTDOOR);
    expect(out1.textLines[0]).toBe("'THE OASIS'");
    expect(out1.textLines).toHaveLength(OUTDOOR_TEXT_LINE_COUNT);

    const out2 = decodeOutdoorSection(readDisk2('OUT2.DAT'), PHANTASIE2_OUTDOOR);
    expect(out2.textLines[0]).toBe("'THE ALBATROSS'");
    expect(out2.textLines[1]).toBe('THERE IS A SMALL ENCLOSED TOWN HERE');
  });
});

describe('POI records (dungeon-format.md §8.6.4)', () => {
  const sections = OUT_FILES.map((name) => ({
    name,
    section: decodeOutdoorSection(readDisk2(name), PHANTASIE2_OUTDOOR),
  }));

  const tileFor = (grid: Uint8Array, col: number, row: number) =>
    revealedTileCode(grid[row * OUTDOOR_SECTION_WIDTH + col]);

  it('places exactly ten towns, one per section, numbered 1..10', () => {
    const townIndices: number[] = [];
    for (const { section } of sections) {
      for (const poi of section.pois) {
        if (tileFor(section.grid, poi.col, poi.row) === TILE_TOWN) {
          townIndices.push(poi.index);
          expect(poi.param).toBe(0);
        }
      }
    }
    expect(townIndices.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('uses exactly eight distinct class-5 ids, matching DNG1..DNG8', () => {
    const dungeonIds = new Set<number>();
    let paramNonZero = 0;
    for (const { section } of sections) {
      for (const poi of section.pois) {
        if (tileClass(tileFor(section.grid, poi.col, poi.row)) === TILE_CLASS_DUNGEON) {
          dungeonIds.add(poi.index);
          if (poi.param !== 0) paramNonZero++;
        }
      }
    }
    expect([...dungeonIds].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // `+3` is non-zero only on class-5 records, exactly as in Phantasie I.
    expect(paramNonZero).toBeGreaterThan(0);
  });

  it('resolves every variant-6 record to non-empty text, 42/42', () => {
    let resolved = 0;
    let empty = 0;
    for (const { section } of sections) {
      for (const poi of section.pois) {
        const tile = tileFor(section.grid, poi.col, poi.row);
        if (tile % 10 !== 6) continue;
        const lines = poiMessage(section, poi).filter((l) => l !== '');
        if (lines.length > 0) resolved++;
        else empty++;
      }
    }
    expect(resolved).toBe(42);
    expect(empty).toBe(0);
  });

  it('recovers a real three-line landmark description verbatim', () => {
    // OUT6.DAT, cell (14,22), index 20 -> three lines from slot 0.
    const out6 = decodeOutdoorSection(readDisk2('OUT6.DAT'), PHANTASIE2_OUTDOOR);
    const poi = out6.pois.find((p) => p.col === 14 && p.row === 22);
    expect(poi).toBeDefined();
    expect(poi!.index).toBe(20);
    expect(poiMessage(out6, poi!)).toEqual([
      'THERE IS A SMALL STONE CASTLE',
      'SET ON THE EDGE OF THE WATER,',
      'BUT THERE IS LITTLE ACTIVITY.',
    ]);

    // Two-line form: index 10 -> slots 0 and 1.
    const out18 = decodeOutdoorSection(readDisk2('OUT18.DAT'), PHANTASIE2_OUTDOOR);
    const temple = out18.pois.find((p) => p.col === 14 && p.row === 7);
    expect(temple!.index).toBe(10);
    expect(poiMessage(out18, temple!)).toEqual([
      'THERE IS A SMALL',
      'BLOODSTAINED TEMPLE HERE',
    ]);
  });

  it('reuses Phantasie I`s dispatch predicate unchanged', () => {
    expect(hasPoiRecord(TILE_TOWN)).toBe(true);
    expect(hasPoiRecord(56)).toBe(true);
    expect(hasPoiRecord(TILE_OCEAN)).toBe(false);
  });
});

describe('world assembly (dungeon-format.md §8.6.3, axis-corrected 2026-08-11)', () => {
  it('is 201 x 77 (east-west x north-south) — eight mosaic columns wide, four rows deep', () => {
    expect(WORLD_WIDTH_P2).toBe(7 * 25 + 26);
    expect(WORLD_HEIGHT).toBe(3 * 19 + 20);
    const world = assembleWorld(
      decodeMapsInt(readDisk1('MAPS.INT'), PHANTASIE2_OUTDOOR),
      PHANTASIE2_OUTDOOR,
    );
    expect(world.width).toBe(201);
    expect(world.height).toBe(77);
    expect(world.cells.length).toBe(201 * 77);
  });

  it('agrees on terrain class across 99% of the 440 shared seam cells', () => {
    const grids = decodeMapsInt(readDisk1('MAPS.INT'), PHANTASIE2_OUTDOOR);
    const bySection = new Map<number, Uint8Array>();
    SECTION_NUMBER_BY_BLOCK_P2.forEach((n, i) => bySection.set(n, grids[i]));
    const at = (g: Uint8Array, col: number, row: number) =>
      tileClass(g[row * OUTDOOR_SECTION_WIDTH + col]);

    let shared = 0;
    let sameClass = 0;
    for (const [n, g] of bySection) {
      const right = (n - 1) % 4 === 3 ? undefined : bySection.get(n + 1);
      if (right) {
        for (let r = 0; r < OUTDOOR_SECTION_HEIGHT; r++, shared++) {
          if (at(g, 19, r) === at(right, 0, r)) sameClass++;
        }
      }
      const below = bySection.get(n + 4);
      if (below) {
        for (let c = 0; c < OUTDOOR_SECTION_WIDTH; c++, shared++) {
          if (at(g, c, 25) === at(below, c, 0)) sameClass++;
        }
      }
    }
    expect(shared).toBe(440);
    expect(sameClass).toBe(438);
  });

  it('walls off every absent mosaic slot with ocean', () => {
    const grids = decodeMapsInt(readDisk1('MAPS.INT'), PHANTASIE2_OUTDOOR);
    const present = new Set(SECTION_NUMBER_BY_BLOCK_P2);
    const oceanClass = tileClass(TILE_OCEAN);
    let edges = 0;
    let pureOcean = 0;
    SECTION_NUMBER_BY_BLOCK_P2.forEach((n, i) => {
      const g = grids[i];
      const col = (n - 1) % 4;
      const faces: [number | undefined, number[]][] = [
        [col === 0 ? undefined : n - 1, Array.from({ length: 26 }, (_, r) => g[r * 20])],
        [col === 3 ? undefined : n + 1, Array.from({ length: 26 }, (_, r) => g[r * 20 + 19])],
        [n - 4, Array.from({ length: 20 }, (_, c) => g[c])],
        [n + 4, Array.from({ length: 20 }, (_, c) => g[25 * 20 + c])],
      ];
      for (const [neighbour, cells] of faces) {
        if (neighbour !== undefined && present.has(neighbour)) continue;
        edges++;
        if (cells.every((v) => tileClass(v) === oceanClass)) pureOcean++;
      }
    });
    expect(edges).toBe(30);
    expect(pureOcean).toBe(29);
  });
});

describe('P2 outdoor icon bank — PHANT.PRG addr 0x21DD6 (dungeon-format.md §8.6.8)', () => {
  const phant = readDisk1('PHANT.PRG');
  const gameP1 = new Uint8Array(readFileSync(resolve('data/phantasie/amiga/game')));

  it('sits at file 0x21DF2 — addr 0x21DD6 plus the 28-byte GEMDOS header', () => {
    expect(OUTDOOR_ICON_BANK_OFFSET_P2).toBe(0x21dd6 + 28);
    expect(PHANTASIE2_OUTDOOR.iconBankOffset).toBe(OUTDOOR_ICON_BANK_OFFSET_P2);
    expect(PHANTASIE1_OUTDOOR.iconBankOffset).toBe(OUTDOOR_ICON_BANK_OFFSET);
  });

  it('the marker bank begins exactly one 12-entry terrain bank later', () => {
    // The marker draw routine at addr 0x5230 does `asl.l #7; add.l #$223D6`,
    // and 0x223D6 - 0x21DD6 = 0x600 = 12 * 128. That arithmetic identity is
    // what bounds the terrain bank at exactly OUTDOOR_ICON_COUNT entries.
    expect(0x223d6 - 0x21dd6).toBe(OUTDOOR_ICON_COUNT * OUTDOOR_ICON_SIZE);
  });

  it('9 of the 12 entries are byte-identical to P1\'s Amiga bank, at the predicted offsets', () => {
    const identical: number[] = [];
    for (let i = 0; i < OUTDOOR_ICON_COUNT; i++) {
      const a = gameP1.subarray(
        OUTDOOR_ICON_BANK_OFFSET + i * OUTDOOR_ICON_SIZE,
        OUTDOOR_ICON_BANK_OFFSET + (i + 1) * OUTDOOR_ICON_SIZE,
      );
      const b = phant.subarray(
        OUTDOOR_ICON_BANK_OFFSET_P2 + i * OUTDOOR_ICON_SIZE,
        OUTDOOR_ICON_BANK_OFFSET_P2 + (i + 1) * OUTDOOR_ICON_SIZE,
      );
      if (a.every((v, k) => v === b[k])) identical.push(i);
    }
    // Everything except P2's three new terrains (7 Dark Void, 8 Molten Lava,
    // 11 Mist) is the same artwork, byte for byte, across the two ports.
    expect(identical).toEqual([0, 1, 2, 3, 4, 5, 6, 9, 10]);
  });

  it('decodes 16x16x4bpp plane-major, giving indices in 0..15', () => {
    const bank = decodeOutdoorIconBank(phant, OUTDOOR_ICON_BANK_OFFSET_P2);
    expect(bank).toHaveLength(OUTDOOR_ICON_COUNT);
    for (const px of bank) {
      expect(px).toHaveLength(256);
      for (const v of px) expect(v).toBeLessThanOrEqual(15);
    }
  });

  it('plane-major beats VDI-row-interleaved: 2-7 colours per entry, not 13-16', () => {
    // The alternative reading (word 0 = row 0 plane 0, word 1 = row 0 plane 1,
    // ...) is the only other layout the same 128 bytes admit. It smears every
    // entry across nearly the whole palette, which no fill pattern does.
    for (let i = 0; i < OUTDOOR_ICON_COUNT; i++) {
      const planeMajor = new Set(decodeOutdoorIcon(phant, i, OUTDOOR_ICON_BANK_OFFSET_P2));
      const base = OUTDOOR_ICON_BANK_OFFSET_P2 + i * OUTDOOR_ICON_SIZE;
      const interleaved = new Set<number>();
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          let v = 0;
          for (let plane = 0; plane < 4; plane++) {
            const at = base + (y * 4 + plane) * 2;
            const word = (phant[at] << 8) | phant[at + 1];
            if (word & (0x8000 >> x)) v |= 1 << plane;
          }
          interleaved.add(v);
        }
      }
      expect(planeMajor.size).toBeLessThanOrEqual(7);
      if (planeMajor.size > 1) expect(interleaved.size).toBeGreaterThan(planeMajor.size);
    }
  });

  it('entries 4 and 5 are blank — towns and dungeons are markers, not fills', () => {
    for (const i of [4, 5]) {
      expect(decodeOutdoorIcon(phant, i, OUTDOOR_ICON_BANK_OFFSET_P2).every((v) => v === 0)).toBe(
        true,
      );
    }
  });

  it('entry 8 (Molten Lava) is the only entry using colour 15 — the one palette slot P2 changed', () => {
    const usingFifteen: number[] = [];
    // Include the marker entries past the terrain bank, so this is a
    // statement about the whole 16-entry pattern region, not just 0-11.
    for (let i = 0; i < 16; i++) {
      if (decodeOutdoorIcon(phant, i, OUTDOOR_ICON_BANK_OFFSET_P2).includes(15)) {
        usingFifteen.push(i);
      }
    }
    expect(usingFifteen).toEqual([8]);
  });

  it('names all twelve P2 classes', () => {
    expect(TERRAIN_CLASS_NAMES_P2).toHaveLength(OUTDOOR_ICON_COUNT);
    expect(PHANTASIE2_OUTDOOR.terrainClassNames).toBe(TERRAIN_CLASS_NAMES_P2);
    expect(TERRAIN_CLASS_NAMES_P2[7]).toBe('Dark Void');
    expect(TERRAIN_CLASS_NAMES_P2[8]).toBe('Molten Lava');
    expect(TERRAIN_CLASS_NAMES_P2[11]).toBe('Mist');
  });

  it('Path (6) and Mist (11) share a colour but never share a screen', () => {
    // Both render as sparse index-8 grey dots, which would be ambiguous if
    // they could co-occur. Class 6 is surface-only, class 11 underworld-only.
    const surface = new Set<number>();
    const underworld = new Set<number>();
    SECTION_NUMBER_BY_BLOCK_P2.forEach((n) => {
      const grid = decodeOutdoorSection(readDisk2(`OUT${n}.DAT`), PHANTASIE2_OUTDOOR).grid;
      const into = n >= 17 ? underworld : surface;
      for (const code of grid) into.add(tileClass(revealedTileCode(code)));
    });
    expect(surface.has(6)).toBe(true);
    expect(surface.has(11)).toBe(false);
    expect(underworld.has(11)).toBe(true);
    expect(underworld.has(6)).toBe(false);
  });
});

describe('P2 iconIndex is the terrain class — dungeon-format.md §8.6.8a', () => {
  /**
   * Replay each section's display list and sample the centre of every grid
   * cell's own screen rectangle, exactly as §8.2.4a did for P1. The screen
   * geometry is P2's own: `MarkerRect()` at addr `0x4AF2` multiplies by the
   * four words stored at addr `0x5764` (12, 9, 4, 15), and the background
   * rectangle is `SetRect(4, 15, 312, 180)` — where `312 = 26 * 12` and
   * `180 = 20 * 9` cover the grid exactly.
   */
  // Unlike P1, P2's display lists *do* carry classes 4 and 5 (a tiny 4-point
  // polygon per town/dungeon cell), so nothing needs excluding here.
  it('agrees on the cell class across all 17 sections, all twelve classes', () => {
    let total = 0;
    let agree = 0;
    for (const n of SECTION_NUMBER_BY_BLOCK_P2) {
      const section = decodeOutdoorSection(readDisk2(`OUT${n}.DAT`), PHANTASIE2_OUTDOOR);
      const raster = rasteriseOutdoorSection(section, undefined, undefined, false);
      for (let fileRow = 0; fileRow < OUTDOOR_SECTION_HEIGHT; fileRow++) {
        const engineRow = OUTDOOR_SECTION_HEIGHT - 1 - fileRow;
        for (let col = 0; col < OUTDOOR_SECTION_WIDTH; col++) {
          const cls = tileClass(
            revealedTileCode(section.grid[fileRow * OUTDOOR_SECTION_WIDTH + col]),
          );
          const px = engineRow * OUTDOOR_CELL_WIDTH + OUTDOOR_MAP_ORIGIN_X + 6;
          const py = col * OUTDOOR_CELL_HEIGHT + OUTDOOR_MAP_ORIGIN_Y + 4;
          total++;
          if (raster.icons[py * raster.width + px] === cls) agree++;
        }
      }
    }
    expect(total).toBe(8840);
    expect(agree).toBe(8790); // 99.43%
  });

  it('the background rectangle covers the 26 x 20 grid exactly', () => {
    expect(OUTDOOR_MAP_WIDTH).toBe(OUTDOOR_SECTION_HEIGHT * OUTDOOR_CELL_WIDTH); // 312
    expect(OUTDOOR_MAP_HEIGHT).toBe(OUTDOOR_SECTION_WIDTH * OUTDOOR_CELL_HEIGHT); // 180
  });
});
