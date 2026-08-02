import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { decodeColorWord, decodePalette16, indicesToRGBA, type RGB } from '../palette.ts';

describe('decodeColorWord — ST variant', () => {
  it('decodes the linear 0-7 -> 0-255 ramp', () => {
    expect(decodeColorWord(0x0000, 'st')).toEqual({ r: 0, g: 0, b: 0 });
    expect(decodeColorWord(0x0777, 'st')).toEqual({ r: 0xff, g: 0xff, b: 0xff });
    // r nibble = 4 -> ST_CHANNEL_LOOKUP[4] = 0x92; g/b nibble = 0 -> 0x00.
    expect(decodeColorWord(0x0400, 'st')).toEqual({ r: 0x92, g: 0x00, b: 0x00 });
  });
});

// data-tables.md §1.3 — the 16 confirmed P1 palette entries decoded via the
// AmigaToST even-nibble lookup, read from game+0x194BC. This is the exact
// table from that section, used as a golden byte-exact regression test.
const CONFIRMED_P1_PALETTE: { index: number; word: number; rgb: RGB | null }[] = [
  { index: 0, word: 0x0000, rgb: { r: 0, g: 0, b: 0 } }, // black
  { index: 1, word: 0x0a42, rgb: { r: 182, g: 73, b: 36 } }, // brown
  { index: 2, word: 0x0e00, rgb: { r: 255, g: 0, b: 0 } }, // red
  { index: 3, word: 0x0e60, rgb: { r: 255, g: 109, b: 0 } }, // orange
  { index: 4, word: 0x0ea0, rgb: { r: 255, g: 182, b: 0 } }, // gold
  { index: 5, word: 0x0ee0, rgb: { r: 255, g: 255, b: 0 } }, // yellow
  { index: 6, word: 0x00e0, rgb: { r: 0, g: 255, b: 0 } }, // green
  { index: 7, word: 0x0080, rgb: { r: 0, g: 146, b: 0 } }, // dark green
  { index: 8, word: 0x0884, rgb: { r: 146, g: 146, b: 73 } }, // olive
  { index: 9, word: 0x00ee, rgb: { r: 0, g: 255, b: 255 } }, // cyan
  { index: 10, word: 0x00ae, rgb: { r: 0, g: 182, b: 255 } }, // sky blue
  { index: 11, word: 0x004e, rgb: { r: 0, g: 73, b: 255 } }, // blue
  // Index 12 (word 0x0EBB) is the documented open anomaly: odd green/blue
  // nibbles (11, 11) fall through the even-only AmigaToST lookup to 0. No
  // confirmed real-world RGB triple exists for this entry — the doc
  // explicitly declines to give one ("odd nibbles — see below"). We assert
  // only that our lookup mechanically reproduces the documented mechanism
  // (odd nibble -> 0), not a "corrected" colour — see the separate test below.
  { index: 13, word: 0x0888, rgb: { r: 146, g: 146, b: 146 } }, // grey
  { index: 14, word: 0x0e2a, rgb: { r: 255, g: 36, b: 182 } }, // magenta
  { index: 15, word: 0x0eee, rgb: { r: 255, g: 255, b: 255 } }, // white
];

describe('decodeColorWord — AmigaToST variant (data-tables.md §1.3)', () => {
  for (const entry of CONFIRMED_P1_PALETTE) {
    it(`index ${entry.index} (word 0x${entry.word.toString(16)}) decodes to the confirmed RGB888 value`, () => {
      expect(decodeColorWord(entry.word, 'amigaToSt')).toEqual(entry.rgb);
    });
  }

  it('index 12 (word 0x0EBB, the documented odd-nibble anomaly) is NOT smoothed over: odd nibbles map to 0 per the even-only lookup table, not "fixed" to a plausible colour', () => {
    // R nibble = 14 (even) -> 0xFF. G/B nibbles = 11 (odd) -> 0 (unpopulated
    // slot in AMIGA_TO_ST_CHANNEL_LOOKUP). This is the raw mechanical
    // result of the confirmed lookup table, preserved as-is per the task's
    // explicit instruction not to "fix" this case.
    expect(decodeColorWord(0x0ebb, 'amigaToSt')).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe('decodePalette16', () => {
  it('reads 16 big-endian words starting at offset and decodes each', () => {
    const data = new Uint8Array(32);
    // word 0 = 0x0000 (black), word 1 = 0x0700 (max ST red nibble = 7 -> 0xFF)
    data[2] = 0x07;
    data[3] = 0x00;
    const colors = decodePalette16(data, 0, 'st');
    expect(colors).toHaveLength(16);
    expect(colors[0]).toEqual({ r: 0, g: 0, b: 0 });
    expect(colors[1]).toEqual({ r: 0xff, g: 0, b: 0 });
  });

  it('reads the real confirmed P1 palette table from game+0x194BC byte-exactly', () => {
    const gamePath = resolve('data/phantasie/amiga/game');
    const game = new Uint8Array(readFileSync(gamePath));
    const colors = decodePalette16(game, 0x194bc, 'amigaToSt');
    expect(colors).toHaveLength(16);
    for (const entry of CONFIRMED_P1_PALETTE) {
      expect(colors[entry.index]).toEqual(entry.rgb);
    }
    // Confirm the anomalous entry is read as documented too.
    expect(colors[12]).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe('indicesToRGBA', () => {
  it('maps palette indices to RGBA bytes, opaque by default (index 0 included)', () => {
    const palette: RGB[] = [
      { r: 1, g: 2, b: 3 },
      { r: 4, g: 5, b: 6 },
    ];
    const rgba = indicesToRGBA(new Uint8Array([0, 1]), palette, false);
    expect(Array.from(rgba)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it('punches index 0 through as transparent when requested', () => {
    const palette: RGB[] = [{ r: 1, g: 2, b: 3 }];
    const rgba = indicesToRGBA(new Uint8Array([0]), palette, true);
    expect(Array.from(rgba)).toEqual([1, 2, 3, 0]);
  });
});
