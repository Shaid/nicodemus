import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  P3_OVERWORLD_LOCATIONS,
  P3_TERRAIN_BANDS,
  P3_TERRAIN_NAMES,
  P3_TERRAIN_UNCLASSIFIED,
  p3TerrainClass,
  p3TerrainClassTable,
} from '../p3-overworld.ts';
import { decodeSet } from '../set.ts';

const SET_PATH = resolve('data/phantasieiii/amiga/Graphics/phantasy.set');
const EXE_PATH = resolve('data/phantasieiii/amiga/PhantasieIII');

/** Hunk 0 (CODE) payload starts right after the 0x28-byte AmigaDOS hunk header. */
const CODE_FILE_BASE = 0x28;
/** Hunk 1 payload base — dungeon-format.md §9.0.5.4 pins hunk-1 `0x1750` at file `0x29018`. */
const HUNK1_FILE_BASE = 0x278c8;

function readCString(exe: Uint8Array, hunk0Addr: number): string {
  let end = CODE_FILE_BASE + hunk0Addr;
  while (exe[end] !== 0) end++;
  return new TextDecoder('latin1').decode(exe.subarray(CODE_FILE_BASE + hunk0Addr, end));
}

/** Resolve an `n`-entry array of 4-byte hunk-0 pointers living at a hunk-1 offset. */
function readNameTable(exe: Uint8Array, hunk1Offset: number, count: number): string[] {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  return Array.from({ length: count }, (_, i) =>
    readCString(exe, view.getUint32(HUNK1_FILE_BASE + hunk1Offset + i * 4)),
  );
}

describe('p3TerrainClass — the classifier at hunk-0 addr 0xA4A6 (dungeon-format.md §9.0.5.3)', () => {
  it('assigns Water to the whole 0-25 band, including both single-value arms', () => {
    for (let v = 0; v <= 25; v++) expect(P3_TERRAIN_NAMES[p3TerrainClass(v)]).toBe('Water');
  });

  it('lets the later `== 222` arm beat the earlier 214-224 Pathway band', () => {
    // The chain falls through — no early exit — so source order decides.
    expect(P3_TERRAIN_NAMES[p3TerrainClass(221)]).toBe('Pathway');
    expect(P3_TERRAIN_NAMES[p3TerrainClass(222)]).toBe('A bridge');
    expect(P3_TERRAIN_NAMES[p3TerrainClass(223)]).toBe('Pathway');
  });

  it('leaves the marker-tile and gap ranges unclassified', () => {
    // 26-60 is where the named-location artwork lives; LocateSpecial()
    // short-circuits those cells before the classifier ever runs.
    for (const v of [26, 40, 54, 60, 75, 89, 210, 213]) {
      expect(p3TerrainClass(v)).toBe(P3_TERRAIN_UNCLASSIFIED);
    }
  });

  it('reproduces every band boundary the disassembly compares against', () => {
    const expected: [number, string][] = [
      [61, 'Dense Fog'],
      [67, 'Dense Fog'],
      [68, 'Bright mist'],
      [74, 'Bright mist'],
      [90, 'Mountains'],
      [114, 'Mountains'],
      [115, 'Hills'],
      [154, 'Hills'],
      [155, 'Desert'],
      [187, 'Desert'],
      [188, 'Meadows'],
      [205, 'Meadows'],
      [206, 'Pathway'],
      [209, 'Pathway'],
      [214, 'Pathway'],
      [224, 'Pathway'],
      [225, 'Forest'],
      [241, 'Forest'],
      [242, 'The River Styx'],
      [255, 'The River Styx'],
    ];
    for (const [value, name] of expected) expect(P3_TERRAIN_NAMES[p3TerrainClass(value)]).toBe(name);
  });

  it('ships a 256-entry lookup table that agrees with the function', () => {
    const table = p3TerrainClassTable();
    expect(table).toHaveLength(256);
    for (let v = 0; v < 256; v++) expect(table[v]).toBe(p3TerrainClass(v));
  });
});

describe('P3 name tables — byte-exact against the real executable', () => {
  it('matches the 19-entry terrain table at hunk-1 0x1750', () => {
    const exe = new Uint8Array(readFileSync(EXE_PATH));
    expect(readNameTable(exe, 0x1750, 19)).toEqual([...P3_TERRAIN_NAMES]);
  });

  it('matches every location name against its type-specific table', () => {
    const exe = new Uint8Array(readFileSync(EXE_PATH));
    const tables: Record<string, string[]> = {
      town: readNameTable(exe, 0x1684, 18),
      dungeon: readNameTable(exe, 0x16fc, 12),
      inn: readNameTable(exe, 0x172c, 9),
    };
    for (const loc of P3_OVERWORLD_LOCATIONS) {
      // The inn table pads three of its names to a fixed width with a
      // trailing space; the table entry is otherwise byte-identical.
      expect(tables[loc.type][loc.index].trimEnd()).toBe(loc.name);
    }
  });
});

describe('P3_OVERWORLD_LOCATIONS — against the real phantasy.set map array', () => {
  const set = decodeSet(new Uint8Array(readFileSync(SET_PATH)));
  const tileAt = (x: number, y: number) => set.mapArray[y * set.mapWidth + x];

  it('places every location inside the 50 x 75 grid', () => {
    for (const loc of P3_OVERWORLD_LOCATIONS) {
      expect(loc.x).toBeGreaterThanOrEqual(0);
      expect(loc.x).toBeLessThan(set.mapWidth);
      expect(loc.y).toBeGreaterThanOrEqual(0);
      expect(loc.y).toBeLessThan(set.mapHeight);
    }
  });

  it('is a perfect bijection with the map array’s distinctive marker tiles', () => {
    // dungeon-format.md §9.0.5.5's decisive check: each location's cell
    // carries a tile that occurs in the whole 3,750-cell array exactly as
    // many times as that tile has locations. A misread coordinate would
    // land on bulk terrain (hundreds of occurrences) and break this.
    const occurrences = new Map<number, number>();
    for (const value of set.mapArray) occurrences.set(value, (occurrences.get(value) ?? 0) + 1);

    const locationsPerTile = new Map<number, number>();
    for (const loc of P3_OVERWORLD_LOCATIONS) {
      const tile = tileAt(loc.x, loc.y);
      locationsPerTile.set(tile, (locationsPerTile.get(tile) ?? 0) + 1);
    }

    expect(locationsPerTile.size).toBe(29); // 30 locations, the two inns sharing tile 50
    for (const [tile, count] of locationsPerTile) {
      expect(occurrences.get(tile)).toBe(count);
    }
  });

  it('puts every marker tile in the 25-54 window the classifier ignores', () => {
    for (const loc of P3_OVERWORLD_LOCATIONS) {
      const tile = tileAt(loc.x, loc.y);
      expect(tile).toBeGreaterThanOrEqual(25);
      expect(tile).toBeLessThanOrEqual(54);
    }
    // Tile 50 is the one shared graphic — the Jolly Inn and the Royal Inn.
    const shared = P3_OVERWORLD_LOCATIONS.filter((l) => tileAt(l.x, l.y) === 50).map((l) => l.name);
    expect(shared.sort()).toEqual(['The Jolly Inn', 'The Royal Inn']);
  });

  it('accounts for all 14 towns, 8 overworld dungeons and 8 inns with no index gaps', () => {
    const indices = (type: string) =>
      P3_OVERWORLD_LOCATIONS.filter((l) => l.type === type)
        .map((l) => l.index)
        .sort((a, b) => a - b);
    expect(indices('town')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(indices('inn')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Dungeons 9-11 are the Netherworld/castle entrances, not overworld cells.
    expect(indices('dungeon')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const files = P3_OVERWORLD_LOCATIONS.filter((l) => l.type === 'dungeon').map((l) => l.file);
    expect(new Set(files).size).toBe(8);
  });

  it('classifies the bulk of the world into terrain the classifier really names', () => {
    const classes = new Set<number>();
    for (const value of set.mapArray) {
      const cls = p3TerrainClass(value);
      if (cls !== P3_TERRAIN_UNCLASSIFIED) classes.add(cls);
    }
    const named = Array.from(classes)
      .map((c) => P3_TERRAIN_NAMES[c])
      .sort();
    expect(named).toEqual([
      'A bridge',
      'Desert',
      'Forest',
      'Hills',
      'Meadows',
      'Mountains',
      'Pathway',
      'Water',
    ]);

    // Only the marker cells fall outside the classifier's bands — 29 of the
    // 30, because tile 25 (Pendragon) is the single marker value the Water
    // band's `cmpi.w #25` closing bound happens to swallow. It is still
    // never *reached* as Water in play: LocateSpecial() short-circuits that
    // cell before the classifier runs.
    const unclassified = Array.from(set.mapArray).filter(
      (v) => p3TerrainClass(v) === P3_TERRAIN_UNCLASSIFIED,
    );
    expect(unclassified).toHaveLength(P3_OVERWORLD_LOCATIONS.length - 1);
    expect(P3_TERRAIN_NAMES[p3TerrainClass(25)]).toBe('Water');
  });

  it('keeps every band the classifier declares within the table it indexes', () => {
    for (const band of P3_TERRAIN_BANDS) {
      expect(P3_TERRAIN_NAMES[band.class]).toBeTypeOf('string');
      expect(band.min).toBeLessThanOrEqual(band.max);
    }
  });
});
