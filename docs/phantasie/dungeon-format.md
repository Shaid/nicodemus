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

### 8.2 `out1.dat`..`out19.dat` (2500 bytes each) — layout confirmed

> **Correction (2026-08-10):** an earlier version of this section described
> the file as "a terrain grid of unknown dimensions followed by a POI text
> block starting at `0x0255` (597)". Both the grid dimensions and the text
> offset are now settled, and the text offset was off by two: the 40-byte
> line array begins at **`0x0253` (595)**, not `0x0255`. `0x0255` was the
> first *letter* of `out1.dat`'s first line, which is centred and therefore
> has two leading spaces. Between the grid and the text sits a previously
> unnoticed **15 × 5-byte point-of-interest record table**.

Every `out*.dat` file is a fixed 2,500-byte record laid out as follows. The
loader reads all 2,500 bytes in **one** `Read()` into a single
`AllocMem(2500, 0)` buffer (`game+0x16F0A`) and every consumer indexes that
buffer directly, so file offsets and buffer offsets are the same thing:

| Offset | Size | Region | Reader | Confidence |
|--------|------|--------|--------|-----------|
| `0x0000` | 520 | Terrain grid, **20 wide × 26 tall**, one byte per tile | `GetTile` `game+0x16C7C` | **confirmed** |
| `0x0208` | 75 | Point-of-interest table — **15 records × 5 bytes** | `game+0x18340` | **confirmed** |
| `0x0253` | 400 | Text block — **10 slots × 40 bytes**, centred, space-padded, NUL-terminated | `game+0x18084` | **confirmed** |
| `0x03E3` | 5 | Pad / unexplained | — | **open** |
| `0x03E8` | ≤1452 | **Map display list** — the icon-plot program that actually draws the section | `game+0x17124` | **confirmed** |
| after terminator | rest | Authoring residue | never read | **confirmed as residue** |

Loading and saving (`game+0x16F3C` / `game+0x16FCA`) both build the
filename with `sprintf` from the format string `"OUT%-d.DAT"` at
`game+0x17E99` (load) / `game+0x17EA4` (save) and call a shared
open/read-or-write/close helper at `game+0x74C4` with a length immediate of
`#2500` (`0x9C4`). **The game writes `out*.dat` back on every section
exit** — `ChangeSection` (`game+0x184BA`) calls `SaveOutFile` before
leaving. These files are therefore live save state, not read-only assets.

`0x0000 + 520 + 75 + 400 = 995 = 0x03E3`. Scanning forward from 595 for the
first byte outside `{ASCII, 0x00, 0x0D, 0x1A}` stops at **exactly 995 in 12
of the 18 files**; of the six others, `out1.dat` stops one byte early (a
stray `0x0C` in its last, unused line slot), `out4`/`out18`/`out19` run to
1001 only because the display list that follows happens to open with
printable bytes, and `out12`/`out16` stop early at 758 on a stray byte
inside an unused slot. The text array therefore ends where the arithmetic
says it does, with no slack.

#### 8.2.1 Terrain grid — dimensions confirmed, code-cited

The engine's own accessor settles it. `GetTile(col, row)` at
`game+0x16C7C`:

```
0x16C80  moveq   #26,d0
0x16C82  sub.w   14(a6),d0     ; 26 - row
0x16C86  subq.w  #1,d0         ; 25 - row
0x16C88  muls.w  #20,d0        ; * 20            <-- row stride
0x16C8C  add.w   10(a6),d0     ; + col
0x16C92  movea.l $210.l,a0     ; section buffer base
```

so `byteOffset = (25 - row) * 20 + col`. A second, constant-folded
implementation at `game+0x18594` (`500 - 20*row + col`) and the tile
write-back at `game+0x1814E` use the identical formula. The party-movement
bounds checks are `cmpi.w #25` on the row variable (`game+0x17F14`) and
`cmpi.w #19` on the column (`game+0x17F1E`), and the full-grid scanner at
`game+0x1702C`/`0x1703E` loops row `< 26` outer, column `< 20` inner.

> **Orientation:** the grid is stored **bottom-up**. The engine's row
> coordinate `R` counts northward from the section's southern edge, so
> **file row 0 is the section's northern edge** (`R = 25`). Everything in
> this document is quoted in *file* rows unless stated otherwise; a render
> that puts file row 0 at the top is north-up.

Independently of the code, width 20 was established three ways from the
data alone, and the third is byte-exact:

1. **Autocorrelation.** Over `out1.dat`'s 520-byte grid, lag 20 is the
   strongest non-trivial self-similarity by a wide margin (80.0% of byte
   pairs equal at lag 20, versus 69.8% at lag 40, 61.9% at 19, 57.7% at
   21). Every occurrence of the 3-byte pattern `65 64 65` in the grid is
   spaced **exactly 20 bytes** apart, 24 times in a row with zero
   deviation — a vertical shoreline feature one cell wide.
2. **Coherent render.** Printed at width 20 × 26 rows, all 18 grids render
   as legible maps (continuous coastlines, one-cell-wide rivers/roads,
   mountain clusters). The transpose (26 × 20) and every other divisor of
   520 do not.
3. **The POI table resolves against it — decisively.** Reading each 5-byte
   POI record's first two bytes as `(col, row)` and indexing the grid at
   `row*20 + col` makes 101 of the 113 non-empty records land in range, and the
   tile values they land on have a **mean corpus frequency of 0.0023**.
   The three competing readings — `(row, col)` row-major, column-major, and
   row-major width 26 — all land on tiles of mean frequency **0.072**,
   i.e. exactly chance. The correct reading is a **31× enrichment toward
   rare tile values**; the wrong ones point at bulk terrain.

#### 8.2.2 Point-of-interest table (`0x0208`, 15 × 5 bytes)

| Offset in record | Size | Field | Notes |
|------------------|------|-------|-------|
| `+0` | 1 | `col` | Grid column, 0-19 |
| `+1` | 1 | `row` | Grid row **in file order**, 0-25 (the lookup at `game+0x183A0` computes `25 - engineRow` before comparing, so the stored byte needs no flip) |
| `+2` | 1 | Message / feature index | **confirmed** for text features, see below |
| `+3` | 1 | Secondary parameter | Non-zero **only** on tile-class-5 records |
| `+4` | 1 | Unused | Zero in every non-residue record |

The engine's lookup (`game+0x18340`) walks the table from buffer `+0x208`
(520) in steps of 5, comparing `record[0]` against the current column
global and `record[1]` against `25 - currentRow`, and gives up at buffer
`+0x26C` (620) with `"EVENT NOT FOUND!|TRY TO FIX THE POSITION[OK]"`. Note
620 is 20 slots past the start, not 15 — the scan limit over-runs into the
text block by 5 slots. No shipped file exercises that, but it is a latent
over-read in the original engine, not in this decode.

Unused slots are all-zero (or hold residue bytes). Record counts per file
range from 0 (`out6.dat`) to 13 (`out18.dat`).

**The table is an exact 1:1 index of the grid's event cells.** Exactly
three of the engine's dispatch paths consult the POI table: the variant
6/7/8 arms at `game+0x18048`, the town prompt on tile `40` at
`game+0x18214`, and the class-5 event at `game+0x1819A`. Selecting cells by
that rule across all 18 files gives **99 grid cells**, and the POI tables
hold **99 records landing on one**, matching **cell-for-cell at exactly the
same `(col, row)`: 99/99, zero event cells without a record, zero records
for an event cell that isn't there.** Only two of the 101 in-range records
land outside the rule (`out12.dat` `(14,14)` → tile 220, `out13.dat`
`(19,8)` → tile 161), both in slots that otherwise look like stale edits.
This is the strongest single invariant in the format: it confirms the grid
width, the row order, the record's field order, and the dispatch rule
simultaneously.

The engine's *other* events are parameterless and correctly have no
records — tile `41` raises event 9 (12 cells, 1 stray record), class 7
raises `variant * 12 + 10`, class 10 event 10, class 11 event 8.

**`+2` is a message index for every text feature — confirmed, 60/60.** The
text renderer at `game+0x18084` multiplies the index by 40 and adds it to
buffer `+0x253` (595), with a three-way length encoding (all three arms
disassembled at `game+0x18084`, `0x180BA`, `0x180F2`):

| `+2` value | Meaning |
|---|---|
| `0`-`9` | one line, slot `+2` |
| `10`-`19` | two lines, slots `+2 - 10` and `+2 - 9` |
| `≥ 20` | three lines, slots `+2 - 20`, `-19`, `-18` |

Applied to every record in the corpus that sits on a "variant 6" tile (the
arm that `game+0x18048` routes to the text path), **all 60 resolve to
non-empty text lines, zero failures, zero out-of-range slots.** Worked
example, `out5.dat` record at `(8,5)` with `+2 = 20`: three lines from slot
0 — `"A SIGN READS: PELNOR 270 MILES EAST,"` / `"PINEVILLE 30 MILES
NORTH,"` / `"'THE CONLEY INN' 170 MILES WEST"` — a three-line signpost
recovered exactly.

**Non-text features.** Two tile values are dispatched before the text path:

- **Tile `40`** (`160` while unexplored) — `cmpi #40` at `game+0x18214`
  raises the town prompt `"A TOWN.  ENTER?[YES|NO]"` (`game+0x18788`).
  There are exactly 10 such cells and 10 records, `+2` =
  `1,2,3,4,6,7,9,10,11` and one outlier `99` (in `out18.dat`, the astral
  plane, whose text calls the place a `"MAGNIFICENT GOLDEN CITY"`), `+3`
  always 0. A town index into `twns.int`'s 12-name roster fits the nine
  small values (leaving `5`, `8`, `12` unplaced) but does not explain `99`.
  **Confidence: confirmed** that tile 40 is a town; **hypothesis** that
  `+2` is the `twns.int` index.
- **Tile class 5** (`50`/`51`, i.e. `170`/`171` unexplored) —
  `game+0x1819A` routes class 5 to event id 13. There are exactly 10 such
  cells and 10 records, and their `+2` bytes are `1,2,3,4,5,6,7,8,9,10`:
  **ten distinct consecutive values, one per record, in ten different
  sections.** Phantasie I ships exactly ten dungeon files (`dng1`-`dng10`),
  so "class 5 = dungeon entrance, `+2` = dungeon number" is the obvious
  reading, and it is corroborated in `out1.dat`, where the class-5 cell at
  `(8,16)` is ringed by four variant-6 cells all pointing at the same
  message pair `"YOU ARE NEAR A SMALL DOOR SET"` / `"INTO THE HILLSIDE"`.
  Their `+3` bytes are `20,15,15,14,10,8,16,15,20,16` — the only non-zero
  `+3` in the corpus, not distinct, and **not** monotonic in `+2`, so not
  the dungeon depth. **Confidence: confirmed** that class 5 is a distinct
  event class with a per-instance 1-10 identifier; **hypothesis** that it
  is the dungeon entrance; **open** for `+3`.

The remaining 21 records sit on other landmark classes (`67`, `68`, `7`,
`87`, `88`, `41`, `106`) with `+2` values well outside the message-index
range (`42`, `54`, `64`, `66`, `68`, `73`, `77`, `78`, `79`) — most of them
in `out16.dat` and `out18.dat`, the two most structurally unusual sections.
`game+0x1819A` also routes class 7 to event `variant * 12 + 10` and class
11 to event 8, but the downstream event handler (`game+0x13300`) was not
traced. **Open.**

#### 8.2.3 Text block (`0x0253`, 10 × 40 bytes)

Ten fixed 40-byte slots. Used slots hold centred, space-padded, all-caps
ASCII with a NUL terminator; unused slots are either space-filled
(`out1.dat`) or filled with `0x0D` (`out2.dat` onward) — the same `0x0D`
filler convention the dungeon action table uses (§3). Several files carry
authoring residue in the later slots (e.g. `"ENDING SEQUENCEGE BUBBLING
POOL"` in `out6`-`out15`, which is a partial overwrite of an older
`"...ENDING SEQUENCE"` line by a newer `"...STRANGE BUBBLING POOL"` one).

#### 8.2.4 Map display list (`0x03E8` = 1000) — confirmed

**The 520-byte terrain grid is never drawn.** It is a gameplay layer
(movement cost, passability, encounter group, fog of war, event dispatch).
What the player sees is plotted from a display list stored later in the
same file, read by `game+0x17124` from a pointer set up as `buffer + 1000`
(`adda.w #0x3E8` at `game+0x17262`):

```
u16  backgroundIconIndex
repeat {
    u16 count            ; 0xFFFF terminates the list
    u16 iconIndex
    count × { u16 x; u16 y }    ; screen pixel coordinates
}
```

`iconIndex` is scaled by 128 (`asl.l #7` at `game+0x1713C`) and added to a
bitmap bank base of `game+0x196BC`, i.e. **128 bytes per icon**.

**Verification:** parsing all 18 files with this grammar succeeds on every
one — `backgroundIconIndex` is `10` in all 18, the `0xFFFF` terminator is
found in bounds in all 18 (earliest at 1488 in `out18.dat`, latest at 2452
in `out11.dat`, always < 2500), group counts run 1-10 and point counts
120-355. Across all **4,627** plotted points the `y` coordinate **never
exceeds 199** and only 46 `x` values (1.0%) sit past 319, the furthest at
324 — a tight fit to a 320×200 screen that 16-bit noise could not produce.
Zero parse failures, zero heuristics.

Bytes after the terminator are genuine authoring residue: `out1.dat`, whose
list ends at 1908, carries a **second, older copy of its own 400-byte text
block** at offset 2143 (357 of 400 bytes identical to the live copy at
595). The 5 bytes at `0x03E3`-`0x03E7`, between the text block and the
display list, are not accounted for.

> **Correction (2026-08-10, same day):** an earlier draft of this section,
> written before the loader was disassembled, called the whole region from
> 995 to end-of-file "residue, not structure," citing the duplicated text
> block as decisive. That was wrong for the first ~500-1450 bytes of it.
> The duplicated text block is real evidence of residue, but it sits
> *after* the display-list terminator — the residue starts later than the
> region does. Recorded per this project's supersede-in-place rule; the
> lesson is that "some of this region is provably stale" does not bound
> where the stale part begins.

### 8.3 `maps.int` (9360 bytes) — solved: the concatenated world map

> **Correction (2026-08-10):** an earlier version of this section recorded
> `maps.int` as having "no clean square-grid factorization" and being
> undecodable. The premise was wrong: `maps.int` is not one grid at all.
> `9360 = 18 × 520`, and 520 is the size of one `out*.dat` terrain grid.

#### 8.3.1 Container layout — confirmed, byte-exact

`maps.int` is **18 concatenated 520-byte terrain grids, no header, no
footer**. Block `k` at file offset `k * 520` is byte-identical to the
leading 520 bytes of the `k`-th `out*.dat` file, in ordinal (not numeric)
filename order:

| Block | Offset | Source file | Block | Offset | Source file |
|-------|--------|-------------|-------|--------|-------------|
| 0 | `0x0000` | `out1.dat` | 9 | `0x1248` | `out10.dat` |
| 1 | `0x0208` | `out2.dat` | 10 | `0x1450` | `out11.dat` |
| 2 | `0x0410` | `out3.dat` | 11 | `0x1658` | `out12.dat` |
| 3 | `0x0618` | `out4.dat` | 12 | `0x1860` | `out13.dat` |
| 4 | `0x0820` | `out5.dat` | 13 | `0x1A68` | `out14.dat` |
| 5 | `0x0A28` | `out6.dat` | 14 | `0x1C70` | `out15.dat` |
| 6 | `0x0C30` | `out7.dat` | 15 | `0x1E78` | `out16.dat` |
| 7 | `0x0E38` | `out8.dat` | 16 | `0x2080` | `out18.dat` |
| 8 | `0x1040` | `out9.dat` | 17 | `0x2288` | `out19.dat` |

Verified by exact substring match of each file's first 520 bytes at the
predicted offset, all 18, zero mismatches; `18 × 520 = 9360` accounts for
every byte of the file.

**Block index is not section number − 1 for the last two blocks.** Blocks
0-15 are sections 1-16, but block 16 is section **18** and block 17 is
section **19** — `maps.int` is packed by ordinal over the files that exist,
and there is no `out17.dat` (nor an `out20.dat`; see §8.3.2, where both are
world-grid slots the engine can address but that ship no file).

**Why `game` has no `maps.int` string.** It doesn't need one. The engine
loads and *saves* `out%d.dat` directly (`SaveOutFile` runs on every section
exit, `game+0x184C6`), mutating the terrain grid in place as the party
explores — the `+120` unexplored flag in §8.3.3 is cleared by writing the
tile byte back to the file's own buffer. `maps.int` is the **pristine
master copy** of all 18 grids; the separate `backup` utility (which *does*
contain the string, `backup+0x128D`, alongside `out%d.dat`, `TWNS.DAT`,
`GUILD.DAT`, `DNG.SAV`, `DNGX.SAV`, `SACK.DAT`) is what restores it. That
is exactly why our `maps.int` is byte-identical to the shipped `out*.dat`
grids, and why it omits the non-existent `out17`. **Confidence: confirmed**
for the layout; **confirmed** for the save-in-place behaviour;
**hypothesis** for `maps.int`'s precise restore role (the copy direction
inside `backup` was not traced).

#### 8.3.2 How the sections tile — a 4 × 5 world grid, 77 × 126 cells

The section-transition routine `ChangeSection(section, &row, &col, dRow,
dCol)` at `game+0x184BA` computes the neighbour arithmetically:

```
0x184CE  move.w  22(a6),d0    ; dRow
0x184D2  asl.w   #2,d0        ; dRow * 4
0x184D4  move.w  10(a6),d1    ; section
0x184D8  sub.w   d0,d1        ; section -= 4*dRow
0x184DA  move.w  26(a6),d0    ; dCol
0x184DE  sub.w   d0,d1        ; section -= dCol
```

i.e. **`newSection = section − 4·dRow − dCol`**, so the world is **4
sections wide**, `section = mosaicRow * 4 + mosaicCol + 1`. The same
routine sets the arrival coordinate to `0`, `19` or `25` (`moveq #25` /
`moveq #19` / `moveq #0` at `0x184EE`-`0x18506`) — **not** `1`/`18`/`24` —
so **adjacent sections share one row and one column.** Horizontal stride
19, vertical stride 25.

With 18 shipped sections the grid is 4 wide × 5 tall and the assembled
world is `4·19 + 1 = 77` cells wide by `5·25 + 1 = 126` cells tall:

```
   1   2   3   4
   5   6   7   8
   9  10  11  12
  13  14  15  16
 (17) 18  19 (20)
```

Sections 17 and 20 are addressable slots with no file. `game+0x182E2`
tests `cmpi.w #16` on the current section and refuses movement above it
with `"THE RIVER STYX"` (`game+0x187A0`) instead of the ordinary
`"THAT IS THE OCEAN"` (`game+0x187B3`), so the bottom band is a
deliberately walled-off region — consistent with sections 18/19's text:
`"YOU ARE IN THE ASTRAL PLANE, SURROUNDED BY A BRILLANT LIGHT"` /
`"NEARBY IS A MAGNIFICENT GOLDEN CITY"` (18) and `"THE BOATMAN CHARON
TAKES YOU ACROSS THE RIVER STYX"` / `"YOU ARE IN PART OF THE PLANE OF
OLYMPUS"` (19).

**Data-side confirmation of the overlap.** Taking every pair of
mosaic-adjacent sections among 1-16 and comparing the shared edge
(section's column 19 against its right neighbour's column 0; section's row
25 against its lower neighbour's row 0) gives **552 shared cells** across
24 seams, of which:

- **488 (88.4%) agree on the exact tile code** after normalising the code
  bank (§8.3.3);
- **542 (98.2%) agree on the tile code's tens digit** — i.e. on the terrain
  class, differing only in the ones digit;
- only **10 cells (1.8%)** disagree on terrain class at all, and 7 of those
  are one authoring inconsistency in the section-1/5 seam.

Assembling from those strides produces a single coherent continent:
one-cell-wide river/road lines run unbroken across section seams,
coastlines close, and the landmass is fully enclosed by the ocean tile
class. Assembling at stride 20/26 (no overlap) instead produces visibly
duplicated rows and columns at every seam.

> **Note on the bottom band's placement.** The 4×5 grid puts section 18
> below section 14 and section 19 below section 15. The *data* cannot
> distinguish this from the alternative (18/19 one column further left):
> the relevant seam rows are uniform ocean in both sections, so both
> placements score 20/20. The placement above rests entirely on the
> `section − 4·dRow − dCol` arithmetic, which is uniform for every section.
> **Confidence: confirmed** (code); the data is merely not contradictory.

#### 8.3.3 Tile-code encoding — `+120` fog flag, then split by 10

63 distinct byte values occur across `maps.int`. The engine decomposes each
one exactly twice, and both steps are code-confirmed.

**Step 1 — `+120` is the "not yet explored" flag. Confirmed.** The reveal
routine `RevealBox(col, row, radius)` at `game+0x17450` does, per cell:

```
0x17526  cmpi.l  #120,d0
0x1752C  blt.b   +14                ; already revealed, leave alone
0x1752E  subi.l  #120,d0            ; clear the flag
0x17534  movea.l $250.l,a0          ; cell address cached by GetTile
0x1753A  move.b  d0,(a0)            ; write the revealed tile back
```

The same `#120` threshold gates the line-of-sight run at `game+0x16D06`
and the town/temple icon scan at `game+0x1705C`. Because the engine saves
`out*.dat` on every section exit (§8.2), this flag is live save state
written into the data file itself.

Empirically, in the shipped data the split is **perfectly clean and
all-or-nothing per section**: `out1.dat` and `out5.dat` (sections 1 and 5)
are `< 120` in **520/520** cells; the other 16 sections are `≥ 120` in
**520/520** cells. No section is partially revealed. That is exactly a
pristine new-game state with the starting region pre-revealed — and it is
also why the three bank-crossing seams differ by *exactly* `+120` in 25/26,
26/26 and 19/20 of their shared cells (§8.3.2): the same world cell, once
revealed and once not.

> **Correction (2026-08-10, same day):** an earlier draft of this section
> called the `±120` split a per-section graphics "code bank" of unknown
> meaning, on the strength of the clean 520/520 split alone. It is a
> fog-of-war flag, and `subi.l #120` in the reveal routine says so
> directly. The structural evidence was right; the interpretation was a
> guess, and the guess reached for a rendering explanation when the
> mechanism was game state.

**Step 2 — divide by 10. Confirmed.** Immediately after the party steps on
a tile, `game+0x18000`:

```
0x18000  moveq   #10,d1
0x18002  divs.w  d1,d0
0x18004  move.w  d0,$C.l       ; tile / 10  -> "terrain class" global
0x18010  divs.w  #10,d1
0x18014  swap    d1
0x18016  move.w  d1,$E.l       ; tile % 10  -> "variant" global
```

**There is no terrain-property table and no tile-graphics table.** Both
halves are consumed by branch chains, not as table indices — an exhaustive
search of the two hunks that own this subsystem found no lookup keyed on
either value. Confirmed consumers:

| Consumer | Site | Behaviour |
|---|---|---|
| Movement time cost | `game+0x18022`-`0x1803E` | `(class + 1) * 75` if `class ≤ 3`, else `60`; added to the game clock, saturating at `0xFFFF` |
| Impassable | `game+0x17FBE` | tile `== 100` → ocean / Styx refusal |
| Variant dispatch | `game+0x18048` | `6` → show POI text; `7` → increment the tile byte and raise event `record[2] + 1`; `8` → no-op |
| Class dispatch | `game+0x1819A` | `5` → event 13; `7` → event `variant * 12 + 10`; `10` → event 10; `11` → event 8 |
| Whole-tile specials | `game+0x18214` | tile `== 40` → town prompt; tile `== 41` → event 9 |
| Random encounter | `game+0x1E558` | `encounterGroup = variant * 12 + r`, `r ∈ {0,1,4}` |

The encounter formula is worth noting: **the ones digit selects a
12-monster block of the roster**, exactly the `level * 12 + offset`
convention already confirmed for dungeon cells (§4). So the ones digit is
primarily a *monster-group / region-difficulty* number, with values 6-8
overloaded as event markers — which is why every cell with a ones digit of
6, 7 or 8 carries a POI record (§8.2.2's 99/99 bijection) and no bulk
terrain cell does.

Class assignments read off the assembled map, **rendered** confidence
only except where marked:

| Class | Codes (revealed / hidden) | Cells | Reading |
|---|---|---|---|
| 10 | `100,101` / `220,221` | 2,940 | Ocean / off-map frame — **confirmed** impassable at `game+0x17FBE` |
| 4 | `40,41` / `160,161` | 22 | `40` = town — **confirmed** at `game+0x18214` |
| 5 | `50,51` / `170` | 10 | Dungeon entrance — **hypothesis**, §8.2.2 |
| 6 | `60,62,63,64` / `180,182,183,184` | 211 | One-cell-wide connected lines running unbroken across section seams — river or road |
| 0,1,2,3,7,8,9,11 | see histogram | ~6,100 | Bulk land, blob-shaped regions; movement cost separates classes 0-3 (75/150/225/300) from the rest (60) |

Terrain *art* is not indexed by these codes at all — the visible map is
plotted from the per-section display list (§8.2.4) against a 128-byte-per-
entry icon bitmap bank at `game+0x196BC`. This is a genuine divergence
from Phantasie III's `.set`, where the map byte **is** a rendering index
(an X pixel-column into a bundled terrain-band picture, graphics-formats.md
§5.3). Same series, same map-byte *shape*, different role: in P1 the byte
is pure simulation state and the drawing is a separate vector-ish program.

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
| `twns.int` 292-byte record | Stride, name-field offset, 12-town roster confirmed. **The map position is *not* in this file** — it is in the `out*.dat` POI record (§8.2.2); a search of the whole file for the 10 known `(section, x, y)` triples returned zero hits, and the first 32 bytes of every populated record are byte-identical, i.e. a shared shop/price template | Every other field in the record; the two non-empty non-name "slots" at the end; which table the POI record's town index `+2` addresses |
| `out*.dat` | **Full four-region layout confirmed** (§8.2): 20×26 grid, 15×5-byte POI table, 10×40-byte text array, trailing residue | Meaning of the POI record's `+2`/`+3` bytes for non-town features |
| `maps.int` | **Solved** (§8.3): 18 × 520-byte grids = the 18 `out*.dat` grids; sections 1-16 tile 4×4 with 1-cell overlap into a 77×101 world | What the ±120 tile-code bank means; per-class terrain names; whether `game` reads the file at all (no `maps.int` string in it) |
| `scrolls.dtx` | 40-byte line stride confirmed, 400 lines total | How lines subdivide into individual scrolls |
| `tamb.dat` | Byte-frequency profile only | Everything else |
| Phantasie III `S1`-`S20` | Readable narrative text, likely scroll/note pickups | Exact format beyond "flat null-terminated text blob"; `S6`'s outlier size |
| Phantasie III `M0`, `M1` | Sizes, rough byte content | Everything else |
| Phantasie III `PLN1`-`PLN4` | Sizes, letter-run pattern suggestive of small terrain grids | Everything else |
| Phantasie III `gamesave.dat` | Size only | Record structure |
