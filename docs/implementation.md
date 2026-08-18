# Phantasie Browser Game — Implementation Plan

## Context

Reverse-engineering for all three Phantasie games is essentially complete: every format is decoded and pipeline-wired — graphics, world maps (including P3's castle-of-light/castle-of-dark/Netherworld), dungeon grids, the full star/action/message script interpreter (`executeStar`/`executeStarChain`, already exercised end-to-end against real data via a click-to-inspect viewer panel), monster/race/item/skill/spell data tables, and music. What's still missing is Phase 6 of `docs/phantasie/implementation-plan.md`: an actual playable runtime engine. `src/main.ts` is still the unmodified Seer boilerplate template; there is no game loop, no `src/dungeon/`/`src/town/` module tree, nothing beyond the pure decoders and the viewer's static, read-only inspection tools.

This plan turns that decoded data into a real playable browser game — Phantasie III first, then Phantasie I and II added on top, since P3 has the richest confirmed data and P1/P2 share one engine with each other that's a close structural cousin of P3's. It covers (a) a detailed plan for the P3 implementation, (b) dedicated sections for adding P1 and P2, and (c) a clear catalog of exactly where P1/P2's game logic differs from P3's, so per-game branching decisions are never silently assumed during implementation.

**Confirmed architectural decision:** the dungeon view is a custom, first-party **top-down** PixiJS renderer (flat colors first, real tile art later) — not the sibling `@seer-project/dungeon` package (a more complete first-person raycasting framework found during research, validated against Black Crypt/Wizardry 6, but pre-1.0 with its own data contract and a fundamentally different presentation than Phantasie's actual original top-down look). First-person stays an optional, purely-cosmetic stretch goal after the top-down loop is functionally correct — this was already this project's stated direction in `docs/phantasie/implementation-plan.md`'s existing Phase 6 notes, and this plan does not revisit it. The runtime is built by extending `@seer-project/engine-2d`'s own primitives (`TopDownCamera`, `KeyState`, `PointerState`, `pixi-helpers.ts`) — not the sibling `@seer-project/dungeon` package, which is unrelated to this design (see §0).

**Reference structure**: phasing and doc conventions modeled on the sibling `middilgard` project's `docs/architecture-overview.md` (generic four-zone/pipeline/runtime template — this project's own `docs/architecture-overview.md` is the same template) and `docs/plan.md` (phased roadmap with status tables, dated correction blocks layered onto original text rather than silent rewrites, a "Critical files" table, numbered per-phase exit criteria).

See `docs/phantasie/implementation-plan.md`'s Phase 6 for the pointer into this document from that file's own phase history.

---

## 0. Runtime architecture

`@seer-project/engine-2d`'s `Game<TCamera>` (verified: `seer/packages/engine-2d/src/Game.ts`) wires exactly one `TopDownCamera` to exactly one `InputManager` for the app's whole lifetime, and `InputManager` (verified: `InputManager.ts`) hardwires WASD-pan/wheel-zoom/drag-to-pan against that camera — a shape built for a free-pan strategic map, not a game with four structurally different interaction modes (grid-stepped dungeon movement, token-on-map overworld traversal, menu-driven town UI, turn-based modal combat). `Game.ts`'s own doc comment explicitly invites replacing its render setup — it is a template, not infrastructure to build on unmodified.

**Decision:** do not instantiate `Game` as the top-level orchestrator. Build a thin, game-specific orchestrator (`src/app/PhantasieApp.ts`) that owns one PixiJS `Application` + stage directly, and delegates to a `SceneManager` that swaps `Scene` objects. Each `Scene` owns whatever camera/input it actually needs:

- **Dungeon / overworld scenes** reuse `TopDownCamera` for its viewport-transform math (`setViewSize`, `pixi-helpers.ts`'s `computeViewportBounds`/`screenToWorld`) but **not** `InputManager` — movement is grid-stepped (dungeon) or token-stepped (overworld), driven by `KeyState` (verified: `seer/packages/engine-2d/src/KeyState.ts` — its own doc comment: "useful for first-person movement, custom key bindings, or anything that isn't 'pan a 2D camera'") / `PointerState`, with the scene calling `camera.moveTo()` itself after each discrete step.
- **Town / combat scenes** are modal menu UIs over a static backdrop — `PointerState` for click targets, no camera pan.

**Proposed `src/` tree** (all new; nothing below exists today except the two files noted):

```
src/
  main.ts                          # rewritten; today's boilerplate replaced
  app/
    PhantasieApp.ts                # owns PixiJS Application + stage + ticker
    SceneManager.ts                # push/pop/replace between Scene instances
    Scene.ts                       # common interface: mount/unmount/update/handleResize
  state/
    PartyState.ts                  # live party/character records, GetStat/SetStat-equivalent
    CharacterState.ts
    GameFlags.ts                   # item/quest/bitmask flags the star/action opcodes mutate
    GameStateSchema.ts             # serializable shape of "a save"
    save/SaveManager.ts            # A6
  dungeon/
    DungeonScene.ts
    DungeonInput.ts
    DungeonHost.ts                 # real ExecuteStarHost
    DungeonRenderer.ts
  overworld/
    OverworldScene.ts
    OverworldHost.ts
    OverworldInput.ts
  town/
    TownScene.ts
    CharacterCreationScene.ts
    shops/                         # per confirmed twns.int / inititem.dat regions
  combat/
    CombatScene.ts
    CombatEngine.ts
    formulas/
      combat-rng.ts                # RNG interface + P1/P2/P3 concrete generators
      p1-combat.ts / p2-combat.ts / p3-combat.ts
  ui/
    MessageBox.ts
    ChoicePrompt.ts
    HUD.ts
  render/
    tile-render.ts                 # shared viewport-culled tile blit
existing, unchanged:
  src/game-id.ts, src/data/{GameData.ts,AssetLoader.ts}, src/assets/formats/*
```

`src/state/`, `src/combat/formulas/`, and the opcode-table-parameterized parts of `src/dungeon/` take a `GameId` parameter **from Phase A**, mirroring `opcodes.ts`'s existing `P1_OPCODES`/`P2_OPCODES`/`P3_OPCODES` pattern, even though only `phantasieiii` is wired end-to-end until Phase B — this is what lets Phase B/C avoid rewriting the interpreter/UI layer and only add per-game data plus the specific branches cataloged in §1.

---

## 1. Game-logic differences reference

Phases A/B/C's design decisions point back to these rows by system. Baseline: **P1 and P2 share one dungeon/script engine byte-for-byte** (content differs, code doesn't); **P3 is a separately-coded, structurally-parallel engine.** Most rows are really "shared P1/P2 baseline vs. P3," with a few genuine three-way splits called out.

### 1.1 Dungeon / script interpreter

**Shared across all three (one implementation), confirmed:** cell-ID semantic ranges, star/action record formats, opcodes `0x00`-`0x11`, the `ExecuteStar` control-flow loop, the dungeon-exit destination table mechanism, the item/monster name-table mechanism (`dungeon-format.md` §1/§3/§4, `scripting-engine.md` §5).

**Different, needs branching:**

| Row | P1 | P2 | P3 | Doc ref |
|---|---|---|---|---|
| Message storage | separate `MESSn` file | = P1 | embedded pointer/pool in the dungeon file | `scripting-engine.md` §3.1 |
| Action-table bounding | `0x0D 0x0D` terminator scan | = P1 | fixed 256-slot, no terminator | §2 |
| Opcode space above `0x13` | none (parser throws) | own `0x14`-`0x17` | own, disjoint `0x14`-`0x1B` (numeric overlap with P2 is coincidental — different engines) | §5 |
| **Opcode `0x12`/`0x13` behavior** | conditional floor-raise / below-threshold-gate + `ShowMessage` | unconditional-set / meets-threshold-gate + move-back + `goto` | unconditional-set / meets-threshold-gate + `goto` — **P2 and P3 agree, P1 is the outlier** | §5, §6.3(b) — `scripting-p2p3-stat-opcode-path`, resolved |
| Trap-damage formula | corrected linear `(cell-1)*5` | = P1 | preserves the older buggy `(cell-5)*5` clamped to 12 — **authentic bug, do not fix** | `dungeon-format.md` §6 |
| Trap-message-index formula | baseline | = P1 (assumed) | off-by-one vs P1/P2 | §6 |
| Grid dimensions | 33×38 | = P1 | 24×30 | §3/§5 |
| Cell range `0xDA`-`0xDC` (inter-level stairs) | used | used | `ReadCell` throws | §4 |

### 1.2 Combat resolution — the widest branching of any system

| Field | P1 | P2 | P3 |
|---|---|---|---|
| RNG | LCG `seed=seed*3677+3 mod 32768` | 7-word additive/rotate generator (**not** an LCG) | LCG `seed=seed*25173+13849 mod 65536`, parameterized `Random(range)` |
| To-hit compare | `>=` (miss on tie) | `>=` | strict `>` |
| To-hit/damage formula shape | byte-identical to P2 | byte-identical to P1 | two-branch (spellcaster/other), class-indexed die tables, rank-relative/difficulty terms |
| Damage magnitude | weapon-stat × variance − armor − groupAdj | = P1 | single class-indexed die roll (no equivalent formula shape) |
| Record strides | 282 B char / 58 B monster | 318 B char / 58 B monster | 262 B char, no flat monster array |
| `roundedHalf()` | Newton's-method integer sqrt, range 0-10 (not "half the roll") | reused unchanged | n/a |

Evidence: `scripting-engine.md` §7.1-§7.5, all disassembly-confirmed per game (P3's class-indexed lookup-table *contents*, not control flow, are the one open residue — see §1.7).

### 1.3 Message/text

Word-wrap width: P1/P2 40 chars, P3 38. P3 additionally distinguishes `OneLine`/`Windowed`/`Fullscreen` message types with no P1/P2 equivalent. `messages.ts` already handles both decode formats — only UI layout parameters differ.

### 1.4 World map — the largest architectural divergence

P1/P2 share one format exactly (terrain grid + POI table + text block + display-list; only size constants differ — P1 2,500 B/1,000 offset, P2 3,000 B/1,500 offset). Town/dungeon placement is **data** (POI records inside each section file).

P3 is categorically different: a single global 50×75 tile-index array, **no POI-table architecture at all**. Town/dungeon placement is **code** — `LocateSpecial()`'s ~1.8 KB of hardcoded literal `(x,y)` comparisons (`p3-overworld.ts`, verified: its own doc comment states "P3 has no `out*.dat`/`maps.int` equivalent — there is no POI side table to decode"). P3 also has two extra map types (castle interiors, Netherworld) with no P1/P2 equivalent.

This is why the overworld module needs **a real second implementation** in Phase B, not a config flag.

### 1.5 Character/stats

Shared: the stat-index-range convention (empirically validated across all three; P3 has its own remap rule on top). A `[6 class][15 level]` skill-progression table exists in both P1 (`twns.int`) and P3 (executable) — two columns are byte-identical between them, shared design content despite different storage.

Different: record strides (282/318/262 bytes), `GetStat`/`SetStat` dispatch mechanism (P1 has a clean resolver, P2 a completely different jump-table shape, P3 no abstract resolver — direct offset reads), skill count (P1 8, P3 9 — P3 adds Fire Bow with its own formula: `Str + 4×Dex + 2×Level + 10`, `+30` Thief, `+15` Elven, disassembly-confirmed), body-location damage tracking (P3 confirmed at `+0xF2`-`+0xFC`, 6 locations × Okay/Injured/Broken/Gone; **explicitly refuted** as the meaning of P1's superficially-similar fields), P3-only combat "Rank" field (front/middle/back, affects to-hit).

### 1.6 Items/spells

Shared 181-entry item-name-table mechanism; different empty-slot sentinel (P1/P2 `"NOTHING"`, P3 `"0"`). P3 has explicit item combat-power tables (`pointValue`/`attributesRequired`, byte-exact vs. the manual) and a 58-entry spell-name table with no documented P1/P2 equivalent in this project (an open documentation gap, not a stated absence of the mechanic).

### 1.7 Still open — do not assume values, use the placeholder policy in §5

P1 `statIndex` 7/8 field names; P1 combat field semantics (`monster.+0x2E/+0x14/+0x38/+0x16`, one status array, one damage constant) — both blocked on a live WHDLoad session the user must personally drive; P2's monster→player combat mirror direction (never traced); P1/P2 message choice-count heuristics beyond 3 spot-checked examples; P3's `0xF0` newline control code (unconfirmed against real data); P3's combat lookup-table *contents* (`scripting-p3-lookup-tables`).

---

## 2. Phase A — Phantasie III browser implementation

Ordered by dependency: A0 unblocks everything; A1/A2 are tightly coupled (encounters launch combat); A3/A4 can run in parallel with A1/A2 once A0 lands; A5 is integration; A6/A7 optional/stretch.

### A0 — State & host foundation

**Goal:** a real `ExecuteStarHost` (verified interface in `src/assets/formats/star-action.ts`: `showMessage(messageIndex)`, `promptChoice(min,max)`, `applyEffect(effect): ActionOutcome | void`, optional `onDeactivate`) that mutates live party state — replacing the viewer's no-op `makeInspectorHost` (verified in `tools/viewer/dungeon-viewer.ts`: empty `showMessage`, fixed `promptChoice`, empty `applyEffect`). This unblocks dungeon, town, and combat, which all read/write the same `PartyState`.

**New:** `src/state/PartyState.ts` (up to 6 `CharacterState` records; `getStat`/`setStat` mirroring `scripting-engine.md` §6.3's confirmed index-range convention, P3's remap rule applied for P3), `src/state/GameFlags.ts` (item/quest/bitmask flags for opcodes `0x18`/`0x19`), `src/dungeon/DungeonHost.ts` (implements `ExecuteStarHost`: `showMessage`→`ui/MessageBox.ts`, `promptChoice`→`ui/ChoicePrompt.ts`, `applyEffect` dispatches on `effect.kind`/`effect.name` to real `PartyState`/`GameFlags` mutations for every P3 opcode, returns encounter outcomes as scene-transition requests handled by `DungeonScene`).

**Consumes:** `star-action.ts` (`executeStar`/`executeStarChain`, `ExecuteStarHost`, `ActionEffect`), `opcodes.ts` (`P3_OPCODES`), `dungeon-p3.ts`/`dungeon.ts` (`classifyCell`).

**Adapting vs. new:** the interpreter call pattern (`starTableToMap`/`actionTableToMap`/`executeStar`) reuses `dungeon-viewer.ts`'s pattern verbatim. Genuinely new: the host implementation's body — every `applyEffect` branch.

**Done when:** a unit test drives `executeStarChain` against a real dungeon JSON (e.g. `dnga.dat` star 0) through `DungeonHost` with a fake `PartyState`, asserting real state mutation (item added, gold changed) — no UI required yet.

**Status update (2026-08-18):** A0 done. `src/state/CharacterState.ts` (flat 161-word P3 stat space + named race/class/level/HP fields, `getStat`/`setStat`), `src/state/PartyState.ts` (6 slots + gold + item bag, party-wide helpers), `src/state/GameFlags.ts` (opcode 0x18/0x19 bitmask arithmetic), and `src/dungeon/DungeonHost.ts` (a real `ExecuteStarHost` covering every P3 opcode, queueing `encounter`/`teleport`/`setCell`/`win` events for the scene) are built, with `src/dungeon/__tests__/DungeonHost.test.ts` driving the real `dnga.dat` through `executeStarChain` — star 0 gives item 122, star 1 adds 512 gold, and star 5 walks the full quest-bitmask chain (stat gate 0x13 remap 127→66 → bitmask gate 0x19 → +Item 180 → item gate 0x17 → set-bitmask 0x18 → +Item 127; the repeat trigger yields the +Gold 25600 reward). Two deliberate deviations from this section's original file list: `ui/MessageBox.ts`/`ui/ChoicePrompt.ts` are deferred to A1 (they need a scene to host them — the host instead takes a `DungeonHostPresenter` seam), and `state/GameStateSchema.ts` is deferred to A6 (it is the save-shape deliverable). Opcode 0x1B ("stat increment all") is a marked no-op: its target stat index is not confirmed (`scripting-p3-0x1b-stat-index`), and the §5 placeholder policy forbids guessing. `tsc --noEmit` and `eslint` clean; the 6 new tests green (one pre-existing flaky timeout in `pic.test.ts` is unrelated).

### A1 — Dungeon view

**Goal:** grid-stepped movement, wall collision, star-triggering over a real top-down PixiJS render.

**New:** `src/dungeon/DungeonScene.ts` (owns `TopDownCamera` for viewport math only; a `Container` of `Graphics` rects — flat-color tiles via `classifyCell`, reusing `dungeon-viewer.ts`'s verified `KIND_COLORS` palette, ported from Canvas 2D fill to PixiJS `Graphics`; player position/facing marker; message/choice overlay), `src/dungeon/DungeonInput.ts` (`KeyState`-based discrete step/turn; on each step, dispatch on `classifyCell`: `wall`/`secretWall` block, `door` per state, `star` → `executeStarChain` via `DungeonHost`, `randomEncounter`/`fixedEncounter` → `CombatScene`, `trap`/`triggeredTrap` → damage formula, `stairsExit`/`stairsInter` → scene transition), `src/dungeon/DungeonRenderer.ts` (pure cell-code→color mapping, factored out so A7's art swap doesn't touch movement/collision).

**Consumes:** `dungeon-p3.ts`, `dungeon.ts`, A0's `DungeonHost`, `messages.ts`, the `dungeon-<id>.json` output `tools/phantasieiii/build-dungeons.ts` already produces.

**Adapting vs. new:** tile-color render is a direct PixiJS port of `dungeon-viewer.ts`'s `renderGrid()` — mechanical, low-risk. Movement, collision, door/trap/encounter dispatch: entirely new (the viewer has no player-position concept at all).

**Done when:** a P3 dungeon renders and is walkable; walls block movement; a star cell shows a real message+choice UI and applies a real mutation (verified via A0); an encounter cell hands off to `CombatScene` (stubbed until A2, then real).

**Status update (2026-08-18):** built in gameplay order (after overworld). `src/dungeon/DungeonRenderer.ts` (cell→colour map, so A7's art swap stays out of the scene) and `src/dungeon/DungeonScene.ts` — flat-colour top-down render, grid-stepped arrow/WASD movement, wall collision, trap damage via `p3TrapDamage` (and the cell flips to the 0x07 triggered sentinel), star cells run the real A0 `DungeonHost` chain with a real message+choice modal, and `stairsExit` returns to the overworld. The star's message/choice is presented *before* the chain runs and the interpreter is left synchronous/unchanged (the presenter only queues opcode-0x0B messages, shown after) — no async refactor of `star-action.ts` was needed. First-pass simplifications, all marked in the code: secret walls block, locked doors block, encounters are a stub (A2), the player starts at the first non-wall cell (real entry is the exit-destination table, not yet emitted), and interactive choice is offered only on a star's first hop (`gotoStar` later choices auto-resolve to 1). Entering a dungeon POI on the overworld now opens the matching `dungeon-<letter>.json`.

### A2 — Combat

**New:** `src/combat/formulas/combat-rng.ts` (`interface CombatRng { roll(range): number }`, `createP3Rng(seed)` implementing the confirmed LCG), `src/combat/formulas/p3-combat.ts` (two-branch to-hit formula, class-indexed die tables, strict-`>` compare, damage roll, `applyDamage`; class-indexed lookup tables loaded as opaque data per their confirmed addresses — extracting their *contents* is a small prerequisite tracked against `scripting-p3-lookup-tables`, not a blocker discovered fresh here), `src/combat/CombatEngine.ts` (turn orchestration, victory/defeat/flee, XP/gold reward via `PartyState`), `src/combat/CombatScene.ts` (modal UI, `PointerState`, HP bars, combat log).

**Consumes:** `monster-data.ts` (80 records), `exe-data.ts` (skills table), A0's `PartyState`.

**Adapting vs. new:** entirely new — no existing tool touches combat.

**Done when:** a scripted, fixed-seed test battle against known monster+party data produces a deterministic outcome matching the formula; `DungeonScene`'s encounter cells launch real `CombatScene` and return to the dungeon on resolution.

**Status update (2026-08-18):** built in gameplay order (last). `combat/formulas/combat-rng.ts` (the confirmed LCG `seed=(seed*25173+13849)&0xFFFF` → `&0x7FFF`, `Random(range)=1+seed%range`), `combat/formulas/p3-combat.ts` (`resolveAttack` implementing §7.5's two-branch to-hit formula with §7.5.1's corrected operands — die rolled before the strict-`>` percentile roll, rank-relative `×30` term, status/difficulty penalties — plus `combatStatsFor`/`fireBowMax`/`pointValue` derivations and a `monsterStatsFor` mapping), `combat/CombatEngine.ts` (party→monster uses the confirmed formula; turn loop, victory/defeat), and `combat/CombatScene.ts` (modal HP bars + log + Fight/Flee). `CharacterState` gained `attributes`/`rank`. Encounter cells (`randomEncounter`/`fixedEncounter`/`door:encounter`) now launch `CombatScene`, which returns to the dungeon (re-created at the resume cell) or to the overworld on defeat. `combat/formulas/__tests__/p3-combat.test.ts` locks the RNG sequence and two `resolveAttack` cases. **Marked approximations** (the open §1.7 items): `monsterStatsFor` maps `monster.+0x28` armor to `monsinfo.dat`'s `armorRating` (runtime combat record unmapped), and the monster→player mirror is a plain `attackRaw*10`%-chance approximation (P3's mirror was never traced); the Fire branch and combat-menu weapon selection are fixed to melee until the combat menu exists; XP reward is a TODO. Combat RNG is seeded from `Date.now()` (save/seed persistence is A6).

> **Spell-casting research pointer (2026-08-18):** the non-combat "Cast
> Spell" path (Options menu / character screen) is now fully traced and
> ready to implement — `docs/phantasie/spell-format.md`. Healing I-IV's
> HP-roll table and its point-budget body-location cure (confirmed:
> Healing III/IV *can* clear a `Gone` location, unlike the Inn) and
> Resurrection's full effect (revive at 1 HP, full MP, all six body
> locations unconditionally cleared, `-1`/`-2` Constitution) are both
> disassembly-confirmed against the real SSI manual with zero deviation.
> MP cost is a fixed per-spell table, deducted only on success. **Not**
> covered: the in-combat "Spell" menu option calls a still-unlocated,
> separate implementation (the shared non-combat dispatcher this pass
> traced has exactly 2 callers project-wide, neither the combat menu) —
> the "Fire branch... fixed to melee until the combat menu exists" note
> above is unaffected by this finding; combat spellcasting generally
> (including the other 51 spells, all Combat-typed and explicitly
> refused by the non-combat path) remains a real gap, not just Fire.

> **Known gap, fixed with a debug placeholder (2026-08-18):** "returns... to
> the overworld on defeat" above used to undersell what actually happened —
> a defeated party was left with every member at `hp: 0, alive: false` and
> dropped back onto the overworld with no game-over screen and no recovery
> path at all (the Temple, which would fix this for real, is itself a
> `TownScene` stub — §A4 above). `CombatScene` now routes defeat to
> `src/app/JudgmentScene.ts`, which shows the real `w2.cmp` judgment
> backdrop with honest framing (the real obliterate/undead/resurrect
> mechanic isn't reverse-engineered — `scripting-p3-death-judgment` in
> `TODO.md`, `dungeon-format.md` §9.0.1's correction block) and, on
> "Continue", fully heals and revives the party (`reviveParty` in
> `PartyState.ts`) rather than simulating any real outcome — a deliberately
> generous debug/testing convenience (owner's call) so a wipe doesn't
> require recreating characters every test run, not a claim about what the
> real mechanic does.

> **Status update (2026-08-18) — post-victory rewards wired to the
> confirmed mechanic, and a real bug fixed along the way.** `CombatScene`
> used to read the reward from `battle.monsters[0].record.gold` — but
> `CombatEngine.partyRound()` filters `battle.monsters` down to the living
> on every round, so by the time a battle is won the array is empty and
> that read threw. Fixed by keeping the originating `MonsterRecord` as its
> own field. Rewards now match `town-format.md` §3.8 exactly: gold is
> awarded instantly to `party.gold`, Experience is pooled into the new
> `PartyState.pendingXp` rather than divided immediately (division happens
> in town — see the A4 status update below). Item drops are deliberately
> NOT modeled — the monster drop-table/trigger logic was never traced
> (§3.8's own "Open" note), so there's nothing confirmed to implement.
> `CombatResume` is now a `{kind: 'dungeon' | 'overworld'}` discriminated
> union rather than always assuming a dungeon origin — required for A3's
> overworld encounters (below) to route `Flee`/victory/defeat back to
> `OverworldScene` instead of crashing into a nonexistent dungeon return.

### A3 — Overworld / world-map traversal loop

**New:** `src/render/tile-render.ts` (shared viewport-culled tile blit, generalized so `DungeonScene` doesn't duplicate it), `src/overworld/OverworldScene.ts` (render driven by `p3-overworld.ts`'s `p3TerrainClass`/`P3_TERRAIN_BANDS`, party token, camera follows via bounded `TopDownCamera` pan — not free WASD scroll), `src/overworld/OverworldInput.ts` (`KeyState`-based step movement across the 50×75 grid; each step checks `P3_OVERWORLD_LOCATIONS` for a coincident marker), `src/overworld/OverworldHost.ts` (thin for P3 — `LocateSpecial()`'s logic is just membership-testing `P3_OVERWORLD_LOCATIONS` against the party's `(x,y)`, already fully decoded as data).

**Consumes:** `p3-overworld.ts`, the `world-map.json`/`world-map-pois.json`/`textures/terrain-tiles.png` assets already emitted.

**Open item — needs a short RE pass before this sub-phase is complete (not before it starts):** P3's random-overworld-encounter mechanism (trigger rate, monster roster, terrain dependence) is **not in this project's RE corpus at all** — no doc documents a P3 overworld encounter table the way `dungeon.ts`'s `randomEncounter` cell kind does for dungeons. A placeholder fixed-probability roll against a hand-picked monster subset can unblock rendering/movement/town-entry work in the meantime, clearly marked `// TODO: unverified encounter mechanism, see TODO.md`.

> **Correction (2026-08-18, game-re):** resolved — this is no longer an
> unresearched item. `dungeon-format.md` §9.0.6 traces the whole
> mechanism from the overworld step handler through to combat entry:
> gated on not standing at a named location and terrain class not being
> Water/Lava/River Styx, a base **7% per-step trigger roll**
> (`Random(100) <= 7`), a **5×5 region-grid danger-tier table** (confirmed
> spatially — the capital Pendragon's own region carries the table's one
> minimum value), a **terrain-dependent severity offset** (ordinary
> terrain 0-5, Bridge/Dense Fog/Netherworld terrain 8-12, confirmed
> byte-exact), and a shared **80-entry monster roster read wholesale from
> `monsinfo.dat`** (13-byte name + 25 stat bytes per record, byte-exact
> against the real file — `Skeleton` at index 0 through `Lord Wood` at
> index 79). Confidence is **confirmed** for the trigger/gating/roster
> plumbing and **narrowed** for the exact semantic split between outcome
> branches (which produce "ambush" vs. an ordinary fight vs. a
> party-member-flavoured vignette) — every branch traced this pass still
> reaches the same combat-entry routine, so a genuinely non-combat
> outcome was hypothesized but not demonstrated. See `TODO.md`'s
> `world-p3-overworld-encounter-outcomes` row for what's still open.

**Adapting vs. new:** terrain-tile render adapts `map-viewer.ts`'s blit logic directly. Party-token movement, camera-follow, location-entry dispatch: new.

**Done when:** the party can walk the full P3 overworld, enter all 30 named locations, and (once the open item resolves or is stubbed) trigger combat mid-traversal.

**Status update (2026-08-18):** built in gameplay order (after town). `src/overworld/OverworldScene.ts` renders the pre-baked `screens/world-map.png` under a bounded `TopDownCamera` (zoom 2, follows the party token), steps the party on arrow/WASD via `KeyState`, and resolves `world-map-pois.json`'s 30 `LocateSpecial()` markers — stepping onto a town hands back to `TownScene` (with the town's name/coords), dungeon/inn entry is a marked stub until A1's dungeon scene lands. Two deliberate consolidations vs. this section's file list: `OverworldInput.ts`/`OverworldHost.ts` are folded in (P3's input is a few `KeyState` presses and its "host" is a `(x,y)→POI` map lookup), and `render/tile-render.ts` is skipped (P3 ships a whole-world PNG, so the blit is one `Sprite`; the shared blitter is deferred to A7).

> **Status update (2026-08-18) — random encounters implemented, not just
> documented.** `src/overworld/p3-encounter-formulas.ts` implements
> `dungeon-format.md` §9.0.6's confirmed cascade: the 5×5 region-tier
> table and the terrain-severity table are both hardcoded directly (same
> treatment as `character-creation-formulas.ts`'s class/race modifier
> tables — small, fully-dumped, confirmed constant tables), `regionDangerTier()`/`rollOverworldEncounter()` reproduce the 7% trigger →
> region tier → 38%-ambush/62%-ordinary → monster-index pipeline, including
> the two confirmed index redirects (31→42, 53→42). `OverworldScene.step()`
> calls it after every move (skipped on a named-location cell — the
> exclusion-terrain check for Water/Lava/River Styx is baked into the
> formula itself) and, on a hit, replaces the scene with `CombatScene`,
> using the new `{kind: 'overworld', x, y}` resume shape from the A2
> update above. **Deliberate simplification, documented in the formula
> module's own header**: the real cascade's ambush/ordinary/party-member-
> flavored branches were only "narrowed" not "confirmed" (§9.0.6's own
> "Still open" table) — every concrete branch the RE pass traced still
> resolves to combat, so this implementation always fights; it does not
> attempt the party-member-personalized-flavor path or the exact message-
> code semantics, since those affect presentation text only, not
> confirmed to ever skip combat.

### A4 — Town/shop loop

**Investigation prerequisite:** P3 has **no separate town-data format** — a town is just a `LocateSpecial()` marker with `type: 'town'`. What P3's actual in-town interaction consists of (menu structure, shop inventory source, training/tavern mechanics) has not been reverse-engineered. Before `TownScene` is real code: locate the code that runs on a `type: 'town'` position match, and determine whether shop stock comes from `inititem.dat` (already decoded — `data-tables.md` §6.4, `stock[18 armouries][181 item ids]`, which strongly suggests towns do have per-town shop data even without a `twns.int`-shaped file) or elsewhere.

**New (post-investigation):** `src/town/CharacterCreationScene.ts` (race/class selection, stat rolls from `exe-data.ts`), `src/town/TownScene.ts` (hub menu, structure per the investigation), `src/town/shops/*` (one module per confirmed shop type, at minimum an armoury wired to `inititem.dat`'s stock table).

**Done when:** a new character can be created and equipped from a real armoury's stock, and the town hub is reachable from/returns to the overworld at the correct `LocateSpecial()` coordinate.

**Status update (2026-08-18) — first playable slice, built in gameplay order rather than this plan's A1→A4 sequence** (per request: town views → character creation → world map → dungeon → combat). The app scaffold (§A5's `PhantasieApp`/`SceneManager`/`Scene`) was built *first* so the menu scenes have somewhere to live, then `src/town/CharacterCreationScene.ts` and `src/town/TownScene.ts` on top of it. Character creation is data-backed (races/classes from `races.json`/`skills.json`) with placeholder roll and starting-HP formulas (`character-creation-rolls`, `character-creation-hp` — the game's own generation math is not yet in the RE corpus). `TownScene` is a **placeholder hub**, exactly per this section's investigation prerequisite: the Armoury browses the real `items.json` catalogue at base price, and Inn/Temple/Tavern/Training are stubs — P3's real in-town structure and `inititem.dat` per-town stock selection are still the open investigation, NOT silently assumed. `ui/menu.ts` supplies the PixiJS button/label/menu primitives (built-in pointer events, not `PointerState`, which is reserved for traversal scenes). Boots via `npm run dev` → create party → town → (stub) leave town.

> **Correction (2026-08-18, RE pass) — the investigation is done; the
> assumed facility set was wrong.** P3 has **no Temple and no Tavern**
> anywhere in its executable strings, its captured screenshots, or its
> town command dispatcher. The real in-town command set — found by
> tracing the single, unified keystroke dispatcher (`file 0xb1f4`/
> `0xbbe4`, one caller in the whole binary) and cross-checked against
> real Amiga screenshots already in this repo (`data/default_58.png`-
> `88.png`) — is three pull-down menus: **`File`** (Info/Load/Save),
> **`Guild`** (Add/Drop/Examine/New/Purge/Rename Member, Learn Spells,
> Training), and **`Options`** (**Armoury**/**Bank**/**Inn**/**Mystic**/
> Exit, plus Cast Spell/Distribute/Trade Item/Use Item/View Party). Full
> byte-level detail, confidence grading, and the paths-tried table for
> what's still open: `town-format.md`.
>
> **Decoded this pass, ready to wire in directly:**
> - **Inn** (`I`, worker file `0x11bea`) is P3's healing/curing facility
>   (there is no separate Temple): ages the character +1/26 year, heals
>   HP to max and repairs body locations (except `Gone`) gated by a flag,
>   and rolls a chance for Magic Power max to grow toward a class/level
>   chart ceiling, refilling current MP on success. All four mechanics
>   and every field offset are code-confirmed — `town-format.md` §3.1.
> - **Character creation attribute rolls** (`character-creation-rolls`):
>   confirmed as **3d6 + a class-indexed modifier table + a second
>   6-row modifier table (index not yet identified — plausibly a race
>   category) + 3**, both modifier tables' full byte content dumped —
>   `town-format.md` §4.2. Luck is `Random(6)+7`, then adjusted by raw
>   race index.
> - **Starting HP/MP** (`character-creation-hp`): confirmed as
>   `MP = 75% of a [6 class][15 level] chart's level-1 entry` (the same
>   chart the Inn reads for MP growth) and `HP = sum of N dice, each
>   Random(2)+1, where N comes from a [6 class][21] table's level-1
>   entry` — not the manual's Fighter=10 chart directly, but consistent
>   with it as that formula's minimum roll (Fighter's `N=5` gives a
>   10-15 range). Both tables' full byte content dumped —
>   `town-format.md` §4.3.
> - **Armoury** (`A`, per-character, worker chain `0xb3be`→`0x10fca`→
>   the already-confirmed stock builder `0x8b5a`, `data-tables.md`
>   §6.4/§7) — confirmed via `data/default_88.png` matching the decoded
>   armoury-1 stock row item-for-item.
> - **Training** (`T`, worker file `0xde34`) — the cost formula (armoury
>   markup% × Charisma-modified base × two new level-indexed tables at
>   `hunk1+0xA4C`/`0xA6A`) is confirmed; the actual stat-increase
>   application past the confirm dialog was not traced — `town-format.md`
>   §3.2.
> - **Mystic** (`M`, worker file `0x1209a`) — structure only (a party-wide
>   reputation/eligibility scan feeding a tiered outcome); not P3's
>   equivalent of anything HP/curing-related, that's the Inn — its actual
>   effect is still open, `town-format.md` §3.3.
>
> **What `TownScene`/`CharacterCreationScene` should do differently**
> (full detail `town-format.md` §6): rename the facility menu to
> Armoury/Bank/Inn/Mystic/Exit (drop Temple/Tavern/Training as top-level
> facilities — Training moves to the Guild menu alongside Learn Spells);
> wire the Inn to the four confirmed mechanics above instead of a stub;
> wire `rollAttributes()`/`addMember()`'s starting HP to the confirmed
> formulas instead of a flat uniform 3-18 roll and a flat 10 HP (using
> the neutral, all-10 row of the second modifier table as an interim
> default until its real index is identified is a reasonable stopgap,
> noted in code).

> **Correction (2026-08-18, second RE pass, same day) — the three items
> the first pass left open are now all resolved; only narrower residuals
> remain.**
> - **Character creation's `selector` modifier table**: no longer a
>   placeholder concern. `selector = char.+0xA8` (the character's own
>   raw race index, 0-17) — traced directly to its producer (file
>   `0x13320`). The modifier table itself turned out to be a full 90-byte,
>   18-row race table (the first pass under-dumped it at 30 bytes by
>   analogy with the class table and mis-read the truncation as the real
>   table boundary); every row is a thematically coherent per-race
>   stat profile. `rollAttributes()` can use `classModifier[class]` +
>   `raceModifier[race]` directly, no stopgap needed — `town-format.md`
>   §4.2.
> - **Training**'s actual effect, past the confirm dialog: **it's a
>   full level-up, paid for in gold instead of earned via Experience** —
>   `Level += 1` (capped 21), gold deducted, HP max/current re-rolled via
>   the *same* class/level dice table character creation uses (but
>   `Random(3)` per die, not creation's `Random(2)+1` — a confirmed,
>   deliberate asymmetry), and the game's own confirmed level-up
>   skill-maxima routine (`0xe67a`, the same one `scripting-engine.md`
>   §7.5.3 traced for `FireBowMax`) invoked 3× to refresh all 9 skill
>   pairs for the new level. `town-format.md` §3.2.
> - **Mystic**'s actual effect: **there isn't one.** Traced the worker
>   function to its own `RTS` and found zero field writes anywhere —
>   it's a pure read-only status/flavour report (a reputation-tier
>   greeting plus up to 3 conditional lines about two unnamed
>   per-character condition flags and any member with high Social
>   Class), not a shop, guild-dues mechanic, or curing service.
>   `town-format.md` §3.3.
>
> Two narrower items remain open (`town-p3-training-skill-selection`,
> `town-p3-mystic-flag-names` in `TODO.md`) but don't block wiring any
> of the above into real code — see `town-format.md` §5/§6.

> **Correction (2026-08-18, third RE pass, same day) — Learn Spells
> (`L`, worker file `0x1041a`) fully traced, the last stubbed facility
> this plan called out.**
> - **Eligibility**: same alive/not-"Out"/not-Undead gate as Inn and
>   Training, plus a class-specific spell-index range (Fighter/Thief/
>   Priest/Ranger/Monk/Wizard reach only a small, distinct slice of the
>   57-entry spell table via this screen — 13 indices total across all 6
>   classes) and a party-wide `$3136` "spells discovered" counter that
>   must clear a level/Intelligence-derived threshold.
> - **Cost**: same shape as Training — the confirmed armoury markup
>   table × a Charisma/Intelligence/class-derived multiplier, clamped
>   1-250 gold, checked against party gold. Gold is spent even on
>   failure.
> - **Which spell**: the player browses and picks from a filtered
>   candidate list (class range ∩ level-availability table ∩ not
>   already known party-wide) — not an automatic next-in-sequence
>   unlock.
> - **Success roll and the write**: `Random(20) > Intelligence` fails
>   (money still spent, nothing learned); on success, `LearnSpell`
>   (file `0x10adc`) appends the spell index to `char.+0xB0` (a 32-slot
>   word array, count tracked at `+0x56`) — **except** spell 57 ("Divine
>   Aid"), which gets its own dedicated `char.+0xF0` word field instead,
>   matching opcode `0x19`'s already-documented hardcoded special case.
>   This is an **offset-exact match** for `src/state/CharacterState.ts`'s
>   `knownSpells: number[]` field, confirming that data-model shape.
>
> One new open item (`town-p3-spell-discovery-tracker` in `TODO.md`):
> what actually increments the party-wide `$3136` counter that unlocks
> the other 44 spells beyond each class's small starting range wasn't
> traced — doesn't block wiring the Learn Spells screen itself, only
> whether the browser build can ever offer the higher-tier spells.
> Full detail: `town-format.md` §3.5.

> **Correction (2026-08-18, fourth/fifth RE passes, same day) — Bank
> fully traced (no open items), and the "return to town, assign/sell
> loot, divide Experience" flow the project owner remembered turned out
> to be one linked system, not three unrelated stubs.**
> - **Bank** (`B`, worker file `0x1183a`) — two persistent gold pools:
>   carried gold (`$44b2`, shared with Training/Learn Spells) and a
>   per-character banked balance (`char.+0xFE`, already named "Gold in
>   bank" by the character-sheet routine but never before traced to a
>   consumer). **Withdraw All**: sums every living member's banked gold
>   into carried gold, zeroing each — all-or-nothing. **Deposit**: splits
>   an entered amount evenly across every living member's bank, handing
>   the integer-division remainder out one gold piece at a time to
>   randomly-chosen members. `town-format.md` §3.6.
> - **`D) Distribute`** (worker file `0xbca4`, shared by two modes) —
>   **not** "split gold" as first guessed. Mode 2 (`D`'s own, menu-
>   reachable mode) is a full **reset**: un-equips the whole party and
>   recalls *every* character's entire carried-item history back into one
>   shared 60-slot pool. Mode 1 is **auto-triggered on town arrival**
>   (not reachable via any menu key) whenever pooled XP or loot exists —
>   it prompts a 1-3 share weight per living member, then divides pooled
>   Experience in two passes: an unweighted-random pass hands out
>   `floor(pendingXp/totalShares)` individual +1s to random living
>   members, then a weighted pass splits the remainder by share weight.
>   Both modes funnel into the **same item-assignment screen** afterward
>   (`0xc3e6`) — the "only this trip's loot" feel the owner remembered is
>   an emergent effect of *when* each mode runs relative to the shared
>   pool being drained (mode 1 fires before anything's been dumped in;
>   mode 2 dumps everything in first), not a hardcoded distinction.
> - **`G) Trade Item`** (worker file `0xf2e8`) — **not** sell-to-town
>   either. A direct item transfer between two named party members' own
>   9-slot carried-item inventories (`char.+0x2A` count, `hunk1+0x3da0`
>   array) — no gold or armoury pricing touched at all.
> - **Post-combat rewards** (battle-rewards function, file `0x19ce0`) —
>   gold is awarded **instantly** to carried gold; Experience and dropped
>   items are **pooled** (`$44ae`/`$44ac`) until the party is back in
>   town, where Distribute's mode 1 auto-fires. The monster-record fields
>   read (`+0x22`/`+0x24`) are the already-confirmed Gold/Experience
>   fields (`data-tables.md` §3) — a clean cross-check, not a new field
>   space. `town-format.md` §3.7/§3.8.
>
> **Runtime implication**: this project's per-character inventory isn't
> modeled yet (`PartyState.items` is still one shared pool, no
> `char.+0x3da0`-equivalent 9-slot array) — so Trade Item and the
> item-assignment half of Distribute's mode 1 aren't implementable yet
> without that refactor (`town-p3-per-character-inventory` in `TODO.md`).
> XP pooling and division **are** implementable without it — see the
> status update below.

> **Status update (2026-08-18) — Bank, Cast Spell (Healing/Resurrection),
> and the XP half of Distribute's auto-trigger are wired into
> `TownScene`; the item half is deliberately deferred.** `PartyState`
> gained `pendingXp` (the confirmed `$44ae` pool) and `bankDeposit()`/
> `bankWithdrawAll()`/`divideXp()` (`src/state/PartyState.ts`, unit-tested
> against the confirmed two-pass XP algorithm including its inherent
> small pass-2 rounding loss). `CharacterState` gained `bankedGold`
> (`+0xFE`), `experience` (`+0x102`), and `bodyLocations` (`+0xF2`-`+0xFC`,
> needed for healing spells — see below; nothing in this build damages a
> location yet, so it starts and stays `Okay` until a spell touches it).
> `TownScene.mount()` auto-opens the XP-divide screen when
> `party.pendingXp > 0`, matching the confirmed auto-trigger, minus the
> item-assignment step (no per-character inventory to assign into yet).
> Bank's deposit amount is a few preset buttons rather than the real
> game's free-typed amount — this project's UI has no numeric text-input
> widget yet. **Cast Spell** is new and covers exactly what
> `spell-format.md` calls "ready to implement end to end" — Healing I-IV
> (`src/town/spell-formulas.ts`'s `cureBodyLocations()`/`applyHealing()`,
> including genuinely clearing a `Gone` body location for tiers III/IV,
> the document's central finding) and Resurrection (revive at 1 HP, full
> MP, all six locations unconditionally cleared, Constitution
> `-= Random(2)` floored at 3) — every other spell index is correctly
> refused with the real game's own message, matching `spell-format.md`
> §3's confirmed "non-combat entry point implements only Healing/
> Resurrection/Transportation/Monster Evaluate" finding (Transportation/
> Monster Evaluate aren't wired — only narrowly traced, not full
> formulas). The in-combat Spell menu (all 51 Combat-typed spells) still
> has no located implementation at all (`spell-format.md` §8's largest
> open item) — `CombatScene`'s existing melee-only placeholder is
> unchanged, not a regression. Training's/Learn Spells' gold costs remain
> flat placeholders (documented in `TownScene.ts` itself) since their
> real formulas reference constant tables whose byte values weren't
> transcribed — not fabricated here either.

### A5 — Integration

Wire A0-A4 into one boot-to-play path via `src/app/PhantasieApp.ts`/`SceneManager.ts`, rewritten `src/main.ts` — pure wiring, no new decoder consumption.

**Done when:** from a blank browser tab, create a character → leave town → walk the world map → find and enter a dungeon → fight an encounter → return to town, one continuous session.

### A6 — Save/load (scope decision, plan for both)

If in scope: `src/state/save/SaveManager.ts`, `localStorage`-backed serialization of `GameStateSchema`. If out of scope for the first playable slice: note explicitly and defer past A5 (A5's exit bar doesn't require it).

**Status update (2026-08-18):** in scope, built. `src/state/GameStateSchema.ts` (v1 save shape: `{version, gameId, platformId, party, location, deactivatedStars, deactivatedActions}` with `isSaveState` validation), `src/state/save/SaveManager.ts` (`localStorage` JSON with `saveGame`/`loadGame`/`clearGame` + the `savePartyLocation`/`saveDungeonLocation` location builders), `src/app/TitleScene.ts` (Continue / New Game boot menu), `src/app/resume.ts` (`resumeScene` reconstructs the scene from the save; `hydrateParty` moved to `PartyState.ts` as a pure, tested helper). Wired save calls: overworld saves on every step, town on mount and on purchase, dungeon on step / after a star chain / after traps — the dungeon also persists its one-use star/action deactivation per level (`deactivatedStars`/`deactivatedActions`), so reloaded one-shot events stay spent. `src/state/__tests__/save.test.ts` covers `isSaveState` and `hydrateParty`. **Known limitation (TODO):** dungeon *cell* mutations (opcode 0x0E/0x0F `setCell`, the 0x07 triggered-trap sentinel) are not persisted — the grid reloads pristine from `dungeon-<x>.json`; only the deactivation tables carry over.

### A7 — Stretch: real tile art

Swap `DungeonRenderer.ts`/`tile-render.ts`'s flat-color fills for real sprite frames (`sprite-bank.ts`, `set.ts`). Purely additive; do not start before A1-A5's loop works.

**Status update (2026-08-18):** done, with the investigation outcome recorded. The "real sprite frames" parenthetical turned out not to apply — a pass over `dng.csh` (the palette installed for the dungeon view, graphics-formats.md §4.5.4's "dungeon" slot) shows it decodes to a 320×200 picture that is ~99% flat black with a thin border frame (63,597/64,000 background pixels; the 24×30 grid region is entirely empty). The original dungeon view is therefore a **flat shape render over that backdrop** — walls/doors in the tan family, floor black — with no per-cell tile set and no use of `sprite-bank.ts`/`set.ts`. A7 is implemented as that authentic look rather than invented tiles: `DungeonRenderer.ts`'s `KIND_COLORS`/`doorColor` now use the real `dng.csh` palette (tan `0x886644` walls, light-tan doors, black floor, and the palette's own orange/red/yellow/green for trap/encounter/star/stairs markers), and `DungeonScene` renders the `dng.csh` backdrop (`dng.png`) behind the grid, aspect-cover-fitted to the viewport. Semantic markers stay subtly tinted (the original hides stars/traps/encounters until stepped on) so the browser build remains legible.

> **Correction (2026-08-18, `game-re`, same day) — the investigation outcome above was wrong; `Dng.csh` is a real 9-icon dungeon-view tile bank, not a backdrop.** The "~99% flat black" observation was correct, but its interpretation wasn't: it contradicted graphics-formats.md §4.4's own render description two sections earlier ("`anatomy1.csh`, `dng.csh`, `scroll.csh` → small icon sprites... scattered... near the top-left"), which this status update never cross-checked. Full disassembly trace (`graphics-formats.md` §4.6, new this pass): `PhantasieIII`'s dungeon-entry init routine builds a runtime icon-pointer table from `Dng.csh` (`LAB_010C`, icon-table indices `0x2D`-`0x35`, 9 icons, 8×5px each); the dungeon-view redraw (`LAB_1374`/`LAB_1379`/`LAB_1388`) walks the **full 24-column × 30-row dungeon grid** (matching `dungeon-format.md` §3's already-confirmed dimensions exactly, 720 cells) and stamps one of those 9 icons per cell, chosen by the raw cell code — a near-exact match to `dungeon.ts`'s `CellClass` boundaries (wall/secretWall → one icon, horizontal/vertical door → two more, star → one, stairsExit → one, and every trap/encounter/message kind collapsed onto one generic "floor" icon, matching the original's "hidden until stepped on" design). Verified three independent ways: (1) the grid-walker's loop bounds and the icon-table's packing geometry, derived from disassembly alone, agree byte-exactly with each other and with the pre-existing confirmed grid dimensions; (2) two independently-decoded real dungeon levels (`dungeon-a`, `dungeon-e`), rendered top-down using nothing but the real decoded icon pixels and the disassembly-derived cell→icon mapping, produce legible, structurally sensible corridors/rooms/doors — not noise; (3) real Amiga emulator screenshots the project owner supplied this same pass (`data/default_72.png`, `default_74.png`, genuine dungeon-walk captures) show the walkable viewport's background texture repeating at an exact 8×5px period — `Dng.csh`'s exact icon dimensions — and a revealed door structure's colours matching `Dng.csh`'s real palette indices exactly. **Implemented, not just documented:** `src/assets/formats/dng-icons.ts` (new — `extractDngIconFrames`/`dngIconNameFor`), wired into `tools/phantasieiii/build-assets.ts` (`dng.json`'s `frames` array now carries the 9 real, named icon sub-rects, sliced from the existing `dng.png` — no new atlas image needed) and into the runtime: `DungeonRenderer.ts` now exposes `dngIconNameFor` (re-exported from `dng-icons.ts`) as the real per-cell icon lookup, and `DungeonScene.ts`'s `redrawGrid()` draws a pooled `Sprite` per cell, sliced from the atlas via `Texture`+`Rectangle` sub-frames, nearest-neighbour scaled to fill the cell — replacing both the flat-colour fallback (kept only for atlas-load failure) and the old full-screen `dng.png` backdrop stretch (which was itself built on the wrong hypothesis and has been removed). 8 new unit tests (`dng-icons.test.ts`), full suite green, `tsc --noEmit`/`eslint`/`vite build` all clean. Full evidence, the icon-role table, and two rendered-dungeon verification images: `graphics-formats.md` §4.6.

### Phase A summary

| Sub-phase | New modules | Decoders consumed | New vs. adapted |
|---|---|---|---|
| A0 | `state/PartyState.ts`, `state/GameFlags.ts`, `dungeon/DungeonHost.ts` | `star-action.ts`, `opcodes.ts`, `dungeon-p3.ts` | Interpreter call reused; host body new |
| A1 | `dungeon/DungeonScene.ts`, `DungeonInput.ts`, `DungeonRenderer.ts` | `dungeon-p3.ts`, `dungeon.ts`, `star-action.ts`, `messages.ts` | Render adapted; movement/collision new |
| A2 | `combat/*` (5 files) | `monster-data.ts`, `exe-data.ts` | Entirely new |
| A3 | `overworld/*` (3 files), `render/tile-render.ts` | `p3-overworld.ts`, world-map JSON | Render adapted; movement new; encounter trigger open |
| A4 | `town/*` | `exe-data.ts` (`inititem.dat`) | Needs RE pass first, then new |
| A5 | `app/*`, `main.ts` | none | Wiring only |
| A6 | `state/save/*` | none | New, scope-optional |
| A7 | edits to A1/A3 renderers | `sprite-bank.ts`, `set.ts` | New, stretch |

---

## 3. Phase B — Adding Phantasie I

Start only after A1/A2/A5 are functionally solid — reuses A's scene/host/combat *shapes*, not P3-specific data.

### B0 — Reuse audit

| Reused as-is | Needs a P1-specific branch/implementation |
|---|---|
| `executeStar`/`executeStarChain` loop shape | `P1_OPCODES` swapped for `P3_OPCODES` in `DungeonHost` |
| Opcodes `0x00`-`0x11` | Opcode `0x12`/`0x13`: P1 is genuinely conditional — needs its own branch, gated on `GameId`, not shared with P3's unconditional-set logic |
| `classifyCell`/cell-ID ranges | 33×38 grid (data, not code) **except** `stairsInter` (`0xDA`-`0xDC`) is P1/P2-only — `DungeonRenderer`/`DungeonInput` need to handle a kind P3 never exercises |
| `DungeonScene`'s render/movement/collision code | Message wrap width (38→40), separate `MESSn` file (already abstracted by `messages.ts`) |
| `CombatEngine`'s turn-loop structure | `combat/formulas/p1-combat.ts`: P1's own LCG, `>=` compare, weapon-stat×variance−armor−groupAdj damage, 282B/58B strides, `roundedHalf()` |
| — | `overworld/` needs a real second implementation (§1.4) — see B2 |
| — | `town/` needs a real second implementation against `twns.int` — see B4 |

**Verified: no `twns.int` decoder module exists yet anywhere in `src/assets/formats/`** (checked directly — grep for `twns`/town-decode functions returns nothing). B4 must create this module before building `TownScene`'s P1 branch; it is not just a matter of pointing existing code at a different file.

### B1 — Dungeon engine port

**New:** `src/combat/formulas/p1-combat.ts` (per B0), a P1 branch in `DungeonHost.applyEffect` for opcodes `0x12`/`0x13` (or split `DungeonHost` into a shared base + `P1DungeonHost`/`P3DungeonHost` if the divergence turns out non-trivial once implemented — decide based on how many opcodes actually diverge; today it's just these two).

**Placeholder policy for open items (§1.7):** `statIndex` 7/8 and the four unnamed `monster.*` fields get typed-but-unnamed constants (`STAT_UNKNOWN_7`, `MONSTER_FIELD_0x2E`, etc.) with a `// TODO(scripting-p1-stat-names / scripting-p1-combat-field-semantics): needs live WHDLoad oracle` comment — the formula executes correctly against real offsets; only the human-readable name is missing.

**Done when:** a P1 dungeon is walkable end-to-end with A1/A2's functional bar, against P1's own formulas.

### B2 — World-map traversal (real second implementation)

**New:** `src/overworld/p1p2/OutdoorHost.ts` (P1/P2's per-cell event-variant dispatch — text/bump/none — no P3 counterpart), `src/overworld/p1p2/OverworldScene.ts` (tile render via `outdoor.ts`'s `tileClass`/terrain names instead of `p3-overworld.ts`'s band classifier; movement using `tileMovementCost` — a real per-terrain mechanic P3 doesn't have; location-entry against `OutdoorPoi` records — data — instead of `P3_OVERWORLD_LOCATIONS` — hardcoded literals).

**Consumes:** `outdoor.ts` (`assembleWorld`, `decodeOutdoorSection`, `decodeMapsInt`, `tileMovementCost`), P1's `world-map.json`/`world-map-pois.json`.

**Done when:** the party traverses P1's full 77×126 world (18 stitched sections), enters towns/dungeons via real POI records, and terrain movement-cost visibly affects step timing.

### B3 — Combat (folded into B1)

Already covered by B1's `p1-combat.ts` — exit bar: a scripted deterministic-seed test battle produces the documented to-hit/damage sequence.

### B4 — Town interactions via `twns.int`

**Goal:** replace nothing (P3's model doesn't exist for P1) — build P1's real system. `TODO.md`'s `world-p1-twns-int-fields` is narrowed, not blocked: the shared 32-byte template and container regions 1 (training cost), 2 (ability/spell-unlock table), 3 (second capped stat), 4 (stat-improvement table), 5/6 (roll modifiers), 8 (25×282-byte hireling pool incl. 3 fixed elemental hires) are all identified.

**New:** the `twns.int` decoder module itself (first — see B0's note), `src/town/p1/TwnsHost.ts`, `TrainingShop.ts`, `HirelingTavern.ts`, `AbilityShop.ts` — one module per confirmed region, same shape A4 used for P3's armoury.

**Open item:** region 6's selector semantics are narrowed, not confirmed — same visible-TODO placeholder pattern as B1.

**Done when:** character creation, training, and hireling recruitment work against real `twns.int` data for at least one P1 town.

### B5 — Integration

Same shape as A5, `GameId === 'phantasie'` boot path, sharing `PartyState`/`SaveManager` unchanged (both already `GameId`-parameterized per §0).

---

## 4. Phase C — Adding Phantasie II

P2 shares P1's engine almost entirely — explicitly "reuse most of Phase B," not a third parallel build.

### C0 — Reuse audit

| Reused from Phase B | P2-specific |
|---|---|
| `dungeon.ts`, `star-action.ts`, `DungeonScene`/`Input`/`Renderer`, `p1p2/OverworldScene`+`OutdoorHost` (P2's world-map/POI format is the same as P1's — `world-p2-*` TODO rows all resolved) | `P2_OPCODES`'s own `0x14`-`0x17` extension wired into `DungeonHost` |
| B1's dungeon-engine port structure | `combat/formulas/p2-combat.ts`: **not an LCG** — the confirmed 7-word additive/rotate generator at its confirmed `JSR $FD40` call site; to-hit/damage otherwise byte-identical in shape/offsets/constants to P1's (low risk, mostly a copy with RNG swapped) |
| — | `GetStat` dispatch: P2's is a completely different jump-table shape from P1's, **even though** opcode `0x12`/`0x13` behavior agrees with P3 rather than P1 (§1.1) — the interpreter-behavior split and the stat-resolution-mechanism split are independent axes, don't conflate them |
| — | Record strides: 318 B char / 58 B monster |

**Genuinely open:** P2's monster→player combat mirror direction was never traced (only player→monster is confirmed). Implement player→monster first (same confidence as P1); stub the reverse with `// TODO: untraced, mirrors p1-combat.ts's structure by analogy only`.

### C1 — Dungeon + combat

**New:** `combat/formulas/p2-combat.ts`, P2's `0x14`-`0x17` branch in `DungeonHost`/`P2DungeonHost`. **Done when:** same bar as B1, against P2 data (including the confirmed real-shipped `0x17` win-marker in `DNG8`).

### C2 — World map

**New:** minimal if B2 was built `GameId`-parameterized from the start — otherwise split into `P2OverworldScene` once P2's own terrain-class table (`TERRAIN_CLASS_NAMES_P2`, 3 new classes: Dark Void, Molten Lava, Mist) proves to need branches rather than pure data-parameterization. **Done when:** same bar as B2, against P2's map.

### C3 — Town interactions

**Open item, needs its own RE pass before implementation (structurally identical to A4's P3 investigation):** **no P2 town-data-file equivalent to `twns.int` has been located or decoded in this project.** `dungeon-format.md` notes "no known pristine P2 counterpart for `OUT*.DAT` (unlike `TWNS.INT`)" — implying the reverse gap too: nothing confirms whether P2 ships a discrete town-record file or folds equivalent data into `PHANT.PRG` itself. Do not assume P1's `twns.int` module can be pointed at a same-shaped P2 file without confirming one exists.

**Done when:** the investigation either locates real P2 town data (implement per B4's pattern) or confirms P2's town data is read through `PHANT.PRG` at different offsets from the same conceptual layout (reuse B4's modules with new offsets) — either outcome is acceptable; don't proceed past this without one.

### C4 — Integration

Same shape as B5, `GameId === 'phantasieii'` boot path.

---

## 5. Unknowns and placeholder policy

**Needs live-oracle resolution before byte-exact (placeholder-with-TODO, never a guessed value):**
1. P1 `statIndex` 7/8 field names (B1) — `scripting-p1-stat-names`
2. P1 combat field semantics: `monster.+0x2E/+0x14/+0x38/+0x16`, one status array, one damage constant (B1) — `scripting-p1-combat-field-semantics`
3. P2's monster→player combat mirror direction (C1) — untraced, no TODO row yet
4. P3's combat lookup-table contents (A2) — `scripting-p3-lookup-tables`
5. P3's `0xF0` newline control code (A1, low priority)

**Needs a short new RE investigation before that sub-phase's implementation starts (not emulator-blocked, just unstarted analysis):**
6. ~~P3's random-overworld-encounter trigger mechanism (A3)~~ — **resolved**, see `dungeon-format.md` §9.0.6 and the correction block above
7. P3's actual in-town interaction structure (A4)
8. Whether/where P2 town data exists at all (C3)

**Narrow, low-risk, spot-check before relying on:**
9. P1/P2 message choice-count heuristics beyond 3 examples (A1/B1)
10. `twns.int` region 6's selector semantics (B4)

---

## 6. Critical files

| Path | Role |
|---|---|
| `src/assets/formats/star-action.ts` | `executeStar`/`executeStarChain`, `ExecuteStarHost` — every game's interpreter runs through this unchanged |
| `src/assets/formats/opcodes.ts` | `P1_OPCODES`/`P2_OPCODES`/`P3_OPCODES` — where §1.1's opcode divergence becomes code |
| `src/dungeon/DungeonHost.ts` | The single place P1/P2/P3's opcode `0x12`/`0x13` divergence must be branched correctly |
| `src/assets/formats/p3-overworld.ts` / `src/assets/formats/outdoor.ts` | The two structurally different world-map decoders A3/B2/C2 build scenes against |
| `src/combat/formulas/{p1,p2,p3}-combat.ts` | Where §1.2's RNG/to-hit/damage differences live |
| `docs/phantasie/TODO.md` | Live status for every §5 item — check before assuming any got resolved since this plan was written |
| `seer/packages/engine-2d/src/{TopDownCamera,pixi-helpers,KeyState}.ts` | Reused viewport-transform math and input primitives; `InputManager`/`Game.ts` deliberately **not** reused (§0) |

---

## 7. Verification

1. Every new decoder-adjacent module (`DungeonHost`, `combat/formulas/*`, `OutdoorHost`) gets a `__tests__/` file using real dungeon/combat JSON fixtures already produced by the pipeline — no mocking of `executeStar`/`classifyCell`, matching this project's existing real-byte-fixture discipline.
2. `npx tsc --noEmit` and lint clean after every sub-phase.
3. Each scene sub-phase (A1/A3/A4, B1/B2/B4, C1/C2/C3) gets a manual/Playwright walkthrough proving its "Done when" bar, not just unit tests — movement/collision/triggering pass in isolation and break in integration more often than not.
4. A5/B5/C4's integration bar is end-to-end: boot → create character → leave town → traverse overworld → enter dungeon → fight → return, for each game once its phase completes.
5. Before starting any sub-phase flagged in §5 as needing investigation (A3, A4, C3), do the investigation and update `docs/phantasie/TODO.md` with a resolved/narrowed row **before** writing the dependent scene code.
6. Update this plan's own phase markers in the same commit as the work, and add a dated correction block rather than rewriting a sub-phase's original text — this project's established convention.
