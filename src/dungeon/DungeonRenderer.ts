/**
 * Dungeon cell rendering — cell-code → tile mapping, factored out of the
 * scene so the A7 art swap touches this module and not the movement/
 * collision logic.
 *
 * > **Correction (2026-08-18, game-re):** the previous version of this
 * > module rendered every cell as a flat colour rectangle, on the theory
 * > that `Dng.csh` decodes to a mostly-empty backdrop picture with "no
 * > per-cell tile set". That was wrong — see
 * > `docs/phantasie/implementation.md`'s A7 status update and
 * > `docs/phantasie/graphics-formats.md` §4.6 for the full disassembly
 * > evidence. `Dng.csh` is a real 9-icon dungeon-view tile bank; the game
 * > builds the on-screen dungeon grid by stamping one of those icons per
 * > cell, exactly matching the confirmed 24-column × 30-row dungeon grid
 * > (`dungeon-format.md` §3). `dngIconNameFor()` below is the real
 * > cell-code → icon mapping, reverse-engineered from `LAB_1388`'s
 * > dispatch table; `colorFor()`/`KIND_COLORS` are kept only as a
 * > texture-load-failure fallback.
 */

import { classifyCell, type CellClass, type DoorState } from '../assets/formats/dungeon.ts';
import { dngIconNameFor } from '../assets/formats/dng-icons.ts';

export { dngIconNameFor };

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
