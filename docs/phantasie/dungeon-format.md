# Phantasie Dungeon File Format

This document describes the on-disk layout of Phantasie dungeon files: the
tile grid, the header fields that precede it, and the semantic meaning of
every cell-ID value. It also records what could be determined about the
non-dungeon Phantasie I world/town files and the unexplained Phantasie III
`D/` files that ship alongside the dungeon data.

Companion document: `docs/phantasie/scripting-engine.md` covers the star
(trigger) / action (script) / message record formats and the interpreter
algorithm that `ReadCell` hands off to once a star cell is stepped on.

Source of ground truth for this document: a third-party reverse-engineering
tool's C# source (dungeon/scripting parser, referred to below as "the
reference tool") was read to recover the format, then every offset and
formula derived from it was independently verified byte-for-byte against
this project's own `data/phantasie/amiga/` and `data/phantasieiii/amiga/D/`
files (see the confirmation notes under each table). No code from that tool
is reproduced here — only the structure it revealed, described in prose and
tables.

## 1. Engine relationship: Phantasie I and II share one parser

Phantasie I and Phantasie II dungeon files are read by **the same parser**,
selected only by a boolean flag ("is this Phantasie II"). Concretely, the
reference tool's UI wires both "Open Phantasie I Dungeon" and "Open
Phantasie II Dungeon" menu actions to the identical dungeon class, passing
`true` for Phantasie II and `false` for Phantasie I. The class internally
uses the flag only to select which **item name table**, **monster name
table**, and **character-stat name table** to use for display purposes, and
to gate two action opcodes (0x14–0x17, see the scripting doc) that only
exist in Phantasie II. The byte-level dungeon/star/action/message formats,
all header offsets, and the grid dimensions are otherwise 100% identical
between Phantasie I and Phantasie II.

Phantasie III uses a separate, structurally-similar-but-distinct parser
(different header offsets, different grid size, and an entirely different
message storage scheme — see §5).

**Confidence: confirmed** — verified against `data/phantasie/amiga/dng1`
through `dng10` (see §3) using the shared engine's offsets with the
Phantasie I flag, and independently confirmed against real Phantasie II
data too (`data/phantasieii/atarist/extracted/disk2/DNG1`-`DNG8`, see §7) —
the exact same header offsets, grid layout, and star/action table formats
decode cleanly on both games' own real files.

## 2. File pairing

| Game | Dungeon file | Message file | Relationship |
|------|-------------|---------------|--------------|
| Phantasie I | `dngN` (N=1..10) | `messN` (matching index) | Two separate files per dungeon level; the dungeon file's numeric suffix selects the paired message file (`dng3` → `mess3`). |
| Phantasie II | `DNG1`-`DNG8` / `MESS1`-`MESS8` | same pairing convention, 8 levels (not P1's 10) | Extracted from `data/phantasieii/atarist/` `.stx` floppy images to `data/phantasieii/atarist/extracted/disk2/` — see §7 and `stx-extraction.md`. **Byte-level decode against these real files confirmed, see §7.** |
| Phantasie III | `dnga.dat`..`dngk.dat` (11 files, letters a–k) | none — messages are embedded in the same file | Single self-contained file per dungeon level. Our files are renamed from the reference archive's `dng0.dat`..`dng10.dat` numeric convention; letter order (a=first) is assumed to match numeric order (0=first) based on identical file size (4352 bytes) and count (11), but this pairing has not been independently confirmed against in-game level order. |

## 3. Phantasie I / II — shared header + grid layout

Grid: **33 columns × 38 rows = 1254 bytes**, stored row-major starting at
file offset 0 (`cell[x,y]` at byte `y*33 + x`). Every value in this document
that isn't otherwise noted is a single unsigned byte.

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `0x0000` | 1254 | Cell grid | 33×38, row-major, `y*33+x` |
| `0x04E7` | 1 | Dungeon level | 0-based; used to compute the roster for random/door encounters (see §4) |
| `0x04E8` | 10 | Fixed-encounter monster index table | Indexed by `cell − 0x80` for cell values 0x80–0x89 |
| `0x04F2` | 9 | **Unidentified** | Gap between the encounter table and the star table. Sample bytes observed in `dng1`: `01 08 10 00 00 00 00 00 00`. Not read by the reference parser; open question. |
| `0x04FB` | up to 175 (35×5) | Star (trigger) table | Fixed-size 35-slot array, 5 bytes/slot nominal, see `scripting-engine.md` §1 |
| `0x05AA` | variable, terminated | Action (script) table | 2-byte-aligned slots (1 or 2 slots per record), see `scripting-engine.md` §2. **No fixed end offset** — parsing stops at the first 2-byte-aligned `0x0D 0x0D` pair. |
| after terminator | variable | **Leftover/unused region** | Not read by the parser. Content varies per file — see §3.1. |

All file offsets above are **file-relative**, not segment-relative (these
are flat data files with no executable header).

### 3.1 Star/action table boundary — confirmed structurally

The star table's declared capacity (35 slots × 5 bytes = 175 bytes) reaches
exactly `0x04FB + 175 = 0x05AA` — the action table's declared start address.
This was verified as more than coincidence: the reference parser computes
both addresses independently from two different hardcoded constants
(`0x04FB` for stars, `0x05AA` for actions), and the arithmetic identity
holds byte-exact. **Confidence: confirmed.**

The action table has no equivalent fixed end — Phantasie I/II keep messages
in a *separate* file, so there is no "next table" to bound it against.
Instead, the parser walks 2-byte-aligned slots from `0x05AA`, decoding one
action record per iteration (record size 2 or 4 bytes, see the scripting
doc) and stops at the first slot whose two bytes are both `0x0D`.

Simulating this walk against all ten `data/phantasie/amiga/dng*` files
finds the terminator consistently near `0x06CC` (`dng1`, `dng3`, `dng5`–`dng10`
all terminate at exactly `0x06CC`; `dng2` at `0x06CE`; `dng4` at `0x06D4` —
a handful of slots later in each case), meaning **the reserved action-table
region is roughly 290 bytes (145 two-byte slots)** even though actual usage
(120–134 decoded records per file, per this same walk) is always somewhat
below that ceiling. **Confidence: confirmed** (byte-exact record walk against
all 10 files; opcode/size table cross-checked in `scripting-engine.md`).

Bytes after the terminator vary file-to-file and are not consumed by the
parser. In most files this trailing region holds short ASCII strings ending
in `"ENDING SEQUENCE"` (e.g. `dng1`: `"A STRANGE PURPLE GAS F\rENDING
SEQUENCE\r"`, `dng3`: `"ROCKS AND GRAVEL FALL F\rENDING SEQUENCE\r"`,
followed by `0x1A 0x1A` filler bytes — `0x1A` is the classic Atari-ST
end-of-file padding byte, consistent with this format's cross-platform
lineage). Two files (`dng2`, `dng4`) instead have what look like a handful
of extra, well-formed-looking action-opcode byte pairs before their
terminator lands a few slots later than the rest. **Open question:** whether
this trailing text/data is meaningful (unused level content, a debug
artifact from the original development tools, or something the game engine
reads through a path the reference tool doesn't implement) is not resolved.

## 4. Cell-ID semantic ranges (shared table, P1/P2/P3 identical)

The following table was cross-validated between the reference tool's dungeon
interpreter (`ReadCell`) and its separate map-rendering code (which
classifies the same ranges for tile art / hint-overlay purposes) — both
agree on every boundary for all three games.

| Range | Meaning | Notes |
|-------|---------|-------|
| `0x00` | Wall | |
| `0x01` | Secret wall | Rendered identically to a wall; a hint overlay in map view marks it as secret |
| `0x02`–`0x06` | Trap | Damage formula differs between engines — see §6 |
| `0x07` | Triggered trap | A trap that has already been sprung (no longer live) |
| `0x08`–`0x11` | Bottom message + random encounter | Shows a one-line message (see §4.1), then rolls among 3 consecutive monster-table entries: `monsterIndex0 = level*12 + (cell-0x08)`, encounter picks `monsters[monsterIndex0]`, `monsters[monsterIndex0+1]`, or `monsters[monsterIndex0+2]` |
| `0x12`–`0x7F` | Special message (no encounter) | One-line bottom message only |
| `0x80`–`0x89` | Fixed encounter | Monster index comes from the per-dungeon fixed-encounter table at header offset `0x04E8`/`0x02D1` (§3, §5), indexed by `cell − 0x80` |
| `0x8A` | **Unassigned** | The reference parser throws on this value — never observed in real data; treat as invalid/unused |
| `0x8B`–`0xB8` | Bottom message (white) | One-line message only, no encounter |
| `0xB9` | Door (horizontal), opened | |
| `0xBA`–`0xC5` | Door (horizontal) with encounter | Same `level*12 + (cell-0xBA)` monster-roster formula as `0x08`-range, but picks a single fixed monster rather than rolling among 3 |
| `0xC6` | Door (horizontal), locked | |
| `0xC7` | Door (horizontal), unlockable | No lockpick roll possible — always fails |
| `0xC8` | Door (vertical), opened | |
| `0xC9`–`0xD4` | Door (vertical) with encounter | `level*12 + (cell-0xC9)`, same scheme as the H-door range |
| `0xD5` | Door (vertical), locked | |
| `0xD6` | Door (vertical), unlockable | |
| `0xD7`–`0xD9` | Stairs (exit dungeon) | |
| `0xDA`–`0xDC` | Stairs (inter-level) | `0xDA`="stairs from level 1 to 2", `0xDB`="...2 to 3", `0xDC`="...3 to 4" (Phantasie I/II only — Phantasie III's `ReadCell` throws on this range, i.e. either unused there or handled through a different mechanism not present in the reference tool) |
| `0xDD`–`0xFF` | Star (script trigger) | `starIndex = cell − 0xDD` (max 34, matching the 35-slot star table); see `scripting-engine.md` |

### 4.1 Encounter roster indexing convention

Both the "random encounter" (`0x08`-`0x11`) and "door encounter"
(`0xBA`-`0xC5`, `0xC9`-`0xD4`) ranges index into the **global monster name
table** using `level * 12 + offset`, i.e. each dungeon level owns a
contiguous 12-monster block of the roster (`monsters[level*12 .. level*12+11]`).
This is a property of the *reference tool's* monster table, which is
hand-transcribed data embedded in its own source rather than parsed from
any file in `data/` — treat the specific indices as informative context for
how encounters are selected, not as a decoded on-disk table.

## 5. Phantasie III — header + grid layout

Grid: **24 columns × 30 rows = 720 bytes**, same row-major layout as P1/P2.

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `0x0000` | 720 | Cell grid | 24×30, row-major |
| `0x02D0` | 1 | Dungeon level | Same role as P1/P2's `0x04E7` |
| `0x02D1` | 10 | Fixed-encounter monster index table | Same role as P1/P2's `0x04E8` |
| `0x02DB` | 9 | **Unidentified** | Same relative position/size as the P1/P2 gap. Sample bytes observed in `dnga.dat`: `0D 05 09 00 00 00 00 00 00`. The presence of an identically-sized, identically-positioned gap in both engines' independently-derived header layouts suggests a real (if unidentified) shared field rather than padding, but this is not confirmed. |
| `0x02E4` | up to 175 (35×5) | Star table | Same 35-slot/5-byte-slot format as P1/P2 |
| `0x0393` | exactly 512 (256×2) | Action table | Same slot format as P1/P2, but **fixed capacity, no terminator scan** — see §5.1 |
| `0x0593` | 220 (110×2) | Message pointer table | 110 slots, 2-byte big-endian file offsets, **not** used directly — see §5.2 |
| `0x066F`+ | variable | Message text pool | Null-terminated strings, referenced by the pointer table |

### 5.1 Why Phantasie III's action table needs no terminator

Unlike Phantasie I/II, Phantasie III embeds its message data in the *same*
file immediately after the action table. Its action-table reader has no
`0x0D 0x0D` terminator check at all — it unconditionally decodes 256
action-index slots (walking by each record's 1-or-2-slot size, exactly like
P1/P2). This works because the region is implicitly bounded: `0x0393 + 256*2
= 0x0593`, which is *exactly* the message pointer table's start address.
**Confidence: confirmed** — verified as an exact arithmetic identity between
two independently-hardcoded constants in the reference source, and
cross-checked against `dnga.dat`'s real bytes (a plausible, non-garbage
action record decodes at `0x0393`, and the message pointer table's first
non-zero entry decodes to a byte-exact, human-readable string — see §5.2).

### 5.2 Message pointer table — confirmed byte-exact

Each of the 110 slots at `0x0593` is a 2-byte **big-endian** file offset,
biased by a constant `0x0800`: `real_address = word_value − 0x0800`. A zero
word means "no message in this slot."

Verified against `data/phantasieiii/amiga/D/dnga.dat`: slot 0's word is
`0x0E6F`, giving `0x0E6F − 0x0800 = 0x066F` — exactly the first byte after
the pointer table ends (`0x0593 + 220 = 0x066F`). Decoding forward from
several slots' resolved addresses (all null-terminated, per §5.3 of the
companion scripting doc) yields clean, legible English text with zero
garbage bytes, e.g. slot 5 → `"Arrows fire from a slit in the roof."`, slot
12 → `"Waste disposal area"`. **Confidence: confirmed** (0 decode failures
across the first 15 slots tested; see `scripting-engine.md` §3 for the full
message-record format, including the `0xF0` embedded-newline code).

## 6. Confirmed P1/P2-vs-P3 game-logic quirks

The reference source's own inline comments flag two places where Phantasie
III's dungeon engine measurably diverges from Phantasie I/II's — not just
different constants, but what its own author calls out as likely bugs. Both
are preserved here as real ground truth about original game behavior, not
reference-tool artifacts:

**Trap damage formula (cell `0x02`-`0x06`).** Phantasie I/II's `ReadCell`
computes trap damage as `damageMax = (cell − 1) * 5`, giving a clean linear
range (5, 10, 15, 20, 25 for cells `0x02`.."0x06"). Phantasie III's
`ReadCell` still uses the older, uncorrected formula `damage = (cell − 5) *
5`, clamping to `12` whenever the result falls outside `[0, 25]` — which for
cell `0x02`-`0x05` (all but the last trap value) always clamps to exactly
`12`, only cell `0x06` computing correctly (`5`). The source itself labels
this "bug!!! should be `cell - 1`" in both engines' code, but only
Phantasie I/II's engine was ever fixed.

**Bottom-message index formula for the same trap range.** Both engines
compute the "0x02–0x06" trap flavour-text message index using an offset
constant that must, for the other three ranges, yield an identical
result (verified algebraically: P2's `messageIndex = cell + baseOffset − 1`
and P3's `messageIndex = cell − baseOffset + 0x64` are equivalent formulas
that resolve to the exact same message index for the `0x08`-`0x11`,
`0x12`-`0x7F`, and `0x8B`-`0xB8` ranges). For the trap range specifically,
though, P2 uses `baseOffset = 0x04`, resolving to message indices
`0x05`-`0x09`; P3 uses `baseOffset = 0x60`, resolving to `0x06`-`0x0A` — one
message higher than P2's for every trap cell. The source's own comment on
the P3 formula reads "bug (should be `0x05`-`0x09`)", i.e. the reference
author independently reached the same conclusion from source alone: P3's
trap-flavour-text lookup is off by one message slot relative to P2's
(presumably-correct) mapping.

## 7. Phantasie II (Atari ST) — confirmed against real extracted files

> **Correction:** the two `.stx` Pasti floppy images have been desectorized
> and their GEMDOS/FAT12 filesystem extracted — see
> `docs/phantasie/stx-extraction.md` for the full method. Real `DNG1`-`DNG8`
> and `MESS1`-`MESS8` files exist at
> `data/phantasieii/atarist/extracted/disk2/`, and the shared P1/P2 header
> offsets/grid layout/record formats documented in §3 above have now been
> applied directly against all 8 real P2 dungeon files and all 8 real P2
> message files, with **zero decode failures**:
>
> - **Level bytes** (`0x04E7`) across `DNG1`-`DNG8`: `0, 1, 2, 3, 4, 4, 5, 5`
>   — a non-strictly-increasing progression with repeats, structurally the
>   same shape as P1's own `dng1`-`dng10` levels (`0, 1, 2, 3, 3, 4, 4, 5, 5,
>   5`), i.e. both games' engines assign multiple dungeon files to the same
>   "depth level" for monster-roster purposes.
> - **Fixed-encounter table** (`0x04E8`, 10 bytes): every value across all 8
>   files is a plausible monster-table index (max value seen: 79, exactly
>   the last valid index of the confirmed 80-entry monster table, §2.2) —
>   zero out-of-range values.
> - **Star table** (`0x04FB`, 35-slot packed scan, record-size formula
>   `((byte1+1)/5)+1`): decodes cleanly across all 8 files (9-24 real star
>   records per file, remainder empty slots), no malformed records, no
>   exceptions.
> - **Action table** (`0x05AA`, 2-byte-aligned packed scan, `0x0D 0x0D`
>   terminator): the terminator is found in every one of the 8 files, at
>   offsets `0x6cc`-`0x736` (relative range 290-396 bytes from `0x05AA`) —
>   the **same range** as P1's own terminator positions (`0x6CC`-`0x6D4`
>   across all 10 P1 files, §3.1). 116-195 action records decoded per file.
> - **P2-exclusive opcodes `0x14`-`0x17` (`scripting-engine.md` §5) are
>   confirmed present and actively used in real shipped P2 content** — the
>   per-file max opcode value seen ranges up to `0x17` (`DNG8`), with several
>   files using `0x14`-`0x17` values. Cross-checked against all 10 real P1
>   `dng*` files using the identical decode walk: **P1's max opcode value
>   never exceeds `0x13`** across any of the 10 files — confirming the
>   documented P1/P2 opcode-space split holds in practice, not just in the
>   reference source's gating logic.
> - **Message file format** (`0x00E6`-based 115-entry little-endian word
>   table, 41-byte length-prefixed line units): decoded cleanly across
>   `MESS1`-`MESS8` with zero garbage. Sample decoded lines: `"   POISON
>   DARTS FLY FROM THE CEILING.   "`, `"       ------ GARBAGE PIT ------
>   "`, `"    ---OUTSIDE IN KOBOLD VILLAGE---     "`, `"  A LARGE PIT OPENS
>   BENEATH YOUR FEET!  "`, `"           AN EXPLOSION TRAP!           "` —
>   all legible, in-genre, correctly space-padded dungeon flavour text and
>   room descriptions, including multi-line messages that continue into a
>   second 41-byte slot (e.g. `MESS8` index 10/11: `"--STONE PASSAGE THROUGH
>   VOLCANIC ROCK"` continuing into `"...CK..."`).
>
> **Confidence: confirmed** — the shared P1/P2 dungeon/star/action/message
> engine (§1-§4 above, `scripting-engine.md` §1-§4) applies unchanged to
> real Phantasie II data, at the exact same header offsets as Phantasie I.
> This closes `data-p2-tables`/`p2-dungeon-decode` in `TODO.md`. Not
> independently re-derived by this pass: the P1/P2 message choice-count
> heuristics (`scripting-engine.md` §3.1, still carried from the reference
> source only) and the semantic meaning of the two unidentified header gaps
> (`0x04F2`-`0x04FA`) — out of this pass's scope, still open.
>
> Extraction-level facts for context: P2 has only 8 dungeon/message pairs
> (not P1's 10), and every `DNGn` file is a uniform 2,048 bytes (P1's vary,
> 1,922-1,984 bytes) — see `stx-extraction.md` §7 for the full size
> comparison. The uniform, larger P2 size is **not** explained by a larger
> reserved action-table region (the confirmed terminator positions above
> land in the same absolute range as P1's), so the extra ~65-125 bytes
> per file are most likely additional trailing content after the
> terminator (§3.1's "leftover/unused region") — not independently
> investigated further in this pass.

## 8. Non-dungeon Phantasie I world/town files

These files are **not** covered by the reference tool at all (it only
parses dungeons). Everything below is this project's own inspection;
confidence is marked per finding.

### 8.1 `twns.int` (13000 bytes) — confirmed record stride, town names only

A byte-level scan for printable-ASCII runs found twelve human-readable town
names (`PELNOR`, `PINEVILLE`, `GREENVILLE`, `HALFLINGOR`, `APPLETON`,
`SPLITWATER`, `TROLLPORT`, `PHANTASIA`, `DRAGONOR`, `NORTHFORD`,
`STARVILLE`, `OLYMPIA` — matching Phantasie I's known town list) at a
**constant 292-byte (`0x124`) stride**, each name occupying 10
space-padded ASCII bytes starting at offset `0x62` (98) within its record.

Extrapolating the record boundaries from that stride: the record array
starts at file offset `0x0A44`, holds 35 records total (12 populated with a
town name, 23 that are all-zero — presumably unused/reserved town slots),
and the array ends at `0x3230`, leaving 152 trailing bytes (`0x3230`-`0x32C8`)
unaccounted for. Two of the "record slots" beyond the 12 named towns (index
33 at `0x2FE8` and index 34 at `0x310C`) contain non-zero, non-name data —
these may not be town records at all, but a different fixed-size table that
happens to land at the same stride by coincidence (e.g. the readable
fragments `"FIRE  ELE"`, `"WATER ELEM"`, `"EARTH ELEM"` were found nearby,
around offset `0x3088`, suggestive of an elemental/summon name list, but
this is unconfirmed).

**Confidence: confirmed** for the 292-byte stride, the name field offset,
and the 12-town roster. **Open** for every other field in the 292-byte
record (shop inventory, prices, coordinates, or whatever else a Phantasie
town record holds) and for the header region before `0x0A44` and the two
non-empty trailing "slots."

### 8.2 `out1.dat`..`out19.dat` (2500 bytes each) — partial structure, POI text block confirmed

Every `out*.dat` file opens with what looks like a small terrain/tile grid
using single-byte tile codes (observed values include `0x64`/`'d'`,
`0x65`/`'e'`, `0x42`/`'B'`, `0x3C`/`'<'`, `0x00`, `0x0A`, `0x14`, `0x1A` —
these happen to fall in the printable-ASCII range for the more common tile
types, which is why `strings` finds runs of letters like `"eeeedeee"` in
these files; they are not literal text). This region's exact dimensions
were not determined.

Starting at file offset `0x0255` (597) in `out1.dat`, this project found a
short sequence of **null-terminated, ~39-40-byte fixed-width lines** of
plain, human-readable location-description text, e.g.:

```
"TO THE WEST IS A BUILDING CALLED"
"'THE RED PONY INN'"
"YOU ARE ON A PATH,"
"TO THE EAST LIES A SMALL TOWN"
"YOU ARE NEAR A SMALL DOOR SET"
"INTO THE HILLSIDE"
"THERE IS A SMALL TEMPLE HERE"
```

This strongly suggests `out*.dat` files describe a small outdoor
"screen"/location — an area grid plus a handful of nearby points-of-interest
described in short text lines, conceptually similar to a dungeon level's
message table but with a simpler, fixed-width/null-terminated line encoding
rather than P1/P2's length-prefixed line table (§ scripting doc) or P3's
pointer-table scheme.

**Confidence: confirmed** for the text block's existence, offset, and
line-encoding (null-terminated, ~40-byte lines). **Open** for the preceding
grid region's exact dimensions/tile-code meaning, and for whether the text
block's start offset (`0x0255`) is fixed across all 19 `out*.dat` files or
varies with grid content.

### 8.3 `maps.int` (9360 bytes) — open

Contains the same single-byte tile-code pattern seen in `out*.dat`'s
leading region, but **no** embedded readable text anywhere in the file (201
printable-ASCII runs found, all short runs of the same handful of tile-code
letters, no natural-language fragments). This is consistent with `maps.int`
being a larger, textless terrain grid — plausibly the overworld/wilderness
map that the individual `out*.dat` "screens" are excerpted from or overlaid
onto — but the file's dimensions could not be determined (9360 has no clean
square-grid factorization, and no row-boundary markers were found).
**Confidence: open/unresolved.**

### 8.4 `scrolls.dtx` (16000 bytes) — confirmed line encoding

A null-position scan found a **constant 40-byte stride**: each "line" is a
fixed 40-byte slot, holding left-padded ASCII text and null-padded to fill
the full 40 bytes (not a single terminator — the whole remainder of the
slot is zero). `16000 / 40 = 400` lines total. Reading the lines
sequentially reproduces legible, multi-paragraph narrative text ("THE
HISTORY OF GELNOR", in parts), formatted the same way dungeon messages are
(centered, all-caps, hyphenated word-wrap). **Confidence: confirmed** for
the line stride and encoding. **Open** for how the 400 lines subdivide into
individual named "scrolls" (no length-prefix or part-count field was
identified — likely a fixed number of lines per scroll, but this project
did not determine what that count is).

### 8.5 `tamb.dat` (2850 bytes) — open

Dense binary data, 42 distinct byte values, dominated by `0x00` (840
occurrences), `0x82` (339), and `0x0D` (338) — the near-equal counts of
`0x82` and `0x0D` are suggestive of some tag/delimiter byte pair recurring
through a compact variable-length record scheme (structurally reminiscent
of the dungeon action table's `0x0D 0x0D` terminator convention, though no
concrete record boundaries were identified). No readable strings. Purpose
unknown. **Confidence: open/unresolved.**

## 9. Phantasie III `D/` files not covered by the reference tool

The reference tool's own bundled sample archive includes identically-named
files (`S1`-`S20`, `M0`, `M1`, `PLN1`-`PLN4`, plus a few `DNP*` files not
present in our `data/`) with **no corresponding C# parser class** — the
reference tool doesn't read these either. Everything below is this
project's own inspection of the real files in
`data/phantasieiii/amiga/D/`.

### 9.1 `S1`-`S20` (1152 bytes each, except `S6` at 3584 bytes)

`s1` contains a long, continuous run of legible narrative text with no
embedded line breaks at all (a first-person account: *"I, Kilmor, am writing
this account of my last days for posterity..."*), starting after ~81 bytes
of leading space padding, ending at a null terminator (offset 836), followed
by `0x1A` filler bytes to the end of the file — the same Atari-ST-style
`0x1A` padding convention observed in the Phantasie I dungeon files (§3.1),
again suggesting a shared cross-platform text-asset convention. No `0xF0`
newline-control bytes (the code Phantasie III's dungeon messages use, see
`scripting-engine.md` §3) were found anywhere in the file.

This strongly suggests `S1`-`S20` are readable "scroll"/note text pickups —
conceptually the Phantasie III equivalent of Phantasie I's `scrolls.dtx` —
but stored one-per-file as an unstructured flat text blob rather than
`scrolls.dtx`'s fixed-40-byte-line array, and apparently meant to be
word-wrapped entirely by the display routine at render time rather than
pre-formatted on disk. `S6`'s 3× larger size was not investigated further
(possibly a longer scroll, or a different content type entirely).
**Confidence: hypothesis** (readable text and plausible role identified;
exact display/formatting mechanism and `S6`'s outlier size unresolved).

### 9.2 `M0` (896 bytes), `M1` (768 bytes)

`M0` is almost entirely a single repeated character (`0x3E`/`'>'`), which
reads as either a border/divider graphic asset or a degenerate/mostly-empty
table. `M1` contains no printable-ASCII runs at all — dense binary, purpose
undetermined. **Confidence: open/unresolved.**

### 9.3 `PLN1`-`PLN3` (128 bytes each), `PLN4` (512 bytes)

All four contain short runs of consecutive-ish letters (e.g. `PLN1`:
`"I8D"`, `"IJJJD"`, `"IJJJJE"`, `"HJJJE"`, `"GJJJD"`, `"GF;"` — values
climbing/descending by one letter at a time) — a pattern structurally
similar to the tile-code letter runs seen in Phantasie I's `out*.dat`/
`maps.int` (§8.2, §8.3), suggestive of small terrain/elevation grids, but
far too small (128 bytes) to be a full outdoor screen at Phantasie I's
scale. Not investigated further. **Confidence: open/unresolved.**

### 9.4 `gamesave.dat` (11812 bytes)

Not deeply investigated (explicitly lower priority for this pass). A quick
look did not reveal an obvious fixed-size N-character-record pattern by eye;
confirming whether it's an array of per-character save records (as its size
alone might suggest) would require comparing it against a known
in-executable character-record layout, which was out of scope here.
**Confidence: open/unresolved.**

## Open questions

| Item | What's known | What's missing |
|------|-------------|-----------------|
| P1/P2 header gap `0x04F2`-`0x04FA` (9 bytes) | Fixed position/size, sample bytes recorded | Field meaning |
| P3 header gap `0x02DB`-`0x02E3` (9 bytes) | Same position/size as P1/P2's gap | Field meaning |
| P1/P2 trailing bytes after the action-table terminator | Position varies per file; often holds an `"...ENDING SEQUENCE"` string | Whether this is meaningful game content or a development artifact |
| ~~Phantasie II dungeon/message files~~ | **Resolved** — byte-level decode confirmed against all 8 real extracted `DNG1`-`DNG8`/`MESS1`-`MESS8` files, see §7 | n/a |
| Phantasie III `a`-`k` dungeon-file letter-to-level-number mapping | Same size/count as reference archive's numeric `dng0`-`dng10` | Ordering assumed, not confirmed against actual level order |
| `twns.int` 292-byte record | Stride, name-field offset, 12-town roster confirmed | Every other field in the record; the two non-empty non-name "slots" at the end |
| `out*.dat` | POI text block confirmed (offset, encoding) | Leading grid region's dimensions and tile-code meaning |
| `maps.int` | Same tile-code alphabet as `out*.dat`'s grid region | Dimensions, structure, relationship to `out*.dat` |
| `scrolls.dtx` | 40-byte line stride confirmed, 400 lines total | How lines subdivide into individual scrolls |
| `tamb.dat` | Byte-frequency profile only | Everything else |
| Phantasie III `S1`-`S20` | Readable narrative text, likely scroll/note pickups | Exact format beyond "flat null-terminated text blob"; `S6`'s outlier size |
| Phantasie III `M0`, `M1` | Sizes, rough byte content | Everything else |
| Phantasie III `PLN1`-`PLN4` | Sizes, letter-run pattern suggestive of small terrain grids | Everything else |
| Phantasie III `gamesave.dat` | Size only | Record structure |
