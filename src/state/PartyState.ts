/**
 * The live party — up to 6 character slots plus gold and the shared item
 * inventory. This is the single mutable game-state object the dungeon
 * interpreter, combat, and towns all read and write (docs/implementation.md
 * §A0).
 */

import { createCharacter, type CharacterState } from './CharacterState.ts';

export const PARTY_SIZE = 6;

export interface PartyState {
  /** Exactly 6 slots; `null` = empty (P3's party array is 6 slots + a terminator, §7.5.1). */
  members: (CharacterState | null)[];
  gold: number;
  /** Owned item indices (0-180, `readP3ItemNames`); duplicates = multiple copies. Index 0 ("0") is the empty sentinel and is never held. */
  items: number[];
}

export function createParty(members: (CharacterState | null)[] = []): PartyState {
  const padded = new Array<CharacterState | null>(PARTY_SIZE).fill(null);
  for (let i = 0; i < Math.min(PARTY_SIZE, members.length); i++) padded[i] = members[i];
  return { members: padded, gold: 0, items: [] };
}

export function occupiedMembers(party: PartyState): CharacterState[] {
  return party.members.filter((m): m is CharacterState => m !== null);
}

export function livingMembers(party: PartyState): CharacterState[] {
  return occupiedMembers(party).filter((m) => m.alive);
}

export function addGold(party: PartyState, amount: number): void {
  party.gold += amount;
}

export function removeGold(party: PartyState, amount: number): void {
  party.gold = Math.max(0, party.gold - amount);
}

export function giveItem(party: PartyState, itemIndex: number): void {
  if (itemIndex === 0) return; // empty-slot sentinel, never a real item
  party.items.push(itemIndex);
}

export function hasItem(party: PartyState, itemIndex: number): boolean {
  return party.items.includes(itemIndex);
}

/**
 * Rebuild a live `PartyState` from a (possibly old/incomplete) save,
 * padding to 6 slots and filling defaults so a malformed member can't
 * crash the runtime. Pure — no storage access.
 */
export function hydrateParty(party: PartyState): PartyState {
  const members = new Array<CharacterState | null>(PARTY_SIZE).fill(null);
  for (let i = 0; i < Math.min(PARTY_SIZE, party.members.length); i++) {
    const m = party.members[i];
    if (!m || typeof m !== 'object') continue;
    members[i] = createCharacter({ ...m, name: m.name || 'Adventurer' });
  }
  return {
    members,
    gold: typeof party.gold === 'number' ? party.gold : 0,
    items: Array.isArray(party.items) ? [...party.items] : [],
  };
}
