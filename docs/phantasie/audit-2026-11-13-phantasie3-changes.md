# Phantasie III audit (2026-11-13) — changes applied 2026-11-18

Audit page: `audit-2026-11-13-phantasie3.md`.

| Finding | Outcome |
|---|---|
| 1. P3 opcode `0x12` "no alive filter" | **Applied; re-verified from bytes.** `PhantasieIII+0x1CCF4`: `c1fc 0106` (muls #$106), `41f9 00003d36` (lea $3D36), `4a70 0800` (tst.w (a0,d0.l)) at `0x1CCFE`, then `beq` -> members with Status word `char.+0x2C == 0` are skipped. `opcodes.ts` description + comment fixed (+ a test assertion in `opcodes.test.ts`), `scripting-engine.md` §5 correction blocks. The "resolved" TODO row `scripting-p2p3-stat-opcode-path` deleted; its P3 residue merged into the existing open row `scripting-p3-opcode12-special-cases` (special-cased statIndex arms and `GetCharBase+8` still to fold into the spec). Note: P3 `0x13`'s `opcodes.ts` description says "living members"; the doc says no filter there — not re-checked, left as is. |
| 2. Stale dungeon-letter order | **Applied.** `dungeon-format.md` §2 table row corrected (resolved by §9.0.5.4: `J H E D A C B K I F G` at `0x29B74`). |
| 3. Stale `.set` map-cell meaning | **Applied.** Correction in `graphics-formats.md` open-question bullet; §8 confidence row updated (tile index into 250-entry bank). |
| 4. CMP strip-2 overflow in `w4.cmp` | **Applied (docs).** Verified in code that `cmp.ts` writes the overshoot byte over the strip's last position; note in `graphics-formats.md` header table; TODO `cmp-strip-overflow`. Not re-run on `w4.cmp` bytes. |
| 5. "58/58 filler" inflated | **Applied.** Restated to ~27 independent points in `dungeon-format.md`. |
| 6. Weak sprite/pic tests | **Applied** (family-wide, see P1 changes); no P3 oracle added. |
| 7. P1/P2 terminator error not applicable to P3 | **No change needed** (P3 already uses a fixed table). |
| 8. TODO hygiene; `D/DNPX`, `D/9` templates | **Applied.** TODO `p3-dng-template-names`. |
| Undocumented: `dngj.dat` == `dngk.dat` | **Applied** (note in `dungeon-format.md` §2 table; not byte-compared again this session). |

Tests: full suite 539 pass; `tsc --noEmit` clean. In-game checks for Cassandra: a P3 party containing a dead member (Status 0) hit by a `0x12` script record should NOT have its stat set.
