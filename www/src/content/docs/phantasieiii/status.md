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
| `gfx-set-unknown-byte` | open | What is `.SET`'s leading header byte (`0xFA` in `phantasy.set`)? Simple checksums (sum/XOR of the map array, the picture data, the whole file) were tested and ruled out this session. Only one `.set` file exists in the corpus. The loader **has** since been found (addr `0x27D8`), and it settles the question as far as this executable can answer it: the byte is read into a stack local that is never loaded, compared, stored or passed anywhere. Whatever it meant to the authoring tool, the Amiga build ignores it entirely — there is no behaviour left to test a checksum or version hypothesis against. |
| `gfx-set-map-semantics` | **resolved** | Was: "which row of `.SET`'s picture region does the game sample per map cell?" The question dissolved once the tile blitter at addr `0x3834` was disassembled — it samples no row. The map byte is a **tile index** into a 250-entry 16 × 16 × 4bpp bank (the picture region, addressed at `value × 128`), and the blitter copies all 16 rows. The earlier pixel-column reading is superseded. See [Graphics Formats](../../phantasieiii/graphics/). |
| `scripting-p3-charrecord-field-names` | open (narrowed) | Do the 9 confirmed on-screen skill-pair names (Attack, Parry, Swimming, Listen, Find Trap, Disarm Trap, Find Item, Pick Lock, Fire Bow) bind to the character record's `+0x30`-`+0x53` offsets in that exact order? Pair 0 (Attack) is independently confirmed via the combat-formula trace; the remaining 8 pairs are a strong hypothesis, not disassembly-confirmed — the character-sheet draw routine's own field-read loop wasn't isolated from the 83 other xref sites on the `$5174`/`$3D0A` bases (14 at `$5174` — roster management, save/load; 69 at `$3D0A` — overwhelmingly the already-traced combat setup loops) in the time available. |
| `scripting-p3-ramp-table-semantics` | tested and refuted (still open) | What is the 202-byte lookup table at hunk 1 `+0x0F10` (file `0x287D8`) actually for? Its location and content are confirmed (pure concatenated arithmetic ramps), and this session tested it byte-exact against the SSI manual's own HP-by-class-and-level and MP-by-class-and-level charts — no match at any offset or scale, because neither chart is a constant-slope progression. That specific hypothesis is closed; the table's real role is still open. |

## Closed (accepted as final)

| Item | Result |
|------|--------|
| `.SET`'s picture-region byte order | **Confirmed and fixed.** The region is stored tile-major: 250 consecutive 128-byte 16 × 16 × 4bpp tiles, which `decodeSetTiles()` splits directly. Viewed instead as one 320 × 200 screen buffer it is column-block-major rather than row-major, which `remapSetPictureBytes()` corrects — but that view cuts a tile in half at every other strip boundary and is not the terrain art. See [Graphics Formats](../../phantasieiii/graphics/). |
| `monsinfo.dat`'s "Weapon"/"Armor" fields | **Confirmed as raw combat-power ratings, not item-table indices.** An 80-monster Pearson-correlation pass against already-confirmed combat stats found `r` up to 0.96, the opposite of what an item-catalogue index would show. Renamed `weaponRating`/`armorRating`. See [Data Tables](../../phantasieiii/data-tables/). |
| Monster `spriteIndex` → bank/cell dispatcher | **Confirmed byte-exact via direct disassembly** (`0x1B4F0`-`0x1B6E2`). This also **corrects** two previously-documented single-value special cases (`spriteIndex==48`/`==65`) that turn out not to exist in the real function — both values are clamped to 48 and fall back to bank 2 cell 14. See [Graphics Formats](../../phantasieiii/graphics/). |
| 18-race count mismatch | **Resolved.** The 18th name, `"Random"`, is a character-creation menu option, not a lore race: 16 (shared with P1/P2) + Elemental + Random = 18. |
| Item table (indices 1-120) vs. the SSI 1987 manual | **117/120 exact match.** One cosmetic spelling difference (`God Armour`/`God Armor`) and one genuine, non-cosmetic divergence: the game's own bytes name items 81/82 `Dagger +1`/`Dagger +2`; the manual's catalogue calls the same item numbers `Knife +1`/`Knife +2`. The game's own bytes are treated as authoritative; the discrepancy is documented, not silently resolved either way. See [Data Tables](../../phantasieiii/data-tables/). |
| Spell table (indices 1-57) vs. the SSI 1987 manual | **55/55 exact match** against the manual's own printed table (indices 1-52, 54-56), plus independent confirmation of the two indices the printed table omits: spell 53 (`Vision`) via the manual's own body text explaining why it has no player-facing effect, and spell 57 (`Divine Aid`) via the manual's "Divine Spells (#57+)" passage and an independent opcode `0x19` cross-reference. |
| Combat RNG | **Confirmed as a distinct LCG from Phantasie I's**: `seed = (seed*25173+13849) mod 65536`, wrapped by a `Random(range)` helper, disassembly-verified end to end. |
| `$2Axx`/`$3Dxx` "lookup tables" | **Confirmed to be runtime BSS variables, not stored tables.** `PhantasieIII`'s DATA hunk is a SAS/C merged data+bss section — only 10,108 of its declared 27,404 bytes are actually stored in the file; the rest is the zero-filled BSS tail, populated per-combat from the character records. Independently corroborated by a byte-exact 11,812-byte match against `gamesave.dat`. |
| Body-location damage hypothesis (Head/Torso/L-Arm/R-Arm/L-Leg/R-Leg) | **Tested and refuted** against the only candidate fields available (Phantasie I's `+0x146`/`+0x138`/`+0x132`) — those fields are indexed only by character, not by body location, and their read pattern (a base-10 `group*10+slot` split) has no natural relationship to 6 locations × 4 states. No P3-specific equivalent field was found to test the hypothesis against directly. |
| Race → sprite-bank-cell table | **Located and confirmed** (superseding the earlier "not located, three approaches failed" entry above). 19 bytes at file `0x299D8`, found by disassembling the party-sprite cell extractor at `0x1B2DA` rather than searching for the table's own shape. **Not** an identity mapping — 6 of 18 races share a cell with another race (e.g. Halfling reuses Gnome's cell, Pixie/Sprite share one). Confirmed against 13 rendered `heros.cmp` cell crops, 13/13 visually matching the assigned race. Browsable in the [race table](#the-race-table) above. |
| `inititem.dat`'s 18 "fields" | **Resolved — the array orientation was transposed.** The file is `stock[18 armouries][181 item ids]`, not 181 records of 18 fields: byte 0 of each 181-byte row is that armoury's distinct-item count, reproducing the counted nonzero bytes 18/18 with zero deviations. Found by disassembling the armoury-stock builder at file `0x8B5A`. This retro-explains every earlier structural finding — the `{1, 5, 99, 200}` discretized value set is stock *quantities*, the all-zero range is the item-id range no shop stocks, and "18 columns" is the armoury count (matching the 18-entry markup table in the [item table](#the-item-table-executable-embedded-181-entries) above), not a race-count coincidence. |
| Skills table's level-15 anomalies | **Closed as undecidable from available sources**, not left open. The read mechanism is disassembly-confirmed correct (a plain static-table lookup, no special case at level 15), and two *interior* (non-level-15) typos plus a provably 89-byte `Parry` array establish this data block genuinely contains 1987 data-entry errors — but no source exists (the SSI manual has no per-class skill chart at any level) to say which specific level-15 bytes are among them. |

## Where to read the full evidence

- `docs/phantasie/graphics-formats.md` §4-§6 — the `.CMP`/`.CSH`/`.SET`
  format specs and the `.SET` remap-bug story.
- `docs/phantasie/data-tables.md` §3-§7 — `monsinfo.dat`, the skills table,
  the race table (including the sprite-cell mapping), the item/spell manual
  cross-checks, and `inititem.dat`'s resolved armoury-stock format.
- `docs/phantasie/scripting-engine.md` §5, §7.5-§7.5.2 — P3's opcode set,
  the RNG and combat formulas, the merged-BSS finding, and the
  character-record field names.
- `docs/phantasie/TODO.md` — the single-surface index this page filters.
