---
title: Data Tables
description: monsinfo.dat's 80 monster records, the 8-skill class/level progression table, the 18-race table, and the item/spell tables cross-checked against SSI's own 1987 manual.
---

Four executable-embedded or standalone tables drive Phantasie III's
monsters, character advancement, and item/spell catalogues. All of them are
this session's own independent extraction and analysis — cross-checked,
where a first-party source exists, against the actual SSI-published 1987
*Phantasie III* manual (`data/phantasieiii/Phantasie III - The Wrath of
Nikademus v1.0 (1987)(SSI)[compilation Bonus Ed.][1186].pdf`).

Looking for P3's own dungeon-scripting opcode numbering past `0x13`
(referenced from [Shared Formats](../../formats/dungeon-and-scripting-engine/))?
That's scripting-engine territory, not a data table — it's documented on
[Combat & Character Record](../../phantasieiii/combat-and-character-record/)
alongside the rest of this game's own engine variant.

## `monsinfo.dat` — the monster table

`data/phantasieiii/amiga/monsinfo.dat`, 3,072 bytes: 80 fixed 38-byte
records starting at offset 0, no header. `80 × 38 = 3,040`; the remaining
32 bytes are trailing padding (a repeated `0x60` filler byte, matching the
same 128-byte disk-padding convention used throughout this data set —
`3,072 = 128 × 24` exactly).

```
+0x00  up to 14  Name — space-padded ASCII, single trailing NUL
+0x0E   1 byte   Encounter group size
+0x0F   1 byte   Attack (raw byte; display value = byte × 10)
+0x10   1 byte   Weapon rating — NOT an item-table index, see below
+0x11   1 byte   Armor rating — same reframing as Weapon rating
+0x12   1 byte   Defense
+0x13   1 byte   Threat/morale
+0x14   1 byte   Spell probability
+0x15   1 byte   Spell 1 (index into the 58-entry spell table)
+0x16   1 byte   Spell 2
+0x17   1 byte   Spell 3
+0x18   1 byte   MP
+0x19   1 byte   HP
+0x1A   1 byte   Alignment
+0x1B   1 byte   Sprite index (see Graphics Formats for the bank/cell mapping)
+0x1C   1 byte   Companions probability
+0x1D   1 byte   Companion 1 (monster index)
+0x1E   1 byte   Companion 2 (monster index)
+0x1F   1 byte   Item 1 (item-table index, droppable)
+0x20   1 byte   Item 2 (item-table index, droppable)
+0x21   1 byte   Is undead (boolean)
+0x22   2 bytes  Gold, big-endian u16
+0x24   1 byte   Experience (single byte — max 255)
+0x25   1 byte   (unused pad byte)
```

**Confidence: confirmed** — record boundaries, stride, and offsets read
from source and independently structurally validated. Decoding names at
`i*38` for `i = 0..5` and `i = 79` yields `Skeleton`, `Sniverling`, `Drip
Slime`, `Undead Gnome`, `Wild Cat`, `Giant Bee`, ..., `Lord Wood` — all
legible, distinct, in-genre names.

**Cross-checked against real dungeon scripts**: scanning every real
opcode-`0x05`/`0x11` (encounter) action record across all 11 real
`dnga.dat`-`dngk.dat` files finds 8 distinct monster indices referenced,
**0 out of the 0-79 range**.

### The Weapon/Armor field correction

The previous reading treated the `Weapon`/`Armor` fields (`+0x10`/`+0x11`)
as item-table indices, following the reference source's field names. A
full 80-monster Pearson-correlation pass against the already-confirmed
combat stats refutes that:

| Pair | r |
|---|---|
| `attackRaw` vs. field `+0x10` | 0.82 |
| `attackRaw` vs. field `+0x11` | 0.96 |
| `hp` vs. field `+0x10` | 0.81 |
| `hp` vs. field `+0x11` | 0.77 |
| field `+0x10` vs. field `+0x11` | 0.80 |
| `defense` (`+0x12`) vs. field `+0x11` | -0.05 |

All four cross-stat correlations are strongly positive (0.77-0.96) — the
opposite of what an item-catalogue index would show (item-table position
has no reason to track monster power). Field `+0x10`'s raw values also grow
essentially monotonically with monster tier (`2` at index 31 `Wolf` up to
`90` at index 77 `Nikademus`, the final boss) — the same shape as the
already-confirmed `attackRaw`/`hp` fields, not the shape of an arbitrary
catalogue lookup. The near-zero correlation against `defense` shows this
isn't just "everything correlates with everything" — it's specifically the
stat-like fields tracking each other. **Renamed `weaponRating`/
`armorRating`** in `src/assets/formats/monster-data.ts`; exact display
scaling not determined.

### Monster → sprite-bank correlation (a real asset-reuse finding)

Decoding all 80 monsters' `sprite.bankFile`/`sprite.cellIndex` pairs (fed
by the `spriteIndex` field through [the bank/cell
formula](../../phantasieiii/graphics/)) shows the 7 sprite banks hold only **48
distinct (bank, cell) pairs for 80 monsters** — 23 monsters get a cell to
themselves, but **25 cells are shared by 2 or more monsters, covering 57 of
the 80 records**. This is real art reuse, not a decoding bug: e.g.
`purple1.cmp` cell 0 renders both `Skeleton` and `Illusion`;
`yellow1.cmp` cell 3 renders `Giant Bee`, `Death Fly`, `Giant Wasp`, and
`Killer Bee` — four differently-named monsters sharing one sprite. Worked
example: `Skeleton` (index 0) resolves to `purple1.cmp`, cell 0 (`normalRect`
0,0, `attackingRect` 32,0); `Beeping Blob` (index 27) resolves to
`yellow1.cmp`, cell 11 (`normalRect` 64,96, `attackingRect` 96,96) — both
computed directly from the confirmed `index2 = cellIndex*2 (+1)` formula.

## The skills table

Eight skills, each a `[6 classes][15 levels]` = 90-byte flat table
(class-major), confirmed directly against `PhantasieIII`:

| Offset | Skill |
|---|---|
| `0x28386` | Attack |
| `0x283E0` | Parry |
| `0x28439` | Swim |
| `0x28493` | Listen |
| `0x284ED` | Spot trap |
| `0x28547` | Disarm |
| `0x285A1` | Spot item |
| `0x285FB` | Pick lock |

Class order within each table: **Fighter, Thief, Priest, Ranger, Monk,
Wizard**. Skill order and names match the SSI 1987 manual exactly
(`Attack, Parry, Swim, Listen, Spot Trap, Disarm Trap, Find Item, Pick
Lock, Fire Bow` — this 8-table set covers the first 8 verbatim; the 9th,
Fire Bow, is absent from this progression table but present on the
character sheet, see [Combat & Character
Record](../../phantasieiii/combat-and-character-record/)). **Confidence:
confirmed, byte-exact.**

Fighter's Attack progression (`0x28386`) reads a textbook level-1-to-15
curve: `100, 110, 120, 135, 145, 155, 165, 180, 190, 200, 210, 220, 235,
245, 255`, ending exactly at the byte max.

### The level-15 anomaly

A small number of classes' **15th** (last) level value breaks an otherwise
clean monotonic trend — e.g. Ranger's Attack level 15 reads `25`, a drop
from level 14's `235`.

> **One case retracted.** The originally-reported "Wizard's Parry level 15
> also drops" is a false positive: `0x28439` is not Parry data at all — it
> is byte-identical to, and in fact *is*, the first byte of the **Swim**
> table (the Parry→Swim gap is only `0x59`/89 bytes, one byte short of the
> `0x5A`/90-byte gap every other adjacent skill-table pair has — the two
> tables physically share one byte). The game's own indexing code does
> still read this shared byte as "Wizard, Parry, level 15" (it has no way
> to know the byte does double duty), so a level-15 Wizard genuinely is
> shown Parry `42` in-game — but it isn't an independent anomalous data
> point, just a table-boundary coincidence.
>
> **Indexing mechanism confirmed correct by disassembly** — a plain
> static-table read, not a runtime formula with a level-15 special case.
> Tracing the routine at file offset `0xe67a` (both call sites, `0xe6fa`-
> `0xe890` and `0x135ce` onward):
>
> ```
> cmpi.w  #$f, -$e(a5)      ; compare level to 15
> ble.b   $e69c              ; branch if level <= 15
> move.w  #$f, -$e(a5)       ; else clamp level to 15 (max)
> ...
> muls.w  #$f, d0            ; classIndex * 15
> add.w   -$e(a5), d0        ; += level
> subq.w  #$1, d0            ; -1  ->  classIndex*15 + level-1
> move.b  (a0, d0.w), d1     ; table[index]
> ```
>
> The only branch touching level at all is the clamp-to-15 for level values
> *above* 15 — the per-skill lookup itself is unconditional and identical
> in shape for all 8 tables, and level 15 is a legitimately-reached game
> state (the character-level cap), not an edge case.
>
> **What remains open** is not resolvable from code alone: the surviving
> anomalies skew heavily toward one class — **Ranger** breaks at level 15
> in 6 of 8 skills (Attack `235→25`, Parry `85→60`, Listen `44→144`, Spot
> trap `5→65`, Disarm `14→47`, Pick lock `6→13`), with Wizard (Attack
> `100→125`) and Monk (Parry `110→40`) each showing one. The direction is
> inconsistent even within Ranger's own row — combat skills *drop* at level
> 15, utility skills *jump* sharply higher — so there's no single
> consistent rule that would support a deliberate "prestige tier" reading.
> This looks more like a genuine 1987 data-entry inconsistency than an
> intentional mechanic, but that remains an inference: no developer source
> or errata exists to confirm intent either way. See [Status & Open
> Work](../../phantasieiii/status/).

## The race table

18 sequential NUL-terminated strings at file offset `0x5172`-`0x51EA`,
located by grepping `PhantasieIII` directly for mixed-case race-name
substrings:

```
Human, Dwarven, Elven, Gnome, Halfling, Random, Gnoll, Goblin, Kobold,
Lizard Man, Minotaur, Ogre, Orc, Pixie, Sprite, Troll, Elemental, Undead
```

This resolves an apparent count mismatch against the reference source
(which lists 18 but names only 17 lore races): the 18th name, **`Random`**,
is a "generate me a random race" character-creation menu option, not a
playable race with its own sprite — `16` (shared with P1/P2) `+ Elemental +
Random = 18`.

Located via the same string-pointer-table technique used for the skill
labels ([Combat & Character
Record](../../phantasieiii/combat-and-character-record/)): one `HUNK_RELOC32`
entry storing the hunk-relative string-block offset `0x514A`, found by
scanning every relocation entry for that exact stored value. Reading 30
consecutive pointers around it shows one long shared "string by ID" table
serving spells, continent names, alignment, the 18 races, and the 6 class
names, back to back — a generic UI-text lookup, not a race-specific
structure. **Confidence: confirmed, byte-exact**, implemented as
`readP3RaceNames()`.

**Open**: the parallel race → sprite-bank-cell table is not located — see
[Status & Open Work](../../phantasieiii/status/) for the three search approaches
tried and why each came back empty.

## The item table (executable-embedded, 181 entries)

Located inside `PhantasieIII` itself at file offset `0x466C` (ends
`0x4E74`): entry 0 is the single character `"0"` (P3's "empty item"
sentinel — P1/P2 instead use the string `"NOTHING"`), entries 1-180 are
real items (`"Wooden Shield"`, `"Small Axe"`, `"Wand of Nikademus"` at the
final index 180). **Cross-checked against real dungeon scripts**: all real
opcode-`0x06` records across the 11 dungeon files resolve to 71 distinct
in-range item indices, 0 out of range.

### Cross-checked against SSI's 1987 manual

The manual catalogues items 1-120 by number, across four categories
(Shields 1-20, Armor 21-40, Bows 41-60, Melee Weapons 61-100, Healing
Potions 101-110, Magic Potions 111-120). Decoding the game's own table
against the manual's printed pages: **117/120 exact matches, 3
deviations**:

- Index `40`: `"God Armour"` (game) vs. `"God Armor"` (manual) — a
  British/American spelling choice, same item, cosmetic only.
- Indices `81`/`82`: **the game's own table reads `"Dagger +1"`/`"Dagger
  +2"`, but the manual's printed catalogue lists these exact item numbers
  as `"Knife +1"`/`"Knife +2"`** — a real, non-cosmetic discrepancy between
  the published manual and the shipped binary's actual data. The base items
  at `61` (`Knife`) and `62` (`Dagger`) are unaffected and match both
  sources exactly, and every other `+1`/`+2` pair in the 81-100 range
  matches the manual exactly, so this is an isolated two-entry divergence,
  not a systematic offset error. **The game's own in-binary name is
  treated as authoritative** for this project's extractors and assets — the
  manual is a cross-check oracle here, not a data source that overrides
  real bytes.

Indices 121-180 (scrolls, gems, valuables) aren't individually catalogued
in the manual, so no cross-check was possible for that range.

This table also **partially resolves** `monsinfo.dat`'s `Item 1`/`Item 2`
fields: decoding all 80 monsters' item-drop bytes against it gives 0
out-of-range values (39/36 distinct values respectively) — e.g. Skeleton's
`Item 1`/`Item 2` resolve to `"Staff"`/`"Short Sword"`, plausible monster
drops.

## The spell table (58 entries)

Immediately after the item table, at file offset `0x4E74` (ends
`0x513E`): 58 sequential NUL-terminated strings, index 0 the same `"0"`
placeholder convention, indices 1-57 real spells. **Confirmed against
`monsinfo.dat`**: 0 out-of-range across all 240 monster spell-field reads,
and thematically airtight — every monster with `spellProbability == 0` has
all three spell fields `== 0`, while spellcasters resolve to real,
appropriately-scaled spells (`Ranger` → `Healing I, Flame Arrow I,
Confusion I`; `Wizard` → `Fireflash III, Weakness IV, Healing IV`).

**Confirmed byte-exact against the manual's own "Spell Table"** (indices
1-56, matching indices `1`-`52` then `54`-`56` — 55 explicit entries, `53`
conspicuously absent from the printed table): **55/55 exact name matches**,
zero mismatches. This resolves a numbering ambiguity with two independent
confirmations:

- Spell **53** — no printed entry, but the manual's own "Mapping" section
  (body text, not the table) reads *"Already mapped so spell 53 (Vision)
  is unnecessary"*, matching the game's own internal name for that slot,
  `"UNUSED SPELL (vision)"`, almost verbatim.
- Spell **57** = `"Divine Aid"` — the manual's spell-description pages
  establish *"Divine Spells (#57+): these spells may only be acquired
  during the course of the game for special purposes"*, matching the
  table's own index-57 entry exactly. The scripting engine's own opcode
  `0x19` special case (`statIndex 0x75` = 117 → "does any party member
  know the spell Divine Aid") independently corroborates this same entry.

**Confidence: confirmed** — the manual's numbered table, two separate body
text passages, and the independent opcode cross-reference all agree.

## `inititem.dat` — still open

`data/phantasieiii/amiga/inititem.dat`, 3,328 bytes. **No reference source
exists for this file** — confirmed by exhaustive grep across the reference
tool's entire source tree. Everything here is this project's own structural
analysis.

Record boundary is confirmed two ways: a stride/column-cardinality scan
strongly favours an 18-byte stride (181 records, `181 × 18 = 3,258`,
landing exactly at the file's padding boundary), and — independently — the
`PhantasieIII` save writer/loader transfers a hardcoded `0xCBA` = `3,258`
byte block between the file and a runtime buffer at hunk 1 `+0x44BA`
([Combat & Character Record](../../phantasieiii/combat-and-character-record/)),
confirming exactly this stride and count from the code side.

**Field semantics remain unresolved.** This session's full 181-row
correlation pass found:

- The nonzero value set is heavily **discretized**: across 87 nonzero rows
  (159 nonzero byte reads), the values `1` (61×), `5` (39×), `200` (26×),
  and `99` (6×) alone account for 132 of 159 reads (83%) — the shape of a
  small enum/tier code, not a continuous stat magnitude.
- Nonzero rows **cluster in the middle of the item range**: the first is
  index 10, the last index 148 — every item from 149 to 180 (including the
  endgame `Wand of Nikademus`) is entirely zero, and so is the cheapest
  starter gear (indices 1-9). This rules against a simple "value/rarity"
  reading.
- A race-count coincidence (18 byte-columns = 18 confirmed races) was
  tested by tabulating nonzero-count and `200`-count per column against
  race order — no column stands out in a way that tracks race "power".
  Checked and inconclusive, not a finding.

See [Status & Open Work](../../phantasieiii/status/) for the next genuinely
different approach (tracing the `gamesave.dat` load/save code around hunk 1
`+0x44BA` for an actual field consumer).

## The open bits

- `inititem.dat`'s 18 field meanings — record shape confirmed, semantics
  open.
- The race → sprite-bank-cell table — not located.
- The level-15 skills anomaly's specific values — mechanism confirmed,
  intent unresolvable from code alone.

Full detail: [Status & Open Work](../../phantasieiii/status/).
