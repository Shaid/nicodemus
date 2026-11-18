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

> **Pipeline status (2026-08-12, `game-re`):** every table in this document
> that has a decoder function is now also republished as browsable JSON —
> not just extracted to `data/extracted/` (Stage 1) but written into
> `public/assets/<game>/<platform>/` (Stage 2, `tools/<game>/
> build-data-tables.ts`, additive to each game's existing `build-assets.ts`)
> with `type: 'data-table'` manifest entries, and rendered on the public
> docs site (`www/`) via a new `DataTable.astro` component —
> `phantasie/data-tables`, `phantasieii/data-tables`,
> `phantasieiii/data-tables`. This closes the "real data tables, not just
> prose" gap the site previously had. §1.5/§2.6 (P1/P2 item names) gained
> new `readP1ItemNames()`/`readP2ItemNames()` decoder functions this pass
> (same `readSequentialCStrings` helper `readP3ItemNames()` already used) —
> the offsets and confirmation evidence documented below were already
> present, only the decoder function itself was missing before this pass.
> §7's `readP3ItemStats()`/`readP3ItemPrices()`/`readP3ShopMarkups()` are
> now also exposed as a single merged `readP3Items()` (item id → name +
> stats + price, `attributesRequired`/`pointValue` correctly `null` rather
> than a fabricated `0` for ids 101-180, which the stats table doesn't
> cover — shop markups stay a separate armoury-indexed array since they
> don't share the item-id axis).

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

> **Correction (2026-08-09, re-codebreaker):** this section originally
> described `0x194BC` as *the* P1 palette. It is one slot of a **5-entry
> array of 16-colour palettes** at `0x1945C`, and the game selects among
> them per screen. The array, the selection code, and the per-screen
> mapping are now all code-confirmed — see §1.3a below. The `0x194BC`
> byte-level decode in the table that follows is unchanged and still
> correct; only its "this is the palette" framing was wrong.

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `0x194BC` | 2 × 16 | 16-colour palette (slot 3 of 5) | Native Amiga 12-bit `$0RGB` word, one word per colour index; loaded verbatim into `ColorMap->ColorTable` and handed to `graphics.library/LoadRGB4` (see §1.3a) |

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

> **Correction (2026-08-09, re-codebreaker):** the "index 12 has odd
> nibbles, which the `AmigaToST` even-nibble lookup maps to 0" note was
> treating an Amiga-native palette as if it were an Atari ST one.
> `data/phantasie/amiga/game` is an AmigaOS HUNK executable and these
> words are consumed directly by `graphics.library/LoadRGB4` (call site
> byte-confirmed, §1.3a), which reads all three 4-bit components at full
> resolution — **every** nibble value 0-15 is legal, and there is no
> even-nibble constraint to satisfy. `0x0EBB` is simply R=14, G=11, B=11
> (a pale salmon), not an anomaly. Correct decode for P1 Amiga is
> `component * 17` (or `component << 4 | component`) on the raw nibble;
> the ST `AmigaToST` doubling table belongs to the **P3/P2 ST-sourced**
> containers (`graphics-formats.md` §2) and must not be applied here.
> Scope of the bug: exactly 5 of the 240 nibbles across the five
> palettes are odd — `pal2[3]` `0x0EB0`, `pal2[4]` `0x008B`, `pal3[12]`
> `0x0EBB` (two odd nibbles), `pal4[2]` `0x0EB0`; all five are the value
> `11`. An even-nibble lookup silently zeroes those components. The
> remaining 235 are even, which is why the error stayed invisible.

> **Fix applied (2026-08-10):** `readP1Palette()` (`exe-data.ts`) now uses
> the `'amiga'` decode variant, matching `readP1PaletteSlot()`. This
> changes its output values — e.g. nibble `14` now decodes to `238`
> (`component * 17`), not `255` (the old ST doubling table's value) — so
> the RGB888 column above, computed under the old decode, is no longer
> what the reader actually produces; the raw palette words and nibble
> values in the table are unaffected and still correct. Golden test
> values in `exe-data.test.ts` were updated to the real decoded output
> (verified against the actual file, not hand-computed); `decor.pic`/
> `final.pic`/the monster-race sprite banks were rebuilt and visually
> re-confirmed legible under the corrected palette. `palette.test.ts`'s
> own `amigaToSt`-variant tests are unchanged and still correct — they
> test that decode mode in isolation (still valid for its real use case,
> P2/P3's ST-sourced containers), not its former misapplication to P1.

### 1.3a Palette array and per-screen palette selection

**Confidence: confirmed** (byte-exact `HUNK_RELOC32` operand resolution
for every call site listed, plus pixel-level render verification).

The executable holds **five** consecutive 32-byte palettes in DATA
hunk 69, and a single shared setter selects among them per screen:

| Slot | File offset | hunk 69 rel | Contents (words) | Role |
|------|-------------|-------------|------------------|------|
| `pal0` | `0x1945C` | `+0x34` | all `0x000` | **Not a palette** — the all-black "blank the screen" table used to hide loading (see `SetBlackPalette` below) |
| `pal1` | `0x1947C` | `+0x54` | `000 E00 E24 800 EE0 264 0E0 A20 0EE 0AE 04E 666 444 AAA 888 EEE` | Town screen (`Pelnor.pic`), character sheet / party status, `scrolls.dtx` reader, `logo.pic` overlay |
| `pal2` | `0x1949C` | `+0x74` | `000 E00 280 EB0 08B E0E 22E 08A 666 A40 460 E80 4E2 888 26A EEE` | Dungeon / outdoor exploration screen (hunk 56, the `DNG.SAV`/`OUT%-d.DAT` module) |
| `pal3` | `0x194BC` | `+0x94` | see §1.3 table | `decor.pic`, `final.pic`, and the monster/race sprite banks (`MSTR*.PAT`, `PARTY*.PAT`) |
| `pal4` | `0x194DC` | `+0xB4` | `000 820 EB0 AAA C22 620 048 068 A20 0EE 0AE 04E 48A 666 888 EEE` | Title sequence (`cover1.pic`, `cover2.pic`); also the town-services screen, with a runtime patch (below) |

`hunk69+0xD4` and `+0xE0` look like two more 32-byte blocks but are
**not** palettes — they are mouse-pointer sprite image data, passed to
`intuition.library/SetPointer` at `game+0x1F0EE` and `game+0x1FE2C`
(both operands `HUNK_RELOC32`-resolved). Do not extend the palette array
past `pal4`.

**The setter.** `SetPalette(UWORD pal[16])` at file offset `0x1F1CA`
(hunk 77 `+0x466`):

```
for (i = 0; i < 16; i++)
    colorMap->ColorTable[i] = pal[i];     /* BSS var hunk79+0x52C */
LoadRGB4(viewPort, colorMap->ColorTable, 16);   /* hunk79+0x520 */
*(UWORD *)(hunk78+0x14) = 1;              /* "palette is live" flag */
```

`LoadRGB4` is reached by `jsr` at `game+0x1F218`, whose absolute-long
operand at `game+0x1F21A` resolves via `HUNK_RELOC32` to hunk 236
`+0x54` — and hunk 236's `HUNK_SYMBOL` block names `+0x54` exactly
`_LoadRGB4`. `colorMap` comes from `GetColorMap(16)` at `game+0x1EE66`
(hunk 236 `+0x260` = `_GetColorMap`); `viewPort` from
`ViewPortAddress(window)` at `game+0x1EE52` (hunk 237 `+0x108` =
`_ViewPortAddress`).

**Every call site of `SetPalette`, exhaustively** (7 cross-hunk
`HUNK_RELOC32` call sites + 3 intra-hunk `bsr` — the `bsr`s are invisible
to a relocation scan and were missed by earlier passes):

| Call site (file offset) | Reached by | Argument | Screen |
|---|---|---|---|
| `0x7652` | reloc, hunk 20 `+0x18E` | `pal1` `0x1947C` | `scrolls.dtx` scroll-text reader |
| `0x98C8` | reloc, hunk 26 `+0xC54` | `pal4` `0x194DC` | Town-services entry (see runtime patch) |
| `0xA142` | reloc, hunk 29 `+0x36` | `pal1` `0x1947C` | `SelectTown(idx)` — town/party display |
| `0xBFF8` | reloc, hunk 32 `+0x5B0` | `pal3` `0x194BC` | `decor.pic` / `final.pic` ending sequence |
| `0x15574` | reloc, hunk 53 `+0x344` | `pal3` `0x194BC` | Monster/race sprite loader (`*.PAT`) |
| `0x16FC0` | reloc, hunk 56 `+0x558` | `pal2` `0x1949C` | Dungeon exploration |
| `0x17946` | reloc, hunk 56 `+0xEDE` | `pal2` `0x1949C` | Dungeon exploration |
| `0x1F0AA` | **`bsr`**, hunk 77 `+0x346` | `pal4` `0x194DC` | Title sequence (`cover1.pic`/`cover2.pic`) |
| `0x1F22A` | **`bsr`**, hunk 77 `+0x4C6` | `pal0` `0x1945C` | `SetBlackPalette()` wrapper at `0x1F224` — 7 external callers (hunks 20, 32, 41, 56) use it to blank the screen before a load |
| `0x1F280` | **`bsr`**, hunk 77 `+0x51C` | BSS `hunk79+0x4F0` | `RestorePalette()` — replays the 16 words saved by `SavePalette()` at `0x1F236`, which reads them back with `GetRGB4` |

**Runtime palette mutation (one instance, exhaustively searched).** A
whole-binary scan of every `HUNK_RELOC32` operand pointing into
`hunk69+0x30..0xE0` finds exactly one *write*: `move.w #$0E00,
(hunk69+0xB8)` at `game+0x98B8`, i.e. `pal4[2] = 0x0E00` (pure red,
replacing the stored `0x0EB0` orange), executed immediately before that
routine's own `SetPalette(pal4)`. This runs on town entry, so any pal4
render of a *post-title* screen must apply the patch; the title sequence
sets pal4 before any town code runs and therefore uses the pristine
stored table. No other palette slot is ever written at runtime.

**Second colour path (`SetRGB4`).** All eight `_SetRGB4` call sites in
the binary are inside hunk 77 (`+0x232`, `+0x2CE`, `+0xE92`, `+0xEB6`,
`+0xEDA`, `+0xFCE`, `+0xFF2`, `+0x1016`). The exported one is
`SetOneColour(index, rgb)` at `0x1EFEC` (hunk 77 `+0x288`, 4 callers:
hunk 26 `+0xE68`/`+0xECE`, hunk 32 `+0x756`/`+0x90E`); hunk 26 `+0xEA4`
uses it to **fade in** `pal1` one index at a time with a 7-frame
`WaitTOF` delay per colour. A separate colour-cycling routine at
`0x1EEDC` (hunk 77 `+0x178`, sole caller hunk 80 `+0x1AE`) rotates three
words held in hunk 78 `+0x6..+0xC`. Neither introduces palette data of
its own — the source words are still the stored slots above.

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

### 1.5 Item name table

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `0x5EFC` | variable | Item name strings | 181 sequential NUL-terminated ASCII strings, back-to-back (same "no fixed stride" convention as the race table, §1.4) — index 0 is `"NOTHING"` (the empty-item-slot sentinel), indices 1-180 are real items |

Located by grepping the raw executable for known RPG-item substrings
(`SHIELD`, `SWORD`, `DAGGER`, ...) and then reading sequential
NUL-terminated strings backward/forward from the first hit until a
non-printable byte was reached. The table runs from `0x5EFC`
(`"NOTHING"`) to `0x6539` (byte immediately after the NUL terminating
entry 180, `"DIAMOND E"`), immediately followed by a run of big-endian
`u16` numeric data (unexplored — likely a price/value table, not pursued
in this pass) and then, at `0x697E`, the six class-name strings
(`THIEF, MONK, RANGER, FIGHTER, PRIEST, WIZARD`) immediately preceding
the already-confirmed race-name table at `0x69BE` (§1.4) — i.e. the item
table is followed by *exactly* the same class-name-then-race-name
sequence found in P2 (§2.6 below), an independent structural
cross-check that this is the right table family, not a coincidental
string run.

**Confidence: confirmed, byte-exact, cross-validated against real
dungeon-script data.** All 181 entries decode as legible, distinct,
in-genre item names (armor/shields at low indices, weapons, then
potions/scrolls/rings/gems at increasing indices — e.g. index 51 =
`"SM AXE"`, matching the confirmed example action record in
`scripting-engine.md` §2, which gives item 51 via opcode `0x06`).
Independently verified by decoding every real action-table record with
opcode `0x06` ("+Item") across all 10 real `data/phantasie/amiga/dng1`-
`dng10` files (the confirmed packed/variable-stride scan, base `0x05AA`,
terminated by `0x0D 0x0D` — `scripting-engine.md` §2; **superseded 2026-11-13: the table is a fixed 256 slots, the terminator walk dropped records — corrected census is 62 distinct, see `scripting-engine.md` §6 correction**): **63 (as originally counted; 62 re-derived) distinct item
indices referenced, 0 out of the 0-180 range**, every one resolving to a
plausible, thematically-appropriate loot item (e.g. `RING MAIL`,
`LNG SWORD`, `SCROLL 1`-`SCROLL 20`, `DIAMOND A`-`DIAMOND C`, `GOLD KEY`).
See `scripting-engine.md` §6 for the full cross-check methodology and
result table.

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

> **Correction (2026-11-13):** the "P1 `AmigaToST`-decoded outlier at index 12" premise above is retracted — `readP1Palette()` now uses the native Amiga `component*17` decode (§1.3 correction), so there is no P1 outlier to explain. The P2 palette finding itself stands.

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

### 2.6 Item name table — confirmed

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `0x1E9CC` | variable | Item name strings | 181 sequential NUL-terminated ASCII strings — same layout as P1 §1.5, index 0 is `"NOTHING"` |

Found at the exact same relative structural position as P1: item names
run from `0x1E9CC` (`"NOTHING"`) to `0x1EFEB` (end of entry 180,
`"GOD RING"`), immediately followed by the class-name table
(`THIEF, MONK, RANGER, FIGHTER, PRIEST, WIZARD` at `0x1EFF4`) and then the
already-confirmed race-name table at `0x1F01C` (§2.4). P2's item roster
differs from P1's past the shared early-game armor/weapon list (P2 has
distinct scroll-lettering `SCROLL A`-`SCROLL N` instead of P1's
`SCROLL 1`-`SCROLL 20`, and a different late-game gem/treasure list) —
expected, since P1 and P2 are different games sharing an engine, per the
same rationale already noted for the monster/race tables (§2.1/§2.4).

**Confidence: confirmed, byte-exact, cross-validated against real
dungeon-script data.** Independently verified against every real
opcode-`0x06` ("+Item") action record across all 8 real
`data/phantasieii/atarist/extracted/{disk1,disk2}/DNG1`-`DNG8` files:
**44 distinct item indices referenced (terminator walk; 56 with the corrected 256-slot decode, 2026-11-13), 0 out of the 0-180 range**, all
resolving to plausible items (`MD SHIELD`, `SWORD +2`, `HEAL POT7`,
`SCROLL H`, `DIAMOND`, etc.). See `scripting-engine.md` §6.

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
| `0x10` (16) | 1 | Weapon rating | **Not an item-table index** (confirmed this pass, see below) — a raw combat-power stat, despite the reference source's field name |
| `0x11` (17) | 1 | Armor rating | Same reframing as Weapon rating — a raw combat-power stat, not an item index |
| `0x12` (18) | 1 | Defense | |
| `0x13` (19) | 1 | Threat/morale | |
| `0x14` (20) | 1 | Spell probability | |
| `0x15` (21) | 1 | Spell 1 | Index into the P3 spell name table (§3.1 below) — **confirmed** |
| `0x16` (22) | 1 | Spell 2 | Index into the P3 spell name table — **confirmed** |
| `0x17` (23) | 1 | Spell 3 | Index into the P3 spell name table — **confirmed** |
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

**Monster-name-table index space independently cross-checked against
real dungeon scripts**, the same way as P1/P2 (§1.5/§2.6): scanning every
real opcode-`0x05`/`0x11` ("encounter") action record across all 11 real
`data/phantasieiii/amiga/D/dng{a..k}.dat` files (fixed 256-slot action
table, base `0x0393`, no terminator — `scripting-engine.md` §2) finds 8
distinct monster indices referenced, **0 out of the 0-79 range**, all
resolving to plausible encounters (`Viper`, `Wizard`, `Guagle Beast`,
`Nikademus` — the final boss, referenced twice at indices 77/78, `Lord
Wood`).

**Item name table found** (`data-tables.md` was previously missing this —
see §1.5/§2.6 for the P1/P2 equivalent): the same 181-entry sequential
NUL-terminated item-name string table exists in `PhantasieIII` itself, at
file offset `0x466C` — entry 0 is the single character `"0"` (P3's own
"empty item" sentinel, differing from P1/P2's `"NOTHING"` string but
serving the same role), entries 1-180 are real items (mixed-case, e.g.
`"Wooden Shield"`, `"Small Axe"`, `"Wand of Nikademus"` at the final
index 180). Table ends at `0x4E74`, immediately followed by a spell-name
table using the same convention (own placeholder `"0"` at its own index
0). **Cross-checked against real dungeon scripts** the same way as
above: all real opcode-`0x06` records across the 11 P3 dungeon files
resolve to 71 distinct in-range item indices, 0 out of range (e.g.
`"Wand of Nikademus"` — the unique endgame item — at index 180).

**Cross-checked against the real SSI 1987 rule book** (see
`implementation-plan.md`'s primary-source addendum), which catalogues
items 1-120 by number across four categories (Shields 1-20, Armor 21-40,
Bows 41-60, Melee Weapons 61-100, Healing Potions 101-110, Magic Potions
111-120). This pass re-read the manual's own catalogue pages directly
(PDF pages 21-22, the rule book's own printed pages 17-18, via `Read`'s
`pages` parameter on the source PDF) rather than trusting an
earlier transcription verbatim — the earlier transcription's own
`"Halbred"` spelling turned out to be an eyeballed-OCR slip (the manual
itself prints `"Halberd"`, matching the game data exactly; corrected here
before diffing). Decoding `readP3ItemNames()`'s output at indices 1-120
against the manual's real page text: **117/120 exact matches, 3
deviations**, two cosmetic and one genuinely substantive:

- `40`: `"God Armour"` (game) vs. `"God Armor"` (manual) — a
  British/American spelling choice, same item, not a data error.
- `81`/`82`: **the game's own table reads `"Dagger +1"`/`"Dagger +2"`,
  but the manual's printed catalogue lists these exact item numbers as
  `"Knife +1"`/`"Knife +2"`** — a real, non-cosmetic discrepancy between
  the published 1987 manual and the shipped Amiga binary's actual data
  (both sources independently re-verified: the manual's page image was
  re-read directly for this check, and the game bytes were re-extracted
  fresh, not reused from an earlier pass). The base items at `61`
  (`"Knife"`) and `62` (`"Dagger"`) are unaffected and match both
  sources exactly, and every other `+1`/`+2` pair in the 81-100 range
  (`Club +1/+2` at 83/84, `Flail +1/+2` at 85/86, etc.) matches the
  manual exactly — so this is an isolated two-entry divergence, not a
  systematic offset or ordering error. Likely a late development-time
  rename (manual typeset before the final data pass) or a manual erratum;
  not resolvable further from data alone. **The game's own in-binary
  name (`"Dagger +1"`/`"Dagger +2"`) is authoritative for this project's
  extractors and assets** — the manual is being used here as a
  cross-check oracle, not as a data source to override real bytes.

Every other shield/armor/bow/melee-weapon name and `+N` enchantment suffix
lines up index-for-index (117/120), and the manual's generic "Healing
potion N restores an increasing amount" / "Magic potion N restores `3×N`
magic points" description for 101-120 matches the table's own `"Healing
Potion 1"`-`"Healing Potion 10"` / `"Magic Potion 1"`-`"Magic Potion 10"`
naming exactly. This is the single strongest confirmation this table has
received — a first-party 1987 published source, not a third-party
reimplementation — and **upgrades the whole 1-120 range from "confirmed
via dungeon-script cross-check" to "confirmed against SSI's own manual,
with one isolated documented divergence at 81/82."** Indices 121-180
(scrolls/gems/valuables) are not individually catalogued in the manual
(described only as narrative plot items), consistent with the table's own
less-systematic naming there (`"Scroll I"`-`"Scroll XVI"`, then a long
list of gem/trinket names ending in `"Wand of Nikademus"` at 180) — no
manual cross-check possible for that range, unchanged from before.

This item table also **partially resolves** the `Item 1`/`Item 2` fields
(`0x1F`/`0x20`) above: decoding all 80 monster records' `Item 1`/`Item 2`
byte values against it gives 0 out-of-range values (39/36 distinct values
respectively, spanning the full catalogue from armor through gems/potions
— e.g. Skeleton's `Item 1`/`Item 2` resolve to `"Staff"`/`"Short Sword"`,
plausible monster drops), a clean match.

**`Weapon`/`Armor` fields (`0x10`/`0x11`) — resolved this pass, but *not*
as item indices.** The previous pass's read (values skew toward the
shield/armor-name region of the item catalogue for weak monsters, e.g.
Skeleton's field-`0x10` value `7` resolving to `"Small Shield +3"`, not a
weapon) is now explained: **these fields aren't item-table indices at
all.** Computing Pearson correlation across all 80 monster records between
this field pair and the two already-confirmed combat stats (`attackRaw` at
`0x0F`, `hp` at `0x19`):

| Pair | r |
|------|---|
| `attackRaw` vs. field `0x10` | 0.82 |
| `attackRaw` vs. field `0x11` | 0.96 |
| `hp` vs. field `0x10` | 0.81 |
| `hp` vs. field `0x11` | 0.77 |
| field `0x10` vs. field `0x11` | 0.80 |
| `defense` (`0x12`) vs. field `0x11` | -0.05 |

All four cross-stat correlations are strongly positive (0.77-0.96) — the
opposite of what an item-catalogue index would show (item-table position
has no reason to track monster power). Field `0x10`'s raw values also grow
essentially monotonically with monster tier across the 80-entry table
(`2` at index 31 `Wolf` up to `90` at index 77 `Nikademus`, the final
boss), the same shape as the already-confirmed `attackRaw`/`hp` fields, not
the shape of an arbitrary catalogue lookup. (The near-zero correlation
against `defense` at `0x12` shows this isn't just "everything correlates
with everything" — it's specifically the stat-like fields that track each
other.) **Renamed to `weaponRating`/`armorRating`** in
`src/assets/formats/monster-data.ts` to reflect this; exact display
scaling (raw value, or scaled like `attack = byte*10`) not determined.

**Spell fields (`0x15`-`0x17`) — confirmed** against the P3 spell name
table, located immediately after the item table at file offset `0x4E74`
(ends `0x513E`): 58 sequential NUL-terminated strings, index 0 the `"0"`
placeholder (no spell), indices 1-57 real spells (`Healing I`...`Divine
Aid`). Decoding all 80 monsters' three spell fields against this table: 0
out-of-range across all 240 field reads, and the result is thematically
airtight — every monster with `spellProbability == 0` also has all three
spell fields `== 0` (no spell), while every spellcasting monster resolves
to real, appropriately-scaled spells, e.g. `Ranger`→`(Healing I, Flame
Arrow I, Confusion I)`, `Wizard`→`(Fireflash III, Weakness IV, Healing
IV)`, `Small Devil`→`(Mindblast II, Mindblast II, Healing I)` scaling up to
`Dragon`/`Dragon King`→`Mindblast IV`/`Flamebolt I`, and the two
`Nikademus` (final boss) records and `Lord Wood` all resolving to the
top-tier `Healing IV`/`Weakness IV`/`Binding IV` kit. Implemented as
`readP3SpellNames()` in `src/assets/formats/exe-data.ts`.

**Confirmed byte-exact against the real SSI 1987 rule book's own "Spell
Table"** (PDF page 19, the rule book's own printed page 15, re-read directly this pass rather
than trusting an earlier paraphrase — see `implementation-plan.md`'s
primary-source addendum). The manual's printed table lists spell numbers
`1`-`52` then, after a visible gap, `54`-`56` — **55 explicit numbered
entries, `53` conspicuously absent from the printed table itself**.
Decoding `readP3SpellNames()`'s indices 1-56 against it gives **55/55
exact name matches in identical order** (`1 Healing I` ... `40 Flamebolt
IV`, `41 Charm`, `42 Sleep`, `43 Teleportation`, `44 Resurrection`, `45
Ninja II`, `46 Fear`, `47 Dissolve`, `48 "Summon Element."` — the table's
own truncated form of the manual's `Summon Elemental` — `49 "Dispell
Undead"` (manual: `Dispel Undead`, single-`l` spelling difference only),
`50 Ninja I`, `51 Awaken`, `52 "Monster Evaluate"` (manual: `Monster
Evaluation`), `54 Transportation`, `55 Accuracy`, `56 "Party
Accuracy"`) — zero mismatches, and every magic-point cost in the manual's
`MAGIC PTS.` column matches the corresponding monster/spell-progression
data already decoded elsewhere in this project.

This **resolves the numbering ambiguity flagged during manual
transcription** (uncertainty over whether `Transportation`/`Accuracy`
were numbered 53/54 or 54/55) with two independent confirmations, not
just the table gap itself: the manual's own body text (Appendix III,
"Mapping" section, page 24) reads *"Scandor is divided into a 5×5 area...
Already mapped so spell 53 (Vision) is unnecessary"* — explicitly naming
spell `53` as `Vision` and explaining why it has no player-facing effect,
which matches the game's own internal name for that slot, **`"UNUSED
SPELL (vision)"`** (index 53 in `readP3SpellNames()`'s output), almost
verbatim. Second, the manual's spell-description pages (page 16) read
*"Divine Spells (#57+): these spells may only be acquired during the
course of the game for special purposes"* — explicitly establishing that
numbered spells continue past the 56-entry table into a `#57+` "Divine"
category, matching the table's own index `57` = `"Divine Aid"` exactly.
`scripting-engine.md` §5's documented opcode `0x19` special case
(`statIndex 0x75` = 117 → "does any party member know the spell Divine
Aid") independently corroborates this same entry from the code side.
**Confidence: confirmed** — the manual match (both the numbered table and
two separate body-text passages), and the independent opcode
cross-reference, all now support the full 57-entry table (up from the
prior pass's dungeon-script-only cross-check).

### 3.2 Monster→sprite-bank mapping

See `graphics-formats.md` §6 — the `spriteIndex` field above feeds a
piecewise bank-index/cell-index formula. **Independently re-derived and
byte-verified against `PhantasieIII` disassembly this session**
(`game+0x1B4F0`-`0x1B6E2`): the thresholds/bank assignments for
`spriteIndex` 0-47 match the source-transcribed table exactly. The two
previously-documented single-value patches for `spriteIndex==48`
("elemental") and `spriteIndex==65` ("wild dog") did **not** verify — the
real function has no per-value special case; any `spriteIndex >= 48` is
clamped to 48 and falls back to the same formula applied to a fixed
constant (14), i.e. bank 2 cell 14, not the previously-documented
bank0/cell11 or bank2/cell0. Two real monsters in `monsinfo.dat` hit this
path: `Mud Elemental` (`spriteIndex 48`) and `Wolf` (`spriteIndex 65` —
not "Wild Dog", which itself has `spriteIndex 0`; the old patch's
"wild dog" label was a misidentification carried from the reference
source).

## 4. Phantasie III (Amiga) — race table

### 4.1 Race name table — confirmed, byte-exact

**Offsets found this pass**, independently of the reference source (which
only has offsets for the Atari ST build — see §4.3). Located by grepping
`data/phantasieiii/amiga/PhantasieIII` directly for mixed-case race-name
substrings (P3's item/monster names are mixed-case, unlike P1/P2's
all-caps convention — see §3.1) — `"Dwarven"`, `"Elven"`, `"Gnome"`, etc.
all hit in a single tight cluster at file offset `0x5172`-`0x51ea`:

```
Human\0 Dwarven\0 Elven\0 Gnome\0 Halfling\0 Random\0 Gnoll\0 Goblin\0
Kobold\0 Lizard Man\0 Minotaur\0 Ogre\0 Orc\0 Pixie\0 Sprite\0 Troll\0
Elemental\0 Undead\0
```

18 sequential NUL-terminated strings, exactly matching the reference
source's `RacesManagerP3.Count = 18` (§4.3) — the 18th name being
**`"Random"`** (a "generate me a random race" character-creation menu
option, not a real playable race with its own sprite), which resolves the
apparent "one more than P1/P2's 16 for one new race (Elemental)" arithmetic
mismatch flagged in the previous pass: 16 (P1/P2) + `Elemental` (17) +
`Random` (18) = 18.

This string block is **not** read directly by raw offset (unlike every P1
table and the P3 skills table, §1/§5) — it's addressed through a pointer
table, found via the `HUNK_RELOC32` cross-reference technique used
repeatedly elsewhere this session (`scripting-engine.md` §7.1a): computing
the string block's hunk-0-relative offset (`0x5172 - 0x28 = 0x514A`, where
`0x28` is `PhantasieIII`'s `HUNK_HEADER`(32B)+`HUNK_CODE` tag/size
prefix(8B) — this file has only 3 hunks total: `CODE` (data at file
`0x28`, 137,352B), `DATA` (data at file `0x278C8`, 10,108B), `BSS` (4B) —
a much simpler layout than P1's 240-hunk `game`) and scanning every
`HUNK_RELOC32` entry across the whole binary for one whose **stored
pre-relocation longword** equals that hunk-relative offset. Exactly one
hit: file offset `0x28e84` (inside the `DATA` hunk), storing `0x514A`.

Reading 30 consecutive big-endian `u32` entries starting at `0x28e84 -
6*4` through `0x28e84 + 24*4` and resolving each as `0x28 + storedValue`
shows this is one long **shared string-pointer table** — spells (ending
just before), then continent names, alignment (`Light`/`Darkness`), then
the 18 race names at table-relative indices 0-17 (file offset
`0x28e84`-`0x28ecc`), immediately followed by the 6 class names
(`Fighter`...`Wizard`), abbreviations, social-class, and status-name
strings — i.e. a single generic "string N" lookup table used throughout
the UI, not a race-specific structure. Every one of the 18 resolved
pointers decodes to the exact race name expected, in the exact order
listed above, with **zero garbage** across all 18 entries — matching the
raw string-scan result byte-for-byte.

**Confidence: confirmed, byte-exact.** Implemented as `readP3RaceNames()`
in `src/assets/formats/exe-data.ts`, tested in
`src/assets/formats/__tests__/exe-data.test.ts`.

### 4.2 Race → sprite-bank-cell mapping — LOCATED AND CONFIRMED

> **Correction (2026-08-10, `game-re`):** this section previously read
> "not located (open)", and the pipeline's working assumption was
> `bankSpriteIndex = raceIndex` (an identity mapping). **Both are now
> superseded.** The table exists, it is at file offset `0x299d8`
> (hunk 1 `+0x2110`), it is **19 bytes** (not 18 words), and it is
> emphatically **not** an identity mapping — 6 of the 18 races map to a
> cell shared with another race, and several map to a *lower* cell than
> their own index. The identity assumption would have drawn a Halfling as
> a winged Pixie, a Lizard Man as an Undead, and a Gnoll as a Minotaur.
> The three failed searches recorded below are preserved verbatim, and
> the reason all three were structurally blind is stated after them.

**Location: file `0x299d8`, hunk 1 `+0x2110`, 19 bytes, one byte per
entry.** Confirmed by disassembling the party-sprite **cell extractor** at
file `0x1b2da` — the routine that slices bank 0 into the runtime sprite
array — rather than by searching for the table's own shape:

```
0x1b2f6:  for i = 0 .. 13:                 ; 7 party slots x 2 poses
0x1b2fa:    slot = i >> 1
0x1b2fc:    if raceByte[slot] < 0: continue          ; $29E0[slot], 0xFF = empty
0x1b332:    v  = raceSpriteTable[raceByte[slot]]     ; lea $2110.l,a1 / move.b (a1,d2.l),d3
0x1b340:    srcY = (v / 10) * 0x30                   ; divs #10, muls #48  -> cell row
0x1b36c:    srcX = ((v % 10) + (i & 1)) * 4          ; swap (remainder), + pose, *4 bytes
0x1b390:    extractCell(bank=$28FC, table=$2E06, cell=i, srcX, srcY, w=4, h=0x30,
                        dstOffset=(i+1) * 0x308)
```

`srcX`'s unit is 4 bytes of one bitplane row = 32 pixels, `srcY`'s is
pixel rows — i.e. exactly `graphics-formats.md` §6's confirmed 10 × 4 grid
of 32 × 48 cells over bank 0 (`heros.cmp`). Note the row comes from
`v / 10` and the column from `(v % 10) + pose`, so an idle/attack pair
always stays on **one row**; every stored value is even with `v % 10 ≤ 8`,
so this coincides with feeding `v + pose` through the generic grid formula.

The stored values are therefore the reference source's
`bankSpriteIndex * 2` exactly as §4.3 describes for the ST build — this is
the Amiga counterpart of `PHANT_3.PRG+0x6C52`, stored one byte per entry
instead of one word.

| Race idx | Race | Stored `v` | `spriteIndex` (`v/2`) | Bank-0 cell (idle, attack) |
|---|---|---|---|---|
| 0 | Human | 0 | 0 | (0,0) (0,1) |
| 1 | Dwarven | 2 | 1 | (0,2) (0,3) |
| 2 | Elven | 4 | 2 | (0,4) (0,5) |
| 3 | Gnome | 6 | 3 | (0,6) (0,7) |
| 4 | Halfling | 6 | 3 | **shares Gnome's cell** |
| 5 | Random | 0 | 0 | (menu entry, reuses Human) |
| 6 | Gnoll | 14 | 7 | (1,4) (1,5) |
| 7 | Goblin | 16 | 8 | (1,6) (1,7) |
| 8 | Kobold | 16 | 8 | **shares Goblin's cell** |
| 9 | Lizard Man | 10 | 5 | (1,0) (1,1) |
| 10 | Minotaur | 12 | 6 | (1,2) (1,3) |
| 11 | Ogre | 14 | 7 | **shares Gnoll's cell** |
| 12 | Orc | 16 | 8 | **shares Goblin's cell** |
| 13 | Pixie | 8 | 4 | (0,8) (0,9) |
| 14 | Sprite | 8 | 4 | **shares Pixie's cell** |
| 15 | Troll | 20 | 10 | (2,0) (2,1) |
| 16 | Elemental | 22 | 11 | (2,2) (2,3) |
| 17 | Undead | 18 | 9 | (1,8) (1,9) |
| 18 | *(not a race)* | 24 | 12 | (2,4) (2,5) — dead-adventurer marker |

**Verification — independent visual ground truth, 13/13.** Cropping the
already-extracted `public/assets/phantasieiii/amiga/heros.png` at each
distinct cell pair and reading them back renders, in table order:
a human knight; a short stocky bearded axe-and-round-shield figure
(Dwarven); a green-clad pointy-hatted archer (Elven); a small
shield-bearer (Gnome/Halfling); a **winged** miniature figure
(Pixie/Sprite); a green reptilian humanoid (Lizard Man); a **bull-headed
horned** humanoid (Minotaur); a large brown hulking beast (Gnoll/Ogre); a
blue-grey shield-bearing humanoid (Goblin/Kobold/Orc); a pale ghostly
figure (Undead); a green humanoid (Troll); an amorphous rocky blob
(Elemental); and a **gravestone with a flower** for entry 18. Every one
matches the name the table assigns it, and every mismatch the identity
mapping would have produced is visibly wrong.

Entry 18 is not a race: the byte at `$29E6` (party slot 6's race byte) is
set to `0x12` = 18 immediately before a call to the extractor at file
`0x1ddec`/`0x1de02` (party-death handling), and the extractor's second
loop then also fills the three "extra" cells 14-16 of the destination
array. The **drawer** at file `0x1b6e6` maps race byte `0x10` (Elemental)
to destination cells 14/15, `0x16` to 16 and `0x30` to 14 — runtime
special-form markers outside the 0-18 race value space.

**Why the three earlier searches could not find this table.** All three
looked for the table *itself* (a distinctively-shaped 18-entry array) or
for a caller of a *name*-side artefact. The real consumer is neither: it
is a graphics routine that never touches a race name or a bank filename,
and the table is a 19-byte run of small even integers sitting between two
unrelated tables — invisible to any shape-based scan. The approach that
worked was to find the field first (`charRec.+0xA8` = race index, from the
roster line printer at file `0x129ec`, §7.1), follow that field into the
per-slot byte array `$29E0`, and then disassemble `$29E0`'s consumers.

**Confidence: confirmed** (code-traced + visual ground truth).
Implemented as `readP3RaceSpriteCells()` in
`src/assets/formats/exe-data.ts`, tested in
`src/assets/formats/__tests__/exe-data.test.ts`.

#### Superseded — the three searches that failed

The reference source's ST-binary `bankSpriteIndex*2` table (§4.3) was
searched for in the Amiga binary and **not found**. Two distinct
approaches were tried and both came back empty:

| Approach | Result | Why it didn't find it |
|----------|--------|------------------------|
| Numeric structural scan: every offset in the 174,928-byte file tested as the start of an 18-entry array of small, mostly-distinct integers (tried as `u32`/stride-4, `u16`/stride-4, `u16`/stride-2, and `u8`/stride-1, with value ceilings from 40 up to 100) | 0 convincing candidates (one `u8`/stride-1 hit at `0x287d8`, but that's the already-documented 202-byte ramp table at hunk 1 `+0x0F10`, `scripting-engine.md` §7.5.1 — a coincidental `[0,1,2,...,17]` run inside a much longer table, not an 18-entry standalone array) | A pure numeric lookup table carries no string/pointer signature a byte-pattern or reloc scan can anchor on; the search space (any 18-entry run in 175KB) is large and the true table (if byte- or word-sized) is indistinguishable from incidental data without knowing its value distribution in advance |
| `HUNK_RELOC32` xref scan for code referencing the race-name pointer table's own base (`0x28e84`, hunk-1-relative `0x15BC`) | 9 call sites found (file offsets `0x12a40`, `0x12b44`, `0x12d26`, `0x12d8e`, `0x12dbe`, `0x12f2c`, `0x13132`, `0x13c34`, `0x2073e`) | All 9 are call sites into a generic "read string by ID" routine used for UI text throughout the game (`Fighter`/status names/town names all route through the same pointer table, §4.1) — not race-specific, so this doesn't isolate a caller that would also touch a parallel sprite-index table |
| PC-relative xref scan (brute-force `p + s16(word_at(p)) == target` over the whole CODE hunk, the technique that this session's `graphics-formats.md` §3/§6 passes used successfully elsewhere on this exact binary) for callers of the 7 bank-filename strings' block (`heros.cmp`/`purple1.cmp`/.../`giant2.cmp`, file `0x444e`-`0x44db`) | 27 hits, scattered across the whole binary (`0x24c` through `0x93f8`) | No concentrated cluster resolving to one character-creation/race-select function — this is a shared filename block referenced generically (comparison/display), same shape of dead end as the numeric scan above, not a genuinely different result |

> **Post-mortem on row 1 (2026-08-10):** the numeric scan's failure has a
> sharper cause than "the search space is large". It required an
> **18-entry array of *mostly-distinct*** small integers. The real table
> is 19 entries and is heavily duplicated by design — `16` appears three
> times, `14` twice, `6` twice, `8` twice, `0` twice — so it was excluded
> by the scan's own distinctness filter, not merely lost in noise. Its
> one reported hit, `0x287d8`, is also now identified: that is the
> **item point-value table** (§7), whose first 21 bytes are the shields'
> `0..20` ramp, which is why it looked like an ascending index run.

Race sprites (`heros.cmp`, bank 0, 32×48, never giant — `graphics-formats.md`
§6) were rendering using **race index directly as the
`spriteIndex`** fed into the confirmed bank/cell grid formula (i.e.
`bankSpriteIndex = raceIndex`, an identity mapping) — this was an
**unverified working hypothesis**, not a located table, and it is now
**refuted** by the table above. It was structurally
plausible (bank 0 has 40 cells, 18 races × 2 poses = 36 fits with room to
spare) but not independently confirmed against the Amiga binary the way
the monster `spriteIndex` piecewise table now is (`graphics-formats.md`
§6, confirmed this session via direct disassembly of the *monster*
dispatcher at `0x1B4F0`-`0x1B6E2` — that function is generic per-bank
grid math, not race-specific, and doesn't read a race struct field, so it
doesn't resolve this gap either). Not escalated to `re-codebreaker` this
pass — three approaches now tried (numeric scan, race-name-table xref,
bank-filename-block xref) are all variants of "search for an anchorless
or generically-shared reference," not a full instruction-level
disassembly trace of the actual character-creation/race-select screen's
own code, which would be the next genuinely different approach. See
`TODO.md`'s `data-p3-race-sprite-index` row.

### 4.3 Reference source's ST-only offsets (superseded for the name table)

The reference source's `RacesManagerP3.cs` reads race names and
bank-sprite-index values from a file it opens as
`"Disks/P3 - ST/PHANT_3.PRG"` — i.e. the **Atari ST** executable, not the
Amiga one — at offsets `0x57D8` (a 6-byte-stride, 18-entry word table of
name-string offsets), `0x21A2E` (base address the name offsets are
relative to), and `0x6C52` (a 4-byte-stride, 18-entry word table giving
`bankSpriteIndex*2`). These offsets were tested directly against
`PhantasieIII` both as raw file offsets and adjusted by `+40`
(`HUNK_HEADER`+`HUNK_CODE` prefix) in an earlier pass; **both attempts
produced garbage**, confirming the ST offsets don't carry over to the
Amiga binary's genuinely different data layout. §4.1 above supersedes this
for the name table via an independent, from-scratch derivation; §4.2's
sprite-index table remains unresolved.

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

**Skill order matches the SSI 1987 rule book exactly** (see
`implementation-plan.md`'s primary-source addendum) — the manual's own
skills list is "Attack, Parry, Swim, Listen, Spot Trap, Disarm Trap, Find
Item, Pick Lock, Fire Bow" (9 skills, of which this 8-table set covers the
first 8 verbatim in the same order — Attack/Parry/Swim/Listen/Spot
trap/Disarm/Spot item/Pick lock, `"Spot trap"`/`"Spot item"` being this
project's own working labels for the table offsets in §5.1's list above).
This table's order was independently re-derived purely from the reference
source's stated `Amiga/PhantasieIII` provenance and its own comment block
(no manual involved at the time), so the manual match is a genuine,
independent cross-check, not circular — and it's now further corroborated
by the real on-screen character-sheet label strings found this pass
(`scripting-engine.md` §7.5.1), which give the *exact* in-game wording
("Find Trap", "Find Item", "Swimming") for these same 8 skills plus the
9th (Fire Bow, absent from this class/level progression table but present
on the character sheet and in the character record's skill-pair block).

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
level 14's `235`).

> **Follow-up pass — mechanism confirmed by disassembly; root cause of the
> specific byte values narrowed to a real data-content quirk (§8's
> `data-p3-skills-anomaly`).**
>
> **One specific case retracted outright.** The originally-reported "three
> classes' Parry level-15 values also drop" included Wizard's Parry
> level-15 read of `42` (`0x28439`, the very last byte of the 90-byte
> Parry table). That address is **not Parry data at all** — it is
> byte-identical to, and in fact *is*, the first byte of the **Swim**
> table (`0x28439` is also §5.1's documented Swim base address, and every
> class's Swim level-1 value reads `42`). The inter-table gap confirms
> this structurally: every other adjacent skill-table pair in §5.1 is
> exactly `0x5A` (90) bytes apart, but Parry→Swim is only `0x59` (89)
> bytes apart — the two tables physically share one byte in the binary.
> Mechanically the game's own indexing code (below) does still read this
> shared byte as "Wizard, Parry, level 15" (it has no way to know the
> byte does double duty), so a level-15 Wizard genuinely is shown a Parry
> skill of 42 in-game — but this is not an independent anomalous data
> point, just a byte-sharing coincidence at a table boundary. Retracted
> from the anomaly count; the real remaining Parry anomalies are Ranger
> (`85`→`60`) and Monk (`110`→`40`), not three classes.
>
> **Indexing mechanism confirmed correct — this is a plain static-table
> read, not a runtime formula with a level-15 special case.** A
> `HUNK_RELOC32` cross-reference from `PhantasieIII`'s CODE hunk (hunk 0,
> file `0x28`-`0x21890`) into the DATA hunk (hunk 1, file
> `0x278c8`-`0x2a044`) locates every code site that loads one of the 8
> skill-table base addresses: filtering hunk 0's reloc32 group targeting
> hunk 1 (4,676 entries) for target offsets inside the skills-table
> region (hunk1-relative `0xABE`-`0xD8D`) finds exactly 16 hits — the 8
> table base addresses, each referenced from 2 call sites (file
> `0xe6fa`-`0xe890` and file `0x135ce` onward). Disassembling the first
> call site (function prologue at file `0xe67a`, `LINK.W A5,#-0x34`):
>
> ```
> 0xe67e: move.w  $3174.l, -$c(a5)     ; classIndex = *$3174
> 0xe686: move.w  $3154.l, -$e(a5)     ; level = *$3154
> 0xe68e: cmpi.w  #$f, -$e(a5)         ; compare level to 15 (0x0F)
> 0xe694: ble.b   $e69c                ; branch if level <= 15
> 0xe696: move.w  #$f, -$e(a5)         ; else clamp level to 15 (max)
> 0xe69c: ...
> 0xe6ea: move.w  -$c(a5), d0          ; d0 = classIndex
> 0xe6ee: muls.w  #$f, d0              ; d0 = classIndex * 15
> 0xe6f2: add.w   -$e(a5), d0          ; d0 += level
> 0xe6f6: subq.w  #$1, d0              ; d0 -= 1  -> classIndex*15 + level-1
> 0xe6f8: lea.l   $abe.l, a0           ; a0 = Attack table base (hunk1+0xABE)
> 0xe6fe: move.b  (a0, d0.w), d1       ; d1 = table[index]  (byte read)
> ```
>
> repeated identically (different `-N(a5)` slots and table base) for all 8
> skills back to back through file `0xe890`. This resolves the question
> as originally posed:
>
> - **Not (a), no special runtime branch at level 15.** There is exactly
>   one branch touching the level value at all — the `CMPI.W #$F` / `BLE`
>   clamp — and it fires for level values *above* 15, not for level 15
>   itself. The per-skill lookup that follows is unconditional and
>   identical in shape for every one of the 8 tables.
> - **Not (c), not an indexing/misalignment artifact.** The formula
>   `class*15 + level - 1` is confirmed directly from real code (not
>   inferred from data shape), and for `level=15` it always lands on
>   exactly the last byte of each 15-byte class block — the byte this
>   project has been calling "level 15" *is* the byte the game's own code
>   reads for a level-15 character's skill value. There is no alternate
>   field boundary the code is actually using. The byte-sharing case above
>   is the only place where a documented "level 15" read turns out to
>   double as something else, and that is a binary-layout coincidence
>   between two adjacent tables, not a misindexed read.
> - **Level 15 is a real, legitimately-reached game state, not an
>   overflow/edge case.** The `CMPI.W #$F` / clamp-to-15 is the character
>   level cap for this lookup — i.e. the game's own code treats 15 as the
>   top of the valid level range and deliberately clamps anything higher
>   down to it, so every level-15+ character genuinely reads this exact
>   byte in normal play, not just as a hypothetical edge case.
> - **(b) is what remains, and is not resolvable by disassembly alone.**
>   The code applies the same unconditional formula regardless of the
>   byte's value, so it cannot distinguish "intentional level-15 design
>   value" from "typo in the original 1987 data entry" — both produce
>   identical, valid, in-range byte reads and identical execution. The
>   surviving anomalies (after retracting the Parry/Swim boundary case
>   above) skew heavily toward one class: **Ranger** shows a break at
>   level 15 in 6 of 8 skills (Attack `235→25`, Parry `85→60`, Listen
>   `44→144`, Spot trap `5→65`, Disarm `14→47`, Pick lock `6→13`), with
>   Wizard (Attack `100→125`) and Monk (Parry `110→40`) each showing one.
>   The direction is inconsistent even within Ranger's own row (combat
>   skills Attack/Parry *drop* at level 15, utility skills Listen/Spot
>   trap/Disarm/Pick lock *jump* sharply higher) — there is no single
>   consistent rule ("always caps lower", "always spikes at the cap")
>   that would support a deliberate, uniform "prestige tier" design
>   reading. This asymmetry, concentrated so heavily in one class, reads
>   more plausibly as a genuine data-entry inconsistency in SSI's
>   original 1987 table than as an intentional mechanic, but that
>   remains an inference, not a byte-level proof — no developer source or
>   errata exists to confirm intent either way.
>
> **Confidence: confirmed** for the read mechanism (direct static array
> read, `class*15 + level-1` indexing, level clamped to a max of 15, no
> special-case branch) and for the Parry/Swim boundary retraction.
> **Open, and left open** for whether the surviving Ranger/Wizard/Monk
> level-15 byte values themselves are an intentional design choice or a
> data-entry error — this is inherent ambiguity in static data with no
> further available oracle (no source, no errata, no third-party
> transcription to cross-check against), not a gap in the investigation.

### 5.3 The level-15 anomalies — closed as undecidable, with the error reading now positively evidenced

**Manual checked, and it cannot arbitrate.** The SSI 1987 rule book
contains exactly two per-class-per-level numeric charts — "Hit Points by
Class and Level for Adventurers with 10 Constitution" (page 11) and
"Maximum Magic Points at Different Levels by Class" (page 14). There is
**no skill-progression chart at any level**; the manual's only treatment
of skills is qualitative (page 7: *"Skills: … The nine skills include
Attack, Parry, Swim, Listen, Spot Trap, Disarm Trap, Find Item, Pick
Lock, and Fire Bow. The numbers list the percentage chance to perform a
task…"*), plus per-skill prose in the dungeon and combat sections. The
one place the manual does print per-class numbers, it uses a *different*
class order (FIGHTER, RANGER, PRIEST, MONK, THIEF, WIZARD) from the
binary's table order (Fighter, Thief, Priest, Ranger, Monk, Wizard), so
there is not even an indirect cross-check available.

**Two new pieces of positive evidence that this table contains genuine
data-entry errors** — found by dumping all 8 × 6 × 15 bytes and reading
the *interiors* of the rows, not only their last entries:

1. **`Pick lock` / Thief, level 3 = `35`.** The row reads
   `51, 53, 35, 56, 58, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76` — a
   strictly increasing +2/+1 ramp with one value that drops 18 and then
   jumps 21. `55` is the only value consistent with its neighbours.
   `55` → `35` is a single-keystroke slip, in the **middle** of a row, at
   no tier boundary, where no "level-15 prestige tier" design reading is
   even available.
2. **`Spot item` / Wizard, level 13 = `8`.** The row reads
   `0,0,0,0,0,4,4,4,8,8,12,12,8,20,24` — again a monotone ramp with one
   interior value that goes backwards where `16` belongs.

A third, structural, one was already on record and now reads differently:
the **`Parry` array is objectively 89 bytes, not 90** (§5.1's confirmed
bases give seven inter-table gaps of `0x5A` and exactly one of `0x59`).
A `[6][15]` table cannot be 89 bytes. The natural cause is an unsized
initializer (`char parry[] = { … }`) that was typed with one value
missing — i.e. a *proven* omission in this same hand-entered data block,
which is what makes the last byte double as `Swim`'s first.

**Verdict: resolved as far as the available sources allow — the specific
bytes remain formally undecidable, but "SSI data-entry error" is no
longer an inference from tidiness alone.** It is now supported by (a) a
proven missing initializer in the same block, (b) two interior typos that
cannot be design, and (c) the inconsistent direction of the level-15
anomalies themselves (within Ranger alone, Attack `235→25` and Parry
`85→60` fall while Listen `44→144`, Spot trap `5→65`, Disarm `14→47` and
Pick lock `6→13` jump). What cannot be established, and now cannot be
established from *any* available source, is whether each individual
level-15 byte is one of those errors or a deliberate cap value — the game
reads the byte unconditionally either way (§5.2), and no chart, source or
errata exists to arbitrate. Several of the values do have a suggestive
shape (`245 → 25` is a dropped digit; `44 → 144` is a stray leading `1`),
but a suggestive shape is not proof.

**Confidence: closed — undecidable from available sources**, not open.
Reopening would need a genuinely new oracle (an SSI design document, or
a byte-diff against the Apple II / C64 / ST builds' own copies of these
tables — the C64 `town.obj.prg` and Apple `TINFO.BIN` named in §5's
provenance comment are not present in this project's data).

## 6. Phantasie III (Amiga) — armoury stock table (`inititem.dat`)

File: `data/phantasieiii/amiga/inititem.dat`, 3,328 bytes.

> **Correction (2026-08-10, `game-re`) — the array orientation was
> transposed, and the file is not an "item table" at all.** §6.1-§6.3
> below (preserved verbatim) read this file as **181 records of 18 bytes**,
> one record per item, with the 18 columns as unknown per-item fields.
> The real layout, taken straight from the code that indexes it, is the
> transpose: **18 records of 181 bytes, one record per armoury (shop),
> each a flat `stock[itemId]` array over the 181-entry item name table.**
> The two readings share the same `181 × 18 = 3,258` byte total, which is
> why every byte-accounting check in §6.1-§6.3 passed while the semantics
> stayed opaque. See §6.4 for the confirmed decode.

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

**Confidence: record boundary now confirmed; field semantics still
hypothesis.** The 18-byte / 181-record reading was upgraded from
stride-analysis inference to code-level confirmation by a later pass: the
`PhantasieIII` save writer/loader transfer a `0xCBA` = **3,258 = 181 × 18**
byte block between the file and hunk 1 `+0x44BA` as a hardcoded length
(`scripting-engine.md` §7.5.1) — an independent, byte-exact corroboration
of exactly this stride and count, and also confirmation that the table is
a live, mutable game structure carried in saves (so a full catalogue, not
a static starting-loadout list). Record boundary (18-byte stride, 181
records, 0-3257 data region + 70-byte trailing pad to 3328) is
well-supported by the exact byte-accounting above. Individual field meanings within a
record are **not** determined — no field names, no confirmed types beyond
"looks like small integers with an occasional 16-bit value", and no
cross-reference to any name table was found to confirm this is even an
"item" table in the sense of `monsinfo.dat` being a "monster" table
(the filename `inititem.dat` — "init item" — is also consistent with a
narrower reading, e.g. per-character-class **starting equipment loadouts**
rather than a full item catalogue; 181 "items" would be unusually large
for a starting-kit table, which weakly favours "item catalogue" over
"starting loadout", but this was not resolved).

> **Correction (2026-08-09, `re-codebreaker`):** the "starting loadout"
> reading is now **refuted**. The same 3,258-byte block is read from and
> written back to `gamesave.dat` on every load/save (hunk 1 `+0x44BA`,
> `scripting-engine.md` §7.5.1) — a starting-equipment table would be
> static and would never be persisted per save. It is an item catalogue
> whose per-record state changes during play. This also fixes the record
> count and stride at exactly 181 × 18 rather than leaving them inferred.

> **Update (this pass):** the 181-entry item *name* table this file was
> missing was subsequently located — not in `inititem.dat` itself, but in
> the `PhantasieIII` executable at `0x466C` (see §3.1 above). The record
> count matches **exactly** (181 = 181), and record 0's all-zero content
> matches the name table's own index-0 empty-item placeholder
> (`"0"`) — a real structural coincidence in favour of `inititem.dat`
> being this same item catalogue's per-item stat records, in the same
> index order. However, spot-checking specific named indices
> (`2`/`"Wooden Shield"`, `65`/`"Small Axe"`, `72`/`"Sword"`,
> `103`/`"Healing Potion 3"`, `155`/`"a Burnt Gem"`, `180`/`"Wand of
> Nikademus"`) against their `inititem.dat` records found **all six
> entirely zero** except index `90`/`"Sword +4"` (one nonzero byte, value
> `0x0B` at record-relative offset 9) — including the unique endgame
> `"Wand of Nikademus"` artifact, which would be expected to carry
> distinctive non-zero stats if this file encoded meaningful per-item
> properties. This is too small and too skewed a sample (6 of 181, all
> but one zero) to either confirm or refute the row-correspondence
> hypothesis at the individual-field level — recorded as a **weak
> positive on record count/index-0 alignment, inconclusive on content**,
> not resolved this pass. A full 181-row correlation pass (checking
> whether *every* nonzero `inititem.dat` row lines up with a "special"
> item — rings, gems, unique artifacts — rather than a plain weapon/armor
> piece) would be the natural next step.

### 6.3 Full-corpus correlation pass (this pass) — still open, but the hypothesis space is narrower

The "natural next step" flagged above was run: every one of the 181 rows
was decoded against the now-fully-confirmed item name table (§3.1) and
inspected as a whole, not just the earlier 6-item spot sample.

**The earlier "16-bit `0x00C8` pair" reading is retracted as an artifact.**
Re-examining row 17 and row 27 byte-by-byte: `0x00C8` (200) appears as a
**plain single byte** (`0xC8`) at several distinct byte offsets in the
same row, not as a genuine 16-bit field — the earlier "pairs" were an
illusion created by the table's sparsity (most bytes are `0x00`, so a
`0xC8` byte's neighbour being `0x00` is the *expected* case, not a
correlated field). Column-by-column, **every one of the 18 byte offsets**
can independently hold the value `200` (only 3 of the 18 — offsets 4, 12,
16 — never exceed 15), which is inconsistent with "fixed-width 16-bit
field at fixed columns" and consistent with "18 independent one-byte
fields, one of which happens to often take the value 200."

**New finding: the nonzero value set is heavily discretized.** Across all
87 nonzero rows (159 nonzero byte reads total), the values `1` (61×), `5`
(39×), `200` (26×), and `99` (6×) alone account for 132 of 159 reads
(83%) — with only a scattering of other small values (`2`-`15`, `77`)
making up the rest. This is not the shape a continuous stat magnitude
(e.g. "AC bonus: 1-15") would produce; it looks like a small **enum/tier
code** (four dominant discrete values), not a smoothly-varying numeric
stat.

**New finding: nonzero rows cluster in the item table's middle range,
excluding both ends.** The first nonzero row is index 10 (`"Medium Shield
+2"`); the last is index 148 (`"a Statue"`). **Every item from index 149
to 180 is entirely zero** — including all of the late-game unique
treasures and the endgame artifact `"Wand of Nikademus"` (index 180,
already spot-checked as zero in the prior pass, now confirmed as part of
a uniform 32-row all-zero tail, not an isolated case). The cheapest
starter gear (indices 1-9: `Glove`, `Wooden Shield`, `Wooden Shield +1`,
`Small Shield` through `Small Shield +1`, `Medium Shield`, `Medium Shield
+1`) is **also** entirely zero. This rules against a simple
"value/rarity" reading (which would predict the rarest, most unique items
carry the *most* data, not none) — whatever distinguishes a nonzero row
from a zero row, it isn't simply "is this a real/valuable item."

**Race-count coincidence checked and not supported.** 18 columns
numerically matches the newly-confirmed P3 race count (§4.1) exactly,
raising the hypothesis "column = per-race restriction/bonus." Tested by
tabulating nonzero-count and `200`-count per column against the race
order (§4.1): counts range 4-13 nonzero entries per column with no
column standing out as systematically higher/lower in a way that tracks
race "power" (e.g. weak races `Halfling`/`Pixie`/`Sprite` don't show a
distinctly different pattern from strong races `Ogre`/`Minotaur`) — a
flat, unremarkable distribution across all 18 columns. This doesn't rule
the theory out (a restriction table wouldn't necessarily correlate with
race "power" in an obvious way), but it provides no positive support
either; recorded as checked-and-inconclusive, not as a finding.

**Confidence: record boundary/count still confirmed (§6.2); field
semantics still open.** This pass materially improves the structural
characterization (discretized-value-set finding, corrected the false
16-bit-pair reading, and the nonzero-range boundary finding) without
reaching a confident semantic label. Not escalated to `re-codebreaker`
this pass — the paths tried so far (stride/column statistics, value
histograms, race-count correlation) are variations on "structural
inference from the bytes alone," not a genuinely different method; the
next genuinely different approach would be tracing the `gamesave.dat`
load/save code around hunk 1 `+0x44BA` (`scripting-engine.md` §7.5.1) to
find what reads individual fields out of this block during actual
gameplay (e.g. a shop/vendor routine), which was not attempted this pass.
See `TODO.md`'s `data-p3-inititem-fields` row.

### 6.4 The confirmed decode — 18 armouries × 181 item-stock bytes

The "next genuinely different approach" flagged at the end of §6.3 was
taken: the routine that reads hunk 1 `+0x44BA` during gameplay was found
and disassembled. It is the **armoury-stock builder at file `0x8b5a`**,
reached from the "A) Armoury" town command, and its indexing settles the

> **Addendum (this pass) — the "A) Armoury" attribution above is now
> independently re-confirmed**, including the exact keystroke and the
> full in-town command dispatcher it goes through (single 53-entry
> jump-table command interpreter, one caller in the whole binary). Static
> disassembly alone initially left `A` vs. a sibling `O`("Load") slot
> ambiguous (both are reachable paths near this builder); a screenshot
> already in this repo (`data/default_88.png`, `"THIEF is in the
> armoury"`) settles it — its displayed item list matches armoury 1's
> stock row below item-for-item. Full write-up, the rest of the town
> command dispatcher, and the character-creation math traced in the same
> pass: `town-format.md`.
format outright:

```
0x8ba4:  for itemId = 1 .. 180:
0x8baa:    d0  = $2856 * 0xB5              ; currentArmouryIndex * 181
0x8bb2:    d0 += itemId
0x8bb6:    qty = *(byte *)($44BA + d0)      ; stock[armoury][itemId]
0x8bc6:    if qty <= 0: continue
0x8bda:      forSale[n]      = itemId                       ; $35F8[n]
0x8bfe:      price[n]        = itemPrice[itemId]
0x8c04:                        * armouryMarkup[$2856] / 100 ; $3762[n]
0x8c4e:      stockLeft[n]    = qty                          ; $38CC[n]
0x8ca2:      pointValue[n]   = itemPointValue[itemId]       ; $3A36[n]  (itemId <= 100)
0x8cc8:      attrRequired[n] = itemAttrRequired[itemId]     ; $3BA0[n]  (itemId <= 100)
0x8ce8:  $285C = *(byte *)($44BA + $2856 * 0xB5)            ; row byte 0 = item count
```

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `0x0000` | 181 | Armoury 0 stock row | byte 0 = number of distinct items stocked; bytes 1-180 = quantity of item id 1-180 |
| `0x00B5` | 181 | Armoury 1 stock row | " |
| … | | … | 18 rows total |
| `0x0CBA` | 70 | Padding | `0x3A` (`:`) to the 128-byte block boundary; `3328 = 128 × 26` |

**Verification: the row header is a self-check, and it holds 18/18.**
Byte 0 of each row states how many distinct item ids that row stocks.
Counting the nonzero bytes in each row independently reproduces it for
every one of the 18 rows with **zero deviations** (armoury 1 declares 10
and stocks 10; 2 → 13/13; 3 → 14/14; 4 → 15/15; 5 → 15/15; 6 → 8/8;
7 → 9/9; 8 → 8/8; 9 → 11/11; 10 → 11/11; 11 → 4/4; 12 → 9/9; 13 → 10/10;
14 → 7/7; and rows 0, 15, 16, 17 declare 0 and are entirely empty). The
transposed reading has no equivalent invariant.

Resolved against the confirmed 181-entry item name table (§3.1) the
content is immediately legible and thematically coherent, e.g.

```
armoury  1 (10): Clothing x5, Robes x5, Leather x1, Knife x1, Club x1, Mace x1,
                 Healing Potion 5 x5, Magic Potion 5 x5, Scroll IV x200, Scroll VIII x200
armoury  5 (15): Clothing x5, Robes x5, Hard Leather x1, Self Bow x1, Club x5, Mace x1,
                 Staff x1, Short Sword x1, Healing Potion 3 x200, Healing Potion 5 x5,
                 Magic Potion 3 x200, Magic Potion 5 x5, Scroll XI x200, Scroll XII x200,
                 Scroll XIV x1
armoury 14  (7): Large Shield +3 x1, Leather x1, Leather +1 x1, Staff x1, Club +2 x1,
                 Scroll XIV x200, Scroll XV x200
```

This retro-explains every unexplained observation in §6.3:

- **The discretized value set `{1, 5, 200, 99, 77}`** is a set of *stock
  quantities*, not an enum: `1` = a single unique piece, `5` = five in
  stock, `200`/`99`/`77` = effectively unlimited consumables (scrolls and
  potions). Under the transposed reading these looked like tier codes.
- **The all-zero tail at "rows" 149-180** is the *item-id* range no
  armoury stocks — gems, artefacts, quest items, `Wand of Nikademus`.
  Correct: those are treasure, not merchandise. Likewise "rows" 1-9 (the
  cheapest shields) are simply not stocked anywhere.
- **The "18 columns = 18 races" coincidence** was never a coincidence in
  the right direction: 18 is the **armoury count**, matching the 18-entry
  markup table at hunk 1 `+0x1144` (§7) exactly.
- **The all-zero "record 0"** is armoury row 0 (an unused/reserved
  armoury index — the code sets `$2856 = 1` at startup, file `0x760e`),
  not an empty-item sentinel.

**Confidence: confirmed** — code-traced indexing, an 18/18 internal
row-header invariant, and a coherent resolve against an independently
confirmed name table. §6.1-§6.3's byte accounting (3,258 data + 70 pad)
remains correct and unchanged; only the array orientation and the
semantic label change.

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

## 7. Phantasie III (Amiga) — combat-equipment stats, prices, armoury markups

Four stored tables in `PhantasieIII`'s DATA hunk, all found from the
armoury-stock builder at file `0x8b5a` (§6.4) and the armoury row printer
at file `0x11714`.

| File offset | Hunk 1 | Size | Table | Index |
|---|---|---|---|---|
| `0x287d8` | `+0x0F10` | 101 B | **Point value** | item id `0`-`100` |
| `0x2883d` | `+0x0F75` | 101 B | **Attributes required** | item id `0`-`100` |
| `0x288a2` | `+0x0FDA` | 362 B (181 × `u16`) | **Base price, gold** | item id `0`-`180` |
| `0x28a0c` | `+0x1144` | 36 B (18 × `u16`) | **Armoury price markup, %** | armoury `0`-`17` |

> **Correction (2026-08-10, `game-re`) — supersedes `scripting-engine.md`
> §7.5.1/§7.5.2's "202-byte lookup table of concatenated arithmetic
> ramps" and its "experience-per-level curve" neighbour.** The 202 bytes
> at `+0x0F10` are **not one table**: they are the two 101-byte per-item
> tables above, laid end to end (`101 + 101 = 202`, exact). The apparent
> "concatenated arithmetic ramps of varying slope" are just SSI's item
> catalogue being grouped into ascending-quality runs (20 shields, 10+10
> armours, 20 bows, 20+20 weapons) — each run's stats rise linearly, so
> each run reads as a ramp. Both tables are indexed by **item id**, never
> by class or level, which is why the HP/MP-chart hypothesis could never
> have matched. The word table immediately after them at `+0x0FDA` is
> likewise **not** an experience curve: it is the 181-entry item price
> table, and its extent is byte-exact — `0x0FDA + 181 × 2 = 0x1144`,
> precisely the start of the 18-entry armoury markup table.

**Verification: byte-exact against the SSI 1987 rule book, 200/200
values, 0 mismatches.** The manual's own "COMBAT EQUIPMENT" tables (rule
book pages 17-18: *Shields*, *Armor*, *Bows*, *Melee Weapons*) print
exactly these two columns per item — `POINT VALUE` and `STRENGTH
REQUIRED` / `ATTRIBUTES REQUIRED` — for item numbers 1-100 in the same
order as the game's own name table. Transcribing all 100 rows from the
page images and diffing programmatically against the two byte tables
gives **zero mismatches across all 200 values**.

The manual's footnotes also state the requirement formula, and it matches
the helper at file `0xce44` instruction for instruction:

| Item id | Manual footnote | Code at `0xce44` |
|---|---|---|
| 1-40 (shields, armour) | "Strength required" | `capability = Strength` |
| 41-60 (bows) | "based on Strength + Dexterity" | `capability = Str + Dex` |
| 61-100 (melee) | "based on 2 x Strength + Dexterity" | `capability = 2·Str + Dex` |
| 101+ (potions, scrolls) | not combat equipment | `capability = 0` |

The armoury row printer (`0x11714`) prints `N/A` in place of the point
value whenever `attributesRequired[item] == 0` or
`capability < attributesRequired[item]` — the on-screen rendering of that
rule. Its column header string is at file `0x11476`:
`"Item:       Pt Val: Cost:"` — i.e. **"Pt Val"** is one column ("point
value"), not two, which is what pins table `+0x0F10` to the manual's
`POINT VALUE` column rather than table `+0x0F75`.

**How the tables are used elsewhere:**

- **Combat.** `scripting-engine.md` §7.5.1's per-party-member arrays index
  the **point value** table with the character record's three equipment
  slots: `$2A34[i] = pointValue[charRec.+0x6A]` (armour),
  `$2A50[i] = pointValue[charRec.+0x6C]` (melee weapon, the damage die),
  `$2A7A[i] = pointValue[charRec.+0x86] × 2 + 4` (bow). In the shipped
  `gamesave.dat` those three fields read `22`/`64`/`41`-`44`, which resolve
  to **Robes**, **Mace** and **Self Bow**/**Short Bow** — a coherent
  starting loadout, confirming the slots.
- **Pricing.** `chargedPrice = basePrice[item] × markup[armoury] / 100`.
  The markups are `[100, 150, 145, 140, 130, 125, 200, 115, 200, 105,
  100, 88, 95, 90, 123, 100, 100, 100]` — armoury 11 undercuts at 88%,
  armouries 6 and 8 charge double.

**Confidence: confirmed, byte-exact** (code-traced indexing + a 200/200
first-party manual diff). Implemented as `readP3ItemStats()`,
`readP3ItemPrices()` and `readP3ShopMarkups()` in
`src/assets/formats/exe-data.ts`, tested in
`src/assets/formats/__tests__/exe-data.test.ts`.

## 8. Open questions

- ~~**P3 race table offsets for the Amiga `PhantasieIII` executable**~~ —
  **race name table resolved this pass** (§4.1): 18 names found via
  mixed-case string grep + a `HUNK_RELOC32` cross-reference to locate the
  pointer table addressing them (`0x28e84`), confirmed byte-exact and
  implemented as `readP3RaceNames()`. **The bank-sprite-index table is now
  resolved too** (§4.2, 2026-08-10): 19 bytes at file `0x299d8`
  (hunk 1 `+0x2110`), found by disassembling the party-sprite cell
  extractor at `0x1b2da` rather than by searching for the table's own
  shape, and confirmed against rendered `heros.cmp` cells 13/13. The
  previous "sprite index = race index" identity assumption is **refuted**
  — 6 of 18 races share a cell with another race. Closed.
- ~~**P3 `inititem.dat` field semantics**~~ — **resolved (§6.4,
  2026-08-10): the array orientation was transposed.** The file is
  `stock[18 armouries][181 item ids]`, not 181 records of 18 fields;
  byte 0 of each 181-byte row is that armoury's distinct-item count, which
  reproduces the counted nonzero bytes 18/18 with zero deviations. The
  §6.3 findings all retro-explain (the `{1,5,77,99,200}` value set is
  stock quantities; the zero tail is the item-id range no shop stocks;
  "18 columns" is the armoury count, matching the 18-entry markup table
  in §7). Original wording preserved below.
- *(superseded)* **P3 `inititem.dat` field semantics** — record stride/count remains
  confirmed (§6.2: exact `181×18=3,258`-byte match with the
  `gamesave.dat` load/save transfer length). This pass ran the full
  181-row correlation against the item name table (§6.3): retracted an
  earlier false "16-bit value pair" reading, found the nonzero value set
  is heavily discretized (`{1,5,99,200}` = 83% of all nonzero reads), and
  found nonzero rows cluster in the item table's middle range (indices
  10-148) while both the cheapest starter gear (1-9) and every unique/
  late-game item (149-180, including `Wand of Nikademus`) are entirely
  zero. Individual field/column semantics remain **open** — no confident
  label reached; a race-count-coincidence hypothesis (18 columns = 18
  races) was tested and found unsupported (flat, unremarkable per-column
  distribution).
- ~~**P3 monster table's weapon/armor/spell/item index meanings**~~ —
  **resolved this pass.** `Item 1`/`Item 2` (`0x1F`/`0x20`) resolve
  cleanly against the confirmed 181-entry item table (0 out-of-range
  across all 80 monsters). `Weapon`/`Armor` (`0x10`/`0x11`) are **not**
  item indices — renamed to `weaponRating`/`armorRating`; strong
  correlation with `attackRaw`/`hp` (r=0.77-0.96 across all four
  cross-stat pairs) and near-zero correlation with `defense` (r=-0.05)
  shows these are raw combat-power stats, not catalogue lookups (§3.1).
  Spell fields (`0x15`-`0x17`) **confirmed** against the newly-decoded
  58-entry P3 spell name table (`0x4E74`-`0x513E`): 0 out-of-range across
  all 240 field reads, every spellcasting monster resolving to a
  thematically-plausible, tier-appropriate spell kit (§3.1).
- ~~**P3 skills table's anomalous 15th-level values**~~ — **mechanism
  resolved this pass** (§5.2 follow-up): disassembly-confirmed the read is
  a plain static array lookup (`class*15 + level - 1`, level clamped to a
  max of 15 with no special branch at 15 itself), so level 15 is a real,
  legitimately-reached game state, not a decode/indexing bug. One
  specific case (Parry/Wizard `→42`) was retracted — it's a table-boundary
  byte shared with the Swim table, not independent Parry data. **Now
  closed as undecidable (§5.3, 2026-08-10)**: the SSI rule book has no
  per-class skill chart at any level (only HP p.11 and MP p.14), so no
  external oracle exists; and two *interior* (non-level-15) typos plus the
  provably 89-byte `Parry` array establish that this data block genuinely
  does contain data-entry errors — but not which of the level-15 bytes
  are among them. Not reopenable without a new source (SSI design notes,
  or the C64/Apple/ST builds' own copies of these tables).
- ~~**Phantasie II (Atari ST) monster/race tables**~~ — **resolved.** All
  five §2 offsets confirmed byte-exact against the real `PHANT.PRG`
  (`data/phantasieii/atarist/extracted/disk1/PHANT.PRG`), and the sprite
  bitplane layout confirmed via pixel-level render (`graphics-formats.md`
  §9). See §2.1-§2.5 above.
- ~~**P1 `game`/`run` HUNK structure vs. the offsets used**~~ —
  **resolved (2026-08-09, re-codebreaker).** There is no coincidence to
  explain: the §1 offsets were never hunk-0-relative, and nothing in the
  pipeline ever needed them to be. They are plain **file** offsets that
  each land inside whichever hunk really holds that data, and the
  pipeline reads the file on disk (never a relocated load image), so
  reading at a file offset is simply correct. A full hunk walk resolves
  every documented P1 offset cleanly, several of them landing exactly on
  a hunk boundary — a strong sign the mapping is real structure rather
  than numeric luck:

  | §1 table | File offset | Resolves to |
  |---|---|---|
  | Monster/item name strings | `0x5EFC` | DATA hunk 12 `+0x0` (hunk start) |
  | Race name strings | `0x69BE` | DATA hunk 12 `+0xAC2` |
  | Palette array | `0x194BC` | DATA hunk 69 `+0x94` |
  | `GetStat` | `0x116EA` | CODE hunk 41 `+0x1E62` |
  | LCG PRNG | `0x2C874` | CODE hunk 182 `+0x0` (hunk start) |

  The one caveat worth keeping: a file offset is only meaningful for
  reading **stored** bytes. Any question about *addresses* — call
  targets, pointer values, `pea`/`jsr` operands — must go through the
  hunk's own `HUNK_RELOC32` table, because those operands hold
  pre-relocation hunk-relative values, not file offsets (see §1.3a and
  `game-re-tooling/amiga.md`).

  The original wording of this item, preserved for the record: every P1
  offset in §1 works as a **raw, unadjusted file offset**, which seemed
  genuinely puzzling because `game`'s `HUNK_HEADER` parses cleanly as a real
  240-hunk table (`table_size=240`, `first_hunk=0`, `last_hunk=239`, hunk
  size table sums to 167,788 bytes against a 193,804-byte file — the
  remainder being per-hunk tag/size/reloc/end overhead), the hunk-size
  table itself ends at file offset `980`, and hunk 0's own `HUNK_CODE` data
  block is only 460 bytes (file offset `988`-`1448`) — far too small to
  contain any of the tables in §1 (the smallest offset used, `0x0C88` =
  3,208, is already past hunk 0 entirely, let alone the largest,
  `0x194BC` = 103,612). The hunk walk above is what that item was asking
  for, and it shows the reads land in whichever of the 240 hunks actually
  contains the data — as they must, since they are file offsets into the
  file. Closed.
