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

## 1. Where things stand

| Game | Platform | Data present | Graphics | Data tables | Dungeon/scripting | Pipeline |
|------|----------|---------------|----------|--------------|---------------------|----------|
| Phantasie (I) | Amiga | ✅ `data/phantasie/amiga/` | ✅ confirmed **and implemented** (`.pic`, `.pat` + executable tables) | ✅ confirmed **and implemented** (monster/race/palette in `game`) | ✅ confirmed (shared P1/P2 engine); not yet implemented (Phase 3) | ✅ `supported: true`, real `exportGameData`/`buildAssets` |
| Phantasie II | Atari ST | ✅ extracted to `data/phantasieii/atarist/extracted/` (see `stx-extraction.md`) | ✅ confirmed **and implemented** (ST word-interleaved layout for both `MSTR*.PAT` and `PARTY*.PAT`; `.PIC` full-screen pictures not attempted — format never confirmed) | ✅ confirmed **and implemented** byte-exact against real `PHANT.PRG` (same compiled binary the reference offsets were recorded against — no adjustment needed) | ✅ confirmed against all 8 real `DNG*`/`MESS*` pairs, including the P2-exclusive `0x14`-`0x17` opcodes actually appearing in shipped data; not yet implemented (Phase 3) | ✅ `supported: true`, real `exportGameData`/`buildAssets` |
| Phantasie III | Amiga | ✅ `data/phantasieiii/amiga/` | ✅ confirmed **and implemented** (`.cmp`/`.csh`/`.set`, including a real bug caught and fixed in `.set`'s byte-remap during implementation) | ✅ confirmed **and implemented** (`monsinfo.dat`, skills); ⚠️ race table & `inititem.dat` still unresolved | ✅ confirmed (own engine variant); not yet implemented (Phase 3) | ✅ `supported: true`, real `exportGameData`/`buildAssets` |

**All three games now have real, tested, end-to-end graphics + data-table
pipelines** (Phases 0-2, 4, and 7 all done) — `npx tsx
tools/extract-game-data.ts --game all --platform all` produces actual
PNGs/JSON for every game in `public/assets/`, not placeholders. The asset
viewer (`npm run viewer`) is multi-game-aware and can browse all three.
Phase 3 (the dungeon/scripting engine, shared across all three games) is
now the single unimplemented piece standing between "assets render" and
"any game is actually playable" — every format it needs was confirmed
during Phantasie II's verification pass, so it carries no format-discovery
risk, just implementation work.

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

### Phase 3 — Dungeon + scripting engine (shared P1/P2/P3 core) — NEXT

**Goal:** dungeon grid + star/action/message interpreter, decoupled from
rendering — this is game *logic*, not just data, so it's the first piece
that touches `@seer/engine`'s `Game.ts` template rather than staying pipeline-only.

**Status update:** this phase's risk profile improved since it was
written — Phantasie II's dungeon/message format is now byte-verified
against all 8 real `DNG*`/`MESS*` pairs (not just P1), including confirmation
that the P2-exclusive opcodes `0x14`-`0x17` genuinely appear in shipped
data. `opcodes.ts`/`star-action.ts` can now be built once against all three
games' confirmed opcode tables, rather than needing a P2 revisit later.

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

### Phase 5 — Phantasie I world/town data (lower priority)

**Goal:** `twns.int`, `out*.dat`, `maps.int`, `scrolls.dtx` — the overworld
layer outside dungeons. Every one of these is only partially decoded
(`dungeon-format.md` §8) — this phase is exploratory RE work as much as
implementation. Sequence:

1. `twns.int` first (best-understood: confirmed 292-byte record stride, 12
   town names located) — get the remaining record fields via structural
   analysis against known Phantasie I mechanics (shop inventories, prices),
   cross-referencing `data-tables.md`'s item table once/if that's resolved.
2. `out*.dat` next (confirmed POI text block, unconfirmed leading grid) —
   the grid region is likely a small local-area tile map; compare its
   byte-value alphabet against `dungeon-format.md`'s cell-ID table for
   overlap before assuming a wholly separate encoding.
3. `maps.int` and `scrolls.dtx` last — lowest confidence, `scrolls.dtx`'s
   400-line-to-N-scrolls split is unresolved, `maps.int`'s dimensions
   entirely unknown.

Do not block Phases 1-4 or a first playable slice on this phase — it's
purely additive overworld content.

### Phase 6 — Runtime engine

Once Phase 3 produces a working dungeon simulation and Phase 1/2/4 produce
renderable assets: build out `@seer/engine`'s `Game.ts` template (or a
dedicated `src/dungeon/` + `src/town/` split, per Phase 3's note) into an
actual playable loop — tile rendering via `pixi-helpers.ts`'s viewport
culling, `InputManager` wired to grid movement instead of free pan/zoom,
message/choice UI. This is genre-specific game code with no format-doc
counterpart; scope it once Phases 1-4 make clear what data is actually
available to render.

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
`MSTR2.PAT` (confirmed not save-tainted). `.PIC` full-screen pictures are
explicitly **not** built — P2's `.PIC` format was never independently
confirmed (unlike P1's `.pic`), and decoding it would be new format
discovery outside this phase's mechanical-port scope.

`phantasieii/atarist` is now `supported: true`. Verified directly (not
just reported): `npx tsx tools/extract-game-data.ts --game phantasieii
--platform atarist` produces real output (80 monster entities, 16 races,
confirmed palette, 4 sprite-bank PNGs), and monster index 0/8 decode to
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

1. **Phase 3** (dungeon + scripting engine) — now the only unimplemented
   piece, and the highest-leverage one: it's what every game needs to
   become playable, and it's buildable against all three games' confirmed
   formats in one pass, no P2 revisit needed.
2. Phase 5 (P1 world/town data) and Phase 6 (runtime engine) remain
   lower-priority/blocked-on-Phase-3 respectively, as originally scoped.

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
