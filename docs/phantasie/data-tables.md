# Phantasie Data Tables

This document describes the fixed-record data tables for monsters, races,
skills, and items across Phantasie I (Amiga) and Phantasie III (Amiga):
field-level byte layout, offsets, and confidence for each. See
`docs/phantasie/graphics-formats.md` for how the sprite/palette references
inside these tables resolve to actual images.

Source of ground truth: a third-party reverse-engineering tool's C# source
(`MonstersManagerP1.cs`, `RacesManagerP1.cs`, `MonstersManagerP2.cs`,
`RacesManagerP2.cs`, `MonstersManagerP3.cs`, `RacesManagerP3.cs`,
`Monster.cs`, `Race.cs`, `Skill.cs`, `Skills.cs`, `BytesArray.cs`) was read
to recover candidate offsets and record shapes, then every offset and field
below was independently re-read and checked against this project's own
`data/phantasie/amiga/` and `data/phantasieiii/amiga/` files — see the
verification note under each table. No code from that tool is reproduced
here.

## 1. Phantasie I (Amiga) — monster and race tables

All offsets in this section are **file-relative offsets into
`data/phantasie/amiga/game`** (193,804 bytes), a plain AmigaOS
`loadseg()`-able HUNK executable (magic `HUNK_HEADER` at offset 0). Despite
`game` being a real multi-hunk executable, the offsets below work as **raw,
unadjusted file offsets** — no hunk-header/segment-relative correction is
needed (confirmed: every table below decodes correctly at the bare file
offset). Table count for both monsters and races is fixed and read
directly from the reference source (not derived from any in-file count
field).

### 1.1 Monster name table

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `0x0C88` | 58 × 80 | Monster name strings | 80 fixed-size 58-byte slots, each holding a NUL-terminated ASCII name (with unused trailing bytes) |

**Confidence: confirmed.** Reading `read_string(game, 0x0C88 + i*58)` for
`i = 0..9` yields: `SKELETON`, `BANTIR`, `DRIP SLIME`, `SKUM`, `GIANT ANT`,
`GIANT BEE`, `VIPER`, `COYOTE`, `ORC`, `KOBOLD` — all legible, in-genre
monster names, zero garbage.

### 1.2 Monster sprite address + dimension tables

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `0x16842` | 4 × 80 | Sprite byte-offset table | Big-endian `u32`, one per monster index, `i*4` stride. Value is a byte offset into `mstr1.pat`/`mstr2.pat` (see `graphics-formats.md` §7) |
| `0x1EA8` | 4 × 80 | Sprite width/height table | Two big-endian `u16`s per monster (`width`, then `height`), `i*4` stride |

**Confidence: confirmed, byte-exact.** For every one of the 80 entries,
`width/8 * height * 4` (bytes for a `Planar`-mode 4bpp sprite of that size)
sums to **exactly** 68,016 bytes — the real size of `mstr1.pat` — with the
80 offsets landing perfectly contiguously in index order (no gaps, no
overlaps). Monster index 0 (`width=32,height=34`) sits at offset 0; index 1
(`width=32,height=30`) sits at `0x220` = `32/8*34*4` exactly, confirming
the address table and the size table are mutually consistent. Rendered
sprites for index 0 (`SKELETON`) and index 8 (`ORC`) are visually
recognisable as the named creature (see `graphics-formats.md` §7).

### 1.3 Palette table

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `0x194BC` | 2 × 16 | 16-colour palette | Same 16-bit ST-style RGB444 word format as the P3 container palettes (`graphics-formats.md` §2), decoded via the `AmigaToST` even-nibble lookup |

**Confidence: confirmed.** Decodes to a fully plausible, distinct
16-colour palette:

| Index | Word | R,G,B (nibbles) | RGB888 (approx) |
|-------|------|-------------------|-------------------|
| 0 | `0x0000` | 0,0,0 | black |
| 1 | `0x0A42` | 10,4,2 | 182,73,36 (brown) |
| 2 | `0x0E00` | 14,0,0 | 255,0,0 (red) |
| 3 | `0x0E60` | 14,6,0 | 255,109,0 (orange) |
| 4 | `0x0EA0` | 14,10,0 | 255,182,0 (gold) |
| 5 | `0x0EE0` | 14,14,0 | 255,255,0 (yellow) |
| 6 | `0x00E0` | 0,14,0 | 0,255,0 (green) |
| 7 | `0x0080` | 0,8,0 | 0,146,0 (dark green) |
| 8 | `0x0884` | 8,8,4 | 146,146,73 (olive) |
| 9 | `0x00EE` | 0,14,14 | 0,255,255 (cyan) |
| 10 | `0x00AE` | 0,10,14 | 0,182,255 (sky blue) |
| 11 | `0x004E` | 0,4,14 | 0,73,255 (blue) |
| 12 | `0x0EBB` | 14,11,11 | (odd nibbles — see below) |
| 13 | `0x0888` | 8,8,8 | 146,146,146 (grey) |
| 14 | `0x0E2A` | 14,2,10 | 255,36,182 (magenta) |
| 15 | `0x0EEE` | 14,14,14 | 255,255,255 (white) |

One outlier: index 12 has odd nibbles (11, 11) for green/blue, which the
`AmigaToST` lookup (populated only at even indices) maps to 0 — this entry
is likely a red-family shade the even-nibble lookup doesn't represent
precisely; flagged here rather than silently smoothed over. All other 15
entries use exclusively even nibbles, consistent with the ST→Amiga
palette-doubling convention described in `graphics-formats.md` §2.

### 1.4 Race table

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `0x69BE` | variable | Race name strings | 16 sequential NUL-terminated ASCII strings, back-to-back (no per-slot fixed size — next name starts immediately after the previous NUL) |

Race sprite addressing has no offset table (unlike monsters) — it's a
fixed formula: race `index`'s sprite starts at byte `index * 32*32/2` =
`index * 512` in `party1.pat`/`party2.pat`, all races being a fixed 32×32.

**Confidence: confirmed.** Reading 16 sequential NUL-terminated strings
from `0x69BE` yields: `HUMAN, DWARF, ELF, HALFLING, GNOME, PIXIE, SPRITE,
OGRE, GNOLL, TROLL, KOBOLD, ORC, GOBLIN, LIZ.MAN, MINOTAUR, UNDEAD` — all
16 are legible, distinct, in-genre race names with no decode drift between
entries (each subsequent string starts exactly where the previous one's
NUL terminator ends, with no garbage in between). `party1.pat`'s size
(8,192 bytes) is exactly `16 * 512`, with zero remainder.

## 2. Phantasie II (Atari ST) — monster and race tables

**Confirmed, byte-exact against the real `PHANT.PRG`**
(`data/phantasieii/atarist/extracted/disk1/PHANT.PRG`, 155,785 bytes — see
`docs/phantasie/stx-extraction.md` for the `.stx` extraction). Unlike
Phantasie III's Amiga-vs-ST offset mismatch (§4/§8 below), **every one of
the reference source's cited P2 offsets carried over unchanged** — expected,
since `PHANT.PRG` *is* the same-platform (Atari ST) binary the reference
source's offsets were originally recorded against, not a cross-platform
port:

| Table | P1 offset (`game`) | P2 offset (`PHANT.PRG`) | Status |
|-------|----------------------|----------------------------|--------|
| Monster names (58-byte stride, 80 entries) | `0x0C88` | `0x1FF2A` | **confirmed** |
| Monster sprite offset table (4-byte stride, 80 entries) | `0x16842` | `0x23D90` | **confirmed** |
| Monster width/height table (4-byte stride, 80 entries) | `0x1EA8` | `0x2114A` | **confirmed** |
| Palette (16 words) | `0x194BC` | `0x23A9E` | **confirmed** |
| Race names (sequential strings) | `0x69BE` | `0x1F01C` | **confirmed** |

### 2.1 Monster name table — confirmed

Reading 80 fixed 58-byte NUL-terminated slots from `0x1FF2A` yields legible,
distinct, in-genre monster names for all 80 entries with zero garbage (0 of
80 slots printable-decode failures): `SKELETON, BANTIR, DRIP SLIME, GREEN
MUCK, GIANT ANT, GIANT BEE, VIPER, WILD DOG, ORC, KOBOLD, RANGER, SCRIBE,
APPRENTICE DEVIL, ZOMBIE, GHOUL, ...` through index 79 (`PLUTO`). Note P2's
roster differs from P1's at a few indices (e.g. index 3 is `GREEN MUCK` here
vs. P1's `SKUM`, index 7 is `WILD DOG` vs. P1's `COYOTE`) — expected, since
P1 and P2 are different games sharing an engine, not the same content. The
table's declared extent (`0x1FF2A + 80*58 = 0x2114A`) lands **exactly** on
the width/height table's own confirmed start offset — an independent
structural cross-check, not just a coincidence of the two offsets being
individually correct.

### 2.2 Monster sprite address + dimension tables — confirmed, byte-exact

Summing `width/8 * height * 4` (Planar-mode-equivalent byte count; the total
byte count is identical whether the underlying data uses P1's Planar layout
or P2's actual Interleaved layout — see `graphics-formats.md` §9) across all
80 entries of the width/height table at `0x2114A` reproduces **exactly**
76,832 bytes — the real size of `MSTR1.PAT`/`MSTR2.PAT` — with the 80
offsets from `0x23D90` landing perfectly contiguously in index order (no
gaps, no overlaps, first offset 0, last `offset+size` = 76,832 exactly).
Widths are mostly 32 (61 of 80 entries), with larger monsters at 48/64/80 —
structurally consistent with P1's own width distribution. **Confidence:
confirmed, byte-exact** (same verification method as P1 §1.2). Pixel-level
render confirmation: `graphics-formats.md` §9.

### 2.3 Palette table — confirmed

Decoding the 16 words at `0x23A9E` under the **raw ST 3-bit-per-channel**
lookup (§2's `ST` table — *not* the Amiga `AmigaToST` even-nibble variant,
since `PHANT.PRG` is itself the Atari ST binary, storing genuine 3-bit
nibbles rather than Amiga's doubled 4-bit nibbles) yields a fully plausible,
distinct 16-colour palette: black, brown (182,73,36), red, orange, gold,
yellow, green, dark green, olive, cyan, sky blue, blue, a light pink/white
shade (255,219,219), grey, magenta, white — the same colour *family* as
P1's `game+0x194BC` palette (`§1.3`) at every index. Notably, **index 12
resolves cleanly here** (nibbles `7,6,6` under the raw ST lookup) where
P1's `AmigaToST`-decoded version of the same palette family left index 12
as an unrepresented odd-nibble outlier — this P2 finding independently
explains what that P1 outlier's true colour intent was (a light pink/white
shade), since the Amiga port's even-nibble-only lookup simply cannot
represent odd ST nibble values exactly. **Confidence: confirmed.**

### 2.4 Race name table — confirmed

Reading sequential NUL-terminated strings from `0x1F01C` yields exactly 16
names, **byte-identical to P1's race list**: `HUMAN, DWARF, ELF, HALFLING,
GNOME, PIXIE, SPRITE, OGRE, GNOLL, TROLL, KOBOLD, ORC, GOBLIN, LIZ.MAN,
MINOTAUR, UNDEAD` — the 17th string (`DEAD`) is unrelated status-name data,
confirming the table is exactly 16 entries as documented for P1.
**Confidence: confirmed.**

### 2.5 Sprite bitplane layout — confirmed (see `graphics-formats.md` §9)

The reference source's `Sprite.CreateBitmap` calls using
`ModesEnum.Interleaved`/interleave=2 for P2 (the ST word-interleaved
convention, same as P3's CMP container) is **confirmed against real pixel
renders** — see `graphics-formats.md` §9 for the full render comparison
table. This applies to **both** `MSTR*.PAT` and `PARTY*.PAT`, correcting an
earlier size-based guess that `PARTY*.PAT` might keep P1's layout because
its file size matches P1's byte-for-byte (`stx-extraction.md` §7) — the
render evidence shows this reasoning doesn't hold; both file families use
the same Interleaved layout on P2 regardless of size coincidence.

## 3. Phantasie III (Amiga) — monster table (`monsinfo.dat`)

File: `data/phantasieiii/amiga/monsinfo.dat`, 3,072 bytes.

### 3.1 Record layout

Fixed 38-byte records, 80 records, starting at file offset 0 (no header).
`80 * 38 = 3,040`; the remaining `32` bytes (offset `3040`-`3071`) are
trailing padding — a repeated single filler byte (`0x60` in this file),
matching the same 128-byte-boundary disk-padding convention documented for
the CMP/CSH/SET files (`3072 = 128 * 24` exactly).

| Offset (within record) | Size | Field | Notes |
|--------------------------|------|-------|-------|
| `0x00` | up to 14 | Name | Space-padded ASCII (`0x20`) up to a single trailing NUL terminator, not zero-padded throughout — e.g. `"Skeleton"` is followed by 5 space bytes then one `0x00` (confirmed during implementation; decoders should `.trimEnd()`, not stop at the first NUL) |
| `0x0E` (14) | 1 | `nb` | Encounter group size (number of this monster that appear together) |
| `0x0F` (15) | 1 | Attack | Raw byte value; reference tool multiplies by 10 for display (`attack = byte * 10`) |
| `0x10` (16) | 1 | Weapon | Weapon-type index (into an item/weapon table — table location not identified in this pass) |
| `0x11` (17) | 1 | Armor | Armor-type index |
| `0x12` (18) | 1 | Defense | |
| `0x13` (19) | 1 | Threat/morale | |
| `0x14` (20) | 1 | Spell probability | |
| `0x15` (21) | 1 | Spell 1 | Spell index |
| `0x16` (22) | 1 | Spell 2 | Spell index |
| `0x17` (23) | 1 | Spell 3 | Spell index |
| `0x18` (24) | 1 | MP | |
| `0x19` (25) | 1 | HP | |
| `0x1A` (26) | 1 | Alignment | |
| `0x1B` (27) | 1 | Sprite index | See `graphics-formats.md` §6 for the bank/cell mapping this feeds |
| `0x1C` (28) | 1 | Companions probability | |
| `0x1D` (29) | 1 | Companion 1 | Monster index of a possible companion creature |
| `0x1E` (30) | 1 | Companion 2 | Monster index of a possible companion creature |
| `0x1F` (31) | 1 | Item 1 | Item index (droppable) |
| `0x20` (32) | 1 | Item 2 | Item index (droppable) |
| `0x21` (33) | 1 | Is undead | Boolean flag |
| `0x22` (34) | 2 | Gold | Big-endian `u16` |
| `0x24` (36) | 1 | Experience | Single byte — note the small range (max 255); either a raw XP value or a scaled/tiered code, not independently determined |
| `0x25` (37) | 1 | (unused) | Trailing pad byte within the 38-byte record, not read by the reference tool |

**Confidence: confirmed** (record boundaries, stride, field offsets, and
padding — all read from source and independently structurally validated).
**Confirmed via legible output:** decoding names at `i*38` for `i=0..5` and
`i=79` yields `Skeleton`, `Sniverling`, `Drip Slime`, `Undead Gnome`,
`Wild Cat`, `Giant Bee`, ..., `Lord Wood` — all legible, distinct,
in-genre monster names (note: mixed-case here vs. P1's all-caps names,
consistent with P3 being a later, separately-authored data set).
**Not independently verified:** exact semantic scaling of `attack`,
`experience`, and the weapon/armor/spell/item index meanings (no
cross-referenced weapon/item/spell name tables were located in this pass
to confirm what index N actually names).

### 3.2 Monster→sprite-bank mapping

See `graphics-formats.md` §6 — the `spriteIndex` field above feeds a
piecewise bank-index/cell-index formula, with two hardcoded single-value
patches for "elemental" (`spriteIndex==48`) and "wild dog"
(`spriteIndex==65`).

## 4. Phantasie III (Amiga) — race table

**Offsets not resolved for the Amiga binary.** The reference source's
`RacesManagerP3.cs` reads race names and bank-sprite-index values from a
file it opens as `"Disks/P3 - ST/PHANT_3.PRG"` — i.e. the **Atari ST**
executable, not the Amiga one — at offsets `0x57D8` (a 6-byte-stride,
18-entry word table of name-string offsets), `0x21A2E` (base address the
name offsets are relative to), and `0x6C52` (a 4-byte-stride, 18-entry
word table giving `bankSpriteIndex*2`).

These offsets were tested directly against this project's
`data/phantasieiii/amiga/PhantasieIII` (174,928 bytes, a genuine
uncompressed — confirmed via 68k-code entropy/opcode-density check, not
just filename — AmigaOS HUNK executable) both as raw file offsets and
adjusted by the CODE hunk's file-relative data start (`+40`, derived from
parsing the HUNK header: `HUNK_HEADER` (32 bytes) + `HUNK_CODE` tag+size
prefix (8 bytes) = 40). **Both attempts produced garbage** (non-printable
byte sequences where race names should be) — confirming these specific
offsets are ST-binary-specific and do not carry over to the Amiga
executable, most likely because the two platforms' compiled binaries have
genuinely different data layouts (different compiler/linker, different
code size), not because of a simple segment-relative-vs-file-relative
mismatch (which the `+40` adjustment attempt ruled out).

Race count is known from source (`RacesManagerP3.Count = 18`, one more
than P1/P2's 16 — matching the `RaceType` enum's `Elemental` addition, per
`Race.cs`'s comment table cross-referencing P1/P2/P3 race-index
orderings), but the byte offsets to read the 18 names/sprite-indices from
the **Amiga** `PhantasieIII` executable were not found in this pass — see
Open Questions.

## 5. Phantasie III (Amiga) — skills table

Confirmed **directly against `data/phantasieiii/amiga/PhantasieIII`** (the
same file used in §4, this time successfully) — the reference source's
comment block identifies its four skills-table byte arrays as coming from
`ST/Phantasie 3.dmp`, `Amiga/PhantasieIII`, `C64/town.obj.prg`, and
`Apple/TINFO.BIN` respectively; the `Amiga/PhantasieIII` source matches
this project's file by name and — confirmed below — by content.

### 5.1 Table locations

Eight skills, each a `[6 classes][15 levels]` = 90-byte flat byte table
(class-major, i.e. all 15 levels for class 0, then all 15 for class 1,
etc.), at these file offsets in `PhantasieIII`:

| Offset | Skill |
|--------|-------|
| `0x28386` | Attack |
| `0x283E0` | Parry |
| `0x28439` | Swim |
| `0x28493` | Listen |
| `0x284ED` | Spot trap |
| `0x28547` | Disarm |
| `0x285A1` | Spot item |
| `0x285FB` | Pick lock |

Class order within each 90-byte table (confirmed, see §5.2): **Fighter,
Thief, Priest, Ranger, Monk, Wizard** (15 bytes each, in that order) — note
this differs from the reference tool's internal `ClassEnum` declaration
order (`THIEF, MONK, RANGER, FIGHTER, PRIEST, WIZARD`), which is just an
arbitrary enum-member order, not the on-disk field order.

**Confidence: confirmed, byte-exact.**

### 5.2 Verification

Reading the Attack table at `0x28386` under the Fighter/Thief/Priest/
Ranger/Monk/Wizard 15-byte-block order produces a clean, monotonically
non-decreasing per-class level progression for 14 of each class's 15
levels — e.g. Fighter: `100, 110, 120, 135, 145, 155, 165, 180, 190, 200,
210, 220, 235, 245, 255` (a textbook level-1-to-15 stat curve, ending
exactly at the byte max 255); Thief: `70, 75, 80, ..., 140`. The Parry
table at `0x283E0` shows the same clean pattern for most classes. A small
number of classes' **15th** (last) level value breaks the otherwise-clean
monotonic trend (e.g. Ranger's Attack level 15 reads `25`, a drop from
level 14's `235`; three classes' Parry level-15 values also drop) — this
is called out rather than smoothed over; it may indicate the 15-level
table is genuinely only reliable for 14 levels with the 15th byte
overlapping a different field, or a real in-game "capped" representation.
Not further investigated in this pass.

## 6. Phantasie III (Amiga) — item table (`inititem.dat`)

File: `data/phantasieiii/amiga/inititem.dat`, 3,328 bytes.

**No reference source exists for this file** — none of the reference
tool's C# files construct or parse `inititem.dat` (confirmed by exhaustive
grep across the entire reference source tree). Everything below is this
project's own independent structural analysis, not a transcription from a
known-good decoder — treat it as a **hypothesis**, not a confirmed format.

### 6.1 Structural finding

A whole-file scan for readable text runs (≥3 consecutive printable ASCII
bytes) found **no item name strings anywhere** in the file — only a single
70-byte run of the padding character `:` (`0x3A`) at the very end. This
rules out "38-byte name+stats record" (the `monsinfo.dat` shape, §3) as a
model — whatever this table's records look like, they do not embed names.

A stride search (reshaping the non-padding region into rows of candidate
byte widths and measuring how many resulting "columns" have a small,
bounded set of distinct values — a signature of real per-field columns
rather than arbitrary byte noise) strongly favours an **18-byte stride**:
at stride 18, **all 18** resulting columns are low-cardinality
(candidate field columns); at the only other integer-divisor candidate in
a plausible record-size range (there are few, since `3258 = 2 × 3² × 181`
has an unusually sparse factorisation), the fit was far weaker.

18-byte stride implies **181 records**, and `181 × 18 = 3,258` — which
lands **exactly** on the byte offset where the file's data region ends and
the trailing `:`-padding run begins (confirmed independently by the text
scan above, not assumed). `3,328 = 128 × 26`, consistent with the
128-byte disk-padding convention seen throughout this data set.

### 6.2 Observed row shape (unconfirmed field semantics)

Record 0 (bytes `0x00`-`0x11`) is all-zero — plausibly a "no item"/empty
slot, common at index 0 in RPG item tables. Of the 181 records, 87 (~48%)
have at least one non-zero byte. Sample non-zero rows show small integer
values (0-20 range) at varying byte positions, plus a recurring 16-bit
big-endian value `0x00C8` (200) appearing at consistent-looking column
pairs across multiple rows (e.g. row 17: bytes 1-2 and 7-8 both `0x00C8`;
row 27: bytes 2-3, 7-8, and 10-11 all `0x00C8`) — consistent with a
repeated "cost"/"value" field (200 gold?) reused across multiple related
item slots, but this is speculative pattern-matching, not a confirmed
field decode.

**Confidence: hypothesis.** Record boundary (18-byte stride, 181 records,
0-3257 data region + 70-byte trailing pad to 3328) is well-supported by
the exact byte-accounting above. Individual field meanings within a
record are **not** determined — no field names, no confirmed types beyond
"looks like small integers with an occasional 16-bit value", and no
cross-reference to any name table was found to confirm this is even an
"item" table in the sense of `monsinfo.dat` being a "monster" table
(the filename `inititem.dat` — "init item" — is also consistent with a
narrower reading, e.g. per-character-class **starting equipment loadouts**
rather than a full item catalogue; 181 "items" would be unusually large
for a starting-kit table, which weakly favours "item catalogue" over
"starting loadout", but this was not resolved).

## 7. Phantasie III (Amiga) — save file and system configuration

Noted briefly per task scope (not deep-dived):

- **`gamesave.dat`** (11,812 bytes) begins with the literal ASCII string
  `THIEF` at offset 0, followed by binary stat data, then further class
  name strings (`FIGHTER`, `WIZARD`, `MONK`, `PRIEST`, `RANGER`) and at
  least one character name (`Mist`) later in the file, with the six class
  names repeating — consistent with a multi-character party/roster save
  file, one record per character, starting with the character's class
  name. Not further decoded.
- **`system-configuration`** (232 bytes) — not game-specific data; its
  content (`Imagewriter` printer name, dimension/margin-looking word
  pairs) matches the shape of a standard AmigaOS `Preferences`-style
  binary blob (printer/serial/screen settings), unrelated to Phantasie's
  own data.

## 8. Open questions

- **P3 race table offsets for the Amiga `PhantasieIII` executable** — the
  reference source only has offsets for the Atari ST build
  (`PHANT_3.PRG`); both a raw-offset and a hunk-data-start-adjusted
  (`+40`) attempt against the real Amiga executable failed. Would need a
  fresh disassembly/string-scan of `PhantasieIII` to locate the 18 race
  names and their bank-sprite-index table independently (marked
  optional/stretch in the originating task — not pursued further here).
- **P3 `inititem.dat` field semantics** — record stride/count is
  well-supported structurally (§6.1) but individual field meanings are
  unconfirmed; no reference source exists at all for this file.
- **P3 monster table's weapon/armor/spell/item index meanings** (§3.1) —
  the index values themselves decode cleanly, but no corresponding
  name/lookup table for weapons, armor, spells, or items was located in
  this pass to translate an index into a display name.
- **P3 skills table's anomalous 15th-level values** (§5.2) — a handful of
  classes' final skill-level byte breaks the otherwise-clean monotonic
  progression; not investigated further.
- ~~**Phantasie II (Atari ST) monster/race tables**~~ — **resolved.** All
  five §2 offsets confirmed byte-exact against the real `PHANT.PRG`
  (`data/phantasieii/atarist/extracted/disk1/PHANT.PRG`), and the sprite
  bitplane layout confirmed via pixel-level render (`graphics-formats.md`
  §9). See §2.1-§2.5 above.
- **P1 `game`/`run` HUNK structure vs. the offsets used** — every P1
  offset in §1 works as a **raw, unadjusted file offset**, which is
  genuinely puzzling: `game`'s `HUNK_HEADER` parses cleanly as a real
  240-hunk table (`table_size=240`, `first_hunk=0`, `last_hunk=239`, hunk
  size table sums to 167,788 bytes against a 193,804-byte file — the
  remainder being per-hunk tag/size/reloc/end overhead), the hunk-size
  table itself ends at file offset `980`, and hunk 0's own `HUNK_CODE` data
  block is only 460 bytes (file offset `988`-`1448`) — far too small to
  contain any of the tables in §1 (the smallest offset used, `0x0C88` =
  3,208, is already past hunk 0 entirely, let alone the largest,
  `0x194BC` = 103,612). So the raw-file-offset reads that worked are
  landing in whichever of the 240 hunks actually contains that data, by
  what appears to be numeric coincidence between file-relative and
  post-relocation-memory-relative addressing rather than a general rule —
  confirmed to work for the 5 specific tables in §1 (byte-exact structural
  and legible-text evidence), **not** established as a rule that would
  safely generalise to an arbitrary new offset in this file. A real hunk
  walk (resolving which of the 240 hunks each address falls in, and that
  hunk's file-vs-load-address delta) was not performed — flagged rather
  than chased further, since every offset actually needed for this pass
  already checked out.
