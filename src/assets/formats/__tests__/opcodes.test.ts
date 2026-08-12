import { describe, it, expect } from 'vitest';
import {
  P1_OPCODES,
  P2_OPCODES,
  P3_OPCODES,
  ACTION_DOUBLE_SIZED_OPCODES,
  actionRecordSizeBytes,
  p3RemapStatIndex,
  P3_STAT_INDEX_REMAP_GUARD,
  P3_STAT_INDEX_REMAP_AMOUNT,
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

  it('0x12/0x13 carry no unverifiedFor flag anywhere — all three games are now disassembly-confirmed (2026-08-12)', () => {
    // P2's own ExecuteAction handlers for 0x12/0x13 were the last unverified
    // holdout (PHANT.PRG logical addr 0x11F0C/0x11F54, scripting-engine.md
    // §5's 2026-08-12 "P2 resolved" correction block) — P1's, P2's and P3's
    // 0x12/0x13 are each distinct override objects now (CORE_OPCODES for
    // P1, P2_OVERRIDE_OPCODES for P2, P3_EXTENSION_OPCODES for P3) and none
    // carry the flag.
    expect(P1_OPCODES.get(0x12)!.unverifiedFor).toBeUndefined();
    expect(P1_OPCODES.get(0x13)!.unverifiedFor).toBeUndefined();
    expect(P2_OPCODES.get(0x12)!.unverifiedFor).toBeUndefined();
    expect(P2_OPCODES.get(0x13)!.unverifiedFor).toBeUndefined();
    expect(P3_OPCODES.get(0x12)!.unverifiedFor).toBeUndefined();
    expect(P3_OPCODES.get(0x13)!.unverifiedFor).toBeUndefined();
    // No opcode anywhere carries this flag any more.
    for (const table of [P1_OPCODES, P2_OPCODES, P3_OPCODES]) {
      for (const def of table.values()) {
        expect(def.unverifiedFor).toBeUndefined();
      }
    }
  });

  it('P2\'s and P3\'s 0x12/0x13 are distinct objects from P1\'s and from each other, with real behavioral differences documented (unconditional set, inverted-polarity gate)', () => {
    expect(P2_OPCODES.get(0x12)).not.toBe(P1_OPCODES.get(0x12));
    expect(P2_OPCODES.get(0x13)).not.toBe(P1_OPCODES.get(0x13));
    expect(P3_OPCODES.get(0x12)).not.toBe(P1_OPCODES.get(0x12));
    expect(P3_OPCODES.get(0x13)).not.toBe(P1_OPCODES.get(0x13));
    expect(P2_OPCODES.get(0x12)!.description).toMatch(/unconditional/i);
    expect(P2_OPCODES.get(0x13)!.description).toMatch(/opposite polarity/i);
    expect(P3_OPCODES.get(0x12)!.description).toMatch(/unconditional/i);
    expect(P3_OPCODES.get(0x13)!.description).toMatch(/opposite polarity/i);
    // Same `kind` across all three games though — the shape (setStat/
    // statGate) is shared, only the exact runtime semantics differ.
    expect(P2_OPCODES.get(0x12)!.kind).toBe('setStat');
    expect(P2_OPCODES.get(0x13)!.kind).toBe('statGate');
    expect(P3_OPCODES.get(0x12)!.kind).toBe('setStat');
    expect(P3_OPCODES.get(0x13)!.kind).toBe('statGate');
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

  it('p3RemapStatIndex subtracts the remap amount only when raw > the guard (0x78) — corrected 2026-08-12, was >= 0x3D', () => {
    expect(p3RemapStatIndex(10)).toBe(10);
    // At and just below the old (wrong) 0x3D threshold: no remap now.
    expect(p3RemapStatIndex(0x3d)).toBe(0x3d);
    expect(p3RemapStatIndex(117)).toBe(117); // < 0x79, no remap under the corrected rule
    expect(p3RemapStatIndex(120)).toBe(120); // < 0x79, no remap under the corrected rule
    // At and above the real guard (0x78, i.e. > 0x78 remaps):
    expect(p3RemapStatIndex(P3_STAT_INDEX_REMAP_GUARD)).toBe(P3_STAT_INDEX_REMAP_GUARD); // == guard, no remap (strict >)
    expect(p3RemapStatIndex(P3_STAT_INDEX_REMAP_GUARD + 1)).toBe(P3_STAT_INDEX_REMAP_GUARD + 1 - P3_STAT_INDEX_REMAP_AMOUNT);
    expect(p3RemapStatIndex(122)).toBe(122 - P3_STAT_INDEX_REMAP_AMOUNT);
    expect(p3RemapStatIndex(126)).toBe(126 - P3_STAT_INDEX_REMAP_AMOUNT);
    expect(p3RemapStatIndex(127)).toBe(127 - P3_STAT_INDEX_REMAP_AMOUNT);
  });
});
