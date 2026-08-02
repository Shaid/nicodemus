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

| Game | Platform | Data present | Graphics | Data tables | Dungeon/scripting |
|------|----------|---------------|----------|--------------|---------------------|
| Phantasie (I) | Amiga | ✅ `data/phantasie/amiga/` | ✅ confirmed (`.pic`, `.pat` + executable tables) | ✅ confirmed (monster/race/palette in `game`) | ✅ confirmed (shared P1/P2 engine) |
| Phantasie II | Atari ST | ⚠️ raw `.stx` floppy images only, **not extracted** | hypothesis only (carried from reference source) | hypothesis only | format confirmed (shares P1 engine) but **no real P2 files to decode** |
| Phantasie III | Amiga | ✅ `data/phantasieiii/amiga/` | ✅ confirmed (`.cmp`/`.csh`/`.set`) | ✅ confirmed (`monsinfo.dat`, skills); ⚠️ race table & `inititem.dat` unresolved | ✅ confirmed (own engine variant) |

Phantasie I and III are ready to implement now. Phantasie II is blocked on
one prerequisite: extracting individual files from its `.stx` Pasti disk
images (§3, Phase 0).

## 2. Format decoder module layout

Per the [boilerplate guide](../boilerplate-guide.md)'s "shared format decoder
library" pattern for a single-package project (this repo has no
`packages/*` workspace — `@seer/*` is a separate sibling install), decoders
live in `src/assets/formats/`, imported by both `tools/` (pipeline) and
`src/` (runtime engine + viewer). Proposed modules, each named after the
format doc section it implements:

| Module | Covers | Doc reference |
|--------|--------|-----------------|
| `bitplane.ts` | Generic bitplane pixel-extraction formula (`Planar` and `Interleaved` modes) — the shared primitive under every image format | `graphics-formats.md` §1 |
| `palette.ts` | ST 12-bit RGB444 word decode, both the `ST` and `AmigaToST` lookup variants | `graphics-formats.md` §2 |
| `pic.ts` | Raw uncompressed `.pic` full-screen pictures (P1) | `graphics-formats.md` §3 |
| `cmp.ts` | `.CMP`/`.CSH` RLE-compressed bitmaps (P3), both interleave submodes | `graphics-formats.md` §4 |
| `set.ts` | `.SET` world-map + tileset container (P3) | `graphics-formats.md` §5 |
| `sprite-bank.ts` | P3 CMP grid-cell extraction (`spriteIndex` → bank/cell) and P1 `.pat` offset-table extraction | `graphics-formats.md` §6, §7 |
| `exe-data.ts` | AmigaOS HUNK parsing (`parseHunks()`) + monster/race/palette/skill table extraction from `game`/`PhantasieIII` | `data-tables.md` §1, §3, §5; see reference note below |
| `monster-data.ts` | `monsinfo.dat` record decoder (P3) | `data-tables.md` §3 |
| `dungeon.ts` | Shared P1/P2 dungeon grid + header parser | `dungeon-format.md` §3 |
| `dungeon-p3.ts` | P3 dungeon grid + header parser | `dungeon-format.md` §5 |
| `star-action.ts` | Star and action record decode + the interpreter loop, parameterised by an opcode table | `scripting-engine.md` §1, §2, §4 |
| `opcodes.ts` | The P1/P2 and P3 opcode tables as data (not control flow) | `scripting-engine.md` §5 |
| `messages.ts` | P1/P2 length-prefixed line table + P3 pointer/pool decoder | `scripting-engine.md` §3 |

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

### Phase 0 — Unblock Phantasie II: extract the `.stx` disk images

**Goal:** turn `data/phantasieii/atarist/*.stx` (Pasti raw floppy images)
into individual files (`PHANT.PRG`, `MSTR*.PAT`, `PARTY*.PAT`, `DNG*`,
`MESS*`) under a layout `resolveDataDir()` can find.

This is a distinct sub-problem from everything else in this plan: it's
Atari ST floppy/filesystem archaeology (Pasti `.stx` sector format → an
embedded GEMDOS/FAT-like filesystem), not a Phantasie-specific format. Two
viable approaches, in order of preference:

1. **Existing tooling.** Check whether an existing `.stx` extractor (e.g.
   HxC Floppy Emulator, or a CLI Pasti reader) can be run offline once to
   produce a plain file dump, committed nowhere (still gitignored data) but
   usable as this project's `data/phantasieii/atarist/` going forward. This
   avoids writing and maintaining a disk-image reader for a one-time task.
2. **Minimal in-repo reader**, only if no external tool is workable: a
   narrow `.stx` sector reader + GEMDOS directory walker, scoped to just
   enough to dump files (not a general Atari ST disk-image library).

**Until this lands, Phantasie II stays `supported: false`** in
`tools/shared/game-config.ts` and every P2-specific claim in the format docs
remains an unverified hypothesis carried from the reference source.

### Phase 1 — Phantasie III graphics pipeline

**Goal:** `.cmp`/`.csh`/`.set` → PNG, visible in the asset viewer. Highest
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

### Phase 2 — Phantasie III data tables

**Goal:** `monsinfo.dat` → `entities.json` (monster records, sprite-bank
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
that touches `@seer/engine`'s `Game.ts` template rather than staying pipeline-only.

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

### Phase 4 — Phantasie I graphics + data

**Goal:** `.pic`/`.pat` decode, monster/race tables from `game`.

1. `pic.ts` — trivial once `bitplane.ts` exists (`graphics-formats.md` §3).
   **Blocker to resolve first:** no in-game palette is confirmed for `.pic`
   files (only the monster/race palette at `game+0x194BC` is verified) — see
   §5 below before this phase can produce correctly-colored output rather
   than the placeholder greyscale used during RE.
2. `exe-data.ts`'s `parseHunks()` against `game` — resolve the "raw file
   offsets happen to work" open question (`data-tables.md` §8) properly
   instead of relying on the coincidence. This hardens Phase 1-3's P1 work
   against silently breaking if a future table lookup lands somewhere the
   coincidence doesn't hold.
3. `sprite-bank.ts`'s P1 branch — `.pat` offset-table extraction
   (`graphics-formats.md` §7), already byte-exact confirmed.

**Done when:** `mstr1.pat`/`mstr2.pat`/`party1.pat`/`party2.pat` sprites
render correctly-colored (not greyscale) in the viewer, and monster/race
name + sprite pairs match (as manually spot-checked during RE).

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

### Phase 7 — Phantasie II, once unblocked

Once Phase 0 lands real P2 files: P1/P2 share the dungeon/scripting engine
entirely (Phase 3's code needs zero changes, just a new data source and the
P2-exclusive opcodes `0x14`-`0x17`). Graphics are the one area flagged as
possibly *not* shared with P1 — the reference source suggests P2's `.PAT`
sprite banks use the ST word-interleaved layout (like P3's CMP) rather than
P1's raw Amiga planar layout, despite the shared `.pat` extension
(`graphics-formats.md` §9, `data-tables.md` §2) — verify this against real
extracted P2 files before assuming `sprite-bank.ts`'s P1 branch applies
unchanged.

## 4. Near-term action items (first PR-sized chunks)

1. `bitplane.ts` + `palette.ts` with tests (unblocks everything).
2. `cmp.ts` decoding `title.cmp` end-to-end, viewable in `tools/viewer/`.
3. Scope and start Phase 0 (`.stx` extraction) in parallel — it's on the
   critical path for Phantasie II but touches none of the same code, so it
   can proceed independently of Phases 1-3.

## 5. Open risks carried forward

Full list with evidence pointers: [`TODO.md`](TODO.md). The two with the
widest blast radius if wrong:

- **P1 hunk-addressing coincidence** (`data-tables.md` §8) — every offset
  used so far works as a raw file offset into `game`'s 240-hunk executable,
  which structurally shouldn't generalize. Phase 4 should resolve this via
  `parseHunks()` before trusting any *new* offset found later by inspection
  rather than by re-deriving through the hunk table properly.
- **Phantasie II extraction (Phase 0)** — every P2 claim in every doc is a
  hypothesis carried from the reference source's C# code, never checked
  against this project's actual data, because there isn't any yet. Treat
  all P2-specific format claims as unverified until Phase 0 and Phase 7
  land.

## 6. Scaffolding already wired

As part of this planning pass, `src/game-id.ts` and
`tools/shared/game-config.ts` (and its `seer.config.ts` mirror) were updated
to register all three game/platform pairs (`phantasie/amiga`,
`phantasieii/atarist`, `phantasieiii/amiga`) — previously only the
`phantasieiii/amiga` placeholder existed despite all three games' data
already being present under `data/`. All three remain `supported: false`
until their respective phases above land real `exportGameData`/
`buildAssets` implementations.
