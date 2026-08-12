/**
 * Phantasie message-file decoding: Phantasie I/II's separate `MESSn` file
 * (a length-prefixed per-line-slot table) and Phantasie III's embedded
 * pointer table + null-terminated text pool.
 *
 * See docs/phantasie/scripting-engine.md §3. `dungeon-p3.ts` already
 * decodes P3's raw pointer table (`P3MessagePointer`, dungeon-format.md
 * §5.2); this module adds the actual text/pool decode for both engines.
 *
 * **Correction (this pass, 2026-08-12):** scripting-engine.md §3.1
 * documents the P1/P2 embedded choice-count heuristic as "otherwise the
 * choice count comes from the line immediately following the message
 * body" — i.e. `choiceCount = nextLine.lengthByte` verbatim. Checked
 * against three real examples in `data/phantasie/amiga/mess1`/`mess4`
 * (message index 90, star-confirmed `nbChoices=2`, next-line byte `3`;
 * message index 69, star-confirmed `nbChoices=3`, next-line byte `4`;
 * message index 59, star-confirmed `nbChoices=9`, next-line byte `10`):
 * the raw byte is consistently **exactly one more** than the real choice
 * count used by the corresponding star record, in all three cases. This
 * matches the same "value stored is realValue + 1, 0 reserved" convention
 * already documented for the star record's own message-index field (§1:
 * `messageIndex = (byte0 & 0x7F) - 1`). `embeddedChoiceCountHint` below
 * therefore subtracts 1 from the raw next-line byte — the doc's literal
 * "comes from the line immediately following" description undercounts by
 * one. Slicing `choiceLineText` at the corrected count (not the raw byte)
 * reproduces the real choice text exactly: message 90's choice line
 * `" TAKE THEM  LEAVE THEM                  "` sliced at width 11 (per
 * the documented `<=7` rule) with count 2 (corrected) yields exactly
 * `["TAKE THEM", "LEAVE THEM"]`; the uncorrected count of 3 would slice a
 * spurious empty third entry. The `<40 -> 3` and `==12 -> 10` hardcoded
 * branches are untouched by this correction (they're literal constants in
 * the reference source, not a stored byte subject to the same +1 bias) and
 * remain unverified beyond what was already documented.
 */

import { type P3MessagePointer } from './dungeon-p3.ts';

// ---------------------------------------------------------------------------
// Phantasie I/II — scripting-engine.md §3.1.
// ---------------------------------------------------------------------------

export const MESSAGE_WORD_TABLE_COUNT = 115;
export const MESSAGE_WORD_TABLE_SIZE = MESSAGE_WORD_TABLE_COUNT * 2; // 230 = 0xE6
export const MESSAGE_TEXT_BASE = MESSAGE_WORD_TABLE_SIZE; // 0xE6
export const MESSAGE_LINE_TEXT_WIDTH = 40;
/** 1 length byte + 40 text bytes. */
export const MESSAGE_LINE_SIZE = MESSAGE_LINE_TEXT_WIDTH + 1;

const EMPTY_MESSAGE_WORD = 0xffff;

/** Read the 115-entry little-endian word offset table at the start of a `MESSn` file. */
export function decodeMessageWordTable(data: Uint8Array): number[] {
  const words: number[] = [];
  for (let i = 0; i < MESSAGE_WORD_TABLE_COUNT; i++) {
    words.push(data[i * 2] | (data[i * 2 + 1] << 8));
  }
  return words;
}

/** One raw 41-byte line unit: a length byte followed by 40 fixed-width text bytes. */
export function decodeMessageLine(data: Uint8Array, addr: number): { lengthByte: number; text: string } {
  const lengthByte = data[addr];
  const text = new TextDecoder('ascii').decode(data.subarray(addr + 1, addr + 1 + MESSAGE_LINE_TEXT_WIDTH));
  return { lengthByte, text };
}

export interface P1P2Message {
  index: number;
  /** Two consecutive word-table entries are equal (or absent past the table's end) — no content in this slot. */
  empty: boolean;
  /** Word value was the explicit `0xFFFF` exclusion sentinel. */
  excluded?: boolean;
  /** First line's length byte — total char count across the message's `lineCount` 40-char slots. */
  length?: number;
  /** `max(1, ceil(length/40))` — how many 41-byte line units the body occupies. */
  lineCount?: number;
  /** Concatenated 40-char text fields across all `lineCount` lines. */
  text?: string;
  /**
   * The reference parser's choice-count heuristic, corrected (see the
   * module doc comment's 2026-08-12 correction): `<40 chars -> 3`;
   * `==12 chars -> 10`; otherwise `nextLine.lengthByte - 1` when that raw
   * byte is in `1..10`. `undefined` when none of these apply (no choice
   * prompt after this message).
   */
  embeddedChoiceCountHint?: number;
  /** Raw 40-char text of the line immediately after the body, when in bounds — slice with `sliceChoiceText()` using the star's own authoritative `nbChoices`, not this hint (see the correction note). */
  choiceLineText?: string;
}

export function decodeP1P2Message(data: Uint8Array, wordTable: readonly number[], index: number): P1P2Message {
  const w = wordTable[index];
  const wn = wordTable[index + 1];
  if (w === undefined) return { index, empty: true };
  if (w === EMPTY_MESSAGE_WORD) return { index, empty: true, excluded: true };
  if (wn !== undefined && w === wn) return { index, empty: true };

  const addr0 = MESSAGE_TEXT_BASE + w;
  const first = decodeMessageLine(data, addr0);
  const length = first.lengthByte;
  const lineCount = Math.max(1, Math.ceil(length / MESSAGE_LINE_TEXT_WIDTH));

  let text = '';
  for (let s = 0; s < lineCount; s++) {
    text += decodeMessageLine(data, addr0 + s * MESSAGE_LINE_SIZE).text;
  }

  const afterAddr = addr0 + lineCount * MESSAGE_LINE_SIZE;
  let embeddedChoiceCountHint: number | undefined;
  let choiceLineText: string | undefined;
  if (afterAddr + MESSAGE_LINE_SIZE <= data.length) {
    const nextLine = decodeMessageLine(data, afterAddr);
    choiceLineText = nextLine.text;
    if (length < MESSAGE_LINE_TEXT_WIDTH) {
      embeddedChoiceCountHint = 3;
    } else if (length === 12) {
      embeddedChoiceCountHint = 10;
    } else if (nextLine.lengthByte >= 1 && nextLine.lengthByte <= 10) {
      // Corrected: real choice count = raw byte - 1 (see module doc comment).
      embeddedChoiceCountHint = nextLine.lengthByte - 1;
    }
  }

  return { index, empty: false, length, lineCount, text, embeddedChoiceCountHint, choiceLineText };
}

export function decodeAllP1P2Messages(data: Uint8Array): P1P2Message[] {
  const wordTable = decodeMessageWordTable(data);
  const messages: P1P2Message[] = [];
  for (let i = 0; i < MESSAGE_WORD_TABLE_COUNT; i++) messages.push(decodeP1P2Message(data, wordTable, i));
  return messages;
}

/**
 * Per-choice answer text width (scripting-engine.md §3.1): 11 chars
 * normally, 3 when there are more than 7 choices, 5 when there are
 * exactly 8.
 */
export function choiceTextWidth(count: number): number {
  if (count === 8) return 5;
  if (count > 7) return 3;
  return 11;
}

/** Slice a message's `choiceLineText` into `count` trimmed per-choice strings, using `choiceTextWidth(count)`. */
export function sliceChoiceText(lineText: string, count: number): string[] {
  const width = choiceTextWidth(count);
  const choices: string[] = [];
  for (let i = 0; i < count; i++) {
    choices.push(lineText.slice(i * width, (i + 1) * width).trim());
  }
  return choices;
}

// ---------------------------------------------------------------------------
// Phantasie III — scripting-engine.md §3.2. `dungeon-p3.ts` decodes the raw
// pointer table; this reads the text itself.
// ---------------------------------------------------------------------------

/** Explicit forced-line-break control code within P3 message text (§3.2). Not observed in this project's sampled Amiga data — see the doc's own "unconfirmed against real Amiga data" caveat. */
export const P3_MESSAGE_NEWLINE_CODE = 0xf0;

/** Decode one P3 message's text, converting `0xF0` bytes to `\n`. Returns `null` for an empty pointer slot. */
export function decodeP3Message(data: Uint8Array, pointer: P3MessagePointer): string | null {
  if (pointer.address === null) return null;
  let end = pointer.address;
  while (end < data.length && data[end] !== 0x00) end++;
  let text = '';
  for (let i = pointer.address; i < end; i++) {
    const b = data[i];
    text += b === P3_MESSAGE_NEWLINE_CODE ? '\n' : String.fromCharCode(b);
  }
  return text;
}

export function decodeAllP3Messages(data: Uint8Array, pointers: readonly P3MessagePointer[]): (string | null)[] {
  return pointers.map((p) => decodeP3Message(data, p));
}

/**
 * `Windowed`/`Fullscreen` word-wrap (§3.2): wraps at `width` characters on
 * top of any explicit `\n` from a `0xF0` code. Default `38` is the
 * doc-cited Atari-ST-convention width; the Amiga-specific width was not
 * independently confirmed (no `0xF0` bytes in the sampled data — see the
 * `P3_MESSAGE_NEWLINE_CODE` doc comment).
 */
export function wrapP3Message(text: string, width = 38): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    for (let i = 0; i < paragraph.length; i += width) {
      lines.push(paragraph.slice(i, i + width));
    }
  }
  return lines;
}

// Re-exported so a caller only needs to import from this module for the
// full P1/P2-vs-P3 message pipeline; kept as a type-only re-export to avoid
// pulling dungeon-p3.ts's runtime exports in twice.
export type { P3MessagePointer };
