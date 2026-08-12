import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { DUNGEON_STAR_TABLE_OFFSET, DUNGEON_ACTION_TABLE_OFFSET } from '../dungeon.ts';
import {
  DUNGEON_P3_STAR_TABLE_OFFSET,
  DUNGEON_P3_ACTION_TABLE_OFFSET,
  DUNGEON_P3_ACTION_TABLE_SLOT_COUNT,
} from '../dungeon-p3.ts';
import {
  decodeStarRecord,
  decodeStarTable,
  starTableToMap,
  decodeActionRecord,
  decodeActionTable,
  actionTableToMap,
  buildActionEffect,
  executeStar,
  executeStarChain,
  type ExecuteStarHost,
  type ActionEffect,
} from '../star-action.ts';
import { P1_OPCODES, P2_OPCODES, P3_OPCODES } from '../opcodes.ts';

const DNG1_PATH = resolve('data/phantasie/amiga/dng1');
const DNGA_PATH = resolve('data/phantasieiii/amiga/D/dnga.dat');

describe('star record decode (scripting-engine.md §1)', () => {
  it('dng1 star slot 0 (5B 02 4B 00 00) decodes exactly as documented', () => {
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    const raw = Array.from(data.slice(DUNGEON_STAR_TABLE_OFFSET, DUNGEON_STAR_TABLE_OFFSET + 5));
    expect(raw).toEqual([0x5b, 0x02, 0x4b, 0x00, 0x00]);

    const star = decodeStarRecord(data, DUNGEON_STAR_TABLE_OFFSET, 0);
    expect(star.messageIndex).toBe(90);
    expect(star.isOneUse).toBe(false);
    expect(star.isActive).toBe(true);
    expect(star.nbChoices).toBe(2);
    expect(star.actionsIndex).toEqual([0x4b, 0x00]);
    expect(star.sizeSlots).toBe(1);
  });

  it('byte 0 === 0xFF is the dedicated inactive sentinel (full-byte equality)', () => {
    const data = new Uint8Array([0xff, 0x01, 0x00, 0x00, 0x00]);
    const star = decodeStarRecord(data, 0, 0);
    expect(star.isActive).toBe(false);
  });

  it('decodeStarTable scans the packed 35-slot table for dng1, skipping empty (0x00) slots by 1', () => {
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    const stars = decodeStarTable(data, DUNGEON_STAR_TABLE_OFFSET);
    expect(stars[0].slotIndex).toBe(0);
    expect(stars[0].empty).toBe(false);
    expect(stars[0].messageIndex).toBe(90);
    // Every scanned slot index is strictly increasing.
    for (let i = 1; i < stars.length; i++) expect(stars[i].slotIndex).toBeGreaterThan(stars[i - 1].slotIndex);
    // The scan never runs past the declared 35-slot capacity.
    expect(stars[stars.length - 1].slotIndex).toBeLessThan(35);
  });

  it('starTableToMap indexes only non-empty records by slot index', () => {
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    const stars = decodeStarTable(data, DUNGEON_STAR_TABLE_OFFSET);
    const map = starTableToMap(stars);
    expect(map.get(0)!.messageIndex).toBe(90);
    for (const s of stars) if (s.empty) expect(map.has(s.slotIndex)).toBe(false);
  });

  it('P3 dnga.dat star slot 0 (81 01 00 00 00): messageIndex 0, one-use, one choice', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    const star = decodeStarRecord(data, DUNGEON_P3_STAR_TABLE_OFFSET, 0);
    expect(star.messageIndex).toBe(0);
    expect(star.isOneUse).toBe(true);
    expect(star.nbChoices).toBe(1);
    expect(star.actionsIndex).toEqual([0]);
  });
});

describe('action record decode (scripting-engine.md §2)', () => {
  it('dng1 action slot 5 (address 0x5AA+5*2=0x5B4) decodes from C6 33 exactly as documented', () => {
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    const offset = DUNGEON_ACTION_TABLE_OFFSET + 5 * 2;
    expect(offset).toBe(0x5b4);
    expect(Array.from(data.slice(offset, offset + 2))).toEqual([0xc6, 0x33]);

    const action = decodeActionRecord(data, offset, 5);
    expect(action.opcode).toBe(0x06);
    expect(action.isLastAction).toBe(false);
    expect(action.isOneUse).toBe(true);
    expect(action.params[0]).toBe(0x33);
    expect(action.sizeBytes).toBe(2);
  });

  it('slots 0-4 are all-zero (inert placeholders), still decoded, not chained into', () => {
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    for (let i = 0; i < 5; i++) {
      const offset = DUNGEON_ACTION_TABLE_OFFSET + i * 2;
      const action = decodeActionRecord(data, offset, i);
      expect(action.isActive).toBe(false);
      expect(action.opcode).toBe(0x00);
    }
  });

  it('decodeActionTable finds the 0x0D 0x0D terminator at the documented offset 0x6CC for dng1', () => {
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    const actions = decodeActionTable(data, DUNGEON_ACTION_TABLE_OFFSET, { terminator: true });
    const last = actions[actions.length - 1];
    const lastEnd = last.offset + last.sizeBytes;
    expect(lastEnd).toBeLessThanOrEqual(0x6cc);
    expect(data[0x6cc]).toBe(0x0d);
    expect(data[0x6cd]).toBe(0x0d);
  });

  it('decodeActionTable terminator scan finds the documented terminator across all 10 real P1 files', () => {
    const expected: Record<number, number> = { 1: 0x6cc, 2: 0x6ce, 3: 0x6cc, 4: 0x6d4 };
    for (let n = 1; n <= 10; n++) {
      const data = new Uint8Array(readFileSync(resolve(`data/phantasie/amiga/dng${n}`)));
      const actions = decodeActionTable(data, DUNGEON_ACTION_TABLE_OFFSET, { terminator: true });
      const last = actions[actions.length - 1];
      const endOffset = last.offset + last.sizeBytes;
      expect(data[endOffset]).toBe(0x0d);
      expect(data[endOffset + 1]).toBe(0x0d);
      if (expected[n] !== undefined) expect(endOffset).toBe(expected[n]);
    }
  });

  it('P3 action table decodes a fixed 256-slot walk bounded by the message pointer table, no terminator', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    const actions = decodeActionTable(data, DUNGEON_P3_ACTION_TABLE_OFFSET, {
      slotCount: DUNGEON_P3_ACTION_TABLE_SLOT_COUNT,
    });
    const last = actions[actions.length - 1];
    expect(last.slotIndex + last.sizeSlots).toBeLessThanOrEqual(DUNGEON_P3_ACTION_TABLE_SLOT_COUNT);
    // The whole walk stays inside the action table region.
    expect(last.offset + last.sizeBytes).toBeLessThanOrEqual(
      DUNGEON_P3_ACTION_TABLE_OFFSET + DUNGEON_P3_ACTION_TABLE_SLOT_COUNT * 2,
    );
  });

  it('P3 action slot 0 (46 7A) decodes to opcode 0x06 (+Item), item index 0x7A', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    const action = decodeActionRecord(data, DUNGEON_P3_ACTION_TABLE_OFFSET, 0);
    expect(action.opcode).toBe(0x06);
    expect(action.params[0]).toBe(0x7a);
  });
});

describe('buildActionEffect', () => {
  it('resolves opcode 0x06 (+Item) to a named itemIndex value', () => {
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    const action = decodeActionRecord(data, DUNGEON_ACTION_TABLE_OFFSET + 5 * 2, 5);
    const effect = buildActionEffect(action, P1_OPCODES);
    expect(effect.kind).toBe('giveItem');
    expect(effect.values.itemIndex).toBe(0x33);
  });

  it('throws for an opcode not present in the given table (e.g. P2/P3-only opcode against P1)', () => {
    const fakeAction = {
      slotIndex: 0,
      offset: 0,
      opcode: 0x1b,
      isActive: true,
      isLastAction: true,
      isOneUse: false,
      params: [],
      sizeBytes: 2 as const,
      sizeSlots: 1 as const,
    };
    expect(() => buildActionEffect(fakeAction, P1_OPCODES)).toThrow();
  });
});

/** A recording host: no-ops every callback, just logs what was called. */
function makeRecordingHost(choices: number[] = []): ExecuteStarHost & { shown: number[]; effects: ActionEffect[] } {
  const shown: number[] = [];
  const effects: ActionEffect[] = [];
  let choiceCursor = 0;
  return {
    shown,
    effects,
    showMessage(messageIndex) {
      shown.push(messageIndex);
    },
    promptChoice() {
      return choices[choiceCursor++] ?? 1;
    },
    applyEffect(effect) {
      effects.push(effect);
    },
  };
}

describe('ExecuteStar interpreter (scripting-engine.md §4)', () => {
  it('an inactive/missing star returns null immediately', () => {
    const host = makeRecordingHost();
    const result = executeStar(new Map(), new Map(), P1_OPCODES, 0, host);
    expect(result).toBeNull();
    expect(host.shown).toHaveLength(0);
  });

  it('runs dng1 star 0 end-to-end against the real action table: shows message 90, choice 1, first action gives item 0x33-analog', () => {
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    const stars = starTableToMap(decodeStarTable(data, DUNGEON_STAR_TABLE_OFFSET));
    const actions = actionTableToMap(decodeActionTable(data, DUNGEON_ACTION_TABLE_OFFSET, { terminator: true }));

    const host = makeRecordingHost([1]); // choose option 1 -> actionsIndex[0] = 0x4B
    const result = executeStar(stars, actions, P1_OPCODES, 0, host);

    expect(result).not.toBeNull();
    expect(result!.messageIndex).toBe(90);
    expect(result!.choice).toBe(1);
    expect(host.shown).toEqual([90]);
    expect(result!.steps.length).toBeGreaterThan(0);
    // First action in the chain is action-table slot 0x4B (75), opcode 0x0B (fullscreen message).
    expect(result!.steps[0].actionIndex).toBe(0x4b);
    expect(result!.steps[0].effect.kind).toBe('showMessage');
    expect(result!.steps[0].effect.values.messageIndexPlus1).toBe(0x60);
  });

  it('choosing option 2 on dng1 star 0 starts the chain at action slot 0 (inert, opcode 0 = Stop)', () => {
    const data = new Uint8Array(readFileSync(DNG1_PATH));
    const stars = starTableToMap(decodeStarTable(data, DUNGEON_STAR_TABLE_OFFSET));
    const actions = actionTableToMap(decodeActionTable(data, DUNGEON_ACTION_TABLE_OFFSET, { terminator: true }));

    const host = makeRecordingHost([2]);
    const result = executeStar(stars, actions, P1_OPCODES, 0, host);
    // Action slot 0 is inert (isActive=false) — the chain loop breaks immediately, no steps recorded.
    expect(result!.steps).toHaveLength(0);
  });

  it('one-use deactivation is reported via onDeactivate after the chain runs', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    const stars = starTableToMap(decodeStarTable(data, DUNGEON_P3_STAR_TABLE_OFFSET));
    const actions = actionTableToMap(
      decodeActionTable(data, DUNGEON_P3_ACTION_TABLE_OFFSET, { slotCount: DUNGEON_P3_ACTION_TABLE_SLOT_COUNT }),
    );
    const deactivated: [string, number][] = [];
    const host: ExecuteStarHost = {
      showMessage() {},
      promptChoice: () => 1,
      applyEffect() {},
      onDeactivate(kind, index) {
        deactivated.push([kind, index]);
      },
    };
    const result = executeStar(stars, actions, P3_OPCODES, 0, host);
    expect(result).not.toBeNull();
    // dnga.dat star slot 0 is one-use (isOneUse=true, confirmed above).
    expect(deactivated).toContainEqual(['star', 0]);
  });

  it('a gotoStar-kind action redirects the outer chain without host involvement', () => {
    // Synthetic table: star 0 -> action 0 (gotoStar to star 5), star 5 -> action 1 (Stop).
    const stars = new Map([
      [0, { slotIndex: 0, offset: 0, empty: false, isActive: true, isOneUse: false, messageIndex: 1, nbChoices: 1, actionsIndex: [0], sizeSlots: 1 }],
      [5, { slotIndex: 5, offset: 0, empty: false, isActive: true, isOneUse: false, messageIndex: 2, nbChoices: 1, actionsIndex: [1], sizeSlots: 1 }],
    ]);
    const actions = new Map([
      [0, { slotIndex: 0, offset: 0, opcode: 0x16, isActive: true, isLastAction: true, isOneUse: false, params: [6], sizeBytes: 2 as const, sizeSlots: 1 as const }],
      [1, { slotIndex: 1, offset: 0, opcode: 0x00, isActive: true, isLastAction: true, isOneUse: false, params: [0], sizeBytes: 2 as const, sizeSlots: 1 as const }],
    ]);
    const host = makeRecordingHost();
    // P2's opcode table is what defines 0x16 as gotoStar with a single param (star index + 1).
    const results = executeStarChain(stars, actions, P2_OPCODES, 0, host);
    expect(results).toHaveLength(2);
    expect(results[0].nextStarIndex).toBe(5);
    expect(results[1].starIndex).toBe(5);
    expect(results[1].nextStarIndex).toBeNull();
  });
});
