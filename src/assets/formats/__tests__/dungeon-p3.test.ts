import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  DUNGEON_P3_GRID_SIZE,
  DUNGEON_P3_WIDTH,
  DUNGEON_P3_HEIGHT,
  DUNGEON_P3_STAR_TABLE_OFFSET,
  DUNGEON_P3_ACTION_TABLE_OFFSET,
  DUNGEON_P3_ACTION_TABLE_SLOT_COUNT,
  DUNGEON_P3_MESSAGE_POINTER_TABLE_OFFSET,
  DUNGEON_P3_MESSAGE_POOL_OFFSET,
  decodeDungeonP3Header,
  decodeDungeonP3Grid,
  cellAtP3,
  p3TrapDamage,
  p3TrapMessageIndex,
  decodeP3MessagePointers,
  classifyCell,
} from '../dungeon-p3.ts';

const DNGA_PATH = resolve('data/phantasieiii/amiga/D/dnga.dat');

describe('dungeon-p3.ts — grid + header (dungeon-format.md §5)', () => {
  it('grid is 24x30 = 720 bytes; action table is exactly bounded by the message pointer table', () => {
    expect(DUNGEON_P3_WIDTH * DUNGEON_P3_HEIGHT).toBe(DUNGEON_P3_GRID_SIZE);
    expect(DUNGEON_P3_GRID_SIZE).toBe(720);
    // §5.1: 0x0393 + 256*2 = 0x0593, exactly the message pointer table start.
    expect(DUNGEON_P3_ACTION_TABLE_OFFSET + DUNGEON_P3_ACTION_TABLE_SLOT_COUNT * 2).toBe(
      DUNGEON_P3_MESSAGE_POINTER_TABLE_OFFSET,
    );
    // §5.2: 0x0593 + 220 = 0x066F, exactly the message pool start.
    expect(DUNGEON_P3_MESSAGE_POINTER_TABLE_OFFSET + 110 * 2).toBe(DUNGEON_P3_MESSAGE_POOL_OFFSET);
  });

  it('decodes dnga.dat header: level 0, encounter table, and the documented gap bytes', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    expect(data.length).toBe(4352);
    const header = decodeDungeonP3Header(data);
    expect(header.level).toBe(0);
    expect(header.fixedEncounterTable).toEqual([9, 10, 21, 33, 43, 45, 55, 57, 67, 69]);
    expect(Array.from(header.unknownGap)).toEqual([0x0d, 0x05, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  });

  it('star table slot 0 raw bytes are 81 01 00 00 00', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    expect(Array.from(data.slice(DUNGEON_P3_STAR_TABLE_OFFSET, DUNGEON_P3_STAR_TABLE_OFFSET + 5))).toEqual([
      0x81, 0x01, 0x00, 0x00, 0x00,
    ]);
  });

  it('action table slot 0 raw bytes are 46 7A (opcode 0x06, +Item)', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    const b0 = data[DUNGEON_P3_ACTION_TABLE_OFFSET];
    const b1 = data[DUNGEON_P3_ACTION_TABLE_OFFSET + 1];
    expect([b0, b1]).toEqual([0x46, 0x7a]);
    expect(b0 & 0x3f).toBe(0x06);
  });

  it('cellAtP3 reads row-major and rejects out-of-range coordinates', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    const grid = decodeDungeonP3Grid(data);
    expect(grid.length).toBe(720);
    expect(cellAtP3(grid, 0, 0)).toBe(grid[0]);
    expect(cellAtP3(grid, 3, 4)).toBe(grid[4 * 24 + 3]);
    expect(() => cellAtP3(grid, 24, 0)).toThrow(RangeError);
    expect(() => cellAtP3(grid, 0, 30)).toThrow(RangeError);
  });

  it('re-exports the shared cell classifier', () => {
    expect(classifyCell(0xdd, 0)).toEqual({ kind: 'star', starIndex: 0 });
  });
});

describe('§6 — P3 trap formulas (confirmed, preserved-bug)', () => {
  it('p3TrapDamage clamps cells 0x02-0x05 to 12, only 0x06 computes correctly (5)', () => {
    expect(p3TrapDamage(0x02)).toBe(12);
    expect(p3TrapDamage(0x03)).toBe(12);
    expect(p3TrapDamage(0x04)).toBe(12);
    expect(p3TrapDamage(0x05)).toBe(12);
    expect(p3TrapDamage(0x06)).toBe(5);
  });

  it('p3TrapMessageIndex resolves to 0x06-0x0A, one higher than P1/P2 for every trap cell', () => {
    expect(p3TrapMessageIndex(0x02)).toBe(0x06);
    expect(p3TrapMessageIndex(0x06)).toBe(0x0a);
  });
});

describe('decodeP3MessagePointers (dungeon-format.md §5.2)', () => {
  it('slot 0 resolves to exactly the byte after the pointer table (0x066F)', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    const pointers = decodeP3MessagePointers(data);
    expect(pointers).toHaveLength(110);
    expect(pointers[0].raw).toBe(0x0e6f);
    expect(pointers[0].address).toBe(0x066f);
    expect(pointers[0].address).toBe(DUNGEON_P3_MESSAGE_POOL_OFFSET);
  });

  it('a zero-word slot resolves to a null address (empty)', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    const pointers = decodeP3MessagePointers(data);
    const zeroSlot = pointers.find((p) => p.raw === 0);
    expect(zeroSlot).toBeDefined();
    expect(zeroSlot!.address).toBeNull();
  });
});
