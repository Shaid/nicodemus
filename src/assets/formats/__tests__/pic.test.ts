import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  decodePic,
  picGreyscalePalette,
  picToRGBA,
  PIC_FILES_USING_MONSTER_RACE_PALETTE,
  PIC_PALETTE_SLOT_BY_FILE,
  decodeP2Pic,
  P2_PIC_PALETTE_SOURCE_BY_FILE,
} from '../pic.ts';
import {
  readP1Palette,
  readP1PaletteSlot,
  P1_PALETTE_SLOT_OFFSETS,
  readP2Palette,
  readP2CoverPalette,
  readP2TownPalette,
} from '../exe-data.ts';

const P1_DIR = resolve('data/phantasie/amiga');
const GAME_PATH = resolve('data/phantasie/amiga/game');
const P2_DISK1 = resolve('data/phantasieii/atarist/extracted/disk1');
const P2_DISK2 = resolve('data/phantasieii/atarist/extracted/disk2');
const P2_EXE_PATH = resolve(P2_DISK1, 'PHANT.PRG');
const P2_START_PATH = resolve(P2_DISK1, 'START.PRG');

describe('decodePic — .pic full-screen pictures (graphics-formats.md §3)', () => {
  const fullScreenFiles = ['cover1.pic', 'cover2.pic', 'decor.pic', 'final.pic', 'pelnor.pic'];

  for (const name of fullScreenFiles) {
    it(`decodes ${name} as a 320x200 image (32,000 bytes, zero unexplained remainder)`, () => {
      const data = new Uint8Array(readFileSync(resolve(P1_DIR, name)));
      expect(data.length).toBe(32000);
      const image = decodePic(data);
      expect(image.width).toBe(320);
      expect(image.height).toBe(200);
      expect(image.indices.length).toBe(320 * 200);
      // Legible art uses more than a couple of colour indices.
      expect(new Set(image.indices).size).toBeGreaterThan(2);
    });
  }

  it('decodes logo.pic as a 176x80 image (7,040 bytes)', () => {
    const data = new Uint8Array(readFileSync(resolve(P1_DIR, 'logo.pic')));
    expect(data.length).toBe(7040);
    const image = decodePic(data);
    expect(image.width).toBe(176);
    expect(image.height).toBe(80);
    expect(image.indices.length).toBe(176 * 80);
  });

  it('rejects a file whose size does not match any confirmed .pic dimension', () => {
    expect(() => decodePic(new Uint8Array(100))).toThrow(/Unrecognised \.pic file size/);
  });

  it('every .pic file actually present in data/phantasie/amiga decodes cleanly', () => {
    const files = readdirSync(P1_DIR).filter((f) => /\.pic$/i.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const data = new Uint8Array(readFileSync(resolve(P1_DIR, f)));
      expect(() => decodePic(data)).not.toThrow();
    }
  });
});

describe('picToRGBA / picGreyscalePalette', () => {
  it('renders a 16-level neutral greyscale ramp', () => {
    const palette = picGreyscalePalette();
    expect(palette).toHaveLength(16);
    expect(palette[0]).toEqual({ r: 0, g: 0, b: 0 });
    expect(palette[15]).toEqual({ r: 255, g: 255, b: 255 });
    // Strictly increasing.
    for (let i = 1; i < 16; i++) expect(palette[i].r).toBeGreaterThan(palette[i - 1].r);
  });

  it('produces an RGBA buffer of the right size, fully opaque', () => {
    const data = new Uint8Array(readFileSync(resolve(P1_DIR, 'logo.pic')));
    const image = decodePic(data);
    const rgba = picToRGBA(image);
    expect(rgba.length).toBe(176 * 80 * 4);
    for (let i = 0; i < rgba.length; i += 4) expect(rgba[i + 3]).toBe(255);
  });
});

describe('PIC_FILES_USING_MONSTER_RACE_PALETTE — graphics-formats.md §3/§9', () => {
  it('names exactly decor.pic and final.pic — confirmed via HUNK_RELOC32 cross-reference (game+0xBA48-0xC370 calling the palette-set helper at 0x1F1CA with game+0x194BC)', () => {
    expect(PIC_FILES_USING_MONSTER_RACE_PALETTE).toEqual(['decor', 'final']);
  });

  it('decor.pic and final.pic render legibly under the confirmed P1 monster/race palette (game+0x194BC), not just the greyscale substitute', () => {
    const game = new Uint8Array(readFileSync(GAME_PATH));
    const palette = readP1Palette(game);
    for (const name of PIC_FILES_USING_MONSTER_RACE_PALETTE) {
      const data = new Uint8Array(readFileSync(resolve(P1_DIR, `${name}.pic`)));
      const image = decodePic(data);
      const rgba = picToRGBA(image, palette);
      expect(rgba.length).toBe(image.width * image.height * 4);
      // Legible art uses more than a couple of distinct colour indices.
      expect(new Set(image.indices).size).toBeGreaterThan(2);
      for (let i = 0; i < rgba.length; i += 4) expect(rgba[i + 3]).toBe(255);
    }
  });
});

// graphics-formats.md §3 / data-tables.md §1.3a — the per-screen palette
// array and each .pic file's confirmed slot. Expectations below are read
// out of the real executable rather than hand-copied, except the slot
// numbers themselves (which come from HUNK_RELOC32 operand resolution at
// each governing SetPalette call site).
describe('PIC_PALETTE_SLOT_BY_FILE — per-file executable palette (graphics-formats.md §3)', () => {
  const game = new Uint8Array(readFileSync(GAME_PATH));

  it('covers every .pic file actually present on disk', () => {
    const files = readdirSync(P1_DIR).filter((f) => /\.pic$/i.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const name = f.replace(/\.pic$/i, '').toLowerCase();
      expect(PIC_PALETTE_SLOT_BY_FILE[name]).toBeTypeOf('number');
    }
  });

  it('the five palette slots are contiguous 32-byte tables at game+0x1945C', () => {
    expect(P1_PALETTE_SLOT_OFFSETS[0]).toBe(0x1945c);
    for (let i = 1; i < P1_PALETTE_SLOT_OFFSETS.length; i++) {
      expect(P1_PALETTE_SLOT_OFFSETS[i] - P1_PALETTE_SLOT_OFFSETS[i - 1]).toBe(32);
    }
  });

  it('slot 0 is the all-black blank-screen table, not a real palette — so no .pic may reference it', () => {
    const black = readP1PaletteSlot(game, 0);
    expect(black).toHaveLength(16);
    for (const c of black) expect(c).toEqual({ r: 0, g: 0, b: 0 });
    expect(Object.values(PIC_PALETTE_SLOT_BY_FILE)).not.toContain(0);
  });

  it('cover1.pic and cover2.pic share a slot (they share one stone-arch frame drawn from the same indices)', () => {
    expect(PIC_PALETTE_SLOT_BY_FILE.cover1).toBe(PIC_PALETTE_SLOT_BY_FILE.cover2);
    expect(PIC_PALETTE_SLOT_BY_FILE.cover1).toBe(4);
  });

  it('logo.pic inherits pelnor.pic’s slot (it is drawn as an overlay on the town screen and sets no palette of its own)', () => {
    expect(PIC_PALETTE_SLOT_BY_FILE.logo).toBe(PIC_PALETTE_SLOT_BY_FILE.pelnor);
    expect(PIC_PALETTE_SLOT_BY_FILE.pelnor).toBe(1);
  });

  it('the town slot and the title slot really do disagree on the indices the renders were judged by', () => {
    const town = readP1PaletteSlot(game, PIC_PALETTE_SLOT_BY_FILE.pelnor);
    const title = readP1PaletteSlot(game, PIC_PALETTE_SLOT_BY_FILE.cover1);
    // Index 11 is pelnor.pic's road (11,546 px) — grey 0x666 under the town
    // palette, blue 0x04E under the title palette.
    expect(town[11]).toEqual({ r: 0x66, g: 0x66, b: 0x66 });
    expect(title[11]).toEqual({ r: 0x00, g: 0x44, b: 0xee });
    // Index 6 is pelnor.pic's foliage — green 0x0E0 vs dark blue 0x048.
    expect(town[6]).toEqual({ r: 0x00, g: 0xee, b: 0x00 });
    expect(title[6]).toEqual({ r: 0x00, g: 0x44, b: 0x88 });
    // Index 4 is logo.pic's Andromeda star — yellow 0xEE0 vs dark red 0xC22.
    expect(town[4]).toEqual({ r: 0xee, g: 0xee, b: 0x00 });
    expect(title[4]).toEqual({ r: 0xcc, g: 0x22, b: 0x22 });
  });

  it('the native Amiga decode preserves odd nibbles the ST even-nibble lookup would zero (game+0x194DC index 2 = 0x0EB0)', () => {
    const title = readP1PaletteSlot(game, 4);
    // 0x0EB0 -> R=14, G=11, B=0 -> (0xEE, 0xBB, 0x00). The AmigaToST lookup
    // would drop G to 0, turning this yellow-orange into pure red.
    expect(title[2]).toEqual({ r: 0xee, g: 0xbb, b: 0x00 });
  });

  it('every .pic renders fully opaque under its confirmed slot', () => {
    for (const [name, slot] of Object.entries(PIC_PALETTE_SLOT_BY_FILE)) {
      const data = new Uint8Array(readFileSync(resolve(P1_DIR, `${name}.pic`)));
      const image = decodePic(data);
      const rgba = picToRGBA(image, readP1PaletteSlot(game, slot));
      expect(rgba.length).toBe(image.width * image.height * 4);
      for (let i = 0; i < rgba.length; i += 4) expect(rgba[i + 3]).toBe(255);
    }
  });
});

// graphics-formats.md §10 — Phantasie II's raw `.PIC` full-screen pictures.
// ST word-Interleaved-by-2 layout (like the already-confirmed `.PAT` sprite
// banks), not P1's contiguous Planar layout, plus three disassembly-traced
// per-file palette sources.
describe('decodeP2Pic — .PIC full-screen pictures (graphics-formats.md §10)', () => {
  const files: Array<{ path: string; name: string; size: number; width: number; height: number; bitplanes: number }> = [
    { path: resolve(P2_DISK1, 'COVER1.PIC'), name: 'cover1', size: 32000, width: 320, height: 200, bitplanes: 4 },
    { path: resolve(P2_DISK1, 'COVER2.PIC'), name: 'cover2', size: 21600, width: 320, height: 135, bitplanes: 4 },
    { path: resolve(P2_DISK2, 'PELNOR.PIC'), name: 'pelnor', size: 32000, width: 320, height: 200, bitplanes: 4 },
    { path: resolve(P2_DISK2, 'DECOR.PIC'), name: 'decor', size: 24800, width: 320, height: 155, bitplanes: 4 },
    { path: resolve(P2_DISK2, 'FINAL2.PIC'), name: 'final2', size: 25600, width: 320, height: 160, bitplanes: 4 },
    { path: resolve(P2_DISK2, 'CROWD.PIC'), name: 'crowd', size: 11160, width: 320, height: 93, bitplanes: 3 },
  ];

  for (const f of files) {
    it(`decodes ${f.name}.PIC as a confirmed ${f.width}x${f.height}x${f.bitplanes}bpp image with zero unexplained remainder`, () => {
      const data = new Uint8Array(readFileSync(f.path));
      expect(data.length).toBe(f.size);
      const image = decodeP2Pic(data);
      expect(image.width).toBe(f.width);
      expect(image.height).toBe(f.height);
      expect(image.indices.length).toBe(f.width * f.height);
      // Every value fits the file's own bitplane count (no out-of-range index).
      const maxIndex = (1 << f.bitplanes) - 1;
      for (const idx of image.indices) expect(idx).toBeLessThanOrEqual(maxIndex);
      // Legible art uses more than a couple of distinct colour indices.
      expect(new Set(image.indices).size).toBeGreaterThan(2);
    });
  }

  it('rejects a file whose size does not match any confirmed P2 .PIC shape', () => {
    expect(() => decodeP2Pic(new Uint8Array(100))).toThrow(/Unrecognised P2 \.PIC file size/);
  });

  it('cover1.pic and pelnor.pic — both 32,000 bytes — decode to the same dimensions but are NOT byte-identical (two different real pictures)', () => {
    const cover1 = new Uint8Array(readFileSync(resolve(P2_DISK1, 'COVER1.PIC')));
    const pelnor = new Uint8Array(readFileSync(resolve(P2_DISK2, 'PELNOR.PIC')));
    expect(cover1).not.toEqual(pelnor);
  });
});

describe('P2_PIC_PALETTE_SOURCE_BY_FILE — graphics-formats.md §10', () => {
  it('maps all six shipped .PIC files to one of the three confirmed palette sources', () => {
    expect(P2_PIC_PALETTE_SOURCE_BY_FILE).toEqual({
      cover1: 'cover',
      cover2: 'cover',
      pelnor: 'town',
      decor: 'monsterRace',
      final2: 'monsterRace',
      crowd: 'monsterRace',
    });
  });

  it('every .PIC file renders fully opaque, legible art under its confirmed palette source', () => {
    const exe = new Uint8Array(readFileSync(P2_EXE_PATH));
    const startPrg = new Uint8Array(readFileSync(P2_START_PATH));
    const paletteBySource = {
      cover: readP2CoverPalette(startPrg),
      town: readP2TownPalette(exe),
      monsterRace: readP2Palette(exe),
    };
    const files = [
      { path: resolve(P2_DISK1, 'COVER1.PIC'), name: 'cover1' },
      { path: resolve(P2_DISK1, 'COVER2.PIC'), name: 'cover2' },
      { path: resolve(P2_DISK2, 'PELNOR.PIC'), name: 'pelnor' },
      { path: resolve(P2_DISK2, 'DECOR.PIC'), name: 'decor' },
      { path: resolve(P2_DISK2, 'FINAL2.PIC'), name: 'final2' },
      { path: resolve(P2_DISK2, 'CROWD.PIC'), name: 'crowd' },
    ];
    for (const f of files) {
      const source = P2_PIC_PALETTE_SOURCE_BY_FILE[f.name];
      const palette = paletteBySource[source];
      const data = new Uint8Array(readFileSync(f.path));
      const image = decodeP2Pic(data);
      const rgba = picToRGBA(image, palette);
      expect(rgba.length).toBe(image.width * image.height * 4);
      for (let i = 0; i < rgba.length; i += 4) expect(rgba[i + 3]).toBe(255);
    }
  });

  it('cover1/cover2 and pelnor use genuinely different palettes (title screen vs. town)', () => {
    const exe = new Uint8Array(readFileSync(P2_EXE_PATH));
    const startPrg = new Uint8Array(readFileSync(P2_START_PATH));
    const cover = readP2CoverPalette(startPrg);
    const town = readP2TownPalette(exe);
    expect(cover).not.toEqual(town);
  });
});
