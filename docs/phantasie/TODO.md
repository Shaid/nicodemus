# Phantasie — Open Work

Single status surface for everything still open across the Phantasie
docs. See the linked doc section for full evidence and paths-tried detail
— this table is pointers only.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| gfx-pic-palette | open | Find the real in-game palette for `.pic` full-screen pictures (P1 Amiga); only a P1 monster/race palette is confirmed, not a screen palette | `graphics-formats.md` §3, §9 | 2026-08-02 game-re |
| gfx-set-map-semantics | open | Decode the `.SET` world-map array's byte→terrain-panel meaning (P3) | `graphics-formats.md` §5.3, §9 | 2026-08-02 game-re |
| gfx-set-unknown-byte | open | Identify `.SET`'s leading unknown header byte (`0xFA` observed) | `graphics-formats.md` §9 | 2026-08-02 game-re |
| gfx-cmp-spriteindex-table | open | Independently re-derive/cross-check the P3 monster `spriteIndex`→bank/cell mapping table (currently source-transcribed only) | `graphics-formats.md` §6, §9 | 2026-08-02 game-re |
| data-p3-race-offsets | open | Locate P3 race name / bank-sprite-index table offsets in the Amiga `PhantasieIII` executable (reference source only has ST offsets, both raw and hunk-adjusted attempts against the Amiga binary failed) | `data-tables.md` §4, §8 | 2026-08-02 game-re |
| data-p3-inititem-fields | open | Determine `inititem.dat` field semantics (record stride/count confirmed structurally; no reference source exists for this file) | `data-tables.md` §6, §8 | 2026-08-02 game-re |
| data-p3-monster-item-names | open | Find the weapon/armor/spell/item name tables that `monsinfo.dat`'s index fields reference | `data-tables.md` §3.1, §8 | 2026-08-02 game-re |
| data-p3-skills-anomaly | open | Explain the anomalous 15th-level byte in several P3 skills-table classes (breaks otherwise-clean monotonic progression) | `data-tables.md` §5.2, §8 | 2026-08-02 game-re |
| p2-out-dat-save-status | open | Determine whether P2's `OUT*.DAT` files (1995-dated) are save-mutated or pristine content — unlike `DNG.SAV`/`GUILD.DAT`/`SACK.DAT`/`TWNS.DAT`, no conclusive byte-level evidence either way was found, only the suspicious timestamp | `stx-extraction.md` §6, §8 | 2026-08-02 game-re |
| data-p1-hunk-addressing | deferred:worked for every offset actually needed this pass | Root-cause why raw file offsets into the 240-hunk `game` executable work directly (hunk 0 alone is too small to hold any of the confirmed tables) | `data-tables.md` §8 | 2026-08-02 game-re |
