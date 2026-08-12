import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildDungeonLevel, P2_DUNGEON_LEVEL_COUNT } from '../build-dungeons.ts';

const DISK2_DIR = resolve('data/phantasieii/atarist/extracted/disk2');

describe('buildDungeonLevel — P2 dungeon-8 (real DNG8/MESS8)', () => {
  const dngData = new Uint8Array(readFileSync(resolve(DISK2_DIR, 'DNG8')));
  const messData = new Uint8Array(readFileSync(resolve(DISK2_DIR, 'MESS8')));
  const dungeon = buildDungeonLevel(dngData, messData, 'dungeon-8');

  it('assembles the shared P1/P2 grid shape (33x38)', () => {
    expect(dungeon.width).toBe(33);
    expect(dungeon.height).toBe(38);
    expect(dungeon.cells).toHaveLength(1254);
    expect(dungeon.messages).toHaveLength(115);
  });

  it('DNG8 uses the P2-exclusive opcode 0x17 (win marker) — confirmed max opcode 0x17', () => {
    const maxOpcode = Math.max(...dungeon.actions.map((a) => a.opcode));
    expect(maxOpcode).toBe(0x17);
    const winAction = dungeon.actions.find((a) => a.effect.kind === 'win');
    expect(winAction).toBeDefined();
    expect(winAction!.effect.description).toContain('GAME WON');
  });

  it('is JSON-serialisable', () => {
    expect(() => JSON.stringify(dungeon)).not.toThrow();
  });
});

describe('all 8 real P2 dungeon files decode without throwing, opcode never exceeds P2s own extension (0x17)', () => {
  for (let n = 1; n <= P2_DUNGEON_LEVEL_COUNT; n++) {
    it(`DNG${n}/MESS${n}`, () => {
      const dngData = new Uint8Array(readFileSync(resolve(DISK2_DIR, `DNG${n}`)));
      const messData = new Uint8Array(readFileSync(resolve(DISK2_DIR, `MESS${n}`)));
      const dungeon = buildDungeonLevel(dngData, messData, `dungeon-${n}`);
      expect(dungeon.cells).toHaveLength(1254);
      for (const action of dungeon.actions) {
        expect(action.opcode).toBeLessThanOrEqual(0x17);
      }
    });
  }
});
