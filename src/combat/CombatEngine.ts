/**
 * Turn orchestration for a single Phantasie III battle — a party vs. a
 * monster group. The party→monster direction uses the confirmed
 * `resolveAttack` formula; the monster→party direction is a clearly-marked
 * approximation (P3's monster-side mirror was never traced — docs/
 * implementation.md §1.2).
 */

import type { CombatRng } from './formulas/combat-rng.ts';
import { combatStatsFor, monsterStatsFor, partyAvgRank, resolveAttack } from './formulas/p3-combat.ts';
import type { CharacterState } from '../state/CharacterState.ts';
import type { GameData } from '../data/GameDataLoader.ts';
import type { MonsterRecord } from '../assets/formats/monster-data.ts';

export interface MonsterSlot {
  record: MonsterRecord;
  hp: number;
}

export interface Battle {
  party: CharacterState[];
  monsters: MonsterSlot[];
  log: string[];
}

export function createBattle(party: CharacterState[], record: MonsterRecord, count: number): Battle {
  return {
    party: party.filter((m) => m.alive && m.hp > 0),
    monsters: Array.from({ length: Math.max(1, count) }, () => ({ record, hp: record.hp })),
    log: [],
  };
}

export function livingMonsters(battle: Battle): MonsterSlot[] {
  return battle.monsters.filter((m) => m.hp > 0);
}

export function livingParty(battle: Battle): CharacterState[] {
  return battle.party.filter((m) => m.alive && m.hp > 0);
}

export function isVictory(battle: Battle): boolean {
  return livingMonsters(battle).length === 0;
}

export function isDefeat(battle: Battle): boolean {
  return livingParty(battle).length === 0;
}

/** Every living member attacks the first living monster (confirmed formula). */
export function partyRound(battle: Battle, data: GameData, rng: CombatRng): void {
  const avgRank = partyAvgRank(livingParty(battle));
  for (const member of livingParty(battle)) {
    const target = livingMonsters(battle)[0];
    if (!target) return;
    const result = resolveAttack(combatStatsFor(member, data), avgRank, monsterStatsFor(target.record), rng);
    if (result.hit) {
      target.hp = Math.max(0, target.hp - result.damage);
      battle.log.push(`${member.name} hits ${target.record.name} for ${result.damage}`);
      if (target.hp === 0) battle.log.push(`${target.record.name} dies!`);
    } else {
      battle.log.push(`${member.name} misses ${target.record.name}`);
    }
  }
  battle.monsters = battle.monsters.filter((m) => m.hp > 0);
}

/**
 * Every living monster attacks a random living member.
 * TODO(scripting-p3-monster-mirror): P3's monster→player hit/damage path is
 * not traced; this is a plain `attackRaw * 10`% hit chance for `attackRaw`
 * damage, an approximation only.
 */
export function monsterRound(battle: Battle, rng: CombatRng): void {
  for (const monster of livingMonsters(battle)) {
    const targets = livingParty(battle);
    if (targets.length === 0) return;
    const target = targets[rng.roll(targets.length) - 1];
    const hitChance = monster.record.attackRaw * 10;
    if (rng.roll(100) <= hitChance) {
      const damage = Math.max(1, monster.record.attackRaw);
      target.hp = Math.max(0, target.hp - damage);
      battle.log.push(`${monster.record.name} hits ${target.name} for ${damage}`);
    } else {
      battle.log.push(`${monster.record.name} misses ${target.name}`);
    }
  }
  for (const member of battle.party) if (member.hp <= 0) member.alive = false;
}

/** One full round: party attacks, then (if anything's left) monsters attack. */
export function runRound(battle: Battle, data: GameData, rng: CombatRng): void {
  partyRound(battle, data, rng);
  if (!isVictory(battle)) monsterRound(battle, rng);
}
