---
title: Characters, Items & Combat
description: Phantasie II's monster/race/item tables, its four exclusive dungeon opcodes, and why its combat formula matches Phantasie I's exactly except for the RNG underneath it.
---

Phantasie II's `PHANT.PRG` (155,785 bytes) carries the same shape of data
tables as Phantasie I's `game` executable — monster names, sprite geometry,
a palette, race names, item names — plus the dungeon-script opcodes and
combat routines that consume them. Every offset below is `PHANT.PRG`'s own,
confirmed byte-exact with **no adjustment needed** from the reference
source's originally-recorded values, because `PHANT.PRG` *is* the same
Atari-ST binary those offsets were recorded against — unlike Phantasie III's
Amiga port, whose offsets shifted.

## Data tables

| Table | P1 offset (`game`) | P2 offset (`PHANT.PRG`) |
|-------|----------------------|----------------------------|
| Monster names (58-byte stride, 80 entries) | `0x0C88` | `0x1FF2A` |
| Monster sprite offset table (4-byte stride, 80 entries) | `0x16842` | `0x23D90` |
| Monster width/height table (4-byte stride, 80 entries) | `0x1EA8` | `0x2114A` |
| Palette (16 words) | `0x194BC` | `0x23A9E` |
| Race names (sequential strings) | `0x69BE` | `0x1F01C` |
| Item names (181 sequential strings) | — | `0x1E9CC` |

**80 monsters, 16 races — the same roster *structure* as Phantasie I**, same
names in `data/extracted/phantasieii/entities.json`/`races.json`. The actual
roster *content* differs where you'd expect two different games sharing an
engine to differ: index 3 is `GREEN MUCK` here vs. P1's `SKUM`, index 7 is
`WILD DOG` vs. P1's `COYOTE`. Race names are **byte-identical** to P1's list
of 16 (`HUMAN, DWARF, ELF, HALFLING, GNOME, PIXIE, SPRITE, OGRE, GNOLL,
TROLL, KOBOLD, ORC, GOBLIN, LIZ.MAN, MINOTAUR, UNDEAD`).

**181 item names**, same technique as P1's item table — sequential
NUL-terminated strings starting `"NOTHING"` at index 0. Past the shared
early-game armour/weapon list, P2's roster diverges (distinct
`SCROLL A`-`SCROLL N` lettering vs. P1's numbered `SCROLL 1`-`SCROLL 20`, a
different late-game gem/treasure list). **Cross-validated against real
game data**: every opcode-`0x06` ("+Item") action record across all 8 real
`DNG1`-`DNG8` files references one of **44 distinct item indices, zero of
them out of the confirmed 0-180 range**, all resolving to plausible items
(`MD SHIELD`, `SWORD +2`, `HEAL POT7`, `SCROLL H`, `DIAMOND`).

## Two shared engines, one game-specific set of opcodes

Phantasie I and II's dungeon files are read by one byte-identical parser —
full detail on the [Dungeon & Scripting Engine](/formats/dungeon-and-scripting-engine/)
page. Opcodes `0x00`-`0x13` mean the same thing in both games; Phantasie II
adds four of its own, confirmed present in real shipped content, not just a
static gate that happens to never fire:

| Opcode | Effect |
|---|---|
| `0x14` | Unconditional "goto Action `Param1`" |
| `0x15` | `Param1` = percent chance to **not** jump; on success, "goto Action `Param2`" |
| `0x16` | "goto Star `Param1 - 1`" — redirects the outer trigger loop to a different star |
| `0x17` | Win-condition marker (forces stop) |

Scanning the decoded action-table opcodes across all 8 real `DNG1`-`DNG8`
files finds `0x14`-`0x17` values genuinely in use — `DNG8`'s highest
observed opcode is `0x17`. The same scan against all 10 real Phantasie I
`dng*` files finds a maximum opcode of `0x13` in **every one of them** — the
opcode-space split holds in practice, not just in the gating logic.

## Combat: the same formula, a different RNG

Traced from `PHANT.PRG`'s own combat strings (`"%s HITS"`, `"%s TAKES %d
DAMAGE"`) the same way as Phantasie I's — locate the string, byte-scan for
its literal address used as a code operand (`fileOffset - 0x1C`, i.e. minus
the 28-byte GEMDOS `.PRG` header), then disassemble the call site.

> The hit/miss+damage block (logical `0x8700`-`0x87B0`) is **structurally
> near-identical to Phantasie I's**, right down to shared magic constants —
> the same 58-byte monster stride, the same `+0x2E` armour-field offset, the
> same `100`/`67` damage constants, the same `+35` adjustment term. This is
> what "shares an engine" concretely means: the formula shape and every
> field offset transferred unchanged. What **didn't** transfer is the random
> number generator underneath it — a genuinely different algorithm, not
> just a re-seeded copy of Phantasie I's.

### To-hit formula — confirmed

```
D1 = charIdx * 0x13E(318) + $25162     ; char record ptr, P2's own 318-byte stride
D1 = char.+0xFA                          ; SAME field offset as P1
D1 = D1 / localDivisor  (-0x20(a6))
D2 = monIdx * 0x3A(58) + $25D9A          ; monster record ptr, SAME 58-byte stride as P1
D2 = monster.+0x2E                       ; SAME field offset as P1
D1 -= D2                                 ; HitChance
D0 = JSR $FD40                           ; Roll (0..100)
CMP.W D1,D0 / BGE.W → miss               ; miss if Roll >= HitChance
```

(P2's 318-byte character-record stride is its own build's value, expected to
differ from P1's 282 — everything else matches P1 field-for-field.)

### Damage-magnitude formula — confirmed

```
weaponStat = char.+0xF8                              ; SAME field offset as P1
variance   = roundedHalf(RollPercent())               ; same Newton's-method integer-sqrt shape as P1
raw        = variance * weaponStat
raw       -= monster.+0x14 * 10                        ; SAME field offset as P1
groupAdj   = quotient( charOrGroupArray[$25F7E][charIdx] * 100 / 0x43 )   ; SAME 100/67 constants as P1
adjusted   = raw + 0x23(35) - groupAdj                  ; SAME +35 constant as P1
Damage     = quotient( adjusted / 10 )
```

### The RNG — a 7-word additive/rotating generator, not an LCG

The roll call site is `JSR $FD40` at logical address `0x8706`, with `D0`
(the return value) carried untouched into the hit/miss compare — the exact
placement of Phantasie I's `RollPercent()` call. `$FD40` is a thin wrapper:

```
LINK.W A6,#-4
JSR $1AD22            ; raw generator
EXT.L D0
DIVS.W #0x147,D0      ; 0x147 = 327, IDENTICAL to P1's RollPercent() divisor
UNLK A6 / RTS         ; returns 0..100
```

`$1AD22`, the raw generator, is **not a multiply-add-mod linear congruential
generator** — a real, byte-confirmed structural difference from both
Phantasie I and III. It sums a 7-word (14-byte) circular table at logical
address `$242DE`, using a rotating write-index at `$242EC`:

```
sum = table[0] + table[1] + ... + table[6]   ; sums the WHOLE table, not two lagged slots
index = (index + 1) mod 7
table[index] = sum
return sum >> 1
```

The companion seeding routine (`$1AD88`) writes the caller's seed into
`table[0]`, then runs `(seed & 0x3F) + 1` warm-up calls through the
generator before returning — a "prime the buffer" pattern, feeding the
identical `/327` `RollPercent()` wrapper Phantasie I uses, down to the same
divisor constant, despite being a completely different underlying algorithm.

**Confidence: confirmed** — the call site, its wrapper, the raw generator's
exact algorithm, its seeding routine, the full to-hit compare, and the full
damage formula are all byte-verified against the real `PHANT.PRG`, with
every field offset and constant cross-checked against Phantasie I's already-
confirmed equivalents. Everything matches except the two expected structural
differences: P2's 318-byte character stride (vs. P1's 282) and its additive
generator (vs. P1's `seed*3677+3 mod 32768` LCG).

## What SSI's own manual adds

SSI's 1986 *Phantasie I and Phantasie II Rulebook* documents Phantasie II
explicitly (title page: "PHANTASIE II: NIKADEMUS' REVENGE") and closes with
a "PHANTASIE II Updated Rules" section describing what changed from
Phantasie I: a new "Toss Rock" combat option (unlimited ammunition, accuracy
tied to a Toss Rock skill level), amulets and an enchanted orb replacing
Phantasie I's nine rings and a wand as the game's key artifacts, the
manual's own "approximately 15" scrolls scattered through Ferronrah vs.
Phantasie I's exact count of 20 in Gelnor, and
three new terrain types (molten lava, mist, dark voids) affecting travel and
encounter odds. These are manual-documented design facts, not disassembly
findings — cited here as corroborating context for "P1 and P2 share an
engine but are different games," not reconciled against the tables above.

## The open bits

Only the party-attacks-monster combat direction was traced this session.
The monster-attacks-player mirror direction — already traced for Phantasie I
— hasn't been traced for Phantasie II yet. See
[Status & Open Work](/phantasieii/status/).
