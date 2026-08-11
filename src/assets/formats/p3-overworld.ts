/**
 * Phantasie III overworld metadata — the terrain classifier and the named
 * locations that sit on the 50 x 75 `phantasy.set` map grid.
 *
 * See docs/phantasie/dungeon-format.md §9.0.5. Everything here is transcribed
 * from the Amiga executable's own bytes, not invented:
 *
 * - `P3_TERRAIN_NAMES` is the 19-entry name-pointer table at hunk-1 `0x1750`
 *   (file `0x29018`), resolved string by string.
 * - `P3_TERRAIN_BANDS` is the classifier at hunk-0 addr `0xA4A6`, arm for
 *   arm, in source order. The chain has **no early exit** — each arm either
 *   stores a class into the local at `-4(a5)` or falls through to the next
 *   test — so a later arm overwrites an earlier one. That is exactly why
 *   tile 222 ends up `A bridge` (addr `0xA5CA`) even though the `Pathway`
 *   band at addr `0xA59E` already covers 214-224.
 * - `P3_OVERWORLD_LOCATIONS` is `LocateSpecial()` at hunk-0 addr `0x9C6A`,
 *   a flat if-chain of literal `(x, y)` comparisons against the party
 *   position globals `$2834`/`$2836`. **The engine never reads the map byte
 *   to identify a location** — the distinctive tiles are the artwork only.
 *   Four further arms in that routine are gated on the active-map id
 *   `$28C2` (the castle interiors and the Netherworld) and are deliberately
 *   absent here: they are not overworld cells.
 *
 * P3 has no `out*.dat`/`maps.int` equivalent — there is no POI side table to
 * decode, which is why this is a hand-transcribed constant rather than a
 * parser. `__tests__/p3-overworld.test.ts` re-verifies the whole table
 * against the real `phantasy.set` bytes (every location's cell must carry a
 * tile that occurs exactly as many times in the map as it has locations).
 */

/** Terrain-class name table, hunk-1 `0x1750`. Index = the class the classifier stores. */
export const P3_TERRAIN_NAMES: readonly string[] = [
  'Meadows', // 0
  'Forest', // 1
  'Hills', // 2
  'Mountains', // 3
  'BUILDING', // 4 — used by other callers, never by the terrain chain
  'DUNGEON', // 5 — likewise
  'Pathway', // 6
  'Netherworld', // 7
  'Lava', // 8
  'Desert', // 9
  'Water', // 10
  'Bright mist', // 11
  'Ocean', // 12 — used by the map-edge refusal, not the terrain chain
  'A bridge', // 13
  'Dense Fog', // 14
  'The River Styx', // 15
  'Mist', // 16 — Netherworld re-banding
  'Black path', // 17 — Netherworld re-banding
  'Steam', // 18 — Netherworld re-banding
];

export interface P3TerrainBand {
  /** Inclusive lower bound of the tile-value range this arm tests. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  /** Index into `P3_TERRAIN_NAMES`. */
  class: number;
  /** Address of the arm's `move.w #class` (or `clr.w`) store. */
  addr: number;
}

/**
 * The overworld terrain classifier's arms in source order, addr `0xA4A6`.
 * Later arms win (the chain falls through). The Netherworld re-banding arms
 * at `0xA5FA`-`0xA64C` are excluded: they are gated on `$28C3` bit 2 and
 * never apply to a `phantasy.set` cell.
 */
export const P3_TERRAIN_BANDS: readonly P3TerrainBand[] = [
  { min: 0, max: 0, class: 10, addr: 0xa500 }, // tst.w / beq arm
  { min: 1, max: 1, class: 10, addr: 0xa4e4 },
  { min: 2, max: 25, class: 10, addr: 0xa500 },
  { min: 68, max: 74, class: 11, addr: 0xa516 },
  { min: 61, max: 67, class: 14, addr: 0xa52c },
  { min: 90, max: 114, class: 3, addr: 0xa542 },
  { min: 115, max: 154, class: 2, addr: 0xa558 },
  { min: 155, max: 187, class: 9, addr: 0xa56e },
  { min: 188, max: 205, class: 0, addr: 0xa584 }, // clr.w -4(a5)
  { min: 206, max: 209, class: 6, addr: 0xa598 },
  { min: 214, max: 224, class: 6, addr: 0xa5ae },
  { min: 225, max: 241, class: 1, addr: 0xa5c4 },
  { min: 222, max: 222, class: 13, addr: 0xa5d2 }, // after Pathway: bridge wins
  { min: 242, max: 255, class: 15, addr: 0xa5e0 },
];

/** No band claims the value — the classifier leaves its local uninitialised. */
export const P3_TERRAIN_UNCLASSIFIED = -1;

/**
 * The terrain class the engine would assign a map byte, or
 * `P3_TERRAIN_UNCLASSIFIED` for the value ranges the chain simply never
 * assigns (26-60, 75-89, 210-213). Those gaps are not a decoding failure:
 * 26-60 is where the named-location marker tiles live, and for those cells
 * `LocateSpecial()` short-circuits before the classifier ever runs.
 */
export function p3TerrainClass(value: number): number {
  let cls = P3_TERRAIN_UNCLASSIFIED;
  for (const band of P3_TERRAIN_BANDS) {
    if (value >= band.min && value <= band.max) cls = band.class;
  }
  return cls;
}

/** 256-entry `value -> class` lookup, the form the map JSON ships to the viewer. */
export function p3TerrainClassTable(): number[] {
  return Array.from({ length: 256 }, (_, v) => p3TerrainClass(v));
}

export type P3LocationType = 'town' | 'dungeon' | 'inn';

export interface P3Location {
  /** World column, 0-49 (west to east). */
  x: number;
  /** World row, 0-74 (north to south). */
  y: number;
  type: P3LocationType;
  /** The engine's own index within its type's name table. */
  index: number;
  /** Byte-exact string from the hunk-1 name table for this type and index. */
  name: string;
  /** `D/DNG?.DAT` the entrance opens, for dungeons only (letter table hunk-1 `0x22AC`). */
  file?: string;
  /** Address of the arm's `move.w #type,$282E` store in `LocateSpecial()`. */
  addr: number;
}

/**
 * Every named place on the overworld, transcribed from `LocateSpecial()`.
 *
 * Names come from the three hunk-1 pointer tables the routine's callers
 * index with `$2830`: towns `0x1684`, dungeons (single-line variant)
 * `0x16FC`, inns `0x172C`. Dungeon filenames come from the letter table at
 * hunk-1 `0x22AC` (`J H E D A C B K I F G` for indices 1-11), which
 * `EnterDungeon()` at addr `0x1BB58` patches into `"D/DNGX.DAT"`.
 */
export const P3_OVERWORLD_LOCATIONS: readonly P3Location[] = [
  { x: 24, y: 37, type: 'town', index: 1, name: 'Pendragon', addr: 0xa0fe },
  { x: 15, y: 39, type: 'town', index: 2, name: 'Sandy Shores', addr: 0xa12a },
  { x: 5, y: 35, type: 'town', index: 3, name: 'Pendleton', addr: 0x9f82 },
  { x: 35, y: 42, type: 'town', index: 4, name: 'Rocky Hills', addr: 0xa156 },
  { x: 43, y: 52, type: 'town', index: 5, name: 'Deltor', addr: 0xa182 },
  { x: 22, y: 65, type: 'town', index: 6, name: 'Tirith', addr: 0xa262 },
  { x: 11, y: 69, type: 'town', index: 7, name: 'Tierrin', addr: 0xa28e },
  { x: 25, y: 27, type: 'town', index: 8, name: 'Asmith', addr: 0x9fae },
  { x: 5, y: 51, type: 'town', index: 9, name: 'Sierion', addr: 0xa1ae },
  { x: 44, y: 66, type: 'town', index: 10, name: 'Xanador', addr: 0xa2ba },
  { x: 44, y: 5, type: 'town', index: 11, name: 'Flagler', addr: 0x9e06 },
  { x: 22, y: 12, type: 'town', index: 12, name: 'Lansing', addr: 0x9e32 },
  { x: 8, y: 9, type: 'town', index: 13, name: 'Scanport', addr: 0x9e5e },
  { x: 15, y: 22, type: 'town', index: 14, name: 'Sciattica', addr: 0x9fda },

  { x: 46, y: 9, type: 'dungeon', index: 1, name: 'A very small straw hut', file: 'D/DNGJ.DAT', addr: 0x9e8a },
  { x: 25, y: 8, type: 'dungeon', index: 2, name: 'Many men guard tent here', file: 'D/DNGH.DAT', addr: 0x9eb6 },
  { x: 48, y: 36, type: 'dungeon', index: 3, name: 'A large crystal building', file: 'D/DNGE.DAT', addr: 0xa006 },
  { x: 36, y: 38, type: 'dungeon', index: 4, name: 'A large cavern starts here', file: 'D/DNGD.DAT', addr: 0xa1da },
  { x: 25, y: 39, type: 'dungeon', index: 5, name: 'The Pendragon town archives', file: 'D/DNGA.DAT', addr: 0xa206 },
  { x: 2, y: 35, type: 'dungeon', index: 6, name: 'The Dwarven burial grounds', file: 'D/DNGC.DAT', addr: 0xa032 },
  { x: 28, y: 67, type: 'dungeon', index: 7, name: 'A giant wooden building', file: 'D/DNGB.DAT', addr: 0xa2e6 },
  { x: 7, y: 66, type: 'dungeon', index: 8, name: 'A cave smelling of sulphur', file: 'D/DNGK.DAT', addr: 0xa312 },

  { x: 24, y: 20, type: 'inn', index: 1, name: 'The Mystic Inn', addr: 0x9ee2 },
  { x: 46, y: 21, type: 'inn', index: 2, name: 'The Portal Inn', addr: 0x9f0e },
  { x: 43, y: 34, type: 'inn', index: 3, name: 'The Crown Inn', addr: 0xa05e },
  { x: 24, y: 32, type: 'inn', index: 4, name: 'The Jolly Inn', addr: 0xa08a },
  { x: 14, y: 24, type: 'inn', index: 5, name: 'The Kanpai Inn', addr: 0xa0b6 },
  { x: 2, y: 21, type: 'inn', index: 6, name: 'The Desert Inn', addr: 0x9f3a },
  { x: 22, y: 50, type: 'inn', index: 7, name: 'The Royal Inn', addr: 0xa232 },
  { x: 2, y: 65, type: 'inn', index: 8, name: 'The Deadly Inn', addr: 0xa33e },
];
