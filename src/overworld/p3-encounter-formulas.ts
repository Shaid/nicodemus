/**
 * P3's overworld random-encounter roll (dungeon-format.md §9.0.6,
 * disassembly-confirmed). Called once per qualifying step — the caller is
 * responsible for the "not on a named location" gate (§9.0.6.1); the
 * terrain exclusion (Lava/Water/River Styx) is baked into
 * `rollOverworldEncounter` itself.
 *
 * Simplification, documented (§9.0.6.2/§9.0.6.6 are only "narrowed", not
 * "confirmed"): the real roll cascade distinguishes ambush / ordinary /
 * party-member-personalized-flavor outcomes via message codes that were
 * not fully disentangled, and a party-member-name path whose ability to
 * skip combat outright was never demonstrated. Every concrete branch the
 * RE pass traced still ends in `loadMonsterRecord` + the combat-entry
 * copy loop, so this implementation always resolves to combat — it only
 * models the two branches that are fully "confirmed": a 38%-of-triggered
 * "ambush" (mode 1 index) and a 62% "ordinary" encounter (mode 2/3 index,
 * 26%/74% split, mode 3 terrain-dependent).
 */

export type Die = (n: number) => number;

export function uniformDie(n: number): number {
  return 1 + Math.floor(Math.random() * n);
}

/** hunk-1 offset `0x866`, file `0x2812E` — 5×5 region danger tier, row-major (`regionY*5+regionX`). Verified: Pendragon's own region holds the table's single minimum value. */
const REGION_DANGER_TIER = [
  3, 4, 5, 4, 3,
  2, 2, 3, 2, 3,
  2, 2, 0, 3, 3,
  2, 1, 1, 1, 2,
  3, 2, 1, 1, 2,
];

/** World map is 50×75; regions are a clean 5×5 grid, no remainder tiles. */
export function regionDangerTier(x: number, y: number): number {
  const regionX = Math.min(4, Math.floor(x / 10));
  const regionY = Math.min(4, Math.floor(y / 15));
  return REGION_DANGER_TIER[regionY * 5 + regionX];
}

/** hunk-1 offset `0x87f`, file `0x28147` — terrain-class-indexed severity offsets, 4 per class (`terrainClass..+3`). Only the classes the overworld terrain classifier (`p3-overworld.ts`) can actually produce are listed. */
const TERRAIN_SEVERITY_OFFSETS: Record<number, [number, number, number, number]> = {
  0: [4, 1, 2, 3], // Meadows
  1: [1, 2, 3, 3], // Forest
  2: [2, 3, 3, 4], // Hills
  3: [3, 3, 4, 2], // Mountains
  6: [2, 4, 3, 5], // Pathway
  9: [5, 5, 4, 4], // Desert
  13: [0, 0, 12, 8], // A bridge
  14: [0, 12, 8, 11], // Dense Fog
  16: [8, 11, 10, 9], // Mist (Netherworld)
  17: [11, 10, 9, 8], // Black path (Netherworld)
  18: [10, 9, 8, 10], // Steam (Netherworld)
};

/** Terrain classes the pre-roll gate excludes entirely (§9.0.6.1) — impassable/hazard, no roll ever attempted. */
const EXCLUDED_TERRAIN = new Set([8, 10, 15]); // Lava, Water, The River Styx

/** Wolf (31) and Mud Elemental (53) are deliberately excluded from the random pool, redirected to Small Dragon (42) — confirmed, not a bug. */
const MONSTER_INDEX_REDIRECT: Record<number, number> = { 31: 42, 53: 42 };

function pickIndex(regionTier: number, mode: 1 | 2 | 3, terrainClass: number, die: Die): number {
  let offset: number;
  if (mode === 1) {
    const r = die(3) - 1; // 0, 1, 2
    offset = r === 2 ? 4 : r; // remapped 2 -> 4; result in {0, 1, 4}
  } else if (mode === 2) {
    offset = die(10) + 1; // 2..11
  } else {
    const offsets = TERRAIN_SEVERITY_OFFSETS[terrainClass];
    offset = offsets ? offsets[die(4) - 1] : 0;
  }
  const idx = Math.max(0, Math.min(79, regionTier * 12 + offset));
  return MONSTER_INDEX_REDIRECT[idx] ?? idx;
}

export interface OverworldEncounterResult {
  monsterIndex: number;
  ambush: boolean;
}

/**
 * One qualifying-step roll: 7% base trigger rate, then a region/terrain-
 * weighted monster-table index (0-79, into the same `monsinfo.dat`-backed
 * table dungeons use). Returns `null` if no encounter triggers this step,
 * including immediately for excluded terrain (Lava/Water/River Styx).
 */
export function rollOverworldEncounter(x: number, y: number, terrainClass: number, die: Die = uniformDie): OverworldEncounterResult | null {
  if (EXCLUDED_TERRAIN.has(terrainClass)) return null;
  if (die(100) > 7) return null; // base trigger rate
  const tier = regionDangerTier(x, y);
  if (die(100) <= 38) {
    return { monsterIndex: pickIndex(tier, 1, terrainClass, die), ambush: true };
  }
  const mode = die(100) <= 26 ? 2 : 3;
  return { monsterIndex: pickIndex(tier, mode, terrainClass, die), ambush: false };
}
