import { describe, it, expect } from 'vitest';
import { createP3Rng } from '../combat-rng.ts';
import { resolveAttack, type CombatantStats, type MonsterStats } from '../p3-combat.ts';

describe('P3 combat RNG (scripting-engine.md §7.5)', () => {
  it('reproduces the LCG sequence from seed 1', () => {
    const rng = createP3Rng(1);
    // seed=1 -> (1*25173+13849)&0xffff = 39022 -> &0x7fff = 6254 -> 1+6254%100 = 55
    expect(rng.roll(100)).toBe(55);
    // 6254 -> (6254*25173+13849)&0xffff = 28319 -> 1+28319%100 = 20
    expect(rng.roll(100)).toBe(20);
  });

  it('clamps the range to at least 1 and stays within 1..range', () => {
    const rng = createP3Rng(7);
    for (let i = 0; i < 100; i++) {
      const r = rng.roll(6);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    }
  });
});

describe('resolveAttack (P3 to-hit / damage)', () => {
  const attacker: CombatantStats = {
    attackSkill: 100,
    fireBowSkill: 60,
    fireBranch: false,
    meleeDie: 10,
    fireDie: 4,
    rank: 2,
    status: 1,
    attacksThisRound: 1,
    difficulty: 0,
  };
  const monster: MonsterStats = { armor: 0, guaranteedHit: false };

  it('default branch: threshold = attackSkill - armor, damage die rolled before the hit roll', () => {
    const rng = createP3Rng(1);
    // threshold = floor(100/1) - 0 = 100, + (2-2)*30 = 0
    // damage = roll(10) = 1 + 6254%10 = 5
    // hit roll = roll(100) = 20  -> 20 <= 100 -> hit
    const result = resolveAttack(attacker, 2, monster, rng);
    expect(result.threshold).toBe(100);
    expect(result.damage).toBe(5);
    expect(result.roll).toBe(20);
    expect(result.hit).toBe(true);
  });

  it('applies the rank-relative and status penalties', () => {
    const penalised: CombatantStats = { ...attacker, rank: 0, status: 4 };
    const rng = createP3Rng(1);
    const result = resolveAttack(penalised, 2, monster, rng);
    // threshold = 100 - 40 (status) + (0-2)*30 = 0 -> clamped to 1
    expect(result.threshold).toBe(1);
    expect(result.hit).toBe(false); // roll 20 > 1
  });
});
