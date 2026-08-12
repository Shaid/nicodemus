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

### A1 — Dungeon view

**Goal:** grid-stepped movement, wall collision, star-triggering over a real top-down PixiJS render.

**New:** `src/dungeon/DungeonScene.ts` (owns `TopDownCamera` for viewport math only; a `Container` of `Graphics` rects — flat-color tiles via `classifyCell`, reusing `dungeon-viewer.ts`'s verified `KIND_COLORS` palette, ported from Canvas 2D fill to PixiJS `Graphics`; player position/facing marker; message/choice overlay), `src/dungeon/DungeonInput.ts` (`KeyState`-based discrete step/turn; on each step, dispatch on `classifyCell`: `wall`/`secretWall` block, `door` per state, `star` → `executeStarChain` via `DungeonHost`, `randomEncounter`/`fixedEncounter` → `CombatScene`, `trap`/`triggeredTrap` → damage formula, `stairsExit`/`stairsInter` → scene transition), `src/dungeon/DungeonRenderer.ts` (pure cell-code→color mapping, factored out so A7's art swap doesn't touch movement/collision).

**Consumes:** `dungeon-p3.ts`, `dungeon.ts`, A0's `DungeonHost`, `messages.ts`, the `dungeon-<id>.json` output `tools/phantasieiii/build-dungeons.ts` already produces.

**Adapting vs. new:** tile-color render is a direct PixiJS port of `dungeon-viewer.ts`'s `renderGrid()` — mechanical, low-risk. Movement, collision, door/trap/encounter dispatch: entirely new (the viewer has no player-position concept at all).

**Done when:** a P3 dungeon renders and is walkable; walls block movement; a star cell shows a real message+choice UI and applies a real mutation (verified via A0); an encounter cell hands off to `CombatScene` (stubbed until A2, then real).

### A2 — Combat

**New:** `src/combat/formulas/combat-rng.ts` (`interface CombatRng { roll(range): number }`, `createP3Rng(seed)` implementing the confirmed LCG), `src/combat/formulas/p3-combat.ts` (two-branch to-hit formula, class-indexed die tables, strict-`>` compare, damage roll, `applyDamage`; class-indexed lookup tables loaded as opaque data per their confirmed addresses — extracting their *contents* is a small prerequisite tracked against `scripting-p3-lookup-tables`, not a blocker discovered fresh here), `src/combat/CombatEngine.ts` (turn orchestration, victory/defeat/flee, XP/gold reward via `PartyState`), `src/combat/CombatScene.ts` (modal UI, `PointerState`, HP bars, combat log).

**Consumes:** `monster-data.ts` (80 records), `exe-data.ts` (skills table), A0's `PartyState`.

**Adapting vs. new:** entirely new — no existing tool touches combat.

**Done when:** a scripted, fixed-seed test battle against known monster+party data produces a deterministic outcome matching the formula; `DungeonScene`'s encounter cells launch real `CombatScene` and return to the dungeon on resolution.

### A3 — Overworld / world-map traversal loop

**New:** `src/render/tile-render.ts` (shared viewport-culled tile blit, generalized so `DungeonScene` doesn't duplicate it), `src/overworld/OverworldScene.ts` (render driven by `p3-overworld.ts`'s `p3TerrainClass`/`P3_TERRAIN_BANDS`, party token, camera follows via bounded `TopDownCamera` pan — not free WASD scroll), `src/overworld/OverworldInput.ts` (`KeyState`-based step movement across the 50×75 grid; each step checks `P3_OVERWORLD_LOCATIONS` for a coincident marker), `src/overworld/OverworldHost.ts` (thin for P3 — `LocateSpecial()`'s logic is just membership-testing `P3_OVERWORLD_LOCATIONS` against the party's `(x,y)`, already fully decoded as data).

**Consumes:** `p3-overworld.ts`, the `world-map.json`/`world-map-pois.json`/`textures/terrain-tiles.png` assets already emitted.

**Open item — needs a short RE pass before this sub-phase is complete (not before it starts):** P3's random-overworld-encounter mechanism (trigger rate, monster roster, terrain dependence) is **not in this project's RE corpus at all** — no doc documents a P3 overworld encounter table the way `dungeon.ts`'s `randomEncounter` cell kind does for dungeons. A placeholder fixed-probability roll against a hand-picked monster subset can unblock rendering/movement/town-entry work in the meantime, clearly marked `// TODO: unverified encounter mechanism, see TODO.md`.

**Adapting vs. new:** terrain-tile render adapts `map-viewer.ts`'s blit logic directly. Party-token movement, camera-follow, location-entry dispatch: new.

**Done when:** the party can walk the full P3 overworld, enter all 30 named locations, and (once the open item resolves or is stubbed) trigger combat mid-traversal.

### A4 — Town/shop loop

**Investigation prerequisite:** P3 has **no separate town-data format** — a town is just a `LocateSpecial()` marker with `type: 'town'`. What P3's actual in-town interaction consists of (menu structure, shop inventory source, training/tavern mechanics) has not been reverse-engineered. Before `TownScene` is real code: locate the code that runs on a `type: 'town'` position match, and determine whether shop stock comes from `inititem.dat` (already decoded — `data-tables.md` §6.4, `stock[18 armouries][181 item ids]`, which strongly suggests towns do have per-town shop data even without a `twns.int`-shaped file) or elsewhere.

**New (post-investigation):** `src/town/CharacterCreationScene.ts` (race/class selection, stat rolls from `exe-data.ts`), `src/town/TownScene.ts` (hub menu, structure per the investigation), `src/town/shops/*` (one module per confirmed shop type, at minimum an armoury wired to `inititem.dat`'s stock table).

**Done when:** a new character can be created and equipped from a real armoury's stock, and the town hub is reachable from/returns to the overworld at the correct `LocateSpecial()` coordinate.

### A5 — Integration

Wire A0-A4 into one boot-to-play path via `src/app/PhantasieApp.ts`/`SceneManager.ts`, rewritten `src/main.ts` — pure wiring, no new decoder consumption.

**Done when:** from a blank browser tab, create a character → leave town → walk the world map → find and enter a dungeon → fight an encounter → return to town, one continuous session.

### A6 — Save/load (scope decision, plan for both)

If in scope: `src/state/save/SaveManager.ts`, `localStorage`-backed serialization of `GameStateSchema`. If out of scope for the first playable slice: note explicitly and defer past A5 (A5's exit bar doesn't require it).

### A7 — Stretch: real tile art

Swap `DungeonRenderer.ts`/`tile-render.ts`'s flat-color fills for real sprite frames (`sprite-bank.ts`, `set.ts`). Purely additive; do not start before A1-A5's loop works.

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
6. P3's random-overworld-encounter trigger mechanism (A3)
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
