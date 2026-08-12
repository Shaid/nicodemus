import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildDungeonLevel, P1_DUNGEON_LEVEL_COUNT } from '../build-dungeons.ts';

const DATA_DIR = resolve('data/phantasie/amiga');

describe('buildDungeonLevel — P1 dungeon-1 (real dng1/mess1)', () => {
  const dngData = new Uint8Array(readFileSync(resolve(DATA_DIR, 'dng1')));
  const messData = new Uint8Array(readFileSync(resolve(DATA_DIR, 'mess1')));
  const dungeon = buildDungeonLevel(dngData, messData, 'dungeon-1');

  it('assembles the confirmed grid/star/action/message shapes into one document', () => {
    expect(dungeon.name).toBe('dungeon-1');
    expect(dungeon.width).toBe(33);
    expect(dungeon.height).toBe(38);
    expect(dungeon.cells).toHaveLength(1254);
    expect(dungeon.fixedEncounterTable).toHaveLength(10);
    expect(dungeon.messages).toHaveLength(115);
  });

  it('star slot 0 matches the doc-confirmed record (messageIndex 90, nbChoices 2)', () => {
    const star0 = dungeon.stars.find((s) => s.slotIndex === 0);
    expect(star0).toBeDefined();
    expect(star0!.messageIndex).toBe(90);
    expect(star0!.nbChoices).toBe(2);
    expect(star0!.actionsIndex).toEqual([0x4b, 0]);
  });

  it('action slot 5 resolves to a giveItem effect with itemIndex 0x33 (51)', () => {
    const action5 = dungeon.actions.find((a) => a.slotIndex === 5);
    expect(action5).toBeDefined();
    expect(action5!.effect.kind).toBe('giveItem');
    expect(action5!.effect.values.itemIndex).toBe(0x33);
  });

  it('every giveItem effect resolves an item index in the confirmed 0-180 range', () => {
    for (const action of dungeon.actions) {
      if (action.effect.kind === 'giveItem') {
        expect(action.effect.values.itemIndex).toBeGreaterThanOrEqual(0);
        expect(action.effect.values.itemIndex).toBeLessThanOrEqual(180);
      }
    }
  });

  it('is JSON-serialisable with no circular references or undefined leaks', () => {
    expect(() => JSON.stringify(dungeon)).not.toThrow();
  });
});

describe('buildDungeonLevel — falls back to empty messages when no MESSn file exists', () => {
  it('does not throw, and produces an empty messages array', () => {
    const dngData = new Uint8Array(readFileSync(resolve(DATA_DIR, 'dng1')));
    const dungeon = buildDungeonLevel(dngData, null, 'dungeon-1');
    expect(dungeon.messages).toEqual([]);
    expect(dungeon.stars.length).toBeGreaterThan(0);
  });
});

describe('all 10 real P1 dungeon files decode without throwing', () => {
  for (let n = 1; n <= P1_DUNGEON_LEVEL_COUNT; n++) {
    it(`dng${n}/mess${n}`, () => {
      const dngData = new Uint8Array(readFileSync(resolve(DATA_DIR, `dng${n}`)));
      const messData = new Uint8Array(readFileSync(resolve(DATA_DIR, `mess${n}`)));
      const dungeon = buildDungeonLevel(dngData, messData, `dungeon-${n}`);
      expect(dungeon.cells).toHaveLength(1254);
      expect(dungeon.stars.length).toBeGreaterThan(0);
      expect(dungeon.actions.length).toBeGreaterThan(0);
    });
  }
});
