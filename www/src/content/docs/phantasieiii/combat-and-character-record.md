---
title: Combat & Character Record
description: P3's own LCG, its two to-hit formula branches, the SAS/C merged-BSS discovery, and the 9 on-screen skill names bound to the 262-byte character record.
---

Phantasie III's combat and character-record code is traced independently
from Phantasie I/II's — see [the shared dungeon/scripting engine
page](../../formats/dungeon-and-scripting-engine/) for what the trilogy shares,
and P3's own action opcode set just below for where this game's engine
diverges even at the scripting layer. `PhantasieIII` is
a 3-hunk AmigaOS `HUNK` executable whose code references nearby data via
`PEA`/`LEA` PC-relative addressing rather than P1/P2's `HUNK_RELOC32`-
patched absolute longs — a different addressing convention that shaped how
this trace had to be done.

> **Read the merged-BSS section before trusting any "lookup table" address
> cited elsewhere for P3.** Several addresses that looked like class-indexed
> lookup tables (`$2A18`-`$2A88`, `$3D0A`-`$3D36`) are not tables at all —
> they're runtime variables in a hunk whose declared allocation size (27,404
> bytes) is nearly triple what's actually stored in the file (10,108
> bytes). Resolving them as file offsets produces garbage; see "The
> merged-BSS discovery" below for why, and for the four-way confirmation
> that the boundary really is `0x277C`.

## P3's own action opcode set

Opcodes `0x00`-`0x13` mean the same thing as Phantasie I/II's shared engine.
Phantasie III then defines its **own** `0x14`-`0x1B` — a disjoint set from
Phantasie II's own `0x14`-`0x17`, despite reusing some of the same numeric
values for different effects:

| Opcode | Size | Effect |
|---|---|---|
| `0x14` | 1 | Unconditional "goto Action `Param1`" |
| `0x15` | 1 | `Param1` = percent chance to **not** jump; on success, "goto Action `Param2`" |
| `0x16` | 1 | "goto Star `Param1 - 1`" |
| `0x17` | 2 | Conditional: if the party owns item `Param1`, "goto Action `Param2`" |
| `0x18` | 2 | Set/clear a stat bitmask: `value = 1 << (Param1-1)`; OR into stat `Param2` if `Param3 != 0`, else AND it out |
| `0x19` | 2 | Conditional bitmask test on stat `Param2`; special case: raw stat-index `0x75` means "does any party member know Divine Aid", jumping unconditionally on a match |
| `0x1A` | 1 | Conditional: if the party contains a Dwarf or Gnome, "goto Action `Param1`" |
| `0x1B` | 1 | Increment a stat for every living party member, capped at 30 |

For opcodes `0x12`, `0x13`, `0x18`, `0x19`, a raw stat-index `Param` value
`>= 0x3D` is remapped by subtracting `0x3D` before use as a stat-table index
— a rebasing convention specific to Phantasie III with no P1/P2 equivalent.

## The RNG — a different LCG from Phantasie I's

`Random(range)`, file offset `0xAAA6`: clamps `range >= 1`, fetches a raw
seed from the seed-update routine, then computes `1 + (rawSeed % range)`
via the 68000's native `DIVS.W` remainder. Returns `1..range` inclusive.

**Seed-update routine, file offset `0x1C00`**: `seed = (seed * 25173 +
13849) mod 65536` — **the textbook "quick and dirty" LCG triple**, the same
constants popularized as an example generator in *Numerical Recipes*. A
genuinely different concrete LCG from Phantasie I's `seed = (seed*3677+3)
mod 32768`, as expected for an independently-built engine variant, but the
same algorithm family (multiply-add-mod, modulus a power of two).

**Confidence: confirmed**, disassembly-verified end to end, including the
`+0x28` CODE-hunk reloc-resolution technique this trace needed (P3's
intra-hunk `JSR`/`LEA` absolute-long call targets *are* resolvable via
`HUNK_RELOC32` — the opposite of an earlier pass's blanket claim — cross-
validated against two already-known targets, `Random()` itself and the
seed-update call).

## To-hit — both formula branches, byte-verified

An earlier pass mistakenly labelled the block below's index as a
**class**-index and its referenced addresses as static lookup **tables**.

> **Correction, `re-codebreaker`:** the index is a **party-member** index
> (`0..partyCount-1`), and the "tables" are fields of a 7-element array of
> 262-byte character records at `$3D0A`, plus a bank of parallel 7-word
> per-party-member arrays populated per combat from those records. Three
> independent code-level facts establish this: `average()`'s loop bound is a
> runtime party-member count, not a compile-time class count; `$3D0A`'s
> `0x106`(262)-byte stride is used directly as a byte offset with no
> further multiplier; and the per-party-member arrays sit on a strict
> 14-byte grid matching a 7-slot party.

Corrected reading, per party member `i` (`monster.+0x28` is the monster's
armor-equivalent field, read from the monster-record pointer):

```
# spellcaster branch (party[i] weapon-mode == 4 or 15):
threshold = combatDefence[i] - quotient(monster.+0x28 / 2)     ; party[i].+0x48
dieRoll   = Random(combatSpellDie[i])

# default branch:
threshold = quotient(combatAttackSkill[i] / attacksThisRound) - monster.+0x28
                                                                 ; party[i].+0x30
if party[i].+0x2C == 4: threshold -= 40                         ; character STATUS
adjTerm   = (party[i].+0x08 - average(all party members' .+0x08)) * 30
threshold += adjTerm
if difficultyMode == 2: threshold -= 15
dieRoll   = Random(combatDamageDie[i])

# both branches converge:
if monster[someIndexedField] == 1: threshold = 100     ; guaranteed-hit override
threshold = max(threshold, 1)
Roll      = Random(100)
Miss if Roll > threshold, else Hit    ; STRICT >, a genuine P3-specific
                                        ; difference from P1/P2's >=
```

`party[i].+0x2C` is independently confirmed as the character-status field:
the dispatcher skips a target outright when it's `0`, `2`, or `3` (empty
slot / dead / disabled) — the exact shape of a status guard, and every live
character in the shipped `gamesave.dat` has `+0x2C == 1`.

## Damage — structurally simpler than P1/P2

`dieRoll` from whichever branch executed **is itself the damage value** —
P3 rolls a single die against a class-indexed die-size table rather than
P1/P2's weapon-stat × variance − armor − group-adjustment formula. A
genuine engine-design difference, not a partial trace.

Damage application: `*(monsterPtr + (slotIndex+2)*2) -= Damage`, clamped to
a floor of 0, then sets a "monster took damage" flag — the same
HP-decrement-and-clamp shape as P1/P2, applied to a per-slot monster-group
HP table rather than a fixed record field.

## The merged-BSS discovery

`PhantasieIII`'s DATA hunk declares an allocation of 27,404 bytes but the
file only stores 10,108 of them:

| File offset | Block | Contents |
|---|---|---|
| `0x000000` | `HUNK_HEADER` | 3 hunks; declared sizes `0x8622`/`0x1AC3`/`0x1` longwords |
| `0x000020` | `HUNK_CODE` (hunk 0) | payload `0x28`-`0x218B0` (137,352 B) |
| `0x0278C0` | `HUNK_DATA` (hunk 1) | payload `0x278C8`-`0x2A044` — **only 10,108 B stored** of a 27,404 B hunk |
| `0x02AB44` | `HUNK_BSS` (hunk 2) | 4 B |

Every one of the addresses cited above (`0x2A18`-`0x2A88`, `0x3D0A`-
`0x3D36`) is `>= 0x277C` — past the stored payload entirely. **Four
independent checks confirm `0x277C` is the real data/BSS boundary, zero
deviations:**

1. **Physical impossibility of the alternative** — `0x278C8 + 27,404 =
   0x2E434`, past the file's 174,928-byte EOF.
2. **Sharp reference split** — of 4,676 code→hunk-1 relocations, the
   highest operand below the boundary is `0x26B8` and the lowest at or
   above it is exactly `0x277C`; 575 refs (12.3%) fall in stored data,
   4,100 (87.7%) in the unstored tail.
3. **No initialized pointer aims into the tail** — every stored hunk-1
   pointer and reloc position is `< 0x277C`.
4. **SAS/C small-data signature** — the one hunk-1 relocation whose value
   exceeds even the allocation size (`0x7FFE`) disassembles as `LEA
   $7FFE.L,A4 / RTS` — the textbook SAS/C `__LinkerDB` A4-base setup,
   exactly the toolchain that emits a merged `data+bss` hunk.

The addresses are runtime variables, populated per combat from the
character records — not something a static extractor can ever read from
the file.

**Independently corroborated against `gamesave.dat`**, a byte-exact
11,812-byte match: the save writer/loader issue four mirrored read/write
calls whose lengths sum exactly to the file size, with zero bytes
unaccounted for:

| `gamesave.dat` range | Length | hunk 1 offset | Contents |
|---|---|---|---|
| `0x0000`-`0x1996` | 6,550 | `0x5174` | Guild roster, 25 × 262-byte character records |
| `0x1996`-`0x2146` | 1,968 | `0x3D0A` | Active party, 7 × 262-byte records + 134 B of adjacent globals |
| `0x2146`-`0x216A` | 36 | `0x2CD4` | 18 words of game state |
| `0x216A`-`0x2E24` | 3,258 | `0x44BA` | Item table — `3,258 = 181 × 18`, the same shape confirmed structurally for `inititem.dat` (see [Data Tables](../../phantasieiii/data-tables/)) |

`6,550 + 1,968 + 36 + 3,258 = 11,812` — the exact size of
`data/phantasieiii/amiga/gamesave.dat`.

## The 262-byte character record

| Offset | Field | Confidence |
|---|---|---|
| `+0x00` | Name, 8-byte NUL-padded ASCII | confirmed |
| `+0x08` | Averaged across the party, ×30'd in the to-hit adjustment; `2` for every shipped record | confirmed read; semantics hypothesis (level?) |
| `+0x0A`-`+0x14` | Six attributes — Strength, Intelligence, Dexterity, Constitution, Charisma, Luck | confirmed |
| `+0x20`/`+0x22` | Current / maximum HP | rendered |
| `+0x2C` | Status — `1` = active, `0`/`2`/`3` skip the target, `4` = −40 to-hit penalty | confirmed |
| `+0x30`-`+0x53` | Nine `(current, max)` skill-percentage pairs — see below | confirmed layout; strong hypothesis on naming |
| `+0x48` | Reused as the spellcaster-branch to-hit threshold base — the *current* half of pair 6, an odd-looking reuse, not further explained | confirmed offset, hypothesis on which named skill |
| `+0x6A`, `+0x6C`, `+0x86` | Indices into the `+0x0F10` ramp table | confirmed |
| `+0x106` | Record stride (next record) | confirmed |

### The 9 skill names — found as literal on-screen strings

Two independent live UI-text hits in `PhantasieIII` name all 9 skills, both
using the same "shared string-by-ID pointer table" mechanism as the race
names:

1. A 9-entry short-label array, file offset `0x5674`-`0x56C3`: `Attack,
   Parry, Swimming, Listen, Find Trap, Disarm Trap, Find Item, Pick Lock,
   Fire Bow`.
2. The static character-sheet screen template (file offset `0x57D3`), a
   two-column form layout, right column: the same 9 names in the same
   order, plus the left-column 6-attribute order (`Strength, Intelligence,
   Dexterity, Constitution, Charisma, Luck`).

Both sources agree with each other and with the manual's own skill list
(`Attack, Parry, Swim, Listen, Spot Trap, Disarm Trap, Find Item, Pick
Lock, Fire Bow` — cosmetic wording differences only), and with [the skills
table's](../../phantasieiii/data-tables/) independently-derived 8-skill order —
a third, structurally unrelated confirmation.

**Binding these names to `+0x30`-`+0x53` — a strong hypothesis, not fully
confirmed.** A byte-level trace of the character-sheet draw routine itself
(the P3 analogue of the technique that fully confirmed Phantasie I's stat
names) was attempted and didn't complete: the draw routine's own field-read
loop wasn't isolated from `$5174`(roster)/`$3D0A`(active party)'s dozens of
other consumers (record-copy/sort/init, save/load, combat setup) in the
time available.

| Pair | Offset (cur/max) | Name (hypothesis) |
|---|---|---|
| 0 | `+0x30`/`+0x32` | **Attack** — role independently confirmed via the combat trace above |
| 1 | `+0x34`/`+0x36` | Parry |
| 2 | `+0x38`/`+0x3A` | Swimming |
| 3 | `+0x3C`/`+0x3E` | Listen |
| 4 | `+0x40`/`+0x42` | Find Trap |
| 5 | `+0x44`/`+0x46` | Disarm Trap |
| 6 | `+0x48`/`+0x4A` | Find Item (reused as the to-hit threshold base above) |
| 7 | `+0x4C`/`+0x4E` | Pick Lock |
| 8 | `+0x50`/`+0x52` | Fire Bow |

Pair 0's role is independently confirmed from an unrelated direction (the
combat formula reads `party[i].+0x30` directly as the "attack skill"
operand), and no source found this session supports any alternative
ordering — but that's convergent evidence for the hypothesis, not a
field-by-field disassembly trace of the other 8 pairs. State it at that
confidence: **strong hypothesis**, not confirmed.

### The ramp table — tested against the manual, refuted

The 202-byte lookup table at hunk 1 `+0x0F10` (file `0x287D8`) is pure
concatenated arithmetic ramps (`0..20`, `1..10` then `2..10`, `1..20`, a
¾-slope run, a 1.25-slope run, `0..19`, ×2 and ×3 ramps). This session
tested it byte-exact against the manual's own "Hit Points by Class and
Level" and "Maximum Magic Points at Different Levels by Class" charts — no
match at any offset, scale, or transform, because neither chart is a
constant-slope progression (both have irregular per-level deltas) while
this table contains only constant-slope runs. **That specific hypothesis is
closed as tested-and-refuted**, not merely untried — the table's real role
remains open (see [Status & Open Work](../../phantasieiii/status/)).

### Body-location hypothesis — tested against P1, refuted

The manual's own "Mortality: Hit Points and Body Areas" section describes 6
body locations (Head, Torso, L/R Arm, L/R Leg) each with 4 states. Tested
against the only candidate fields available — Phantasie I's `+0x146`/
`+0x138`/`+0x132` — and refuted: those fields are indexed only by
character (one value per character, not per body location), and their
`group*10+slot` read pattern has no natural relationship to 6 locations × 4
states. No P3-specific field was found to test the hypothesis against
directly; whether P3 tracks body-location damage anywhere in its own
262-byte record is a genuinely open question this session didn't have a
candidate field for.

## The open bits

- The 8 non-Attack skill-pair name bindings — strong hypothesis, draw
  routine not isolated.
- The `+0x0F10` ramp table's real role — HP/MP-chart hypothesis closed,
  nothing else tested.
- `+0x08`'s semantics (averaged, ×30'd in the to-hit formula) — read
  confirmed, meaning (level?) unconfirmed.

Full detail and paths tried: [Status & Open Work](../../phantasieiii/status/).
