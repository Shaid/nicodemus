/**
 * AmigaOS HUNK executable parsing + embedded data-table extraction.
 *
 * `parseHunks()` is a generic HUNK-format loader (structural reference:
 * `/home/ctemplet/Development/middilgard/src/assets/formats/exe-data.ts`'s
 * `parseHunks()` — same problem shape, reimplemented independently here).
 *
 * The table-reading functions below do NOT route through `parseHunks()`'s
 * extracted CODE/DATA sub-buffers — every P1 (`game`) and P3
 * (`PhantasieIII`) offset in docs/phantasie/data-tables.md is a **raw,
 * unadjusted file offset** into the whole executable (data-tables.md §1,
 * §5, §8). This was once flagged as a puzzling coincidence; it isn't one.
 * The offsets were never hunk-0-relative — they are file positions that
 * land inside whichever hunk really holds the data (e.g. the palette array
 * at `0x194BC` is DATA hunk 69 `+0x94`), and since we read the file on
 * disk rather than a relocated load image, reading at a file offset is
 * simply correct. See data-tables.md §8 for the full resolution table.
 *
 * The one thing a file offset can NOT answer is an *address* question —
 * call targets and `pea`/`jsr` operands hold pre-relocation hunk-relative
 * values and must be resolved through the owning hunk's `HUNK_RELOC32`
 * list (data-tables.md §1.3a). `parseHunks` is provided (and tested
 * against `game`'s own confirmed hunk-table structure) as the generically
 * useful primitive for any future code that needs that.
 */

import { r16, r32 } from '@seer-project/core';
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
    names.push(
      readCString(
        gameExe,
        P1_MONSTER_NAME_TABLE_OFFSET + i * P1_MONSTER_NAME_STRIDE,
        P1_MONSTER_NAME_STRIDE,
      ),
    );
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

/**
 * The confirmed 16-colour P1 monster/race palette (data-tables.md §1.3;
 * this is `pal3`, `P1_PALETTE_SLOT_OFFSETS[3]` below). Uses the native Amiga
 * OCS decode (`component * 17`) -- see `readP1PaletteSlot`'s doc comment for
 * why, and data-tables.md §1.3's 2026-08-10 correction block for the fix
 * history (this reader previously used the ST `amigaToSt` even-nibble
 * lookup, which silently zeroed the odd-valued nibbles a native Amiga
 * palette is free to use).
 */
export function readP1Palette(gameExe: Uint8Array): RGB[] {
  return decodePalette16(gameExe, P1_PALETTE_OFFSET, 'amiga');
}

/**
 * The five 16-colour palettes the P1 `game` executable selects between,
 * one per screen — file offsets `0x1945C`, `0x1947C`, `0x1949C`, `0x194BC`,
 * `0x194DC` (DATA hunk 69 `+0x34` .. `+0xB4`, 32 bytes each, contiguous).
 *
 * Confirmed byte-exact: every `SetPalette()` call site in the binary was
 * enumerated (7 cross-hunk `HUNK_RELOC32` sites + 3 intra-hunk `bsr`s) and
 * each one's `pea` argument resolved through its own relocation entry —
 * see data-tables.md §1.3a for the full call-site map and the per-screen
 * roles, and graphics-formats.md §3 for the `.pic` assignments.
 *
 * Slot 0 is the all-black "blank the screen while loading" table, not a
 * real palette. Do not extend past slot 4: `hunk69+0xD4`/`+0xE0` look like
 * two more 32-byte blocks but are mouse-pointer sprite imagery passed to
 * `intuition.library/SetPointer`.
 */
export const P1_PALETTE_SLOT_OFFSETS: readonly number[] = [
  0x1945c, 0x1947c, 0x1949c, 0x194bc, 0x194dc,
];

/**
 * Read palette slot `slot` (0-4) using the native Amiga OCS decode
 * (`component * 17`) — correct for this executable, whose palette words go
 * straight to `graphics.library/LoadRGB4`. See `palette.ts`'s
 * `AMIGA_OCS_CHANNEL_LOOKUP` for why the ST `amigaToSt` doubling table is
 * the wrong decode here.
 */
export function readP1PaletteSlot(gameExe: Uint8Array, slot: number): RGB[] {
  const offset = P1_PALETTE_SLOT_OFFSETS[slot];
  if (offset === undefined) {
    throw new Error(
      `P1 palette slot out of range: ${slot} (expected 0-${P1_PALETTE_SLOT_OFFSETS.length - 1})`,
    );
  }
  return decodePalette16(gameExe, offset, 'amiga');
}

// ---------------------------------------------------------------------------
// Phantasie III (Amiga) skills table — data-tables.md §5
// ---------------------------------------------------------------------------

export const P3_SKILL_CLASS_ORDER = [
  'Fighter',
  'Thief',
  'Priest',
  'Ranger',
  'Monk',
  'Wizard',
] as const;
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
    names.push(
      readCString(
        exe,
        P2_MONSTER_NAME_TABLE_OFFSET + i * P2_MONSTER_NAME_STRIDE,
        P2_MONSTER_NAME_STRIDE,
      ),
    );
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

// ---------------------------------------------------------------------------
// Phantasie II (Atari ST) `.PIC` full-screen picture palettes
// (graphics-formats.md §10). Two *additional* palettes beyond the
// monster/race one above, each confirmed byte-exact via disassembly of the
// real `START.PRG`/`PHANT.PRG` XBIOS `Setpalette` (function 6) call sites
// that govern the six `.PIC` files.
// ---------------------------------------------------------------------------

/**
 * `START.PRG`'s title-screen palette (governs `COVER1.PIC`/`COVER2.PIC`).
 * Confirmed: `START.PRG` text address `0x156` (file offset `0x172`) is the
 * operand of `move.l #$156,-(a7); move.w #$6,-(a7); trap #$e` at text
 * address `0x78` (file offset `0x94`), executed immediately after
 * `cover1.pic` is read into `Physbase()` and before `cover2.pic` is read
 * into `Physbase()+0x28A0` — so both files share this one palette. A
 * second, all-black palette at text address `0x176` (file offset `0x192`)
 * is set *before* `cover1.pic` loads (a blank-screen-while-loading
 * convention) and is not used by either rendered image.
 */
const P2_PIC_COVER_PALETTE_OFFSET = 0x172;

/**
 * `PHANT.PRG`'s town-screen palette (governs `PELNOR.PIC`, and by
 * inheritance any picture shown without its own `Setpalette` call while
 * the town screen is up). Confirmed: `PHANT.PRG` text address `0x23a62`
 * (file offset `0x23a7e`) is the operand of the `Setpalette` call inside
 * the function at text address `0x2d0e` (file offset `0x2d2a`), which is
 * called from the town-entry loop immediately before the call chain that
 * loads and blits `pelnor.pic` (`0x13710` existence check -> `0x4706` ->
 * `0x4382`, which `Fopen`/`Malloc`/`Fread`s 32,000 bytes into
 * `Logbase()`).
 */
const P2_PIC_TOWN_PALETTE_OFFSET = 0x23a7e;

/** See `P2_PIC_COVER_PALETTE_OFFSET`. */
export function readP2CoverPalette(startPrg: Uint8Array): RGB[] {
  return decodePalette16(startPrg, P2_PIC_COVER_PALETTE_OFFSET, 'st');
}

/** See `P2_PIC_TOWN_PALETTE_OFFSET`. */
export function readP2TownPalette(exe: Uint8Array): RGB[] {
  return decodePalette16(exe, P2_PIC_TOWN_PALETTE_OFFSET, 'st');
}

// ---------------------------------------------------------------------------
// Phantasie III (Amiga) name tables — data-tables.md §3.1, §4
//
// All three tables below live in the real `PhantasieIII` executable
// (174,928 bytes), confirmed this pass. The item/spell tables are plain
// sequential NUL-terminated strings (P1/P2's convention). The race table is
// NOT — it's addressed through an 18-entry pointer array whose stored
// longwords are `HUNK_CODE`-hunk-relative offsets (see data-tables.md §4
// for the `HUNK_RELOC32` cross-reference that found it): `fileOffset =
// P3_HUNK0_DATA_START + storedPointer`. `P3_HUNK0_DATA_START` (0x28) is
// `PhantasieIII`'s own `HUNK_HEADER` (32 bytes) + `HUNK_CODE` tag+size
// prefix (8 bytes) — confirmed by walking the file's 3-hunk table
// (CODE/DATA/BSS) directly, not assumed.
// ---------------------------------------------------------------------------

const P3_ITEM_NAME_TABLE_OFFSET = 0x466c;
const P3_ITEM_NAME_COUNT = 181;

const P3_SPELL_NAME_TABLE_OFFSET = 0x4e74;
const P3_SPELL_NAME_COUNT = 58; // index 0 is the "0" empty-slot placeholder

const P3_RACE_NAME_POINTER_TABLE_OFFSET = 0x28e84;
const P3_RACE_NAME_COUNT = 18;
const P3_HUNK0_DATA_START = 0x28;

function readSequentialCStrings(data: Uint8Array, offset: number, count: number): string[] {
  const names: string[] = [];
  let pos = offset;
  for (let i = 0; i < count; i++) {
    const name = readCString(data, pos);
    names.push(name);
    pos += name.length + 1; // + NUL terminator
  }
  return names;
}

/**
 * 181 sequential NUL-terminated item names (data-tables.md §3.1). Index 0 is
 * the single-character `"0"` empty-item-slot placeholder (P3's equivalent of
 * P1/P2's `"NOTHING"`).
 */
export function readP3ItemNames(exe: Uint8Array): string[] {
  return readSequentialCStrings(exe, P3_ITEM_NAME_TABLE_OFFSET, P3_ITEM_NAME_COUNT);
}

/**
 * 58 sequential NUL-terminated spell names (data-tables.md §3.1), immediately
 * following the item name table. Index 0 is the `"0"` empty/no-spell
 * placeholder; indices 1-57 are real spells. Confirmed against
 * `monsinfo.dat`'s `spell1`/`spell2`/`spell3` fields (0 out-of-range across
 * all 80 monsters, and every spellcasting monster resolves to a
 * thematically-plausible spell, e.g. `Wizard` → Fireflash/Weakness/Healing).
 */
export function readP3SpellNames(exe: Uint8Array): string[] {
  return readSequentialCStrings(exe, P3_SPELL_NAME_TABLE_OFFSET, P3_SPELL_NAME_COUNT);
}

/**
 * 18 race names (data-tables.md §4), resolved through a pointer table at
 * `0x28e84` — 18 big-endian `u32` hunk-0-relative string offsets, found via
 * `HUNK_RELOC32` cross-reference from the string block itself (grepped for
 * `"Human"`/`"Dwarven"` etc.). Order: Human, Dwarven, Elven, Gnome,
 * Halfling, Random (a character-creation "assign me a random race" menu
 * option, not a playable race with its own sprite — RacesManagerP3's
 * `Count = 18` includes it), Gnoll, Goblin, Kobold, Lizard Man, Minotaur,
 * Ogre, Orc, Pixie, Sprite, Troll, Elemental, Undead.
 */
export function readP3RaceNames(exe: Uint8Array): string[] {
  const names: string[] = [];
  for (let i = 0; i < P3_RACE_NAME_COUNT; i++) {
    const ptr = r32(exe, P3_RACE_NAME_POINTER_TABLE_OFFSET + i * 4, 'be');
    names.push(readCString(exe, P3_HUNK0_DATA_START + ptr));
  }
  return names;
}

/**
 * Per-race sprite-cell index table (data-tables.md §4.2), 19 bytes at file
 * offset `0x299d8` (hunk 1 `+0x2110`). Each entry is `bankSpriteIndex * 2`
 * — i.e. the *even* (idle-pose) cell index into bank 0 (`heros.cmp`,
 * 32x48, 10x4 grid); the attacking pose is the cell immediately to its
 * right, `value + 1`.
 *
 * Located by disassembling the party-sprite cell extractor at file
 * `0x1b2da`, which computes, for party slot `s` and pose `p`:
 * `v = table[raceValue[s]]; srcY = (v / 10) * 48; srcX = ((v % 10) + p) *
 * 32`. Note the row is taken from `v / 10` and the column from
 * `(v % 10) + p` — the pose pair always stays on one row, so it is *not*
 * simply `(v + p)` fed through the generic grid formula (all stored values
 * are even and `v % 10 <= 8`, so the two agree in practice).
 *
 * Indices 0-17 are the 18 `readP3RaceNames()` entries; index 18 is a
 * non-race "dead adventurer" marker (cell 24 renders as a gravestone).
 * This is emphatically **not** an identity mapping: several races share a
 * cell (Gnome/Halfling, Pixie/Sprite, Goblin/Kobold/Orc, Gnoll/Ogre).
 */
const P3_RACE_SPRITE_INDEX_TABLE_OFFSET = 0x299d8;
const P3_RACE_SPRITE_INDEX_COUNT = 19;

export function readP3RaceSpriteCells(exe: Uint8Array): number[] {
  const cells: number[] = [];
  for (let i = 0; i < P3_RACE_SPRITE_INDEX_COUNT; i++) {
    cells.push(exe[P3_RACE_SPRITE_INDEX_TABLE_OFFSET + i]);
  }
  return cells;
}

/** One combat-equipment row: the manual's "Point Value" and "Attributes Required". */
export interface P3ItemStats {
  /** Point value — the item's combat rating (armour value / weapon damage die). */
  pointValue: number;
  /**
   * Attribute requirement. Compared against `Strength` (ids 1-40),
   * `Strength + Dexterity` (ids 41-60, bows) or `2 x Strength + Dexterity`
   * (ids 61-100, melee weapons); an item the character cannot meet shows
   * as `N/A` in the armoury listing.
   */
  attributesRequired: number;
}

/**
 * Per-item combat-equipment stats (data-tables.md §7), two parallel 101-byte
 * byte tables at file `0x287d8` (hunk 1 `+0x0f10`, point value) and
 * `0x2883d` (`+0x0f75`, attribute requirement), both indexed by item id
 * `0..100`. Item 0 is the empty-slot placeholder; ids 101+ (potions,
 * scrolls, valuables) are not combat equipment and carry no row.
 *
 * Verified byte-exact against the SSI 1987 rule book's own Shields / Armor /
 * Bows / Melee Weapons tables (pages 17-18): 200/200 values, 0 mismatches.
 */
const P3_ITEM_POINT_VALUE_TABLE_OFFSET = 0x287d8;
const P3_ITEM_ATTR_REQ_TABLE_OFFSET = 0x2883d;
const P3_ITEM_STATS_COUNT = 101;

export function readP3ItemStats(exe: Uint8Array): P3ItemStats[] {
  const stats: P3ItemStats[] = [];
  for (let i = 0; i < P3_ITEM_STATS_COUNT; i++) {
    stats.push({
      pointValue: exe[P3_ITEM_POINT_VALUE_TABLE_OFFSET + i],
      attributesRequired: exe[P3_ITEM_ATTR_REQ_TABLE_OFFSET + i],
    });
  }
  return stats;
}

/**
 * Base (pre-markup) item prices in gold (data-tables.md §7), 181 big-endian
 * words at file `0x288a2` (hunk 1 `+0x0fda`), indexed by item id. The
 * armoury charges `basePrice * shopMarkup[shop] / 100`, using
 * `readP3ShopMarkups()`.
 *
 * The table's extent is byte-exact: `0x0fda + 181 * 2 = 0x1144`, precisely
 * where the 18-entry shop markup table begins.
 */
const P3_ITEM_PRICE_TABLE_OFFSET = 0x288a2;
const P3_ITEM_PRICE_COUNT = 181;

export function readP3ItemPrices(exe: Uint8Array): number[] {
  const prices: number[] = [];
  for (let i = 0; i < P3_ITEM_PRICE_COUNT; i++) {
    prices.push(r16(exe, P3_ITEM_PRICE_TABLE_OFFSET + i * 2, 'be'));
  }
  return prices;
}

/**
 * Per-armoury price markup, as a percentage (data-tables.md §7): 18
 * big-endian words at file `0x28a0c` (hunk 1 `+0x1144`), indexed by the
 * same armoury index that indexes `inititem.dat`'s 181-byte stock rows.
 */
const P3_SHOP_MARKUP_TABLE_OFFSET = 0x28a0c;
const P3_SHOP_COUNT = 18;

export function readP3ShopMarkups(exe: Uint8Array): number[] {
  const markups: number[] = [];
  for (let i = 0; i < P3_SHOP_COUNT; i++) {
    markups.push(r16(exe, P3_SHOP_MARKUP_TABLE_OFFSET + i * 2, 'be'));
  }
  return markups;
}
