/**
 * `scrolls.dtx` (Phantasie I, Amiga) — the "THE HISTORY OF GELNOR" narrative
 * text bank read from readable scrolls found while adventuring.
 *
 * See docs/phantasie/dungeon-format.md §8.4 for the format writeup.
 *
 * **File layout (confirmed).** 16,000 bytes = a flat array of 400 fixed
 * 40-byte line slots. Each slot holds left-padded ASCII text (leading spaces
 * for centering, kept verbatim) and is NUL-padded to fill the remaining
 * bytes — not a single terminator, the whole remainder of the slot is zero.
 * Reading the 400 lines in order reproduces legible, multi-paragraph
 * narrative prose (all-caps, hyphenated word-wrap), the same formatting
 * style dungeon message text uses.
 *
 * **Scroll boundaries (confirmed, structural).** The file additionally
 * partitions into **20 fixed 20-line (800-byte) slots** —
 * `400 / 20 = 20` exactly. A scroll's content occupies the leading lines of
 * one or more slots and the remainder is filled with fully-NUL ("blank")
 * lines; a run of one or more blank lines always separates one scroll's
 * content from the next. Grouping the 400 raw lines by runs of non-blank
 * lines (`readScrollDocuments` below) yields **19 segments, and every
 * segment's start line is an exact multiple of 20 with zero deviations**
 * (starts: 0, 20, 40, 80, 100, 120, ..., 380) — the free byte-level
 * invariant that confirms the 20-line slot quantum without needing a code
 * trace. One scroll ("THE HISTORY OF GELNOR, PART 3", which continues
 * directly into an in-fiction "GELNOR TIMES" newspaper article) is 37 lines
 * long and spans two consecutive slots (2-3); every other scroll fits in a
 * single 20-line slot. This structurally parallels Phantasie III's
 * `D/S1`-`S20` scroll loader, which reads a fixed length per scroll and
 * special-cases the one outlier (`S6`) that needs more — see
 * dungeon-format.md §9.0.4.
 *
 * **Still open**: whether the game addresses a scroll by this same 0-19
 * slot index (with slot 3 simply never being requested, since its content
 * belongs to slot 2's overflow) was not code-traced this pass — the finding
 * above is a confirmed *data-layout* fact, not a confirmed *addressing*
 * scheme. See dungeon-format.md's dated correction to §8.4.
 */

import { readCString } from './ascii-strings.ts';

/** Byte width of one fixed line slot. */
export const SCROLL_LINE_LENGTH = 40;
/** Total number of 40-byte line slots in the file (`16000 / 40`). */
export const SCROLL_LINE_COUNT = 400;
/** Confirmed whole-file size in bytes. */
export const SCROLL_FILE_BYTES = SCROLL_LINE_LENGTH * SCROLL_LINE_COUNT;
/** Number of lines per fixed scroll slot (`400 / 20 = 20` slots total). */
export const SCROLL_SLOT_LINES = 20;
/** Number of fixed 800-byte scroll slots in the file. */
export const SCROLL_SLOT_COUNT = SCROLL_LINE_COUNT / SCROLL_SLOT_LINES;

/**
 * Read all 400 raw lines. NUL padding is stripped from the tail of each
 * 40-byte slot; author-placed leading/trailing spaces (used for centering)
 * are kept verbatim. A fully-NUL slot decodes to the empty string.
 */
export function readScrollLines(data: Uint8Array): string[] {
  if (data.length < SCROLL_FILE_BYTES) {
    throw new Error(`scrolls.dtx too short: need ${SCROLL_FILE_BYTES} bytes, got ${data.length}`);
  }
  const lines: string[] = [];
  for (let i = 0; i < SCROLL_LINE_COUNT; i++) {
    const offset = i * SCROLL_LINE_LENGTH;
    // readCString stops at the first NUL, which is exactly the tail-padding
    // boundary for every real line in this file (no embedded NULs mid-line).
    lines.push(readCString(data, offset, SCROLL_LINE_LENGTH));
  }
  return lines;
}

export interface ScrollDocument {
  /** 0-based index among the 19 confirmed scroll documents. */
  index: number;
  /** 0-based line index (into the flat 400-line array) the scroll starts at — always a multiple of `SCROLL_SLOT_LINES`. */
  startLine: number;
  /** Number of real content lines (blank separator lines excluded). */
  lineCount: number;
  /** Number of consecutive 20-line/800-byte slots this scroll's content spans (1, except one 2-slot scroll). */
  slotCount: number;
  /**
   * First content line that isn't itself just author-placed spacing,
   * trimmed — a convenience title guess, not a decoded field. (A scroll's
   * literal first line is sometimes an all-space vertical spacer, e.g. the
   * "THE MAGIC POOLS" scroll — so this isn't simply `lines[0]`.)
   */
  title: string;
  /** Content lines in order, NUL padding stripped, author spacing kept. */
  lines: string[];
}

/**
 * Group the 400 raw lines into scroll documents by runs of blank
 * (fully-NUL, i.e. empty-string) lines. See the module doc for the
 * confirmed 20-line-slot-alignment invariant this produces.
 */
export function readScrollDocuments(data: Uint8Array): ScrollDocument[] {
  const lines = readScrollLines(data);
  const docs: ScrollDocument[] = [];
  let current: string[] = [];
  let startLine = -1;

  const flush = () => {
    if (current.length === 0) return;
    docs.push({
      index: docs.length,
      startLine,
      lineCount: current.length,
      slotCount: Math.ceil(current.length / SCROLL_SLOT_LINES),
      title: current.find((l) => l.trim().length > 0)?.trim() ?? '',
      lines: current,
    });
    current = [];
    startLine = -1;
  };

  lines.forEach((line, i) => {
    if (line.length === 0) {
      flush();
    } else {
      if (startLine === -1) startLine = i;
      current.push(line);
    }
  });
  flush();

  return docs;
}
