import { describe, it, expect } from 'vitest';
import { regionDangerTier, rollOverworldEncounter, type Die } from '../p3-encounter-formulas.ts';

/** A scripted die that returns each value in `sequence` in order, then repeats the last. */
function scripted(sequence: number[]): Die {
  let i = 0;
  return () => sequence[Math.min(i++, sequence.length - 1)];
}

describe('regionDangerTier — dungeon-format.md §9.0.6.3', () => {
  it("Pendragon's region (24, 37) is the table's single minimum, tier 0", () => {
    expect(regionDangerTier(24, 37)).toBe(0);
  });

  it('the north-west corner region is tier 3 (the table\'s first entry)', () => {
    expect(regionDangerTier(0, 0)).toBe(3);
  });

  it('clamps the south-east edge (y=74) into region row 4, not out of bounds', () => {
    expect(regionDangerTier(49, 74)).toBe(2);
  });
});

describe('rollOverworldEncounter — dungeon-format.md §9.0.6', () => {
  it('excludes Lava/Water/River Styx terrain entirely, before any roll', () => {
    const die = scripted([1]); // would trigger everything if rolled
    expect(rollOverworldEncounter(24, 37, 8, die)).toBeNull(); // Lava
    expect(rollOverworldEncounter(24, 37, 10, die)).toBeNull(); // Water
    expect(rollOverworldEncounter(24, 37, 15, die)).toBeNull(); // River Styx
  });

  it('does not trigger above the 7% base rate', () => {
    const die = scripted([8]); // Random(100) = 8 > 7
    expect(rollOverworldEncounter(24, 37, 0, die)).toBeNull();
  });

  it('triggers an ambush (38% branch) at Pendragon (tier 0), mode-1 offset 0 -> monster index 0 (Skeleton)', () => {
    const die = scripted([7, 38, 1]); // trigger roll=7 (<=7), ambush roll=38 (<=38), mode1 die(3)=1 -> offset 0
    const result = rollOverworldEncounter(24, 37, 0, die);
    expect(result).toEqual({ monsterIndex: 0, ambush: true });
  });

  it('triggers an ordinary encounter (62% branch, mode 2) when the ambush roll misses', () => {
    // trigger=1, ambush roll=39 (>38, ordinary), mode roll=26 (<=26 -> mode 2), die(10)=5 -> offset 6
    const die = scripted([1, 39, 26, 5]);
    const result = rollOverworldEncounter(24, 37, 0, die);
    expect(result).toEqual({ monsterIndex: 0 * 12 + 6, ambush: false });
  });

  it('triggers an ordinary encounter (mode 3, terrain-dependent) when both sub-rolls miss', () => {
    // trigger=1, ambush roll=39 (ordinary), mode roll=27 (>26 -> mode 3), die(4)=1 -> Meadows offset table[0]=4
    const die = scripted([1, 39, 27, 1]);
    const result = rollOverworldEncounter(24, 37, 0 /* Meadows */, die);
    expect(result).toEqual({ monsterIndex: 0 * 12 + 4, ambush: false });
  });

  it('redirects raw index 31 (Wolf) to 42 (Small Dragon)', () => {
    // region (5, 30): regionX=0, regionY=2 -> table[10] = 2 (tier 2)
    // mode 2: die(10)=6 -> offset 7 -> idx = 2*12+7 = 31 -> redirected
    const die = scripted([1, 39, 26, 6]);
    expect(rollOverworldEncounter(5, 30, 0, die)).toEqual({ monsterIndex: 42, ambush: false });
  });

  it('redirects raw index 53 (Mud Elemental) to 42 (Small Dragon)', () => {
    // region (10, 0): regionX=1, regionY=0 -> table[1] = 4 (tier 4)
    // mode 2: die(10)=4 -> offset 5 -> idx = 4*12+5 = 53 -> redirected
    const die = scripted([1, 39, 26, 4]);
    expect(rollOverworldEncounter(10, 0, 0, die)).toEqual({ monsterIndex: 42, ambush: false });
  });
});
