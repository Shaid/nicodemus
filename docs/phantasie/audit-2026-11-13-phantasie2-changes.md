# Phantasie II audit (2026-11-13) — changes applied 2026-11-18

Audit page: `audit-2026-11-13-phantasie2.md`. Code/doc changes for the shared action-table and sprite-test findings are described in `audit-2026-11-13-phantasie1-changes.md`.

| Finding | Outcome |
|---|---|
| 1. Action table terminator model (P2: `DNG3` 6, `DNG6` 33, `DNG7` 5, `DNG8` 2) | **Applied** (shared fix). `star-action.test.ts` asserts the 6/33/5/2 = 46 drops, all other P2 files 0, and every new record's opcode is in `P2_OPCODES`; `tools/phantasieii/build-dungeons.ts` regenerated (1174 actions). P2 item census 44 -> 56 distinct (max 176). |
| 2. `DNG.SAV`/`DNGX.SAV` FAT cross-link | **Applied; re-verified.** Own FAT12 walk of `raw/disk2.st`: both start cluster 333, chain [333,334,335]; `DNG.SAV` (1,024 B) == `DNGX.SAV[0:1024]`. Correction block in `stx-extraction.md` §6; new test `p2-disk-integrity.test.ts` (with null control). TODO `p2-dng-sav-lost` (deferred). |
| 3. Weak/circular §4 evidence | **Applied.** FAT-walk + relocation checks added to `stx-extraction.md` §4 (FAT1==FAT2 and chain lengths re-run by test; relocation-table facts are the auditor's, not re-run). "both disks list an executable" corrected (disk 2 has no `.PRG`, verified). |
| 3. `OUT*.DAT` "inconclusive" | **Applied; re-verified.** First 520 B of 17/17 `OUT*.DAT` equal 17 distinct 520-B `MAPS.INT` blocks (8,840 = 17x520); 1-byte-shift null control 0/17. Correction in `stx-extraction.md` §6; asserted in `p2-disk-integrity.test.ts`. |
| 4. Sprite/picture tests can't fail | **Applied** (see P1 changes: `sprite-cross-game.test.ts`). |
| 5. Stale: header gap, `tamb.dat` | **Applied** (see P1 changes). |
| 6. TODO hygiene | **Applied** (see P1 changes). |
| Weak-bit sector, relocation entries, STX tail | **No change needed** (confirmed claims; auditor's relocation counts not independently re-run). |

Tests: full suite 539 pass; `tsc --noEmit` clean. In-game checks: none.
