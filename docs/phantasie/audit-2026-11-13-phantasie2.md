# Phantasie II (Atari ST) data-claims audit, 2026-11-13

Changes applied: see `audit-2026-11-13-phantasie2-changes.md`.

Report-only audit, 2026-11-13. None of these corrections have been applied yet.

Run as an independent codebreaker re-derivation of the Phantasie I/II/III data claims against the retail bytes, using the auditor's own Python rather than the repo decoders. This page covers Phantasie II; sibling pages: `audit-2026-11-13-phantasie1.md`, `audit-2026-11-13-phantasie3.md`. Provenance only: the auditor's probe scripts (`pad.py`, `stars.py`, `fat12.py`; the rest were run inline) lived in the session scratch subfolder `nico-phantasie/` under `/tmp`, which is not preserved. No emulator was used. Nothing in the repo was edited or committed. Platform: P2 is two Atari ST Pasti `.stx` images (SS/DD, 720 sectors); `PHANT.PRG`, `START.PRG` and `UTILIT2.PRG` all start with `0x601A`.

## Summary verdict

- STX extraction is sound: FAT1 = FAT2 on both disks, all 59 files have exact chains, every extracted file is byte-identical to the auditor's own FAT walk.
- Wrong: the action-table terminator model (62 reachable records dropped; P2: `DNG3` 6, `DNG6` 33, `DNG7` 5, `DNG8` 2); and `DNG.SAV`/`DNGX.SAV` on disk 2 are a FAT cross-link, not two corroborating copies.
- Overstated: the sprite/picture "legible" tests cannot fail; the `stx-extraction.md` section 4 evidence is weak/circular.
- Biggest risk: the truncated action table silently loses `+Item` records and surprise encounters in `DNG6`.

## Claims confirmed

- **STX/FAT:** FAT1 equals FAT2 on both disks; all 59 files have exact chain lengths and `0xFFF` terminators with no other cross-links; every extracted file is byte-identical to the independent walk.
- **Relocations:** `PHANT.PRG`'s relocation table has 6,485 entries, all pointing into text+data+bss, ending exactly at end of file (0 trailing bytes); same for `START.PRG` and `UTILIT2.PRG`.
- **Weak-bit sector:** track 76, sector 4 is LBA 687, in cluster 336; its FAT entry is 0 (free), bytes match the doc's quoted pattern.
- **Monster tables:** name table ends exactly where the width/height table starts (`0x2114A`); all 80 sprite offsets contiguous, sum to 76,832 bytes, the exact `.PAT` size; shifting by one breaks contiguity.
- **Grid width:** 33 is the vertical-autocorrelation peak (0.671 vs at most 0.513).
- **`TWNS.INT`:** uses the same `0x98E` base as P1/P3 layout (12 town records at `0x98E + 292*i`, names at `+0x118`).
- **OUT grids:** all 17 `OUT*.DAT` terrain grids equal their `MAPS.INT` blocks byte for byte (0 differences): the outdoor grids are pristine despite the 1995 timestamps.

## Claims wrong or overstated

### 1. WRONG: the action table "ends at the first `0x0D 0x0D`"

- Docs say: `docs/phantasie/dungeon-format.md:139-152`, `:160-165`, section 7 `:310-314`; code `src/assets/formats/dungeon.ts:36-41`, `star-action.ts:177`, `tools/phantasieii/build-dungeons.ts:61` (`terminator: true`; P1 equivalent `tools/phantasie/build-dungeons.ts:44`); test `star-action.test.ts:104-118`.
- Audit: independently parsed stars, followed only bit-7 continue chains. P2: `DNG3` 6 records past the terminator, `DNG6` 33 (eight +Item records, `0x15`, `0x11` surprise encounters), `DNG7` 5, `DNG8` 2. (P1 adds `dng2` 10 and `dng4` 6; 62 in total.) Null control: the other 12 P1/P2 files have zero star references at or past their terminator.
- Star action indices are one byte, so the region is 256 slots, `0x5AA`-`0x7AA` (same fixed 512-byte table as P3); the `0x0D` fill runs to `0x794`/`0x7AC`, then authoring residue.
- Knock-on: `data-tables.md:275` (63 distinct items) and `:389` (44) undercount.
- Cited game evidence: P1 allocates 2,500 bytes (`#$9C4`) for DNG_MAP and reads with length `$9C4` (`data/phantasie/amiga/game.asm` around 9655-9700). **Unverified: the main session could not find this `$9C4` constant in `game.asm`.** It is also P1 evidence, not P2.
- Fix: fixed 256-slot zero-padded table; Correction block on section 3.1 and 7; rewrite the terminator test to assert every star reference resolves; rerun item census; TODO row.

### 2. WRONG (missed): disk 2 `DNG.SAV` and `DNGX.SAV` are a FAT cross-link

- Docs say: `docs/phantasie/stx-extraction.md:249-256` treats them as two near-identical copies of `DNG1` that corroborate each other ("differ in 10 ... differ in only 6").
- Audit (own FAT12 walk): both directory entries start at cluster 333, chain [333, 334, 335]. `DNG.SAV` is 1,024 bytes but owns a 3-cluster chain, and is exactly the first 1,024 bytes of `DNGX.SAV`. So it is one piece of evidence, not two, and `DNG.SAV`'s original content is lost.
- Fix: add a cross-link Correction to section 6.

### 3. Weak evidence in `stx-extraction.md`

- Section 4 evidence is weak: "mdir total = du total" is circular; `0x601A` tests only 2 bytes. Fix: add the FAT-walk and relocation checks (above) to section 4.
- `stx-extraction.md:136` says "both disks list an executable", but disk 2 has no `.PRG`.
- `stx-extraction.md` section 6 calls `OUT*.DAT` "inconclusive by content"; this can now be settled (see confirmed: 17/17 equal `MAPS.INT` blocks).

### 4. OVERSTATED: sprite/picture tests can't fail; cross-game oracle available

- `sprite-bank.test.ts:132-140`, `:147-151`, `:184-192`, `:199-206` assert only distinct pixel values > 1; `pic.test.ts:92-104` asserts > 2; the P2 Interleaved layout claim rests on "recognisable" renders (`graphics-formats.md:1421`).
- P1 `party1/2.pat` (Planar) versus P2 `PARTY1/2.PAT` (Interleaved, interleave 2): identical for all 32 race sprites (32,768/32,768 px). For the 49 monsters per bank shared across games, P1 `mstr1/2.pat` vs P2 `MSTR1/2.PAT` pixel-exact (98 sprites, 152,032/152,032 px). Null controls (swapped layout, neighbouring sprite): 24-69%.
- Fix: replace the non-blank asserts with cross-game pixel equality.

### 5. Stale contradictions (P2-relevant)

- P1/P2 9-byte header gap: `dungeon-format.md:341` and `src/assets/formats/dungeon.ts:23-25` still say "open"; resolved as the exit-destination table.
- `tamb.dat`: "Purpose unknown" at `dungeon-format.md:1457-1465` versus `graphics-formats.md:294`; no TODO row.

### 6. TODO hygiene

13 rows `resolved` and 2 `narrowed` against the valid set (open / escalated / blocked / deferred); solved rows should be deleted. Missing rows: `tamb.dat` format; P1/P2 dungeon trailing residue; the 5-byte pad at `out*.dat` `0x03E3`; CMP strip-overflow semantics.

## Unverified / open

- The `$9C4` buffer-size claim (finding 1): not found in the main session.
- Residue: P2 `DNG1` carries P1 `dng1`'s residue string "A STRANGE PURPLE GAS F"; nine `mess*`/`MESS*` pairs (7 distinct sizes) have identical byte sizes. Bytes past the last referenced line or slot are residue, not content. Undocumented.
- `DNG.SAV`'s original content is lost (finding 2).

## Recommended corrections (cheapest and highest-value first)

1. Fixed 256-slot action decoding for P1/P2; docs and tests (finding 1).
2. Cross-game race/monster pixel test (finding 4).
3. Cross-link note and FAT/relocation checks in `stx-extraction.md` (findings 2, 3).
4. TODO status cleanup and missing rows (finding 6).

## Checks for Cassandra to run in play

The audit lists no live-emulator checks.

## Process notes

- Tautological tests: `sprite-bank.test.ts`, `pic.test.ts`, `star-action.test.ts:104-118`; circular "mdir total = du total" in `stx-extraction.md` section 4.
- Untracked user contact sheets in `docs/phantasie/assets` left alone.
