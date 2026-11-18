# Phantasie III (Amiga) data-claims audit, 2026-11-13

Changes applied: see `audit-2026-11-13-phantasie3-changes.md`.

Report-only audit, 2026-11-13. None of these corrections have been applied yet.

Run as an independent codebreaker re-derivation of the Phantasie I/II/III data claims against the retail bytes, using the auditor's own Python rather than the repo decoders. This page covers Phantasie III; sibling pages: `audit-2026-11-13-phantasie1.md`, `audit-2026-11-13-phantasie2.md`. Provenance only: the auditor's probe scripts (`pad.py`, `stars.py`, `fat12.py`; the rest were run inline) lived in the session scratch subfolder `nico-phantasie/` under `/tmp`, which is not preserved. No emulator was used. Nothing in the repo was edited or committed. Platform: P3 `PhantasieIII` is an AmigaOS HUNK executable with 3 hunks; hunk 1 data starts at file `0x278C8`, and only 10,108 of its declared 27,404 bytes are stored.

## Summary verdict

- Message pointers, dungeon-letter table, `twns.int`, `monsinfo.dat` and most CMP containers check out.
- Wrong: a "resolved" TODO row says P3 opcode `0x12` has "no alive filter"; the bytes show a status filter.
- Stale: P3 dungeon letter order doc, `.set` map-cell meaning.
- Overstated: the CMP "exactly 32,000 bytes, 8,000 per strip" claim (one strip overshoots), and the "58/58 filler" count (about 27 independent points).
- The P1/P2 action-table terminator error does not apply to P3: P3 already uses a fixed 512-byte table.

## Claims confirmed

- **P3 grid width:** 24 is the autocorrelation peak (0.597 versus at most 0.428).
- **Message pointers:** big-endian with a `0x800` bias; all 352 non-zero pointers across 11 files land on string starts, none out of range; all text ends before the 4,224-byte read length.
- **Dungeon-letter table:** `J H E D A C B K I F G` at file `0x29B74`.
- **`twns.int`:** eight regions sum to 13,000 bytes; 12 town records at `0x98E + 292*i`, names at `+0x118`.
- **`monsinfo.dat`:** 38-byte stride (80/80 records start with a capital letter, at most 11 for strides 36, 37, 39, 40); `0x60` filler consistent with the padding rule.
- **CMP containers:** header `0x22 + compressedSize`, stream end and padding-rule length agree on 17/18 files (`D/w4.cmp` is the exception, finding 4).
- **Filler rule (P3 only):** "filler byte = content length mod 128" reproduced 58/58 (but see finding 5). P1/P2 files mostly do not follow it.

## Claims wrong or overstated

### 1. WRONG: a "resolved" TODO row says P3 opcode `0x12` has "no alive filter, all occupied slots"

- Where: TODO row `scripting-p2p3-stat-opcode-path`, and `src/assets/formats/opcodes.ts:351-353`. It contradicts the open row `scripting-p3-opcode12-special-cases`.
- Bytes at `PhantasieIII` file `0x1CCBE`: the loop counter `-8(a5)` is bounded by `cmp.w $2850` / `blt` (party count) at about `0x1CDBA`. Inside the loop, `muls #$106` / `lea $3D36` / `tst.w (a0,d0.l)` / `beq` (`0x1CCF6`-`0x1CD02`) skips members whose `$3D0A + i*0x106 + 0x2C` (Status) is 0. Occupancy is already handled by the loop bound; the extra test is a status filter. Status 0 is plausibly "dead": Resurrection sets Status to 1 (`spell-format.md:369`).
- Fix: re-open or fix the resolved row; fix the `opcodes.ts` description and sections 5/6.3(b); merge the two rows.

### 2. STALE: P3 dungeon letter order

`dungeon-format.md:53` says the a-k order is "assumed ... not independently confirmed" and that files were "renamed from dng0..dng10". Section 9.0.5.4 has resolved this: the word table at file `0x29B74` is `J H E D A C B K I F G`, and the exe builds names from the `D/DNGX.DAT` letter template, so the letters are original, not renamed. Fix row 53.

### 3. STALE: `.set` map-cell meaning

`graphics-formats.md:1455` still says each map cell is an "X pixel-column index", and the section 8 table at `:1434` still says "hypothesis". Both are superseded by the tile-index correction (TODO `world-p3-map-pipeline`).

### 4. OVERSTATED (minor): "every CMP decompresses to exactly 32,000 bytes, 8,000 per strip"

- Claim: `graphics-formats.md:434` and section 4.2.
- Evidence: in `D/w4.cmp`, strip 2 takes 8,001 bytes because one run overshoots. The stream still ends exactly at the header-declared 17,277 bytes. `cmp.ts:150-153` silently writes the extra byte over the strip's last position. What the real game does with the overflow is not traced; at most one byte is affected. The other 17 files show exact three-way agreement.
- Fix: add a note and a TODO row.

### 5. CONFIRMED but inflated: "filler byte = content length mod 128, 58/58"

At `dungeon-format.md:2951`. Reproduced 58/58, but the 11 `dng*.dat` files pass trivially (content is the whole file, ending in a 128-byte zero tail), and the 20 `s*` files are one identical case, leaving about 27 independent data points. P3-only. Fix: restate the count.

### 6. Overstated tests (family-wide, applies to P3 consumers)

`sprite-bank.test.ts:132-140`, `:147-151`, `:184-192`, `:199-206` assert distinct pixel values > 1 and `pic.test.ts:92-104` > 2; random bytes pass. The cross-game P1/P2 pixel-equality oracle (32/32 race sprites, 98 monsters, 152,032/152,032 px, null controls 24-69%) is described on the P1/P2 pages; it does not directly cover P3 sprites.

### 7. Not applicable to P3: action-table terminator

The P1/P2 "ends at first `0x0D 0x0D`" error does not affect P3: star action indices are one byte, giving 256 slots (`0x5AA`-`0x7AA`), the same fixed 512-byte table P3 uses. The P3 loader is not implicated.

### 8. TODO hygiene

13 rows `resolved` and 2 `narrowed` against the valid statuses (open / escalated / blocked / deferred). Missing rows relevant to P3: the P3 `D/DNPX` and `D/9` filename templates (no file ships) and the CMP strip-overflow semantics (finding 4).

## Unverified / open

- What the real game does with the `w4.cmp` strip-2 overflow byte.
- The `D/DNPX` and `D/9` templates: no shipped file.
- Note: a claim about a `$9C4` DNG_MAP buffer constant in `game.asm` appears in the P1 page; the main session could not find it, and it is P1-specific.

## Undocumented structure

P3 `dngj.dat` and `dngk.dat` are byte-identical: dungeon 1 ("small straw hut") and dungeon 8 ("cave which smells of sulfur"). The shared file's message table has both room names (messages 20 and 21), so it looks like a deliberate shared file. Fix: document it.

## Recommended corrections (cheapest and highest-value first)

1. Fix P3 opcode `0x12` in `opcodes.ts` and the TODO (finding 1).
2. Fix stale docs: dungeon letter order and `.set` meaning (findings 2, 3).
3. Add the CMP overflow note and row; restate the filler count (findings 4, 5).
4. TODO status cleanup and missing rows (finding 8); document `dngj`=`dngk`.

## Checks for Cassandra to run in play

The audit lists no live-emulator checks.

## Process notes

- Tautological tests: `sprite-bank.test.ts`, `pic.test.ts`.
- TODO file violates its own status contract.
- Untracked user contact sheets in `docs/phantasie/assets` left alone.
