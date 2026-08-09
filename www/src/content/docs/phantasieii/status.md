---
title: Status & Open Work
description: What's solved and what's still open for Phantasie II, mirroring the repo's single status surface.
---

This page mirrors the repo's single status surface, `docs/phantasie/TODO.md`,
filtered to what's genuinely open for Phantasie II specifically. As of this
writing `TODO.md` carries no open rows scoped to Phantasie II — every row
currently there is Phantasie I or III work. The open items below come from
the "still unexplored"/"not traced this pass" notes inside
`stx-extraction.md`, `dungeon-format.md` §7, and `scripting-engine.md` §7.4;
the full evidence for each lives in those files.

## Open items

| ID | Status | Question (one line) |
|----|--------|---------------------|
| `p2-rsc-format` | open | `PHANT.RSC`, `OUT.RSC`, `BACKUP.RSC` are standard Atari ST GEM resource files (dialog/menu definitions) — a file type not previously encountered in this project. Unexplored; likely low gameplay value but may carry UI text strings. |
| `p2-maps-twns-int-structure` | open | `MAPS.INT` (8,840 B) and `TWNS.INT` (13,900 B) are P2's likely equivalents of P1's `maps.int`/`twns.int`, but sizes differ from P1's own (`twns.int` is 13,000 B in P1). `TWNS.INT`'s town-name-list *content* is confirmed byte-identical to `TWNS.DAT`'s save-state snapshot, but its full per-town record structure (shop inventories, prices) is not decoded. |
| `p2-action-table-trailing-region` | open | Every real `DNG1`-`DNG8` file is a uniform 2,048 bytes, larger than P1's variable 1,922-1,984 bytes, even though the action-table terminator lands in the same `0x6CC`-`0x736` range as P1's. The extra ~65-125 bytes per file most likely sit after the terminator, in the same kind of "leftover/unused region" P1's files carry — not independently investigated for P2. |
| `p2-header-gap-0x04f2` | open | The 9-byte gap at header offset `0x04F2`-`0x04FA`, between the fixed-encounter table and the star table, is unidentified in both P1 and P2. Not read by the shared engine's parser; sample bytes observed but no consumer traced for either game. |
| `p2-monster-attacks-player-rng` | open | Only the party-attacks-monster combat direction was traced for Phantasie II this session (to-hit, damage, and the RNG algorithm all confirmed). The monster-attacks-player mirror direction — traced for Phantasie I (§7.3) — was not traced for Phantasie II; a reasonable next step given how directly P1's template has transferred so far. |

## Closed (accepted as final)

| Item | Result |
|------|--------|
| `.stx` container desectorization | Both floppy images fully reconstructed and verified: BPB self-consistency, independent STX-side-count vs. BPB-head-count cross-check, and `PHANT.PRG`'s byte-exact `0x60 0x1A` GEMDOS magic. Zero RNF sectors on either disk; one fuzzy-bit sector on Disk 2 (track 76/sector 4) confirmed to fall outside every extracted file's data. |
| `.PAT` sprite-bank bitplane layout | Confirmed **ST word-interleaved** (interleave = 2) for all four files — `MSTR1.PAT`, `MSTR2.PAT`, `PARTY1.PAT`, `PARTY2.PAT` — by rendering real data under both candidate layouts and checking which produced legible art. This corrects an earlier size-match-based hypothesis that `PARTY*.PAT`'s byte-exact size match with P1's planar-layout files might mean it kept P1's layout too — it doesn't. |
| Executable data tables (`PHANT.PRG`) | Monster names (80), monster sprite offset/dimension tables, palette (16 colours), race names (16), item names (181) all confirmed byte-exact at the reference source's original offsets, with zero adjustment needed. |
| Dungeon/message decode (`DNG1`-`DNG8`/`MESS1`-`MESS8`) | All 8 dungeon files and all 8 message files decode with zero failures under the shared P1/P2 engine, at the same header offsets as Phantasie I. |
| P2-exclusive opcodes `0x14`-`0x17` | Confirmed present and actively used in real shipped content (`DNG8`'s maximum observed opcode is `0x17`, the win-condition marker) — not just a static gate that happens to never fire. Cross-checked against all 10 real Phantasie I files: P1's maximum opcode never exceeds `0x13`. |
| Combat to-hit/damage formula and RNG (party-attacks-monster direction) | Fully confirmed: same formula shape, field offsets, and constants as Phantasie I, but a genuinely different RNG algorithm — a 7-word additive/rotating generator (`$1AD22`) reached via `JSR $FD40` at logical address `0x8706`, not Phantasie I's linear congruential generator. |
| `.PIC` full-screen picture format | **Resolved.** All 6 files (`COVER1.PIC`, `COVER2.PIC`, `PELNOR.PIC`, `DECOR.PIC`, `FINAL2.PIC`, `CROWD.PIC`) decode via the same ST word-Interleaved layout as `.PAT`, each with a disassembly-traced `Setpalette` source across `START.PRG`/`PHANT.PRG` — no reference-tool source existed for this format at all. See [Screens](../../phantasieii/screens/) and `docs/phantasie/graphics-formats.md` §10. |
| Disk 2 save-vs-pristine question | **Resolved.** `DNG.SAV`/`DNGX.SAV` are confirmed live in-memory dungeon state (near-byte-identical to `DNG1`, with every differing byte matching the documented interpreter's play-state changes). `GUILD.DAT`/`SACK.DAT` are confirmed playthrough-specific (player-chosen character names; an all-zero save-state inventory). `TWNS.DAT` is a compact save-state snapshot, structurally distinct from — but content-consistent with — the pristine `TWNS.INT` template. `OUT*.DAT` (17 files, sparse numbering 1-31) is confirmed save-mutated by three independent lines of evidence: the gapped numbering itself, a ten-file shared-garbage block at a fixed offset, and `OUT1.DAT` embedding literal GEMDOS directory-entry records for real files on the same disk. |

## Where to read the full evidence

- `docs/phantasie/stx-extraction.md` — the extraction method, file inventory,
  and the full save-vs-pristine evidence chain.
- `docs/phantasie/graphics-formats.md` §9 — the `.PAT` layout render
  comparison.
- `docs/phantasie/graphics-formats.md` §10 — the `.PIC` full-screen
  picture layout and per-file palette trace.
- `docs/phantasie/data-tables.md` §2 — the executable table offsets.
- `docs/phantasie/dungeon-format.md` §7 — the dungeon/message decode against
  real P2 files.
- `docs/phantasie/scripting-engine.md` §5, §7.4 — the P2-exclusive opcodes
  and the combat/RNG trace.
- `docs/phantasie/TODO.md` — the single status surface for open work across
  all three games.
