/**
 * Phantasie III dungeon file: the 24x30 tile grid, header fields, and the
 * message pointer table + text pool that (unlike P1/P2's separate `MESSn`
 * file) live in the same file as the grid.
 *
 * See docs/phantasie/dungeon-format.md §5. The cell-ID range table (§4) is
 * shared with P1/P2 and lives in `dungeon.ts`'s `classifyCell()` — this
 * module re-exports it since every consumer of a decoded P3 dungeon needs
 * it too.
 *
 * Confirmed against `data/phantasieiii/amiga/D/dnga.dat` (see this
 * project's own byte-level checks alongside the doc): header level byte,
 * fixed-encounter table, star table slot 0 (`81 01 00 00 00`), action
 * table slot 0 (`46 7A`), and message-pointer slot 0 (`0x0E6F` ->
 * `0x066F`, decoding to a single space) and slot 5 (`0x0E71` -> `0x0671`,
 * `"Arrows fire from a slit in the roof."`).
 */

export { classifyCell, type CellClass, type DoorState } from './dungeon.ts';

export const DUNGEON_P3_WIDTH = 24;
export const DUNGEON_P3_HEIGHT = 30;
export const DUNGEON_P3_GRID_SIZE = DUNGEON_P3_WIDTH * DUNGEON_P3_HEIGHT; // 720

export const DUNGEON_P3_LEVEL_OFFSET = 0x02d0;
export const DUNGEON_P3_ENCOUNTER_TABLE_OFFSET = 0x02d1;
export const DUNGEON_P3_ENCOUNTER_TABLE_SIZE = 10;
export const DUNGEON_P3_UNKNOWN_GAP_OFFSET = 0x02db;
export const DUNGEON_P3_UNKNOWN_GAP_SIZE = 9;

export const DUNGEON_P3_STAR_TABLE_OFFSET = 0x02e4;
export const DUNGEON_P3_ACTION_TABLE_OFFSET = 0x0393;
/** Fixed capacity, no terminator — bounded by the message pointer table start (§5.1). */
export const DUNGEON_P3_ACTION_TABLE_SLOT_COUNT = 256;

export const DUNGEON_P3_MESSAGE_POINTER_TABLE_OFFSET = 0x0593;
export const DUNGEON_P3_MESSAGE_POINTER_COUNT = 110;
export const DUNGEON_P3_MESSAGE_POOL_OFFSET = 0x066f;
/** Message pointer words are file offsets biased by this constant (§5.2). */
export const DUNGEON_P3_MESSAGE_ADDRESS_BIAS = 0x0800;

export interface DungeonP3Header {
  level: number;
  fixedEncounterTable: number[];
  unknownGap: Uint8Array;
}

export function decodeDungeonP3Header(data: Uint8Array): DungeonP3Header {
  return {
    level: data[DUNGEON_P3_LEVEL_OFFSET],
    fixedEncounterTable: Array.from(
      data.slice(
        DUNGEON_P3_ENCOUNTER_TABLE_OFFSET,
        DUNGEON_P3_ENCOUNTER_TABLE_OFFSET + DUNGEON_P3_ENCOUNTER_TABLE_SIZE,
      ),
    ),
    unknownGap: data.slice(
      DUNGEON_P3_UNKNOWN_GAP_OFFSET,
      DUNGEON_P3_UNKNOWN_GAP_OFFSET + DUNGEON_P3_UNKNOWN_GAP_SIZE,
    ),
  };
}

/** The 24x30 grid, row-major (§5). */
export function decodeDungeonP3Grid(data: Uint8Array): Uint8Array {
  return data.slice(0, DUNGEON_P3_GRID_SIZE);
}

export function cellAtP3(grid: Uint8Array, x: number, y: number): number {
  if (x < 0 || x >= DUNGEON_P3_WIDTH || y < 0 || y >= DUNGEON_P3_HEIGHT) {
    throw new RangeError(
      `P3 dungeon cell (${x}, ${y}) outside the ${DUNGEON_P3_WIDTH}x${DUNGEON_P3_HEIGHT} grid`,
    );
  }
  return grid[y * DUNGEON_P3_WIDTH + x];
}

// ---------------------------------------------------------------------------
// §6 — P3's own (uncorrected, buggy-but-real) trap formulas. Preserved
// exactly as documented; do NOT "fix" to match P1/P2's formulas.
// ---------------------------------------------------------------------------

/**
 * P3 trap damage: `damage = (cell-5)*5`, clamped to `12` whenever that
 * falls outside `(0, 25]` — the source's own "bug!!! should be cell-1"
 * comment (dungeon-format.md §6). Cells `0x02`-`0x05` all clamp to `12`;
 * only `0x06` computes correctly (`5`).
 */
export function p3TrapDamage(cell: number): number {
  const raw = (cell - 5) * 5;
  return raw > 0 && raw <= 25 ? raw : 12;
}

/**
 * P3 trap flavour-text message index: `cell - baseOffset + 0x64`,
 * `baseOffset = 0x60` — resolves to `cell + 4`, one message slot higher
 * than P1/P2's `p1p2TrapMessageIndex()` for the same cell (§6, a
 * documented off-by-one the source itself flags as a bug).
 */
export function p3TrapMessageIndex(cell: number): number {
  return cell - 0x60 + 0x64;
}

// ---------------------------------------------------------------------------
// §5.2 — message pointer table + text pool.
// ---------------------------------------------------------------------------

export interface P3MessagePointer {
  index: number;
  /** Raw stored big-endian word; 0 means "no message in this slot." */
  raw: number;
  /** `raw - 0x0800`, or `null` when `raw === 0` (empty slot). */
  address: number | null;
}

/** Decode all 110 message-pointer slots (raw + resolved address; text decode lives in messages.ts). */
export function decodeP3MessagePointers(data: Uint8Array): P3MessagePointer[] {
  const pointers: P3MessagePointer[] = [];
  for (let i = 0; i < DUNGEON_P3_MESSAGE_POINTER_COUNT; i++) {
    const at = DUNGEON_P3_MESSAGE_POINTER_TABLE_OFFSET + i * 2;
    const raw = (data[at] << 8) | data[at + 1];
    pointers.push({
      index: i,
      raw,
      address: raw === 0 ? null : raw - DUNGEON_P3_MESSAGE_ADDRESS_BIAS,
    });
  }
  return pointers;
}
