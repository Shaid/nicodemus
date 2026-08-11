import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  decodePln,
  PLN_CASTLE_WIDTH,
  PLN_CASTLE_HEIGHT,
  PLN_NETHERWORLD_WIDTH,
  PLN_NETHERWORLD_HEIGHT,
} from '../pln.ts';
import { decodeSet, setTileIndexForMapValue } from '../set.ts';

const D = resolve('data/phantasieiii/amiga/D');
const SET_PATH = resolve('data/phantasieiii/amiga/Graphics/phantasy.set');

describe('decodePln — D/PLN1, D/PLN2, D/PLN4 (dungeon-format.md §9.0.3.4)', () => {
  it('reads the Castle of Light (D/pln1) as a 9x9 grid matching the engine read length', () => {
    const data = new Uint8Array(readFileSync(resolve(D, 'pln1')));
    // addr 0x1EB18's map-switch routine reads exactly #$51 = 81 bytes for either castle.
    expect(data.length).toBeGreaterThanOrEqual(PLN_CASTLE_WIDTH * PLN_CASTLE_HEIGHT);
    const grid = decodePln(data, PLN_CASTLE_WIDTH, PLN_CASTLE_HEIGHT);
    expect(grid.cells).toHaveLength(81);
  });

  it('reads the Castle of Dark (D/pln2) as a 9x9 grid', () => {
    const data = new Uint8Array(readFileSync(resolve(D, 'pln2')));
    const grid = decodePln(data, PLN_CASTLE_WIDTH, PLN_CASTLE_HEIGHT);
    expect(grid.cells).toHaveLength(81);
  });

  it('reads the Netherworld (D/pln4) as a 31x16 grid matching the engine read length #$1F0', () => {
    const data = new Uint8Array(readFileSync(resolve(D, 'pln4')));
    const grid = decodePln(data, PLN_NETHERWORLD_WIDTH, PLN_NETHERWORLD_HEIGHT);
    expect(grid.cells).toHaveLength(496);
  });

  it('throws rather than silently truncating a too-short file', () => {
    expect(() => decodePln(new Uint8Array(10), PLN_CASTLE_WIDTH, PLN_CASTLE_HEIGHT)).toThrow();
  });

  it('pln1/pln2’s 128-byte disk-block padding is contentLength mod 128 (§9.0.3.1’s free content-length oracle)', () => {
    for (const name of ['pln1', 'pln2']) {
      const data = readFileSync(resolve(D, name));
      expect(data.length).toBe(128);
      expect(data[81]).toBe(81 % 128); // first pad byte
      expect(data[data.length - 1]).toBe(81 % 128); // last pad byte
    }
  });

  it('pln4’s padding is 496 mod 128 = 112', () => {
    const data = readFileSync(resolve(D, 'pln4'));
    expect(data.length).toBe(512);
    expect(data[496]).toBe(496 % 128);
    expect(data[data.length - 1]).toBe(496 % 128);
  });

  it('pln3 is the confirmed-inert 2-byte flag file, not a fourth grid (map id 3 is never assigned — see p3-planes.test.ts)', () => {
    const data = readFileSync(resolve(D, 'pln3'));
    expect(data.length).toBe(128);
    // 126 of 128 bytes are 0x02 per dungeon-format.md §9.0.3's original measurement.
    const twos = Array.from(data).filter((b) => b === 0x02).length;
    expect(twos).toBe(126);
  });
});

describe('the shared tile bank — castle/Netherworld cell values resolve in the same 250-tile bank as the overworld', () => {
  const set = decodeSet(new Uint8Array(readFileSync(SET_PATH)));

  it('keeps every real cell value from all three files within the bank’s clamp (0-250)', () => {
    for (const [name, w, h] of [
      ['pln1', PLN_CASTLE_WIDTH, PLN_CASTLE_HEIGHT],
      ['pln2', PLN_CASTLE_WIDTH, PLN_CASTLE_HEIGHT],
      ['pln4', PLN_NETHERWORLD_WIDTH, PLN_NETHERWORLD_HEIGHT],
    ] as const) {
      const data = new Uint8Array(readFileSync(resolve(D, name)));
      const grid = decodePln(data, w, h);
      for (const value of grid.cells) {
        const tile = setTileIndexForMapValue(value, set.tiles.count);
        expect(tile).toBeGreaterThanOrEqual(0);
        expect(tile).toBeLessThan(set.tiles.count);
      }
    }
  });

  it('pln4’s max border value (0xF9 = 249) is the bank’s last real tile, not the off-by-one clamp slot', () => {
    const data = new Uint8Array(readFileSync(resolve(D, 'pln4')));
    const grid = decodePln(data, PLN_NETHERWORLD_WIDTH, PLN_NETHERWORLD_HEIGHT);
    expect(Math.max(...grid.cells)).toBe(0xf9);
    expect(setTileIndexForMapValue(0xf9, set.tiles.count)).toBe(249);
  });
});
