/**
 * Phantasie III's non-combat "Cast Spell" mechanics (spell-format.md),
 * disassembly-confirmed. Only Healing (spell indices 1-4) and Resurrection
 * (44) are implemented end to end here — those are the two effects
 * spell-format.md §9 calls "ready to implement end to end"; every other
 * spell index is confirmed to hit `"You cannot cast this here."` (zero
 * effect, zero MP spent) from this same non-combat entry point — Combat-
 * type spells (Fireflash, Confusion, etc.) belong on the in-combat Spell
 * menu, whose own cast implementation was never located (spell-format.md
 * §8's largest open item) — see `isCastableHere()`.
 */

import { BODY_LOCATION_OKAY, type CharacterState } from '../state/CharacterState.ts';

export const SPELL_HEALING_I = 1;
export const SPELL_HEALING_IV = 4;
export const SPELL_RESURRECTION = 44;

export type Die = (n: number) => number;

export function uniformDie(n: number): number {
  return 1 + Math.floor(Math.random() * n);
}

/** `hunk1+0xe51`, byte per spell index (0 unused, 1-57) — confirmed byte-exact against the manual's MAGIC PTS. column (spell-format.md §7). Fixed per-spell cost, not level/attribute-scaled. */
export const SPELL_MP_COST: Readonly<Record<number, number>> = {
  1: 1, 2: 2, 3: 3, 4: 4, // Healing I-IV
  5: 1, 6: 2, 7: 3, 8: 4, // Fireflash I-IV
  9: 1, 10: 2, 11: 3, 12: 4, // Quickness I-IV
  13: 1, 14: 2, 15: 3, 16: 4, // Arrow Flame family
  17: 1, 18: 2, 19: 3, 20: 4, // Protection I-IV
  21: 1, 22: 2, 23: 3, 24: 4, // Confusion I-IV
  25: 1, 26: 2, 27: 3, 28: 4, // Weakness I-IV
  29: 1, 30: 2, 31: 3, 32: 4, // Binding I-IV
  33: 1, 34: 2, 35: 3, 36: 4, // Mindblast I-IV
  37: 1, 38: 2, 39: 3, 40: 4, // Flamebolt I-IV
  41: 1, // Charm
  42: 2, // Sleep
  43: 3, // Teleportation
  44: 4, // Resurrection
  45: 1, // Ninja II
  46: 2, // Fear
  47: 3, // Dissolve
  48: 4, // Summon Elemental
  49: 1, // Dispel Undead
  50: 2, // Ninja I
  51: 3, // Awaken
  52: 4, // Monster Evaluate
  53: 1, // Vision (unused)
  54: 2, // Transportation
  55: 3, // Accuracy
  56: 4, // Party Accuracy
  57: 0, // Divine Aid (plot-gated, town-format.md §3.5)
};

/** `hunk1+0xe8a[1..4]` — Healing's HP-roll upper bound per tier, confirmed byte-exact against the manual's "1-9/1-27/1-57/1-99 hit points" (spell-format.md §4.1). */
const HEALING_MAX_ROLL: Readonly<Record<number, number>> = { 1: 9, 2: 27, 3: 57, 4: 99 };

/** Only Healing (1-4) and Resurrection (44) are implemented here — every other spell index correctly refuses from this entry point in the real game too (spell-format.md §3). */
export function isCastableHere(spellIndex: number): boolean {
  return (spellIndex >= SPELL_HEALING_I && spellIndex <= SPELL_HEALING_IV) || spellIndex === SPELL_RESURRECTION;
}

/**
 * `BodyLocationCure(spellTier)`, file `0xf6c0` — a greedy point-budget
 * algorithm: repeatedly clear the first body location whose severity
 * exactly equals however many points are still available, otherwise try
 * one point lower, until the budget is exhausted (spell-format.md §4.2).
 * Mutates `bodyLocations` in place. Budget `>= 3` checks `Gone` (severity
 * `3`) first — Healing III/IV can clear it; Healing I/II never reach it.
 */
export function cureBodyLocations(bodyLocations: number[], spellTier: number): void {
  let remaining = spellTier;
  let budget = spellTier;
  while (remaining !== 0) {
    const i = bodyLocations.findIndex((severity) => severity === remaining);
    if (i >= 0) {
      bodyLocations[i] = BODY_LOCATION_OKAY;
      budget -= remaining;
      remaining = budget;
    } else {
      remaining -= 1;
    }
  }
}

export interface HealingResult {
  healed: number;
}

/**
 * Healing I-IV (spell-format.md §4): roll `1..HEALING_MAX_ROLL[tier]`,
 * clamp to missing HP, cure body locations by the tier's point budget
 * (before applying the HP roll, matching the confirmed order), then apply
 * the HP roll. `tier` is the spell index (1-4) directly — no remap needed.
 */
export function applyHealing(target: CharacterState, tier: number, die: Die = uniformDie): HealingResult {
  const missing = target.maxHp - target.hp;
  let healed = die(HEALING_MAX_ROLL[tier]);
  if (healed > missing) healed = missing;
  cureBodyLocations(target.bodyLocations, tier);
  target.hp += healed;
  return { healed };
}

/**
 * Resurrection (spell-format.md §5): target must be dead. Revives at 1 HP
 * (not full), full MP restore, all six body locations unconditionally
 * cleared (regardless of severity — stronger than Healing's budgeted
 * cure), Constitution -= `Random(2)` clamped to a floor of 3.
 */
export function applyResurrection(target: CharacterState, constitutionIndex: number, die: Die = uniformDie): void {
  target.hp = 1;
  target.mp = target.maxMp;
  target.alive = true;
  target.bodyLocations = target.bodyLocations.map(() => BODY_LOCATION_OKAY);
  const roll = die(2);
  target.attributes[constitutionIndex] = Math.max(3, target.attributes[constitutionIndex] - roll);
}
