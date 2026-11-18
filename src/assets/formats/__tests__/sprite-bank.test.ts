import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  P3_SPRITE_BANKS,
  resolveMonsterSpriteIndex,
  spriteCellRect,
  cropSpriteCell,
  readP1MonsterSpriteTable,
  decodeP1MonsterSprite,
  decodeP1RaceSprite,
  P1_MONSTER_COUNT,
  P1_RACE_COUNT,
  P1_RACE_SPRITE_STRIDE,
  readP2MonsterSpriteTable,
  decodeP2MonsterSprite,
  decodeP2RaceSprite,
  P2_MONSTER_COUNT,
  P2_RACE_COUNT,
  P2_RACE_SPRITE_STRIDE,
} from '../sprite-bank.ts';

describe('resolveMonsterSpriteIndex — P3 piecewise bank/cell mapping (graphics-formats.md §6)', () => {
  it('maps the low range (0-14) to bank 2', () => {
    expect(resolveMonsterSpriteIndex(0)).toEqual({ bank: 2, cell: 0, isGiant: false });
    expect(resolveMonsterSpriteIndex(14)).toEqual({ bank: 2, cell: 14, isGiant: false });
  });

  it('maps 15-26 to bank 1', () => {
    expect(resolveMonsterSpriteIndex(15)).toEqual({ bank: 1, cell: 0, isGiant: false });
    expect(resolveMonsterSpriteIndex(26)).toEqual({ bank: 1, cell: 11, isGiant: false });
  });

  it('maps 27 to bank 0 cell 10', () => {
    expect(resolveMonsterSpriteIndex(27)).toEqual({ bank: 0, cell: 10, isGiant: false });
  });

  it('maps 28-35 to bank 3, and 36-41 to bank 4', () => {
    expect(resolveMonsterSpriteIndex(28)).toEqual({ bank: 3, cell: 0, isGiant: false });
    expect(resolveMonsterSpriteIndex(35)).toEqual({ bank: 3, cell: 7, isGiant: false });
    expect(resolveMonsterSpriteIndex(36)).toEqual({ bank: 4, cell: 0, isGiant: false });
    expect(resolveMonsterSpriteIndex(41)).toEqual({ bank: 4, cell: 5, isGiant: false });
  });

  it('maps 42-43 to giant bank 5, and 44-47 to giant bank 6', () => {
    expect(resolveMonsterSpriteIndex(42)).toEqual({ bank: 5, cell: 0, isGiant: true });
    expect(resolveMonsterSpriteIndex(43)).toEqual({ bank: 5, cell: 1, isGiant: true });
    expect(resolveMonsterSpriteIndex(44)).toEqual({ bank: 6, cell: 0, isGiant: true });
    expect(resolveMonsterSpriteIndex(47)).toEqual({ bank: 6, cell: 3, isGiant: true });
  });

  it('clamps any out-of-range value (>=48) to the bank/cell for spriteIndex 14 — disassembly-confirmed self-correction, not the previously-documented per-value patches', () => {
    // Real monsinfo.dat: Mud Elemental has spriteIndex 48, Wolf has 65 —
    // both real, shipped monsters that hit this path (graphics-formats.md §6).
    const fallback = resolveMonsterSpriteIndex(14);
    expect(fallback).toEqual({ bank: 2, cell: 14, isGiant: false });
    expect(resolveMonsterSpriteIndex(48)).toEqual(fallback);
    expect(resolveMonsterSpriteIndex(65)).toEqual(fallback);
    expect(resolveMonsterSpriteIndex(1000)).toEqual(fallback);
  });
});

describe('spriteCellRect — grid math', () => {
  it('computes the normal-pose rect for a 32x48 bank (10 cols)', () => {
    const bank = P3_SPRITE_BANKS[0]; // heros.cmp, 32x48, 10x4
    expect(spriteCellRect(bank, 0, false)).toEqual({ x: 0, y: 0, width: 32, height: 48 });
    // index2 = 1*2 = 2 -> col 2, row 0
    expect(spriteCellRect(bank, 1, false)).toEqual({ x: 64, y: 0, width: 32, height: 48 });
    // isAttacking folds in as +1 to index2
    expect(spriteCellRect(bank, 0, true)).toEqual({ x: 32, y: 0, width: 32, height: 48 });
  });

  it('wraps to the next row once index2 exceeds cellsPerRow', () => {
    const bank = P3_SPRITE_BANKS[0]; // 10 cols
    // cell 5 normal -> index2=10 -> col 0, row 1
    expect(spriteCellRect(bank, 5, false)).toEqual({ x: 0, y: 48, width: 32, height: 48 });
  });

  it('computes rects for an 80x72 giant bank (4 cols)', () => {
    const giantBank = P3_SPRITE_BANKS[5]; // giant1.cmp, 80x72, 4x2
    // index2 = cellIndex*2; cellsPerRow = 320/80 = 4.
    expect(spriteCellRect(giantBank, 0, false)).toEqual({ x: 0, y: 0, width: 80, height: 72 });
    // cell 1 -> index2=2 -> col 2, row 0 (still fits in the first row of 4).
    expect(spriteCellRect(giantBank, 1, false)).toEqual({ x: 160, y: 0, width: 80, height: 72 });
    // cell 2 -> index2=4 -> wraps to col 0, row 1 (matches the doc's visual
    // confirmation: giant1.cmp shows exactly 2 rows of sprite pairs).
    expect(spriteCellRect(giantBank, 2, false)).toEqual({ x: 0, y: 72, width: 80, height: 72 });
  });
});

describe('cropSpriteCell', () => {
  it('extracts the right sub-region from a full bank buffer', () => {
    // 4x2 source, crop a 2x1 rect at (2,1).
    const src = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const rect = { x: 2, y: 1, width: 2, height: 1 };
    expect(Array.from(cropSpriteCell(src, 4, rect))).toEqual([6, 7]);
  });
});

describe('P1 .pat sprite tables (graphics-formats.md §7) — byte-exact against real files', () => {
  const game = new Uint8Array(readFileSync(resolve('data/phantasie/amiga/game')));
  const mstr1 = new Uint8Array(readFileSync(resolve('data/phantasie/amiga/mstr1.pat')));
  const party1 = new Uint8Array(readFileSync(resolve('data/phantasie/amiga/party1.pat')));

  it('reads 80 monster sprite refs summing exactly to mstr1.pat size, contiguous in index order', () => {
    const refs = readP1MonsterSpriteTable(game);
    expect(refs).toHaveLength(P1_MONSTER_COUNT);

    let totalSize = 0;
    for (const ref of refs) {
      const size = (ref.width / 8) * ref.height * 4;
      totalSize += size;
    }
    expect(totalSize).toBe(mstr1.length);
    expect(mstr1.length).toBe(68016);

    for (let i = 0; i < refs.length - 1; i++) {
      const size = (refs[i].width / 8) * refs[i].height * 4;
      expect(refs[i].byteOffset + size).toBe(refs[i + 1].byteOffset);
    }
    expect(refs[0].byteOffset).toBe(0);
  });

  it('index 0 (width=32,height=34) sits at offset 0; index 1 sits at 32/8*34*4', () => {
    const refs = readP1MonsterSpriteTable(game);
    expect(refs[0].width).toBe(32);
    expect(refs[0].height).toBe(34);
    expect(refs[0].byteOffset).toBe(0);
    expect(refs[1].byteOffset).toBe((32 / 8) * 34 * 4);
  });

  it('decodes monster index 0 (SKELETON) and index 8 (ORC) to a non-blank sprite', () => {
    const refs = readP1MonsterSpriteTable(game);
    const skeleton = decodeP1MonsterSprite(mstr1, refs[0]);
    const orc = decodeP1MonsterSprite(mstr1, refs[8]);
    expect(skeleton.length).toBe(refs[0].width * refs[0].height);
    expect(new Set(skeleton).size).toBeGreaterThan(1);
    expect(orc.length).toBe(refs[8].width * refs[8].height);
    expect(new Set(orc).size).toBeGreaterThan(1);
  });

  it('party1.pat is exactly 16 races * 512 bytes, zero remainder', () => {
    expect(party1.length).toBe(P1_RACE_COUNT * P1_RACE_SPRITE_STRIDE);
    expect(party1.length).toBe(8192);
  });

  it('decodes race sprite 0 (human) to a non-blank 32x32 sprite', () => {
    const human = decodeP1RaceSprite(party1, 0);
    expect(human.length).toBe(32 * 32);
    expect(new Set(human).size).toBeGreaterThan(1);
  });
});

// NOTE (2026-11-13 audit): the 'non-blank' (distinct values > 1) asserts in this file and
// pic.test.ts are smoke checks only — random bytes pass them. The P1 Planar / P2 Interleaved
// layout claims are pixel-verified in sprite-cross-game.test.ts.
describe('P2 .PAT sprite tables (graphics-formats.md §9, data-tables.md §2) — byte-exact against real files', () => {
  const exe = new Uint8Array(readFileSync(resolve('data/phantasieii/atarist/extracted/disk1/PHANT.PRG')));
  const mstr1 = new Uint8Array(readFileSync(resolve('data/phantasieii/atarist/extracted/disk1/MSTR1.PAT')));
  const party1 = new Uint8Array(readFileSync(resolve('data/phantasieii/atarist/extracted/disk1/PARTY1.PAT')));

  it('reads 80 monster sprite refs summing exactly to MSTR1.PAT size, contiguous in index order', () => {
    const refs = readP2MonsterSpriteTable(exe);
    expect(refs).toHaveLength(P2_MONSTER_COUNT);

    let totalSize = 0;
    for (const ref of refs) {
      totalSize += (ref.width / 8) * ref.height * 4;
    }
    expect(totalSize).toBe(mstr1.length);
    expect(mstr1.length).toBe(76832);

    for (let i = 0; i < refs.length - 1; i++) {
      const size = (refs[i].width / 8) * refs[i].height * 4;
      expect(refs[i].byteOffset + size).toBe(refs[i + 1].byteOffset);
    }
    expect(refs[0].byteOffset).toBe(0);
  });

  it('index 0 (32x34), index 8 (32x32), index 17 (80x39) match the confirmed dimension table', () => {
    const refs = readP2MonsterSpriteTable(exe);
    expect(refs[0]).toMatchObject({ byteOffset: 0, width: 32, height: 34 });
    expect(refs[8]).toMatchObject({ byteOffset: 3488, width: 32, height: 32 });
    expect(refs[17]).toMatchObject({ byteOffset: 8000, width: 80, height: 39 });
  });

  it('decodes monster index 0 (SKELETON) and index 8 (ORC) to a recognisable, non-blank sprite via the Interleaved layout', () => {
    const refs = readP2MonsterSpriteTable(exe);
    const skeleton = decodeP2MonsterSprite(mstr1, refs[0]);
    const orc = decodeP2MonsterSprite(mstr1, refs[8]);
    expect(skeleton.length).toBe(refs[0].width * refs[0].height);
    expect(new Set(skeleton).size).toBeGreaterThan(1);
    expect(orc.length).toBe(refs[8].width * refs[8].height);
    expect(new Set(orc).size).toBeGreaterThan(1);
  });

  it('PARTY1.PAT is exactly 16 races * 512 bytes, zero remainder, matching P1\'s formula', () => {
    expect(party1.length).toBe(P2_RACE_COUNT * P2_RACE_SPRITE_STRIDE);
    expect(party1.length).toBe(8192);
  });

  it('decodes race sprite 0 (human) and 7 (ogre) to non-blank 32x32 sprites via the Interleaved layout', () => {
    const human = decodeP2RaceSprite(party1, 0);
    expect(human.length).toBe(32 * 32);
    expect(new Set(human).size).toBeGreaterThan(1);
    const ogre = decodeP2RaceSprite(party1, 7);
    expect(ogre.length).toBe(32 * 32);
    expect(new Set(ogre).size).toBeGreaterThan(1);
  });
});
