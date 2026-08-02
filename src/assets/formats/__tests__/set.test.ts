import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { decodeSet, remapSetPictureBytes } from '../set.ts';

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
