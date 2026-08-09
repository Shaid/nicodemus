---
title: Status & Open Work
description: What's solved and what's still open for Phantasie I, mirroring the repo's docs/phantasie/TODO.md.
---

This page mirrors the repo's single status surface,
`docs/phantasie/TODO.md`, filtered to rows relevant to Phantasie I. Every
genuinely open item gets one row here; the full evidence and paths-tried
tables live in the raw notes.

## Open items

| ID | Status | Question |
|---|---|---|
| `gfx-p1-palette-decode-variant` | open | The `.pat` monster/race sprite renderer (`readP1Palette()`) still uses the Atari-ST even-nibble `AmigaToST` lookup instead of the corrected native-Amiga `component*17` decode — the `.pic` path already uses the correct one. This mis-renders `pal3` index 12 (pure red instead of pale salmon) in the committed `mstr1.png`/`mstr2.png`/`party1.png`/`party2.png` atlases. Fixing it is deferred only because it changes committed golden RGB values in `palette.test.ts`/`sprite-bank.test.ts` — when does that flip happen? |
| `scripting-p1-stat-names` | open | `statIndex` 7 (`char.+0x0C`) and 8 (`char.+0x0E`) have no English name — a census of every code site that loads the character-array base found exactly one reader for each, and neither is a display routine. Is there any behavioural oracle (fan documentation, a live emulator trace) that could name them, since more disassembly of this binary won't? |
| `scripting-p1-combat-field-semantics` | open | Five combat fields are bound to exact `statIndex` values (`char.+0xC`→7, `+0xF6`→56, `+0xF8`→57, `+0xFA`→58, `+0xF2`→163) but have no English name. Four monster-side fields (`+0x2E`, `+0x14`, `+0x38`, `+0x16`) have no `statIndex` binding at all — monsters aren't `GetStat`-addressable. What are `+0x146`/`+0x138`'s exact per-character status-code semantics, and what does the `0x43` (67) damage-formula constant mean? |
| `p1-dungeon-header-gap` | open | `dng*`'s header carries an unidentified 9-byte gap at `+0x04F2`, between the fixed-encounter table and the star table (sample bytes in `dng1`: `01 08 10 00 00 00 00 00 00`). The reference parser never reads it — what is it? |
| `p1-dungeon-trailing-region` | open | Most `dng*` files carry trailing ASCII text ending `"ENDING SEQUENCE"` after the action table's `0x0D 0x0D` terminator; `dng2`/`dng4` instead carry a few extra well-formed-looking action-opcode byte pairs before their own terminator lands slightly later. Is any of this read by the real game through a path the reference tool doesn't implement, or is it dev-time leftover? |
| `p1-twns-int-fields` | open | `twns.int` (13,000 bytes): the 292-byte record stride and the 12 real town names (`PELNOR`, `PINEVILLE`, …) at offset `0x62` within each record are confirmed. Every other field — shop inventory, prices, coordinates — is unidentified, as is the header before `0x0A44` and two non-empty "extra" record slots (33, 34) that may not be town records at all. |
| `p1-out-dat-grid` | open | `out1.dat`-`out19.dat` (2,500 bytes each): a leading tile-code grid of unconfirmed dimensions precedes a confirmed block of ~40-byte, null-terminated point-of-interest text lines starting at `0x0255`. What are the grid's real dimensions, and is `0x0255` fixed across all 19 files or does it vary with grid content? |
| `p1-maps-int` | open | `maps.int` (9,360 bytes) — same tile-code pattern as `out*.dat`'s grid region but with **no** embedded readable text anywhere (201 printable-ASCII runs found, all short tile-code letter runs). 9,360 has no clean square-grid factorization. What are this file's real dimensions and role? |
| `p1-scrolls-dtx-division` | open | `scrolls.dtx` (16,000 bytes, confirmed 40-byte line stride, 400 lines, legible "THE HISTORY OF GELNOR" narrative text) — how do the 400 lines subdivide into individual named scrolls? No length-prefix or part-count field was identified. |
| `p1-tamb-dat` | open | `tamb.dat` (2,850 bytes) — dense binary, 42 distinct byte values, dominated by `0x00`/`0x82`/`0x0D`. No readable strings, no record boundaries identified. Purpose entirely unknown. |

## Closed (accepted as final)

| Item | Result |
|---|---|
| `.pic` real in-game palette | **Resolved for all 6 files.** Each file's palette assignment (`pal0`-`pal4`) resolved byte-exact via `HUNK_RELOC32` operand tracing (including 3 intra-hunk `bsr` call sites a relocation-only scan misses) and independently confirmed by pixel-level render. |
| P1 `game`/`run` HUNK addressing vs. file offsets | Every documented P1 offset is a plain, unadjusted **file** offset — a full hunk walk confirms each lands cleanly inside whichever of the 240 hunks really holds that data, several exactly on a hunk boundary. |
| Character-sheet field names | **Confirmed** — 12 core stats, Score, Armour Rating, Race, Status, and all 8 skill names bound to their real on-screen labels via a 51/51-byte-verified trace of `BuildCharacterSheetStrings` (`game+0xAA4A`), independently cross-checked against SSI's own 1986 rulebook. |
| Item name table (181 entries) | **Confirmed, byte-exact.** Every real opcode-`0x06` item reference across all 10 `dng*` files resolves in range: 63 distinct indices, 0 out of the 0-180 range. |
| Combat RNG and both hit/miss/damage formula directions | **Confirmed.** `GetRandom()`/`RollPercent()` fully disassembled; both party-attacks-monster and monster-attacks-player formulas byte-verified, including the confirmed asymmetry (different roll multipliers and damage divisors between directions). |
| `roundedHalf()`'s exact algorithm | **Confirmed** as a Newton's-method integer square root (not "roughly half the roll"), hand-simulated against two inputs with zero deviation. |

## Where to read the full evidence

- `docs/phantasie/graphics-formats.md` §§1-3, 7-9 — `.pic`/`.pat` formats
  and the palette correction.
- `docs/phantasie/data-tables.md` §1, §8 — monster/race/item/palette
  tables.
- `docs/phantasie/dungeon-format.md` §§3, 8 — the dungeon header gap and
  every non-dungeon world file.
- `docs/phantasie/scripting-engine.md` §§6.3, 6.3(d), 7 — `GetStat`, stat
  names, and combat resolution.
- `docs/phantasie/TODO.md` — the project's single status surface across
  all three games.
