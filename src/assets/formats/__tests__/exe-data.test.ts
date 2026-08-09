import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  readHunkHeader,
  parseHunks,
  readP1MonsterNames,
  readP1RaceNames,
  readP1Palette,
  readP3SkillTables,
  readP2MonsterNames,
  readP2RaceNames,
  readP2Palette,
  readP2CoverPalette,
  readP2TownPalette,
  readP3ItemNames,
  readP3SpellNames,
  readP3RaceNames,
} from '../exe-data.ts';

const GAME_PATH = resolve('data/phantasie/amiga/game');
const P3_EXE_PATH = resolve('data/phantasieiii/amiga/PhantasieIII');
const P2_EXE_PATH = resolve('data/phantasieii/atarist/extracted/disk1/PHANT.PRG');
const P2_START_PATH = resolve('data/phantasieii/atarist/extracted/disk1/START.PRG');

describe('readHunkHeader / parseHunks — against real HUNK executables', () => {
  it('parses `game`\'s HUNK_HEADER and reproduces every structural fact confirmed in data-tables.md §8', () => {
    const game = new Uint8Array(readFileSync(GAME_PATH));
    expect(game.length).toBe(193804);

    const header = readHunkHeader(game);
    expect(header.tableSize).toBe(240);
    expect(header.firstHunk).toBe(0);
    expect(header.lastHunk).toBe(239);
    // "the hunk-size table itself ends at file offset 980"
    expect(header.headerEnd).toBe(980);
    // "hunk size table sums to 167,788 bytes against a 193,804-byte file"
    expect(header.hunkSizes.reduce((a, b) => a + b, 0)).toBe(167788);
    // "hunk 0's own HUNK_CODE data block is only 460 bytes"
    expect(header.hunkSizes[0]).toBe(460);
  });

  it('parseHunks extracts CODE/DATA from `game` without throwing, hunk 0 CODE matching the confirmed 460-byte size', () => {
    const game = new Uint8Array(readFileSync(GAME_PATH));
    const parsed = parseHunks(game);
    expect(parsed.code.length).toBe(460);
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  it('parseHunks also parses the PhantasieIII executable without throwing', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    expect(exe.length).toBe(174928);
    expect(() => parseHunks(exe)).not.toThrow();
  });

  it('rejects a buffer without the HUNK_HEADER magic', () => {
    const notAnExe = new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4]);
    expect(() => readHunkHeader(notAnExe)).toThrow(/HUNK_HEADER/);
  });
});

describe('readP1MonsterNames — data-tables.md §1.1', () => {
  it('reads the confirmed first 10 monster names byte-exactly', () => {
    const game = new Uint8Array(readFileSync(GAME_PATH));
    const names = readP1MonsterNames(game);
    expect(names).toHaveLength(80);
    expect(names.slice(0, 10)).toEqual([
      'SKELETON',
      'BANTIR',
      'DRIP SLIME',
      'SKUM',
      'GIANT ANT',
      'GIANT BEE',
      'VIPER',
      'COYOTE',
      'ORC',
      'KOBOLD',
    ]);
  });
});

describe('readP1RaceNames — data-tables.md §1.4', () => {
  it('reads all 16 confirmed race names in order with no decode drift', () => {
    const game = new Uint8Array(readFileSync(GAME_PATH));
    const names = readP1RaceNames(game);
    expect(names).toEqual([
      'HUMAN',
      'DWARF',
      'ELF',
      'HALFLING',
      'GNOME',
      'PIXIE',
      'SPRITE',
      'OGRE',
      'GNOLL',
      'TROLL',
      'KOBOLD',
      'ORC',
      'GOBLIN',
      'LIZ.MAN',
      'MINOTAUR',
      'UNDEAD',
    ]);
  });
});

describe('readP1Palette — data-tables.md §1.3', () => {
  it('decodes the confirmed 16-colour palette, matching decodePalette16 directly', () => {
    const game = new Uint8Array(readFileSync(GAME_PATH));
    const palette = readP1Palette(game);
    expect(palette).toHaveLength(16);
    expect(palette[0]).toEqual({ r: 0, g: 0, b: 0 });
    expect(palette[2]).toEqual({ r: 255, g: 0, b: 0 });
    expect(palette[15]).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe('readP3SkillTables — data-tables.md §5', () => {
  it('reads the Attack table with the confirmed Fighter and Thief progressions', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    const tables = readP3SkillTables(exe);
    const attack = tables.find((t) => t.name === 'Attack');
    expect(attack).toBeDefined();
    expect(attack!.byClass.Fighter).toEqual([
      100, 110, 120, 135, 145, 155, 165, 180, 190, 200, 210, 220, 235, 245, 255,
    ]);
    expect(attack!.byClass.Thief).toEqual([
      70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140,
    ]);
  });

  it('reads all 8 skill tables, each with 6 classes of 15 levels', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    const tables = readP3SkillTables(exe);
    expect(tables).toHaveLength(8);
    expect(tables.map((t) => t.name)).toEqual([
      'Attack',
      'Parry',
      'Swim',
      'Listen',
      'Spot trap',
      'Disarm',
      'Spot item',
      'Pick lock',
    ]);
    for (const table of tables) {
      const classes = Object.keys(table.byClass);
      expect(classes).toHaveLength(6);
      for (const cls of classes) {
        expect(table.byClass[cls as keyof typeof table.byClass]).toHaveLength(15);
      }
    }
  });
});

describe('readP2MonsterNames — data-tables.md §2.1', () => {
  it('reads the confirmed first 10 monster names byte-exactly, including P2-specific entries', () => {
    const exe = new Uint8Array(readFileSync(P2_EXE_PATH));
    expect(exe.length).toBe(155785);
    const names = readP2MonsterNames(exe);
    expect(names).toHaveLength(80);
    expect(names.slice(0, 10)).toEqual([
      'SKELETON',
      'BANTIR',
      'DRIP SLIME',
      'GREEN MUCK',
      'GIANT ANT',
      'GIANT BEE',
      'VIPER',
      'WILD DOG',
      'ORC',
      'KOBOLD',
    ]);
  });
});

describe('readP2RaceNames — data-tables.md §2.4', () => {
  it('reads all 16 confirmed race names, byte-identical to P1\'s list', () => {
    const exe = new Uint8Array(readFileSync(P2_EXE_PATH));
    const names = readP2RaceNames(exe);
    expect(names).toEqual([
      'HUMAN',
      'DWARF',
      'ELF',
      'HALFLING',
      'GNOME',
      'PIXIE',
      'SPRITE',
      'OGRE',
      'GNOLL',
      'TROLL',
      'KOBOLD',
      'ORC',
      'GOBLIN',
      'LIZ.MAN',
      'MINOTAUR',
      'UNDEAD',
    ]);
  });
});

describe('readP2Palette — data-tables.md §2.3', () => {
  it('decodes the confirmed 16-colour palette via the plain ST lookup (not AmigaToST)', () => {
    const exe = new Uint8Array(readFileSync(P2_EXE_PATH));
    const palette = readP2Palette(exe);
    expect(palette).toHaveLength(16);
    expect(palette[0]).toEqual({ r: 0, g: 0, b: 0 });
    expect(palette[2]).toEqual({ r: 255, g: 0, b: 0 });
    expect(palette[15]).toEqual({ r: 255, g: 255, b: 255 });
    // Index 12 resolves cleanly under the raw ST lookup (nibbles 7,6,6),
    // unlike P1's AmigaToST-decoded odd-nibble outlier at the same index.
    expect(palette[12]).not.toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('readP2CoverPalette — graphics-formats.md §10', () => {
  it('decodes START.PRG file offset 0x172 — the Setpalette operand at file offset 0x94, governing COVER1.PIC/COVER2.PIC', () => {
    const startPrg = new Uint8Array(readFileSync(P2_START_PATH));
    const palette = readP2CoverPalette(startPrg);
    expect(palette).toHaveLength(16);
    // Word 0x0000 (index 0) is black — the stone-floor shadow colour.
    expect(palette[0]).toEqual({ r: 0, g: 0, b: 0 });
    // Word 0x0777 (index 15) is white — used by the "PHANTASIE II" logotype.
    expect(palette[15]).toEqual({ r: 255, g: 255, b: 255 });
    // Distinct from the all-black loading palette at file offset 0x192.
    const distinct = new Set(palette.map((c) => `${c.r},${c.g},${c.b}`));
    expect(distinct.size).toBeGreaterThan(2);
  });

  it('is a different table from the all-black pre-load palette at file offset 0x192', () => {
    const startPrg = new Uint8Array(readFileSync(P2_START_PATH));
    // File offset 0x192 (16 words immediately after 0x172's table + one
    // stray word) is all-zero — the "hide the loading flicker" palette set
    // before cover1.pic is read, never the one rendered assets should use.
    const blackRegion = startPrg.subarray(0x192, 0x192 + 32);
    expect(Array.from(blackRegion).every((b) => b === 0)).toBe(true);
  });
});

describe('readP2TownPalette — graphics-formats.md §10', () => {
  it('decodes PHANT.PRG file offset 0x23a7e — the Setpalette operand at file offset 0x2d44, governing PELNOR.PIC', () => {
    const exe = new Uint8Array(readFileSync(P2_EXE_PATH));
    const palette = readP2TownPalette(exe);
    expect(palette).toHaveLength(16);
    // Distinct from the already-confirmed monster/race palette at 0x23a9e —
    // two genuinely different tables, not an off-by-one re-read of one.
    const monsterRace = readP2Palette(exe);
    expect(palette).not.toEqual(monsterRace);
  });
});

describe('readP3ItemNames — data-tables.md §3.1', () => {
  it('reads all 181 item names, index 0 the "0" placeholder', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    const names = readP3ItemNames(exe);
    expect(names).toHaveLength(181);
    expect(names[0]).toBe('0');
    expect(names[1]).toBe('Glove');
    expect(names[180]).toBe('Wand of Nikademus');
  });
});

describe('readP3SpellNames — data-tables.md §3.1', () => {
  it('reads all 58 spell names, index 0 the "0" placeholder', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    const names = readP3SpellNames(exe);
    expect(names).toHaveLength(58);
    expect(names[0]).toBe('0');
    expect(names[1]).toBe('Healing I');
    expect(names[57]).toBe('Divine Aid');
  });
});

describe('readP3RaceNames — data-tables.md §4', () => {
  it('reads all 18 race names via the HUNK_RELOC32-located pointer table', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    const names = readP3RaceNames(exe);
    expect(names).toEqual([
      'Human',
      'Dwarven',
      'Elven',
      'Gnome',
      'Halfling',
      'Random',
      'Gnoll',
      'Goblin',
      'Kobold',
      'Lizard Man',
      'Minotaur',
      'Ogre',
      'Orc',
      'Pixie',
      'Sprite',
      'Troll',
      'Elemental',
      'Undead',
    ]);
  });
});
