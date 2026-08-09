---
title: Dungeon & Scripting Engine
description: The byte-identical dungeon grid, star/action/message trigger system, and combat resolution shared by Phantasie I and II.
---

Phantasie I and Phantasie II dungeon files are read by **the same parser**.
Not a similar one — the same header offsets, the same 33×38 grid layout, the
same star (trigger) / action (script) / message record formats, confirmed
byte-for-byte against real files from both games. The only differences are
which item/monster/race name tables get plugged in for display, and four
extra opcodes (`0x14`-`0x17`) that only Phantasie II's data actually uses.

Phantasie III shares the same overall *shape* — grid + star table + action
table + trigger-driven messages — but is a distinct, not byte-identical,
parser with its own header offsets, its own opcode numbering past `0x13`,
and messages embedded in the dungeon file itself rather than a separate
file. See [Phantasie III's Data Tables](/phantasieiii/data-tables/) for its
own version.

## Dungeon grid and header (Phantasie I/II)

33 columns × 38 rows = 1,254 bytes, row-major (`cell[x,y]` at byte
`y*33 + x`), starting at file offset 0.

```
+0x0000  1254 bytes  Cell grid, 33×38 row-major
+0x04E7  1 byte      Dungeon level (0-based)
+0x04E8  10 bytes    Fixed-encounter monster index table
+0x04FB  up to 175   Star (trigger) table — 35 fixed slots, 5 bytes/slot nominal
+0x05AA  variable    Action (script) table — terminated by 0x0D 0x0D
```

Confirmed against all 10 real Phantasie I `dng*` files and all 8 real
Phantasie II `DNG*` files (extracted from the game's own `.stx` floppy
images — see [Extraction](/phantasieii/extraction/)): the star table's
declared 175-byte capacity lands exactly at the action table's declared
start address (`0x04FB + 175 = 0x05AA`), and the action-table terminator is
found in every one of the 18 real files, landing in the same `0x6CC`-`0x736`
range for both games.

## Cell IDs

One shared semantic table, identical across all three games:

| Range | Meaning |
|---|---|
| `0x00` | Wall |
| `0x01` | Secret wall |
| `0x02`-`0x06` | Trap (damage formula differs by game — see each game's combat page) |
| `0x08`-`0x11` | Message + random encounter (rolls among 3 consecutive monster-table entries) |
| `0x12`-`0x7F` | Special message, no encounter |
| `0x80`-`0x89` | Fixed encounter (indexed into the per-dungeon table at `+0x04E8`) |
| `0x8B`-`0xB8` | Bottom message only |
| `0xB9`-`0xD6` | Doors (horizontal/vertical, opened/encounter/locked/unlockable) |
| `0xD7`-`0xDC` | Stairs (exit or inter-level) |
| `0xDD`-`0xFF` | Star (script trigger); `starIndex = cell − 0xDD` |

## Star, action, and message records

A **star** is a trigger on a `0xDD`-`0xFF` cell. Triggering one shows a
message, optionally offers a numbered choice, then walks a chain of
**actions** — small opcode+parameter records that mutate game state,
branch, loop, or jump to another star.

```
Star record (5-byte base unit):
+0  flags + message index   bit 7 = one-use; bits 6-0 = messageIndex + 1
+1  choice count            number of dialogue choices offered
+2  action index list       one byte per choice
```

```
Action record (2-byte base unit, 4 bytes for a fixed opcode set):
+0  flags + opcode          bit 7 = continue chain; bit 6 = one-use; bits 5-0 = opcode
+1  param 1
+2  param 2 (double-sized records only)
+3  param 3 (double-sized records only)
```

Both tables are **packed, variable-stride arrays** scanned slot-by-slot, not
flat fixed-stride ones — an oversized star (more than 3 choices) or a
double-sized action consumes more than one nominal slot, which is why a
star/action index can land "inside" what looks like a neighboring record's
range.

Phantasie I/II keep messages in a separate `MESS*` file: a 115-entry
little-endian word offset table, then 41-byte length-prefixed line records
(`data-tables.md` §3.1 in the raw notes has the full choice-count heuristics
and their one open caveat).

## The opcode table

Opcodes `0x00`-`0x13` mean the same thing in both games (with one confirmed
engine difference: opcode `0x09`/`0x0A`'s gold-removal multiplier is `×250`
in Phantasie II vs `×256` in Phantasie III — flagged with a "not 256?"
comment in the reference source itself). Phantasie II adds four more:

| Opcode | Effect |
|---|---|
| `0x14` | Unconditional "goto Action" |
| `0x15` | Percent-chance conditional jump |
| `0x16` | "goto Star" — redirects the outer trigger loop |
| `0x17` | Win-condition marker |

**Confirmed present in real shipped content, not just a static gate**:
scanning all 10 real Phantasie I `dng*` files' decoded opcodes finds a
maximum value of `0x13` in every one (Phantasie I data genuinely never uses
these). Scanning all 8 real Phantasie II `DNG*` files finds `0x14`-`0x17`
values actually in use — `DNG8`'s maximum observed opcode is `0x17`, the
win-condition marker.

## Combat: one formula shape, two different RNGs

Traced independently for both games this session, starting from each
executable's own combat message strings (`"%s HITS"`, `"%s TAKES %d
DAMAGE"`). The **formula shape is structurally identical** between the two
games — same 58-byte monster record stride, same armor-field offset, same
`100`/`67` damage constants — but each game's random-number generator is a
genuinely different algorithm, despite sharing everything else:

- **Phantasie I**: a linear congruential generator, `seed = (seed*3677+3)
  mod 32768`, wrapped by a `RollPercent()` helper that divides by 327 to
  land in `0..100`.
- **Phantasie II**: a 7-word additive/rotating generator — not an LCG at
  all — reached via a `JSR` at logical address `0x8706`.

Hit/miss and damage math both reduce to the same shape in both games:

```
HitChance = quotient(attacker_stat / localDivisor) − defender_armor_field
miss if RollPercent() >= HitChance

Damage = quotient((RollPercent()-derived_term * attacker_damage_stat
                    − defender_field*10 + 35 − weapon_term) / 10)
```

See each game's own combat page for the exact field bindings — several of
Phantasie I's are now bound to named stats (Armour Rating, for one) via its
character-sheet display routine; Phantasie II's equivalent fields are
confirmed structurally but not yet named.

## Ground-truth oracles

Two independent, first-party SSI sources back this page's claims: the 1986
*Phantasie I and Phantasie II Rulebook* (covering both games' shared
rules) and, for the combat/RNG tracing specifically, direct disassembly of
both games' own executables, cross-checked byte-for-byte against every real
`dng*`/`DNG*` file in this project's `data/`.
