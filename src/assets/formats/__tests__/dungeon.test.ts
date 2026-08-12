import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  DUNGEON_GRID_SIZE,
  DUNGEON_WIDTH,
  DUNGEON_HEIGHT,
  DUNGEON_STAR_TABLE_OFFSET,
  DUNGEON_ACTION_TABLE_OFFSET,
  decodeDungeonHeader,
  decodeDungeonGrid,
  cellAt,
  classifyCell,
  p1p2TrapDamageMax,
  p1p2TrapMessageIndex,
} from '../dungeon.ts';

const DNG1_PATH = resolve('data/phantasie/amiga/dng1');
const DNG1_P2_PATH = resolve('data/phantasieii/atarist/extracted/disk2/DNG1');

describe('dungeon.ts — P1/P2 shared header + grid (dungeon-format.md §3)', () => {
  it('grid is 33x38 = 1254 bytes starting at offset 0', () => {
    expect(DUNGEON_WIDTH * DUNGEON_HEIGHT).toBe(DUNGEON_GRID_SIZE);
    expect(DUNGEON_GRID_SIZE).toBe(1254);
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    const grid = decodeDungeonGrid(data);
    expect(grid.length).toBe(1254);
  });

  it('star table base (0x04FB) is exactly header level + 175-byte encounter/gap region past the grid', () => {
    expect(DUNGEON_STAR_TABLE_OFFSET).toBe(0x04fb);
    expect(DUNGEON_ACTION_TABLE_OFFSET).toBe(0x05aa);
    // 35 slots * 5 bytes = 175, reaching exactly the action table base (§3.1).
    expect(DUNGEON_STAR_TABLE_OFFSET + 35 * 5).toBe(DUNGEON_ACTION_TABLE_OFFSET);
  });

  it('decodes dng1 header: level + 10-entry fixed-encounter table', () => {
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    const header = decodeDungeonHeader(data);
    expect(header.fixedEncounterTable).toHaveLength(10);
    expect(header.unknownGap).toHaveLength(9);
    // Confirmed sample bytes for dng1's unidentified gap (dungeon-format.md §3).
    expect(Array.from(header.unknownGap)).toEqual([0x01, 0x08, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  });

  it('P2 DNG1 header decodes at the identical shared offsets (dungeon-format.md §7)', () => {
    const data = new Uint8Array(readFileSync(DNG1_P2_PATH));
    expect(data.length).toBe(2048);
    const header = decodeDungeonHeader(data);
    expect(header.level).toBe(0);
    expect(header.fixedEncounterTable).toHaveLength(10);
    // Every fixed-encounter index is in-range for the confirmed 80-entry monster table.
    for (const idx of header.fixedEncounterTable) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(79);
    }
  });

  it('cellAt reads row-major y*33+x and rejects out-of-range coordinates', () => {
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    const grid = decodeDungeonGrid(data);
    expect(cellAt(grid, 0, 0)).toBe(grid[0]);
    expect(cellAt(grid, 5, 2)).toBe(grid[2 * 33 + 5]);
    expect(() => cellAt(grid, 33, 0)).toThrow(RangeError);
    expect(() => cellAt(grid, 0, 38)).toThrow(RangeError);
  });
});

describe('classifyCell — cell-ID semantic ranges (dungeon-format.md §4)', () => {
  it('classifies walls, secret walls, triggered traps and unassigned', () => {
    expect(classifyCell(0x00, 0)).toEqual({ kind: 'wall' });
    expect(classifyCell(0x01, 0)).toEqual({ kind: 'secretWall' });
    expect(classifyCell(0x07, 0)).toEqual({ kind: 'triggeredTrap' });
    expect(classifyCell(0x8a, 0)).toEqual({ kind: 'unassigned' });
  });

  it('classifies traps 0x02-0x06', () => {
    for (let cell = 0x02; cell <= 0x06; cell++) {
      expect(classifyCell(cell, 0)).toEqual({ kind: 'trap', trapValue: cell });
    }
  });

  it('random encounter range uses level*12+offset roster indexing (§4.1)', () => {
    expect(classifyCell(0x08, 3)).toEqual({ kind: 'randomEncounter', monsterIndex0: 3 * 12 + 0 });
    expect(classifyCell(0x11, 3)).toEqual({ kind: 'randomEncounter', monsterIndex0: 3 * 12 + 9 });
  });

  it('special message range 0x12-0x7F has no encounter', () => {
    expect(classifyCell(0x12, 0)).toEqual({ kind: 'specialMessage' });
    expect(classifyCell(0x7f, 0)).toEqual({ kind: 'specialMessage' });
  });

  it('fixed encounter range indexes the header table by cell-0x80', () => {
    expect(classifyCell(0x80, 0)).toEqual({ kind: 'fixedEncounter', fixedEncounterIndex: 0 });
    expect(classifyCell(0x89, 0)).toEqual({ kind: 'fixedEncounter', fixedEncounterIndex: 9 });
  });

  it('bottom message range 0x8B-0xB8', () => {
    expect(classifyCell(0x8b, 0)).toEqual({ kind: 'bottomMessage' });
    expect(classifyCell(0xb8, 0)).toEqual({ kind: 'bottomMessage' });
  });

  it('horizontal door states', () => {
    expect(classifyCell(0xb9, 0)).toEqual({ kind: 'door', orientation: 'horizontal', state: 'open' });
    expect(classifyCell(0xba, 5)).toEqual({
      kind: 'door',
      orientation: 'horizontal',
      state: 'encounter',
      monsterIndex0: 5 * 12 + 0,
    });
    expect(classifyCell(0xc6, 0)).toEqual({ kind: 'door', orientation: 'horizontal', state: 'locked' });
    expect(classifyCell(0xc7, 0)).toEqual({ kind: 'door', orientation: 'horizontal', state: 'unlockable' });
  });

  it('vertical door states', () => {
    expect(classifyCell(0xc8, 0)).toEqual({ kind: 'door', orientation: 'vertical', state: 'open' });
    expect(classifyCell(0xc9, 2)).toEqual({
      kind: 'door',
      orientation: 'vertical',
      state: 'encounter',
      monsterIndex0: 2 * 12 + 0,
    });
    expect(classifyCell(0xd5, 0)).toEqual({ kind: 'door', orientation: 'vertical', state: 'locked' });
    expect(classifyCell(0xd6, 0)).toEqual({ kind: 'door', orientation: 'vertical', state: 'unlockable' });
  });

  it('stairs (exit and inter-level)', () => {
    expect(classifyCell(0xd7, 0)).toEqual({ kind: 'stairsExit' });
    expect(classifyCell(0xd9, 0)).toEqual({ kind: 'stairsExit' });
    expect(classifyCell(0xda, 0)).toEqual({ kind: 'stairsInter', fromLevel: 1 });
    expect(classifyCell(0xdc, 0)).toEqual({ kind: 'stairsInter', fromLevel: 3 });
  });

  it('star range 0xDD-0xFF, starIndex = cell - 0xDD (max 34)', () => {
    expect(classifyCell(0xdd, 0)).toEqual({ kind: 'star', starIndex: 0 });
    expect(classifyCell(0xff, 0)).toEqual({ kind: 'star', starIndex: 34 });
  });

  it('confirms dng1 contains the entrance stairs cell (215/0xD7) at the POI-verified column', () => {
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    const grid = decodeDungeonGrid(data);
    // dungeon-format.md §8.2.2a: dng1's only 0xD7 cell is at (20, 0).
    let found: { x: number; y: number } | null = null;
    for (let y = 0; y < DUNGEON_HEIGHT; y++) {
      for (let x = 0; x < DUNGEON_WIDTH; x++) {
        if (grid[y * DUNGEON_WIDTH + x] === 0xd7) found = { x, y };
      }
    }
    expect(found).toEqual({ x: 20, y: 0 });
    expect(classifyCell(0xd7, 0)).toEqual({ kind: 'stairsExit' });
  });
});

describe('§6 — P1/P2 trap formulas (confirmed, corrected)', () => {
  it('p1p2TrapDamageMax gives the clean linear 5/10/15/20/25 range', () => {
    expect(p1p2TrapDamageMax(0x02)).toBe(5);
    expect(p1p2TrapDamageMax(0x03)).toBe(10);
    expect(p1p2TrapDamageMax(0x04)).toBe(15);
    expect(p1p2TrapDamageMax(0x05)).toBe(20);
    expect(p1p2TrapDamageMax(0x06)).toBe(25);
  });

  it('p1p2TrapMessageIndex resolves to 0x05-0x09 for cells 0x02-0x06', () => {
    expect(p1p2TrapMessageIndex(0x02)).toBe(0x05);
    expect(p1p2TrapMessageIndex(0x06)).toBe(0x09);
  });
});
