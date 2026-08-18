import { describe, it, expect } from 'vitest';
import { SAVE_VERSION, isSaveState, type SaveState } from '../GameStateSchema.ts';
import { createParty, hydrateParty } from '../PartyState.ts';
import { createCharacter } from '../CharacterState.ts';

function validSave(): SaveState {
  return {
    version: SAVE_VERSION,
    gameId: 'phantasieiii',
    platformId: 'amiga',
    party: createParty([createCharacter({ name: 'A' })]),
    location: { kind: 'overworld', x: 24, y: 37 },
    deactivatedStars: {},
    deactivatedActions: {},
  };
}

describe('GameStateSchema.isSaveState', () => {
  it('accepts a valid save', () => {
    expect(isSaveState(validSave())).toBe(true);
  });

  it('rejects a version mismatch', () => {
    const save = validSave();
    save.version = SAVE_VERSION + 1;
    expect(isSaveState(save)).toBe(false);
  });

  it('rejects a malformed party', () => {
    const save = validSave();
    save.party = { members: 'nope', gold: 0, items: [] } as unknown as SaveState['party'];
    expect(isSaveState(save)).toBe(false);
  });
});

describe('hydrateParty', () => {
  it('pads to 6 slots and preserves gold/items', () => {
    const party = createParty([createCharacter({ name: 'A', race: 3 })]);
    party.gold = 500;
    party.items = [7, 22];
    const out = hydrateParty(party);
    expect(out.members).toHaveLength(6);
    expect(out.members[0]?.name).toBe('A');
    expect(out.members[1]).toBeNull();
    expect(out.gold).toBe(500);
    expect(out.items).toEqual([7, 22]);
  });

  it('fills defaults for a member missing fields', () => {
    const party = { members: [{ name: 'X' }], gold: 0, items: [] } as unknown as ReturnType<typeof createParty>;
    const out = hydrateParty(party);
    const m = out.members[0];
    expect(m?.name).toBe('X');
    expect(m?.stats).toHaveLength(161);
    expect(m?.attributes).toHaveLength(6);
    expect(m?.rank).toBe(2);
  });
});
