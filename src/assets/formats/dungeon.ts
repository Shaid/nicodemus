/**
 * Phantasie I / II shared dungeon file: the 33x38 tile grid, the header
 * fields that precede the star/action tables, and the cell-ID semantic
 * table that classifies every grid byte.
 *
 * See docs/phantasie/dungeon-format.md §1-§4. Phantasie I and II are read
 * by the identical parser at these offsets (§1); Phantasie III uses a
 * different, smaller grid and different header offsets — see `dungeon-p3.ts`.
 * The cell-ID range table (§4) is shared byte-for-byte across all three
 * games and lives here as `classifyCell()`; `dungeon-p3.ts` re-exports it.
 *
 * Star/action table *decoding* lives in `star-action.ts` (this module only
 * hands out the two tables' base offsets); message-file decoding lives in
 * `messages.ts`.
 */

export const DUNGEON_WIDTH = 33;
export const DUNGEON_HEIGHT = 38;
export const DUNGEON_GRID_SIZE = DUNGEON_WIDTH * DUNGEON_HEIGHT; // 1254

export const DUNGEON_LEVEL_OFFSET = 0x04e7;
export const DUNGEON_ENCOUNTER_TABLE_OFFSET = 0x04e8;
export const DUNGEON_ENCOUNTER_TABLE_SIZE = 10;
/** Unidentified 9-byte gap between the encounter table and the star table (dungeon-format.md §3, open). */
export const DUNGEON_UNKNOWN_GAP_OFFSET = 0x04f2;
export const DUNGEON_UNKNOWN_GAP_SIZE = 9;

export const DUNGEON_STAR_TABLE_OFFSET = 0x04fb;
export const DUNGEON_ACTION_TABLE_OFFSET = 0x05aa;

/** 35 slots x 5 bytes = 175, reaching exactly `0x04FB + 175 = 0x05AA` (§3.1). */
export const STAR_TABLE_SLOT_COUNT = 35;
export const STAR_TABLE_SLOT_SIZE = 5;

/**
 * Terminator scan safety bound — the confirmed reserved region is ~290
 * bytes (145 two-byte slots, §3.1); real files always terminate well
 * before this, so this is only a guard against a corrupt/foreign file
 * looping forever.
 */
export const ACTION_TABLE_MAX_SLOTS = 512;

export interface DungeonHeader {
  /** 0-based dungeon level, used for the `level * 12 + offset` encounter-roster convention (§4.1). */
  level: number;
  /** 10-entry fixed-encounter monster index table, indexed by `cell - 0x80`. */
  fixedEncounterTable: number[];
  /** Raw, unidentified 9-byte gap (§3) — preserved for forward compatibility, not interpreted. */
  unknownGap: Uint8Array;
}

export function decodeDungeonHeader(data: Uint8Array): DungeonHeader {
  return {
    level: data[DUNGEON_LEVEL_OFFSET],
    fixedEncounterTable: Array.from(
      data.slice(
        DUNGEON_ENCOUNTER_TABLE_OFFSET,
        DUNGEON_ENCOUNTER_TABLE_OFFSET + DUNGEON_ENCOUNTER_TABLE_SIZE,
      ),
    ),
    unknownGap: data.slice(DUNGEON_UNKNOWN_GAP_OFFSET, DUNGEON_UNKNOWN_GAP_OFFSET + DUNGEON_UNKNOWN_GAP_SIZE),
  };
}

/** The 33x38 grid, row-major, `cell[x,y]` at `y*33+x` (§3). */
export function decodeDungeonGrid(data: Uint8Array): Uint8Array {
  return data.slice(0, DUNGEON_GRID_SIZE);
}

export function cellAt(grid: Uint8Array, x: number, y: number): number {
  if (x < 0 || x >= DUNGEON_WIDTH || y < 0 || y >= DUNGEON_HEIGHT) {
    throw new RangeError(`dungeon cell (${x}, ${y}) outside the ${DUNGEON_WIDTH}x${DUNGEON_HEIGHT} grid`);
  }
  return grid[y * DUNGEON_WIDTH + x];
}

// ---------------------------------------------------------------------------
// Cell-ID semantic ranges — dungeon-format.md §4. Shared byte-for-byte
// across P1, P2 and P3 (P3's `ReadCell` throws on the 0xDA-0xDC
// "stairs from level N" range, per §4's table note — everything else here
// applies to all three games unchanged).
// ---------------------------------------------------------------------------

export type DoorState = 'open' | 'encounter' | 'locked' | 'unlockable';

export type CellClass =
  | { kind: 'wall' }
  | { kind: 'secretWall' }
  /** `0x02`-`0x06`. `trapValue` is the raw cell byte; damage formula is engine-specific (§6). */
  | { kind: 'trap'; trapValue: number }
  | { kind: 'triggeredTrap' }
  /** `0x08`-`0x11`. Rolls among `monsters[monsterIndex0..monsterIndex0+2]`. */
  | { kind: 'randomEncounter'; monsterIndex0: number }
  /** `0x12`-`0x7F`. One-line bottom message only, no encounter. */
  | { kind: 'specialMessage' }
  /** `0x80`-`0x89`. `fixedEncounterIndex` indexes the header's 10-entry table. */
  | { kind: 'fixedEncounter'; fixedEncounterIndex: number }
  /** `0x8A` — never observed in real data; the reference parser throws on it. */
  | { kind: 'unassigned' }
  /** `0x8B`-`0xB8`. One-line message only, no encounter. */
  | { kind: 'bottomMessage' }
  /** `0xB9`-`0xD6`. */
  | { kind: 'door'; orientation: 'horizontal' | 'vertical'; state: DoorState; monsterIndex0?: number }
  /** `0xD7`-`0xD9`. Exits the dungeon. */
  | { kind: 'stairsExit' }
  /** `0xDA`-`0xDC`, P1/P2 only. `fromLevel` is 1, 2 or 3. */
  | { kind: 'stairsInter'; fromLevel: number }
  /** `0xDD`-`0xFF`. `starIndex = cell - 0xDD` (max 34). */
  | { kind: 'star'; starIndex: number };

/**
 * Classify a dungeon cell byte per dungeon-format.md §4. `level` is the
 * dungeon's own header level field, needed for the `level*12+offset`
 * encounter-roster convention (§4.1).
 */
export function classifyCell(code: number, level: number): CellClass {
  if (code === 0x00) return { kind: 'wall' };
  if (code === 0x01) return { kind: 'secretWall' };
  if (code >= 0x02 && code <= 0x06) return { kind: 'trap', trapValue: code };
  if (code === 0x07) return { kind: 'triggeredTrap' };
  if (code >= 0x08 && code <= 0x11) {
    return { kind: 'randomEncounter', monsterIndex0: level * 12 + (code - 0x08) };
  }
  if (code >= 0x12 && code <= 0x7f) return { kind: 'specialMessage' };
  if (code >= 0x80 && code <= 0x89) return { kind: 'fixedEncounter', fixedEncounterIndex: code - 0x80 };
  if (code === 0x8a) return { kind: 'unassigned' };
  if (code >= 0x8b && code <= 0xb8) return { kind: 'bottomMessage' };
  if (code === 0xb9) return { kind: 'door', orientation: 'horizontal', state: 'open' };
  if (code >= 0xba && code <= 0xc5) {
    return {
      kind: 'door',
      orientation: 'horizontal',
      state: 'encounter',
      monsterIndex0: level * 12 + (code - 0xba),
    };
  }
  if (code === 0xc6) return { kind: 'door', orientation: 'horizontal', state: 'locked' };
  if (code === 0xc7) return { kind: 'door', orientation: 'horizontal', state: 'unlockable' };
  if (code === 0xc8) return { kind: 'door', orientation: 'vertical', state: 'open' };
  if (code >= 0xc9 && code <= 0xd4) {
    return {
      kind: 'door',
      orientation: 'vertical',
      state: 'encounter',
      monsterIndex0: level * 12 + (code - 0xc9),
    };
  }
  if (code === 0xd5) return { kind: 'door', orientation: 'vertical', state: 'locked' };
  if (code === 0xd6) return { kind: 'door', orientation: 'vertical', state: 'unlockable' };
  if (code >= 0xd7 && code <= 0xd9) return { kind: 'stairsExit' };
  if (code >= 0xda && code <= 0xdc) return { kind: 'stairsInter', fromLevel: code - 0xda + 1 };
  return { kind: 'star', starIndex: code - 0xdd };
}

// ---------------------------------------------------------------------------
// §6 — confirmed P1/P2-vs-P3 game-logic quirks. P1/P2's (corrected) trap
// formulas live here; P3's (uncorrected, buggy-but-real) formulas live in
// dungeon-p3.ts. Both are preserved as real original-game behavior, not
// "fixed" — see the module comments on each.
// ---------------------------------------------------------------------------

/** P1/P2 trap damage: `(cell-1)*5`, giving 5/10/15/20/25 for cells 0x02-0x06 (§6). */
export function p1p2TrapDamageMax(cell: number): number {
  return (cell - 1) * 5;
}

/** P1/P2 trap flavour-text message index: `cell + baseOffset - 1`, `baseOffset = 0x04` (§6). */
export function p1p2TrapMessageIndex(cell: number): number {
  return cell + 0x04 - 1;
}
