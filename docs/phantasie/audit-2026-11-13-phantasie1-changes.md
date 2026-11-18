# Phantasie I audit (2026-11-13) — changes applied 2026-11-18

Audit page: `audit-2026-11-13-phantasie1.md`. Shared code/docs with P2/P3 (see their changes files).

| Finding | Outcome |
|---|---|
| 1. Action table is a fixed 256 slots, not "ends at first `0D0D`" | **Applied.** `star-action.ts`: new `decodeReachableActions` + `P1P2_ACTION_TABLE_SLOT_COUNT` (slot-addressed, zero-pads `dng6`); `tools/phantasie/build-dungeons.ts` and `tools/phantasieii/build-dungeons.ts` use it; `terminator` option kept, documented as legacy. Docs: Correction blocks in `dungeon-format.md` §3.1 + header table + P2 bullet, `scripting-engine.md` table-layout line and §6 census. Tests: `star-action.test.ts` rewritten (per-file drop counts P1 dng2 10 / dng4 6, all others 0; slot 190 = `93 2D 01 6B`; dng6 zero-pad; every star chain resolves). Metric re-verified: terminator walk misses 10+6 = 16 P1 records (P2 46; total 62 = audit). The audit's variable-stride "walk 256 slots" is NOT enough — a walk from slot 0 still misses 4 records (dng2 170/180/190, dng4 150) because the stride walk misaligns in the fill; records are therefore decoded at the star-named slot. Regenerated `public/assets/{phantasie/amiga,phantasieii/atarist}/dungeon-*.json` (ignored output): actions 1297 (P1) / 1174 (P2). |
| 1 (knock-on). Item cross-checks undercount | **Applied (docs).** Re-run: P1 62 distinct (legacy walk reproduces 61, **not** the documented 63; extra index is `97`), P2 56 (legacy 44; +12). Correction notes in `scripting-engine.md` and `data-tables.md`. |
| 1. `#$9C4` buffer in `game.asm` | **Not applied / unverified.** `grep` finds no `$9c4`/2500 literal in `game.asm`. Recorded as unverified in the docs; weak corroboration: P2 `DNGX.SAV` is exactly 2,500 B. |
| 2. Sprite/picture "legible" tests cannot fail; cross-game oracle | **Applied.** New `src/assets/formats/__tests__/sprite-cross-game.test.ts`: 32/32 race sprites 32,768/32,768 px identical (P1 Planar vs P2 Interleaved), 98 same-name same-size monsters 152,032/152,032 px identical; null controls (rotated race / P2 art decoded Planar) asserted < 80%. Old non-blank asserts left as labelled smoke checks (comments in `sprite-bank.test.ts`, `pic.test.ts`). `.pic` still has no cross-game oracle (noted). `graphics-formats.md` §8 rows upgraded. |
| 3. Stale: header gap "open" | **Applied.** `dungeon.ts` comment, `dungeon-format.md` P2 bullet (inline correction). |
| 3. Stale: P1 palette entry 12 "outlier" | **Applied.** Correction in `data-tables.md` §2.3 block. |
| 3. `tamb.dat` "purpose unknown" | **Applied.** Note in `dungeon-format.md` §8.5; TODO `tamb-dat-format`. |
| 4. TODO hygiene | **Applied.** 13 `resolved` rows deleted, 2 `narrowed` -> `open`; rows added: `tamb-dat-format`, `dng-p1p2-trailing-residue`, `dng-p1p2-action-goto-reach`, `outdat-p1p2-pad-0x03e3`, `cmp-strip-overflow`, `p3-dng-template-names`, `p2-dng-sav-lost`. |
| Recommended 5: trace `tamb.dat` consumer | **Deferred** -> TODO `tamb-dat-format`. |

Tests: `npx vitest run` 40 files / 539 tests pass; `npx tsc --noEmit` clean; eslint clean on touched dirs.
Disagreements: the doc's "63" P1 item count does not reproduce (61 legacy). No other.
In-game checks for Cassandra: none from the audit; optionally confirm in P1 `dng2` that the `+Item`/`0x13` records at slots 170/180/190 are triggered by a star.
User WIP left alone: `docs/phantasie/assets/party-roster-*contact-sheet*.png`.
