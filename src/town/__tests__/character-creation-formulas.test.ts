import { describe, it, expect } from 'vitest';
import {
  rollAttribute,
  rollAttributes,
  rollLuck,
  startingHp,
  startingMp,
  trainingHp,
  mpChartValue,
  type Die,
} from '../character-creation-formulas.ts';

/** A scripted die that returns each value in `sequence` in order, then repeats the last. */
function scripted(sequence: number[]): Die {
  let i = 0;
  return () => sequence[Math.min(i++, sequence.length - 1)];
}

describe('rollAttribute — town-format.md §4.2', () => {
  it('Fighter/Human: 3d6(6,6,6) + (12-10) + (10-10) + 3 = 18 + 2 + 0 + 3 = 23', () => {
    expect(rollAttribute(0, 0, 0, scripted([6, 6, 6]))).toBe(23);
  });

  it('Wizard/Elemental Strength: minimum 3d6 + (6-10) + (18-10) + 3 = 3 - 4 + 8 + 3 = 10', () => {
    expect(rollAttribute(5, 16, 0, scripted([1, 1, 1]))).toBe(10);
  });

  it('a modifier table entry of exactly 10 is a no-op (Priest Strength)', () => {
    // Priest Str modifier = 10 (no-op), Human Str modifier = 10 (no-op)
    expect(rollAttribute(2, 0, 0, scripted([3, 4, 5]))).toBe(3 + 4 + 5 + 3);
  });
});

describe('rollLuck — town-format.md §4.2', () => {
  it('non-boosted race (Human): Random(6)+7, then ×2/5', () => {
    // luck = 6+7 = 13; floor(13*2/5) = floor(5.2) = 5
    expect(rollLuck(0, scripted([6]))).toBe(5);
  });

  it('boosted race (Dwarven, index 1): ×5/2 instead of ×2/5', () => {
    // luck = 6+7 = 13; floor(13*5/2) = floor(32.5) = 32
    expect(rollLuck(1, scripted([6]))).toBe(32);
  });

  it('Halfling (4) and Pixie (13) are also boosted', () => {
    expect(rollLuck(4, scripted([1]))).toBe(Math.floor((8 * 5) / 2));
    expect(rollLuck(13, scripted([1]))).toBe(Math.floor((8 * 5) / 2));
  });
});

describe('rollAttributes — full 6-value roll in ATTRIBUTE_NAMES order', () => {
  it('returns Str/Int/Dex/Con/Cha/Luck as one array', () => {
    // 5 attributes x 3 dice + 1 luck die = 16 die calls
    const die = scripted(new Array(15).fill(3).concat([4]));
    const result = rollAttributes(0, 0, die);
    expect(result).toHaveLength(6);
    // Fighter/Human Strength: 3+3+3 + (12-10) + (10-10) + 3 = 9+2+0+3 = 14
    expect(result[0]).toBe(14);
  });
});

describe('starting HP/MP — town-format.md §4.3', () => {
  it('Fighter starting HP: diceCount=5, each Random(2)+1 — all-minimum roll gives the floor of 10, matching the manual', () => {
    expect(startingHp(0, scripted([1]))).toBe(5 * (1 + 1));
  });

  it('Fighter starting HP: all-maximum roll gives 15', () => {
    expect(startingHp(0, scripted([2]))).toBe(5 * (2 + 1));
  });

  it('Wizard starting MP: mpChart[Wizard][L1]=10, ×75/100 = 7 (floored)', () => {
    expect(mpChartValue(5, 1)).toBe(10);
    expect(startingMp(5)).toBe(7);
  });

  it('Priest starting MP: mpChart[Priest][L1]=10, ×75/100 = 7', () => {
    expect(startingMp(2)).toBe(7);
  });
});

describe('trainingHp — town-format.md §3.2 (level-up re-roll, a confirmed asymmetry vs. creation)', () => {
  it('uses Random(3) per die (not Random(2)+1) at the new level\'s dice count', () => {
    // Fighter level 2: diceCount = 10, each Random(3) = 2 -> 20
    expect(trainingHp(0, 2, /* oldHpMax */ 5, scripted([2]))).toBe(20);
  });

  it('is floored at oldHpMax + 1 even on a bad roll', () => {
    // Fighter level 2, diceCount=10, all dice roll 1 -> 10, but oldHpMax is 15
    expect(trainingHp(0, 2, 15, scripted([1]))).toBe(16);
  });
});
