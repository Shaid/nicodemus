import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  DUNGEON_P3_STAR_TABLE_OFFSET,
  DUNGEON_P3_ACTION_TABLE_OFFSET,
  DUNGEON_P3_ACTION_TABLE_SLOT_COUNT,
} from '../../assets/formats/dungeon-p3.ts';
import {
  decodeStarTable,
  decodeActionTable,
  starTableToMap,
  actionTableToMap,
} from '../../assets/formats/star-action.ts';
import { createCharacter } from '../../state/CharacterState.ts';
import { createParty } from '../../state/PartyState.ts';
import { DungeonHost } from '../DungeonHost.ts';

const DNGA_PATH = resolve('data/phantasieiii/amiga/D/dnga.dat');

function loadDnga() {
  const data = new Uint8Array(readFileSync(DNGA_PATH));
  return {
    stars: starTableToMap(decodeStarTable(data, DUNGEON_P3_STAR_TABLE_OFFSET)),
    actions: actionTableToMap(
      decodeActionTable(data, DUNGEON_P3_ACTION_TABLE_OFFSET, { slotCount: DUNGEON_P3_ACTION_TABLE_SLOT_COUNT }),
    ),
  };
}

describe('DungeonHost (Phantasie III)', () => {
  it('dnga.dat star 0 gives item 122 through the real interpreter', () => {
    const { stars, actions } = loadDnga();
    const party = createParty([createCharacter({ name: 'A' })]);
    const host = new DungeonHost({ gameId: 'phantasieiii', party, stars, actions });

    const results = host.triggerStar(0);

    expect(results.length).toBe(1);
    expect(party.items).toContain(122);
  });

  it('dnga.dat star 1 adds 512 gold (Param1 * 256)', () => {
    const { stars, actions } = loadDnga();
    const party = createParty([createCharacter({ name: 'A' })]);
    const host = new DungeonHost({ gameId: 'phantasieiii', party, stars, actions });

    host.triggerStar(1);

    expect(party.gold).toBe(512);
  });

  it('dnga.dat star 2 applies trap damage to living members only', () => {
    const { stars, actions } = loadDnga();
    const living = createCharacter({ name: 'A', hp: 10, maxHp: 10 });
    const dead = createCharacter({ name: 'B', hp: 10, maxHp: 10, alive: false });
    const party = createParty([living, dead]);
    const host = new DungeonHost({ gameId: 'phantasieiii', party, stars, actions, random: () => 0 });

    host.triggerStar(2); // action 6 = Trap (shock), maxDamage 3 -> [1,3]; random()=0 -> 1

    expect(living.hp).toBe(9);
    expect(dead.hp).toBe(10);
  });

  it('dnga.dat star 5 walks the pedestal quest chain: items + bitmask first, gold on the repeat', () => {
    const { stars, actions } = loadDnga();
    const member = createCharacter({ name: 'A' });
    const party = createParty([member]);
    const host = new DungeonHost({ gameId: 'phantasieiii', party, stars, actions });

    // First trigger: the stat gate (statIndex 127 -> remap 66, threshold 56)
    // fires on an all-zero party, the bitmask gate (bit 3 of stat 65) does NOT
    // yet fire, so the chain gives the Wand of Nikademus, sets quest bit 3,
    // and gives item 127 — without reaching the +Gold action.
    host.triggerStar(5);
    expect(party.items).toContain(180); // Wand of Nikademus
    expect(party.items).toContain(127);
    expect(party.gold).toBe(0);
    expect(member.stats[65] & 0b100).toBe(0b100); // bit 3 set (statIndex 126 -> remap 65)

    // Second trigger: bit 3 is now set, so the bitmask gate jumps to the
    // +Gold(100 * 256) action instead.
    host.triggerStar(5);
    expect(party.gold).toBe(25600);
  });

  it('routes messages and choices through the presenter', () => {
    const { stars, actions } = loadDnga();
    const party = createParty([createCharacter({ name: 'A' })]);
    const shown: [number, boolean][] = [];
    const host = new DungeonHost({
      gameId: 'phantasieiii',
      party,
      stars,
      actions,
      presenter: {
        showMessage: (index, fullscreen) => shown.push([index, fullscreen]),
        promptChoice: () => 1,
      },
    });

    host.triggerStar(6, 1); // star 6: message 43, choice 1 -> action 40 = fullscreen message 45-1

    expect(shown[0]).toEqual([43, false]);
    expect(shown[1]).toEqual([44, true]);
  });

  it('queues scene events for teleport / set-cell / encounter', () => {
    const { stars, actions } = loadDnga();
    const party = createParty([createCharacter({ name: 'A' })]);
    const host = new DungeonHost({ gameId: 'phantasieiii', party, stars, actions });

    host.applyEffect({ opcode: 0x0c, name: 'Teleport', kind: 'teleport', description: '', values: { x: 3, y: 7 } });
    host.applyEffect({ opcode: 0x0f, name: 'Set cell', kind: 'setCell', description: '', values: { x: 1, y: 2, newCell: 0 } });
    host.applyEffect({ opcode: 0x05, name: 'Encounter', kind: 'encounter', description: '', values: { monsterIndex: 77 } });

    expect(host.events).toEqual([
      { type: 'teleport', x: 3, y: 7 },
      { type: 'setCell', x: 1, y: 2, cell: 0 },
      { type: 'encounter', monsterIndex: 77, surprise: false },
    ]);
  });
});
