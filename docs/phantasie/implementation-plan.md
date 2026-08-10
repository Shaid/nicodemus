# Phantasie — Implementation Plan

This is the build-out plan for turning the reverse-engineered Phantasie
formats into a working offline pipeline + browser engine, per this project's
[architecture](../architecture-overview.md) and [boilerplate guide](../boilerplate-guide.md).

Companion documents (the reverse-engineering results this plan builds on):

- [`graphics-formats.md`](graphics-formats.md) — `.pic`/`.pat` (P1 raw), `.cmp`/`.csh`/`.set` (P3 compressed), palette encoding
- [`data-tables.md`](data-tables.md) — monster/race/skill/item record layouts
- [`dungeon-format.md`](dungeon-format.md) — dungeon grid, cell semantics, world/town files
- [`scripting-engine.md`](scripting-engine.md) — star/action/message trigger system
- [`TODO.md`](TODO.md) — single-surface index of every open question below

**Ground truth note:** all four docs above were produced by independently
re-deriving and byte-verifying every format against this project's own
`data/` files, using a third-party RE tool's C# source only as a guide to
where to look — no code from that tool exists in this repo, and none should
be added later. Decoders written from this plan must be original
implementations.

**Primary source addendum (2026-08-09):** `data/phantasieiii/` now also
holds the actual SSI-published *Phantasie III: The Wrath of Nikademus*
rule book/manual (`Phantasie III - The Wrath of Nikademus v1.0
(1987)(SSI)[compilation Bonus Ed.][1186].pdf`, 32 scanned pages, no text
layer — view with `Read`'s `pages` parameter). This is a first-party,
contemporary (1987) primary source and is now the **strongest available
oracle** for this project — stronger than the third-party fan-tool source
used everywhere else, since it documents SSI's own intended game content
(skill names, item catalogue, spell list, stat-progression charts) rather
than a modern reimplementer's inference. Every specific number/name
transcribed from it into the docs below was independently re-verified
against the manual's own page images before being marked confirmed, per
this project's usual byte-verification discipline — the manual is a
oracle to check extracted data *against*, not a substitute for extracting
the data from `data/` in the first place.

## 1. Where things stand

| Game | Platform | Data present | Graphics | Data tables | Dungeon/scripting | Pipeline |
|------|----------|---------------|----------|--------------|---------------------|----------|
| Phantasie (I) | Amiga | ✅ `data/phantasie/amiga/` | ✅ confirmed **and implemented** (`.pic`, `.pat` + executable tables) | ✅ confirmed **and implemented** (monster/race/palette in `game`) | ✅ confirmed (shared P1/P2 engine); not yet implemented (Phase 3) | ✅ `supported: true`, real `exportGameData`/`buildAssets` |
| Phantasie II | Atari ST | ✅ extracted to `data/phantasieii/atarist/extracted/` (see `stx-extraction.md`) | ✅ confirmed **and implemented** (ST word-interleaved layout for `MSTR*.PAT`/`PARTY*.PAT` **and** all six `.PIC` full-screen pictures, each with a disassembly-traced palette source) | ✅ confirmed **and implemented** byte-exact against real `PHANT.PRG` (same compiled binary the reference offsets were recorded against — no adjustment needed) | ✅ confirmed against all 8 real `DNG*`/`MESS*` pairs, including the P2-exclusive `0x14`-`0x17` opcodes actually appearing in shipped data; not yet implemented (Phase 3) | ✅ `supported: true`, real `exportGameData`/`buildAssets` |
| Phantasie III | Amiga | ✅ `data/phantasieiii/amiga/` | ✅ confirmed **and implemented** (`.cmp`/`.csh`/`.set`, including a real bug caught and fixed in `.set`'s byte-remap during implementation) | ✅ confirmed **and implemented** (`monsinfo.dat`, skills, race names, item/spell name tables); ⚠️ race sprite-index table & `inititem.dat` field semantics still unresolved | ✅ confirmed (own engine variant); not yet implemented (Phase 3) | ✅ `supported: true`, real `exportGameData`/`buildAssets` |

**All three games now have real, tested, end-to-end graphics + data-table
pipelines** (Phases 0-2, 4, and 7 all done) — `npx tsx
tools/extract-game-data.ts --game all --platform all` produces actual
PNGs/JSON for every game in `public/assets/`, not placeholders. The asset
viewer (`npm run viewer`) is multi-game-aware and can browse all three.

**Status update (2026-08-10) — Phase 3 alone does not reach a playable
slice; Phase 5 is a prerequisite, not additive content.** Earlier revisions
of this plan called Phase 3 "the single unimplemented piece standing
between assets render and any game is actually playable" and described
Phase 5 (world/town data) as "purely additive... do not block a first
playable slice." Both claims assumed dungeon-crawling was the game's entry
point. It isn't: the actual Phantasie game flow is character creation → a
starting **town** → the **world map** (where the party can explore and
fight overworld monster encounters well before ever finding a dungeon
entrance) → dungeons. A player cannot reach a dungeon at all without town
and world-map support first. Phase 5's formats (`maps.int` — the overworld
grid itself — and `out*.dat`'s local-screen grids) were, unlike Phase 3,
also genuinely RE-incomplete when this note was written.

> **Update (2026-08-10, later the same day): the Phantasie I world-map
> formats are now solved and code-confirmed.** `maps.int` is 18 × 520-byte
> section grids; a section is 20 × 26 tiles; sections tile 4-wide with a
> one-cell overlap into a 77 × 126 world; `out*.dat`'s POI records, text
> block and map display list are all decoded, with a decoder module at
> `src/assets/formats/outdoor.ts` and 14 passing real-byte tests. See
> `dungeon-format.md` §8.2/§8.3. Phase 5's *format-discovery* risk for
> Phantasie I is therefore largely retired — what remains is terrain-class
> naming, the outdoor icon bank, and the fact that none of this has been
> looked at for Phantasie II or III (§8 is Phantasie I only). Phase 5 stays
> a prerequisite for a playable slice; it is no longer the project's
> highest-risk unknown. Open items: `docs/phantasie/TODO.md`.

## 2. Format decoder module layout

Per the [boilerplate guide](../boilerplate-guide.md)'s "shared format decoder
library" pattern for a single-package project (this repo has no
`packages/*` workspace — `@seer/*` is a separate sibling install), decoders
live in `src/assets/formats/`, imported by both `tools/` (pipeline) and
`src/` (runtime engine + viewer). Proposed modules, each named after the
format doc section it implements:

| Module | Covers | Doc reference | Status |
|--------|--------|-----------------|--------|
| `bitplane.ts` | Generic bitplane pixel-extraction formula (`Planar` and `Interleaved` modes) — the shared primitive under every image format | `graphics-formats.md` §1 | ✅ built |
| `palette.ts` | ST 12-bit RGB444 word decode, both the `ST` and `AmigaToST` lookup variants | `graphics-formats.md` §2 | ✅ built |
| `pic.ts` | Raw uncompressed `.pic` full-screen pictures (P1) | `graphics-formats.md` §3 | ✅ built |
| `cmp.ts` | `.CMP`/`.CSH` RLE-compressed bitmaps (P3), both interleave submodes | `graphics-formats.md` §4 | ✅ built |
| `set.ts` | `.SET` world-map + tileset container (P3) | `graphics-formats.md` §5 | ✅ built |
| `sprite-bank.ts` | P3 CMP grid-cell extraction (`spriteIndex` → bank/cell) and P1 `.pat` offset-table extraction | `graphics-formats.md` §6, §7 | ✅ built |
| `exe-data.ts` | AmigaOS HUNK parsing (`parseHunks()`) + monster/race/palette/skill table extraction from `game`/`PhantasieIII` | `data-tables.md` §1, §3, §5; see reference note below | ✅ built |
| `monster-data.ts` | `monsinfo.dat` record decoder (P3) | `data-tables.md` §3 | ✅ built |
| `ascii-strings.ts` | Small shared helper (NUL/space-padded string reads) factored out during implementation — not in the original plan, but small and generic enough to keep | n/a | ✅ built (unplanned) |
| `dungeon.ts` | Shared P1/P2 dungeon grid + header parser | `dungeon-format.md` §3 | ⏳ Phase 3 |
| `dungeon-p3.ts` | P3 dungeon grid + header parser | `dungeon-format.md` §5 | ⏳ Phase 3 |
| `star-action.ts` | Star and action record decode + the interpreter loop, parameterised by an opcode table | `scripting-engine.md` §1, §2, §4 | ⏳ Phase 3 |
| `opcodes.ts` | The P1/P2 and P3 opcode tables as data (not control flow) | `scripting-engine.md` §5 | ⏳ Phase 3 |
| `messages.ts` | P1/P2 length-prefixed line table + P3 pointer/pool decoder | `scripting-engine.md` §3 | ⏳ Phase 3 |

All eight built modules have colocated `__tests__/*.test.ts` files
(83 tests total) following the boilerplate guide's real-byte-fixture
philosophy, plus golden-output checks against the real sample files named
throughout `graphics-formats.md`/`data-tables.md`.

**`exe-data.ts` reference:** a sibling project at
`/home/ctemplet/Development/middilgard/src/assets/formats/exe-data.ts` has a
working `parseHunks(data: Uint8Array): { code, data }` AmigaOS HUNK loader
already used for exactly this kind of executable-embedded-table extraction.
Use it as a structural reference (same clean-room rule as the C# source —
understand and reimplement, review its license/provenance before copying
anything directly since it's a different project's code, not shared
framework code). It's also the concrete next step for the two open
"offsets don't resolve" questions below (§5).

## 3. Phased roadmap

### Phase 0 — Unblock Phantasie II: extract the `.stx` disk images — DONE

**Goal:** turn `data/phantasieii/atarist/*.stx` (Pasti raw floppy images)
into individual files (`PHANT.PRG`, `MSTR*.PAT`, `PARTY*.PAT`, `DNG*`,
`MESS*`) under a layout `resolveDataDir()` can find.

**Done.** No existing `.stx` reader was available, so a narrow
`.stx` → raw `.ST` desectorizer (`tools/stx-extract/stx2st.py`, ~150 lines,
implements the public Pasti file-format spec) was written and handed off to
system `mtools` for the FAT12 half. Both disks turned out to be standard,
non-cracked, single-sided 80-track/9-sector floppies (one incidental
weak-bit protection sector found, confirmed to fall outside any extracted
file's data). Full method, byte-level `.stx` structure notes, and the
complete 59-file listing (12 files/348,477 B disk 1 + 47 files/332,507 B
disk 2): `docs/phantasie/stx-extraction.md`. Files live at
`data/phantasieii/atarist/extracted/disk{1,2}/`.

**Phantasie II stays `supported: false`** in `tools/shared/game-config.ts`
until Phase 7's byte-level decode work lands — extraction alone doesn't
change the pipeline wiring (left to that phase, not done here) — and every
P2-specific format *claim* in the docs remains an unverified hypothesis
carried from the reference source until it's checked against these newly
extracted real files.

### Phase 1 — Phantasie III graphics pipeline — DONE

**Done.** All five modules built and tested (§2). One real bug was caught
and fixed during implementation: the first `set.ts` attempt assumed the
`.SET` picture region was already in row-major order and produced visual
noise — `graphics-formats.md` §5.2's column-block-major on-disk order has
to be explicitly remapped first (`remapSetPictureBytes()`), after which
`phantasy.set` renders the documented terrain panels correctly. A smoothness
regression test guards against this silently breaking again. Every
`Graphics/*.cmp`/`*.csh`/`.set` file now decodes to real PNG output via
`tools/phantasieiii/build-assets.ts` — visually spot-checked, all legible
(title screen, sprite grids, dialog buttons, UI icons, terrain panels).

**Goal (original):** `.cmp`/`.csh`/`.set` → PNG, visible in the asset viewer. Highest
confidence, most self-contained, and the fastest path to a visual payoff
that validates the whole pipeline shape end-to-end.

1. `bitplane.ts` + `palette.ts` (shared primitives, needed by every later
   phase too — build these first and well-tested).
2. `cmp.ts` — decode all `Graphics/*.cmp`/`*.csh` files to PNG. Test fixtures:
   construct synthetic byte fixtures per the testing philosophy in the
   boilerplate guide (`packages/iff/src/__tests__/iff.test.ts` pattern),
   plus golden-output tests against the real sample files already confirmed
   in `graphics-formats.md` §4.4 (`title.cmp`, `heros.cmp`, etc.).
3. `set.ts` — decode `phantasy.set`'s picture region (the map-cell semantics
   are still a hypothesis — §5 flags this as future work, not a blocker for
   rendering the picture layer).
4. `sprite-bank.ts` — grid-cell extraction for the 7 monster/race banks,
   wired to `monsinfo.dat`'s `spriteIndex` field once Phase 2 lands.
5. Wire into `tools/phantasieiii/build-assets.ts` (currently a stub) and
   `seer.config.ts`'s `phantasieiii` entry (flip `supported: true` once
   `exportGameData`/`buildAssets` exist).

**Done when:** every `.cmp`/`.csh`/`.set` file in `data/phantasieiii/amiga/Graphics/`
renders correctly in `tools/viewer/`.

### Phase 2 — Phantasie III data tables — DONE

**Done.** `tools/phantasieiii/export-game-data.ts` writes a real
`entities.json` (80 monsters, each with resolved sprite bank/cell rects
from Phase 1) and `skills.json` (8 skills × 6 classes × 15 levels),
replacing the placeholder empty array. One doc discrepancy noted during
implementation, not yet corrected in `data-tables.md` §3.1: the monster
name field is documented as "zero-padded" but is actually space-padded up
to a single trailing NUL — handled with `.trimEnd()`, worth fixing in the
doc. Race table and `inititem.dat` remain unresolved (§5 below) and were
correctly treated as non-blocking per the original plan.

**Status update (2026-08-09):** the P3 race *name* table is now resolved
(`readP3RaceNames()` in `exe-data.ts`, `data-tables.md` §4.1) and
`monsinfo.dat`'s `Weapon`/`Armor`/spell fields are now understood
(`weaponRating`/`armorRating` — raw combat stats, not item indices; spell
fields confirmed against a newly-decoded P3 spell name table —
`data-tables.md` §3.1). Two items remain genuinely open and non-blocking:
the race→sprite-bank-cell index table (`data-tables.md` §4.2 —
`heros.cmp` currently renders via an unverified race-index-as-cell-index
assumption) and `inititem.dat`'s field semantics (`data-tables.md` §6.3).
Neither blocks a playable slice.

**Goal (original):** `monsinfo.dat` → `entities.json` (monster records, sprite-bank
references resolved to actual bank/cell coordinates from Phase 1).

1. `monster-data.ts` — the confirmed 38-byte record decoder (`data-tables.md`
   §3.1).
2. Skills table extraction from `PhantasieIII` via `exe-data.ts`
   (`data-tables.md` §5 — already byte-exact confirmed, straightforward port).
3. **Stretch, not blocking:** revisit the P3 race table and `inititem.dat`
   open questions (§5 below) — useful but not required for a first playable
   slice, since monsters + skills already give enough data to populate a
   combat/encounter view.

**Done when:** `tools/phantasieiii/export-game-data.ts` writes a real
`entities.json` (monsters, name, stats, resolved sprite) replacing the
current empty-array placeholder.

### Phase 3 — Dungeon + scripting engine (shared P1/P2/P3 core)

**Goal:** dungeon grid + star/action/message interpreter, decoupled from
rendering — this is game *logic*, not just data, so it's the first piece
that touches `@seer/engine-2d`'s `Game.ts` template rather than staying pipeline-only.

**Sequencing note (2026-08-10):** this phase covers what happens *inside* a
dungeon. It does not by itself get a player *into* one — that requires
character creation, the starting town, and world-map traversal, which is
Phase 5 (below), not yet started and less RE-complete than this phase. See
§1's status update. Implementation-wise Phase 3 has no blockers and can
proceed independently; treat it and Phase 5 as parallel tracks (one
implementation-heavy, one RE-heavy) rather than assuming this phase's
completion unlocks a playable game on its own.

**Status update:** this phase's risk profile improved since it was
written — Phantasie II's dungeon/message format is now byte-verified
against all 8 real `DNG*`/`MESS*` pairs (not just P1), including confirmation
that the P2-exclusive opcodes `0x14`-`0x17` genuinely appear in shipped
data. `opcodes.ts`/`star-action.ts` can now be built once against all three
games' confirmed opcode tables, rather than needing a P2 revisit later.

**Status update (2026-08-09):** the item-name and monster-name tables
opcodes `0x05`/`0x06`/`0x11`/`0x18`/`0x19` depend on (previously only
hand-transcribed from the reference source, per `scripting-engine.md`
§6's old text) are now **located and byte-verified against all three
games' executables and every real dungeon file in the project** — zero
out-of-range index references across 178 (item) + 34 (monster) real
script cross-checks. `opcodes.ts` can resolve these opcodes to real item/
monster names, not just raw indices, from day one. The character-`stat`
index space (`0x12`/`0x13`/P3's `0x18`/`0x19`) also got a real disassembly
trace this pass (P1's `GetStat`/`SetStat`, `scripting-engine.md` §6.3):
the index-range hypothesis is now code-confirmed, not just
source-transcribed, and **two real P1 opcode-`0x12`/`0x13` behavior bugs
in the previously-documented fan-tool interpretation were corrected** —
both are genuinely conditional, party-wide operations in the real game,
not the "display-only, no mutation" behavior previously documented. What
remains open (not a Phase 3 blocker, since the opcodes work correctly
either way — only the individual field *names* are missing): which
specific stat index is Strength vs. HP vs. Level, etc. See `TODO.md`'s
`scripting-p1-stat-field-semantics` row. **Combat-resolution** (attack
roll/damage formula) — genuinely unexplored before this pass — also got
a first trace this session (`scripting-engine.md` §7): P1's hit/miss
compare and its two damage-application functions (player vs. monster,
confirmed structurally distinct) are located and byte-verified, but the
actual RNG source and the precise to-hit/damage formula remain open (see
`TODO.md`'s `scripting-p1-combat-rng-formula` row) — real combat can't be
implemented byte-exact yet, but the shape (roll → compare vs. an armor-
derived threshold → branch → HP write, with a confirmed `Die()` path) is
now known well enough to stub a plausible combat loop against.

**Status update (2026-08-09, combat follow-up):** P1's combat RNG and
formulas are now fully mechanically confirmed, not just shaped —
`scripting-engine.md` §7.1a-§7.2a: a located, byte-verified linear
congruential generator (`seed=(seed*3677+3) mod 32768`, file offset
`0x2C874`) feeds a `0..100` percentage-roll wrapper, and both the to-hit
compare and the damage-magnitude calculation have their full operation
sequence and every operand's source field/record confirmed (only
individual field *semantics* — which byte is "armor," which is "weapon
power" — remain open, the same class of gap as the stat-index table).
**P2 and P3 also got their first combat traces this pass** (§7.4/§7.5):
P2's hit/miss+damage block is located and confirmed structurally
near-identical to P1's own formula (same monster stride, same armor
field, same damage constants) with only the specific RNG call site
inside that block still to pin down; P3's RNG is fully confirmed (a
different concrete LCG, `seed=(seed*25173+13849) mod 65536`) and its
hit/miss dispatcher is located, though P3's own to-hit formula is
visibly richer (multiple stat tables plus difficulty-conditional
adjustments) and wasn't fully enumerated. Net effect: combat is no
longer a "shape known, formula unknown" risk for any of the three
games — it's "P1 byte-exact-close, P2/P3 located with a strong template
to finish from" — a real reduction in Phase 3's remaining risk, though
none of the three is yet a drop-in byte-exact implementation. See
`TODO.md`'s `scripting-p1-combat-field-semantics`/
`scripting-p2-combat-rng-site`/`scripting-p3-combat-formula` rows.

**Status update (2026-08-09, field-semantics follow-up):** P1's combat
model is now essentially implementation-ready. The mirror
"monster-attacks-player" hit/miss+damage branch (previously "not located"
— see the paragraph above) has been found in the same dispatcher function
and is fully formula-confirmed alongside the already-known
party-attacks-monster direction (`scripting-engine.md` §7.3); `RollPercent`
and `roundedHalf()` are reused unchanged between both directions.
`roundedHalf()` itself turned out to be a **Newton's-method integer
square root**, not "roughly half the roll" as previously guessed — a
correctness-relevant fix, not just documentation polish, since it changes
the actual value range fed into the damage formula (`0..10` rather than
`0..50`). The `GetStat`/`SetStat` resolver (already code-located) was
fully disassembled end-to-end this pass, giving an exact
`statIndex → character-record-byte-offset` table across the whole
`1`-`164` domain; five combat-formula fields that were previously bare,
unplaced byte offsets are now bound to specific `statIndex` values. What's
still missing — English names for those indices — was shown to be a real
gap, not an unexplored one: the display-routine cross-reference this needs
was exhaustively searched for (two independent techniques, both negative;
see `scripting-engine.md` §6.3(c)) and isn't a quick follow-up anymore.
None of this blocks Phase 3 implementation — the opcodes and combat
formulas work correctly by field *offset* regardless of what the fields
are named — but it does mean "add the names" is now scoped as a genuine
escalation-worthy problem rather than routine polish, should a future pass
want them for UI/debug-display purposes. See `TODO.md`'s
`scripting-p1-stat-names`/`scripting-p1-combat-field-semantics` rows.

**Status update (2026-08-09, P2/P3 combat follow-up):** the two remaining
"combat located but formula unknown" gaps from the paragraph above are now
closed. **P2's RNG call site is confirmed** (`JSR $FD40` inside the combat
block) and turned out to be a table-sum-and-rotate additive generator
rather than an LCG — but every other part of P2's to-hit and damage
formula is byte-identical in shape, field offsets, and constants to P1's,
so the implementation risk here was always low and is now zero. **P3's
full to-hit formula (both a "spellcaster" and an "other classes" branch),
its damage-magnitude formula (a single class-indexed die roll — simpler
than P1/P2's, a real engine-design difference, not a partial trace), and
its damage-application function are all now confirmed**, via a corrected
`HUNK_RELOC32`-based call-target-resolution technique
(`targetFileOffset = rawOperand + 0x28`) that overturns the prior pass's
"reloc lookup finds nothing for P3" claim — a reusable technique for any
future P3 disassembly trace. **All three games' combat systems are now
implementation-ready by formula shape and operand source**; the one
remaining open item (P3's class-indexed lookup table *contents* — see
`scripting-p3-lookup-tables` in `TODO.md`) blocks knowing the actual
numeric balance of P3 combat, not the engine's control flow, and doesn't
block writing the interpreter itself (the tables can be treated as opaque
data loaded from their raw addresses once the DATA-hunk size-mismatch is
root-caused). See `scripting-engine.md` §7.4/§7.5.

1. `dungeon.ts` (P1/P2 shared) and `dungeon-p3.ts` — grid + header parsing,
   built and tested against the byte-exact confirmed offsets in
   `dungeon-format.md` §3/§5.
2. `opcodes.ts` + `star-action.ts` — the interpreter loop from
   `scripting-engine.md` §4, parameterised by the (differing) P1/P2 vs P3
   opcode tables from §5. **Preserve the confirmed bugs** (P3's trap-damage
   formula, P3's off-by-one trap-message index, §6 of the dungeon doc) —
   these are original game behavior, not something to "fix" when porting.
3. `messages.ts` — both message formats. The P1/P2 choice-count heuristics
   (`scripting-engine.md` §3.1) are carried from the reference source only
   and not independently re-derived; budget time to verify against a few
   more real `mess*` files while implementing, since this is exactly the
   kind of subtle-heuristic code most likely to hide a transcription error.
4. Decide the runtime split: dungeon crawling is stateful, turn-based,
   modal (movement vs. dialogue vs. combat) — this likely wants its own
   `src/dungeon/` module tree that `Game.ts` delegates into, rather than
   trying to fit it into the generic `Camera`/`InputManager` pan-and-zoom
   loop `Game.ts` currently assumes for a map-style game (see
   `architecture-overview.md` §8's explicit note that the template
   "is not assumed to be a map-based game").

**Done when:** a dungeon file can be loaded, the grid rendered as a simple
top-down tile view (walls/doors/stairs, reusing `dungeon-format.md` §4's
cell-ID table directly — no art needed yet, flat colors suffice), and
walking onto a star cell triggers a real message + choice + action chain
using data straight from the file, byte-verified against the interpreter
algorithm in `scripting-engine.md` §4.

### Phase 4 — Phantasie I graphics + data — DONE

**Done**, with two scope decisions worth recording. `pic.ts` renders `.pic`
files using the documented greyscale substitute palette (`gfx-pic-palette`
in `TODO.md` is still open — the real screen palette was never found, so
this wasn't "resolved," just implemented against the best available
placeholder, matching what the plan expected). `exe-data.ts`'s
`parseHunks()`/`readHunkHeader()` were built and verified byte-exact against
`game`'s own confirmed hunk structure — but the actual P1 table readers
still use the raw file offsets confirmed in `data-tables.md` §1, not a full
hunk-relative resolution. The "why do raw offsets work at all" question
(`data-p1-hunk-addressing` in `TODO.md`) is a conscious, explicitly-deferred
scope decision, not an oversight — see §5 below. `sprite-bank.ts`'s P1
`.pat` branch is byte-exact confirmed against real `mstr1.pat`/`party1.pat`.
Both sprite banks render correctly-colored (not greyscale) via
`tools/phantasie/build-assets.ts`, spot-checked visually.

**Goal (original):** `.pic`/`.pat` decode, monster/race tables from `game`.

### Phase 5 — Town + world-map data (prerequisite for a playable slice)

**Goal:** `twns.int`, `out*.dat`, `maps.int` — the town/world-map layer a
player passes through *before* ever reaching a dungeon (character creation
→ starting town → world map, with overworld monster encounters possible
along the way → dungeon entrance). `scrolls.dtx` (lore text) is unrelated to
this traversal loop and stays lowest priority within the phase. As of
2026-08-10 the two map formats are solved (`dungeon-format.md` §8.2/§8.3,
Phantasie I only — P2/P3 haven't been investigated at all yet); what is
left in this phase is mostly implementation plus the terrain/icon rendering
questions in `TODO.md`. Per §1's status update, the phase remains a
**prerequisite for a playable slice**, not optional content layered on top
of one. Sequence:

1. ~~`maps.int` first~~ — **done (2026-08-10).** It is 18 concatenated
   520-byte section grids, byte-identical to the leading 520 bytes of the
   18 `out*.dat` files. `dungeon-format.md` §8.3.
2. ~~`out*.dat` next~~ — **done (2026-08-10).** Grid 20 × 26 at offset 0,
   15 × 5-byte POI records at 520, 10 × 40-byte text lines at 595, map
   display list at 1000. Decoder: `src/assets/formats/outdoor.ts`.
   `dungeon-format.md` §8.2. What is left here is *rendering*: the display
   list plots 128-byte icons from a bank at `game+0x196BC` that is not yet
   decoded (`world-p1-outdoor-icons` in `TODO.md`).
3. `twns.int` — confirmed 292-byte record stride and 12 town names already.
   The **map-coordinate question is closed**: towns are positioned by the
   `out*.dat` POI record (section file + column + row + town index), not by
   any field in `twns.int` — see `dungeon-format.md` §8.2.2. What remains
   is the rest of the 292-byte record, whose first 32 bytes are
   byte-identical across all 11 populated records, i.e. a shared shop/price
   template; recover it via structural analysis against known Phantasie I
   mechanics, cross-referencing `data-tables.md`'s item table.
4. `scrolls.dtx` last — confirmed line encoding, only the
   400-line-to-N-scrolls split is open, and it's flavor text with no effect
   on the traversal/combat loop.

This phase and Phase 3 have no dependency on each other and can proceed in
parallel — but neither one alone reaches a playable game; both are needed.

### Phase 6 — Runtime engine

Once Phase 3 produces a working dungeon simulation and Phase 1/2/4 produce
renderable assets: build out `@seer/engine-2d`'s `Game.ts` template (or a
dedicated `src/dungeon/` + `src/town/` split, per Phase 3's note) into an
actual playable loop — tile rendering via `pixi-helpers.ts`'s viewport
culling, `InputManager` wired to grid movement instead of free pan/zoom,
message/choice UI. This is genre-specific game code with no format-doc
counterpart; scope it once Phases 1-4 make clear what data is actually
available to render.

**Stretch goal, noted 2026-08-10 — the dungeon view itself.** The original
games' dungeon renderers are visually plain (flat top-down tiles). Once a
functionally-correct top-down renderer exists (this phase's "Done when" bar
per Phase 3), consider a **first-person dungeon view** as a follow-up
visual upgrade — walls/doors/monsters rendered as a forward-facing
corridor view rather than a top-down grid, in the spirit of the genre's
first-person dungeon crawlers even though Phantasie's own original
renderer wasn't one. Purely additive/cosmetic, not a blocker for any
phase — get the top-down version functionally correct first (grid
movement, star/action triggers, combat all working byte-correctly against
real dungeon data), then treat first-person as a rendering-layer swap on
top of the same already-decoded grid/cell data, not a new RE problem.

### Phase 7 — Phantasie II graphics + data — DONE

**Done.** `tools/phantasieii/export-game-data.ts` and `build-assets.ts`
port the Phase 1/2/4 pattern using P2's confirmed offsets
(`PHANT.PRG`'s tables, byte-identical to `data-tables.md` §2 — no
adjustment needed, since `PHANT.PRG` is the exact compiled binary those
offsets were recorded against) and the confirmed ST word-interleaved plane
layout for `MSTR*.PAT`/`PARTY*.PAT` (not P1's Planar layout — including
`PARTY*.PAT`, which earlier size-based speculation thought might keep P1's
layout; it doesn't). `sprite-bank.ts` gained P2-specific
`readP2MonsterSpriteTable`/`decodeP2MonsterSprite`/`decodeP2RaceSprite`
functions alongside the existing P1 ones. Disk 1 is the canonical data
source (`dataDirs: ['phantasieii/atarist/extracted/disk1']` in
`tools/shared/game-config.ts`), with a fallback to disk 2 only for
`MSTR2.PAT` (confirmed not save-tainted).

**Status update (2026-08-09):** `.PIC` full-screen pictures are now also
confirmed and built. All six shipped files (`COVER1.PIC`, `COVER2.PIC`,
`PELNOR.PIC`, `DECOR.PIC`, `FINAL2.PIC`, `CROWD.PIC`) decode via the same
ST word-Interleaved layout `.PAT` uses, each with a disassembly-traced
palette source (`graphics-formats.md` §10 — new format discovery this
pass, since no reference-tool support exists for P2 `.PIC` at all).
`decodeP2Pic()`/`P2_PIC_PALETTE_SOURCE_BY_FILE` in
`src/assets/formats/pic.ts`, `readP2CoverPalette()`/`readP2TownPalette()`
in `src/assets/formats/exe-data.ts`, wired into
`tools/phantasieii/build-assets.ts`. Phantasie II now has a confirmed
title screen and town/ending art, closing the "no P2 full-screen art
anywhere in this project" gap the website previously stated.

`phantasieii/atarist` is now `supported: true`. Verified directly (not
just reported): `npx tsx tools/extract-game-data.ts --game phantasieii
--platform atarist` produces real output (80 monster entities, 16 races,
confirmed palette, 4 sprite-bank PNGs, and — as of the 2026-08-09 update
above — 6 full-screen picture PNGs), and monster index 0/8 decode to
`SKELETON`/`ORC` exactly as P1's roster does. Visually spot-checked several
`mstr1.png`/`party1.png` sprites — legible, correctly-coloured art
(a full monster menagerie: spiders, dragons, skeletons; a 16-race roster
matching P1's poses). One visual-inspection false alarm worth recording:
`SKELETON`'s frame appeared "blank" in a naive transparent-PNG-over-white
check — it's actually a legitimate plain-white bone silhouette on a
transparent background, byte-identical in pixel composition to P1's
already-confirmed skeleton sprite. Not a bug; a reminder to composite over
a non-white background (or diff against a known-good baseline) before
concluding a sparse sprite is broken.

Dungeon/scripting (Phase 3) still doesn't exist for any game, so P2's
`DNG*`/`MESS*` files remain undecoded by the pipeline even though their
format was confirmed in the prior verification pass — Phase 3, once built,
should apply to P2 directly with no format-discovery risk. `OUT*.DAT`'s
save-vs-template status also remains unresolved (`p2-out-dat-save-status`
in `TODO.md`), but nothing in this phase touches it.

> **Update (2026-08-10):** `OUT*.DAT` is now fully decoded, and so is P2's
> whole world-map layer — see `dungeon-format.md` §8.6. Its terrain grids
> are **pristine** (`MAPS.INT` is the byte-identical master, 17/17), which
> supersedes the earlier "no known pristine P2 counterpart" reading in
> `stx-extraction.md` §6; only the never-read 995-1500 gap and the bytes
> past the display-list terminator carry save residue. Decoder and tests
> exist (`PHANTASIE2_OUTDOOR` in `src/assets/formats/outdoor.ts`); wiring
> them into `tools/phantasieii/build-assets.ts` is tracked as
> `world-p2-pipeline-wiring` in `TODO.md`.

### The asset viewer is now multi-game

`tools/viewer/` was generalized: a game/platform selector (driven by
`src/game-id.ts`'s `GAME_IDS`/`GAME_DISPLAY_NAMES`) replaces the old
hardcoded `phantasieiii`-only `ASSET_BASE`, with the selection persisted in
the URL (`?game=...&platform=...`) so a specific game's viewer is
shareable. The game→`assetDir` mapping is duplicated locally in
`viewer.ts` rather than imported from `tools/shared/game-config.ts`,
since that file pulls in `@seer/pipeline`'s Node-only code and `viewer.ts`
runs in the browser (`architecture-overview.md` §2's dependency rule).
`npm run viewer` opens the dev server straight at it; `vite.config.ts`'s
`build.rollupOptions.input` now includes it too, so `npm run build`
produces a real `dist/tools/viewer/index.html` — confirmed by running the
actual production build, not just checking the config.

## 4. Near-term action items (first PR-sized chunks)

Phases 0, 1, 2, 4, and 7 are done — every game/platform pair now has a real
graphics + data-table pipeline, and the viewer can browse all three. Next up:

1. ~~**Phase 5's `maps.int`/`out*.dat` investigation**~~ — **done
   (2026-08-10).** Both formats are decoded and code-confirmed against the
   Amiga `game` executable; see `dungeon-format.md` §8.2/§8.3 and
   `src/assets/formats/outdoor.ts`. The follow-on RE item, now the one that
   blocks actually *drawing* the world map, is the outdoor icon bitmap bank
   at `game+0x196BC` (`world-p1-outdoor-icons` in `TODO.md`).
2. **Phase 3** (dungeon + scripting engine) — implementation-heavy, not
   RE-heavy: buildable against all three games' already-confirmed formats in
   one pass, no format-discovery risk left, no P2 revisit needed. Can
   proceed in parallel with item 1 — they don't block each other, but Phase
   3 alone does not reach a playable slice (see §1).
3. Phase 6 (runtime engine) remains blocked on Phase 3 (and, for the
   town/world-map traversal loop specifically, on Phase 5) as scoped.

## 5. Open risks carried forward

Full list with evidence pointers: [`TODO.md`](TODO.md). The one with the
widest blast radius if wrong:

- **P1 hunk-addressing coincidence** (`data-tables.md` §8) — still open.
  `parseHunks()`/`readHunkHeader()` were built and verified correct in
  Phase 4, but the actual P1 table readers still use the raw file offsets
  documented in `data-tables.md` §1, which structurally shouldn't
  generalize (hunk 0 alone is too small to contain any of the confirmed
  tables). This was a conscious scope decision — every offset actually
  needed so far checked out — not an oversight, but it means a *new* P1
  offset found later by inspection should be re-derived through the hunk
  table properly rather than assumed to work.

(Phantasie II format claims are no longer an open risk — resolved by the
Phase 7 status update above. See `TODO.md` for the remaining, narrower
open items: `.SET` map semantics, P3 race table offsets, `inititem.dat`
field semantics, and a couple of smaller ones.)

### A wiring gotcha worth knowing before touching Phase 3/5/6

Registering a game's pipeline functions in `tools/shared/game-config.ts`
creates a static circular import if that game's tool files also import
config lookups from `game-config.ts` — resolved by moving those lookups to
a lazy `import()` inside each tool's `main()`. Relatedly, every game's
`export-game-data.ts`/`build-assets.ts` share a basename across games, so
their `isStandalone` entrypoint guards must compare exact resolved paths
(`process.argv[1] === fileURLToPath(import.meta.url)`), not
`.endsWith('export-game-data.ts')` — the naive version silently runs every
matching file's `main()` when any one of them is invoked directly. Both
fixes are applied throughout `tools/phantasie/`, `tools/phantasieii/`, and
`tools/phantasieiii/`; keep the pattern for any future tool file sharing a
basename with an existing one.

## 6. Scaffolding wired

`src/game-id.ts` and `tools/shared/game-config.ts` (and its `seer.config.ts`
mirror) register all three game/platform pairs (`phantasie/amiga`,
`phantasieii/atarist`, `phantasieiii/amiga`), all three `supported: true`
with real `exportGameData`/`buildAssets` wired in. `tools/viewer/` is
multi-game-aware (`npm run viewer`) and included in the production build.

## 7. Verified build health

Confirmed directly (not just reported) as of this writing: `npx tsc
--noEmit`, `npx eslint src/ tools/`, and `npx vitest run` (91 tests, 9
files) all pass clean; `npx tsx tools/extract-game-data.ts --game all
--platform all` runs the real pipeline end-to-end for every game —
`data/extracted/` gets real `entities.json`/`races.json`/`palette.json`/
`skills.json` as applicable, and `public/assets/` gets real PNG+JSON output
(10 assets for `phantasie`, 4 for `phantasieii`, 14 for `phantasieiii`);
and `npm run build` produces a real `dist/tools/viewer/index.html`, not
just the main app. Spot-checked several output PNGs directly across all
three games (`phantasy.set`'s terrain panels, both games' 16-race rosters,
Phantasie II's monster sprite sheet) — all correctly rendered, correctly
coloured. One visual false alarm during this pass is worth remembering as
a verification-method note: a sparse/mostly-transparent sprite (a
plain-white skeleton silhouette) can look "blank" in a naive check against
a white background — diff against a known-good baseline or composite over
a dark background before concluding a sparse sprite is broken.
