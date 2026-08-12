import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildDungeonLevel, P3_DUNGEON_LETTERS } from '../build-dungeons.ts';

const D_DIR = resolve('data/phantasieiii/amiga/D');

describe('buildDungeonLevel — P3 dungeon-a (real dnga.dat, self-contained)', () => {
  const data = new Uint8Array(readFileSync(resolve(D_DIR, 'dnga.dat')));
  const dungeon = buildDungeonLevel(data, 'dungeon-a');

  it('assembles the P3 grid shape (24x30) with embedded messages', () => {
    expect(dungeon.width).toBe(24);
    expect(dungeon.height).toBe(30);
    expect(dungeon.cells).toHaveLength(720);
    expect(dungeon.messages).toHaveLength(110);
  });

  it('message slot 5 decodes to the doc-confirmed text', () => {
    expect(dungeon.messages[5]).toBe('Arrows fire from a slit in the roof.     ');
  });

  it('star slot 0 matches the doc-confirmed record (messageIndex 0, one-use)', () => {
    const star0 = dungeon.stars.find((s) => s.slotIndex === 0);
    expect(star0).toBeDefined();
    expect(star0!.messageIndex).toBe(0);
    expect(star0!.isOneUse).toBe(true);
  });

  it('action slot 0 resolves to a giveItem effect', () => {
    const action0 = dungeon.actions.find((a) => a.slotIndex === 0);
    expect(action0).toBeDefined();
    expect(action0!.effect.kind).toBe('giveItem');
  });

  it('is JSON-serialisable', () => {
    expect(() => JSON.stringify(dungeon)).not.toThrow();
  });
});

describe('all 11 real P3 dungeon files decode without throwing', () => {
  for (const letter of P3_DUNGEON_LETTERS) {
    it(`dng${letter}.dat`, () => {
      const data = new Uint8Array(readFileSync(resolve(D_DIR, `dng${letter}.dat`)));
      const dungeon = buildDungeonLevel(data, `dungeon-${letter}`);
      expect(dungeon.cells).toHaveLength(720);
      // Every real action's opcode must resolve through P3_OPCODES (buildActionEffect throws otherwise).
      expect(dungeon.actions.length).toBeGreaterThan(0);
    });
  }
});
