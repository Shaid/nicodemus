import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  readHunkHeader,
  parseHunks,
  readP1MonsterNames,
  readP1RaceNames,
  readP1ItemNames,
  readP1Palette,
  readP3SkillTables,
  readP2MonsterNames,
  readP2RaceNames,
  readP2ItemNames,
  readP2Palette,
  readP2CoverPalette,
  readP2TownPalette,
  readP3ItemNames,
  readP3SpellNames,
  readP3RaceNames,
  readP3RaceSpriteCells,
  readP3ItemStats,
  readP3ItemPrices,
  readP3ShopMarkups,
  readP3Items,
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

describe('readP1ItemNames — data-tables.md §1.5', () => {
  it('reads all 181 item names, index 0 the "NOTHING" placeholder', () => {
    const game = new Uint8Array(readFileSync(GAME_PATH));
    const names = readP1ItemNames(game);
    expect(names).toHaveLength(181);
    expect(names[0]).toBe('NOTHING');
    // §1.5's own cross-check narrative: item 51 = "SM AXE", matching the
    // confirmed example action record in scripting-engine.md §2 (opcode 0x06).
    expect(names[51]).toBe('SM AXE');
  });
});

describe('readP1Palette — data-tables.md §1.3', () => {
  it('decodes the confirmed 16-colour palette using the native Amiga OCS decode, matching decodePalette16 directly', () => {
    const game = new Uint8Array(readFileSync(GAME_PATH));
    const palette = readP1Palette(game);
    expect(palette).toHaveLength(16);
    expect(palette[0]).toEqual({ r: 0, g: 0, b: 0 });
    // Native Amiga component*17: nibble 14 -> 238, not the ST amigaToSt
    // table's 255 (data-tables.md §1.3's 2026-08-10 correction).
    expect(palette[2]).toEqual({ r: 238, g: 0, b: 0 });
    expect(palette[15]).toEqual({ r: 238, g: 238, b: 238 });
    // Index 12 (word 0x0EBB) was the documented odd-nibble anomaly under the
    // old ST decode (odd nibbles fell through to 0). Under the correct
    // native decode there is no anomaly at all -- every nibble is legal.
    expect(palette[12]).toEqual({ r: 238, g: 187, b: 187 });
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

describe('readP2ItemNames — data-tables.md §2.6', () => {
  it('reads all 181 item names, index 0 the "NOTHING" placeholder', () => {
    const exe = new Uint8Array(readFileSync(P2_EXE_PATH));
    const names = readP2ItemNames(exe);
    expect(names).toHaveLength(181);
    expect(names[0]).toBe('NOTHING');
    // §2.6's own cross-check narrative names these as resolving real items.
    expect(names).toContain('DIAMOND');
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

describe('readP3RaceSpriteCells — data-tables.md §4.2', () => {
  it('reads the 19-byte race -> bank-0 cell table located at 0x299d8', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    // Values are `bankSpriteIndex * 2`; index 18 is the non-race gravestone
    // marker. Several races deliberately share a cell.
    expect(readP3RaceSpriteCells(exe)).toEqual([
      0, 2, 4, 6, 6, 0, 14, 16, 16, 10, 12, 14, 16, 8, 8, 20, 22, 18, 24,
    ]);
  });

  it('is not the identity mapping the pipeline previously assumed', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    const cells = readP3RaceSpriteCells(exe);
    // Halfling (4) shares Gnome's cell; Lizard Man (9) is cell 10, not 18.
    expect(cells[4]).toBe(cells[3]);
    expect(cells[13]).toBe(cells[14]); // Pixie / Sprite
    expect(cells[9]).not.toBe(9 * 2);
  });

  it('keeps every cell (and its attack pose) inside bank 0\'s 10x4 grid', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    for (const v of readP3RaceSpriteCells(exe)) {
      expect(v % 2).toBe(0); // stored as bankSpriteIndex * 2
      expect(v % 10).toBeLessThanOrEqual(8); // pose pair stays on one row
      expect(v + 1).toBeLessThan(40);
    }
  });
});

describe('readP3ItemStats / readP3ItemPrices / readP3ShopMarkups — data-tables.md §7', () => {
  it('matches the SSI rule book item tables at the group boundaries', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    const stats = readP3ItemStats(exe);
    expect(stats).toHaveLength(101);
    expect(stats[0]).toEqual({ pointValue: 0, attributesRequired: 0 });
    expect(stats[1]).toEqual({ pointValue: 1, attributesRequired: 1 }); // Glove
    expect(stats[20]).toEqual({ pointValue: 20, attributesRequired: 20 }); // God Shield
    expect(stats[21]).toEqual({ pointValue: 1, attributesRequired: 2 }); // Clothing
    expect(stats[31]).toEqual({ pointValue: 2, attributesRequired: 0 }); // Cloth +1
    expect(stats[41]).toEqual({ pointValue: 1, attributesRequired: 0 }); // Self Bow
    expect(stats[60]).toEqual({ pointValue: 20, attributesRequired: 38 }); // God Bow
    expect(stats[61]).toEqual({ pointValue: 1, attributesRequired: 3 }); // Knife
    expect(stats[62]).toEqual({ pointValue: 2, attributesRequired: 6 }); // Dagger
    expect(stats[100]).toEqual({ pointValue: 25, attributesRequired: 60 }); // God Sword
  });

  it('reads a 181-entry price table that ends exactly where the shop table begins', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    const prices = readP3ItemPrices(exe);
    expect(prices).toHaveLength(181);
    expect(prices[0]).toBe(0);
    expect(prices[1]).toBe(1); // Glove
    expect(prices[100]).toBe(12401); // God Sword
    expect(prices[180]).toBe(13006); // Wand of Nikademus
  });

  it('reads the 18 per-armoury markup percentages', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    expect(readP3ShopMarkups(exe)).toEqual([
      100, 150, 145, 140, 130, 125, 200, 115, 200, 105, 100, 88, 95, 90, 123, 100, 100, 100,
    ]);
  });
});

describe('readP3Items — data-tables.md §3.1/§7', () => {
  it('merges name/stats/price by item id, and returns shopMarkups alongside', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    const { items, shopMarkups } = readP3Items(exe);
    expect(items).toHaveLength(181);
    expect(shopMarkups).toHaveLength(18);

    expect(items[0]).toEqual({ index: 0, name: '0', pointValue: 0, attributesRequired: 0, basePrice: 0 });
    expect(items[1]).toEqual({ index: 1, name: 'Glove', pointValue: 1, attributesRequired: 1, basePrice: 1 });
    expect(items[100]).toEqual({
      index: 100,
      name: 'God Sword',
      pointValue: 25,
      attributesRequired: 60,
      basePrice: 12401,
    });
  });

  it('has null stats (not fabricated zeros) for item ids past 100, which the stats table does not cover', () => {
    const exe = new Uint8Array(readFileSync(P3_EXE_PATH));
    const { items } = readP3Items(exe);
    // Wand of Nikademus, the endgame artifact — has a real price but no
    // combat-equipment stats row (data-tables.md §7 only covers ids 0-100).
    const wand = items[180];
    expect(wand.name).toBe('Wand of Nikademus');
    expect(wand.pointValue).toBeNull();
    expect(wand.attributesRequired).toBeNull();
    expect(wand.basePrice).toBe(13006);
  });
});
