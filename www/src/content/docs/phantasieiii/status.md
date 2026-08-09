---
title: Status & Open Work
description: Every genuinely open question about Phantasie III's formats, mirroring the repo's single status surface, docs/phantasie/TODO.md.
---

This page mirrors the repo's single status surface, `docs/phantasie/TODO.md`,
filtered to the rows that concern Phantasie III specifically. Every genuinely
open item gets one row here, phrased as a question; the full evidence and
paths-tried tables live in the raw notes linked from each row.

## Open items

| ID | Status | Question |
|----|--------|----------|
| `gfx-set-unknown-byte` | open | What is `.SET`'s leading header byte (`0xFA` in `phantasy.set`)? Simple checksums (sum/XOR of the map array, the picture data, the whole file) were tested and ruled out this session. Only one `.set` file exists in the corpus and no `.set`-consuming code has been located in `PhantasieIII` to trace it from the code side. |
| `gfx-set-map-semantics` (row of the same investigation) | confirmed hypothesis | Which row of `.SET`'s picture region does the real game sample to render a map cell's terrain? The column-index scheme itself is confirmed (frequency-distribution and picture-column evidence — see [Graphics Formats](../../phantasieiii/graphics/)), but the exact row wasn't determined: no `.set`-consuming render code was found, only a generic resource-init call site near the file's one `"Graphics/Phantasy.set"` string reference. |
| `data-p3-race-sprite-index` | open | Which sprite-bank cell does each of the 18 races actually use? The race *name* table is resolved ([Data Tables](../../phantasieiii/data-tables/)), but the parallel sprite-index table wasn't located — three distinct search approaches (numeric structural scan, race-name-table xref scan, bank-filename-block xref scan) all came back empty. Races currently render using race index directly as the bank-0 cell index, an **unverified identity-mapping assumption**, not a located table. |
| `data-p3-inititem-fields` | open | What do `inititem.dat`'s 18 per-record fields actually mean? The record shape (181 records × 18 bytes) is confirmed via a hardcoded save/load length in `PhantasieIII` itself, but no field has a confirmed semantic. This session's full 181-row correlation pass found the nonzero values are heavily discretized (four values — `1`, `5`, `200`, `99` — cover 83% of all nonzero reads) and cluster in the item table's middle range (first nonzero row is index 10, last is index 148; both ends are entirely zero) — real structural findings, but no semantic label. A race-count coincidence (18 columns = 18 races) was tested and found no supporting correlation. |
| `data-p3-skills-anomaly` | open | Are the level-15 skill-table anomalies (Ranger in 6 of 8 skills, one each for Wizard and Monk) intentional per-class design or an SSI data-entry error from 1987? The *mechanism* is confirmed by disassembly — a plain static-table read (`class*15 + level - 1`), level clamped to a maximum of 15, no runtime special-case branch at 15 — which rules out a coding bug. Whether the specific anomalous byte values were deliberate is not resolvable from code alone; no developer source or errata exists to check against. |
| `scripting-p3-charrecord-field-names` | open (narrowed) | Do the 9 confirmed on-screen skill-pair names (Attack, Parry, Swimming, Listen, Find Trap, Disarm Trap, Find Item, Pick Lock, Fire Bow) bind to the character record's `+0x30`-`+0x53` offsets in that exact order? Pair 0 (Attack) is independently confirmed via the combat-formula trace; the remaining 8 pairs are a strong hypothesis, not disassembly-confirmed — the character-sheet draw routine's own field-read loop wasn't isolated from the 83 other xref sites on the `$5174`/`$3D0A` bases (14 at `$5174` — roster management, save/load; 69 at `$3D0A` — overwhelmingly the already-traced combat setup loops) in the time available. |
| `scripting-p3-ramp-table-semantics` | tested and refuted (still open) | What is the 202-byte lookup table at hunk 1 `+0x0F10` (file `0x287D8`) actually for? Its location and content are confirmed (pure concatenated arithmetic ramps), and this session tested it byte-exact against the SSI manual's own HP-by-class-and-level and MP-by-class-and-level charts — no match at any offset or scale, because neither chart is a constant-slope progression. That specific hypothesis is closed; the table's real role is still open. |

## Closed (accepted as final)

| Item | Result |
|------|--------|
| `.SET`'s picture-region byte order | **Confirmed and fixed.** The picture data is stored column-block-major, not row-major — `remapSetPictureBytes()` corrects it, with a smoothness-metric regression test guarding the fix. See [Graphics Formats](../../phantasieiii/graphics/). |
| `monsinfo.dat`'s "Weapon"/"Armor" fields | **Confirmed as raw combat-power ratings, not item-table indices.** An 80-monster Pearson-correlation pass against already-confirmed combat stats found `r` up to 0.96, the opposite of what an item-catalogue index would show. Renamed `weaponRating`/`armorRating`. See [Data Tables](../../phantasieiii/data-tables/). |
| Monster `spriteIndex` → bank/cell dispatcher | **Confirmed byte-exact via direct disassembly** (`0x1B4F0`-`0x1B6E2`). This also **corrects** two previously-documented single-value special cases (`spriteIndex==48`/`==65`) that turn out not to exist in the real function — both values are clamped to 48 and fall back to bank 2 cell 14. See [Graphics Formats](../../phantasieiii/graphics/). |
| 18-race count mismatch | **Resolved.** The 18th name, `"Random"`, is a character-creation menu option, not a lore race: 16 (shared with P1/P2) + Elemental + Random = 18. |
| Item table (indices 1-120) vs. the SSI 1987 manual | **117/120 exact match.** One cosmetic spelling difference (`God Armour`/`God Armor`) and one genuine, non-cosmetic divergence: the game's own bytes name items 81/82 `Dagger +1`/`Dagger +2`; the manual's catalogue calls the same item numbers `Knife +1`/`Knife +2`. The game's own bytes are treated as authoritative; the discrepancy is documented, not silently resolved either way. See [Data Tables](../../phantasieiii/data-tables/). |
| Spell table (indices 1-57) vs. the SSI 1987 manual | **55/55 exact match** against the manual's own printed table (indices 1-52, 54-56), plus independent confirmation of the two indices the printed table omits: spell 53 (`Vision`) via the manual's own body text explaining why it has no player-facing effect, and spell 57 (`Divine Aid`) via the manual's "Divine Spells (#57+)" passage and an independent opcode `0x19` cross-reference. |
| Combat RNG | **Confirmed as a distinct LCG from Phantasie I's**: `seed = (seed*25173+13849) mod 65536`, wrapped by a `Random(range)` helper, disassembly-verified end to end. |
| `$2Axx`/`$3Dxx` "lookup tables" | **Confirmed to be runtime BSS variables, not stored tables.** `PhantasieIII`'s DATA hunk is a SAS/C merged data+bss section — only 10,108 of its declared 27,404 bytes are actually stored in the file; the rest is the zero-filled BSS tail, populated per-combat from the character records. Independently corroborated by a byte-exact 11,812-byte match against `gamesave.dat`. |
| Body-location damage hypothesis (Head/Torso/L-Arm/R-Arm/L-Leg/R-Leg) | **Tested and refuted** against the only candidate fields available (Phantasie I's `+0x146`/`+0x138`/`+0x132`) — those fields are indexed only by character, not by body location, and their read pattern (a base-10 `group*10+slot` split) has no natural relationship to 6 locations × 4 states. No P3-specific equivalent field was found to test the hypothesis against directly. |

## Where to read the full evidence

- `docs/phantasie/graphics-formats.md` §4-§6 — the `.CMP`/`.CSH`/`.SET`
  format specs and the `.SET` remap-bug story.
- `docs/phantasie/data-tables.md` §3-§6 — `monsinfo.dat`, the skills table,
  the race table, the item/spell manual cross-checks, and `inititem.dat`'s
  open status.
- `docs/phantasie/scripting-engine.md` §5, §7.5-§7.5.2 — P3's opcode set,
  the RNG and combat formulas, the merged-BSS finding, and the
  character-record field names.
- `docs/phantasie/TODO.md` — the single-surface index this page filters.
