/**
 * `Dng.csh`'s real content: a 9-icon dungeon-view tile bank, not a
 * full-screen backdrop. See docs/phantasie/graphics-formats.md §4.6 for the
 * full disassembly evidence (the runtime icon-table builder `LAB_010C`, the
 * per-cell grid walker `LAB_1374`/`LAB_1379`, and the cell-code → icon
 * dispatcher `LAB_1388`).
 *
 * Layout inside the decoded 320x200 canvas: icons are packed 5 per row at
 * `x = (i % 5) * 48`, row groups 48 scanlines apart at
 * `y = Math.floor(i / 5) * 48`. Row 0 of each 48-scanline band is not
 * icon content — it carries a tiny per-icon height byte the game reads by
 * sampling one bitplane per icon (`LAB_010D`) — so real pixel content
 * starts at `y = band + 1`. Every icon in the shipped file is 8px wide
 * (one byte per bitplane row, per the blitter `LAB_1391`) and 5px tall;
 * `extractDngIconFrames` re-derives the height from the actual decoded
 * pixels rather than hard-coding 5, so it stays correct if a future
 * corpus file ever ships a taller icon.
 *
 * `PhantasieIII`'s icon-table builder assigns Dng.csh's icons the global
 * indices `0x2D`-`0x35` (9 slots — confirmed by the next file loaded,
 * `Scroll.csh`, starting its own icons at `0x36`). Only 6 of those 9 slots
 * are ever dispatched to by a real dungeon cell code (`LAB_1388`); the
 * table below assigns every dispatched slot a name.
 *
 * Two of the un-dispatched slots turn out to be exact pixel duplicates of
 * a dispatched one, confirmed against real Amiga screenshots
 * (`data/default_72.png`/`default_74.png` — graphics-formats.md §4.6):
 * `0x2D` is pixel-identical to `0x34` (`stairsExit`'s own icon — so a
 * revealed stairs cell literally looks the same as whatever `0x2D`
 * represents, not a distinct "stairs" glyph), and `0x35` is
 * pixel-identical to `0x2E` (`wall`) — not a distinct "cursor" icon as
 * an earlier pass in this file speculated; that guess is refuted by
 * direct pixel comparison. `0x33` remains unassigned (clamp-overflow
 * fallback in `LAB_1379`, never actually reached by `LAB_1388`'s real
 * outputs).
 */

import type { CmpImage } from './cmp.ts';
import type { CellClass } from './dungeon.ts';

export const DNG_ICON_WIDTH = 8;
/** Icons are packed 5 per row, 48px/48 scanlines per slot, in the decoded 320x200 canvas. */
const ICON_COLS = 5;
const ICON_COL_STRIDE = 48;
const ICON_ROW_STRIDE = 48;
/** Row 0 of each 48-scanline band is the per-icon height byte, not pixel content. */
const CONTENT_ROW_OFFSET = 1;
/** Upper bound on how far to scan for the icon's real (trimmed) height. */
const MAX_ICON_HEIGHT = 16;
/** Palette index 0 is background/transparent in every P3 `.cmp`/`.csh` render. */
const BACKGROUND_INDEX = 0;

export interface DngIconFrame {
  /** Global icon-table index (`0x2D`-`0x35`), matching the game's own numbering. */
  globalIndex: number;
  /** Semantic role name — see `DNG_ICON_ROLE`. `null` for still-unassigned slots. */
  name: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Local icon index (0-8, `Dng.csh`'s own icon order) → semantic role.
 *
 * Derived directly from `LAB_1388`'s cell-code dispatch (file
 * `PhantasieIII.asm`): wall/secretWall (cell `0x00`/`0x01`) → `0x2E`,
 * horizontal door (`0xB9`-`0xC7`) → `0x2F`, vertical door (`0xC8`-`0xD6`)
 * → `0x30`, star (`0xDD`-`0xFF`) → `0x31`, everything else (traps,
 * encounters, messages — deliberately unreadable on the map until
 * stepped on) → `0x32`, stairsExit (`0xD7`-`0xD9`) → `0x34`. `0x2D` is
 * only ever used as `LAB_1379`'s clamp *floor* (never assigned by
 * `LAB_1388`) — and is pixel-identical to `0x34`, confirmed against real
 * screenshots. `0x33` is the clamp-overflow fallback (unreachable given
 * `LAB_1388`'s real outputs). `0x35` is never referenced by the maze
 * walker at all, and is pixel-identical to `0x2E` — a duplicate wall
 * slot, not a distinct icon. See graphics-formats.md §4.6.
 */
export const DNG_LOCAL_ICON_NAME: readonly (string | null)[] = [
  null, // 0x2D — reserved / clamp floor only
  'wall', // 0x2E
  'doorHorizontal', // 0x2F
  'doorVertical', // 0x30
  'star', // 0x31
  'floor', // 0x32 — generic: traps/encounters/messages all render as this
  null, // 0x33 — clamp-overflow fallback, never actually dispatched to
  'stairsExit', // 0x34
  null, // 0x35 — unreferenced by the maze walker; role not traced
];

export const DNG_FIRST_GLOBAL_ICON_INDEX = 0x2d;

/**
 * `CellClass['kind']` (+ door orientation) → `Dng.csh` icon role name.
 * `secretWall` renders identically to `wall` (both are indistinguishable
 * on the in-game map until discovered); every non-wall/door/star/stairs
 * kind (traps, encounters, messages) renders as the generic `'floor'`
 * icon — the original game hides those cells until the party steps on
 * them (see the `DNG_LOCAL_ICON_NAME` doc comment above).
 */
export function dngIconNameFor(cls: CellClass): string {
  switch (cls.kind) {
    case 'wall':
    case 'secretWall':
      return 'wall';
    case 'door':
      return cls.orientation === 'horizontal' ? 'doorHorizontal' : 'doorVertical';
    case 'star':
      return 'star';
    case 'stairsExit':
      return 'stairsExit';
    default:
      return 'floor';
  }
}

/**
 * Find the real (trimmed) content rows for one icon slot within an
 * already-decoded `Dng.csh` image, skipping the reserved metadata row.
 * Returns `null` if the slot has no content at all (would indicate a
 * corpus file with fewer than 9 icons).
 */
function trimIconRows(
  indices: Uint8Array,
  imageWidth: number,
  slotX: number,
  slotY: number,
): { y: number; h: number } | null {
  let firstRow = -1;
  let lastRow = -1;
  for (let r = CONTENT_ROW_OFFSET; r < MAX_ICON_HEIGHT; r++) {
    let any = false;
    for (let c = 0; c < DNG_ICON_WIDTH; c++) {
      if (indices[(slotY + r) * imageWidth + slotX + c] !== BACKGROUND_INDEX) {
        any = true;
        break;
      }
    }
    if (any) {
      if (firstRow < 0) firstRow = r;
      lastRow = r;
    }
  }
  if (firstRow < 0) return null;
  return { y: slotY + firstRow, h: lastRow - firstRow + 1 };
}

/**
 * Extract `Dng.csh`'s 9 icon frames from an already-decoded `.csh` image
 * (`decodeCmp(dngCshBytes)`), as `{name, x, y, w, h}` sub-rects of that
 * same 320x200 canvas — no separate atlas image needed, the frames slice
 * directly into the already-built `dng.png`.
 */
export function extractDngIconFrames(image: Pick<CmpImage, 'indices' | 'width'>): DngIconFrame[] {
  const frames: DngIconFrame[] = [];
  for (let i = 0; i < DNG_LOCAL_ICON_NAME.length; i++) {
    const slotX = (i % ICON_COLS) * ICON_COL_STRIDE;
    const slotY = Math.floor(i / ICON_COLS) * ICON_ROW_STRIDE;
    const trimmed = trimIconRows(image.indices, image.width, slotX, slotY);
    if (!trimmed) continue;
    frames.push({
      globalIndex: DNG_FIRST_GLOBAL_ICON_INDEX + i,
      name: DNG_LOCAL_ICON_NAME[i],
      x: slotX,
      y: trimmed.y,
      w: DNG_ICON_WIDTH,
      h: trimmed.h,
    });
  }
  return frames;
}
