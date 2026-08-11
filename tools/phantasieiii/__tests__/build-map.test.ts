import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { decodeSet, SET_TILE_HEIGHT, SET_TILE_WIDTH } from '../../../src/assets/formats/set.ts';
import {
  P3_OVERWORLD_LOCATIONS,
  P3_TERRAIN_NAMES,
  p3TerrainClass,
  P3_TERRAIN_UNCLASSIFIED,
} from '../../../src/assets/formats/p3-overworld.ts';
import { buildWorldPois, renderWorldImage, terrainClassColors } from '../build-map.ts';

const SET_PATH = resolve('data/phantasieiii/amiga/Graphics/phantasy.set');
const set = decodeSet(new Uint8Array(readFileSync(SET_PATH)));

describe('buildWorldPois — the 30 hardcoded overworld locations', () => {
  const pois = buildWorldPois(set);

  it('emits one marker per location, sorted north-to-south then west-to-east', () => {
    expect(pois).toHaveLength(P3_OVERWORLD_LOCATIONS.length);
    for (let i = 1; i < pois.length; i++) {
      const prev = pois[i - 1];
      const cur = pois[i];
      expect(cur.y > prev.y || (cur.y === prev.y && cur.x >= prev.x)).toBe(true);
    }
  });

  it('reads each marker’s tile out of the real file rather than assuming one', () => {
    for (const poi of pois) {
      expect(poi.tile).toBe(set.mapArray[poi.y * set.mapWidth + poi.x]);
    }
  });

  it('labels every marker with a name and gives dungeons their D/DNG?.DAT file', () => {
    for (const poi of pois) {
      expect(poi.label.length).toBeGreaterThan(0);
      if (poi.type === 'dungeon') expect(poi.file).toMatch(/^D\/DNG[A-K]\.DAT$/);
      else expect(poi.file).toBeUndefined();
    }
    expect(pois.filter((p) => p.type === 'town')).toHaveLength(14);
    expect(pois.filter((p) => p.type === 'dungeon')).toHaveLength(8);
    expect(pois.filter((p) => p.type === 'inn')).toHaveLength(8);
  });

  it('puts the northernmost marker at Flagler and the southernmost at Tierrin', () => {
    // A transposed or flipped grid would swap these; the file's 50-wide,
    // 75-tall array has exactly one native orientation and this pins it.
    expect(pois[0].label).toBe('Flagler');
    expect(pois[0].y).toBe(5);
    expect(pois[pois.length - 1].label).toBe('Tierrin');
    expect(pois[pois.length - 1].y).toBe(69);
  });
});

describe('terrainClassColors', () => {
  const colors = terrainClassColors(set);

  it('gives a swatch to exactly the classes the shipped map actually uses', () => {
    const used = new Set<number>();
    for (const value of set.mapArray) {
      const cls = p3TerrainClass(value);
      if (cls !== P3_TERRAIN_UNCLASSIFIED) used.add(cls);
    }
    expect(colors).toHaveLength(P3_TERRAIN_NAMES.length);
    for (let cls = 0; cls < colors.length; cls++) {
      if (used.has(cls)) expect(colors[cls]).toMatch(/^#[0-9a-f]{6}$/);
      else expect(colors[cls]).toBeNull();
    }
  });

  it('keeps visually distinct classes distinguishable', () => {
    const named = (name: string) => colors[P3_TERRAIN_NAMES.indexOf(name)];
    expect(named('Water')).not.toBe(named('Meadows'));
    expect(named('Meadows')).not.toBe(named('Forest'));
    expect(named('Mountains')).not.toBe(named('Hills'));
    expect(named('Desert')).not.toBe(named('Pathway'));
  });

  it('sees Water as predominantly blue — the sanity check on the whole chain', () => {
    const water = named(colors, 'Water')!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(water.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });
});

function named(colors: (string | null)[], name: string): string | null {
  return colors[P3_TERRAIN_NAMES.indexOf(name)];
}

describe('renderWorldImage', () => {
  const image = renderWorldImage(set);

  it('renders the whole world at native tile resolution', () => {
    expect(image.width).toBe(set.mapWidth * SET_TILE_WIDTH);
    expect(image.height).toBe(set.mapHeight * SET_TILE_HEIGHT);
    expect(image.pixels).toHaveLength(800 * 1200);
  });

  it('blits each cell’s own tile, pixel for pixel', () => {
    for (const [x, y] of [
      [0, 0],
      [24, 37], // Pendragon
      [49, 74],
    ]) {
      const tile = set.mapArray[y * set.mapWidth + x];
      for (let row = 0; row < SET_TILE_HEIGHT; row++) {
        for (let col = 0; col < SET_TILE_WIDTH; col++) {
          expect(image.pixels[(y * SET_TILE_HEIGHT + row) * image.width + x * SET_TILE_WIDTH + col]).toBe(
            set.tiles.indices[(tile * SET_TILE_HEIGHT + row) * SET_TILE_WIDTH + col],
          );
        }
      }
    }
  });

  it('surrounds the landmass with the flat ocean tile on all four edges', () => {
    // The world is one continent ringed by water; every border cell of the
    // 50 x 75 grid is a Water-band value. A transposed read of the map array
    // would put land against an edge and break this.
    const edge: number[] = [];
    for (let x = 0; x < set.mapWidth; x++) {
      edge.push(set.mapArray[x], set.mapArray[(set.mapHeight - 1) * set.mapWidth + x]);
    }
    for (let y = 0; y < set.mapHeight; y++) {
      edge.push(set.mapArray[y * set.mapWidth], set.mapArray[y * set.mapWidth + set.mapWidth - 1]);
    }
    for (const value of edge) expect(P3_TERRAIN_NAMES[p3TerrainClass(value)]).toBe('Water');
  });
});
