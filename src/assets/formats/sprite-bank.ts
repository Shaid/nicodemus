/**
 * Sprite-bank grid-cell addressing.
 *
 * P3 side (graphics-formats.md §6): seven `.cmp` files are grids of small
 * monster/race sprites packed into the fixed 320x200 canvas, addressed by a
 * bank index / grid-cell scheme fed by `monsinfo.dat`'s `spriteIndex` field
 * (data-tables.md §3.1/§3.2).
 *
 * P1 side (graphics-formats.md §7): `mstr1.pat`/`mstr2.pat`/`party1.pat`/
 * `party2.pat` have no in-file structure at all — individual sprites are
 * addressed by byte-offset tables stored in the game executable.
 */

import { r16, r32 } from '@seer-project/core';
import { cropIndices, decodeBitplaneIndices, type BitplaneConfig } from './bitplane.ts';

// ---------------------------------------------------------------------------
// P3: `.cmp` sprite-bank grids (graphics-formats.md §6)
// ---------------------------------------------------------------------------

export interface SpriteBank {
  index: number;
  file: string;
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
}

/** The 7 P3 monster/race sprite-bank files and their grid geometry. */
export const P3_SPRITE_BANKS: readonly SpriteBank[] = [
  { index: 0, file: 'heros.cmp', cellWidth: 32, cellHeight: 48, cols: 10, rows: 4 },
  { index: 1, file: 'purple1.cmp', cellWidth: 32, cellHeight: 48, cols: 10, rows: 4 },
  { index: 2, file: 'yellow1.cmp', cellWidth: 32, cellHeight: 48, cols: 10, rows: 4 },
  { index: 3, file: 'purple2.cmp', cellWidth: 32, cellHeight: 48, cols: 10, rows: 4 },
  { index: 4, file: 'yellow2.cmp', cellWidth: 32, cellHeight: 48, cols: 10, rows: 4 },
  { index: 5, file: 'giant1.cmp', cellWidth: 80, cellHeight: 72, cols: 4, rows: 2 },
  { index: 6, file: 'giant2.cmp', cellWidth: 80, cellHeight: 72, cols: 4, rows: 2 },
];

export interface BankCellRef {
  bank: number;
  cell: number;
  isGiant: boolean;
}

/**
 * Maps a monster's `spriteIndex` field (`monsinfo.dat` +0x1B) to a bank/cell
 * pair, per the piecewise mapping in graphics-formats.md §6.
 *
 * **Independently re-derived and byte-verified this session** against
 * `PhantasieIII` (real file offset `0x1B4F0`-`0x1B6E2`, the 6-way range
 * dispatcher — see graphics-formats.md §6 for the disassembly evidence):
 * every threshold and bank assignment for `spriteIndex` 0-47 matches the
 * originally source-transcribed table exactly (byte-exact `CMPI.W`
 * constants 0x0F/0x1C/0x24/0x2A/0x2C/0x30 and bank numbers 2/1/0/3/4/5/6,
 * in order). **The two `==48`/`==65` single-value patches did NOT
 * verify** — the real function has no per-value special case at all;
 * *any* `spriteIndex >= 48` (not just 48 or 65) is clamped to 48 and the
 * call returns without drawing, but first writes the fallback value `14`
 * back into the monster's own struct field — i.e. the self-correction
 * target is bank 2 cell 14 (the same generic piecewise formula, re-applied
 * to 14), not the previously-documented bank0/cell11 or bank2/cell0.
 * Real `monsinfo.dat` has two monsters that actually hit this path
 * (`Mud Elemental`, `spriteIndex 48`; `Wolf`, `spriteIndex 65` — not
 * "wild dog" as previously guessed, `Wild Dog` itself has `spriteIndex 0`).
 * Race sprites (P3) don't go through this — they always use bank 0 at
 * 32x48.
 */
export function resolveMonsterSpriteIndex(spriteIndex: number): BankCellRef {
  // Confirmed via disassembly: any out-of-range value (>=48) falls back to
  // the same formula applied to a fixed constant (14), not a per-value
  // patch table — see the doc comment above.
  if (spriteIndex >= 48) return resolveMonsterSpriteIndex(14);

  const isGiant = spriteIndex > 41;

  if (spriteIndex <= 14) return { bank: 2, cell: spriteIndex, isGiant };
  if (spriteIndex <= 26) return { bank: 1, cell: spriteIndex - 15, isGiant };
  if (spriteIndex === 27) return { bank: 0, cell: 10, isGiant };
  if (spriteIndex <= 35) return { bank: 3, cell: spriteIndex - 28, isGiant };
  if (spriteIndex <= 41) return { bank: 4, cell: spriteIndex - 36, isGiant };
  if (spriteIndex <= 43) return { bank: 5, cell: spriteIndex - 42, isGiant };
  return { bank: 6, cell: spriteIndex - 44, isGiant };
}

export interface SpriteCellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The pixel rect for grid cell `cellIndex` within `bank`, folding in the
 * normal/attacking pose (adjacent cells in the same grid — see §6).
 */
export function spriteCellRect(
  bank: SpriteBank,
  cellIndex: number,
  isAttacking: boolean,
): SpriteCellRect {
  const index2 = cellIndex * 2 + (isAttacking ? 1 : 0);
  const cellsPerRow = 320 / bank.cellWidth;
  const x = (index2 % cellsPerRow) * bank.cellWidth;
  const y = Math.floor(index2 / cellsPerRow) * bank.cellHeight;
  return { x, y, width: bank.cellWidth, height: bank.cellHeight };
}

/** Crop one grid cell's palette-index pixels out of a decoded bank image. */
export function cropSpriteCell(
  bankIndices: Uint8Array,
  bankWidth: number,
  rect: SpriteCellRect,
): Uint8Array {
  return cropIndices(bankIndices, bankWidth, rect);
}

// ---------------------------------------------------------------------------
// P1: `.pat` raw sprite banks (graphics-formats.md §7)
// ---------------------------------------------------------------------------

/** Offset (into `game`) of the 80-entry, 4-byte-stride monster sprite
 *  byte-offset table. Value is a byte offset into `mstr1.pat`/`mstr2.pat`. */
export const P1_MONSTER_OFFSET_TABLE_OFFSET = 0x16842;
/** Offset (into `game`) of the 80-entry, 4-byte-stride monster
 *  width/height table (two big-endian u16s per entry). */
export const P1_MONSTER_DIMENSION_TABLE_OFFSET = 0x1ea8;
export const P1_MONSTER_COUNT = 80;

export const P1_RACE_COUNT = 16;
export const P1_RACE_SPRITE_DIM = 32;
/** 32*32/2 planar bytes per race sprite (4bpp). */
export const P1_RACE_SPRITE_STRIDE = (P1_RACE_SPRITE_DIM * P1_RACE_SPRITE_DIM) / 2;

export interface P1MonsterSpriteRef {
  index: number;
  byteOffset: number;
  width: number;
  height: number;
}

/**
 * Read the monster sprite offset+dimension tables from the `game`
 * executable's raw bytes (confirmed to work as raw file offsets — see
 * data-tables.md §1.2/§8).
 */
export function readP1MonsterSpriteTable(gameExe: Uint8Array): P1MonsterSpriteRef[] {
  const refs: P1MonsterSpriteRef[] = [];
  for (let i = 0; i < P1_MONSTER_COUNT; i++) {
    const offsetFieldOffset = P1_MONSTER_OFFSET_TABLE_OFFSET + i * 4;
    const dimFieldOffset = P1_MONSTER_DIMENSION_TABLE_OFFSET + i * 4;
    const byteOffset = r32(gameExe, offsetFieldOffset, 'be');
    const width = r16(gameExe, dimFieldOffset, 'be');
    const height = r16(gameExe, dimFieldOffset + 2, 'be');
    refs.push({ index: i, byteOffset, width, height });
  }
  return refs;
}

/** Decode one monster sprite (from `mstr1.pat` or `mstr2.pat`) to palette indices. */
export function decodeP1MonsterSprite(patData: Uint8Array, ref: P1MonsterSpriteRef): Uint8Array {
  const config: BitplaneConfig = {
    width: ref.width,
    height: ref.height,
    bitplaneCount: 4,
    mode: 'planar',
  };
  return decodeBitplaneIndices(patData, ref.byteOffset, config);
}

/** Decode one race sprite (from `party1.pat` or `party2.pat`) to palette indices. */
export function decodeP1RaceSprite(patData: Uint8Array, raceIndex: number): Uint8Array {
  const offset = raceIndex * P1_RACE_SPRITE_STRIDE;
  const config: BitplaneConfig = {
    width: P1_RACE_SPRITE_DIM,
    height: P1_RACE_SPRITE_DIM,
    bitplaneCount: 4,
    mode: 'planar',
  };
  return decodeBitplaneIndices(patData, offset, config);
}

// ---------------------------------------------------------------------------
// P2: `.PAT` raw sprite banks (graphics-formats.md 9, data-tables.md 2)
//
// Same on-disk table shapes as P1 (byte-offset table + width/height table
// for monsters; fixed 32x32/512-byte-stride formula for races), but the
// underlying pixel data uses the ST word-Interleaved plane layout
// (interleave=2), not P1's Planar layout - confirmed by rendering, not a
// hypothesis. Total per-sprite byte count is identical between the two
// layouts (both store width/8*height*bitplaneCount bytes), so the
// offset/stride arithmetic below is unchanged from P1; only the
// `BitplaneConfig.mode` passed to `decodeBitplaneIndices` differs.
// ---------------------------------------------------------------------------

/** Offset (into `PHANT.PRG`) of the 80-entry, 4-byte-stride monster sprite
 *  byte-offset table. Value is a byte offset into `MSTR1.PAT`/`MSTR2.PAT`. */
export const P2_MONSTER_OFFSET_TABLE_OFFSET = 0x23d90;
/** Offset (into `PHANT.PRG`) of the 80-entry, 4-byte-stride monster
 *  width/height table (two big-endian u16s per entry). */
export const P2_MONSTER_DIMENSION_TABLE_OFFSET = 0x2114a;
export const P2_MONSTER_COUNT = 80;

export const P2_RACE_COUNT = 16;
export const P2_RACE_SPRITE_DIM = 32;
/** 32*32/2 bytes per race sprite (4bpp) - same total size regardless of
 *  Planar vs. Interleaved arrangement. */
export const P2_RACE_SPRITE_STRIDE = (P2_RACE_SPRITE_DIM * P2_RACE_SPRITE_DIM) / 2;

export type P2MonsterSpriteRef = P1MonsterSpriteRef;

/**
 * Read the monster sprite offset+dimension tables from the `PHANT.PRG`
 * executable's raw bytes (confirmed byte-exact against real files -
 * data-tables.md 2.2).
 */
export function readP2MonsterSpriteTable(exe: Uint8Array): P2MonsterSpriteRef[] {
  const refs: P2MonsterSpriteRef[] = [];
  for (let i = 0; i < P2_MONSTER_COUNT; i++) {
    const offsetFieldOffset = P2_MONSTER_OFFSET_TABLE_OFFSET + i * 4;
    const dimFieldOffset = P2_MONSTER_DIMENSION_TABLE_OFFSET + i * 4;
    const byteOffset = r32(exe, offsetFieldOffset, 'be');
    const width = r16(exe, dimFieldOffset, 'be');
    const height = r16(exe, dimFieldOffset + 2, 'be');
    refs.push({ index: i, byteOffset, width, height });
  }
  return refs;
}

/** Decode one monster sprite (from `MSTR1.PAT` or `MSTR2.PAT`) to palette
 *  indices, using the confirmed ST word-Interleaved layout. */
export function decodeP2MonsterSprite(patData: Uint8Array, ref: P2MonsterSpriteRef): Uint8Array {
  const config: BitplaneConfig = {
    width: ref.width,
    height: ref.height,
    bitplaneCount: 4,
    mode: 'interleaved',
    interleave: 2,
  };
  return decodeBitplaneIndices(patData, ref.byteOffset, config);
}

/** Decode one race sprite (from `PARTY1.PAT` or `PARTY2.PAT`) to palette
 *  indices, using the confirmed ST word-Interleaved layout. */
export function decodeP2RaceSprite(patData: Uint8Array, raceIndex: number): Uint8Array {
  const offset = raceIndex * P2_RACE_SPRITE_STRIDE;
  const config: BitplaneConfig = {
    width: P2_RACE_SPRITE_DIM,
    height: P2_RACE_SPRITE_DIM,
    bitplaneCount: 4,
    mode: 'interleaved',
    interleave: 2,
  };
  return decodeBitplaneIndices(patData, offset, config);
}
