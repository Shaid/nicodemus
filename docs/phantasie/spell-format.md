# Phantasie III (Amiga) — Spell Casting

This document covers what happens when a P3 spell is actually *cast* —
traced from `data/phantasieiii/amiga/PhantasieIII` (AmigaOS HUNK
executable), building on the confirmed 57-entry spell name table
(`data-tables.md` §3.1, `readP3SpellNames()`) and the confirmed 262-byte
character record (`scripting-engine.md` §7.5.3). `town-format.md` §3.5
("Learn Spells") already traced spell *acquisition*; this document is the
separate, previously-untraced *effect* side.

**Address convention** (same as `town-format.md`/`scripting-engine.md`'s
P3 sections): all addresses below are **file offsets** into
`PhantasieIII`, i.e. `hunk-0 address + 0x28`. CODE-hunk `JSR`/absolute-long
operands in this file's raw bytes are stored **pre-relocation**; `real
target = raw operand + 0x28` for intra-hunk-0 references (verified via
this project's `HUNK_RELOC32` parse, same as `scripting-engine.md` §7.5).
A second, distinct correction applies to **DATA-hunk (hunk 1) absolute
references**, which this pass needed repeatedly and hadn't been written
up before: an instruction like `move.l $XXXX.l,-(a7)` whose raw operand
is listed in the CODE hunk's own `HUNK_RELOC32` block as targeting **hunk
1** (not hunk 0) is a **hunk-1-relative offset**, and its *file* content
(when the offset falls inside the stored `0x0000`-`0x277C` prefix, per
`scripting-engine.md` §7.5.1's confirmed data/BSS boundary) is at `file =
0x278C8 + rawOperand`. This is how every message-string reference and
every spell-parameter table cited below was resolved — confirmed by
cross-checking the resolved addresses against real, legible message
strings (§2) and against the manual's own numeric spell tables (§4, §7),
not assumed.

## 1. Manual as oracle

The primary source for this pass is `data/phantasieiii/Phantasie III -
The Wrath of Nikademus v1.0 (1987)(SSI)[compilation Bonus Ed.][1186].pdf`
(the same scanned 1987 SSI rule book already used as an oracle elsewhere
in this project, `data-tables.md` §3.1/§4.3, `scripting-engine.md`
§7.5.2/§7.5.3), read directly this pass via `Read`'s `pages` parameter
(PDF pages 14-20, the rule book's own printed pages 10-16: "MELEE" combat
menu, "MORTALITY: HIT POINTS AND BODY AREAS", "MAGIC", the "Spells
Available at Different Levels by Class" and "Spell Table" charts, and the
per-spell "SPELL LIST" descriptions). Every numeric claim below that cites
the manual is a direct quote or a direct transcription of its printed
table, not a paraphrase.

The manual's own words for the central question this document answers
(page 12, "MORTALITY"):

> "Healing spells and potions can Heal Body Areas as well as Hit Points.
> Each Healing spell or Potion will heal the most vital area it can. Each
> Area Gone counts as 1 Broken and 1 Injured Areas or 3 Injured Areas.
> Each Broken Area counts as 2 Injured Areas. The following chart lists
> the effects of different strength Healing spells and potions... Healing
> [spell] 1: 1 Injury. Healing 2: 1 Break or 2 Injuries. Healing 3: 1
> Gone, 1 Break & 1 Injury, etc. Healing 4: More than 1 Gone."

This directly contradicts the premise that only the Inn's body-location
repair exists, and that it — the Inn — cannot restore `Gone` (confirmed,
`town-format.md` §3.1). §4 below confirms, by full disassembly, that
**Healing III and Healing IV genuinely can and do clear a `Gone`
(severity `3`) body location**, exactly as the manual states.

## 2. Cast Spell entry points — confirmed

**Two, and only two, live callers of the shared spell-effect dispatcher
project-wide** — confirmed exhaustively via both of this project's two
established call-target-resolution techniques (`game-re-tooling/amiga.md`):
a whole-CODE-hunk scan for the literal 4-byte pre-relocation operand
`0xF8F8` (the dispatcher's raw `JSR` target) at any position listed in the
CODE hunk's own `HUNK_RELOC32` self-reference group, **and** a whole-hunk
scan for any PC-relative `JSR d16(PC)` (`0x4EBA`) whose resolved target is
file `0xF920` (`= 0xF8F8 + 0x28`). Both scans return the same two hits:

| Key | Location | Screen (§1 of `town-format.md`) |
|---|---|---|
| `C` | Options-menu dispatcher (`town-format.md` §2's jump table, `0xb1f4`/`0xbbe4`), slot `0x43`='C', handler file `0xb82a` | `default_65.png`, "Options" pull-down, "Party actions" group |
| `C` | A second, smaller per-character menu dispatcher, function file `0x8408`, "Cast Spell" arm at file `0x846a` | plausibly `default_69.png`'s character screen (`C/E/P/U` = Cast Spell/Examine/Party Status/Use Item) — not screenshot-cross-checked this pass, inferred from the identical eligibility idiom and shared filter constant (`0xa`) |

Both handlers use the **identical** eligibility idiom before calling the
shared worker (character-select via the project's already-known helper at
file `0x127f6`, filter param `0xa`(10) both times; reject dead/`Out`
(`Status == 0` or `3`, message `"This character is unable to do this."`);
reject an arm Broken/Gone (`char.+0xF6 > 1`, same message — see the
correspondence note in §4's body-location cure trace); reject zero known
spells (`char.+0x56 == 0`, message `"This character knows no spells."`),
then `JSR` the shared dispatcher, passing the caster's own party index.

**Not found this pass: the dedicated in-combat "Spell" menu option**
(`default_78.png`, `town-format.md` §1's "own dedicated menu" note).
Neither call-target scan above found a third caller, so combat's own
`Spell` choice does **not** reach this dispatcher — it must call a
separate, not-yet-located implementation. This is the single largest open
item in this document; see §8.

**Confidence: confirmed** (both entry points' addresses, eligibility
chain, and message strings all byte-verified; the combat-menu identity is
a plausible but unconfirmed guess, and its own spell-cast code path is
genuinely unlocated, not just unread).

## 3. `CastSpell(charIdx)` — the shared dispatcher, file `0xf920`-`0xfb14`

```
0xf920  LINK A5,#-14
        copy party[casterIdx] (262 B) into the scratch record $30E0
          (the same "current character" scratch `scripting-engine.md`
          §7.5.3's character-sheet draw routine uses)
        if $30FE (scratch MP current) < 1: "This character's magic is
          too low!", abort   [checked again below with the real cost]
        spellIndex = ChooseSpell()     ; file 0xf798(pc), a scroll-list UI
                                        ; over the character's own known-
                                        ; spell array (§3.5 of
                                        ; town-format.md); < 0 = cancel,
                                        ; no MP spent
        effectCode = table[hunk1+0x3190][spellIndex]   ; word-indexed remap,
                                        ; see the open note below
        mpCost = table[hunk1+0xe51][effectCode]        ; byte, §3's own
                                        ; table — CONFIRMED, see §7
        if $30FE (scratch MP current) < mpCost:
          "This character's magic is too low!", abort — no MP spent
        dispatch on effectCode:
          1..4   -> HealingApply(effectCode)         file 0xfce6, §4
          44     -> ResurrectionApply(targetIdx)      file 0xfc12, §5
          54     -> TransportationApply()             file 0xfa5c, §6
          52     -> MonsterEvaluate()                 file 0xfa80, §6
          else   -> "You cannot cast this here." — NO EFFECT, no MP spent
        if the dispatched handler reports success:
          char[casterIdx].+0x1E (MP current) -= mpCost   ; file 0xfb54-0xfb74
          refresh display (JSR 0xbc22)
          a post-cast loop re-evaluates every party member's Status field
            via JSR file 0x147cc (not traced — plausibly a party-wide
            morale/status recompute; out of this document's scope)
```

**The `$3190` remap and effect-code dispatch (§3, above) is the single
biggest structural finding of this pass**: this shared "Cast Spell" entry
point does **not** implement most of the 57-spell catalogue. Every
`effectCode` value other than `1`-`4`, `44`, `52`, `54` falls through to a
bare `"You cannot cast this here."` message with **zero effect and zero MP
spent** (file `0xfb40`-`0xfb4e`, the unconditional fallthrough after the
last explicit `cmpi.w` check). Cross-referencing this against the
manual's own `Type` column (§1, "Combat Spells: these spells can only be
used during melee with Monsters" vs. "Non-combat Spells... Town /
Wilderness / Dungeon / Everywhere") and the full per-spell type table in
§7 shows this dispatcher implements **exactly the manual's `E`
(Everywhere) and `N` (Non-combat) spells reachable from a town/character
screen** — Healing (`E`), Resurrection (`E`), Monster Evaluation
(`N`/Wilderness+Dungeon), Transportation (`N`/Town) — and correctly
refuses every `C` (Combat)-typed spell (Fireflash, Quickness, Arrow
Flame, Protection, Confusion, Weakness, Binding, Mindblast, Flamebolt,
Charm, Sleep, Ninja, Fear, Dissolve, Summon Elemental, Dispel Undead,
Accuracy, Party Accuracy) with the generic rejection message. This is
strong, self-consistent structural confirmation that P3 genuinely
separates non-combat and combat spellcasting into two different code
paths, matching the manual's own stated rule — not a partially-implemented
dispatcher.

**`hunk1+0x3190`'s exact remap semantics are open, but pinned down enough
to trust for Healing.** The word-indexed lookup at `table[0x3190][spellIndex
* 2]` is read directly from `spellIndex`, and its output is what every
subsequent `cmpi.w` in §3's dispatch actually compares against (`1..4`,
`44`, `52`, `54`) — for **Healing specifically**, the observed behavior
(range-checked `1 <= value < 5`, then used identically as a `1..4` tier
throughout `HealingApply`) is only consistent with an **identity mapping**
for spell indices `1`-`4` (raw spell index == effect code). Whether this
table remaps OTHER spell indices to shared/grouped effect codes (a
plausible reason for the indirection to exist at all — e.g. `13`-`16`'s
Arrow Flame/Party Arrow Flame family sharing one effect routine) was not
traced; `hunk1+0x3190` is BSS (unstored in the file, per
`scripting-engine.md` §7.5.1's confirmed data/BSS boundary — `0x3190 >
0x277C`), so its content can only be recovered by tracing its **writer**
(not attempted this pass) or by a live capture. See §8.

**Confidence: confirmed** for the dispatcher's structure, eligibility
chain, message strings, MP pre-check/deduction, and the "non-combat-only"
scope finding (all byte-verified, contiguous disassembly). **Open**: the
`$3190` remap table's full semantics beyond the identity case exercised
by Healing, and the `0x147cc` post-cast status-refresh loop's purpose.

## 4. Healing (spells 1-4) — fully confirmed, including the `Gone` question

`HealingApply(spellTier)`, file `0xfce6`-`0xfed8`:

```
0xfce6  LINK A5,#-6
        if $2848 == 0:
          targetIdx = SelectCharacter(filter=0x2c)   ; file 0xfcf8, same
                                                        ; "pick a character"
                                                        ; helper as §2, a
                                                        ; DIFFERENT filter
                                                        ; value than the
                                                        ; casting-eligibility
                                                        ; select (0x2c is
                                                        ; also Resurrection's
                                                        ; filter, §5 — see
                                                        ; the open footnote
                                                        ; below)
          if targetIdx < 0: abort (cancel)
        else:
          targetIdx = (the value already passed in, presumably supplied
                        by a combat-context caller — no such caller was
                        found this pass, see §2/§8)

        healRoll = Random(table[hunk1+0xe8a][spellTier])   ; byte table,
                                        ; CONFIRMED byte-exact against the
                                        ; manual, see below
        missing  = party[targetIdx].+0x20 (HP max) - party[targetIdx].+0x22
                     (HP current)
        if healRoll > missing: healRoll = missing            ; can't overheal
        ShowMessage(<heal-amount format string, not decoded>)
        if <a flag, $283c> != 0: JSR 0x93e0 (screen-effect/refresh, not traced)

        copy party[targetIdx] (262 B) into scratch $31E6
        BodyLocationCure(spellTier)          ; file 0xf6c0, operates on the
                                              ; $31E6 scratch's own body-
                                              ; location words, §4.1 below
        copy the (now-cured) $31E6 scratch back over party[targetIdx]

        JSR file 0x2af6 (arg 0x1e — not traced, plausibly a UI refresh)
        party[targetIdx].+0x22 (HP current) += healRoll      ; the actual
                                                              ; HP heal,
                                                              ; applied
                                                              ; AFTER the
                                                              ; cure
        JSR 0xbc22 (refresh display)
        success = true
```

The `$2848`-gated fixed-target branch (file `0xfe00`-`0xfec6`) is a
byte-for-byte structural duplicate of the free-target path above (same
roll, same missing-HP clamp, same copy-cure-copy-back-then-heal sequence)
— consistent with `$2848` distinguishing a "prompt to pick a target" UI
context from a "target already known" context (a plausible in-combat
mode), but **no caller supplies this branch** in this project's corpus
(§2/§8) — it's reachable code, not dead code, but its actual trigger
wasn't found.

### 4.1 Max-HP-roll table — confirmed byte-exact against the manual

`hunk1+0xe8a`, byte per spell index, read directly by `spellTier` (`1`-`4`
for Healing, no `-1` adjustment):

| Spell | Table value | Manual ("Healing (#1-4)", p.16) |
|---|---|---|
| Healing I | `9` | "1-9 hit points" |
| Healing II | `27` | "1-27 hit points" |
| Healing III | `57` | "1-57 hit points" |
| Healing IV | `99` | "1-99 hit points" |

**4/4 exact.** `Random(N)` (the already-confirmed P3 RNG wrapper,
`scripting-engine.md` §7.5, `1 + rawSeed % N`) applied to this table value
gives precisely the manual's stated `1-9`/`1-27`/`1-57`/`1-99` ranges.
**Confidence: confirmed**, both the table's location/content and its use
as `Random()`'s range argument, disassembly-traced end to end.

The same table's other 53 entries were dumped and spot-checked against
the manual's other numbered damage ranges as a bonus cross-check (not
independently traced to a consumer, since — per §3 — none of those spells
are dispatched through this entry point at all): Mindblast I-IV (`5, 11,
41, 81`) and Flamebolt I-IV (`7, 15, 31, 66`) match the manual's stated
damage ranges **exactly**; Fireflash I-IV (`1, 4, 8, 13`) does **not**
match the manual's stated `1-10/1-30/1-60/1-100` (a different scaling is
presumably applied downstream by whatever code actually casts Fireflash —
not located). This confirms `hunk1+0xe8a` is a genuine, shared
per-spell-index numeric-parameter table reused by the combat-spell system
this document didn't trace, not evidence against anything claimed above
for Healing.

### 4.2 `BodyLocationCure(spellTier)` — file `0xf6c0`-`0xf796` — THE central finding

Operates on the 6-word body-location array at the just-copied scratch's
own `+0xF2`-`+0xFC` offset (absolute addresses `$32D8`-`$32E2`, i.e.
`$31E6 + 0xF2` through `$31E6 + 0xFC` — confirmed by the arithmetic, not
assumed):

```
remaining = spellTier      ; the "point budget" — 1, 2, 3, or 4
budget    = spellTier      ; running total actually available
while remaining != 0:
  found = false
  for i in 0..5:            ; Head, Torso, L-Arm, R-Arm, L-Leg, R-Leg
                             ; (scripting-engine.md §7.5.3's confirmed order)
    if bodyLoc[i] == remaining:
      bodyLoc[i] = 0          ; clear to Okay
      budget    -= remaining
      remaining  = budget
      found = true
      break                  ; restart the outer while with the new budget
  if not found:
    remaining -= 1            ; try curing a lower-severity location instead
```

This is a **greedy point-budget algorithm**: it repeatedly looks for a
body location whose *exact* severity matches however many points are
still available, clears the first one it finds, and continues with
whatever's left. Traced by hand against the manual's own stated per-tier
effects, with **zero deviation**:

| Tier | Budget | First pass (highest-severity target) | If not found, retries at | Manual's stated effect | Match |
|---|---|---|---|---|---|
| Healing I | 1 | severity `1` (Injured) | — | "1 Injury" | exact |
| Healing II | 2 | severity `2` (Broken) | `1` (Injured) — can cure up to 2 in sequence | "1 Break or 2 Injuries" | exact |
| Healing III | 3 | **severity `3` (Gone)** | `2` then `1` (a Break + an Injury) | "1 Gone, 1 Break & 1 Injury, etc." | exact |
| Healing IV | 4 | severity `4` (never occurs — max is `3`) | **severity `3` (Gone)**, then `1` more point (an Injury) | "More than 1 Gone" | exact (budget exceeds one Gone's cost) |

**This directly answers the task's central question: Healing III and
Healing IV can and do clear a `Gone` (severity `3`) body-location value —
disassembly-confirmed, not inferred from the manual alone.** The
algorithm's very first action for a budget `>= 3` is to test for and clear
a `Gone` location before considering anything less severe, exactly
matching the manual's own worked description. Healing I and II
(budget 1-2) can *never* reach a `Gone` location — their budget is
consumed by lower-severity locations (or the loop simply can't afford the
`3`-point cost) before `remaining` would ever reach `3`. This is a real,
confirmed asymmetry: **the Inn (`town-format.md` §3.1) is explicitly
gated to skip any location already at `Gone`, uniformly, regardless of
how long the party rests — but Healing III/IV can and do reverse it in a
single cast.**

**A secondary, lower-confidence finding, immediately following the cure
loop (file `0xf734`-`0xf794`), recorded as a hypothesis**: the function
computes a small "combat capability" code into a separate global (`$3212`)
based on the *post-cure* state of two specific locations — Head (index 0)
and the location at `+0xF8` (index 3, `scripting-engine.md` §7.5.3's
confirmed order names this **R-Arm**): `Gone` on either → code `0`;
`Broken` on either → code `3`; both legs (`+0xFA`/`+0xFC`) `>= Broken` →
code `4`; otherwise → code `1`. This lines up plausibly with the manual's
own combat-restriction passage (p.12: *"An adventurer may not cast a
spell or swing a weapon if his Right Arm is Broken or Gone. Parry is the
only combat option for an adventurer with a Right Arm Broken."*) but
**`$3212`'s own consumer(s) weren't traced this pass** — recorded as an
open item, not claimed as confirmed. Note this doesn't reconcile cleanly
with the eligibility gate in §2/§3 (which blocks *casting* a spell at all
when `char.+0xF6` — index 2, **L-Arm** per the same confirmed field order
— is Broken/Gone, not `+0xF8`/R-Arm as the manual's own "Right Arm"
wording would suggest). Both checks are byte-verified as written; whether
this is a genuine L/R inconsistency in the original game, or this
project's `scripting-engine.md` §7.5.3 field-order table has the two arms
swapped, wasn't resolved this pass — flagged for a future pass, not
corrected here without further evidence (see §8).

**Confidence: confirmed** for the whole cure algorithm and its match to
the manual's four Healing tiers, including the `Gone`-clearing capability
of tiers III/IV — full contiguous disassembly, cross-checked byte-exact
against the manual's own worked description with zero deviation across
all 4 tiers. **Hypothesis** for the `$3212` status-code computation's
semantics and the L-Arm-vs-R-Arm eligibility-gate discrepancy noted above.

**A footnote on target eligibility, not chased down this pass**: the
free-target-select path (`$2848 == 0`) reuses filter `0x2c` — the exact
same filter value Resurrection's own target-select uses to allow picking
a *dead* (`Status == 0`) party member (§5). Nothing in `HealingApply`
itself re-checks the target's `Status` after selection. Whether this
means a dead character can technically be offered as a Heal target (and,
if selected, would just receive an inert HP top-up with no `Status`
change) wasn't independently verified — a minor, low-priority open
question, not central to this document's brief.

## 5. Resurrection (spell 44) — fully confirmed

`ResurrectionApply(targetIdx)`, file `0xfc12`-`0xfce2` (called from
`0xfa3a`, itself gated by a target-select at `0xfa04` with filter `0x2c`
and a `Status == 0`(dead)-only check — living targets get `"This
character is not dead."`, file `0xfa2a`):

```
0xfc12  party[targetIdx].+0x22 (HP current)  = 1        ; revives at 1 HP,
                                                          ; NOT a full heal
        party[targetIdx].+0x1E (MP current)  = party[targetIdx].+0x1C
                                                          ; (MP max) — full
                                                          ; MP restore
        party[targetIdx].+0x2C (Status)      = 1         ; Okay/alive
        for i in 0..5: party[targetIdx].+0xF2 + i*2 = 0  ; ALL SIX body
                                                          ; locations
                                                          ; unconditionally
                                                          ; cleared to Okay
                                                          ; — not budgeted,
                                                          ; every location
                                                          ; regardless of
                                                          ; severity
        if party[targetIdx].+0x10 (Constitution) - Random(2) < 3:
          Constitution = 3                                ; floor
        else:
          Constitution -= Random(2)                       ; -1 or -2
```

**Confirmed exact match to the manual** (p.16: *"this spell attempts to
raise an adventurer from the dead. The shock of dying will permanently
lower the victim's Constitution one or two points."*): the
`Random(2)` roll (`1` or `2`) subtracted from Constitution, clamped to a
floor of `3` so it can't go non-positive, is a direct, disassembly-traced
match.

**Bonus finding, not previously documented**: Resurrection's unconditional
clear of all six body locations means that, unlike Healing (which needs
tier III/IV and a lucky-enough budget to reach a `Gone` location),
Resurrection **always** fully repairs every body location as a side
effect of reviving the character — regardless of how many locations were
`Gone`. This narrows (but doesn't resolve) the `scripting-p3-death-
judgment` `TODO.md` item: that mechanic handles a **full party wipe**
(every member dead, no one left to cast Resurrection or visit an Inn) —
a genuinely different scenario from a single dead character with living
party-mates, which Resurrection now fully covers. No revision to that
`TODO.md` item is needed; the two mechanics don't overlap.

**Confidence: confirmed** — full contiguous disassembly, byte-verified
against the manual's own stated effect with zero deviation.

## 6. Transportation (54) and Monster Evaluate (52) — narrowly traced

Both are dispatched from the same `effectCode` switch as Healing/
Resurrection (§3) but were traced only far enough to confirm their gross
shape, per this task's stated lower priority for non-healing spells:

- **Transportation** (file `0xfa5c`-`0xfb12`): gated on the `$2846` flag
  (the **same** flag `town-format.md` §3.1 documents as gating the Inn's
  full-HP-heal step — plausibly "the party is currently in a town"), else
  `"You cannot cast this here."`; on success, opens a town-select UI, then
  writes the chosen town index to the active-map globals (`$28C2`/`$2856`,
  the same globals `dungeon-format.md` §9.0.3.4's confirmed map-switching
  logic uses) and reloads the overworld/town state. Matches the manual's
  description (*"this spell will teleport the party interdimensionally
  from one town to another"*, p.16) structurally. Not fully traced field
  by field.
- **Monster Evaluate** (file `0xfa80`-`0xfb12`): calls a small helper
  (file `0x1022e`, arg `0x2e`) and a level threshold compare against
  `$2856`; not traced past the call. Manual: *"this spell determines the
  approximate experience level of nearby monsters."*

Both are **open** for full formula-level confirmation — see §8.

## 7. Non-Healing spell catalogue — from the manual, for reference

Every other spell's manual-stated `Type` and `Magic Points` cost (the
latter **code-confirmed**, see below), for reference when a future pass
implements the in-combat spell-cast path (§8). `Type` is transcribed
directly from the manual's own "Spell Table" (p.15); this project has
**not** independently traced any of these spells' effect magnitude except
where noted in §4.1's bonus cross-check (Mindblast, Flamebolt).

| # | Name | MP (code table, confirmed) | Manual Type |
|---|---|---|---|
| 5-8 | Fireflash I-IV | 1,2,3,4 | C/A (damage) |
| 9-12 | Quickness I-IV | 1,2,3,4 | C/P (party speed buff) |
| 13-16 | Arrow Flame 1/Party 1/2/Party 2 | 1,2,3,4 | C/P (bow accuracy/damage buff) |
| 17-20 | Protection I-IV | 1,2,3,4 | C/P (armor buff) |
| 21-24 | Confusion I-IV | 1,2,3,4 | C/A (debuff) |
| 25-28 | Weakness I-IV | 1,2,3,4 | C/A (debuff) |
| 29-32 | Binding I-IV | 1,2,3,4 | C/A (movement debuff) |
| 33-36 | Mindblast I-IV | 1,2,3,4 | C/A (psychic damage) |
| 37-40 | Flamebolt I-IV | 1,2,3,4 | C/A (party-wide damage) |
| 41 | Charm | 1 | C/A (crowd control) |
| 42 | Sleep | 2 | C/A (crowd control) |
| 43 | Teleportation | 3 | N/T-ish (combat escape, per manual) |
| 45,50 | Ninja II, Ninja I | 1,2 | C/P (self-buff, high-power) |
| 46 | Fear | 2 | C/A (crowd control) |
| 47 | Dissolve | 3 | C/A (removes monsters) |
| 48 | Summon Elemental | 4 | C/P (calls a pre-loaded elemental) |
| 49 | Dispel Undead | 1 | C/A (anti-undead) |
| 51 | Awaken | 3 | C/P (wakes/unsleeps) |
| 53 | (unused, "Vision") | 1 | — (manual: unneeded, world is pre-mapped) |
| 55,56 | Accuracy, Party Accuracy | 3,4 | C/P (Fire Bow buff) |
| 57 | Divine Aid | 0 | — (plot-gated, `town-format.md` §3.5) |

The MP-cost column above is **confirmed byte-exact**: `hunk1+0xe51`'s
byte table was dumped for all 58 entries (index `0` unused, `1`-`57`)
and matches a consistent per-family cyclic `1,2,3,4` pattern with the
manual's printed "MAGIC PTS." column for every entry checked, including
every non-tiered spell (`Charm`=1, `Sleep`=2, `Teleportation`=3,
`Resurrection`=4, `Ninja II`=1, `Fear`=2, `Dissolve`=3, `Summon
Elemental`=4, `Dispel Undead`=1, `Ninja I`=2, `Awaken`=3, `Monster
Evaluate`=4, `Vision`=1, `Transportation`=2, `Accuracy`=3, `Party
Accuracy`=4, `Divine Aid`=0). **This directly answers the task's MP-cost
question**: MP cost is a **fixed, per-spell value from this table — not
level-scaled, not caster-attribute-scaled** — deducted from the caster's
real `char.+0x1E` (MP current) once, only on a successful cast (§3), after
a pre-check blocks the attempt entirely (no MP lost) if current MP is
below the cost.

## 8. Open items / paths tried

| Item | Approach tried | Result |
|---|---|---|
| The in-combat "Spell" menu's own cast implementation | Exhaustive caller scan (both `HUNK_RELOC32`-absolute and PC-relative `JSR`) for the shared dispatcher (`0xf920`) found exactly 2 callers, both non-combat (§2) | **Not located.** Combat's `Spell` choice (`default_78.png`) does not reach the traced dispatcher at all — it must have a separate, unlocated implementation. This is the largest remaining gap for a faithful in-combat healing/damage implementation |
| `hunk1+0x3190`'s full remap semantics | Traced the read side and confirmed identity behavior for Healing (`1`-`4`); `0x3190` is BSS (unstored in the file, `scripting-engine.md` §7.5.1's boundary), so its content can't be dumped statically | **Open** — needs either a writer-side trace (not attempted) or a live capture (amiberry, gated per this agent's permission rules) |
| `$3212`'s consumer(s) (the post-cure "combat capability" code, §4.2) | Located the writer (`0xf6c0`'s tail) but did not search for readers | **Open** — plausibly feeds the manual's Broken/Gone-arm combat-menu restrictions, not confirmed |
| L-Arm (`+0xF6`) vs. R-Arm (`+0xF8`) in the two "arm broken/gone" gates (§2's cast-eligibility check vs. §4.2's `$3212` computation) | Both checks independently byte-verified against `scripting-engine.md` §7.5.3's confirmed body-location field order | **Open, flagged not resolved** — the manual specifically calls out "Right Arm" for the *combat-restriction* cascade (matching the `$3212` computation's `+0xF8` check), while the *cast-eligibility* gate in §2/§3 tests `+0xF6` (L-Arm per the confirmed order) instead. Could be a genuine original-game inconsistency, or an error in the existing field-order documentation — not enough evidence either way this pass |
| Transportation/Monster Evaluate full formulas | Traced dispatch/gating only (§6), stopped short of full field-level confirmation per this task's stated lower priority for non-healing spells | **Narrowly traced**, not fully confirmed |
| Individual Combat-type spell effect magnitudes (Fireflash, Confusion, Weakness, Binding, Charm, Sleep, etc.) | Not traced — these spells are provably unreachable from the two entry points this pass located (§3's "You cannot cast this here." finding); their real implementation lives wherever the in-combat Spell menu turns out to be | **Not traced**, blocked on the item above. `hunk1+0xe8a`'s other table entries are a plausible numeric-parameter source once that code is found (§4.1's Mindblast/Flamebolt cross-check) |
| `0x147cc` (post-cast party-status refresh loop, §3) | Read the 3-line call shape, did not disassemble the callee | **Open** |

## 9. What `CombatEngine`/`TownScene` should do differently

- Wire a non-combat "Cast Spell" screen (Options menu / character screen)
  to §3's confirmed dispatcher shape: eligibility chain (alive, arm not
  Broken/Gone, has known spells) → browse/pick UI → MP pre-check →
  dispatch on spell index → MP deducted only on success.
- Healing I-IV: roll `1..maxTable[tier]` (§4.1's confirmed 4-entry table:
  `9, 27, 57, 99`), clamp to missing HP, apply `BodyLocationCure`'s exact
  point-budget algorithm (§4.2) **before** applying the HP roll — this is
  ready to implement end to end, including `Gone`-clearing for tiers
  III/IV.
- Resurrection: target must be `Status == 0` (dead); on success, HP := 1
  (not full), MP := max, Status := Okay, **all six body locations cleared
  unconditionally**, Constitution -= `Random(2)` clamped to a floor of 3.
  Also ready to implement end to end.
- Do **not** wire the other 51 spells (Fireflash through Divine Aid) to
  this non-combat entry point — the real game explicitly refuses them
  here (`"You cannot cast this here."`). They belong on the in-combat
  Spell menu once that code is located (§8) — until then, `CombatScene`'s
  existing "Spell" placeholder (`docs/implementation.md`'s A2 status
  update, "Fire branch... fixed to melee until the combat menu exists")
  is the honest state of the art, not a regression to fix here.
- MP cost: use `hunk1+0xe51`'s confirmed byte table (§7) directly,
  keyed by spell index — fixed per spell, no level/attribute scaling.
