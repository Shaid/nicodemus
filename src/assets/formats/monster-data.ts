/**
 * `monsinfo.dat` monster record decoder (Phantasie III, Amiga).
 *
 * See docs/phantasie/data-tables.md §3.1: fixed 38-byte records, 80
 * records, starting at file offset 0 (no header). The trailing 32 bytes
 * (offset 3040-3071) are disk-padding, not a partial 81st record.
 */

import { readCString } from './ascii-strings.ts';

export const MONSTER_RECORD_SIZE = 38;
export const MONSTER_COUNT = 80;
export const MONSTER_TABLE_SIZE = MONSTER_RECORD_SIZE * MONSTER_COUNT; // 3,040

export interface MonsterRecord {
  index: number;
  name: string;
  /** `nb` — how many of this monster appear together in an encounter group. */
  encounterGroupSize: number;
  /** Raw stored byte. Display value is `attackRaw * 10` (see `attack`). */
  attackRaw: number;
  attack: number;
  /**
   * Raw combat-power stat, NOT an index into the item table (data-tables.md
   * §3.1/§8) — despite the reference source's field name, correlates
   * strongly with `hp` (r=0.81) and `attackRaw` (r=0.82) across all 80
   * monsters and grows monotonically with monster tier, which an
   * item-catalogue index (unrelated to monster power) would not do.
   */
  weaponRating: number;
  /** Same reframing as `weaponRating` — correlates with `attackRaw` (r=0.96) and `hp` (r=0.77), not an item index. */
  armorRating: number;
  defense: number;
  threat: number;
  spellProbability: number;
  /** Index into the P3 spell name table (`exe-data.ts`'s `readP3SpellNames`) — confirmed, data-tables.md §3.1. 0 = no spell. */
  spell1: number;
  spell2: number;
  spell3: number;
  mp: number;
  hp: number;
  alignment: number;
  /** Feeds `sprite-bank.ts`'s `resolveMonsterSpriteIndex` (graphics-formats.md §6). */
  spriteIndex: number;
  companionsProbability: number;
  companion1: number;
  companion2: number;
  item1: number;
  item2: number;
  isUndead: boolean;
  gold: number;
  /** Single byte (max 255) — raw value or scaled/tiered code, not determined. */
  experience: number;
}

export function decodeMonsterRecord(data: Uint8Array, index: number): MonsterRecord {
  const o = index * MONSTER_RECORD_SIZE;
  const attackRaw = data[o + 0x0f];
  return {
    index,
    // The 14-byte name field is space-padded (not zero-padded) up to a
    // single trailing NUL — e.g. "Skeleton" is stored as "Skeleton" + 5
    // spaces + one NUL byte at offset 13. readCString correctly stops at
    // the NUL, so trim the padding spaces it leaves in.
    name: readCString(data, o + 0x00, 14).trimEnd(),
    encounterGroupSize: data[o + 0x0e],
    attackRaw,
    attack: attackRaw * 10,
    weaponRating: data[o + 0x10],
    armorRating: data[o + 0x11],
    defense: data[o + 0x12],
    threat: data[o + 0x13],
    spellProbability: data[o + 0x14],
    spell1: data[o + 0x15],
    spell2: data[o + 0x16],
    spell3: data[o + 0x17],
    mp: data[o + 0x18],
    hp: data[o + 0x19],
    alignment: data[o + 0x1a],
    spriteIndex: data[o + 0x1b],
    companionsProbability: data[o + 0x1c],
    companion1: data[o + 0x1d],
    companion2: data[o + 0x1e],
    item1: data[o + 0x1f],
    item2: data[o + 0x20],
    isUndead: data[o + 0x21] !== 0,
    gold: (data[o + 0x22] << 8) | data[o + 0x23],
    experience: data[o + 0x24],
  };
}

export function decodeMonsterTable(data: Uint8Array): MonsterRecord[] {
  const records: MonsterRecord[] = [];
  for (let i = 0; i < MONSTER_COUNT; i++) records.push(decodeMonsterRecord(data, i));
  return records;
}
