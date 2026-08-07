/**
 * AmigaOS HUNK executable parsing + embedded data-table extraction.
 *
 * `parseHunks()` is a generic HUNK-format loader (structural reference:
 * `/home/ctemplet/Development/middilgard/src/assets/formats/exe-data.ts`'s
 * `parseHunks()` — same problem shape, reimplemented independently here).
 *
 * The table-reading functions below do NOT route through `parseHunks()`'s
 * extracted CODE/DATA sub-buffers — every P1 (`game`) and P3
 * (`PhantasieIII`) offset in docs/phantasie/data-tables.md is confirmed to
 * work as a **raw, unadjusted file offset** into the whole executable, not
 * a hunk-relative one (data-tables.md §1, §5, §8). That's a genuinely
 * puzzling structural coincidence the doc flags but does not root-cause
 * (§8, TODO `data-p1-hunk-addressing`, already marked deferred — every
 * offset actually needed so far works, so this pass reads by raw file
 * offset like the doc does, rather than re-deriving a hunk-relative
 * addressing scheme that isn't needed for any table used here). `parseHunks`
 * is still provided (and tested against `game`'s own confirmed hunk-table
 * structure — see data-tables.md §8's byte-exact facts) as the generically
 * useful primitive the plan calls for, for any future code that does need
 * proper hunk-relative resolution.
 */

import { r32 } from '@seer-project/core';
import { readCString } from './ascii-strings.ts';
import { decodePalette16, type RGB } from './palette.ts';

// ---------------------------------------------------------------------------
// HUNK parsing
// ---------------------------------------------------------------------------

const HUNK_HEADER = 0x3f3;
const HUNK_CODE = 0x3e9;
const HUNK_DATA = 0x3ea;
const HUNK_BSS = 0x3eb;
const HUNK_RELOC32 = 0x3ec;
const HUNK_SYMBOL = 0x3f0;
const HUNK_DEBUG = 0x3f1;
const HUNK_END = 0x3f2;

export interface HunkHeaderInfo {
  /** Number of hunks in the size table (and in the executable overall). */
  tableSize: number;
  firstHunk: number;
  lastHunk: number;
  /** Byte size of each hunk, decoded from the (masked) size longwords. */
  hunkSizes: number[];
  /** File offset immediately after the header, where hunk bodies begin. */
  headerEnd: number;
}

/**
 * Parse just the `HUNK_HEADER` block: resident-library name list (usually
 * empty), hunk count, first/last hunk index, and the per-hunk size table.
 * Exposed separately from `parseHunks` so its structural facts (table
 * size, sizes, header end offset) can be checked against a known binary
 * independently of whether CODE/DATA extraction succeeds.
 */
export function readHunkHeader(exe: Uint8Array): HunkHeaderInfo {
  if (r32(exe, 0, 'be') !== HUNK_HEADER) {
    throw new Error('Not an AmigaOS HUNK executable (missing HUNK_HEADER magic at offset 0)');
  }
  let pos = 4;

  // Resident library name list: repeated { u32 nameLongs; name bytes },
  // terminated by a single zero-length entry. Empty (immediate 0) in every
  // Phantasie executable examined.
  for (;;) {
    const nameLongs = r32(exe, pos, 'be');
    pos += 4;
    if (nameLongs === 0) break;
    pos += nameLongs * 4;
  }

  const tableSize = r32(exe, pos, 'be');
  pos += 4;
  const firstHunk = r32(exe, pos, 'be');
  pos += 4;
  const lastHunk = r32(exe, pos, 'be');
  pos += 4;

  const hunkSizes: number[] = [];
  for (let i = 0; i < tableSize; i++) {
    // Low 30 bits = size in longwords; top 2 bits are memory-type flags
    // (CHIP/FAST/local), not part of the size.
    hunkSizes.push((r32(exe, pos, 'be') & 0x3fffffff) * 4);
    pos += 4;
  }

  return { tableSize, firstHunk, lastHunk, hunkSizes, headerEnd: pos };
}

/** Skip trailer blocks (RELOC32/SYMBOL/DEBUG, in any combination) up to and
 *  including the terminating HUNK_END. Returns the offset just past it. */
function skipHunkTrailers(exe: Uint8Array, startPos: number): number {
  let pos = startPos;
  for (;;) {
    const marker = r32(exe, pos, 'be');
    if (marker === HUNK_RELOC32) {
      pos += 4;
      for (;;) {
        const count = r32(exe, pos, 'be');
        pos += 4;
        if (count === 0) break;
        pos += 4; // hunk number this block relocates against
        pos += count * 4; // one offset longword per relocation
      }
    } else if (marker === HUNK_SYMBOL) {
      // Several commercially-shipped SAS/C-built executables in this
      // corpus carry their symbol table intact — must be skipped, not
      // assumed absent.
      pos += 4;
      for (;;) {
        const nameLongs = r32(exe, pos, 'be');
        pos += 4;
        if (nameLongs === 0) break;
        pos += nameLongs * 4 + 4; // name + value longword
      }
    } else if (marker === HUNK_DEBUG) {
      pos += 4;
      const longs = r32(exe, pos, 'be');
      pos += 4;
      pos += longs * 4;
    } else if (marker === HUNK_END) {
      pos += 4;
      return pos;
    } else {
      // Not a trailer marker: must be the type tag of the next hunk.
      return pos;
    }
  }
}

export interface ParsedHunks {
  code: Uint8Array;
  data: Uint8Array;
}

/** Parse an AmigaOS HUNK executable and return its first CODE and DATA hunks. */
export function parseHunks(exe: Uint8Array): ParsedHunks {
  const header = readHunkHeader(exe);
  let pos = header.headerEnd;

  let code: Uint8Array | null = null;
  let data: Uint8Array | null = null;

  for (let i = 0; i < header.tableSize; i++) {
    const hunkType = r32(exe, pos, 'be');
    pos += 4;

    if (hunkType === HUNK_CODE || hunkType === HUNK_DATA) {
      const longs = r32(exe, pos, 'be');
      pos += 4;
      const bytes = exe.slice(pos, pos + longs * 4);
      pos += longs * 4;
      if (hunkType === HUNK_CODE && !code) code = bytes;
      if (hunkType === HUNK_DATA && !data) data = bytes;
    } else if (hunkType === HUNK_BSS) {
      pos += 4; // just a size longword, no stored data
    }
    // Any other hunk type here would be malformed input; skipHunkTrailers
    // below re-syncs on the next HUNK_END/type-tag boundary regardless.

    pos = skipHunkTrailers(exe, pos);
  }

  if (!code) throw new Error('parseHunks: no CODE hunk found');
  if (!data) throw new Error('parseHunks: no DATA hunk found');
  return { code, data };
}

// ---------------------------------------------------------------------------
// Phantasie I (Amiga) tables — data-tables.md §1
// ---------------------------------------------------------------------------

const P1_MONSTER_NAME_TABLE_OFFSET = 0x0c88;
const P1_MONSTER_NAME_STRIDE = 58;
const P1_MONSTER_NAME_COUNT = 80;

const P1_RACE_NAME_TABLE_OFFSET = 0x69be;
const P1_RACE_NAME_COUNT = 16;

const P1_PALETTE_OFFSET = 0x194bc;

/** 80 fixed-size 58-byte monster name slots (data-tables.md §1.1). */
export function readP1MonsterNames(gameExe: Uint8Array): string[] {
  const names: string[] = [];
  for (let i = 0; i < P1_MONSTER_NAME_COUNT; i++) {
    names.push(readCString(gameExe, P1_MONSTER_NAME_TABLE_OFFSET + i * P1_MONSTER_NAME_STRIDE, P1_MONSTER_NAME_STRIDE));
  }
  return names;
}

/** 16 sequential (no fixed stride) NUL-terminated race names (data-tables.md §1.4). */
export function readP1RaceNames(gameExe: Uint8Array): string[] {
  const names: string[] = [];
  let offset = P1_RACE_NAME_TABLE_OFFSET;
  for (let i = 0; i < P1_RACE_NAME_COUNT; i++) {
    const name = readCString(gameExe, offset);
    names.push(name);
    offset += name.length + 1; // + NUL terminator
  }
  return names;
}

/** The confirmed 16-colour P1 monster/race palette (data-tables.md §1.3). */
export function readP1Palette(gameExe: Uint8Array): RGB[] {
  return decodePalette16(gameExe, P1_PALETTE_OFFSET, 'amigaToSt');
}

// ---------------------------------------------------------------------------
// Phantasie III (Amiga) skills table — data-tables.md §5
// ---------------------------------------------------------------------------

export const P3_SKILL_CLASS_ORDER = ['Fighter', 'Thief', 'Priest', 'Ranger', 'Monk', 'Wizard'] as const;
export type P3SkillClass = (typeof P3_SKILL_CLASS_ORDER)[number];

const P3_SKILL_LEVELS = 15;

const P3_SKILL_TABLE_OFFSETS: readonly [number, string][] = [
  [0x28386, 'Attack'],
  [0x283e0, 'Parry'],
  [0x28439, 'Swim'],
  [0x28493, 'Listen'],
  [0x284ed, 'Spot trap'],
  [0x28547, 'Disarm'],
  [0x285a1, 'Spot item'],
  [0x285fb, 'Pick lock'],
];

export interface P3SkillTable {
  name: string;
  byClass: Record<P3SkillClass, number[]>;
}

/**
 * The 8 skills tables, each `[6 classes][15 levels]` (data-tables.md §5.1).
 * Read directly against the raw `PhantasieIII` file bytes — confirmed
 * against this project's own file, no hunk adjustment involved.
 */
export function readP3SkillTables(exe: Uint8Array): P3SkillTable[] {
  return P3_SKILL_TABLE_OFFSETS.map(([offset, name]) => {
    const byClass = {} as Record<P3SkillClass, number[]>;
    P3_SKILL_CLASS_ORDER.forEach((cls, classIndex) => {
      const start = offset + classIndex * P3_SKILL_LEVELS;
      byClass[cls] = Array.from(exe.subarray(start, start + P3_SKILL_LEVELS));
    });
    return { name, byClass };
  });
}

// ---------------------------------------------------------------------------
// Phantasie II (Atari ST) tables - data-tables.md section 2
//
// Confirmed byte-exact against the real `PHANT.PRG` (155,785 bytes):
// PHANT.PRG *is* the same-platform (Atari ST) binary the reference source's
// offsets were originally recorded against, so every offset carries over
// unchanged from the reference source, unlike P3's Amiga-vs-ST port.
// ---------------------------------------------------------------------------

const P2_MONSTER_NAME_TABLE_OFFSET = 0x1ff2a;
const P2_MONSTER_NAME_STRIDE = 58;
const P2_MONSTER_NAME_COUNT = 80;

const P2_RACE_NAME_TABLE_OFFSET = 0x1f01c;
const P2_RACE_NAME_COUNT = 16;

const P2_PALETTE_OFFSET = 0x23a9e;

/** 80 fixed-size 58-byte monster name slots (data-tables.md 2.1). */
export function readP2MonsterNames(exe: Uint8Array): string[] {
  const names: string[] = [];
  for (let i = 0; i < P2_MONSTER_NAME_COUNT; i++) {
    names.push(readCString(exe, P2_MONSTER_NAME_TABLE_OFFSET + i * P2_MONSTER_NAME_STRIDE, P2_MONSTER_NAME_STRIDE));
  }
  return names;
}

/** 16 sequential (no fixed stride) NUL-terminated race names (data-tables.md 2.4). */
export function readP2RaceNames(exe: Uint8Array): string[] {
  const names: string[] = [];
  let offset = P2_RACE_NAME_TABLE_OFFSET;
  for (let i = 0; i < P2_RACE_NAME_COUNT; i++) {
    const name = readCString(exe, offset);
    names.push(name);
    offset += name.length + 1; // + NUL terminator
  }
  return names;
}

/**
 * The confirmed 16-colour P2 palette (data-tables.md 2.3). Decoded via the
 * plain `st` 3-bit-per-channel lookup, *not* the `AmigaToST` even-nibble
 * variant P1 uses - `PHANT.PRG` is itself the Atari ST binary, storing
 * genuine 3-bit nibbles rather than Amiga's doubled 4-bit nibbles.
 */
export function readP2Palette(exe: Uint8Array): RGB[] {
  return decodePalette16(exe, P2_PALETTE_OFFSET, 'st');
}
