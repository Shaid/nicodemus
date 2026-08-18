/**
 * Dungeon cell rendering — cell-code → colour mapping, factored out of the
 * scene so the A7 art swap touches this module and not the movement/
 * collision logic.
 *
 * Colours are Phantasie III's own dungeon palette: the values below are the
 * actual `Dng.csh` header palette (graphics-formats.md §4.5.4's "dungeon"
 * slot — the palette the game installs for the dungeon view). The original
 * view is a flat top-down shape render over that backdrop: walls/doors in
 * the tan family, floor black. The semantic markers (star / trap /
 * encounter / stairs) are *not* visible in the original — those cells look
 * like floor until stepped on — but are kept subtly tinted here so the
 * browser build stays legible and debuggable.
 */

import { classifyCell, type CellClass, type DoorState } from '../assets/formats/dungeon.ts';

/** `Dng.csh` header palette values (index → hex). See the module comment. */
const DNG = {
  black: 0x000000,
  darkBrown: 0x662200,
  brown: 0x884422,
  tan: 0x886644,
  lightTan: 0xaa8866,
  cyan: 0x00ccee,
  green: 0x66aa00,
  yellow: 0xeeee00,
  orange: 0xee8822,
  red: 0xaa2200,
} as const;

export const KIND_COLORS: Record<CellClass['kind'], number> = {
  wall: DNG.tan,
  secretWall: DNG.darkBrown,
  trap: DNG.orange,
  triggeredTrap: DNG.brown,
  randomEncounter: DNG.red,
  specialMessage: DNG.black,
  fixedEncounter: DNG.red,
  unassigned: 0xff00ff,
  bottomMessage: DNG.black,
  door: DNG.lightTan,
  stairsExit: DNG.green,
  stairsInter: DNG.cyan,
  star: DNG.yellow,
};

export function doorColor(state: DoorState): number {
  switch (state) {
    case 'locked':
      return DNG.brown;
    case 'unlockable':
      return DNG.darkBrown;
    case 'encounter':
      return DNG.red;
    default:
      return DNG.lightTan; // open
  }
}

export function colorFor(cls: CellClass): number {
  return cls.kind === 'door' ? doorColor(cls.state) : KIND_COLORS[cls.kind];
}

/** Classify a cell byte at `(x, y)` for a dungeon of `width` columns. */
export function cellClassAt(cells: ArrayLike<number>, width: number, x: number, y: number, level: number): CellClass {
  return classifyCell(cells[y * width + x], level);
}
