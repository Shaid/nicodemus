import { describe, it, expect } from 'vitest';
import {
  P1_OPCODES,
  P2_OPCODES,
  P3_OPCODES,
  ACTION_DOUBLE_SIZED_OPCODES,
  actionRecordSizeBytes,
  p3RemapStatIndex,
  P3_STAT_INDEX_REMAP_THRESHOLD,
} from '../opcodes.ts';

describe('opcodes.ts — opcode tables as data (scripting-engine.md §5)', () => {
  it('P1 stops at 0x13 — no P2/P3 extension entries', () => {
    expect(P1_OPCODES.has(0x13)).toBe(true);
    expect(P1_OPCODES.has(0x14)).toBe(false);
    expect(P1_OPCODES.has(0x17)).toBe(false);
  });

  it('P2 adds exactly 0x14-0x17', () => {
    for (let op = 0x14; op <= 0x17; op++) expect(P2_OPCODES.has(op)).toBe(true);
    expect(P2_OPCODES.has(0x18)).toBe(false);
    expect(P2_OPCODES.get(0x16)!.kind).toBe('gotoStar');
    expect(P2_OPCODES.get(0x17)!.kind).toBe('win');
    expect(P2_OPCODES.get(0x17)!.forcesStop).toBe(true);
  });

  it('P3 adds exactly 0x14-0x1B, a disjoint numbering from P2s extension', () => {
    for (let op = 0x14; op <= 0x1b; op++) expect(P3_OPCODES.has(op)).toBe(true);
    expect(P3_OPCODES.has(0x1c)).toBe(false);
    expect(P3_OPCODES.get(0x14)!.kind).toBe('gotoAction');
    expect(P3_OPCODES.get(0x16)!.kind).toBe('gotoStar');
    expect(P3_OPCODES.get(0x17)!.kind).toBe('itemGate');
    expect(P3_OPCODES.get(0x19)!.kind).toBe('bitmaskGate');
    expect(P3_OPCODES.get(0x1a)!.kind).toBe('raceGate');
    expect(P3_OPCODES.get(0x1b)!.kind).toBe('statIncrementAll');
  });

  it('the 0x00-0x13 core table is identical across all three games (same kind per opcode)', () => {
    for (let op = 0x00; op <= 0x13; op++) {
      expect(P1_OPCODES.get(op)!.kind).toBe(P2_OPCODES.get(op)!.kind);
      expect(P1_OPCODES.get(op)!.kind).toBe(P3_OPCODES.get(op)!.kind);
    }
  });

  it('0x00, 0x10, 0x11 force a stop; ordinary opcodes do not', () => {
    expect(P1_OPCODES.get(0x00)!.forcesStop).toBe(true);
    expect(P1_OPCODES.get(0x10)!.forcesStop).toBe(true);
    expect(P1_OPCODES.get(0x11)!.forcesStop).toBe(true);
    expect(P1_OPCODES.get(0x06)!.forcesStop).toBe(false);
  });

  it('0x12/0x13 carry an unverifiedFor:[p2,p3] flag (P1 alone is disassembly-confirmed, §6.3(b))', () => {
    // The flag describes the opcode's own verification status, not "which
    // table you looked it up from" — all three tables share the same
    // underlying core-opcode definitions, so it's visible from any of them.
    expect(P1_OPCODES.get(0x12)!.unverifiedFor).toEqual(['p2', 'p3']);
    expect(P1_OPCODES.get(0x13)!.unverifiedFor).toEqual(['p2', 'p3']);
    expect(P2_OPCODES.get(0x12)!.unverifiedFor).toEqual(['p2', 'p3']);
    expect(P3_OPCODES.get(0x13)!.unverifiedFor).toEqual(['p2', 'p3']);
    // No other opcode carries this flag.
    for (const table of [P1_OPCODES, P2_OPCODES, P3_OPCODES]) {
      for (const def of table.values()) {
        if (def.opcode !== 0x12 && def.opcode !== 0x13) expect(def.unverifiedFor).toBeUndefined();
      }
    }
  });

  it('actionRecordSizeBytes: the confirmed double-sized set gives 4 bytes, else 2', () => {
    for (const op of ACTION_DOUBLE_SIZED_OPCODES) expect(actionRecordSizeBytes(op)).toBe(4);
    expect(actionRecordSizeBytes(0x00)).toBe(2);
    expect(actionRecordSizeBytes(0x06)).toBe(2);
    expect(actionRecordSizeBytes(0x14)).toBe(2);
    expect(actionRecordSizeBytes(0x16)).toBe(2);
    expect(actionRecordSizeBytes(0x1a)).toBe(2);
    expect(actionRecordSizeBytes(0x1b)).toBe(2);
  });

  it('every opcode with 2+ named params is in the double-sized set', () => {
    for (const table of [P1_OPCODES, P2_OPCODES, P3_OPCODES]) {
      for (const def of table.values()) {
        if (def.params.length >= 2) {
          expect(ACTION_DOUBLE_SIZED_OPCODES.has(def.opcode)).toBe(true);
        }
      }
    }
  });

  it('p3RemapStatIndex subtracts the threshold only when raw >= it', () => {
    expect(p3RemapStatIndex(10)).toBe(10);
    expect(p3RemapStatIndex(P3_STAT_INDEX_REMAP_THRESHOLD)).toBe(0);
    expect(p3RemapStatIndex(117)).toBe(117 - P3_STAT_INDEX_REMAP_THRESHOLD);
    expect(p3RemapStatIndex(126)).toBe(126 - P3_STAT_INDEX_REMAP_THRESHOLD);
  });
});
