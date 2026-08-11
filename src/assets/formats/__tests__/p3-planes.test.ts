import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  P3_NETHERWORLD_TERRAIN_BANDS,
  P3_PLANES,
  P3_PLANE_LOCATIONS,
  p3NetherworldTerrainClass,
  p3NetherworldTerrainClassTable,
  planeLocations,
} from '../p3-planes.ts';
import { p3TerrainClass, P3_TERRAIN_NAMES, P3_TERRAIN_UNCLASSIFIED } from '../p3-overworld.ts';
import { decodePln } from '../pln.ts';

const D = resolve('data/phantasieiii/amiga/D');
const EXE_PATH = resolve('data/phantasieiii/amiga/PhantasieIII');

const CODE_FILE_BASE = 0x28;
const HUNK1_FILE_BASE = 0x278c8;

function readCString(exe: Uint8Array, hunk0Addr: number): string {
  let end = CODE_FILE_BASE + hunk0Addr;
  while (exe[end] !== 0) end++;
  return new TextDecoder('latin1').decode(exe.subarray(CODE_FILE_BASE + hunk0Addr, end));
}

function readNameTable(exe: Uint8Array, hunk1Offset: number, count: number): string[] {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  return Array.from({ length: count }, (_, i) =>
    readCString(exe, view.getUint32(HUNK1_FILE_BASE + hunk1Offset + i * 4)),
  );
}

/** hunk-1 0x22AC (file 0x29B74): low byte of each word is the dungeon-letter for indices 1-11. */
function readDungeonLetters(exe: Uint8Array): string[] {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  return Array.from({ length: 12 }, (_, i) => {
    const w = view.getUint16(HUNK1_FILE_BASE + 0x22ac + i * 2);
    return String.fromCharCode(w & 0xff);
  });
}

describe('P3_PLANE_LOCATIONS — the two map-id-gated LocateSpecial() markers per plane', () => {
  it('gives every plane exactly one town (arrival) and one dungeon marker', () => {
    for (const plane of P3_PLANES) {
      const locs = planeLocations(plane.id);
      expect(locs).toHaveLength(2);
      expect(locs.filter((l) => l.type === 'town')).toHaveLength(1);
      expect(locs.filter((l) => l.type === 'dungeon')).toHaveLength(1);
    }
  });

  it('places the town marker on each plane’s declared arrival square', () => {
    for (const plane of P3_PLANES) {
      const town = planeLocations(plane.id).find((l) => l.type === 'town')!;
      expect(town.x).toBe(plane.arrival.x);
      expect(town.y).toBe(plane.arrival.y);
    }
  });

  it('resolves the shared castle-arrival arm’s "14 + $28C2" index arithmetic to the real town-table entries', () => {
    const exe = new Uint8Array(readFileSync(EXE_PATH));
    // 18-entry town table, hunk-1 0x1684 (p3-overworld.test.ts already pins this offset).
    const towns = readNameTable(exe, 0x1684, 18);
    const light = P3_PLANE_LOCATIONS.find((l) => l.planeId === 1 && l.type === 'town')!;
    const dark = P3_PLANE_LOCATIONS.find((l) => l.planeId === 2 && l.type === 'town')!;
    expect(light.index).toBe(15);
    expect(dark.index).toBe(16);
    expect(towns[light.index]).toBe('Light');
    expect(towns[dark.index]).toBe('Dark');
    // The Netherworld's own arrival is a different coordinate with a literal
    // index (17), not "14 + 4" (18, one past the table's end).
    const death = P3_PLANE_LOCATIONS.find((l) => l.planeId === 4 && l.type === 'town')!;
    expect(death.index).toBe(17);
    expect(towns[death.index]).toBe('Death');
  });

  it('resolves the shared castle-dungeon arm’s "9 + $28C2" index arithmetic to the real dungeon-table entries and files', () => {
    const exe = new Uint8Array(readFileSync(EXE_PATH));
    const dungeons = readNameTable(exe, 0x16fc, 12);
    const letters = readDungeonLetters(exe);
    for (const loc of P3_PLANE_LOCATIONS.filter((l) => l.type === 'dungeon')) {
      expect(dungeons[loc.index]).toBe(loc.name);
      expect(loc.file).toBe(`D/DNG${letters[loc.index]}.DAT`);
    }
  });

  it('places every plane marker inside its own grid', () => {
    for (const loc of P3_PLANE_LOCATIONS) {
      const plane = P3_PLANES.find((p) => p.id === loc.planeId)!;
      expect(loc.x).toBeGreaterThanOrEqual(0);
      expect(loc.x).toBeLessThan(plane.width);
      expect(loc.y).toBeGreaterThanOrEqual(0);
      expect(loc.y).toBeLessThan(plane.height);
    }
  });
});

describe('p3NetherworldTerrainClass — the re-banding gated on $28C3 bit 2 (hunk-0 addr 0xA5FA-0xA674)', () => {
  it('reproduces every re-banded boundary the disassembly compares against', () => {
    const expected: [number, string][] = [
      [61, 'Black path'],
      [77, 'Black path'],
      [78, 'Mist'],
      [82, 'Mist'],
      [83, 'Steam'],
      [87, 'Steam'],
      [88, 'Lava'],
      [241, 'Lava'],
    ];
    for (const [value, name] of expected) {
      expect(P3_TERRAIN_NAMES[p3NetherworldTerrainClass(value)]).toBe(name);
    }
  });

  it('overrides the standard chain’s classes for the re-banded ranges', () => {
    // Under the standard (overworld) classifier these values would be Dense
    // Fog / Bright mist / Mountains / Hills — the Netherworld gate rewrites
    // all of them since the re-banding arms run after and always win.
    expect(P3_TERRAIN_NAMES[p3TerrainClass(65)]).toBe('Dense Fog');
    expect(P3_TERRAIN_NAMES[p3NetherworldTerrainClass(65)]).toBe('Black path');
    expect(P3_TERRAIN_NAMES[p3TerrainClass(100)]).toBe('Mountains');
    expect(P3_TERRAIN_NAMES[p3NetherworldTerrainClass(100)]).toBe('Lava');
  });

  it('leaves the River Styx band (>=242) untouched — no re-banding arm reaches past 241', () => {
    expect(P3_TERRAIN_NAMES[p3NetherworldTerrainClass(249)]).toBe('The River Styx');
  });

  it('classifies the previously-unclassified 78-89 gap now that the Netherworld owns it', () => {
    for (const v of [78, 82, 83, 87]) {
      expect(p3TerrainClass(v)).toBe(P3_TERRAIN_UNCLASSIFIED); // overworld: still a gap
      expect(p3NetherworldTerrainClass(v)).not.toBe(P3_TERRAIN_UNCLASSIFIED);
    }
  });

  it('ships a 256-entry lookup table that agrees with the function', () => {
    const table = p3NetherworldTerrainClassTable();
    expect(table).toHaveLength(256);
    for (let v = 0; v < 256; v++) expect(table[v]).toBe(p3NetherworldTerrainClass(v));
  });

  it('keeps every declared band inside the shared name table', () => {
    for (const band of P3_NETHERWORLD_TERRAIN_BANDS) {
      expect(P3_TERRAIN_NAMES[band.class]).toBeTypeOf('string');
      expect(band.min).toBeLessThanOrEqual(band.max);
    }
  });
});

describe('exhaustive $28C2 (active-map id) write census — no fourth non-overworld map exists', () => {
  // `$28C2` is the map-switch routine's target-map-id input (hunk-0 addr
  // `0x1EB18`-`0x1ECAC`, dungeon-format.md §9.0.3.4): 0 = overworld, 1/2 =
  // castles, 4 = Netherworld. The routine's own `and.w #3,d0` dispatch would
  // *structurally* also accept 3, 5, 6, 7... (any value sharing a low
  // 2-bit pattern with 1/2), routing it into the same castle-interior arm
  // and trying to load "D/PLN3"/"D/PLN5"/etc — but only if any code
  // anywhere ever assigns $28C2 such a value. This census settles it: every
  // instruction in the whole 137,352-byte CODE hunk that writes an
  // immediate value to `$28C2` (`move.w #imm,$28c2.l`, encoding `33FC imm16
  // 000028C2`, or `clr.w $28c2.l`, encoding `42B9 000028C2`) writes only
  // 0, 1, 2 or 4 — confirming the user-recalled "three" non-overworld maps
  // (Castle of Light, Castle of Dark, Netherworld) is the complete set, and
  // `D/PLN3`'s inertness (pln.test.ts) isn't an accident of missing content
  // but of the id never being reachable at all.
  const CODE_START = 0x28;
  const CODE_END = 0x28 + 137352;

  function immediateWritesTo28C2(exe: Uint8Array): number[] {
    const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
    const values: number[] = [];
    for (let p = CODE_START; p < CODE_END - 5; p += 2) {
      // clr.w $28c2.l — real observed encoding is 0x4279 (clr.w, absolute
      // long addressing mode 111/001), confirmed against the real file at
      // file offset 0x7722 (addr 0x76FA in dungeon-format.md §9.0.3.4).
      if (view.getUint16(p) === 0x4279 && view.getUint32(p + 2) === 0x000028c2) {
        values.push(0);
      }
      // move.w #imm16,$28c2.l
      if (view.getUint16(p) === 0x33fc && view.getUint32(p + 4) === 0x000028c2) {
        values.push(view.getUint16(p + 2));
      }
    }
    return values;
  }

  it('writes exactly {0, 1, 2, 4} to $28C2 across the whole binary, never 3 or any other value', () => {
    const exe = new Uint8Array(readFileSync(EXE_PATH));
    const values = immediateWritesTo28C2(exe);
    // Sanity: this census must actually find the map-switch routine's own
    // stores (§9.0.3.4's disassembly), not silently match nothing.
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values)).toEqual(new Set([0, 1, 2, 4]));
    expect(values).not.toContain(3);
  });

  it('every P3_PLANES id is one of the values the binary actually writes', () => {
    const exe = new Uint8Array(readFileSync(EXE_PATH));
    const written = new Set(immediateWritesTo28C2(exe));
    for (const plane of P3_PLANES) expect(written.has(plane.id)).toBe(true);
  });
});

describe('100% cell classification against the real D/PLN1, D/PLN2, D/PLN4 files (dungeon-format.md §9.0.3.4)', () => {
  it('classifies every non-marker pln1/pln2 cell under the standard classifier', () => {
    for (const [name, planeId] of [
      ['pln1', 1],
      ['pln2', 2],
    ] as const) {
      const data = new Uint8Array(readFileSync(resolve(D, name)));
      const grid = decodePln(data, 9, 9);
      const markers = new Set(planeLocations(planeId).map((l) => l.y * grid.width + l.x));
      for (let i = 0; i < grid.cells.length; i++) {
        if (markers.has(i)) continue;
        expect(p3TerrainClass(grid.cells[i])).not.toBe(P3_TERRAIN_UNCLASSIFIED);
      }
    }
  });

  it('classifies every non-marker pln4 (Netherworld) cell under the re-banded classifier', () => {
    const data = new Uint8Array(readFileSync(resolve(D, 'pln4')));
    const grid = decodePln(data, 31, 16);
    const markers = new Set(planeLocations(4).map((l) => l.y * grid.width + l.x));
    for (let i = 0; i < grid.cells.length; i++) {
      if (markers.has(i)) continue;
      expect(p3NetherworldTerrainClass(grid.cells[i])).not.toBe(P3_TERRAIN_UNCLASSIFIED);
    }
  });

  it('puts each plane’s two marker cells on distinct, otherwise-unclassified values', () => {
    for (const [name, planeId, w, h, classify] of [
      ['pln1', 1, 9, 9, p3TerrainClass],
      ['pln2', 2, 9, 9, p3TerrainClass],
      ['pln4', 4, 31, 16, p3NetherworldTerrainClass],
    ] as const) {
      const data = new Uint8Array(readFileSync(resolve(D, name)));
      const grid = decodePln(data, w, h);
      const locs = planeLocations(planeId);
      const values = locs.map((l) => grid.cells[l.y * grid.width + l.x]);
      expect(new Set(values).size).toBe(2); // arrival and dungeon markers use distinct art
      for (const v of values) expect(classify(v)).toBe(P3_TERRAIN_UNCLASSIFIED);
    }
  });

  it('the two castles share one floor plan — identical per-row occupied-cell counts (dungeon-format.md §9.0.3.4)', () => {
    const rowCounts = (name: string) => {
      const data = new Uint8Array(readFileSync(resolve(D, name)));
      const grid = decodePln(data, 9, 9);
      const counts: number[] = [];
      for (let y = 0; y < 9; y++) {
        let n = 0;
        for (let x = 0; x < 9; x++) if (grid.cells[y * 9 + x] !== 0xf9) n++;
        counts.push(n);
      }
      return counts;
    };
    expect(rowCounts('pln1')).toEqual(rowCounts('pln2'));
    expect(rowCounts('pln1')).toEqual([0, 3, 5, 6, 5, 5, 5, 3, 0]);
  });
});
