/**
 * A single live party member's runtime state (Phantasie III).
 *
 * The script-addressable stat space (`getStat`/`setStat`) is the flat
 * 16-bit word array documented in scripting-engine.md §6.3: P3 has no
 * abstract `GetStat`/`SetStat` resolver — its opcode handlers read and
 * write `charBase[statIndex * 2]` directly — so a character's stats are
 * modelled as one flat `stats[0..160]` array (the reference tool's "single
 * flat 161-entry array"). The P3 raw→table remap (`p3RemapStatIndex`,
 * opcodes.ts) is applied by the *caller* (DungeonHost) before indexing,
 * exactly as the disassembly shows the opcode handlers doing it.
 *
 * The named fields below are the confirmed 262-byte record fields from
 * scripting-engine.md §7.5.3 (race/class/level/HP). Script opcodes never
 * touch them — only combat, character creation, and the interpreter's own
 * non-stat checks (opcode 0x19's Divine-Aid special case, opcode 0x1A's
 * race gate) read them.
 */

export const P3_STAT_COUNT = 161;
/** Race indices (data-tables.md §4.1): Human, Dwarven, Elven, Gnome, … */
export const P3_RACE_DWARVEN = 1;
export const P3_RACE_GNOME = 3;
/** Spell index 57 = "Divine Aid" (`readP3SpellNames`, data-tables.md §3.1). */
export const P3_SPELL_DIVINE_AID = 57;

/** `bodyLocations` array order (`char.+0xF2`-`+0xFC`, scripting-engine.md §7.5.3). */
export const BODY_LOCATION_NAMES = ['Head', 'Torso', 'L-Arm', 'R-Arm', 'L-Leg', 'R-Leg'] as const;
/** Body-location severity values, same order every location uses (0-3). */
export const BODY_LOCATION_OKAY = 0;
export const BODY_LOCATION_INJURED = 1;
export const BODY_LOCATION_BROKEN = 2;
export const BODY_LOCATION_GONE = 3;

export interface CharacterState {
  name: string;
  /** Race index 0-17 (data-tables.md §4.1). */
  race: number;
  /** Class index 0-5 (Fighter, Thief, Priest, Ranger, Monk, Wizard — exe-data.ts `P3_SKILL_CLASS_ORDER`). */
  classId: number;
  level: number;
  hp: number;
  maxHp: number;
  /** Magic Power current/max (`char.+0x1E`/`+0x1C`, town-format.md §3.1/§4.3) — grown by a chance roll
   *  at the Inn, not by Training (which only touches HP and skills). */
  mp: number;
  maxMp: number;
  /** `false` = dead/removed; gates the interpreter's "living member" loops. */
  alive: boolean;
  /** Six attributes in confirmed order: Strength, Intelligence, Dexterity, Constitution, Charisma, Luck (§7.5.3). */
  attributes: number[];
  /** Combat position 0-3 (§7.5.3); the to-hit term is `(rank − partyAvgRank) × 30`. */
  rank: number;
  /** Flat 16-bit stat array, indices 0-160 (§6.3). */
  stats: number[];
  /** Indices into `readP3SpellNames` (data-tables.md §3.1); backs opcode 0x19's Divine-Aid check. */
  knownSpells: number[];
  /** Experience Points (`char.+0x102`, confirmed field) — awarded by Training directly (town-format.md §3.2) or divided out of `PartyState.pendingXp` on a town return (§3.7/§3.8). */
  experience: number;
  /** Gold in bank (`char.+0xFE`, town-format.md §3.6) — separate from `PartyState.gold` (carried gold); moved between the two by the Bank facility. */
  bankedGold: number;
  /** Six locations, `BODY_LOCATION_NAMES` order, each `0`-`3` (`BODY_LOCATION_OKAY`..`_GONE`, `char.+0xF2`-`+0xFC`). Nothing in this build damages a location yet (no combat body-location-damage system is implemented) — healing spells (`spell-format.md`) are wired to repair it regardless, since they're the confirmed mechanic that can even clear `Gone`, which the Inn cannot. */
  bodyLocations: number[];
}

export function createCharacter(partial: Partial<CharacterState> & { name: string }): CharacterState {
  return {
    name: partial.name,
    race: partial.race ?? 0,
    classId: partial.classId ?? 0,
    level: partial.level ?? 1,
    hp: partial.hp ?? partial.maxHp ?? 8,
    maxHp: partial.maxHp ?? 8,
    mp: partial.mp ?? partial.maxMp ?? 0,
    maxMp: partial.maxMp ?? 0,
    alive: partial.alive ?? true,
    attributes: partial.attributes ?? new Array<number>(6).fill(8),
    rank: partial.rank ?? 2,
    stats: partial.stats ?? new Array<number>(P3_STAT_COUNT).fill(0),
    knownSpells: partial.knownSpells ?? [],
    experience: partial.experience ?? 0,
    bankedGold: partial.bankedGold ?? 0,
    bodyLocations: partial.bodyLocations ?? new Array<number>(6).fill(BODY_LOCATION_OKAY),
  };
}

/** Read a stat word. `statIndex` must already be remapped (see module doc). */
export function getStat(char: CharacterState, statIndex: number): number {
  if (statIndex < 0 || statIndex >= P3_STAT_COUNT) {
    throw new RangeError(`stat index ${statIndex} outside P3's 0-160 stat space`);
  }
  return char.stats[statIndex];
}

export function setStat(char: CharacterState, statIndex: number, value: number): void {
  if (statIndex < 0 || statIndex >= P3_STAT_COUNT) {
    throw new RangeError(`stat index ${statIndex} outside P3's 0-160 stat space`);
  }
  char.stats[statIndex] = value & 0xffff;
}
