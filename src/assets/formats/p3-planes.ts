/**
 * Phantasie III's three non-overworld "planes" — the Castle of Light, the
 * Castle of Dark and the Netherworld — plus the Netherworld's own terrain
 * re-banding and the `LocateSpecial()` arms gated on the active-map id.
 *
 * See docs/phantasie/dungeon-format.md §9.0.3.4 (the map-switch routine and
 * load path) and §9.0.5.4/§9.0.5.5 (the four map-id-gated `LocateSpecial()`
 * arms this file transcribes; the 30 ungated overworld arms live in
 * `p3-overworld.ts`). Everything here is read directly out of the real
 * `PhantasieIII` executable, not invented — see
 * `__tests__/p3-planes.test.ts` for the byte-exact cross-checks against the
 * real `D/PLN1`/`D/PLN2`/`D/PLN4` files and the executable's own name
 * tables.
 */

import {
  P3_TERRAIN_NAMES,
  p3TerrainClass,
  type P3Location,
  type P3TerrainBand,
} from './p3-overworld.ts';
import { PLN_CASTLE_HEIGHT, PLN_CASTLE_WIDTH, PLN_NETHERWORLD_HEIGHT, PLN_NETHERWORLD_WIDTH } from './pln.ts';

export type P3PlaneId = 1 | 2 | 4;

export interface P3Plane {
  /** The active-map global `$28C2`'s value for this plane — also the digit in `D/PLNn`. */
  id: P3PlaneId;
  /** Filename as it ships on disk (lowercase, `D/` folder). */
  file: string;
  name: string;
  width: number;
  height: number;
  /** Party's arrival square when entering this plane (addr `0x1EB5A`/`0x1EBF4`). */
  arrival: { x: number; y: number };
}

export const P3_PLANES: readonly P3Plane[] = [
  { id: 1, file: 'D/PLN1', name: 'Castle of Light', width: PLN_CASTLE_WIDTH, height: PLN_CASTLE_HEIGHT, arrival: { x: 4, y: 1 } },
  { id: 2, file: 'D/PLN2', name: 'Castle of Dark', width: PLN_CASTLE_WIDTH, height: PLN_CASTLE_HEIGHT, arrival: { x: 4, y: 1 } },
  { id: 4, file: 'D/PLN4', name: 'the Netherworld', width: PLN_NETHERWORLD_WIDTH, height: PLN_NETHERWORLD_HEIGHT, arrival: { x: 7, y: 3 } },
];

/**
 * The Netherworld's terrain re-banding, gated on hunk-1 `$28C3` bit 2
 * (`btst.b #$2,$28c3.l` at addr `0xA5EE`). These four arms run
 * *immediately after* `p3TerrainClass`'s standard chain in the same
 * function and — since the whole classifier has no early exit — unconditionally
 * override whatever class the standard chain already assigned for the same
 * byte range. Addresses are each arm's `move.w #class,-4(a5)` store, hunk-0
 * `0xA5FA`-`0xA674`.
 */
export const P3_NETHERWORLD_TERRAIN_BANDS: readonly P3TerrainBand[] = [
  { min: 61, max: 77, class: 17, addr: 0xa60a }, // Black path — overrides Dense Fog/Bright mist
  { min: 78, max: 82, class: 16, addr: 0xa620 }, // Mist — previously unclassified gap
  { min: 83, max: 87, class: 18, addr: 0xa636 }, // Steam — previously unclassified gap
  { min: 88, max: 241, class: 8, addr: 0xa64c }, // Lava — overrides Mountains/Hills/Desert/Meadows/Pathway/Forest/A bridge
];

/**
 * The terrain class a map byte gets **on the Netherworld's own grid**
 * (`D/PLN4`) — the standard overworld classifier (`p3TerrainClass`)
 * followed by the four re-banding overrides above, in the same order the
 * real chain runs them.
 */
export function p3NetherworldTerrainClass(value: number): number {
  let cls = p3TerrainClass(value);
  for (const band of P3_NETHERWORLD_TERRAIN_BANDS) {
    if (value >= band.min && value <= band.max) cls = band.class;
  }
  return cls;
}

/** 256-entry `value -> class` lookup for the Netherworld, the form the map JSON ships to the viewer. */
export function p3NetherworldTerrainClassTable(): number[] {
  return Array.from({ length: 256 }, (_, v) => p3NetherworldTerrainClass(v));
}

/**
 * The plane-gated `LocateSpecial()` arms — the two markers on each of the
 * three grids above (dungeon-format.md §9.0.5.5's "four further arms").
 * `LocateSpecial()`'s Y-band dispatch (addr `0x9CD0`-`0x9DE2`) reaches these
 * only when `$28C2` matches, so they never fire for `phantasy.set` cells —
 * `p3-overworld.ts`'s 30-entry table is deliberately disjoint from this one.
 *
 * Two of the four arms **compute** their name-table index from `$28C2`
 * rather than storing a literal — both now resolved (previously flagged
 * "not disentangled" in dungeon-format.md §9.0.5.5):
 *
 * - The shared castle arrival arm (`(4, 1)`, addr `0x9D9E`-`0x9DAE`) does
 *   `d0 = $28C2; d0 += 14; $2830 = d0` — town index **15** for `$28C2 == 1`
 *   (Light) or **16** for `$28C2 == 2` (Dark). The Netherworld's own
 *   arrival square is a different coordinate (`(7, 3)`) with its own
 *   dedicated arm storing the literal **17** (Death) — `14 + 4` would be 18,
 *   past the 18-entry town table's end, which is exactly why the Netherworld
 *   needed its own arm rather than reusing this formula.
 * - The shared castle dungeon-entrance arm (`(6, 7)` when `$28C2 == 1`, or
 *   `(2, 7)` when `$28C2 == 2`; addr `0x9DCA`-`0x9DDA`) does `d0 = $28C2;
 *   d0 += 9; $2830 = d0` — dungeon index **10** (`"The Castle of Light"`,
 *   `D/DNGF.DAT`) or **11** (`"The Castle of Dark"`, `D/DNGG.DAT`).
 *
 * All names and dungeon letters verified byte-exact against the
 * executable's own tables in `__tests__/p3-planes.test.ts`.
 */
export const P3_PLANE_LOCATIONS: readonly (P3Location & { planeId: P3PlaneId })[] = [
  { planeId: 1, x: 4, y: 1, type: 'town', index: 15, name: 'Light', addr: 0x9dae },
  { planeId: 1, x: 6, y: 7, type: 'dungeon', index: 10, name: 'The Castle of Light', file: 'D/DNGF.DAT', addr: 0x9dda },

  { planeId: 2, x: 4, y: 1, type: 'town', index: 16, name: 'Dark', addr: 0x9dae },
  { planeId: 2, x: 2, y: 7, type: 'dungeon', index: 11, name: 'The Castle of Dark', file: 'D/DNGG.DAT', addr: 0x9dda },

  { planeId: 4, x: 7, y: 3, type: 'town', index: 17, name: 'Death', addr: 0x9cfe },
  { planeId: 4, x: 6, y: 10, type: 'dungeon', index: 9, name: 'A dark fortress', file: 'D/DNGI.DAT', addr: 0x9d2a },
];

/** All P3_PLANE_LOCATIONS for one plane, in no particular order. */
export function planeLocations(id: P3PlaneId): (P3Location & { planeId: P3PlaneId })[] {
  return P3_PLANE_LOCATIONS.filter((loc) => loc.planeId === id);
}

// Re-exported for callers that only need the shared name table and don't
// want a second import of `p3-overworld.ts`.
export { P3_TERRAIN_NAMES };
