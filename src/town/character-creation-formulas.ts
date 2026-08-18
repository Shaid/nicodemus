/**
 * Phantasie III character-creation math — attribute rolls and starting
 * HP/MP (town-format.md §4.2/§4.3, disassembly-confirmed against file
 * `0x13320`-`0x13594`, roller `0x13faa`-`0x14030`, HP/MP setup
 * `0x13380`-`0x13402`). Class order is `P3_SKILL_CLASS_ORDER`
 * (Fighter/Thief/Priest/Ranger/Monk/Wizard); race order is
 * `readP3RaceNames()`'s (`data-tables.md` §4.1) — both tables below are
 * indexed directly by those confirmed indices, no remapping needed.
 */

export type Die = (n: number) => number;

/** `Random(n)` — the game's own uniform-int primitive (`combat-rng.ts`'s `CombatRng.roll` is the same shape, `1..n` inclusive). */
export function uniformDie(n: number): number {
  return 1 + Math.floor(Math.random() * n);
}

export const ATTRIBUTE_ORDER = ['Strength', 'Intelligence', 'Dexterity', 'Constitution', 'Charisma'] as const;

/** `hunk1+0x88E`, class-indexed 6×5, columns Str/Int/Dex/Con/Cha (town-format.md §4.2). */
const CLASS_ATTRIBUTE_MODIFIERS: number[][] = [
  [12, 8, 11, 10, 9], // Fighter
  [8, 10, 12, 10, 9], // Thief
  [10, 12, 10, 10, 10], // Priest
  [10, 11, 10, 10, 11], // Ranger
  [10, 10, 11, 10, 10], // Monk
  [6, 13, 8, 10, 11], // Wizard
];

/** `hunk1+0x8AC`, raw-race-indexed 18×5, columns Str/Int/Dex/Con/Cha (town-format.md §4.2). Index 5 ("Random") is a real all-zero row — never indexed for an actual character (the "random race" UI option re-rolls to a concrete race first). */
const RACE_ATTRIBUTE_MODIFIERS: number[][] = [
  [10, 10, 10, 10, 10], // 0 Human
  [12, 9, 9, 11, 9], // 1 Dwarven
  [9, 11, 11, 9, 10], // 2 Elven
  [11, 9, 10, 11, 9], // 3 Gnome
  [8, 10, 12, 10, 9], // 4 Halfling
  [0, 0, 0, 0, 0], // 5 Random
  [12, 5, 9, 13, 3], // 6 Gnoll
  [9, 6, 10, 9, 3], // 7 Goblin
  [9, 7, 11, 11, 5], // 8 Kobold
  [11, 6, 9, 10, 5], // 9 Lizard Man
  [12, 6, 8, 11, 4], // 10 Minotaur
  [13, 6, 8, 11, 5], // 11 Ogre
  [11, 8, 9, 10, 6], // 12 Orc
  [8, 10, 13, 8, 9], // 13 Pixie
  [8, 10, 14, 8, 9], // 14 Sprite
  [14, 5, 7, 12, 4], // 15 Troll
  [18, 18, 18, 18, 18], // 16 Elemental
  [20, 17, 17, 19, 17], // 17 Undead
];

/** Races whose Luck uses the boosted ×5/2 path instead of ×2/5 (town-format.md §4.2). */
const LUCK_BOOSTED_RACES = new Set([1, 4, 13]); // Dwarven, Halfling, Pixie

/** `roll = 3d6 + classModifier[class][stat] - 10 + raceModifier[race][stat] - 10 + 3`. */
export function rollAttribute(classId: number, race: number, statIndex: number, die: Die = uniformDie): number {
  const roll = die(6) + die(6) + die(6);
  const classMod = CLASS_ATTRIBUTE_MODIFIERS[classId][statIndex] - 10;
  const raceMod = RACE_ATTRIBUTE_MODIFIERS[race][statIndex] - 10;
  return roll + classMod + raceMod + 3;
}

/** `Luck = Random(6) + 7`, then ×2/5 (most races) or ×5/2 (Dwarven/Halfling/Pixie). */
export function rollLuck(race: number, die: Die = uniformDie): number {
  const luck = die(6) + 7;
  return LUCK_BOOSTED_RACES.has(race) ? Math.floor((luck * 5) / 2) : Math.floor((luck * 2) / 5);
}

/** Strength, Intelligence, Dexterity, Constitution, Charisma, Luck — in `ATTRIBUTE_NAMES` order. */
export function rollAttributes(classId: number, race: number, die: Die = uniformDie): number[] {
  const core = ATTRIBUTE_ORDER.map((_, i) => rollAttribute(classId, race, i, die));
  return [...core, rollLuck(race, die)];
}

/** `hunk1+0x9CA`, class-indexed `[6][15]` byte table — MP chart, also reused by the Inn's level-based growth roll (town-format.md §3.1/§4.3). Levels above 15 clamp to column 14. */
const MP_CHART: number[][] = [
  [7, 7, 8, 8, 9, 9, 10, 10, 11, 12, 13, 14, 15, 16, 18], // Fighter
  [6, 6, 7, 7, 8, 8, 9, 10, 11, 12, 13, 13, 14, 14, 15], // Thief
  [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 20, 20, 20, 20], // Priest
  [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 18, 18, 18, 19], // Ranger
  [10, 10, 10, 11, 11, 11, 12, 12, 12, 13, 13, 14, 16, 18, 20], // Monk
  [10, 11, 11, 12, 13, 14, 14, 15, 16, 16, 17, 17, 18, 19, 20], // Wizard
];

/** `hunk1+0x94C`, class-indexed `[6][21]` byte table — HP dice count, one entry per level 1-21 (town-format.md §3.2/§4.3; column 0 used at creation, the full column range reused by Training's level-up re-roll). */
const HP_DICE_COUNT: number[][] = [
  [5, 10, 16, 22, 28, 35, 41, 47, 53, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115], // Fighter
  [3, 5, 9, 11, 16, 20, 24, 27, 30, 35, 39, 43, 47, 51, 55, 59, 63, 67, 71, 75, 79], // Thief
  [4, 6, 10, 15, 20, 25, 30, 35, 40, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89], // Priest
  [4, 9, 14, 20, 25, 30, 36, 42, 48, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110], // Ranger
  [4, 5, 9, 11, 16, 22, 27, 31, 35, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84], // Monk
  [3, 4, 6, 8, 11, 14, 17, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55, 58], // Wizard
];

export function mpChartValue(classId: number, level: number): number {
  return MP_CHART[classId][Math.min(level, 15) - 1];
}

function hpDiceCount(classId: number, level: number): number {
  return HP_DICE_COUNT[classId][Math.min(level, 21) - 1];
}

/** `MP max = MP current = mpChart[class][level=1] × 75 / 100` (town-format.md §4.3). */
export function startingMp(classId: number): number {
  return Math.floor((mpChartValue(classId, 1) * 75) / 100);
}

/** `HP = Σ (Random(2) + 1)`, `diceCount` times, `diceCount = hunk1+0x94C[class][level=1]` (town-format.md §4.3). */
export function startingHp(classId: number, die: Die = uniformDie): number {
  const count = hpDiceCount(classId, 1);
  let total = 0;
  for (let i = 0; i < count; i++) total += die(2) + 1;
  return total;
}

/**
 * Training's HP re-roll on level-up (town-format.md §3.2, file `0xe3e8`-
 * `0xe452`): same dice-count table as creation, but indexed by the *new*
 * level and rolled with `Random(3)` per die instead of creation's
 * `Random(2)+1` — a confirmed, deliberate asymmetry between the two paths.
 * Guaranteed to exceed the old max by at least 1.
 */
export function trainingHp(classId: number, newLevel: number, oldHpMax: number, die: Die = uniformDie): number {
  const count = hpDiceCount(classId, newLevel);
  let total = 0;
  for (let i = 0; i < count; i++) total += die(3);
  return total <= oldHpMax ? oldHpMax + 1 : total;
}
