# Phantasie I (Amiga) data-claims audit, 2026-11-13

Changes applied: see `audit-2026-11-13-phantasie1-changes.md`.

Report-only audit, 2026-11-13. None of these corrections have been applied yet.

Run as an independent codebreaker re-derivation of the Phantasie I/II/III data claims against the retail bytes, using the auditor's own Python rather than the repo decoders. This page covers Phantasie I; sibling pages: `audit-2026-11-13-phantasie2.md`, `audit-2026-11-13-phantasie3.md`. Provenance only: the auditor's probe scripts (`pad.py`, `stars.py`, `fat12.py`; the rest were run inline) lived in the session scratch subfolder `nico-phantasie/` under `/tmp`, which is not preserved. No emulator was used. Nothing in the repo was edited or committed. Platform: P1 `game` is an AmigaOS HUNK executable (`0x3F3`).

## Summary verdict

- The P1 monster tables, grid width, and outdoor/map data are solid.
- Wrong: the P1/P2 action table "ends at the first `0x0D 0x0D`" model drops 62 records stars can reach across six files (P1: `dng2` 10, `dng4` 6).
- Overstated: the sprite and picture "legible" tests cannot fail; a strong cross-game oracle (P1 vs P2) exists.
- Several stale or contradictory doc passages and TODO hygiene problems apply.
- Biggest risk: the truncated action walk undercounts items and drops reachable records.

## Claims confirmed

- **Monster tables:** the name table ends exactly where the width/height table starts (`0x1EA8`); all 80 sprite offsets are contiguous and sum to 68,016 bytes, the exact `.pat` size. Shifting the offset table by one breaks contiguity. Pixel layout cross-confirmed by finding 2.
- **Grid width:** P1 width 33 is the vertical-autocorrelation peak (0.671 versus at most 0.513 for nearby widths).
- **`monsinfo.dat`:** 38-byte stride is right (80/80 records start with a capital letter, versus at most 11 for strides 36, 37, 39, 40); the `0x60` filler is consistent with the padding rule.
- P1 `maps.int` equals its 18 `out*.dat` grids; a shifted pairing matches 0/18.

## Claims wrong or overstated

### 1. WRONG: the P1/P2 action table "ends at the first `0x0D 0x0D`"

- Docs say: `docs/phantasie/dungeon-format.md:139-152` ("reserved action-table region is roughly 290 bytes (145 slots)"), `:160-165`, and section 7 `:310-314`. Code follows it: `src/assets/formats/dungeon.ts:36-41`, `star-action.ts:177`, `tools/phantasie/build-dungeons.ts:44` (and `tools/phantasieii/build-dungeons.ts:61`) with `terminator: true`. The test `star-action.test.ts:104-118` pins the wrong model.
- Audit: parsed the star table independently and collected every action index a star references, following only bit-7 "continue" chains (no guessed gotos). Stars reference action slots past the first `0D0D`, and those slots hold well-formed records. P1: `dng2` 10 records (e.g. slot 190 `932d016b` is opcode `0x13`), `dng4` 6. (P2 adds 46 more across `DNG3`/`DNG6`/`DNG7`/`DNG8`: 62 in total.) Null control: the other 12 P1/P2 files have zero star references at or past their terminator.
- The game itself never scans for a terminator. P1 allocates 2,500 bytes (`#$9C4`) for DNG_MAP and reads `DNG%-d` with length `$9C4` (`data/phantasie/amiga/game.asm` around lines 9655-9700, IRA section `S_41`). **Unverified: the main session could not find this `$9C4` buffer constant in `game.asm`; treat that sub-claim as unconfirmed.**
- Star action indices are one byte, so the addressable region is 256 slots, `0x5AA`-`0x7AA`, the same fixed 512-byte table P3 uses. The `0x0D` fill runs to `0x794`/`0x7AC`, followed by authoring residue.
- Knock-on: the P1/P2 item cross-checks undercount (`data-tables.md:275`, 63 distinct items, and `:389`, 44, both from the truncated walk). P1 `dng6` is 1,922 bytes, shorter than `0x7AA`; a decoder must zero-pad (the audit says the game's 2,500-byte buffer covers it, subject to the unverified note above).
- Fix: replace the terminator with a fixed 256-slot table (zero-padded) for P1/P2; correct section 3.1 and section 7 with a Correction block; rewrite the terminator test to assert every star reference resolves to a decoded record; rerun the item census; add a TODO row until done.

### 2. OVERSTATED: sprite and picture "legible" tests can't fail; strong cross-game oracle available

- Where: `sprite-bank.test.ts:132-140`, `:147-151`, `:184-192`, `:199-206` only assert distinct pixel values > 1; `pic.test.ts:92-104` asserts > 2. The P1 Planar and P2 Interleaved layout claims rest only on "recognisable" renders (`graphics-formats.md:1421`). Random bytes or the wrong layout pass.
- Evidence: P1 `party1/2.pat` decoded Planar and P2 `PARTY1/2.PAT` decoded Interleaved (interleave 2) give identical pixels for all 32 race sprites (32,768/32,768 px). For the 49 monsters per bank sharing name and dimensions across games, P1 `mstr1/2.pat` against P2 `MSTR1/2.PAT` is pixel-exact (98 sprites, 152,032/152,032 px). Null controls: the swapped layout and the neighbouring sprite drop to 24-69%.
- Fix: replace the non-blank asserts with this cross-game pixel equality; it confirms both layouts and both executables' tables at once.

### 3. Stale contradictions (P1-relevant)

- **P1/P2 9-byte header gap:** `dungeon-format.md:341` still calls the `0x04F2` gap "open", and `src/assets/formats/dungeon.ts:23-25` comments it "Unidentified ... open". It is resolved as the exit-destination table (section 3 Correction, TODO row resolved).
- **P1 palette entry 12:** `data-tables.md:339-345` still describes it as an "AmigaToST-decoded ... outlier"; that reading was retracted in section 1.3.
- **`tamb.dat`:** `dungeon-format.md:1457-1465` says "Purpose unknown", but `graphics-formats.md:294` already cites the read site `Read("tamb.dat", buf, 2850)` and calls it title music. No TODO row.
- **Outdoor grids:** P1 `maps.int` equals its 18 `out*.dat` grids (see confirmed).

### 4. TODO hygiene

13 rows are status `resolved` and 2 `narrowed`; valid statuses are only open / escalated / blocked / deferred, and solved rows should be deleted. Open items with no row: `tamb.dat` format; P1/P2 dungeon trailing residue (section 3.1 open question); the 5-byte pad at `out*.dat` `0x03E3`; the CMP strip-overflow semantics (P3 file, see the P3 page). Fix: delete solved rows, convert `narrowed` to `open`, add missing rows.

## Unverified / open

- The `$9C4` / `game.asm` ~9655-9700 buffer-size claim (finding 1): not found in the main session.
- Residue: P2 dungeon and message files were authored on top of P1's. P2 `DNG1` carries P1 `dng1`'s residue string "A STRANGE PURPLE GAS F"; nine P1 `mess*` / P2 `MESS*` pairs (7 distinct sizes) have identical byte sizes. Bytes past the last referenced line or slot are residue, not content. Undocumented in the repo.

## Recommended corrections (cheapest and highest-value first)

1. Switch P1/P2 action decoding to a fixed 256-slot table; fix docs and tests (finding 1).
2. Add the cross-game race and monster pixel test (finding 2).
3. Clean the stale text and `tamb.dat`/header-gap comments (finding 3).
4. Clean TODO statuses and add missing rows (finding 4).
5. Trace the consumer of `tamb.dat` from its read site and compare its grammar with P3's `m0`/`m1` music.

## Checks for Cassandra to run in play

The audit lists no live-emulator checks.

## Process notes

- Tautological tests: `sprite-bank.test.ts` and `pic.test.ts` non-blank asserts; `star-action.test.ts:104-118` pins the wrong terminator model.
- TODO file violates its own status contract (finding 4).
- Untracked user contact sheets `docs/phantasie/assets/party-roster-*contact-sheet*.png` (6 files) were left alone.
