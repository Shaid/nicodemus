/**
 * Phantasie III to-hit / damage-magnitude formula (scripting-engine.md
 * §7.5, with §7.5.1's operand-semantics correction). The party-attacks-
 * monster direction is disassembly-confirmed byte-exact; the inputs here
 * are the per-combat resolved stats §7.5.1 derives from the 262-byte
 * character record, so this module is pure and deterministic given a `CombatRng`.
 *
 * The monster-side mapping (what `monsinfo.dat` field backs the runtime
 * combat record's `monster.+0x28` armor and the "guaranteed-hit" flag) is
 * NOT confirmed — see `monsterStatsFor`'s TODO.
 */

import type { CombatRng } from './combat-rng.ts';
import type { CharacterState } from '../../state/CharacterState.ts';
import { classNames, type GameData } from '../../data/GameDataLoader.ts';

export interface CombatantStats {
  /** `char.+0x30` — Attack skill, the default-branch to-hit base. */
  attackSkill: number;
  /** `char.+0x48` — Fire Bow skill, the Fire-branch to-hit base. */
  fireBowSkill: number;
  /** `char.+0x6E == 4 or 15` — the Fire (missile) branch. */
  fireBranch: boolean;
  /** Default-branch damage die size (`$2A50[i]`). */
  meleeDie: number;
  /** Fire-branch damage die size (`$2A7A[i]`). */
  fireDie: number;
  /** `char.+0x08` combat rank (0-3). */
  rank: number;
  /** `char.+0x2C` status; 4 takes the -40 to-hit penalty. */
  status: number;
  /** The per-round divisor applied to the attack skill. */
  attacksThisRound: number;
  /** Difficulty mode; 2 takes the -15 to-hit penalty. */
  difficulty: number;
}

export interface MonsterStats {
  /** `monster.+0x28` — the to-hit subtrahend (armor). */
  armor: number;
  /** `monster[someIndexedField] == 1` — guaranteed-hit override. */
  guaranteedHit: boolean;
}

export interface AttackResult {
  hit: boolean;
  damage: number;
  threshold: number;
  roll: number;
}

/** Resolve one party-member attack against one monster (the confirmed formula). */
export function resolveAttack(
  attacker: CombatantStats,
  partyAvgRank: number,
  monster: MonsterStats,
  rng: CombatRng,
): AttackResult {
  let threshold: number;
  let die: number;
  if (attacker.fireBranch) {
    threshold = attacker.fireBowSkill - Math.floor(monster.armor / 2);
    die = attacker.fireDie;
  } else {
    threshold = Math.floor(attacker.attackSkill / Math.max(1, attacker.attacksThisRound)) - monster.armor;
    if (attacker.status === 4) threshold -= 40;
    threshold += (attacker.rank - partyAvgRank) * 30;
    if (attacker.difficulty === 2) threshold -= 15;
    die = attacker.meleeDie;
  }

  const damage = rng.roll(die); // dieRoll is accumulated in the branch first

  if (monster.guaranteedHit) threshold = 100;
  threshold = Math.max(threshold, 1);
  const roll = rng.roll(100);
  return { hit: roll <= threshold, damage, threshold, roll };
}

/** The class's Attack skill at `level` from the real skill table. */
export function attackSkillAt(data: GameData, classId: number, level: number): number {
  const cls = classNames(data)[classId];
  const row = data.skills.find((s) => s.skill === 'Attack' && s.class === cls);
  const levels = row?.levels ?? [];
  return levels[Math.max(0, Math.min(levels.length - 1, level - 1))] ?? 50;
}

/** Fire Bow maximum: `Str + 4×Dex + 2×Lvl + 10`, `+30` Thief, `+15` Elven (§7.5.3, disassembly-confirmed). */
export function fireBowMax(char: CharacterState): number {
  const [str, , dex] = char.attributes;
  let max = str + 4 * dex + 2 * char.level + 10;
  if (char.classId === 1) max += 30; // Thief
  if (char.race === 2) max += 15; // Elven
  return max;
}

/** An item's point value (data-tables.md §7's `pointValue[itemId]` table). */
export function pointValue(data: GameData, itemId: number): number {
  if (itemId <= 0) return 0;
  return data.items.find((i) => i.index === itemId)?.pointValue ?? 0;
}

/**
 * Derive the per-combat resolved stats §7.5.1 populates from the character
 * record, using the character's level-1 Attack skill and the shipped
 * default equipment (unequipped — `+0x6A`/`+0x6C`/`+0x86` = 0 until A4's
 * shop wires real gear). The combat-menu selection is fixed to melee for
 * this first slice (`fireBranch` always false — the menu isn't implemented).
 */
export function combatStatsFor(char: CharacterState, data: GameData): CombatantStats {
  const attackSkill = attackSkillAt(data, char.classId, char.level);
  const meleeDie = Math.max(1, Math.floor(attackSkill / 25));
  const fb = fireBowMax(char);
  return {
    attackSkill,
    fireBowSkill: Math.max(1, fb - 49), // creation-time current = max - 49 (§7.5.3)
    fireBranch: false,
    meleeDie,
    fireDie: Math.max(1, pointValue(data, 0) * 2 + 4),
    rank: char.rank,
    status: 1,
    attacksThisRound: 1,
    difficulty: 0,
  };
}

export function partyAvgRank(members: readonly CharacterState[]): number {
  if (members.length === 0) return 2;
  return members.reduce((acc, m) => acc + m.rank, 0) / members.length;
}

/**
 * Map a `monsinfo.dat` monster to the runtime combat record's fields.
 * TODO(scripting-p3-monster-combat-record): the runtime monster record the
 * formula reads (`monster.+0x28` armor, the guaranteed-hit flag, the
 * per-slot HP table) is not the 38-byte `monsinfo.dat` record and its
 * mapping is not disassembly-confirmed; `armorRating` (0x11) is used as
 * the closest named analogue.
 */
export function monsterStatsFor(monster: { armorRating: number }): MonsterStats {
  return { armor: monster.armorRating, guaranteedHit: false };
}
