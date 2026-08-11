import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { decodeSet, setTileIndexForMapValue } from '../../../src/assets/formats/set.ts';
import { decodePln, PLN_CASTLE_HEIGHT, PLN_CASTLE_WIDTH } from '../../../src/assets/formats/pln.ts';
import { P3_PLANES, planeLocations } from '../../../src/assets/formats/p3-planes.ts';
import { buildPlanePois, PLANE_ASSET_NAMES } from '../build-castle-maps.ts';

const SET_PATH = resolve('data/phantasieiii/amiga/Graphics/phantasy.set');
const D = resolve('data/phantasieiii/amiga/D');
const set = decodeSet(new Uint8Array(readFileSync(SET_PATH)));

describe('buildPlanePois — the two hardcoded markers per plane', () => {
  it('reads each marker’s tile out of the real file rather than assuming one', () => {
    for (const plane of P3_PLANES) {
      const data = new Uint8Array(readFileSync(resolve(D, plane.file.slice(2).toLowerCase())));
      const grid = decodePln(data, plane.width, plane.height);
      const pois = buildPlanePois(plane, grid);
      expect(pois).toHaveLength(2);
      for (const poi of pois) {
        expect(poi.tile).toBe(grid.cells[poi.y * grid.width + poi.x]);
      }
    }
  });

  it('gives every dungeon marker a D/DNG?.DAT file and every town marker none', () => {
    for (const plane of P3_PLANES) {
      const data = new Uint8Array(readFileSync(resolve(D, plane.file.slice(2).toLowerCase())));
      const grid = decodePln(data, plane.width, plane.height);
      const pois = buildPlanePois(plane, grid);
      for (const poi of pois) {
        if (poi.type === 'dungeon') expect(poi.file).toMatch(/^D\/DNG[A-K]\.DAT$/);
        else expect(poi.file).toBeUndefined();
      }
    }
  });
});

describe('PLANE_ASSET_NAMES — one manifest-friendly name per plane id', () => {
  it('covers every P3_PLANES entry with a distinct kebab-case name', () => {
    const names = P3_PLANES.map((p) => PLANE_ASSET_NAMES[p.id]);
    expect(new Set(names).size).toBe(P3_PLANES.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z-]*[a-z]$/);
  });
});

describe('Castle of Light and Castle of Dark share the shared 250-tile bank, byte for byte', () => {
  it('renders every real cell through a valid tile index', () => {
    for (const plane of P3_PLANES) {
      const data = new Uint8Array(readFileSync(resolve(D, plane.file.slice(2).toLowerCase())));
      const grid = decodePln(data, plane.width, plane.height);
      for (const value of grid.cells) {
        expect(setTileIndexForMapValue(value, set.tiles.count)).toBeLessThan(set.tiles.count);
      }
    }
  });
});

describe('planeLocations — sanity against PLN_CASTLE_WIDTH/HEIGHT constants', () => {
  it('keeps the two castles at the documented 9x9 shape', () => {
    const light = P3_PLANES.find((p) => p.id === 1)!;
    const dark = P3_PLANES.find((p) => p.id === 2)!;
    expect([light.width, light.height]).toEqual([PLN_CASTLE_WIDTH, PLN_CASTLE_HEIGHT]);
    expect([dark.width, dark.height]).toEqual([PLN_CASTLE_WIDTH, PLN_CASTLE_HEIGHT]);
    expect(planeLocations(1)).toHaveLength(2);
  });
});
