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

## 8. Non-dungeon world/town files (Phantasie I and II)

These files are **not** covered by the reference tool at all (it only
parses dungeons). Everything below is this project's own inspection;
confidence is marked per finding.

§8.1-§8.5 document Phantasie I's files (`data/phantasie/amiga/`). **§8.6
documents Phantasie II's** (`data/phantasieii/atarist/extracted/`), which
turn out to use the *same* format with two constants changed.

### 8.1 `twns.int` (13000 bytes) — container and record layout, code-confirmed

> **Correction (2026-08-11):** an earlier version of this section derived the
> record array's base address by *extrapolating* backwards from the town-name
> strings, assuming the name sat at record offset `+0x62` and therefore that
> the array began at `0x0A44` and held 35 records. Both halves were wrong.
> The loader has now been disassembled: the array begins at **2446
> (`0x098E`)** and holds exactly **12** records, and the name field is at
> record offset **`+0x118`** (280). The two readings put the name strings at
> the same absolute file positions, which is why the old one looked
> self-consistent — see `leading-header-equal-to-field-offset-masks-record-start.md`.
> The old section also recorded "the map-coordinate question is closed —
> position lives in the `out*.dat` POI record, not here." That is also wrong:
> the town record carries `(section, B, A)` at `+0x112`/`+0x114`/`+0x116`,
> and all 12 match the map cell exactly (table below).

#### Container layout — confirmed byte-exact

`LoadTownsInt()` at `game+0x7280` does one `AllocMem(0x332C)` then eight
sequential `Read()`s through the helper at `game+0x73B4`
(`Read(file, len, *cursor); *dest = *cursor; *cursor += len`), each one
handing a region's start address to a pointer slot in BSS hunk 19:

| # | Offset | Size | Pointer | Contents |
|---|--------|------|---------|----------|
| 1 | `0x0000` | 90 | `h19+0x00` | open |
| 2 | `0x005A` | 360 | `h19+0x04` | open |
| 3 | `0x01C2` | 90 | `h19+0x08` | open |
| 4 | `0x021C` | 1800 | `h19+0x0C` | open |
| 5 | `0x0924` | 30 | `h19+0x10` | open |
| 6 | `0x0942` | 76 | `h19+0x14` | open |
| 7 | **`0x098E`** | **3504** | `h19+0x1C` | **12 × 292-byte town records** |
| 8 | `0x173E` | 7050 | `h13+0x00` | open |

`90+360+90+1800+30+76+3504+7050 = 13000` — **every byte of the file
accounted for, zero slack**, and region 7 is exactly `12 × 292`. The read
lengths are `#$5A`, `#$168`, `#$5A`, `#$708`, `#$1E`, `#$4C`, `#$DB0`,
`#$1B8A` at `game+0x72CA`, `0x72E4`, `0x72FA`, `0x731A`, `0x7336`,
`0x734E`, `0x736C`, `0x7386`. Regions 7 and 8 are read only when the
routine's second argument is non-zero.

#### Town record — 292 bytes (`0x124`)

`SelectTown(index)` at `game+0xA10C` computes the record address:

```
0xA110  move.w  10(a6), d0        ; the caller's 1-based town index
0xA114  subq.w  #1, 10(a6)        ; -> 0-based record index
0xA118  cmpi.w  #99, d0
0xA11C  bne.b   0xA124
0xA11E  move.w  #11, 10(a6)       ; 99 is a special case -> record 11
0xA124  move.w  10(a6), d0
0xA128  muls.w  #292, d0
0xA12C  movea.l townRecords, a0   ; h19+0x1C
0xA132  adda.l  d0, a0
0xA134  move.l  a0, currentTown   ; h19+0x18
```

| Offset | Size | Field | Evidence | Confidence |
|--------|------|-------|----------|-----------|
| `+0x000` | 182 | **Shop stock**, one byte per item index (quantity, 0 = not stocked) | `game+0x4492` (`if (rec[item] == 0)` = out of stock), `game+0x42A6` (`rec[item]--` on purchase), `game+0x4CF8` (count capped at 99) | **confirmed** |
| `+0x0B6` | 90 | **Restock list**, 45 big-endian words of item indices | `game+0x2322`: `idx = *(u16*)(rec + 0xB6 + 2*i); rec[idx] = 1` | **confirmed** |
| `+0x110` | 2 | **Price multiplier** (percent) | `game+0x4336`: `price = base * rec[0x110] / 500 + 1`; also `game+0x332C` (`* 90`) | **confirmed** |
| `+0x112` | 2 | **Section number** | `game+0x4EA4` → globals `0x7BA`/`0x5C` (the current-section global the movers use) | **confirmed** |
| `+0x114` | 2 | **North-south (`B`/`col`) coordinate** | `game+0x4EBA` → `0x7BE` | **confirmed** |
| `+0x116` | 2 | **East-west file-row (`25 − A`) coordinate** | `game+0x4EC2` → `0x7BC` | **confirmed** |
| `+0x118` | 10 | **Town name**, space-padded ASCII | `game+0xA14E`: `print(rec + 0x118)` | **confirmed** |
| `+0x122` | 2 | Zero in all 12 records | — | open |

The 182-byte stock array matches the **181-entry item-name table plus its
index-0 empty-slot sentinel** exactly (§6.1 of `scripting-engine.md`), and
the highest stocked index observed anywhere in the file is 177. The 45-word
restock list holds only values in the same range. **Both are byte-exact
structural fits, not guesses.**

> **Latent original-engine bug.** On entering a town, `game+0x22BA` runs
> `for (i = 0; i < 18; i++) rec[Random(0x112)] = 0` — an 18-slot random
> "someone bought it" pass whose bound is **274**, not 182. Indices 182-273
> land in the restock list, the price multiplier and the coordinate words.
> Same shape as the POI-scan over-read in §8.2.2: a real bug in the shipped
> engine, not in this decode. **Confidence: confirmed** for the code;
> **hypothesis** for whether it is ever observable in play.

#### The 12 towns — every field cross-checked against the map

| Rec | `+2` in POI | Name | `+0x110` price | `+0x112` sec | `+0x114` B | `+0x116` A_file | Map cell there |
|-----|------------|------|------|------|------|------|------|
| 0 | 1 | PELNOR | 150 | 1 | 15 | 11 | tile 40 ✓ |
| 1 | 2 | PINEVILLE | 142 | 5 | 5 | 5 | tile 40 ✓ |
| 2 | 3 | GREENVILLE | 135 | 9 | 8 | 11 | tile 40 ✓ |
| 3 | 4 | HALFLINGOR | 121 | 10 | 5 | 10 | tile 40 ✓ |
| 4 | 5 | APPLETON | 128 | 13 | 19 | 8 | tile **41** ✓ |
| 5 | 6 | SPLITWATER | 114 | 11 | 9 | 19 | tile 40 ✓ |
| 6 | 7 | TROLLPORT | 107 | 12 | 5 | 4 | tile 40 ✓ |
| 7 | 8 | PHANTASIA | 100 | 14 | 11 | 20 | tile 35 (mountain) ✗ |
| 8 | 9 | DRAGONOR | 80 | 16 | 17 | 7 | tile 40 ✓ |
| 9 | 10 | NORTHFORD | 100 | 8 | 15 | 7 | tile 40 ✓ |
| 10 | 11 | STARVILLE | 100 | 3 | 15 | 4 | tile 40 ✓ |
| 11 | 99 | OLYMPIA | 78 | 18 | 5 | 15 | tile 40 ✓ |

**11 of 12 records point at their own town's map cell, byte-exact.** The two
that the old §8.2.2 called "unplaced" are both resolved by this table:
`APPLETON` sits on the tile-**41** cell in `out13.dat` whose POI record
(`+2 = 5`) the old text dismissed as "1 stray record", and `OLYMPIA` is the
`99` outlier, which `SelectTown`'s explicit `cmpi.w #99 → record 11` arm
maps deliberately (the astral plane's `"MAGNIFICENT GOLDEN CITY"`).

**`PHANTASIA` is defined but not placed:** its coordinates address a
class-3 mountain cell in section 14 with no town marker, and its shop stock
is empty (2 non-zero bytes, versus 53-64 for every other town) and its
restock list is all zeros. **Confidence: confirmed** that the record is
inert in the shipped data; **open** whether some event teleports the party
there.

Regions 1-6 and 8 of the container are still **open**. Region 8 holds the
`"FIRE  ELE"`/`"WATER ELEM"`/`"EARTH ELEM"` fragments an earlier pass noticed
near `0x3088`; the readable-string clustering is real, the structure is not
yet determined.

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

> **Correction (2026-08-11) — the two axes are the other way round.** This
> paragraph used to read: "the grid is stored bottom-up… file row 0 is the
> section's northern edge… a render that puts file row 0 at the top is
> north-up." The *storage* description was right, the **compass labels were
> swapped**. The engine's `row` coordinate (the one bounded at 25, the one
> `GetTile` multiplies by 20) is the **east-west** axis, and its `col`
> coordinate (bounded at 19) is the **north-south** axis. So a section is
> **26 cells wide east-west by 20 cells tall north-south**, and the
> north-up render is `x = 25 − fileRow`, `y = col`. Three independent
> confirmations, all new this pass:
>
> 1. **The map display geometry.** `MarkerRect()` at `game+0x16EB8`
>    computes `x = engineRow * cellW + originX`, `y = col * cellH + originY`
>    — the 0..25 axis drives screen **x**. `game+0x173B0` sets
>    `cellW = 12`, `cellH = 9`, `originX = 4`, `originY = 15`, and the
>    background rectangle it builds two instructions later is
>    `(4, 15, 312, 180)`. `312 = 26 × 12` and `180 = 20 × 9` **exactly**;
>    no other assignment of the two axes divides evenly.
> 2. **The direction commands.** The four movers at `game+0x18480`,
>    `0x183D2`, `0x18446`, `0x1840C` (dispatched in that order from
>    `game+0x14044`) pass `(dA, dB)` of `(0,+1)`, `(+1,0)`, `(0,−1)`,
>    `(−1,0)` to `Move()` at `game+0x17EEC`, which does
>    `A += dA; B −= dB`. North therefore decrements the 0..19 axis and
>    east increments the 0..25 axis.
> 3. **The game's own signposts.** `out1.dat`'s record at
>    `(fileRow 12, col 15)` reads `"TO THE EAST LIES A SMALL TOWN"` and the
>    town is at `(fileRow 11, col 15)` — one cell along the *row* axis, zero
>    along the column axis. `out5.dat`'s three-line sign at
>    `(fileRow 5, col 8)` reads `"PINEVILLE 30 MILES NORTH"`, and PINEVILLE
>    (§8.1, record 1) is at `(fileRow 5, col 5)` — **three cells along the
>    column axis, i.e. 10 miles per cell, exact**. The same sign's
>    `"'THE CONLEY INN' 170 MILES WEST"` resolves to the tile-41 cell 16
>    cells away on the row axis (160 vs 170 miles — within one cell). Two of
>    the sign's three legs land within a cell; the third
>    (`"PELNOR 270 MILES EAST"`, 19 cells = 190 miles) does not, and is
>    treated as flavour text.
>
> Everything in this document is still quoted in *file* rows unless stated
> otherwise. What changes is only which compass direction each index means.

**Storage summary.** `byteOffset = fileRow * 20 + col` where
`fileRow = 25 − engineRow`. A run of 20 consecutive bytes is therefore one
**north-to-south column** of the map, and the 26 blocks run **east to west**
(`fileRow 0` is the section's *eastern* edge).

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
| `+2` | 1 | Message index / town id / dungeon id / special-event id — **which one depends on the tile** (see §8.2.2a) | **confirmed** |
| `+3` | 1 | Dungeon entry **column `x`** (class-5 records only) | **confirmed**, see §8.2.2a |
| `+4` | 1 | Dungeon entry **row `y`** (class-5 records only; `0` in all ten) | **confirmed**, see §8.2.2a |

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

#### 8.2.2a What `+2`, `+3` and `+4` mean per tile — all four cases confirmed

> **Correction (2026-08-11):** this subsection replaces the old "Non-text
> features" text, which recorded `+2`-as-town-index as a *hypothesis* that
> "does not explain `99`", `+3` as **open**, `+4` as **unused**, and the 21
> out-of-range `+2` records as **open**. All four are now settled from the
> engine's own code. The old text's guess that `+3` might be "dungeon depth"
> is retracted — it is a grid coordinate.

**(a) Tile `40` — town.** `cmpi #40` at `game+0x18214` raises
`"A TOWN.  ENTER?[YES|NO]"` (`game+0x18788`). On `YES`:

```
0x1824C  bsr.w   0x18340           ; POIScan() -> a0 = &record
0x18252  move.b  2(a0), d1         ; record[+2]
0x18258  move.w  d1, $60.l         ; -> the "which town" global
0x18268  jsr     <EnterTown>
```

Global `h4+0x60` reaches `SelectTown()` at `game+0xA10C`, which does
`recordIndex = townId − 1` with an explicit `cmpi.w #99 → 11` arm
(§8.1). So **`+2` is a 1-based index into `twns.int`'s 12 town records**,
with `99` a deliberate alias for record 11 (`OLYMPIA`). §8.1's table
cross-checks all 12 records' own stored `(section, col, fileRow)` against
the map: 11 land on their town's exact cell. **Confirmed.**

**(b) Tile `41` — the second town/inn marker.** `game+0x17094` draws
class-4 cells with two different markers depending on the variant
(`≠1` → marker struct `$238`, `=1` → `$240`), and `game+0x18214` sends
tile `41` to event 9. There are 12 such cells; only one carries a POI
record (`out13.dat`, `+2 = 5`) — and §8.1 shows `APPLETON`'s own stored
coordinates point at exactly that cell. The old text called it "1 stray
record"; it is the town record for Appleton. The other 11 tile-41 cells
are the roadside inns the section text names (`'THE RED PONY INN'`,
`'THE CONLEY INN'`, `'THE GOLDEN UNICORN'`, …) and take no parameter.
**Confirmed** for the marker split and for Appleton; **hypothesis** that
the remaining 11 are inns rather than towns.

**(c) Tile class 5 — dungeon entrance. `+2` = dungeon number, `+3`/`+4` =
the entry cell inside that dungeon.** `EnterDungeon()` at `game+0xFBA0`:

```
0xFBCE  jsr     <POIScan>          ; d0 = &record
0xFBD6  addq.l  #2, a0
0xFBD8  move.b  (a0), d0           ; record[+2]
0xFBE6  move.w  d0, $5E.l          ;   -> dungeon number -> "DNG%-d"
0xFBEC  move.b  (a0), d0           ; record[+3]
0xFBFA  move.w  d0, $7BC.l         ;   -> party x
0xFC00  move.w  d0, $166.l
0xFC06  move.b  (a0), d0           ; record[+4]
0xFC14  move.w  d0, $7BE.l         ;   -> party y
0xFC1A  move.w  d0, $168.l
0xFC44  bsr.w   0xF904             ; LoadDungeon(dungeonNumber), sprintf "DNG%-d"
```

`$7BC`/`$7BE` are the generic saved-position pair, restored **without** the
outdoor `25 −` flip when the mode global `$5A ≠ 2` (`game+0x13FB6`) — i.e.
in dungeon mode they are raw `(x, y)` into the 33 × 38 grid of §3.

**Verification — 10/10, byte-exact.** Cell value **`215` (`0xD7`)** occurs
in each `dng1`-`dng10` grid only in row 0, and its column is **exactly the
POI record's `+3` byte in all ten dungeons, zero exceptions**:

| Dungeon | `+2` | `+3` | `+4` | Only `215` cell in `dngN` |
|---|---|---|---|---|
| dng1 | 1 | 20 | 0 | `(20, 0)` |
| dng2 | 2 | 14 | 0 | `(14, 0)` |
| dng3 | 3 | 8 | 0 | `(8, 0)` |
| dng4 | 4 | 15 | 0 | `(15, 0)` |
| dng5 | 5 | 16 | 0 | `(16, 0)` |
| dng6 | 6 | 20 | 0 | `(20, 0)` |
| dng7 | 7 | 15 | 0 | `(15, 0)` |
| dng8 | 8 | 10 | 0 | `(10, 0)` + a second at `(31, 0)` |
| dng9 | 9 | 15 | 0 | `(15, 0)` + a second at `(32, 0)` |
| dng10 | 10 | 16 | 0 | `(16, 0)` |

So `215` is the **dungeon entrance/exit cell marker**, `+3`/`+4` place the
party on it, and "class 5 = dungeon entrance, `+2` = dungeon number"
graduates from hypothesis to **confirmed**. Phantasie II's `PHANT.PRG`
reaches the same conclusion independently and with a richer `+4` domain
(§8.6.4a) — P1 simply never uses a `y` other than 0.

**(d) Variant 7 — a one-shot fixed encounter; `+2 + 1` is the monster index.**
This is what the 21 "out-of-range `+2`" records are. `game+0x18132`:

```
0x18132  bsr.w   0x18340           ; POIScan()
0x18138  move.b  2(a0), d1
0x18140  addq.l  #1, d1
0x18148  move.w  d1, $58.l         ; encounter-roster index = record[+2] + 1
0x1814E  ...                       ; recompute the cell's address
0x18174  addq.b  #1, (a0)          ; bump the tile byte in place: variant 7 -> 8
0x18176  move.b  d0, (a0)
0x18186  moveq   #11, d0           ; return event 11
```

and `game+0x18190` (**variant 8**) is a bare `moveq #2, d0; rts` — a no-op.
**Variant 8 is a variant-7 trigger that has already fired**, and because the
engine saves `out*.dat` on every section exit the bump is persistent.

`$58` is the **encounter-roster index** global: the class-7 arm eight
instructions away writes `variant * 12 + 10` into the same word
(`game+0x181D6`), which is §4's `level * 12 + offset` roster convention
exactly, and both arms then call the same `jsr $10C0` and return event 11.
So `+2` is a monster index, and the resolved names are decisive:

| `+2` | index | Monster (`data-tables.md` §1.1) | Where |
|---|---|---|---|
| 42 | 43 | WERE BEAR | `out16` ×4 |
| 54 | 55 | WERE WOLF | `out16` ×4 |
| 64 | 65 | WATER ELEMENTAL | `out18` |
| 66 | 67 | STORM GIANT | `out18` |
| 68 | 69 | GREAT TROLL | `out18` |
| 73 | 74 | **ZEUS** | `out18` ×2 |
| 77 | 78 | SPLAT BEAST | `out18` |
| 78 | 79 | ORANGE DRAGON | `out18`, `out9` ×3 (already spent) |
| 79 | 80 | — (one past the 80-entry table) | `out18` |

**ZEUS guarding a pad in the astral plane, one section from the plane of
Olympus** is not a coincidence a wrong decode produces, and `out18`'s eight
cells sit on a clean 2 × 4 lattice (`fileRow` 5/10/15/20 × `col` 10/15) —
a ring of set-piece encounters. Phantasie II's `PHANT.PRG` reaches the same
"variant-7 `+2` is a fixed-encounter monster index" conclusion
independently (§8.6.4b).

Of the 23 records with `+2 ≥ 30`, **19 sit on a variant-7 or variant-8
cell**; the remaining four (`out3.dat` ×2, `out13.dat`, `out15.dat`) are
all-zero-coordinate residue slots pointing at ordinary bulk terrain.
**Confirmed** for the mechanism and the index space; **open** for the single
`+2 = 79` value, which resolves one past the end of the 80-entry table.

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

**A "group" is a filled polygon, not a scatter of icons.** The two draw
routines the list feeds are `game+0x1F310` (background) and `game+0x1F378`
(one group), and both are thin wrappers over `graphics.library`:

| Call site | SAS/C stub | LVO | Function |
|---|---|---|---|
| `0x1F322`, `0x1F38A` | `0x2EDDC` | `-354` | `SetDrMd(rp, JAM1)` |
| `0x1F366` | `0x2ED88` | `-306` | `RectFill(rp, xMin, yMin, xMax, yMax)` |
| `0x1F3D2` | `0x2ECD4` | `-252` | `AreaMove(rp, x, y)` |
| `0x1F41E` | `0x2ECEE` | `-258` | `AreaDraw(rp, x, y)` |
| `0x1F434` | `0x2ED0A` | `-264` | `AreaEnd(rp)` |

Both routines first do

```
0x1F392  move.l  8(a6), $3C.l      ; rp->AreaPtrn  = icon address  (RastPort +8)
0x1F39A  move.b  #$FC, $51.l       ; rp->AreaPtSz  = -4            (RastPort +0x1D)
```

on the `RastPort` at BSS `hunk79+0x34`. A **negative** `AreaPtSz` is
`graphics.library`'s multi-coloured area pattern: `2^|AreaPtSz| = 16` rows
per plane, 16 pixels wide, one 16-word block per bitplane, planes
consecutive. `4 planes × 16 rows × 2 bytes = 128` — exactly the stride the
display list's `asl.l #7` implies.

#### 8.2.4a The outdoor icon bank at `game+0x196BC` — confirmed

> **Correction (2026-08-11):** §8.3.3 used to end "the visible map is
> plotted from the per-section display list against a 128-byte-per-entry
> icon bitmap bank at `game+0x196BC`", with the bank's own format left
> open, and `TODO.md` carried it as the highest-leverage unsolved P1 item.
> It is solved.

| Property | Value | Evidence |
|---|---|---|
| Base | file `0x196BC` = DATA hunk 69 `+0x294` | the `adda.l #$294` at `0x17140`/`0x17180` resolves through hunk 56's `HUNK_RELOC32` to hunk 69, whose data starts at file `0x19428` |
| Entry size | 128 bytes | `asl.l #7` |
| Geometry | **16 × 16 pixels, 4 bitplanes, plane-major** (plane 0's sixteen big-endian words, then plane 1's, …) | `AreaPtSz = −4` + `AreaPtrn` semantics above |
| Entries used | **12** (indices 0-11) | every display list in all 18 files |
| Palette | slot 2, file `0x1949C` (hunk 69 `+0x74`), native Amiga `component × 17` decode | `pea $74.l; jsr <SetPalette>` at `game+0x16FB8` and `game+0x1793E`, the only two palette sites in the world-map hunk |
| Screen placement | pattern tiles the raster from the RastPort origin: `pixel(x,y) = icon[y mod 16][x mod 16]` | `AreaPtrn` is origin-aligned, not shape-aligned |

**The icon index *is* the terrain class — verified cell-for-cell.**
Rasterising each of the 18 display lists (background `RectFill` of
`(4, 15, 312, 180)`, then each group as an even-odd-filled polygon) and
sampling the result at each grid cell's own screen rectangle
(`x = engineRow·12 + 4 = (25 − fileRow)·12 + 4`, `y = col·9 + 15`, from
`MarkerRect()` at `game+0x16EB8`, cell size 12 × 9 — the routine is written
in engine rows, so file row 0 lands at the *right*-hand edge) gives **9,271 / 9,328 = 99.4% agreement**
between the polygon's `iconIndex` and the cell's `tile / 10`, across all 18
sections (class 4 and 5 cells excluded — they are drawn as separate
markers, not fills). Per class the match is 93-100%; the residue is
polygon-edge sampling, not disagreement. The transposed placement
hypothesis scores **42.5%** on the same test.

The background index is `10` in all 18 files, and class 10 is the ocean —
so the engine floods the map with sea and then fills the land polygons on
top, which is exactly what the rendered output looks like.

**Marker overlay.** Towns, inns and dungeons are *not* in the display list.
`game+0x1702C` rescans the whole 26 × 20 grid after the fills and builds
three 4-word `(x, y, w, h)` rectangles at BSS `hunk58+0x238` / `+0x240` /
`+0x248` via `MarkerRect()`, which `game+0x171AE`-`0x1722A` then draws with
a marker-type argument of `0`, `1`, `2` respectively:

| Marker | Cell test | Manual key (p. 18) |
|---|---|---|
| 0 (`$238`) | class 4, variant ≠ 1 → tile `40` | Town |
| 1 (`$240`) | class 4, variant = 1 → tile `41` | Inn |
| 2 (`$248`) | class 5 | Dungeon |

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

> **Correction (2026-08-11) — the mosaic is 5 wide × 4 tall, not 4 × 5.**
> The arithmetic above is unchanged and still confirmed; what was wrong is
> which compass axis the `4·` term belongs to. Per §8.2.1's correction the
> `dRow` argument is the **east-west** delta, so a step of **±4 sections is
> east-west** and ±1 is north-south. `ChangeSection`'s own arrival-coordinate
> arms fix the sign:
>
> ```
> 0x184E4  tst.w   26(a6)          ; dCol == 0  -> this was an east-west step
> 0x184E6  bne.b   0x184FC
> 0x184E8  tst.w   22(a6)          ;   dRow < 0 (west) -> arrive at A = 25
> 0x184EE  moveq   #25,d0          ;   dRow > 0 (east) -> arrive at A = 0
> 0x184FC  tst.w   26(a6)          ; else a north-south step
> 0x18502  moveq   #19,d0          ;   dCol > 0 (north) -> arrive at B = 19
> 0x18506  moveq   #0,d0           ;   dCol < 0 (south) -> arrive at B = 0
> ```
>
> so **`section − 4` is the eastern neighbour, `section + 4` the western,
> `section − 1` the northern, `section + 1` the southern.** The world is
> `4·25 + 26 = 126` cells **wide** (east-west) by `3·19 + 20 = 77` cells
> **tall** (north-south) — the same two numbers as before with their roles
> exchanged, which is why every seam statistic below is unaffected: the
> seam-pairing test compares section `k` against `k±1` and `k±4` either way,
> and can never distinguish the two labellings on its own.

With 18 shipped sections the mosaic is 5 columns east-west by 4 rows
north-south (west at the left, north at the top):

```
  (17)  13    9    5    1
   18   14   10    6    2
   19   15   11    7    3
  (20)  16   12    8    4
```

Sections 17 and 20 are addressable slots with no file. `game+0x182E2`
tests `cmpi.w #16` on the current section and refuses movement above it
with `"THE RIVER STYX"` (`game+0x187A0`) instead of the ordinary
`"THAT IS THE OCEAN"` (`game+0x187B3`), so the whole **westernmost column**
(17-20) is a deliberately walled-off region — consistent with sections
18/19's text:
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

> **Note on the walled-off column's placement.** The mosaic puts section 18
> immediately west of section 14 and section 19 west of section 15. The
> *data* cannot distinguish this from the alternative (18/19 one row
> further along): the relevant seam lines are uniform ocean in both
> sections, so both placements score 20/20. The placement above rests
> entirely on the `section − 4·dRow − dCol` arithmetic plus
> `ChangeSection`'s arrival-coordinate arms, both uniform for every
> section. **Confidence: confirmed** (code); the data is merely not
> contradictory.

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

#### 8.3.3a The twelve terrain classes, named — confirmed

> **Correction (2026-08-11):** the previous version of this table named only
> classes 4, 5, 6 and 10, filed classes `0,1,2,3,7,8,9,11` collectively as
> "bulk land, blob-shaped regions" at **rendered** confidence, and stated
> "terrain *art* is not indexed by these codes at all". The last claim is
> the one that was actually wrong: §8.2.4a shows the display list's
> `iconIndex` **is** the terrain class (99.4% cell-for-cell), so each class
> does have exactly one piece of art. Rendering those twelve icons, plus the
> Phantasie I rulebook's own terrain key, names all twelve.

Three independent oracles agree, and none of them is "it looks like":

1. **The rendered icon** (§8.2.4a — the class's own 16 × 16 art).
2. **The movement cost** at `game+0x18022`: `(class + 1) × 75` for classes
   0-3, flat `60` otherwise.
3. **The Phantasie I/II rulebook's terrain key** (p. 18, text layer
   extracted from `Phantasie_I_and_Phantasie_II_Rulebook_SSI_text.pdf` in
   the local manual archive), which lists exactly these categories:
   *Town/Inn*; *Dungeon*; *Path* — "travelling here is easy (passing
   through takes less time relative to the other types of terrain)";
   *Desert* — "easy travelling"; *Grassland/Forest* — "travelling is more
   difficult"; *Mountains/Hills* — "travelling is extremely difficult";
   *River/Lake* — "you must swim or cross a bridge".

| Class | Cells | Icon (bank index = class) | Cost | Name | Confidence |
|---|---|---|---|---|---|
| 0 | 2,509 | scattered bright-green dots on black | 75 | **Grassland** | **confirmed** |
| 1 | 938 | green foliage with brown trunks | 150 | **Forest** | **confirmed** |
| 2 | 508 | brown mounds with green tufts and grey highlights | 225 | **Hills** | **confirmed** |
| 3 | 658 | larger brown/grey rock masses | 300 | **Mountains** | **confirmed** |
| 4 | 22 | *(none — drawn as marker 0/1)* | 60 | **Town** (variant 0) / **Inn** (variant 1) | **confirmed**, §8.2.2a |
| 5 | 10 | *(none — drawn as marker 2)* | 60 | **Dungeon entrance** | **confirmed**, §8.2.2a |
| 6 | 240 | sparse grey speckle | 60 | **Path** | **confirmed** |
| 7 | 699 | grey speckle, denser diagonal pattern | 60 | **Mist** (astral plane / Olympus ground) | **rendered** + text |
| 8 | 403 | sparse orange dashes on black | 60 | **Desert** | **confirmed** |
| 9 | 429 | dense orange dashes on black | 60 | **Desert** (second art variant) | **confirmed** |
| 10 | 2,941 | cyan wave bands | 60 | **Ocean** — tile `100` impassable at `game+0x17FBE` | **confirmed** |
| 11 | 3 | solid blue with cyan dashes | 60 | **Lake** | **confirmed** |

Notes on the three that are not a straight one-to-one with a manual entry:

- **Path (6) is cheaper than grassland (60 vs 75)** — the manual's "takes
  less time relative to the other types of terrain" is literally the code.
  An earlier draft read class 6 as "river or road" from its one-cell-wide
  shape alone; the art is grey gravel, not water, and rivers are class 10
  variant 1 / class 11.
- **Classes 8 and 9 are two art variants of *Desert*** — the manual pairs
  "Grassland/Forest" and "Mountains/Hills" the same way, one key entry per
  pair of classes.
- **Class 7 appears only in `out18`/`out19`** (360 + 338 cells, plus one
  stray in `out8`), the astral plane and the plane of Olympus, whose own
  text reads `"THE GROUND IS COVERED WITH A DENSE MIST"`. It has no
  rulebook entry because those sections are past the River Styx.
- **Class 11 is three cells in the whole world** (`out5`, `out12`,
  `out14`) — the tiny inland lakes; the manual's "River/Lake" category
  otherwise resolves to class 10 variant 1 (passable water; only
  `tile == 100` is refused).

Terrain art is therefore indexed by the class after all — the same role
Phantasie III's `.set` map byte plays (an X pixel-column into a bundled
terrain-band picture, `graphics-formats.md` §5.3), just reached through the
per-section display list instead of directly. What P1's byte does *not*
index is a per-cell tile bitmap: the art is a 16 × 16 fill pattern applied
to polygons, so cell boundaries are invisible on screen.

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

### 8.6 Phantasie II (Atari ST) — the same world-map format, two constants changed

Phantasie II ships an exact structural counterpart to §8.2/§8.3:
`disk1/MAPS.INT` (8,840 bytes), `disk1/TWNS.INT` (13,900 bytes) and
**seventeen** `disk2/OUT*.DAT` files of 3,000 bytes each, numbered
`1,2,3,5,6,7,8,11,12,17,18,22,26,27,28,30,31`.

All offsets below are cited as `PHANT.PRG` **addresses**; the file offset is
`address + 28` (the GEMDOS 28-byte header — see
`game-re-tooling/atari-st.md`). Disassembly was done with Capstone, the
technique established in `graphics-formats.md` §10.

> **Correction (2026-08-10):** `stx-extraction.md` §6 closes with "**There
> is no known pristine P2 counterpart for `OUT*.DAT`** (unlike `TWNS.INT`)"
> and reads the sparse `OUT*.DAT` numbering as evidence that "only outposts
> a specific playthrough actually visited get written." Two corrections:
>
> 1. **There is a pristine counterpart: `MAPS.INT`.** It is exactly
>    17 × 520 bytes and each block is byte-identical to the corresponding
>    `OUT*.DAT`'s leading 520 bytes (§8.6.2, 17/17). So the *terrain grids*
>    in the shipped `OUT*.DAT` files are pristine, whatever else in those
>    files is not.
> 2. **The sparse numbering is a fact about the world's shape, not about a
>    playthrough.** `MAPS.INT` — a shipped, never-written master — contains
>    exactly those same 17 sections and no others, so 17 *is* the complete
>    set. The 15 missing mosaic slots are unreachable by construction: every
>    section edge facing one is impassable ocean (§8.6.3, 29/30 edges pure).
>
> The rest of that section's evidence stands unchanged and is not in
> dispute: the shared `"ENDING SEQUENCE"` residue block and `OUT1.DAT`'s
> embedded GEMDOS directory entries are real save-write residue. They sit in
> the region **past** the display-list terminator (`OUT1.DAT`'s list ends at
> 2,460; the directory entries begin at `0x400` = 1,024, inside the
> 995-1500 dead gap) — i.e. in bytes the engine never reads back. The
> engine does rewrite these files on every section exit; it just had not
> disturbed any shipped section's terrain grid.

#### 8.6.1 `OUT*.DAT` — a fixed 3,000-byte record — confirmed

`LoadOutFile(section)` at addr `0x4B88` builds the filename with `sprintf`
from `"OUT%-d.DAT"` (addr `0x1FC41`) and calls the shared
open/read-or-write/close helper at addr `0x13526` with a length immediate of
`#$BB8` (3,000):

```
0x4B90  move.l  #$1fc41,-(a7)        ; "OUT%-d.DAT"
0x4BA8  move.w  #$bb8,-(a7)          ; length 3000
0x4BAC  move.l  $248b6.l,-(a7)       ; the single section buffer
0x4BBA  jsr     $13526.l
```

`SaveOutFile` at addr `0x4C8C` is the identical call with the mode word set
to `1` and the format string at addr `0x1FC4C`. The buffer itself is one
`GEMDOS Malloc(3000)` (`move.l #$bb8,(a7); move.w #$48,-(a7)` at addr
`0x4B4C`), so **file offsets and buffer offsets are the same thing**, exactly
as in Phantasie I.

| Offset | Size | Region | Reader | Confidence |
|--------|------|--------|--------|-----------|
| `0x0000` | 520 | Terrain grid, **20 wide × 26 tall** | `GetTile` addr `0x48E6` | **confirmed** |
| `0x0208` | 75 | Point-of-interest table, **15 × 5 bytes** | addr `0x6528` | **confirmed** |
| `0x0253` | 400 | Text block, **10 slots × 40 bytes** | addr `0x615E` | **confirmed** |
| `0x03E3` | 505 | Unexplained gap / authoring residue | never read | **confirmed as residue** |
| `0x05DC` | ≤1500 | **Map display list** | addr `0x5028` | **confirmed** |
| after terminator | rest | Authoring residue | never read | **confirmed as residue** |

**The first 995 bytes are byte-for-byte the same layout as Phantasie I's.**
The only two differences in the whole format are the record size
(3,000 vs 2,500) and the display-list offset (1,500 vs 1,000).

`GetTile(col, row)` at addr `0x48E6` is instruction-for-instruction P1's
(`game+0x16C7C`):

```
0x48EA  moveq   #$1a,d0        ; 26
0x48EC  sub.w   $a(a6),d0      ; 26 - row
0x48F0  subq.w  #$1,d0         ; 25 - row
0x48F2  muls.w  #$14,d0        ; * 20            <-- row stride
0x48F6  add.w   $8(a6),d0      ; + col
0x4904  add.l   $248b6.l,d0    ; + section buffer base
0x490A  move.l  d0,$2495c.l    ; cache the cell address (P1: $250)
```

so `byteOffset = (25 - engineRow) * 20 + col`, grid stored bottom-up, and
the party-movement bounds checks are `cmp.w #$19` (25) on the row and
`cmp.w #$13` (19) on the column at addr `0x6044`/`0x6052` — identical
constants to P1's.

The display-list pointer is set up once, at load time, as `buffer + 0x5DC`:

```
0x5308  move.l  d0,$248b6.l     ; Malloc(3000) result
0x530E  move.l  d0,$25b82.l     ; second global alias for the same buffer
0x5314  move.l  $248b6.l,d0
0x531A  add.l   #$5dc,d0        ; +1500
0x5320  move.l  d0,$1fbd0.l     ; display-list pointer
```

and the reader at addr `0x5028` walks exactly P1's grammar:

```
u16  backgroundIconIndex
repeat {
    u16 count            ; 0xFFFF terminates the list
    u16 iconIndex
    count × { u16 x; u16 y }
}
```

(`movea.l $1fbd0.l,a5; move.w (a5)+,d7` then the `cmp.w #$ffff` /
`adda.l count*4` loop at addr `0x504C`-`0x5070`).

**Verification.** Parsing all 17 files with this grammar at 1,500 succeeds on
every one: `backgroundIconIndex` is `10` in all 17 (the same value as all 18
P1 files), the `0xFFFF` terminator is found in bounds in all 17 (earliest
2,048 in `OUT30.DAT`, latest 2,916 in `OUT22.DAT`, always < 3,000), group
counts run 2-10 and point counts 133-346. Across all **4,276** plotted points
the `y` coordinate **never exceeds 199** (zero violations) and only 29 `x`
values (0.68%) sit past 319, the furthest at 323 — the same tight 320×200 fit
P1 shows. Parsing the same files at P1's offset of 1,000 fails on **all 17**.
Zero parse failures, zero heuristics.

`0x0000 + 520 + 75 + 400 = 995`, and the 505 bytes from 995 to 1,500 are
residue: every file carries a `0x0D`-prefixed `"ENDING SEQUENCE"` string
around offset 1,013 followed by `0x1A` and zero fill — the same stale
authoring line §8.2.3 records inside P1's text block. **Nothing in the
executable reads that range.** The buffer is reachable through exactly two
globals — `$248B6` (7 code sites: addrs `0x4906`, `0x4912`, `0x4BAE`,
`0x4CB4`, `0x530A`, `0x5316`, `0x53CA`) and its alias `$25B82`, set from the
same `Malloc` result at addr `0x530E` (7 code sites: addrs `0x5310`,
`0x6180`, `0x61E6`, `0x625C`, `0x652E`, `0x658C`, `0x6798`). All fourteen
were checked: the only displacements any of them applies are `0` (grid),
`0x208`/`0x26C` (POI scan bounds), `0x253` (text) and `0x5DC` (display
list). None lands in `[995, 1500)`.

#### 8.6.2 `MAPS.INT` (8,840 bytes) — 17 concatenated grids — confirmed, byte-exact

`8840 = 17 × 520`. Block `k` at file offset `k * 520` is byte-identical to
the leading 520 bytes of the `k`-th `OUT*.DAT` in **ordinal** (not numeric)
filename order:

| Block | Section | Block | Section | Block | Section |
|-------|---------|-------|---------|-------|---------|
| 0 | 1 | 6 | 8 | 12 | 26 |
| 1 | 2 | 7 | 11 | 13 | 27 |
| 2 | 3 | 8 | 12 | 14 | 28 |
| 3 | **5** | 9 | 17 | 15 | 30 |
| 4 | 6 | 10 | 18 | 16 | 31 |
| 5 | 7 | 11 | 22 | | |

Verified by exact substring match of each file's first 520 bytes at the
predicted offset — **17/17, zero mismatches**, and `17 × 520` accounts for
every byte of the file. This is the same "packed by ordinal over the files
that exist" convention P1 uses (§8.3.1), just far more visible here because
fifteen of the numbers are missing rather than two.

Like P1, `PHANT.PRG` contains no `MAPS.INT` string; the name appears only in
`BACKUP.RSC`'s companion utility. `MAPS.INT`'s Nov 1986 timestamp against
`OUT*.DAT`'s Oct 1995 is the same pristine-master / live-save-state split.

#### 8.6.3 How the sections tile — 4 wide again, but an 8-row mosaic

`ChangeSection(section, &row, &col, dRow, dCol)` at addr `0x66BA` is
instruction-for-instruction P1's `game+0x184BA`:

```
0x66C2  jsr     $4c8c.l        ; SaveOutFile(section) before leaving
0x66D0  move.w  $12(a6),d0     ; dRow
0x66D4  asl.w   #$2,d0         ; dRow * 4        <-- world is 4 sections wide
0x66D6  sub.w   d0,d7          ; section -= 4*dRow
0x66D8  sub.w   $14(a6),d7     ; section -= dCol
...
0x6706  moveq   #$19,d0        ; arrival row 25
0x670C  moveq   #$13,d0        ; arrival col 19
```

so **`newSection = section − 4·dRow − dCol`**, `section = mosaicRow * 4 +
mosaicCol + 1`, and adjacent sections **share one row and one column**
(arrival coordinates 0/19/25, not 1/18/24). Horizontal stride 19, vertical
stride 25 — every constant identical to P1.

The 17 section numbers therefore occupy a **4 × 8 mosaic** (32 slots, 15 of
them empty):

```
   1   2   3   .
   5   6   7   8
   .   .  11  12
   .   .   .   .
  17  18   .   .
   .  22   .   .
   .  26  27  28
   .  30  31   .
```

giving an assembled world of `4·19 + 1 = 77` cells wide by `8·25 + 1 = 201`
cells tall. Note the empty band at mosaic row 3 (sections 13-16): the world
is two separate landmasses, upper (sections 1-12) and lower (17-31).

> **Correction (2026-08-11) — the mosaic is 8 wide × 4 tall, not 4 × 8, and
> the landmass split is east-west, not upper/lower.** Identical premise to
> P1's own §8.2.1/§8.3.2 correction, and it applies here unchanged because
> this routine is instruction-for-instruction P1's: `dRow` (the `4·` term)
> is the **east-west** delta and `dCol` (the `±1` term) is **north-south**
> — not the reverse this section originally assumed. So `(section-1) % 4`
> is the north-south mosaic index (0 = north) and `floor((section-1)/4)`
> the east-west index, counted from the **east** (section 1 is the
> easternmost). P2 ships sections up to 31, past P1's 20-slot range, so the
> full mosaic (west at the left, north at the top, parenthesised slots ship
> no file) is:
>
> ```
> (29)(25)(21)  17(13) (9)   5   1
>   30  26  22  18(14)(10)   6   2
>   31  27(23)(19)(15)  11   7   3
> (32)  28(24)(20)(16)  12   8 (4)
> ```
>
> Mosaic index 3 (sections 13-16, all absent) is a missing **east-west**
> column, splitting the shipped sections into two landmasses **east and
> west** — not upper and lower. The assembled world is `7·25 + 26 = 201`
> cells wide (east-west) by `3·19 + 20 = 77` cells tall (north-south) — the
> same two numbers as before, roles exchanged, which is why the seam and
> edge-ocean statistics below are unaffected (they compare section `k`
> against `k±1` and `k±4` either way, structurally blind to which label is
> which).

**Data-side confirmation of the overlap.** Taking every mosaic-adjacent pair
among the 17 present sections and comparing the shared edge (a section's
column 19 against its right neighbour's column 0; its row 25 against its
lower neighbour's row 0) gives **440 shared cells across 19 seams**, of
which:

- **377 (85.7%)** agree on the exact tile code after normalising the `+120`
  bank;
- **438 (99.5%)** agree on the terrain class (the tile code's tens digit) —
  only **2 cells** disagree on class in the whole world.

That is a slightly *better* fit than P1's own 98.2% (§8.3.2).

**Data-side confirmation of the missing sections.** Every section edge that
faces a mosaic slot with no file is uniformly ocean (class 10, the most
common class at 3,716 of 8,840 cells): **29 of the 30 such edges are 100%
class 10**, and the one exception (section 31's east edge, facing the absent
32) is 25 of 26. The party physically cannot reach an absent section,
because the only cells from which it could step across are impassable
water. This is the mechanism, not an assumption — P2's movement code calls
`ChangeSection` unconditionally when the party leaves the grid, with no
"does that section exist" test anywhere.

Phantasie II **does** keep P1's "above section 16 is a different region"
gate. At addr `0x64AC`:

```
0x64AC  cmpi.w  #$10,$25ea0.l    ; current section vs 16
0x64B4  ble.w   $64d8
0x64B8  ...  OUT.RSC tree $0F    ; sections > 16  -> " THE RIVER STYX "
0x64D8  ...  OUT.RSC tree $11    ; sections 1-16  -> " THAT IS THE OCEAN "
```

(`$25EA0` is written with the section number by the load wrapper at addr
`0x6758`, immediately after it calls `LoadOutFile`.) The split falls exactly
on the boundary between the two landmasses. **Confidence: confirmed**, both
for the branch and — since 2026-08-10 — for the wording; see §8.6.3a.

> **Correction (2026-08-10):** the paragraph above previously read "The two
> ids index `PHANT.RSC` rather than being inline strings, so the exact
> wording was not recovered", and labelled them *message ids*. Both parts
> were wrong. They are **GEM object-tree indices**, and they resolve
> against **`OUT.RSC`**, not `PHANT.RSC` — `PHANT.RSC`'s trees 15/17 are a
> generic fill-in message box and the party equipment/sell list, which is
> what made the original reading look implausible. See §8.6.3a for the
> resolution and the byte evidence.

#### 8.6.3a The two refusal messages — confirmed, byte-exact

**`0x0F` and `0x11` are `rsrc_gaddr(R_TREE, …)` indices, not message ids.**
Both call sites push the same four-word argument list to a shared dialog
helper at addr `0x16DCE`:

```
0x64B8  move.w  $1fefa.l,(a7)     ; arg3 = message-delay setting
0x64BE  addi.w  #$3e8,(a7)        ;      + 1000  (milliseconds)
0x64C2  clr.w   -(a7)             ; arg2 = y   (unused when arg1 < 0)
0x64C4  move.w  #$ffff,-(a7)      ; arg1 = -1  -> form_center
0x64C8  move.w  #$f,-(a7)         ; arg0 = tree index 15
0x64CC  jsr     $16dce.l
```

`ShowTimedDialog(tree, x, y, timeoutMs)` at addr `0x16DCE` opens with

```
0x16DD6  move.w  $8(a6),-(a7)     ; arg0
0x16DDA  clr.w   -(a7)            ; type 0 = R_TREE
0x16DDC  jsr     $1abfa.l         ; rsrc_gaddr
```

and addr `0x1ABFA` is the AES `rsrc_gaddr` binding — it stores the two
words into `int_in[0]`/`int_in[1]` (`$25CE8`/`$25CEA`), sets the opcode word
to `#$70` (**112 = `rsrc_gaddr`**) at addr `0x1AC0E`, and copies `addr_out[0]`
(`$28336`) into the caller's pointer. So arg0 is an object-tree index and
arg1/arg2 are the dialog's screen position (`form_center` when negative,
addr `0x16DEC`). The tree is drawn by `objc_draw(tree, 0, 20, x, y, w, h)`
at addr `0x16E94`, then addr `0x16CBE` runs an `evnt_multi` loop
(`MU_KEYBD|MU_BUTTON|MU_TIMER` = `#$23`, addr `0x16D10`) with `arg3` as the
timer's low count — i.e. the box self-dismisses.

**Which resource file.** The AES bindings sit next to each other: addr
`0x1ABCE` stores its argument into `addr_in[0]` (`$25F54`) and issues opcode
`#$6E` (**110 = `rsrc_load`**); addr `0x1ABE8` issues `#$6F`
(**111 = `rsrc_free`**). `PHANT.PRG` calls `rsrc_load` exactly twice: with
`"phant.rsc"` (string addr `0x1FB56`) at addr `0x4386`, and with `"out.rsc"`
(string addr `0x1FCA6`) at addr `0x5730`. The second is the outdoor module's
own entry point (`rsrc_load` → `jsr $5274` → `jsr $5760`), paired with the
`rsrc_free` at addr `0x5750`. AES keeps exactly one resource file resident,
so tree indices inside the outdoor code resolve against **`disk2/OUT.RSC`**
— which is why `PHANT.RSC`'s trees 15/17 (a generic fill-in message box and
the party equipment/sell list) are irrelevant here.

Decoding `OUT.RSC`'s header and `rsh_trindex` array (§8.6.7) gives:

| Tree | File offset | Objects | Text |
|------|-------------|---------|------|
| `15` (`0x0F`) | `0x39B4` | `G_BOX` 22×3, then `G_TEXT` at (3,1) w=16 | **`" THE RIVER STYX "`** |
| `17` (`0x11`) | `0x3A2C` | `G_BOX` 27×3, then `G_TEXT` at (4,1) w=19 | **`" THAT IS THE OCEAN "`** |

Raw evidence, tree 15's object 1 at `OUT.RSC+0x39CC`:
`0000 FFFF FFFF 0015 0025 0000 00001CE8 0003 0001 0010 0001` —
`ob_type` `0x15` = `G_TEXT`, `ob_spec` `0x1CE8` = a `TEDINFO` whose
`te_ptext` is `0x07F6`, and `OUT.RSC+0x07F6` holds
`" THE RIVER STYX "\0`. Tree 17's object 1 at `+0x3A44` has `ob_spec`
`0x1D20` → `te_ptext` `0x082E` → `" THAT IS THE OCEAN "\0`.

So Phantasie II ships **the same two strings as Phantasie I, with the same
polarity**: sections 1-16 (the upper landmass) get `"THAT IS THE OCEAN"`,
sections above 16 (the lower landmass) get `"THE RIVER STYX"`.

Two independent consistency checks:

- **Neither tree contains a button or any other clickable object** — just a
  `G_BOX` and one `G_TEXT`, which is only viable because the dialog is
  dismissed by the timeout/keypress loop at addr `0x16CBE`, exactly as the
  call site's fourth argument implies. Only four of `OUT.RSC`'s 44 trees are
  a bare box + one text line (11, 15, 17, 40), and the other two — 11 and 40
  — carry `"1234567890…"` placeholder text, i.e. they are the *runtime-filled*
  one-line message boxes. Trees 15 and 17 are the only two-object trees in
  the file whose text is final English prose, which is what a hard-coded
  refusal message has to be.
- **The delay word is real and settable.** `$1FEFA` (data segment; file
  offset `0x1FF16`) holds `10` in the shipped binary, and the outdoor
  `Speed` menu handler at addr `0x1739E` writes `5` / `10` / `1000` into it
  for menu entries 0/1/2 — matching `OUT.RSC` tree 0's
  `'   fast   '` / `'   normal '` / `'   slow   '` entries, with `normal`
  carrying the `SELECTED` state bit. The refusal box therefore stays up for
  `1000 + delay` ms.

**What actually triggers it.** The refusal is *not* a section-boundary
check — it is the impassable-water test inside `MoveParty` (addr `0x6022`):

```
0x060C6  jsr     $6792.l          ; tile = GetTileAt(row, col)
0x060CE  move.w  d0,-$6(a6)
0x060D2  cmp.w   #$64,d0          ; tile == 100 ?
0x060D6  beq.w   $64a4            ; -> refusal, party does not move
...
0x064A4  tst.w   -$a(a6)          ; did we just cross a section boundary?
0x064A8  bne.w   $6518            ; yes -> silent, no message
0x064AC  cmpi.w  #$10,$25ea0.l    ; no  -> pick the message by section
```

`GetTileAt` at addr `0x6792` reads `buffer[500 − 20·row + col]` and returns
the raw byte, so the test is against the **revealed** code `100` — class 10,
variant 0 — which `RevealBox` (addr `0x588E`) has already un-banked from
`220` by subtracting `120`. Ocean is by far the commonest tile in the P2
world (**2,433 of 8,840 cells are exactly `100`**), and every edge facing
an absent mosaic slot is made of them, which is the mechanism §8.6.3
describes. Note the `tst.w -$a(a6)` guard: if the party stepped *across* a
section boundary onto water, `ChangeSection` has already run and the
refusal is silent.

#### 8.6.4 POI table, text block and tile codes — all identical, and a stronger town/dungeon result

The POI scan at addr `0x6528` is P1's `game+0x18340` line for line:

```
0x652C  move.l  $25b82.l,d0
0x6532  add.l   #$208,d0        ; buffer + 520
...
0x6544  move.b  (a0),d0
0x6548  cmp.w   $25d1c.l,d0     ; record[0] vs current column
0x6566  move.b  $1(a0),d0
0x6570  moveq   #$19,d1
0x6572  sub.w   $25d1a.l,d1     ; 25 - current row
0x6578  cmp.w   d1,d0           ; vs record[1]
0x6586  addq.l  #$5,-$4(a6)     ; stride 5
0x658A  move.l  $25b82.l,d0
0x6590  add.l   #$26c,d0        ; give up at buffer + 620
```

— same 5-byte stride, same `25 - row` comparison, and the **same latent
over-read**: the scan limit 620 is 20 slots past the start, not 15.
Failure raises a GEM alert (`"[1][   Event not found !  ][   try to fix   |
  the position  ]"`, addr `0x1FCA2`) — the ST dialect of P1's
`"EVENT NOT FOUND!"`.

The text renderer at addr `0x615E` has the same three-way length encoding
(`muls.w #$28` then `adda.l #$253` at addr `0x6178`/`0x61DE`/`0x6254`;
`cmp.w #$a` and `cmp.w #$14` branch points; the two-line arm adds `#$FFF6`,
i.e. −10). `RevealBox` at addr `0x588E` uses the same `+120` unexplored
flag (`cmp.w #$78` / `add.w #$ff88` at addr `0x58A4`/`0x58AE`, writing back
through the cell-address cache at `$2495C`).

**Verification against the real files** (71 non-empty, in-range POI records
across the 17 sections):

- **Towns.** Tile `40` occurs in exactly **10** sections, one cell each, and
  each has a POI record whose `+2` byte is a **distinct value in 1..10** —
  ten towns, ten consecutive ids, `+3` always 0. This is a materially
  cleaner result than P1's (nine small values plus an outlier `99`) and
  upgrades the shared "**`+2` is a town index**" reading from hypothesis to
  near-certain. `TWNS.INT` still lists twelve names, so two slots go unused.
- **Dungeons.** Tile class 5 occurs on **15** cells whose POI `+2` bytes take
  exactly **8 distinct values, 1..8** — and Phantasie II ships exactly eight
  dungeon files, `DNG1`-`DNG8` (§7). One of them (`OUT28.DAT`, id 7) is a
  ring of **eight** cells around a single entrance, the same authoring
  pattern §8.2.2 records for P1's `out1.dat`. `+3`/`+4` are non-zero **only**
  on class-5 records here too — see §8.6.4a, which identifies them.
- **Text features.** Every POI record sitting on a tile whose ones digit is
  `6` — 42 records — resolves through `messageSlotsForIndex` to at least one
  non-empty text line: **42/42, zero failures, zero out-of-range slots.**
  Worked example, `OUT6.DAT` `(14,22)` with `+2 = 20`: three lines from slot
  0 — `"THERE IS A SMALL STONE CASTLE"` / `"SET ON THE EDGE OF THE WATER,"` /
  `"BUT THERE IS LITTLE ACTIVITY."`.
- Four records fall outside those classes: two with `+2` of 72/73 on tile
  97, one on tile 100 at `(0,0)` and one on tile 72 — resolved 2026-08-10,
  see §8.6.4b.

#### 8.6.4a POI `+3` / `+4` — the dungeon entry coordinates — confirmed

`+3` and `+4` are read at exactly one place in `PHANT.PRG`: the dungeon-entry
handler at addr `0x10698`, on the branch `MoveParty` takes when the tile's
class is 5 (`0x63B6`: `cmp.w #$5,d0; beq $6392`, returning code 13).

```
0x106DA  jsr     $6528.l          ; POIScan() -> d0 = &record
0x106E0  addq.l  #$2,d0
0x106EA  move.b  (a0),d0          ; record[+2]
0x106F2  move.w  d0,$25f7a.l      ;   -> dungeon id (which DNGn to load)
0x10700  move.b  (a0),d0          ; record[+3]
0x10708  move.w  d0,$25ea2.l      ;   -> dungeon column x
0x1070E  move.w  d0,$25d1a.l
0x1071C  move.b  (a0),d0          ; record[+4]
0x10724  move.w  d0,$25ea4.l      ;   -> dungeon row y
0x1072A  move.w  d0,$25d1c.l
0x1073A  jsr     $4c8c.l          ; SaveOutFile before descending
```

`$25D1A`/`$25D1C` are the generic party-position pair, **used with swapped
roles by the two modes**: outdoors `$25D1A` is the row and `$25D1C` the
column (§8.6.1); in the dungeon `$25D1A` is `x` and `$25D1C` is `y`. The
dungeon movement code at addr `0x10888` proves it — it bounds-checks the
`$25D1A`-derived value against `#$21` (33) and the `$25D1C`-derived one
against `#$26` (38), then calls `GetDungeonCell(x, y) = grid[y*33 + x]`
(addr `0x1066C`, `muls.w #$21`), which is §3's 33 × 38 grid exactly.

**Verification against the real files.** Across all 15 class-5 records,
`+3` ∈ 0..32 and `+4` ∈ 0..37 with **zero out-of-range values** — the exact
domains of a 33-column × 38-row dungeon grid, and two different ceilings
that a single "unknown small number" field would have no reason to respect.

Stronger still, `OUT28.DAT`'s eight-cell ring (dungeon id 7) maps to eight
distinct perimeter cells of `DNG7`, rotated a quarter turn:

| Outdoor cell | offset from ring centre `(13,7)` | `+3`,`+4` (dungeon x,y) |
|---|---|---|
| `(12,6)` | `(−1,−1)` | `29, 0` |
| `(13,6)` | `( 0,−1)` | `32,18` |
| `(14,6)` | `(+1,−1)` | `29,37` |
| `(14,7)` | `(+1, 0)` | `16,37` |
| `(14,8)` | `(+1,+1)` | ` 3,37` |
| `(13,8)` | `( 0,+1)` | ` 0,18` |
| `(12,8)` | `(−1,+1)` | ` 3, 0` |
| `(12,7)` | `(−1, 0)` | `16, 0` |

Eight outdoor cells around one entrance, eight positions around the dungeon
edge, in cyclic order, centred on `(16,18)` — the middle of a 33 × 38 grid.
The party enters `DNG7` from whichever side it approached. **Confidence:
confirmed.**

#### 8.6.4b The four "stale" POI records — resolved

The complete list of code paths that read the POI table is short and now
fully enumerated. `POIScan` (addr `0x6528`) is the **only** reader of the
`+0x208` region (§8.6.1's fourteen buffer-global sites), and it has exactly
four callers, found by a whole-text `jsr $6528.l` byte scan
(`4E B9 00 00 65 28`): addrs `0x615E`, `0x62DE`, `0x640A`, `0x106DA`. The
dispatch that reaches them, all inside `MoveParty` at addr `0x6022`:

| Condition | Addr | Uses POI? |
|---|---|---|
| `tile == 100` | `0x64A4` | no — refusal (§8.6.3a), party does not move |
| `variant == 6` | `0x615E` | **yes** — text message |
| `variant == 7` | `0x62DE` | **yes** — fixed encounter |
| `variant == 8` | `0x630C` | no |
| `class == 5` | `0x6392` → `0x106DA` | **yes** — dungeon entry |
| `class == 7` or `11` | `0x6338` | no — random-encounter roll |
| `class == 8` | `0x6398` | no |
| `tile == 40` | `0x640A` | **yes** — town entry |
| `tile == 41` | `0x6438` | no |
| `class == 10` | `0x645E` | no |
| anything else | `0x6464` | no — random-encounter roll |

The variant test runs *before* the class test (addr `0x6316` then `0x632E`),
which is why a tile like `97` takes the variant-7 arm despite its class.

**Two of the four are live, not stale: variant 7 is a scripted fixed
encounter.**

```
0x62DE  jsr     $6528.l          ; POIScan()
0x62E6  move.b  $2(a0),d0        ; record[+2]
0x62EC  addq.w  #$1,d0
0x62F2  move.w  d0,$2832c.l      ; encounter id (1-based)
0x62F8  jsr     $afb6.l          ; enter combat
0x62FE  move.w  #$1,$25f60.l
0x6306  moveq   #$b,d0           ; return 11
```

`$2832C` is the 1-based encounter id: `SetupEncounter` at addr `0xA72E`
computes `d4 = id − 1`, clamps `d4` to `0..0x4F` (79), and then indexes the
monster template table with `d4 * 58 + $1FF0E` (addrs `0xA7EC`, `0xA826`,
`0xA84A`) — address `0x1FF0E` is file offset `0x1FF2A`, the confirmed
80-entry monster table of `data-tables.md` §2.1. So the POI `+2` byte on a
variant-7 cell **is the monster index directly**. Two further corroborations:
the sibling random-encounter path at addr `0x6356` builds `$2832C` the same
1-based way (`… + 1`), and addr `0x7292` clamps a zero `$2832C` up to `1`.

The two records:

| File | Cell (col, rowB) | Tile | `+2` | Encounter id | Monster |
|------|------------------|------|------|--------------|---------|
| `OUT2.DAT` | `(10, 5)` | `97` | `72` | `73` | `"PLUTO'S UNDEAD SNAKE"` |
| `OUT5.DAT` | `(10, 22)` | `217` → `97` | `73` | `74` | `"PLUTO'S DEMON-FLY"` |

Both resolve into the endgame `"PLUTO'S …"` block (indices 72-79, ending at
`79 = "PLUTO"`), which is exactly what a hand-placed set-piece encounter on
the world map should look like. And the world contains **exactly two
variant-7 cells in all 8,840** — both of them these. **Confidence:
confirmed.**

**The remaining two are genuinely inert.**

- **`OUT1.DAT` slot 14, `(0,0)` on tile 100.** Its five bytes are
  `00 00 00 00 20` — only `+4` is non-zero, and that byte is at file offset
  **594**, immediately before the text block at 595, whose first line in this
  file is `"            'THE OASIS'"` — i.e. a run of spaces. It is one
  stray `0x20` bleeding backwards out of the 40-column text block, not an
  authored record; slot 14 is all-zero in the other 16 files. Even taken at
  face value it addresses grid byte 0, which is tile `100` — the refusal
  path (§8.6.3a) fires before any POI lookup, so the party can never stand
  there. **Confidence: confirmed (not a record).**
- **`OUT17.DAT` slot 1, `(6,5)` on tile 72.** Payload `06 05 00 00 00`. Its
  neighbours are slot 0 = `(5,5)` on tile `170`→`50` (the `DNG5` entrance)
  and slot 2 = `(5,6)` on tile `196`→`76` (text slot 0,
  `"THERE IS A LARGE CAVE ENTRANCE HERE"`). The cell at `(6,5)` carries
  `192`→`72` — class 7, variant 2 — which dispatches to the random-encounter
  roll and never touches the POI table. The most economical reading is an
  authoring slot for a second cave-mouth cell whose terrain byte was never
  changed from `72` to `76`; either way **nothing in `PHANT.PRG` can reach
  it.** **Confidence: confirmed inert** (mechanism), **hypothesis** (intent).

**Reverse check.** Sweeping all 8,840 world cells for tiles that *would*
consult the POI table (`variant 6`, `variant 7`, `class 5`, `tile 40`,
after removing the `+120` fog bank) and looking each up in its section's POI
table: **69 of 69 have a record, 0 misses.** The POI tables hold exactly 71
non-empty in-range records; 69 live + the two above. There is no third
category.

#### 8.6.5 `TWNS.INT` (13,900 bytes) — same record array as P1

The same scan as §8.1 finds twelve town names at a **constant 292-byte
(`0x124`) stride**, each 10 space-padded ASCII bytes at offset `0x62` (98)
within its record, with the array starting at file offset **`0x0A44`** —
*every one of those constants identical to Phantasie I's*, despite the file
being 900 bytes longer. The roster is Phantasie II's own: `PIPPACOTT`,
`HASLEMERE`, `SAXLINGHAM`, `LLITHFAEN`, `IPSWICH`, `FERRON`, `BLACK MOOR`,
`DEATHPORT`, `DEMONIAC`, `DARK ABYSS`, `STARVILLE`, `OLYMPIA`. The same
`"WATER"`/`"EARTH"` elemental fragments appear in the trailing region
(offsets 13,534 and 13,852) that §8.1 flags as not-a-town-record in P1.
**Confidence: confirmed** for the stride, name offset, array base and
roster; **open** for every other field, exactly as in P1.

#### 8.6.6 Decoder

`src/assets/formats/outdoor.ts` now covers both games through an
`OutdoorLayout` record (`PHANTASIE1_OUTDOOR` / `PHANTASIE2_OUTDOOR`); every
function keeps its Phantasie I default, so existing callers are unchanged.
Real-byte tests are in `src/assets/formats/__tests__/outdoor-p2.test.ts`
(17 tests over the actual extracted floppy files). **Not wired into the
asset pipeline** — `tools/phantasieii/build-assets.ts` was deliberately left
alone this pass.

`src/assets/formats/gem-rsc.ts` decodes the GEM `.RSC` resource files
(§8.6.7), with 21 real-byte tests in
`src/assets/formats/__tests__/gem-rsc.test.ts`. Also not wired into the
pipeline.

#### 8.6.7 GEM `.RSC` resource files — confirmed

`.RSC` is the **Atari TOS operating system's** resource-bundle format, not a
Phantasie format: `rsrc_load()` maps one into memory and the program then
addresses its contents by numeric index through `rsrc_gaddr()`. This project
had no coverage of it before 2026-08-10; it is documented here because P2's
world-map code reaches two of its strings (§8.6.3a).

Three files ship with Phantasie II:

| File | Bytes | Loaded by | Trees | Free strings |
|------|-------|-----------|-------|--------------|
| `disk2/PHANT.RSC` | 16,008 | `PHANT.PRG` addr `0x4386` (`"phant.rsc"`, string addr `0x1FB56`) | 26 | 15 |
| `disk2/OUT.RSC` | 19,652 | `PHANT.PRG` addr `0x5730` (`"out.rsc"`, string addr `0x1FCA6`) | 44 | 1 |
| `disk1/BACKUP.RSC` | 3,764 | `UTILIT2.PRG` | 11 | 0 |

Only one is resident at a time (`rsrc_free` at addr `0x5750`), so **a tree
index in the disassembly is meaningless until you know which file the
enclosing module loaded** — the trap that produced §8.6.3's original wrong
reading. `PHANT.RSC` covers the town/guild/bank/shop/character UI;
`OUT.RSC` the outdoor world map; `BACKUP.RSC` the standalone
character-transfer utility (and confirms the P1↔P2 character-transfer
feature: `"FROM PHANTASIE 1 TO PHANTASIE 2"`, tree 0 object 8).

All fields are big-endian. **Every offset stored in the file — including
`ob_spec` and `te_ptext` — is a plain byte offset from the start of the
file**, so they can be followed directly on disk; the AES relocates them
into real pointers at load time.

**Header (`RSHDR`, 18 × `u16` at offset 0):**

| Offset | Field | `PHANT.RSC` | `OUT.RSC` |
|--------|-------|-------------|-----------|
| `0x00` | `rsh_vrsn` | 0 | 0 |
| `0x02` | `rsh_object` — `OBJECT` array | `0x2530` | `0x2E14` |
| `0x04` | `rsh_tedinfo` — `TEDINFO` array | `0x15FC` | `0x178C` |
| `0x06` | `rsh_iconblk` | `0x15FC` | `0x178C` |
| `0x08` | `rsh_bitblk` | `0x15FC` | `0x178C` |
| `0x0A` | `rsh_frstr` — free-string pointer array | `0x15C0` | `0x1788` |
| `0x0C` | `rsh_string` — string pool | `0x0024` | `0x0024` |
| `0x0E` | `rsh_imdata` | `0x15BF` | `0x1788` |
| `0x10` | `rsh_frimg` | 0 | 0 |
| `0x12` | `rsh_trindex` — tree pointer array | `0x3E20` | `0x4C14` |
| `0x14` | `rsh_nobs` | 266 | 320 |
| `0x16` | `rsh_ntree` | 26 | 44 |
| `0x18` | `rsh_nted` | 139 | 206 |
| `0x1A` | `rsh_nib` / `0x1C` `rsh_nbb` | 0 / 0 | 0 / 0 |
| `0x1E` | `rsh_nstring` | 15 | 1 |
| `0x20` | `rsh_nimages` | 0 | 0 |
| `0x22` | `rsh_rssize` | `0x3E88` | `0x4CC4` |

`rsh_trindex` is an array of `rsh_ntree` `u32` file offsets, one per tree —
this is what `rsrc_gaddr(R_TREE, n, …)` resolves. `rsh_frstr` is an array of
`rsh_nstring` `u32` file offsets to NUL-terminated `form_alert` templates
(GEM's `[icon][line|line|line][button|button]` syntax), reached with
`rsrc_gaddr(R_STRING, n, …)`.

**`OBJECT` (24 bytes), the tree node:**

| Offset | Size | Field |
|--------|------|-------|
| `0x00` | `i16` | `ob_next` — next sibling, `-1` = none |
| `0x02` | `i16` | `ob_head` — first child |
| `0x04` | `i16` | `ob_tail` — last child |
| `0x06` | `u16` | `ob_type` — class in the low byte (`G_BOX`=20 … `G_TITLE`=32) |
| `0x08` | `u16` | `ob_flags` |
| `0x0A` | `u16` | `ob_state` |
| `0x0C` | `u32` | `ob_spec` |
| `0x10` | `i16` | `ob_x` (character cells, parent-relative) |
| `0x12` | `i16` | `ob_y` |
| `0x14` | `i16` | `ob_width` |
| `0x16` | `i16` | `ob_height` |

`ob_spec` is a file offset to a bare NUL-terminated string for `G_BUTTON`
(26), `G_STRING` (28) and `G_TITLE` (32); a file offset to a `TEDINFO` for
`G_TEXT` (21), `G_BOXTEXT` (22), `G_FTEXT` (29) and `G_FBOXTEXT` (30); and
the character in its top byte for `G_BOXCHAR` (27).

**`TEDINFO` (28 bytes):** `te_ptext` (`u32` file offset to the displayed
string), `te_ptmplt`, `te_pvalid`, then font/justification/colour/thickness
and the two lengths. Only `te_ptext` is needed to recover text.

**Verification.** `rsh_rssize` equals the real file byte length on all
three files, and the section offsets chain exactly:
`rsh_frstr + 4·nstring == rsh_tedinfo`, `rsh_tedinfo + 28·nted ==
rsh_object`, `rsh_object + 24·nobs == rsh_trindex`, `rsh_trindex + 4·ntree
== rsh_rssize` — with one deviation, `BACKUP.RSC`, whose `nstring` is 0 and
whose `rsh_frstr` degenerates to a bare end-of-pool marker leaving 516
unused bytes before `rsh_tedinfo` (the other three links still close). All
44 + 26 + 11 trees walk without a malformed link, and the recovered strings
are coherent UI text throughout (menus, race/class pickers, the
`"WE DID IT AGAIN FOR YOU!"` ST-conversion credits in `PHANT.RSC` tree 24).
**Confidence: confirmed.**

Note that a `TEDINFO`-backed string in a *shipped* resource file is the
author's **placeholder**, not final content — `PHANT.RSC` tree 19 is the
character sheet and its fields read `"123456789 "`, `"LEVEL XX WIZARD
HALFLING OKAY"`, `"HIT POINTS XXX/XXX"`. The program overwrites them at
runtime. Only objects the game never rewrites (menu entries, the two
refusal boxes of §8.6.3a, static labels) carry real on-screen text.

## 9. Phantasie III `D/` files not covered by the reference tool

The reference tool's own bundled sample archive includes identically-named
files (`S1`-`S20`, `M0`, `M1`, `PLN1`-`PLN4`, plus a few `DNP*` files not
present in our `data/`) with **no corresponding C# parser class** — the
reference tool doesn't read these either. Everything below is this
project's own inspection of the real files in
`data/phantasieiii/amiga/D/`.

### 9.0 Phantasie III has no `out*.dat`/`maps.int` equivalent — confirmed

**Phantasie III's world map is `Graphics/phantasy.set`**, already solved and
documented in `graphics-formats.md` §5: a single global **50 × 75** map
array plus the terrain picture its cell values index by pixel column. There
is no per-section container, no section mosaic, and no section-transition
arithmetic anywhere in the engine — the P1/P2 `out*.dat` + `maps.int`
architecture simply does not exist in this game.

Searched exhaustively and found nothing: a scan of `PhantasieIII` for every
`D/`- or `Graphics/`-prefixed string yields the complete resource-name list

```
D/DNGX.DAT  D/DNGX  D/SXX  D/DNPX  D/PLNX  D/WX.cmp  D/MX  D/9
D/M0  D/M1  D/s6  D/PLN3  D/W3.cmp  D/W4.cmp
Graphics/{Anatomy1,Anatomy2,Dng,Scroll}.csh
Graphics/{Dlgbttns,giant1,giant2,heros,purple1,purple2,yellow1,yellow2,Title}.cmp
Graphics/Phantasy.set  gamesave.dat  Guild.dat  inititem.dat  monsinfo.dat
```

— no `OUT`, no `MAPS`, no `TWNS`. (`X`/`XX` are placeholders patched in
place at runtime; see §9.1.) The overworld is not, however, the game's only
map: `D/PLN1`, `D/PLN2` and `D/PLN4` turn out to be the **castle-interior
and Netherworld map arrays** (§9.0.3.4), loaded through a *second*,
previously-missed `D/PLNX` template.

Addresses in §9 are cited as `PhantasieIII` **hunk-0 addresses**; the file
offset is `address + 0x28` (the HUNK header — `game-re-tooling/amiga.md`).
The binary is 3 hunks: CODE (137,352 B at file `0x28`), a merged data+bss
DATA hunk, and a 4-byte hunk. Absolute-long operands in code that point at
globals are **hunk-1** offsets; operands pointing at strings/code are hunk-0
addresses.

Where P1/P2 keep overworld POI/text/display-list data in a side table, P3
has **no side table and no value-based dispatch at all** — see §9.0.5, which
solves the question and refutes the standing "the 26 single-occurrence map
values *are* the locations" hypothesis in its mechanistic form.

### 9.0.1 `D/W0.cmp`-`W4.cmp` — scene backdrops, not maps — confirmed

Five `.cmp` files sit in `D/` rather than `Graphics/`, which had left open
whether they were world-map art. They are not: decoding all five with the
already-confirmed `.cmp` container + RLE (`graphics-formats.md` §4) yields
five ordinary 320×200×4bpp pictures, each with its own embedded palette, all
type 2, all decompressing to exactly 32,000 bytes:

| File | Size | Palette | Rendered content |
|------|------|---------|------------------|
| `w0.cmp` | 13,696 | own | A horned, green-haired god enthroned amid dark red rock and skulls |
| `w1.cmp` | 13,696 | own | A white-bearded god in white robes on a golden throne amid clouds |
| `w2.cmp` | 10,496 | own | A red-skinned figure in a stone temple, skeletons strewn below |
| `w3.cmp` | 4,224 | **= `phantasy.set`'s** | Three shop/inn doorway panels side by side |
| `w4.cmp` | 17,280 | **= `phantasy.set`'s** | A town street with gatehouse, inn sign and shopfronts |

`w3`/`w4`'s embedded palettes are **byte-identical** to `phantasy.set`'s
(all 32 bytes) — they are the town-scene layer that shares the world map's
palette. `w0`-`w2` each carry their own.

Two of them are loaded by name literals rather than the `D/WX.cmp`
template: addr `0x777A` calls the file-loader at addr `0x123C` with
`"D/W4.cmp"` (addr `0x7DDF`), addr `0x778C` with `"D/W3.cmp"` (addr
`0x7DE8`); the template path patches its own byte 3 in place
(`movea.l $225e.l,a0; move.b #$32,$3(a0)` at addr `0x1DC70` → `D/W2.cmp`).
The strings sit next to `"Pluto."`, `"Zeus."`, `"evil"`, `"good"` and
`"Sitting before you is the God"` (addrs `0x6F41`-`0x6F58`), which matches
the rendered content exactly. **Confidence: confirmed** (rendered +
code-traced loader); the god-name↔file binding is **hypothesis**.

### 9.0.2 `D/M0`, `D/M1` — three-track music — solved, driver fully traced

> **Correction (2026-08-10):** §9.2 below recorded `M0` as "almost entirely a
> single repeated character (`0x3E`/`'>'`) … border/divider graphic asset or
> degenerate/mostly-empty table" and `M1` as "dense binary, purpose
> undetermined". Both are wrong. The `0x3E` run is trailing padding past the
> end of the data the game actually reads; these are **music files**.

`PlayMusic(filename, byteLength)` at addr `0x1FA5C`:

```
0x1FA60  pea     $3ed.w              ; MODE_OLDFILE (1005)
0x1FA64  move.l  $8(a5),-(a7)        ; filename
0x1FA68  jsr     $21418.l            ; Open
0x1FA7A  move.w  $c(a5),d0           ; byteLength
0x1FA82  move.l  $295c.l,-(a7)       ; fixed load buffer
0x1FA8C  jsr     $21432.l            ; Read
0x1FAA4  movea.l -$c(a5),a0          ; scan forward for the first 0xFF
0x1FAAC  cmpi.b  #$ff,(a0)
0x1FABA  movea.l -$10(a5),a0         ; scan forward for the second 0xFF
0x1FAC2  cmpi.b  #$ff,(a0)
0x1FACA  ...                         ; push ptr3, ptr2, ptr1
0x1FAD6  jsr     $1f52.l             ; play(track1, track2, track3)
0x1FAE4  jsr     $213e8.l            ; Close
```

i.e. the file is read whole, split at `0xFF` bytes into **exactly three
tracks**, and the three pointers handed to the player at addr `0x1F52`.

Call sites: addr `0x7426` loads `"D/M0"` (addr `0x7D5D`) with length
`#$33E` = **830**; addr `0x1EFE4` loads `"D/M1"` (addr `0x1F305`) with
length `#$293` = **659**.

**Verification, byte-exact:** within `m0`'s first 830 bytes the `0xFF`
bytes are at offsets **298, 623 and 829** — exactly three, with the third
landing on the *final* byte of the declared read length. Within `m1`'s first
659 bytes they are at **252, 454 and 658** — again exactly three, again the
last one on the final byte. A wrong length or a wrong separator could not
produce that. Each track opens with a short byte header (`m0`: `E2 07 E1 C2 20 C4 00 B4 DB
0C 06`; `m1`: `E2 06 C7 0E E1 C2 20 C4 00 C3 DB 0C 06`) and then runs as
2-byte pairs whose first byte behaves like a pitch. The 66 bytes of `m0`
past 830 (and 109 of `m1` past 659) are `0x3E` padding to a 128-byte
boundary, the same disk-block padding convention every `.cmp`/`.csh`/`.set`
file uses.

> **Superseded (2026-08-10):** the paragraph above previously ended
> "**Confidence: hypothesis** for the `(pitch, duration)` pair reading …
> the player routine was not traced", and §9.0.2's closing note listed the
> second byte's meaning and the tempo/pitch mapping as open. The player
> **has now been traced end to end** (§9.0.2.1-§9.0.2.6): the pair reading
> is confirmed, the second byte is a duration in units of a per-song
> multiplier, and the pitch mapping is a stored Amiga period table. The
> per-track "headers" that made the pairing look inconsistent are not
> headers at all — they are ordinary in-stream commands from the same
> byte grammar (§9.0.2.3).

**Confidence: confirmed** that `M0`/`M1` are three-track music streams with
`0xFF` track separators and the cited read lengths.

#### 9.0.2.1 The driver — a vertical-blank ADSR Paula player — confirmed

The whole music subsystem is three routines plus five stored tables. All
addresses are `PhantasieIII` hunk-0 addresses (file offset = addr + `0x28`)
unless prefixed *hunk-1*; hunk-1 offset `X` is file offset `0x278C8 + X`
for `X < 0x277C`, and BSS above that.

| Routine | Addr | File offset | Role |
|---|---|---|---|
| `MusicStart(t1,t2,t3)` | `0x1F52` | `0x1F7A` | Reset all per-track state, install the three stream pointers, silence Paula, set the run flag |
| **Tick** | `0x2192` | `0x21BA` | One call per video frame; advances all three tracks |
| Per-track tick | `0x21E4` | `0x220C` | Called from the tick with `d3 = track*2`, `a6 = stream pointer` |
| Event fetch | `0x2280` | `0x22A8` | Reads the next note pair or command |
| Envelope step | `0x2360` | `0x2388` | ADSR state machine, writes `AUDxVOL` |
| Command dispatch | `0x2436` | `0x245E` | Byte values `≥ 0x80` |
| Waveform init | `0x1E6C` | `0x1E94` | Allocates and fills the four instrument buffers |

**The tick is a real AmigaOS vertical-blank interrupt server, byte-exact.**
The installer at addr `0x0D4A` allocates 22 bytes (`pea $16.w; pea $1.w;
jsr $2162A.l` = `AllocMem(22, MEMF_PUBLIC)` — 22 is exactly
`sizeof(struct Interrupt)`), stores the pointer in hunk-1 `$293C`, and
fills the struct field by field at the canonical Exec offsets:

```
0x0D6A  move.b #$2,$8(a0)          ; ln_Type   = NT_INTERRUPT (2)
0x0D76  clr.b  $9(a0)              ; ln_Pri    = 0
0x0D80  lea    $dbc(pc),a1
0x0D84  move.l a1,$a(a0)           ; ln_Name   = "VertB-Timer"  (addr 0x0DBC)
0x0D88  lea    $2918.l,a0
0x0D94  move.l a0,$e(a1)           ; is_Data   = &frameCounter (hunk-1 $2918)
0x0D98  lea    $df8(pc),a0
0x0DA2  move.l a0,$12(a1)          ; is_Code   = 0x0DF8
0x0DAC  pea    $5.w
0x0DB0  jsr    $21456.l            ; AddIntServer(INTB_VERTB = 5, intr)
```

The literal string `"VertB-Timer\0"` sits at addr `0x0DBC` (file `0x0DE4`) —
the driver names itself. The teardown at addr `0x0DC8` mirrors it exactly
(`RemIntServer(5, intr)` at `0x0DD6`, then `FreeMem(intr, 22)` at
`0x0DE8`). The server body at addr `0x0DF8` saves `A4`, restores the SAS/C
small-data base via `jsr $20DB6.l`, increments a global frame counter
(`addq.l #$1,$2918.l`), and then `jsr $2192(pc)`.

**Therefore one tick = one video frame: 60 Hz on NTSC, 50 Hz on PAL.** SSI
was a US publisher and the period table below is NTSC-tuned (§9.0.2.2), so
60 Hz is the design rate.

> Note: the compiled function actually begins at addr `0x218E` with a
> `link.w a5,#$0`, but `0x218E` has **no reference anywhere in the binary**
> (checked by whole-file absolute-long search *and* a brute-force
> PC-relative `bsr`/`jsr`/`jmp`/`lea`/`pea` scan over the entire CODE hunk).
> The only entry is the interrupt server's `jsr` to `0x2192`, which skips
> the `link` — consistent with the routine's exit path at `0x21DE`
> (`movem.l (a7)+,d0-d3/a0-a2/a6; rts`) having no matching `unlk`. Entering
> at `0x218E` would leak a longword per frame.

#### 9.0.2.2 Stored tables — confirmed

All five live in the initialized part of hunk 1.

| Table | Hunk-1 offset | File offset | Shape | Contents |
|---|---|---|---|---|
| ADSR **attack**-rate | `0x0220` | `0x27AE8` | 16 rows × 16 words | Indexed `masterLevel*16 + nibble` |
| ADSR **decay/release**-rate | `0x0420` | `0x27CE8` | 16 rows × 16 words | Same indexing; serves both decay and release |
| **Volume** levels | `0x0620` | `0x27EE8` | 16 words | `0, 0x0433, 0x0866, … 0x3F00` — a linear 0-to-`0x3F00` ramp |
| **Period** table | `0x0640` | `0x27F08` | 87 words | `period = table[note − 9]`, notes 9-95 |
| Waveform primitives | `0x06EE` | `0x27FB6` | 3 × 8 bytes | Signed 8-bit single cycles (§9.0.2.5) |

**The period table is the classic Amiga/ProTracker table, byte-identical.**
Entries for notes 60-71 are `856, 808, 762, 720, 678, 640, 604, 570, 538,
508, 480, 453` — ProTracker's finetune-0 octave, verbatim. Note 72 = `428`
and note 48 = `1712` are its exact octave neighbours. Volumes are 16-bit
fixed point: Paula's `AUDxVOL` receives `value >> 8`, so `0x3F00 >> 8` =
**63**, the Amiga maximum.

**Pitch mapping — confirmed.** With eight samples per waveform cycle
(§9.0.2.5) the sounding frequency is `clock / (period × 8)`. On NTSC
(3,579,545 Hz) note **57** → `3579545 / (1016 × 8)` = **440.4 Hz = A4**, and
note 45 → 220.2 Hz, note 69 → 880.8 Hz. So the note byte is a plain
12-semitones-per-octave number with `note mod 12 == 0` = C:

> **`note` byte `N` → pitch name `["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][N mod 12]`, octave `N div 12`. Equivalently `N` = MIDI note `N + 12`.**

Note `0` is a **rest** (special-cased at addr `0x22D0`, before the period
lookup). The table's last two entries clamp at period `124`, Paula's
hardware minimum.

#### 9.0.2.3 Stream grammar — confirmed

The fetch loop at addr `0x2280` reads one byte and branches on its sign bit
(`bmi.w $2436`).

**Note event — `byte1 < 0x80`, always followed by a second byte:**

| Byte | Bits | Field | Notes |
|---|---|---|---|
| 0 | 0-7 | Note number | `0` = rest; otherwise `period = periodTable[note − 9]` (addr `0x22E0`, `sub.w #$9,d0` then clamp-to-0) |
| 1 | 7 | **Tie** flag | Sets `$29BC[track]`; suppresses the automatic note-off when the counter expires (addr `0x220E`) |
| 1 | 0-6 | **Duration** | In units of the current per-song multiplier |

Duration in frames (addr `0x22A4`): if the multiplier `$298C[track]` is not
1 the engine computes `d1 = (d1 + 1) × mult − 1`; the counter is then
decremented once per frame and the next event fetched on the frame it
reaches 0. So

> **`frames = ((byte1 & 0x7F) + 1) × multiplier`**, uniformly (the `mult == 1`
> shortcut leaves `dur`, i.e. `(dur+1) × 1` frames, the same formula).

**Commands — `byte1 ≥ 0x80`:**

| Code | Args | Effect | Addr |
|---|---|---|---|
| `0xC2` | 1 | Select waveform: arg `0x10`→W0, `0x40`→W1, `0x20`→W2, **anything else**→W3 (`AUDxLEN` = `0x7D0` words instead of `0x20`) | `0x257C` |
| `0xC3` | 2 | Ignored (2 bytes skipped) | `0x2626` |
| `0xC4` | 2 | **ADSR**: arg0 = `(Attack << 4) \| Decay`, arg1 = `(Sustain << 4) \| Release` | `0x2438` |
| `0xC7` | 1 | Master volume level 0-15: sets `$2814` (the ADSR rate-table **row**) *and* `$2816 = volTable[n]` | `0x24B6` |
| `0xCA` | 0 | Ignored | `0x26D2` |
| `0xCC` | 0 | Ignored | `0x26C8` |
| `0xCD` | 1 | Loop-1 counter := arg | `0x2510` |
| `0xCE` | 2 | Loop-1 end: `if (--counter) a6 -= be16(args)` (backward jump), else skip the args | `0x24E6` |
| `0xD1` | 1 | Loop-2 counter := arg (second, independent nesting level) | `0x254A` |
| `0xD2` | 2 | Loop-2 end, identical to `0xCE` | `0x2526` |
| `0xD3` | 0 | Vibrato on | `0x2668` |
| `0xD4` | 0 | Vibrato on (identical to `0xD3`) | `0x267E` |
| `0xDB` | 2 | Vibrato on, 2 arg bytes **skipped without being read** | `0x25D6` |
| `0xDC` | 0 | Vibrato off | `0x25EE` |
| `0xE1` | 0 | Waveform W0, `AUDxLEN` = `0x20` | `0x2604` |
| `0xE2` | 1 | Duration multiplier := arg — **for all three tracks at once** | `0x2560` |
| `0xE3` | 0 | Ignored | `0x265E` |
| `0xE4` | 0 | Ignored | `0x2630` |
| `0xE5` | 1 | Waveform W3, `AUDxLEN` = `0x7D0`, 1 arg byte skipped | `0x263A` |
| `0xE6` | 1 | Ignored (1 byte skipped) | `0x2694` |
| `0xE7` | 0 | **Song restart**: reload all three current pointers from the saved originals (`$2A00`→`$2A0C`), clear the three duration counters, pop the return address and leave the tick | `0x26A0` |
| `0xE8` | 1 | Duration multiplier `−=` arg (all three tracks) | `0x26DC` |
| `0xE9` | 1 | Duration multiplier `+=` arg (all three tracks) | `0x26F8` |
| `0xFF` | 0 | **End of track**: pointer := 0; the next tick's `cmpa.l #$0,a6` (addr `0x21E4`) clears that channel's DMA | `0x24D8` |
| *other* | 0 | Fallback at addr `0x2714`: points **audio channel 3** at a 4-byte blob at hunk-1 `0x0708`, `AUD3LEN=2`, `AUD3PER=0x7D0`, `AUD3VOL=0x40`, `DMACON = 0x8008` — a click — then keeps parsing | `0x2714` |

`0xE2`, `0xC7`, `0xE8` and `0xE9` write **global** state, not per-track
state; correspondingly, only one track per song carries them
(§9.0.2.6).

#### 9.0.2.4 Envelope and vibrato — confirmed

The envelope at addr `0x2360` is a four-phase ADSR run once per frame per
track, on a 16-bit volume accumulator (`$29B6[track]`) whose top byte is
written to `AUDxVOL`:

| Phase | Behaviour | Advance condition |
|---|---|---|
| 0 attack | `vol += attackRate`; rate 0 means "instant" | `vol ≥ masterVol` → clamp to `masterVol`, phase 1 |
| 1 decay | `vol -= decayRate`; rate 0 skips straight to phase 2 | `vol ≤ sustainLevel` → clamp to sustain, phase 2 |
| 2 sustain | `vol = sustainLevel` | Held until note-off |
| 3 release | `vol -= releaseRate` | `vol ≤ 0` → `vol = 0`, phase 4 (silent) |

Note-off is *not* driven by the stream: when the duration counter reaches 0
the per-track tick forces phase 3 (addr `0x2222`) — unless the tie bit of
the duration byte was set. A rest (note 0) jumps directly to phase 3.

Vibrato (addr `0x223C`, active only while `$29C8[track]` is set) is a pure
period wobble at a quarter of the frame rate: `depth = period >> 7`, and on
the global 0-3 frame phase (`$281A`) `AUDxPER` is written as
`period − depth` when the phase is 1, `period + depth` when it is 3, and
`period` otherwise.

#### 9.0.2.5 Instruments — four buffers, one of them generated noise — confirmed

`InitWaveforms` at addr `0x1E6C` allocates three 64-byte buffers plus one
4,000-byte buffer from the game's own bump allocator at addr `0x05CC`, and
stores the four pointers as longs at hunk-1 `$2AA6`, `$2AAA`, `$2AAE`,
`$2AB2` (BSS). `$29CE[track]` — what `0xC2`/`0xE1`/`0xE5` set — is the
**byte offset** into that pointer array (`0`, `4`, `8`, `0xC`).

The three 64-byte buffers are each filled with **eight repeats of an
8-byte signed primitive** (nested `0..7` × `0..7` loops at addr `0x1EB6`):

| Buffer | Selected by | Primitive at hunk-1 | Bytes | Shape |
|---|---|---|---|---|
| W0 `$2AA6` | `0xC2 10`, `0xE1` | `0x06FE` (file `0x27FC6`) | `00 35 7F 49 00 CB 81 B7` | rough sine |
| W1 `$2AAA` | `0xC2 40` | `0x06EE` (file `0x27FB6`) | `7F 7F 7F 7F 81 81 81 81` | square |
| W2 `$2AAE` | `0xC2 20` | `0x06F6` (file `0x27FBE`) | `00 2A 55 7F 81 AB D6 00` | triangle |
| W3 `$2AB2` | `0xC2` (any other arg), `0xE5` | *generated* | 4,000 bytes | **noise** |

Eight samples per cycle is what makes the period table sound an octave
above its ProTracker nominal (§9.0.2.2).

**W3 is pseudo-random noise generated at startup by the game's own RNG.**
The loop at addr `0x1F2E` runs `0x3E7 + 1` = 1,000 iterations, each storing
one longword from `jsr $1C24(pc)`, filling all 4,000 bytes. Addr `0x1C24`
is `seed = (seed × 0x6255 + 0x3619) mod 0x10000` — i.e.
`seed*25173 + 13849 mod 65536`, **the exact P3 LCG already independently
confirmed in `scripting-engine.md` §7.5**, reading and writing the same
global seed at hunk-1 `$291C`. Two subsystems traced from opposite ends of
the binary landing on the same seed word is a free cross-check on both.

#### 9.0.2.6 Verification — byte-exact over the whole corpus

A faithful re-implementation of the grammar above was run as a linear scan
over both files' declared read lengths:

| File | Declared read | Track lengths | Bytes consumed | Unknown command bytes |
|---|---|---|---|---|
| `m0` | 830 | 299 + 325 + 206 | **299 + 325 + 206** | **0** |
| `m1` | 659 | 253 + 202 + 204 | **253 + 202 + 204** | **0** |

Every one of the six tracks' scans lands exactly on its terminating `0xFF`
with **zero residue and zero unhandled command bytes across all 1,489
bytes** — a wrong argument count on any one of the 24 commands would
desynchronise the scan and could not land on the final byte six times out
of six.

Two independent confirmations fall out of the decoded content:

1. **Every duration byte in both files is odd (or 0).** Across all **705**
   notes the distinct values are `0, 1, 3, 5, 7, 9, 11, 15`, i.e.
   `dur + 1 ∈ {1, 2, 4, 6, 8, 10, 12, 16}` — powers of two plus their
   dotted (×1.5) values, exactly the durations a human composer writes.
   This is only true under the `(dur + 1) × mult` reading; the raw byte
   values themselves have no such property.
2. **The three tracks split into musical roles.** In `m0`, track 0 spans
   notes 52-69 (E…A, melody), track 1 spans 23-45 two octaves lower
   (bass), track 2 spans 36-69 with 8 rests (harmony). Rests occur only in
   the non-melody tracks. `m1` is the same shape.

The "per-track headers" that had made the pair reading look inconsistent
are ordinary commands: `m0` track 0 opens `E2 07 | E1 | C2 20 | C4 00 B4 |
DB 0C 06` = *multiplier 7; waveform W0; select W2; ADSR A=0 D=0 S=11 R=4;
vibrato on*. `m1` track 0 opens `E2 06 | C7 0E | E1 | C2 20 | C4 00 C3 |
DB 0C 06`. Consistent with `0xE2`/`0xC7` being global, **only one track per
song carries them** — `m1`'s tracks 1 and 2 start straight at `E1`.

So `m0` runs at 7 frames per duration unit and `m1` at 6, i.e. a base tick
of 116.7 ms and 100 ms at 60 Hz.

**Confidence: confirmed** for the driver, the tick source, the note/duration
encoding, the command set and argument counts, the period table and its
tuning, the ADSR, and the four instruments. **Hypothesis:** that `0xDB`'s
two skipped argument bytes (always `0C 06` in both files) are vibrato
depth/rate honoured by another platform's port of the same driver — this
Amiga build reads neither, and `0xD3`/`0xD4`/`0xDB` are three encodings of
one action here.

### 9.0.3 `D/PLN1`-`PLN4` — the castle and Netherworld maps — solved

> **Read §9.0.3.4 first — it supersedes this subsection's conclusions.**
> `D/PLN1`, `D/PLN2` and `D/PLN4` are Phantasie III's **castle-interior and
> Netherworld map arrays**, code-traced and byte-verified. §9.0.3 to
> §9.0.3.3 below are kept as the record of how that was arrived at, and
> because their structural measurements (grid dimensions, alphabet bands)
> remain correct and are what led to the solve.
>
> **Correction (2026-08-10):** §9.3 below reads the `PLN*` files' letter-like
> byte runs as "suggestive of small terrain/elevation grids", by analogy with
> P1's `out*.dat`. That analogy is refuted **as stated** — but note the
> refutation only rules out the *overworld's* value space, not "map array"
> as such; see §9.0.3.4.

`phantasy.set`'s 3,750-cell map array uses 196 distinct values
(`graphics-formats.md` §5.3). Of `pln1`'s 11 distinct values, **0 appear in
that set**; of `pln2`'s 11, **0**; of `pln4`'s 37, **1**. `pln1` uses
56, 59, 68-74; `pln2` uses 55, 58, 61-67; `pln4` uses 57, 60-67, 75-77 —
three narrow, largely non-overlapping bands, whereas `phantasy.set` uses
**nothing at all** in the range 55-80. Whatever `PLN*` encodes, it is not a
`.set`-style map array.

Structure that *was* recovered: `pln1` and `pln2` are 128 bytes each whose
first **81 bytes read cleanly as a 9 × 9 grid** (the only width at which the
non-filler bytes form a single connected, roughly symmetric blob rather than
a diagonal smear), with `0xF9` as the empty/filler value, followed by 47
bytes of `0x51` padding. `pln4` is 512 bytes, autocorrelating most strongly
at period 31/32. `pln3` is degenerate — 126 of its 128 bytes are `0x02`.

`PLN3` is the only one this Amiga build reads by name, through a dedicated
helper at addr `0x1F87E` that opens `"D/PLN3"` with `MODE_NEWFILE` (`$3EE`)
when its second argument is 3 and `MODE_OLDFILE` (`$3ED`) otherwise, then
transfers **2 bytes** (`pea $2.w` at addr `0x1F8CC`/`0x1F8E4`) and ANDs the
result with a caller-supplied mask — a small persistent flag word, not map
data. `PLN1`, `PLN2` and `PLN4` are reachable only through the indexed
filename table at hunk-1 offset `0x2656` (slot 4 = `"D/PLNX"`, read as
`lea $2656.l,a0; move.l (a0,d0.l),d1` at addr `0x20BE0`, with the 'X' byte
patched at addr `0x20BF2`), whose one caller-facing routine at addr `0x20BB4`
has **no callers anywhere in the binary** — it belongs to the embedded
character-transfer utility (`"To use these characters, select the…"`,
`"This is not a Phantasie III Disk."`), not the game proper.

**Confidence: confirmed** that `PLN*` are not `.set`-space map arrays and
that `PLN3` is a 2-byte flag file; **confirmed** for the 9 × 9 shape of
`pln1`/`pln2`; **open** for what those grids actually encode and whether
`PLN1`/`PLN2`/`PLN4` are live in the Amiga build at all.

#### 9.0.3.1 Grid geometry from the padding convention — confirmed (2026-08-11)

The 9 × 9 shape no longer rests on "the only width where it looks
connected". Every P3 data file pads to a 128-byte disk-block boundary with a
repeated filler byte (§9.0.2, §9.1, `graphics-formats.md` §4), and applying
that rule mechanically gives exact factorizations:

| File | Size | Trailing pad | Content | Factors |
|---|---:|---|---:|---|
| `pln1` | 128 | 47 × `0x51` | **81** | 9 × 9 |
| `pln2` | 128 | 47 × `0x51` | **81** | 9 × 9 |
| `pln4` | 512 | 16 × `0x70` | **496** | **31 × 16** |

`pln4`'s 31 independently agrees with the prior pass's autocorrelation peak
at period 31/32, and at width 31 its multi-cell motifs neither shear nor
wrap. (`0x51` and `0x70` each occur *only* in the trailing run of their own
file, so they are unambiguously padding, not content.)

**The padding rule is sharper than "some repeated filler byte", and it is a
free content-length oracle for every Phantasie III file.** The filler byte
is not arbitrary:

> **`fillerByte == contentLength mod 128`** — verified across **58 of 58**
> files in `data/phantasieiii/amiga/` whose size is a multiple of 128, with
> **zero deviations**. (The only three exclusions are `PhantasieIII`,
> `gamesave.dat` and `system-configuration`, whose sizes are not 128
> multiples, so they carry no block padding at all.)

This reproduces every content length the project has independently
code-traced, without needing the code: `m0` → 830 and `m1` → 659 (§9.0.2's
`PlayMusic` read lengths), `s1`-`s20` → 1,050 (§9.0.4's scroll read),
`phantasy.set` → 35,785 (exactly `graphics-formats.md` §5.1's
`35 + 3750 + 32000`), and — the reason it matters here — `pln1`/`pln2` →
**81**, `pln4` → **496**, and `pln3` → **2**, the last matching §9.0.3's
already-confirmed 2-byte flag read exactly. It also yields two lengths
nobody had traced: `s6` → **3,480** and `dng.csh` → **900**.

> Small correction while here: §9.0.2 says `m1`'s trailing padding is
> `0x3E`. It is `0x13` (= 659 mod 128); only `m0`'s is `0x3E`
> (= 830 mod 128 = 62).

#### 9.0.3.2 Alphabet structure — confirmed

Each file's non-filler values behave like an auto-tiling alphabet: one
dominant interior/fill value, distinct left- and right-edge values, and
single top/bottom cap markers. `pln1` at width 9 (filler shown as `.`):

```
. . . . . . . . .        . . . . . . . . .
. . . 49 38 44 . . .     . . . 3E 3A 42 . . .
. . 49 4A 4A 4A 44 . .   . . 3E 3D 3D 3D 42 . .
. 49 4A 4A 4A 4A 45 . .  . . 3F 3D 3D 3D 3D 42 .
. 48 4A 4A 4A 45 . . .   . . . 3F 3D 3D 3D 43 .
. 47 4A 4A 4A 44 . . .   . . . 3E 3D 3D 3D 41 .
. . 47 46 4A 4A 44 . .   . . 3E 3D 3D 40 41 . .
. . . . 47 46 3B . .     . . 37 40 41 . . . .
. . . . . . . . .        . . . . . . . . .
        pln1                      pln2
```

`pln1`'s non-marker run is `0x44`-`0x4A` with markers `0x38`/`0x3B`;
`pln2`'s is `0x3D`-`0x43` with markers `0x37`/`0x3A`. **`pln1`'s run is
exactly `pln2`'s + 7, and its markers exactly `pln2`'s + 1.** `pln4`
contains `pln2`'s run verbatim plus markers `0x39`/`0x3C` (`pln2`'s + 2),
further runs `0x4B`-`0x54` and `0x57`/`0x58`, and scattered high values
`0x9A`, `0xA6`, `0xBB`, `0xD2`-`0xD5`, `0xF2`-`0xF9`.

#### 9.0.3.3 The *transfer utility's* consumer interprets nothing — confirmed

Addr `0x20BB4` was fully disassembled this pass. (At the time it was
believed to be the only consumer; §9.0.3.4 shows it is not.) It is a
**generic opaque block reader/writer**: it selects a filename template by slot index, patches
the digit byte, calls the file-IO helper at addr `0x20A5E` with
`(filename, buffer, length, r/w mode)`, then advances a growing buffer
pointer (hunk-1 `$296C` for read, `$2970` for write) by `length + 4`. It
never reads a single content byte. So this code path — a whole-disk copy/restore
routine — can never name their contents. The *live* loader, found
afterwards, does (§9.0.3.4).

#### 9.0.3.4 Solved (2026-08-11): they are the three non-overworld map arrays

> **Correction (2026-08-11):** everything above stands as far as it goes —
> `PLN*` really are not `.set`-space *overworld* map arrays, and `PLN3`
> really is a 2-byte flag file. But two of its conclusions are **wrong**:
> that the grids' meaning was unknown, and that `PLN1`/`PLN2`/`PLN4` are
> dead in the Amiga build with "no callers anywhere in the binary". They
> are live, and the engine loads one of them every time the party enters a
> castle or the Netherworld.
>
> The "no live consumer" negative came from searching only **one** filename
> template table. There are **two** `D/PLNX` strings in the binary: the
> transfer utility's at hunk-0 `0x7253` (reached via the hunk-1 `0x2656`
> table — the one every earlier pass found), and a **second, live** one at
> hunk-0 `0x6B4E`, which is slot **20** of the real game's template table
> at hunk-1 `0x21D2` (file `0x29A9A`).

**`D/PLNn` is Phantasie III's map file for map id `n`** — the digit is
literally the engine's active-map global `$28C2` (§9.0.5.1). Map id `0` is
the overworld, which lives in `Graphics/phantasy.set` instead, and map id
`3` is unused — which is exactly why `PLN3` alone is a stray 2-byte flag
file rather than a grid.

The map-switch routine at addr `0x1EB1E` has both arms:

```
; --- castle interiors:  $28C2 & 3  (1 = Light, 2 = Dark) ---
0x1EB8A  move.w #$9,$2808.l           ; width  = 9
0x1EB92  move.w #$8,$2806.l           ; max Y  = 8      -> 9 x 9
0x1EB9A  move.l $295c.l,$2908.l       ; active map = the shared buffer
0x1EBA8  move.w #$51,-(a7)            ; READ LENGTH = 81 bytes
0x1EBB2  move.w #$14,-(a7)            ; template slot 20 = "D/PLNX"
0x1EBBA  move.w $28c2.l,d0
0x1EBC0  add.w  #$30,d0               ; map id + '0'    -> '1' or '2'
0x1EBC6  jsr    $1f5d8.l              ; LoadFile()

; --- Netherworld:  $28C3 bit 2 ---
0x1EC24  move.w #$1f,$2808.l          ; width  = 31
0x1EC2C  move.w #$f,$2806.l           ; max Y  = 15     -> 31 x 16
0x1EC42  move.w #$1f0,-(a7)           ; READ LENGTH = 496 bytes
0x1EC4C  move.w #$14,-(a7)            ; template slot 20 = "D/PLNX"
0x1EC54  move.w #$34,-(a7)            ; literal '4'     -> D/PLN4
0x1EC58  jsr    $1f5d8.l
0x1EC68  move.b #$f9,$1f0(a0)         ; append two filler cells past the read
0x1EC74  move.b #$f9,$1f1(a0)
```

| File | Map id | Grid | Engine read length | Content length from padding (§9.0.3.1) |
|---|---:|---|---:|---:|
| `D/PLN1` | 1 | 9 × 9 | `#$51` = **81** | **81** |
| `D/PLN2` | 2 | 9 × 9 | `#$51` = **81** | **81** |
| `D/PLN4` | 4 | 31 × 16 | `#$1F0` = **496** | **496** |

The engine's own read lengths reproduce §9.0.3.1's padding-derived content
lengths exactly, and its `$2808`/`$2806` pair reproduces the grid widths —
two independent derivations agreeing on all three files.

**Every remaining structural oddity is now explained**, because these are
ordinary map arrays in the same value space as `phantasy.set` after all.
Running each file's bytes through the engine's own terrain classifier
(§9.0.5.3) accounts for **100% of cells**:

| File | Map | Terrain classes present | Border |
|---|---|---|---|
| `pln1` | Castle of Light | `68`-`74` → **Bright mist** (32 cells) | `0xF9` = 249 → **The River Styx** (49) |
| `pln2` | Castle of Dark | `61`-`67` → **Dense Fog** (30 cells) | `0xF9` (49) |
| `pln4` | Netherworld | `61`-`77` **Black path** (79), `78`-`82` **Mist** (35), `83`-`87` **Steam** (14), `88`-`241` **Lava** (56) | `0xF2`-`0xF9` (242-249) → **The River Styx** (310) |

- The `+7` offset between `pln1`'s and `pln2`'s runs (§9.0.3.2) is simply
  that `Bright mist` and `Dense Fog` are **adjacent 7-value terrain bands**
  in the classifier — the Castle of Light is drawn in bright mist and the
  Castle of Dark in dense fog.
- `pln4` uses the classifier's Netherworld re-banding (gated on `$28C3`
  bit 2), and all four of its exclusive classes are present.
- `0xF9` as "empty/filler" is the impassable **River Styx** border — which
  is also why the Netherworld loader hand-writes two extra `0xF9` cells at
  buffer offsets `0x1F0`/`0x1F1` immediately after the read.

**Verification — the marker cells land on the hardcoded coordinates.**
Each file has exactly **two** values the classifier assigns no class to,
and each sits at exactly one of the two `(x, y)` pairs that
`LocateSpecial()` (§9.0.5.4) tests for that map — the same
value-is-artwork / coordinate-is-mechanism split as the overworld:

| File | Cell | Value | `LocateSpecial()` arm |
|---|---|---:|---|
| `pln1` | (4, 1) | `0x38` | town `Light` — also the party's arrival square (`$2834`/`$2836` set to 4/1 at addr `0x1EB5A`) |
| `pln1` | (6, 7) | `0x3B` | dungeon `The Castle of Light` → `D/DNGF.DAT` |
| `pln2` | (4, 1) | `0x3A` | town `Dark` — same arrival square |
| `pln2` | (2, 7) | `0x37` | dungeon `The Castle of Dark` → `D/DNGG.DAT` |
| `pln4` | (7, 3) | `0x39` | town `Death` — arrival square (7/3 at addr `0x1EBF4`) |
| `pln4` | (6, 10) | `0x3C` | dungeon `A dark fortress` → `D/DNGI.DAT` |

Six for six, with no unexplained marker and no unlocated arm. The marker
values are also consecutive across the three maps in map-id order
(`0x37`/`0x3A` for map 2, `0x38`/`0x3B` for map 1, `0x39`/`0x3C` for map 4),
which is the `+1` marker offset noted in §9.0.3.2.

**Confidence: confirmed** — code-traced load path with byte-exact read
lengths and grid dimensions, 100% of cell values accounted for by the
engine's own classifier bands, and a 6/6 marker-to-arm correspondence.

Two further observations, at their own confidence levels:

- **The two castle interiors share one floor plan — confirmed.** `pln1` and
  `pln2` have byte-for-byte identical per-row occupied-cell counts
  (`0, 3, 5, 6, 5, 5, 5, 3, 0`). Only the terrain band and the two marker
  positions differ. This is a cheap regression check for any extractor.
- **The cell value correlates with 4-neighbour occupancy — hypothesis,
  62.7%.** Tabulating every non-`0xF9` cell against its N/E/S/W
  occupancy mask (treating `0xF9` as "open") over all three grids,
  **195 of 311 cells (62.7%)** have a value that is a single-valued
  function of that mask — e.g. `0x3D`, `0x4A`, `0x4F`, `0x50`, `0x53`,
  `0x58` occur *only* at mask 15 (fully enclosed interior), and `0x40`,
  `0x46`, `0x52`, `0xA6`, `0xF2` only at mask 11 (open to the south). That
  is a real signal and is consistent with the artist picking transition
  graphics per edge, but **it is not a decode**: 116 cells break it,
  including every `0xF3`-`0xF8` River Styx variant (`0xF8` alone spans
  8 different masks). Do not build a renderer on it.

#### 9.0.3.5 Paths tried (all superseded by §9.0.3.4)

| Approach | Result | Why it failed |
|---|---|---|
| `.set`-style terrain grid | Refuted 2026-08-10 — but the refutation over-reached | 0/11 and 0/11 value-space overlap with `phantasy.set`'s map alphabet. Sound as far as it went, but it compared against the **overworld's** value usage rather than the format's; these are different maps that legitimately use different terrain bands of the same shared space |
| Same map kind, different picture columns | No result 2026-08-11 | Rendered all three grids through `phantasy.set`'s picture at rows 20/60/100/140/180 — no coherent output. Right instinct, wrong instrument: castles and the Netherworld do not use the overworld's terrain strip |
| Trace the reader | **Wrong negative** 2026-08-11 | Disassembling the hunk-1 `0x2656` consumer at addr `0x20BB4` showed a generic opaque block copier. True, but it is the *transfer utility's* table — the live loader uses a **second** `D/PLNX` in the hunk-1 `0x21D2` table, which no search had covered |
| "PLN = Astral PLaNe" | Unsupported 2026-08-11 | The Astral Plane routine (addr `0x1DC60`-`0x1DE60`) is a pure `D/W2.cmp` scene-plus-text sequence and touches no PLN file. (Close, though: PLN really does mean "plane" in the sense of a non-overworld world) |
| P1/P2 `tile = class*10 + variant` | Does not fit 2026-08-11 | Chops the contiguous runs across class boundaries; `pln4`'s `0xF2`-`0xF9` minus the 120 fog offset exceeds the documented 0-119 range |
| `re-codebreaker` escalation | Stood down 2026-08-11 | Solved by the overworld trace (§9.0.5) before it reported — its map-switch routine handed over the 9 × 9 and 31 × 16 grid dimensions, which matched the two padding-derived content lengths immediately |

### 9.0.4 `D/S1`-`S20` loader — read length and the `S6` outlier — confirmed

The scroll loader at addr `0x1F6DC` bounds its argument to `0x79`-`0x8C`
(121-140), subtracts `#$78` (120) to get a 1-based scroll number, patches
the two `X` bytes of `"D/SXX"` (hunk-1 slot `0x21FA`, string addr `0x6AE2`)
with an itoa helper at addr `0x1D8A`, opens with `MODE_OLDFILE` and reads
**`#$41A` = 1,050 bytes** into the buffer at `$2960` — not the full 1,152
bytes on disk. Ids 2-4 are folded onto id 2, id 9 sets the same secondary
flag, and **id 6 sets a flag at `-$A(a5)` that skips the open/read entirely**
(addr `0x1F742`), with a separate literal `"D/s6"` (addr `0x1F878`) loaded
elsewhere (addr `0x1F7F4`) instead. That special case is why `S6` alone is
3,584 bytes rather than 1,152 — §9.1's open question.

**Confidence: confirmed** (code-traced) for the 1,050-byte read, the
121-140 → 1-20 id mapping, and the `S6` special case.

### 9.0.5 P3's overworld location metadata — solved: hardcoded coordinates

> **Correction (2026-08-11):** `graphics-formats.md` §5.3 and this
> document's earlier "Open questions" row both carried the hypothesis that
> P3's overworld town/dungeon/event metadata is encoded *in the map values
> themselves* — specifically that "the 26 single-occurrence values 24-49
> are the named locations", with the engine reading the tile value to know
> what is there. **The mechanism is refuted; the correlation is real.**
> The engine never inspects the map byte for this purpose. It locates every
> named place by a chain of hardcoded `(x, y)` comparisons compiled inline
> into the code. The distinctive cell values are the *artwork* for those
> tiles, nothing more. The value range was also slightly wrong: it is
> **25-52 plus 54**, not 24-49.

#### 9.0.5.1 Where the map array lives — confirmed

| Item | Addr | File offset | Evidence |
|---|---|---|---|
| Buffer allocation | `0x73C0` | `0x73E8` | `pea $ea6.w` = **3,750** = 50 × 75, then `jsr $5CC.l` (the bump allocator), result stored to hunk-1 `$2964` |
| `"Graphics/Phantasy.set"` string | `0x7DC9` | `0x7DF1` | Its **only** reference in the whole CODE hunk is PC-relative (`pea $7dc9(pc)` at addr `0x754C`); a raw absolute-long search for the address returns zero hits |
| Load call | `0x7546` | `0x756E` | `move.l $2964.l,-(a7); pea $7dc9(pc); jsr $27D8.l` |
| `.set` loader | `0x27D8` | `0x2800` | `Open(MODE_OLDFILE)`, then four `Read`s of 1, 1, 1 and **32** bytes — independently re-confirming `graphics-formats.md` §5.1's `unknown / height / width / 32-byte palette` header, with the palette landing in hunk-1 `$2AEE` |

Relevant globals (hunk-1 offsets; all of these are in the BSS part):

| Offset | Meaning |
|---|---|
| `$2964` | Pointer to the 3,750-byte overworld map array |
| `$2908` | Pointer to the **active** map array |
| `$2806` / `$2808` | Active map max-Y (74) / width-and-row-stride (50) |
| `$28C2` | Active map id — `0` = overworld, `1`/`2` = Castle of Light/Dark interiors, `4` = Netherworld |
| `$2834` / `$2836` | Party X / Y on the active map |
| `$282C` / `$282E` / `$2830` | "on a named location" flag / location **type** / location **index** |
| `$2860` | Last computed terrain class |
| `$2AEE` | The 32-byte palette read from `phantasy.set` |

The map-switch routine at addr `0x1EC86` installs the overworld
(`$2808 = 50`, `$2806 = 74`, `$2908 = $2964`, `$28C2 = 0`); two sibling arms
in the same routine install a **9 × 8** castle-interior grid and a
**31 × 15** Netherworld grid, both from a different buffer (`$295C`).

#### 9.0.5.2 The map byte is read at exactly three instructions — confirmed

Independently re-verified this pass by exhaustive byte search over all
137,352 CODE bytes:

| Search | Hits |
|---|---|
| `muls.w $2808.l,d0` (the `Y × width` term) | **exactly 2**: addr `0x9BAA` and `0x0A4B0` |
| `muls.w`/`mulu.w` with immediate `#$32` (50) | **0** |
| `muls.w`/`mulu.w` with immediate `#$0EA6` (3750) | **0** |
| Absolute-long `$2908` (active map pointer) | 6 operand hits — three loads (`movea.l $2908.l,a0` at addrs `0x9BE0`, `0x9C16`, `0xA4C8`), three stores, all inside the map-switch routine `0x1EB1E`-`0x1ECAE` |
| Absolute-long `$2964` (overworld map pointer) | 3 — the malloc store (`0x73CC`), the loader argument (`0x7546`), the copy into `$2908` (`0x1EC96`) |

So indexing is `$2908 + Y × $2808 + X`, and there are only two consumers:

1. **The 9 × 9 viewport blitter**, addr `0x9B82`. It fetches the byte and
   passes it **verbatim** to the tile blitter with nothing in between:
   ```
   0x9C10  move.w   $2820.l,d0        ; linear index
   0x9C16  movea.l  $2908.l,a0
   0x9C1C  move.b   (a0,d0.w),d1      ; the map cell byte
   0x9C20  ext.w    d1
   0x9C22  move.w   d1,-(a7)          ; pushed unmodified as the tile/column id
   0x9C24  move.w   -$8(a5),d2        ; screen y
   0x9C28  add.w    #$c,d2
   0x9C2C  move.w   d2,-(a7)
   0x9C2E  move.w   -$6(a5),-(a7)     ; screen x
   0x9C32  move.l   $8(a5),-(a7)      ; dest bitmap
   0x9C36  jsr      $3834.l           ; blit
   ```
   (A second, identical fetch sits at addr `0x9BE6` — the arm taken for the
   party-marker cell, which calls `$378A` instead of `$3834`.)
   This is the direct code-level proof of `graphics-formats.md` §5.3's
   column-index reading, which until now had no `.set`-consuming code
   behind it at all.
2. **The terrain classifier**, addr `0xA4A6`, which reads the *party's own*
   cell and reduces it to a terrain class.

#### 9.0.5.3 The terrain classifier — confirmed

Addr `0xA4A6` is a flat chain of range tests on the fetched byte, producing
a class in hunk-1 `$2860` that indexes a 19-entry name-pointer table at
hunk-1 `0x1750` (file `0x29018`). Every string was resolved byte-exact:

| Class | Name | Cell-value band |
|---|---|---|
| 10 | `Water` | `0`, `1`, `2`-`25` |
| 11 | `Bright mist` | `68`-`74` |
| 14 | `Dense Fog` | `61`-`67` |
| 3 | `Mountains` | `90`-`114` |
| 2 | `Hills` | `115`-`154` |
| 9 | `Desert` | `155`-`187` |
| 0 | `Meadows` | `188`-`205` |
| 6 | `Pathway` | `206`-`209`, `214`-`224` |
| 1 | `Forest` | `225`-`241` |
| 13 | `A bridge` | `222` |
| 15 | `The River Styx` | `≥ 242` |
| 16/17/18/8 | `Mist` / `Black path` / `Steam` / `Lava` | Netherworld-only re-banding, gated on `$28C3` bit 2 |

Remaining table entries `4 BUILDING`, `5 DUNGEON`, `7 Netherworld`,
`12 Ocean` are used by other callers, not by this chain.

**The decisive negative.** Enumerating every `cmpi.w #imm,-$2(a5)` in the
classifier gives the immediates `1, 2, 25, 68, 74, 61, 67, 90, 114, 115,
154, 155, 187, 188, 205, 206, 209, 214, 224, 225, 241, 222, 242` (plus the
Netherworld set `61, 77, 78, 82, 83, 87, 88, 241`). **Exactly one falls in
the hypothesised 24-49 window — the `25` that closes the water band** — and
the classifier assigns no class at all to values `26`-`60` or `75`-`89`,
because for those cells it is never called (§9.0.5.4). There is no
comparison, subtraction, range check or jump table applied to an overworld
map byte anywhere in the binary.

#### 9.0.5.4 `LocateSpecial()` — the real mechanism — confirmed

Addr `0x9C6A` (file `0x9C92`). The overworld step handler at addr `0x7B42`
calls the viewport blitter, then `LocateSpecial()`, and **branches on its
result**: non-zero → print the location's name and offer to enter it
(addr `0x8074`); zero → fall through to the terrain classifier at
`0xA4A6`. That is why the classifier has no bands for the location values.

`LocateSpecial()` is a ~1.8 KB if-chain of literal coordinate comparisons,
coarsely bucketed into four Y-bands for speed. Each arm has the shape

```
0x9DE2  cmpi.w  #$2c,$2834.l      ; X == 44 ?
0x9DEA  bne.b   ...
0x9DEC  cmpi.w  #$5,$2836.l       ; Y == 5 ?
0x9DF4  bne.b   ...
0x9DF6  move.w  #$1,$282e.l       ; type 1 = TOWN
0x9DFE  move.w  #$b,$2830.l       ; index 11 = "Flagler"
0x9E06  move.w  #$1,$282c.l       ; found
```

It **never references `$2908` or `$2964`** — a byte search for the
active-map pointer across the whole `0x9C6A`-`0xA364` range returns zero
hits. Types are `1` = town, `2` = dungeon/building, `3` = inn, `4` = pull a
name straight from the terrain table (used for the map-edge `Ocean` /
`The River Styx` refusal at addr `0x9CA0`, P3's analogue of P1's
"THE RIVER STYX" wall).

The name tables, all hunk-1 arrays of 4-byte pointers into hunk 0, all
resolved byte-exact this pass:

| Type | Table | File offset | Entries |
|---|---|---|---|
| 1 town | `0x1684` | `0x28F4C` | 1-14 towns, 15-17 = `Light`, `Dark`, `Death` (index 0 is a `"0"` sentinel) |
| 2 dungeon | `0x16CC` | `0x28F94` | 1-11, two-line (`\r`-separated) descriptions |
| 2 dungeon | `0x16FC` | `0x28FC4` | The same 11 as single-line variants, used by the "Enter?" prompt |
| 3 inn | `0x172C` | `0x28FF4` | 1-8 inn names |
| 4 terrain | `0x1750` | `0x29018` | 0-18, §9.0.5.3 |

`EnterDungeon(index)` at addr `0x1BB58` turns a dungeon index into a
filename: a word table at hunk-1 `0x22AC` (file `0x29B74`) holds
`00 4A 48 45 44 41 43 42 4B 49 46 47`, whose low bytes for indices 1-11 are
the ASCII letters **`J H E D A C B K I F G`**. The letter is patched into
the `"D/DNGX.DAT"` template (addr `0x1F600`) and 4,224 of the file's 4,352
bytes are read. **This resolves §9's long-standing "Phantasie III `a`-`k`
dungeon-file letter-to-level-number mapping — ordering assumed, not
confirmed" open question**: the ordering is neither alphabetical nor
sequential, and it is now read directly out of the binary.

#### 9.0.5.5 The recovered location table — confirmed, byte-exact

The 34 arms were extracted **mechanically** from the raw bytes (scanning
`cmpi.w #imm,$2834/$2836` and `move.w #imm,$282E/$2830/$282C` opcode forms
across `0x9C6A`-`0xA364`), then every arm's `(x, y)` was looked up in the
real `phantasy.set` map array at `0x23 + y*50 + x`.

**Verification: a perfect bijection.** The 30 overworld arms land on 30
distinct cells carrying the values `25`-`52` and `54`; every one of those
values occurs in the 3,750-cell map array **exactly as many times as it has
arms** — 1 arm and 1 occurrence for 29 of them, and **2 arms and exactly 2
occurrences for value `50`** (the Jolly Inn and the Royal Inn share a
graphic). Value `24` occurs once but has no arm (it classifies as Water),
and value `53` never occurs at all. A wrong reading of the arm chain could
not reproduce that count-for-count agreement across 30 independent cells.

| Cell | (x, y) | Arm | Type | Name | Opens |
|---:|---|---|---|---|---|
| 25 | (24, 37) | `0xA0FE` | town 1 | Pendragon | |
| 26 | (15, 39) | `0xA12A` | town 2 | Sandy Shores | |
| 27 | (5, 35) | `0x9F82` | town 3 | Pendleton | |
| 28 | (35, 42) | `0xA156` | town 4 | Rocky Hills | |
| 29 | (43, 52) | `0xA182` | town 5 | Deltor | |
| 30 | (11, 69) | `0xA28E` | town 7 | Tierrin | |
| 31 | (22, 65) | `0xA262` | town 6 | Tirith | |
| 32 | (5, 51) | `0xA1AE` | town 9 | Sierion | |
| 33 | (44, 66) | `0xA2BA` | town 10 | Xanador | |
| 34 | (44, 5) | `0x9E06` | town 11 | Flagler | |
| 35 | (22, 12) | `0x9E32` | town 12 | Lansing | |
| 36 | (8, 9) | `0x9E5E` | town 13 | Scanport | |
| 37 | (15, 22) | `0x9FDA` | town 14 | Sciattica | |
| 38 | (25, 27) | `0x9FAE` | town 8 | Asmith | |
| 39 | (7, 66) | `0xA312` | dng 8 | A cave smelling of sulphur | `D/DNGK.DAT` |
| 40 | (28, 67) | `0xA2E6` | dng 7 | A giant wooden building | `D/DNGB.DAT` |
| 41 | (36, 38) | `0xA1DA` | dng 4 | A large cavern starts here | `D/DNGD.DAT` |
| 42 | (48, 36) | `0xA006` | dng 3 | A large crystal building | `D/DNGE.DAT` |
| 43 | (46, 9) | `0x9E8A` | dng 1 | A very small straw hut | `D/DNGJ.DAT` |
| 44 | (25, 8) | `0x9EB6` | dng 2 | Many men guard a tent here | `D/DNGH.DAT` |
| 45 | (25, 39) | `0xA206` | dng 5 | The Pendragon town archives | `D/DNGA.DAT` |
| 46 | (2, 35) | `0xA032` | dng 6 | The Dwarven burial grounds | `D/DNGC.DAT` |
| 47 | (24, 20) | `0x9EE2` | inn 1 | The Mystic Inn | |
| 48 | (46, 21) | `0x9F0E` | inn 2 | The Portal Inn | |
| 49 | (43, 34) | `0xA05E` | inn 3 | The Crown Inn | |
| 50 | (24, 32) | `0xA08A` | inn 4 | The Jolly Inn | |
| 50 | (22, 50) | `0xA232` | inn 7 | The Royal Inn | |
| 51 | (14, 24) | `0xA0B6` | inn 5 | The Kanpai Inn | |
| 52 | (2, 21) | `0x9F3A` | inn 6 | The Desert Inn | |
| 54 | (2, 65) | `0xA33E` | inn 8 | The Deadly Inn | |

Four further arms (`0x9CFE`, `0x9D2A`, `0x9D86`, `0x9DDA`) are gated on
`$28C2`, i.e. they belong to the **castle-interior and Netherworld** maps,
not the overworld — looking their coordinates up in `phantasy.set` yields
unrelated bulk-terrain values, exactly as expected. Between them they
account for the remaining dungeon files `D/DNGI.DAT` (`A dark fortress`,
Netherworld), `D/DNGF.DAT` (`The Castle of Light`) and `D/DNGG.DAT`
(`The Castle of Dark`), and the town entries `Light` / `Dark` / `Death`.
**All 11 dungeon letters `a`-`k`, all 14 overworld town indices and all 8
inn indices are therefore accounted for with no gaps.** Their exact index
arithmetic (one arm computes `14 + $28C2` rather than storing a literal)
was not disentangled and is **not** claimed here.

**Confidence: confirmed** for the load path, the three map-read sites, the
terrain classifier and its bands, the coordinate-driven `LocateSpecial()`
mechanism, the four name tables, the dungeon-letter table, and the 30-row
overworld table above (bijection-verified against real map bytes).
**Hypothesis:** that hunk-1 `0x21A8`'s word table (`A`-`K` =
11,11,12,5,11,11,11,12,11,13,13, loaded to `$28B2` at addr `0x1BD34`) is a
per-dungeon level count — its consumers were not traced.

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

> **Superseded in part (2026-08-10):** the loader is now traced — see §9.0.4.
> The game reads **1,050 bytes** per scroll (not the full 1,152 on disk),
> maps message ids 121-140 to scrolls 1-20, and **special-cases `S6`**,
> which resolves the outlier-size question.

### 9.2 `M0` (896 bytes), `M1` (768 bytes)

`M0` is almost entirely a single repeated character (`0x3E`/`'>'`), which
reads as either a border/divider graphic asset or a degenerate/mostly-empty
table. `M1` contains no printable-ASCII runs at all — dense binary, purpose
undetermined. **Confidence: open/unresolved.**

> **Correction (2026-08-10):** wrong on both counts — see §9.0.2. These are
> **three-track music files** (`(note, duration)` byte pairs, `0xFF` track
> separators), read 830 / 659 bytes deep by `PlayMusic` at addr `0x1FA5C`.
> The `0x3E` run this paragraph latched onto is trailing 128-byte-boundary
> padding *past* the end of what the game reads, not the file's content —
> the same padding convention every `.cmp`/`.csh`/`.set` file uses. Reading
> only the tail of a padded file is how a music stream came to be filed as a
> "border graphic".

### 9.3 `PLN1`-`PLN3` (128 bytes each), `PLN4` (512 bytes)

All four contain short runs of consecutive-ish letters (e.g. `PLN1`:
`"I8D"`, `"IJJJD"`, `"IJJJJE"`, `"HJJJE"`, `"GJJJD"`, `"GF;"` — values
climbing/descending by one letter at a time) — a pattern structurally
similar to the tile-code letter runs seen in Phantasie I's `out*.dat`/
`maps.int` (§8.2, §8.3), suggestive of small terrain/elevation grids, but
far too small (128 bytes) to be a full outdoor screen at Phantasie I's
scale. Not investigated further. **Confidence: open/unresolved.**

> **Correction (2026-08-10, extended 2026-08-11):** the *overworld*
> terrain-grid reading is refuted, but these **are** map arrays — for the
> castle interiors and the Netherworld. See §9.0.3 and especially §9.0.3.4.
> The original text below is superseded in full.
>
> Original correction: `PLN*`'s byte values are entirely disjoint from Phantasie III's
> own confirmed map-value space (`phantasy.set`, `graphics-formats.md` §5.3):
> 0 of `pln1`'s 11 distinct values and 0 of `pln2`'s 11 occur anywhere in
> that 196-value set, and `phantasy.set` uses nothing at all in the 55-80
> band where `PLN*` lives. `PLN3` is a 2-byte flag file the engine reads and
> writes (addr `0x1F87E`). The "letter runs" resemblance was a
> cross-game analogy, not evidence.

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
| Phantasie III `a`-`k` dungeon-file letter-to-level-number mapping | **Resolved** (§9.0.5.4): the word table at hunk-1 `0x22AC` maps dungeon index 1-11 to the letters `J H E D A C B K I F G`; `EnterDungeon()` at addr `0x1BB58` patches the letter into `"D/DNGX.DAT"` and reads 4,224 of the 4,352 bytes. §9.0.5.5 binds every letter to its named entrance | n/a |
| `twns.int` 292-byte record | Stride, name-field offset, 12-town roster confirmed. **The map position is *not* in this file** — it is in the `out*.dat` POI record (§8.2.2); a search of the whole file for the 10 known `(section, x, y)` triples returned zero hits, and the first 32 bytes of every populated record are byte-identical, i.e. a shared shop/price template | Every other field in the record; the two non-empty non-name "slots" at the end; which table the POI record's town index `+2` addresses |
| `out*.dat` | **Full four-region layout confirmed** (§8.2): 20×26 grid, 15×5-byte POI table, 10×40-byte text array, trailing residue | Meaning of the POI record's `+2`/`+3` bytes for non-town features |
| `maps.int` | **Solved** (§8.3): 18 × 520-byte grids = the 18 `out*.dat` grids; sections tile 4-wide with 1-cell overlap into a 77×126 world | What the ±120 tile-code bank means; per-class terrain names; whether `game` reads the file at all (no `maps.int` string in it) |
| `scrolls.dtx` | 40-byte line stride confirmed, 400 lines total | How lines subdivide into individual scrolls |
| `tamb.dat` | Byte-frequency profile only | Everything else |
| Phantasie III `S1`-`S20` | **Loader traced** (§9.0.4): 1,050-byte read, message ids 121-140 → scrolls 1-20, `S6` special-cased (resolves the outlier size) | The on-disk text layout beyond "flat NUL-terminated blob"; where the 1,050-byte read is word-wrapped |
| Phantasie III `M0`, `M1` | **Fully solved** (§9.0.2-§9.0.2.6): three-track music; the whole driver is traced — a vblank interrupt server (`"VertB-Timer"`), a 24-command byte grammar, `frames = ((dur & 0x7F) + 1) × multiplier`, the ProTracker period table at hunk-1 `0x0640` (note 57 = A4 on NTSC), 4-phase ADSR, and four instruments including LCG-generated noise. Both files parse byte-exactly with 0 unknown commands | Only whether `0xDB`'s two ignored argument bytes (always `0C 06`) carry vibrato depth/rate for another platform's port of the same driver |
| Phantasie III `PLN1`-`PLN4` | **Solved** (§9.0.3.4): `D/PLNn` is the map array for engine map id `n` — `PLN1` = Castle of Light and `PLN2` = Castle of Dark (9×9, 81-byte read), `PLN4` = the Netherworld (31×16, 496-byte read), all loaded by the map-switch routine at addr `0x1EB1E` via a second, live `D/PLNX` template (hunk-1 `0x21D2` slot 20). Map id 3 is unused, which is why `PLN3` alone is a 2-byte flag file. 100% of cell values fall in the engine's own terrain-class bands; 6/6 marker cells sit on `LocateSpecial()`'s hardcoded coordinates | Nothing structural. The 4-neighbour auto-tile correlation is only 62.7% and is explicitly *not* claimed |
| Phantasie III `D/W0`-`W4.cmp` | **Solved** (§9.0.1): ordinary `.cmp` 320×200 scene backdrops (gods, town street, shop doorways), loader traced. **`W2` is now bound**: the Astral Plane routine at addr `0x1DC70` patches the template to `'2'`, loads it, and immediately prints `"A Great Demon appears and speaks..."` — matching `w2.cmp`'s rendered red-skinned figure in a skeleton-strewn temple | Which god binds to `W0` vs `W1` |
| Phantasie II world map | **Solved** (§8.6): same format as P1 with two constants changed (3,000-byte record, display list at 1,500); 17 sections over a 4×8 mosaic → 77×201 world | `PHANT.RSC` wording of the section>16 messages; POI `+3`; the 4 stale POI records |
| Phantasie III world map | **Solved** (§9.0.5). No `out*.dat`/`maps.int` equivalent exists; the world is one global 50×75 `.set` map array. Location metadata is **not** in the map values — `LocateSpecial()` at addr `0x9C6A` identifies every named place by hardcoded `(x,y)` comparisons and never reads the map array. The 30 distinctive cells (values 25-52, 54) are the marker artwork, and all 30 are now bound to concrete town/dungeon/inn names, bijection-verified | Which picture row the tile blitter samples (`graphics-formats.md` §5.3); the per-dungeon word table at hunk-1 `0x21A8` |
| Phantasie III `gamesave.dat` | Size only | Record structure |
