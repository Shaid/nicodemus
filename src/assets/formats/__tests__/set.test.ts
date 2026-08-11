import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  SET_TILE_BYTES,
  SET_TILE_COUNT,
  SET_TILE_HEIGHT,
  SET_TILE_WIDTH,
  decodeSet,
  decodeSetTiles,
  remapSetPictureBytes,
  renderSetTileSheet,
  setTileIndexForMapValue,
} from '../set.ts';

const SET_PATH = resolve('data/phantasieiii/amiga/Graphics/phantasy.set');

describe('remapSetPictureBytes — column-block byte remap (graphics-formats.md §5.2)', () => {
  it('deposits column-block 0 bytes into the first 8 columns of every row', () => {
    // Column-block 0 covers source bytes 0..1599 (200 lines * 8 bytes).
    // Byte at (line=0, x=0) -> target row 0, column 0.
    // Byte at (line=0, x=7) -> target row 0, column 7.
    // Byte at (line=1, x=0) -> target row 1 (offset 160), column 0.
    const raw = new Uint8Array(32000);
    raw[0] = 0xaa; // column-block 0, line 0, x 0
    raw[7] = 0xbb; // column-block 0, line 0, x 7
    raw[8] = 0xcc; // column-block 0, line 1, x 0
    // Column-block 1 starts at source byte 1600 (line 0, x 0 of block 1) ->
    // target row 0, column 8.
    raw[1600] = 0xdd;

    const buffer = remapSetPictureBytes(raw);
    expect(buffer[0]).toBe(0xaa);
    expect(buffer[7]).toBe(0xbb);
    expect(buffer[160]).toBe(0xcc);
    expect(buffer[8]).toBe(0xdd);
  });
});

describe('decodeSet — phantasy.set (graphics-formats.md §5)', () => {
  it('accounts for every byte of the file with zero unexplained gap', () => {
    const data = new Uint8Array(readFileSync(SET_PATH));
    expect(data.length).toBe(35840);

    const set = decodeSet(data);
    expect(set.unknownByte).toBe(0xfa);
    expect(set.mapHeight).toBe(75);
    expect(set.mapWidth).toBe(50);
    expect(set.mapArray.length).toBe(50 * 75);
    expect(set.mapArray.length).toBe(3750);

    // 35 header + 3750 map + 32000 picture = 35785; 55 bytes trailing pad.
    const accountedFor = 35 + 3750 + 32000;
    expect(accountedFor).toBe(35785);
    expect(data.length - accountedFor).toBe(55);
  });

  it('decodes a legible 320x200 picture using the confirmed embedded palette', () => {
    const data = new Uint8Array(readFileSync(SET_PATH));
    const set = decodeSet(data);
    expect(set.picture.width).toBe(320);
    expect(set.picture.height).toBe(200);
    expect(set.picture.indices.length).toBe(320 * 200);
    expect(set.palette).toHaveLength(16);

    // Not blank: a legible terrain picture uses more than a couple colours.
    const distinctColors = new Set(set.picture.indices).size;
    expect(distinctColors).toBeGreaterThan(2);

    // Structural smoothness check that actually discriminates a correct
    // decode from noise (unlike the distinct-colour count above, which
    // stays high either way): real terrain art has large same-coloured
    // runs, so most horizontally-adjacent pixel pairs share a colour
    // index. A first implementation that skipped the §5.2 column-block
    // byte remap decoded this file to visual static and scored ~0.06
    // (near the ~1/16 chance rate for 16 colours) on this same metric;
    // the corrected decode (visually confirmed: legible city/mountain/
    // forest/swamp terrain panels) scores ~0.53.
    let sameAdjacent = 0;
    let totalAdjacent = 0;
    for (let y = 0; y < set.picture.height; y++) {
      for (let x = 0; x < set.picture.width - 1; x++) {
        const a = set.picture.indices[y * set.picture.width + x];
        const b = set.picture.indices[y * set.picture.width + x + 1];
        if (a === b) sameAdjacent++;
        totalAdjacent++;
      }
    }
    expect(sameAdjacent / totalAdjacent).toBeGreaterThan(0.3);
  });

  it('map array values fall in the documented 0-241 range with high cardinality (continent silhouette, not noise)', () => {
    const data = new Uint8Array(readFileSync(SET_PATH));
    const set = decodeSet(data);
    const distinct = new Set(set.mapArray);
    for (const v of set.mapArray) {
      expect(v).toBeLessThanOrEqual(241);
    }
    expect(distinct.size).toBeGreaterThan(50);
  });
});


describe('decodeSetTiles — the 250-tile terrain bank (graphics-formats.md §5.3)', () => {
  it('splits the picture region into exactly 250 16x16 tiles with nothing left over', () => {
    const set = decodeSet(new Uint8Array(readFileSync(SET_PATH)));
    expect(SET_TILE_COUNT * SET_TILE_BYTES).toBe(32000);
    expect(set.tiles.count).toBe(SET_TILE_COUNT);
    expect(set.tiles.tileWidth).toBe(SET_TILE_WIDTH);
    expect(set.tiles.tileHeight).toBe(SET_TILE_HEIGHT);
    expect(set.tiles.indices).toHaveLength(SET_TILE_COUNT * SET_TILE_WIDTH * SET_TILE_HEIGHT);
    for (const i of set.tiles.indices) expect(i).toBeLessThan(16);
  });

  it('decodes tiles 0 and 1 as flat single-colour fills — the classifier’s two scalar Water arms', () => {
    // A wrong plane order or row stride turns these into 4bpp noise; both
    // are one solid palette index in the real file, which is exactly what
    // "open ocean" should be and what the terrain chain at addr 0xA4A6
    // singles out with its two `== 0` / `== 1` tests before the 2-25 band.
    const set = decodeSet(new Uint8Array(readFileSync(SET_PATH)));
    for (const tile of [0, 1]) {
      const px = set.tiles.indices.subarray(tile * 256, tile * 256 + 256);
      expect(new Set(px).size).toBe(1);
    }
  });

  it('produces structured, non-random art — high same-neighbour rate in BOTH axes', () => {
    // The 320x200 "picture" view scores well horizontally even when the
    // vertical structure is wrong, because a broken row stride still keeps
    // runs inside a row. Requiring both axes is what discriminates the tile
    // reading: a wrong 128-byte stride scatters rows between tiles and the
    // vertical figure collapses towards the ~1/16 chance rate.
    const set = decodeSet(new Uint8Array(readFileSync(SET_PATH)));
    let sameH = 0;
    let totalH = 0;
    let sameV = 0;
    let totalV = 0;
    for (let t = 0; t < set.tiles.count; t++) {
      const px = set.tiles.indices.subarray(t * 256, t * 256 + 256);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 15; x++, totalH++) if (px[y * 16 + x] === px[y * 16 + x + 1]) sameH++;
      }
      for (let y = 0; y < 15; y++) {
        for (let x = 0; x < 16; x++, totalV++) if (px[y * 16 + x] === px[(y + 1) * 16 + x]) sameV++;
      }
    }
    expect(sameH / totalH).toBeGreaterThan(0.35);
    expect(sameV / totalV).toBeGreaterThan(0.35);
  });

  it('gives the named-location marker tiles far more detail than bulk terrain', () => {
    // Marker tiles are building facades — many colours in 16x16. Bulk
    // water/forest fills are near-flat. This is the visual signature that
    // ties dungeon-format.md §9.0.5.5's coordinate table to the artwork.
    const set = decodeSet(new Uint8Array(readFileSync(SET_PATH)));
    const distinct = (t: number) => new Set(set.tiles.indices.subarray(t * 256, t * 256 + 256)).size;
    expect(distinct(25)).toBeGreaterThan(distinct(0)); // Pendragon vs open ocean
    expect(distinct(50)).toBeGreaterThan(distinct(1)); // the shared inn graphic
  });
});

describe('setTileIndexForMapValue — the blitter’s clamp at hunk-0 addr 0x3834', () => {
  it('is the identity for every value the real map array actually contains', () => {
    const set = decodeSet(new Uint8Array(readFileSync(SET_PATH)));
    for (const v of set.mapArray) expect(setTileIndexForMapValue(v, set.tiles.count)).toBe(v);
  });

  it('clamps out-of-bank values into the bank instead of reading past it', () => {
    // The original clamps to 250, one tile past a 250-entry bank — an
    // unreachable off-by-one given the shipped map tops out at 241.
    expect(setTileIndexForMapValue(255)).toBe(SET_TILE_COUNT - 1);
    expect(setTileIndexForMapValue(-3)).toBe(0);
  });
});

describe('renderSetTileSheet', () => {
  it('lays the bank out row-major and preserves every tile’s pixels', () => {
    const bank = decodeSetTiles(new Uint8Array(SET_TILE_BYTES * 3).fill(0xff));
    const sheet = renderSetTileSheet(bank, 2);
    expect(sheet.width).toBe(2 * SET_TILE_WIDTH);
    expect(sheet.height).toBe(2 * SET_TILE_HEIGHT); // 3 tiles -> 2 rows of 2
    // All four planes set -> index 15 everywhere a tile lands.
    expect(sheet.indices[0]).toBe(15);
    expect(sheet.indices[SET_TILE_HEIGHT * sheet.width]).toBe(15); // tile 2, row 0
    expect(sheet.indices[SET_TILE_HEIGHT * sheet.width + SET_TILE_WIDTH]).toBe(0); // empty slot 3
  });

  it('round-trips the real bank tile for tile', () => {
    const set = decodeSet(new Uint8Array(readFileSync(SET_PATH)));
    const columns = 25;
    const sheet = renderSetTileSheet(set.tiles, columns);
    expect(sheet.width).toBe(columns * SET_TILE_WIDTH);
    expect(sheet.height).toBe((SET_TILE_COUNT / columns) * SET_TILE_HEIGHT);
    for (const tile of [0, 25, 50, 197, 249]) {
      const ox = (tile % columns) * SET_TILE_WIDTH;
      const oy = Math.floor(tile / columns) * SET_TILE_HEIGHT;
      for (let y = 0; y < SET_TILE_HEIGHT; y++) {
        for (let x = 0; x < SET_TILE_WIDTH; x++) {
          expect(sheet.indices[(oy + y) * sheet.width + ox + x]).toBe(
            set.tiles.indices[(tile * SET_TILE_HEIGHT + y) * SET_TILE_WIDTH + x],
          );
        }
      }
    }
  });
});
