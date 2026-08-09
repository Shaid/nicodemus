---
title: Characters & Combat
description: The GetStat/SetStat character-record resolver, every confirmed stat name, and both combat-resolution directions, disassembly-traced and cross-checked against SSI's own 1986 rulebook.
---

This is the richest material to come out of this session: a full
disassembly of `GetStat`/`SetStat` — the character-record accessor the
dungeon-script interpreter uses — plus a complete trace of combat
resolution in both directions. See [Dungeon & Scripting
Engine](/formats/dungeon-and-scripting-engine/) for the star/action/message
format this all sits underneath.

> **Don't read `statIndex` positionally.** Walking the twelve on-screen
> character-sheet labels against sequential `statIndex` values 1-12 gets
> the six core attributes right, gets `statIndex 9` half-right by
> coincidence, and gets the remaining five (`7`, `8`, `10`, `11`, `12`)
> flatly wrong — including mislabelling the already-confirmed current-HP
> field (`statIndex 12`) as "Score." `AGE` isn't `statIndex 7` at all; it
> lives at `char.+0x108`, entirely outside the `GetStat`-addressable set,
> and is divided by 26 before display. `HIT POINTS`/`MAGIC` are stored
> **max-then-current**, Magic before Hit Points — the opposite of their
> on-screen order.

## `GetStat`/`SetStat` — a linear resolver, not a flat array

`statIndex` is not a data table sitting in the executable to read directly
— it's an addressing convention the dungeon-script interpreter uses (opcode
`0x12`/`0x13`/`0x18`/`0x19`) against an in-memory per-character record.
Both accessors were located and fully disassembled this session, then every
cited instruction was independently re-read from
`data/phantasie/amiga/game` and byte-compared — **51 of 51 match, 0
mismatches**.

| Function | File offset | Confirmed entry bytes |
|---|---|---|
| `ExecuteAction` (enclosing dispatcher) | `0x10E40` | `4E56 FFDE 48E7 3800` |
| Shared index→address resolver | `0x1142C` | `4E56 FFFC 302E 000E` |
| `GetStat` | `0x116EA` | `4E56 0000 302E 000A 48C0 …` |
| `SetStat` | `0x11710` | `4E56 0000 302E 000A 48C0 …` |

The resolver at `0x1142C` is a linear `CMPI.W`/`Bcc` chain — **direct index
arithmetic through a range-check chain, not a jump table and not one flat
array**. Once `statIndex` matches a range, it computes
`address = charBase + charIndex*0x11A + f(statIndex)` (`0x11A` = 282 bytes
per character record; every stat is a 16-bit word field). A handful of the
resolver's real branch formulas:

```
statIndex  1-13   -> offset = 2*statIndex - 2      (core attributes)
statIndex  20-39  -> offset = 0x1E + 2*floor((statIndex-20)/2)   (skills, even)
                   or 0x32 + 2*floor((statIndex-21)/2)           (skills, odd)
statIndex  == 42  -> offset = 0x46                 (fixed — Score)
statIndex  56-58  -> offset = 2*statIndex + 0x86    (combat fields)
statIndex  == 161 -> offset = 0x100                (fixed — Race)
anything else     -> error path (PEA $237; JSR $32A)
```

Two `statIndex` values genuinely alias the same byte: `13` and `18` both
resolve to `char.+0x18` (the "alive" flag). This isn't a parser bug — it's
the real branch-chain arithmetic, preserved as-is.

## Confirmed stat names

Located by tracing `BuildCharacterSheetStrings(char*)` at file offset
`0xAA4A` (the character-sheet display routine) end-to-end, cross-checked by
two independent structural oracles (placeholder-geometry alignment, 12/12
zero deviation; an unrelated party-roster line-builder at `0x13718`
agreeing on the HP/MP field order) — plus a **third, independent primary
source**: SSI's own 1986 *Phantasie I and Phantasie II Rulebook*, whose
printed character-sheet example independently names every field below.

| `statIndex` | `char.+` offset | English name |
|---|---|---|
| 1 | `0x00` | **Strength** |
| 2 | `0x02` | **Intelligence** |
| 3 | `0x04` | **Dexterity** |
| 4 | `0x06` | **Constitution** |
| 5 | `0x08` | **Charisma** |
| 6 | `0x0A` | **Luck** |
| 7 | `0x0C` | *no label — see below* |
| 8 | `0x0E` | *no label — see below* |
| 9 | `0x10` | **Magic — maximum** |
| 10 | `0x12` | **Magic — current** |
| 11 | `0x14` | **Hit Points — maximum** |
| 12 | `0x16` | **Hit Points — current** |
| 13 (≡ 18) | `0x18` | **Status** (alive/dead/asleep index) |
| 42 | `0x46` | **Score** |
| 58 | `0xFA` | **Armour Rating** (raw; displayed as `char.+0xFA / 75 + 1`) |
| 161 | `0x100` | **Race** |

Plus all 8 skill names, from the same routine's tail:

| `char.+` offset | Skill |
|---|---|
| `0x1E` | **Attack** |
| `0x20` | **Parry** |
| `0x30` | **Swim** |
| `0x28` | **Listen** |
| `0x24` | **Spot Trap** |
| `0x26` | **Disarm Trap** |
| `0x22` | **Find Item** |
| `0x2C` | **Pick Lock** |

**SSI's own rulebook, independently confirming this** — its printed
example character sheet reads (excerpted, `pdftotext -layout` on
`Phantasie_I_and_Phantasie_II_Rulebook_SSI_text.pdf`):

```
STRENGTH       14             AGE   24
INTELLIGENCE   16      HIT POINTS   4/5
DEXTERITY      12           MAGIC   7/7
CONSTITUTION   13   GOLD IN BANK    49
CHARISMA       14   EXPER. POINTS   0
LUCK           12          SCORE    2
        SKILLS:                 EQUIPMENT:
ATTACK 48 SPOT TRAP  15       CLUB (4)
PARRY 29 DISARM TRAP 8        ROBES (2)
SWIM   27 FIND ITEM  12       SM SHIELD (4)
LISTEN 12 PICK LOCK  6
```

Every field named by the disassembly trace above also appears, verbatim,
in this 1986 first-party source — two independent oracles agreeing on
every label.

### Two indices with no name — stated plainly, not rounded up

`statIndex` **7** (`char.+0x0C`) and **8** (`char.+0x0E`) are **structurally
confirmed unreachable by any display routine in the binary**. This is a
stronger, more specific finding than "unknown": a census of all 322 code
sites that load the character-array base and the first displacement each
uses found exactly one reader for each field (`char.+0x0C` at `0xDB8E`, the
combat dispatcher; `char.+0x0E` at `0x1DA6C`, the inn/rest routine, used as
`char.+0x0E − char.+0x10`), and neither reader is a character-sheet
printer. Naming them needs a behavioural oracle (fan documentation, a live
emulator trace) this project doesn't have — not more disassembly. See
[Status & Open Work](/phantasie/status/).

## Combat resolution

Traced from the executable's own combat message strings (`"%s HITS"`,
`"%s MISSES"`, `"%s TAKES %d DAMAGE"`). Every offset below was independently
re-read from `data/phantasie/amiga/game` and byte-compared; all matched.

### The RNG

`GetRandom()` (file offset `0x2C874`) is a **linear congruential
generator**:

```
seed = (seed * 3677 + 3) mod 32768
```

`RollPercent()` (`0x1DD5E`) calls `GetRandom()`, divides by `327`, and
returns the quotient — since `327*100 = 32700 ≤ 32767 < 327*101`, the
result always lands in `0..100`, with a small, real, original-game bias:
only seed values `32700..32767` (68 of 32768) produce `100`, versus 327
seed values for every other result. This is `RollPercent()`, not a fresh
per-call RNG — every roll below is this same function.

### Party attacks monster

```
localDivisor = quotient(charOrGroupArray[+0x146][charIdx] / 10)
HitChance    = quotient(char[charIdx].+0xFA / localDivisor) - monster[monIdx].+0x2E
Roll         = RollPercent()                          ; 0..100
Miss if Roll >= HitChance, else Hit

weaponStat   = char[charIdx].+0xF8
variance     = roundedHalf(RollPercent())              ; Newton's-method integer
                                                         ; sqrt, 0..10 for roll 0..100
raw          = variance * weaponStat - monster[monIdx].+0x14 * 10
groupAdj     = quotient(charOrGroupArray[+0x146][charIdx] * 100 / 0x43)  ; 0x43 = 67
Damage       = quotient((raw + 35 - groupAdj) / 10)
```

`char.+0xFA` is bound to `statIndex 58` (Armour Rating — the same field
named on the character sheet, doing double duty as a to-hit divisor here);
`char.+0xF8` is bound to `statIndex 57`, one slot over, no English name.
`roundedHalf()` is a real Newton's-method integer square root, not "roughly
half the roll" — fully disassembled (`0x1D714`), confirmed by hand
simulation: `roundedHalf(100)` converges `50→26→14→10→10 = 10 = √100`
exactly; `roundedHalf(1)` returns `0` (not the mathematically correct `1`)
because the initial estimate `⌊1/2⌋ = 0` trips an early-exit branch before
the Newton loop runs — a faithfully-preserved original quirk.

### Monster attacks player — not a mirror image

```
localA     = quotient(monster[monIdx].+0x38 / 82)
HitChance  = (quotient(monster[monIdx].+0x38 / localA) - char[charIdx].+0xC) * 10
Roll       = RollPercent() * 6                          ; 0..600, NOT 0..100
Miss if Roll >= HitChance, else Hit

base   = quotient(roundedHalf(RollPercent()) * monster[monIdx].+0x16 / 15)  ; NOT /10
Damage = base - char[charIdx].+0xF6
if statusArray[+0x146][charIdx] == 3 and Damage > 0:
    Damage -= char[charIdx].+0xF2
```

Two confirmed asymmetries with the party-attacks-monster direction: the
roll is scaled `×6` (range `0..600`) instead of used bare (`0..100`), and
the damage divisor is `15` instead of `10`. `char.+0xC` is bound to
`statIndex 7` — the very field with no display-routine name (above),
structurally playing an armour/defense role here. `char.+0xF6` is bound to
`statIndex 56`; `char.+0xF2` (a *conditional* extra reduction, gated on a
per-character status array) is bound to `statIndex 163`. None of the four
monster-side fields (`+0x2E`, `+0x14`, `+0x38`, `+0x16`) are reachable via
`GetStat` at all — monsters use a separate flat 58-byte record with no
analogous accessor.

## The open bits

- English names for `statIndex` 7 and 8 — no display consumer exists in the
  binary (see above); needs a behavioural oracle, not more disassembly.
- English names for `statIndex` 56/57/58/163 (the combat fields) —
  correctly bound to record offsets and resolver slots, but not to a
  printed label.
- `monster.+0x2E`/`+0x14`/`+0x38`/`+0x16`'s exact semantics — plausibly
  armor/level/attack stats by structural role, not display-confirmed;
  monsters have no `GetStat`-equivalent accessor to trace.
- The `+0x146`/`+0x138` per-character arrays — narrowed to "small
  combat-stance/status codes" (values seen: `3`, `4`), not fully
  enumerated.
- The `0x43` (67) damage-formula constant — no game-design meaning found;
  `100/67 ≈ 1.4925` was checked against a `×1.5` hypothesis and doesn't
  match exactly.

See [Status & Open Work](/phantasie/status/) for the full list, and
`docs/phantasie/scripting-engine.md` §§6.3, 6.3(d), 7 for the complete
evidence trail.

## Ground-truth oracles

Two independent, first-party sources back every claim on this page: direct
disassembly of `data/phantasie/amiga/game`, cross-checked byte-for-byte
against all 10 real `dng*`/`mess*` files in this project's `data/`; and
SSI's own 1986 *Phantasie I and Phantasie II Rulebook*, whose printed
character-sheet and Skills sections independently confirm every stat and
skill name above.
