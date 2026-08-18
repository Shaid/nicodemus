import { describe, it, expect } from 'vitest';
import { cureBodyLocations, applyHealing, applyResurrection, isCastableHere, type Die } from '../spell-formulas.ts';
import { createCharacter, BODY_LOCATION_OKAY, BODY_LOCATION_INJURED, BODY_LOCATION_BROKEN, BODY_LOCATION_GONE } from '../../state/CharacterState.ts';

function scripted(sequence: number[]): Die {
  let i = 0;
  return () => sequence[Math.min(i++, sequence.length - 1)];
}

describe('isCastableHere — spell-format.md §3', () => {
  it('Healing I-IV and Resurrection are castable', () => {
    expect(isCastableHere(1)).toBe(true);
    expect(isCastableHere(4)).toBe(true);
    expect(isCastableHere(44)).toBe(true);
  });

  it('every other spell index refuses, exactly matching the real game\'s "You cannot cast this here"', () => {
    expect(isCastableHere(5)).toBe(false); // Fireflash
    expect(isCastableHere(43)).toBe(false); // Teleportation
    expect(isCastableHere(57)).toBe(false); // Divine Aid
  });
});

describe('cureBodyLocations — spell-format.md §4.2, the greedy point-budget algorithm', () => {
  it('Healing I (budget 1): cures exactly 1 Injury', () => {
    const locs = [BODY_LOCATION_INJURED, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY];
    cureBodyLocations(locs, 1);
    expect(locs[0]).toBe(BODY_LOCATION_OKAY);
  });

  it('Healing II (budget 2): cures 1 Break, or 2 Injuries if no Break exists', () => {
    const oneBreak = [BODY_LOCATION_BROKEN, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY];
    cureBodyLocations(oneBreak, 2);
    expect(oneBreak[0]).toBe(BODY_LOCATION_OKAY);

    const twoInjuries = [BODY_LOCATION_INJURED, BODY_LOCATION_INJURED, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY];
    cureBodyLocations(twoInjuries, 2);
    expect(twoInjuries[0]).toBe(BODY_LOCATION_OKAY);
    expect(twoInjuries[1]).toBe(BODY_LOCATION_OKAY);
  });

  it('Healing III (budget 3) genuinely clears a Gone location — the central confirmed finding', () => {
    const locs = [BODY_LOCATION_GONE, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY];
    cureBodyLocations(locs, 3);
    expect(locs[0]).toBe(BODY_LOCATION_OKAY);
  });

  it('Healing III spends its whole budget on a Gone when one is present, even alongside a Broken/Injured — "1 Gone" is its own exhaustion case, not combined with the others', () => {
    const locs = [BODY_LOCATION_GONE, BODY_LOCATION_BROKEN, BODY_LOCATION_INJURED, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY];
    cureBodyLocations(locs, 3);
    expect(locs).toEqual([BODY_LOCATION_OKAY, BODY_LOCATION_BROKEN, BODY_LOCATION_INJURED, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY]);
  });

  it('Healing III with no Gone present cures a Break AND an Injury ("1 Break & 1 Injury" from the same manual line, the no-Gone case)', () => {
    const locs = [BODY_LOCATION_BROKEN, BODY_LOCATION_INJURED, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY];
    cureBodyLocations(locs, 3);
    expect(locs[0]).toBe(BODY_LOCATION_OKAY);
    expect(locs[1]).toBe(BODY_LOCATION_OKAY);
  });

  it('Healing I/II can never reach a Gone location, even if it is the only damage present', () => {
    const locs = [BODY_LOCATION_GONE, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY];
    cureBodyLocations(locs, 2);
    expect(locs[0]).toBe(BODY_LOCATION_GONE); // untouched — budget never reaches 3
  });

  it('Healing IV (budget 4) clears a Gone plus one more Injury point ("More than 1 Gone")', () => {
    const locs = [BODY_LOCATION_GONE, BODY_LOCATION_INJURED, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY];
    cureBodyLocations(locs, 4);
    expect(locs[0]).toBe(BODY_LOCATION_OKAY);
    expect(locs[1]).toBe(BODY_LOCATION_OKAY);
  });
});

describe('applyHealing — spell-format.md §4', () => {
  it('rolls within the confirmed per-tier range and clamps to missing HP', () => {
    const target = createCharacter({ name: 'Test', hp: 90, maxHp: 100 });
    const result = applyHealing(target, 4, scripted([99])); // Healing IV max roll = 99, but only 10 missing
    expect(result.healed).toBe(10);
    expect(target.hp).toBe(100);
  });

  it('applies the HP roll after curing body locations, per the confirmed order', () => {
    const target = createCharacter({ name: 'Test', hp: 50, maxHp: 100 });
    target.bodyLocations = [BODY_LOCATION_GONE, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY, BODY_LOCATION_OKAY];
    const result = applyHealing(target, 3, scripted([20]));
    expect(target.bodyLocations[0]).toBe(BODY_LOCATION_OKAY);
    expect(result.healed).toBe(20);
    expect(target.hp).toBe(70);
  });
});

describe('applyResurrection — spell-format.md §5', () => {
  const CONSTITUTION_INDEX = 3; // Str/Int/Dex/Con/Cha/Luck order

  it('revives at 1 HP (not full), restores MP to max, clears Status and all body locations unconditionally', () => {
    const target = createCharacter({ name: 'Dead', hp: 0, maxHp: 40, mp: 0, maxMp: 12, alive: false });
    target.bodyLocations = [BODY_LOCATION_GONE, BODY_LOCATION_BROKEN, BODY_LOCATION_INJURED, BODY_LOCATION_OKAY, BODY_LOCATION_GONE, BODY_LOCATION_OKAY];
    target.attributes = [10, 10, 10, 10, 10, 10];

    applyResurrection(target, CONSTITUTION_INDEX, scripted([1]));

    expect(target.hp).toBe(1);
    expect(target.mp).toBe(12);
    expect(target.alive).toBe(true);
    expect(target.bodyLocations.every((l) => l === BODY_LOCATION_OKAY)).toBe(true);
  });

  it('lowers Constitution by the Random(2) roll (1 or 2)', () => {
    const target = createCharacter({ name: 'Dead', attributes: [10, 10, 10, 10, 10, 10] });
    applyResurrection(target, CONSTITUTION_INDEX, scripted([2]));
    expect(target.attributes[CONSTITUTION_INDEX]).toBe(8);
  });

  it('clamps Constitution at a floor of 3', () => {
    const target = createCharacter({ name: 'Dead', attributes: [10, 10, 10, 4, 10, 10] });
    applyResurrection(target, CONSTITUTION_INDEX, scripted([2]));
    expect(target.attributes[CONSTITUTION_INDEX]).toBe(3);
  });
});
