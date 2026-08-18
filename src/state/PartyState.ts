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
  /**
   * Owned item indices (0-180, `readP3ItemNames`); duplicates = multiple
   * copies. Index 0 ("0") is the empty sentinel and is never held.
   *
   * The real game keeps carried items per-character (a confirmed 9-slot
   * `char.+0x3da0` array) plus a separate shared pending-loot pool
   * (`town-format.md` §3.7/§3.8) that Distribute assigns out to
   * characters. This build doesn't model that split yet — everything the
   * party owns sits in this one shared pool, and Trade Item (moving an
   * item between two characters' own inventories) isn't implemented since
   * there's no per-character inventory to move it from/to
   * (`town-p3-per-character-inventory` in TODO.md).
   */
  items: number[];
  /**
   * Experience pooled from combat victories, not yet divided among the
   * party (`town-format.md` §3.8's `$44ae`) — gold is awarded instantly
   * instead (`CombatScene`), but XP waits until town, matching the
   * confirmed mechanic. Divided by the town auto-trigger screen
   * (`TownScene`'s `DivideXpScene`-equivalent, town-format.md §3.7 mode 1)
   * into each member's `CharacterState.experience`.
   */
  pendingXp: number;
}

export function createParty(members: (CharacterState | null)[] = []): PartyState {
  const padded = new Array<CharacterState | null>(PARTY_SIZE).fill(null);
  for (let i = 0; i < Math.min(PARTY_SIZE, members.length); i++) padded[i] = members[i];
  return { members: padded, gold: 0, items: [], pendingXp: 0 };
}

export function occupiedMembers(party: PartyState): CharacterState[] {
  return party.members.filter((m): m is CharacterState => m !== null);
}

export function livingMembers(party: PartyState): CharacterState[] {
  return occupiedMembers(party).filter((m) => m.alive);
}

/**
 * Restore every occupied member to full HP and living. Not a real game
 * mechanic — P3's actual death handling is a judgment scene with
 * obliterate/undead/resurrect odds that isn't reverse-engineered yet
 * (`scripting-p3-death-judgment` in `TODO.md`). This is a debug/testing
 * convenience `JudgmentScene` uses so a party wipe doesn't require
 * recreating characters from scratch every test run.
 */
export function reviveParty(party: PartyState): void {
  for (const member of occupiedMembers(party)) {
    member.alive = true;
    member.hp = member.maxHp;
    member.mp = member.maxMp;
  }
}

export function addGold(party: PartyState, amount: number): void {
  party.gold += amount;
}

export function removeGold(party: PartyState, amount: number): void {
  party.gold = Math.max(0, party.gold - amount);
}

/** Total banked gold across every living member — the figure the Bank screen displays (town-format.md §3.6). */
export function totalBankedGold(party: PartyState): number {
  return livingMembers(party).reduce((sum, m) => sum + m.bankedGold, 0);
}

/** Sum every living member's banked gold into carried gold, zeroing each — all-or-nothing, no partial withdrawal (town-format.md §3.6). */
export function bankWithdrawAll(party: PartyState): void {
  for (const member of livingMembers(party)) {
    party.gold += member.bankedGold;
    member.bankedGold = 0;
  }
}

/**
 * Move `amount` from carried gold into the party's bank, split evenly
 * across every living member with the integer-division remainder handed
 * out one gold piece at a time to randomly-chosen living members
 * (town-format.md §3.6). `amount` is clamped to `party.gold`.
 */
export function bankDeposit(party: PartyState, amount: number, die: (n: number) => number = (n) => 1 + Math.floor(Math.random() * n)): void {
  const clamped = Math.max(0, Math.min(amount, party.gold));
  if (clamped === 0) return;
  const members = livingMembers(party);
  if (members.length === 0) return;
  party.gold -= clamped;
  const share = Math.floor(clamped / members.length);
  let remainder = clamped - share * members.length;
  for (const member of members) member.bankedGold += share;
  while (remainder > 0) {
    members[die(members.length) - 1].bankedGold += 1;
    remainder -= 1;
  }
}

/**
 * Divide `party.pendingXp` among living members by share weight, the
 * confirmed two-pass algorithm (town-format.md §3.7 mode 1, the auto-
 * triggered town-arrival screen): first, `floor(pendingXp / totalShares)`
 * individual +1 increments land one at a time on a uniformly-random
 * living member (ignoring weights); the remainder is then split
 * `floor(remainingXp / totalShares)` per share-weight point. Zeroes
 * `pendingXp` afterward regardless (a small last-remainder loss from the
 * second pass's own integer division is inherent to the confirmed
 * algorithm, not a bug here).
 *
 * `weights` must have one entry per `livingMembers(party)`, in that same
 * order — the real game clamps a living member's weight to `1`-`3`
 * (dead members can get `0`, i.e. excluded, but `livingMembers()` never
 * includes them here, so that clamp doesn't apply to this signature).
 */
export function divideXp(
  party: PartyState,
  weights: number[],
  die: (n: number) => number = (n) => 1 + Math.floor(Math.random() * n),
): void {
  const members = livingMembers(party);
  const totalShares = weights.reduce((a, b) => a + b, 0);
  if (members.length === 0 || totalShares <= 0) {
    party.pendingXp = 0;
    return;
  }
  let pool = party.pendingXp;
  const quotient = Math.floor(pool / totalShares);
  for (let i = 0; i < quotient; i++) {
    members[die(members.length) - 1].experience += 1;
  }
  pool -= quotient;
  const perShare = Math.floor(pool / totalShares);
  members.forEach((m, i) => (m.experience += (weights[i] ?? 0) * perShare));
  party.pendingXp = 0;
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
    pendingXp: typeof party.pendingXp === 'number' ? party.pendingXp : 0,
  };
}
