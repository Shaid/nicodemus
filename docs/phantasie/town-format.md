# Phantasie III (Amiga) — Town Interaction & Character Creation

This document covers two things traced together in the same pass, both from
`data/phantasieiii/amiga/PhantasieIII` (AmigaOS HUNK executable): the
in-town command loop that runs when the party lands on a `type: 'town'`
`LocateSpecial()` marker (see `dungeon-format.md` §9.0.5.4 for the marker
side), and the character-creation math ("New Member").

**Address convention** (same as `scripting-engine.md`'s P3 sections): all
addresses below are **file offsets** into `PhantasieIII`, i.e. `hunk-0
address + 0x28`. The executable is a 3-hunk file: `HUNK_CODE` (hunk 0,
137,352 bytes, file `0x28`-`0x218b0`), `HUNK_RELOC32`, `HUNK_DATA` (hunk 1,
declared 27,404 bytes in the header but only **10,108 bytes actually
stored** — the remaining 17,296 bytes are implicit zero-fill BSS merged
into the same hunk; every `hunk 1 +0xNNNN` address cited below and
throughout this project's other P3 docs lives in that combined 27,404-byte
address space, used directly by code with no `+0x28` correction). CODE-hunk
JSR targets in this file's raw bytes are stored **pre-relocation** as the
hunk-0-relative address; `real target = raw operand + 0x28` — re-derived
and cross-checked this pass against the already-confirmed armoury-builder
call sites (`data-tables.md` §6.4) before relying on it for anything new.

## 1. The real menu structure — not Temple/Tavern/Training

**The placeholder `TownScene`'s assumed facility set (Armoury/Inn/
Temple/Tavern/Training) does not match the game.** The actual on-screen
menu text was recovered two ways, agreeing exactly: (a) walking the
`HUNK_RELOC32`-patched string pointer table that feeds the print routine
(each menu is a NUL-pointer-terminated array of longwords, each pointing
at a `"X) Label"`-style C-string; table found at file `0x2978c`-`0x29850`
by searching for the raw pre-relocation pointer to the `"A) Armoury"`
string at file `0x68f4`), and (b) **real Amiga screenshots already in
this repo** (`data/default_56.png`-`default_88.png`, an amiberry-captured
Pendragon walkthrough sequence already used for other findings — see
`graphics-formats.md` §4.6). There is **no Temple and no Tavern**
anywhere in the executable's strings or in any captured screenshot.

The town screen itself (`default_58.png`-`63.png`, the `w4.cmp`-backed
Pendragon street view, `dungeon-format.md` §9.0.1) has **three top-level
pull-down menus, `File`/`Guild`/`Options`**, each opening one of the
groups below — this is not one combined in-town menu. Every lettered
item in every group still keys through the one physical keystroke
dispatcher in §2 once its menu is open. `default_65.png` (`Options`
open) and `default_64.png` (`Guild` open) are byte-for-byte matches to
the string-pointer-table decode below, confirming both techniques agree:

| Top menu | Screenshot | Group | Letters shown | Label |
|---|---|---|---|---|
| `File` | `default_63.png` | Roster select | `?` `O` `S` | Info / Load / Save |
| `Guild` | `default_64.png` | Roster mgmt + Spellcasting | `+` `-` `E` `N` `P` `R` `L` `T` | Add/Drop/Examine/New/Purge/Rename Member, Learn Spells, Training |
| `Options` | `default_65.png` | **Town facilities** + Party actions | `A` `B` `I` `M` `X` `C` `D` `G` `U` `V` | **Armoury**/**Bank**/**Inn**/**Mystic**/Exit, Cast Spell/Distribute/Trade Item/Use Item/View Party |
| *(context, not a pull-down)* | `default_69.png` | Character screen | `C` `E` `P` `U` | Cast Spell / Examine Member / Party Status / Use Item |
| *(context)* | `default_70.png` | Movement speed | `+` `=` `-` | Fast / Normal / Slow |
| *(context)* | `default_78.png` | Combat menu | *(own dedicated menu, not this dispatcher — `scripting-engine.md` §7.5.1)* | Attack/Lunge/Slash/Thrust/Parry/Fire Bow/Aim Blow/Cast Spell/Move Back/Middle/Front, Fight! |

The original string-pointer-table survey (run before the screenshots were
checked) found the same 9 groups by walking the raw pointer table
end-to-end; kept below as the byte-level source for the two groups
above that don't yet have a dedicated screenshot cross-check (a bare
`?) Info` shown standalone, and a differently-shaped 4th "Info" instance
the pointer table also lists):

| Group | Letters shown | Label |
|---|---|---|
| Roster select | `?` `O` `S` | Info / Load / Save |
| Roster management | `+` `-` `E` `N` `P` `R` | Add Member / Drop Member / Examine Member / New Member / Purge Member / Rename Member |
| Spellcasting | `L` `T` | Learn Spells / Training |
| **Town facilities** | `A` `B` `I` `M` `X` | **Armoury** / **Bank** / **Inn** / **Mystic** / Exit |
| Party actions | `C` `D` `G` `U` `V` | Cast Spell / Distribute / Trade Item / Use Item / View Party |
| (a 4th, unlabelled `?`) | `?` | Info |
| Character screen | `C` `E` `P` `U` | Cast Spell / Examine Member / Party Status / Use Item |
| Movement speed | `+` `=` `-` | Fast / Normal / Slow |
| Combat menu | `F` `T` `G` `B` `R` `M` `H` | Fight / Threaten / Greetings / Beg for mercy / Run away / Monster Names / Party health |

The task brief's "Armoury/Inn/Temple/Tavern/Training" is this project's
own generic RPG-facility shorthand, not P3's real terms. **P3's real town
facility row is `A) Armoury`, `B) Bank`, `I) Inn`, `M) Mystic`, `X) Exit`**,
with spellcasting (`L) Learn Spells`, `T) Training`) and roster management
(`New`/`Purge`/`Rename`/`Examine`/`Add`/`Drop Member`) as separate
sibling groups shown on the same screen. There is no dedicated "Temple"
(healing/resurrection is folded into the Inn, §3.1) and no dedicated
"Tavern" hireling-recruitment screen (per `dungeon-format.md`'s
`world-p1-twns-int-fields` finding, P1's Tavern hireling pool lives in a
`twns.int` container region that has **no P3 equivalent file at all**; P3
appears to handle new-character acquisition entirely through `N) New
Member`, i.e. rolling a fresh character rather than hiring a pre-rolled
one — no hireling-pool table was found anywhere in this pass. See §5).

## 2. The command dispatcher — confirmed

**Entry point**: file `0xb1f4` (`link.w a5,#0; clr.w $2854; move.w
8(a5),-(a7); jsr $1e72.l ; move.w d0,8(a5); ext.l d0; bra.w $bbe4`). It has
**exactly one caller in the whole binary** (file `0x7aa6`, found via the
raw-operand `4EB9 0000B1CC` search — `0xb1cc = 0xb1f4 − 0x28`), i.e. this
is a single, unified "read one keystroke and dispatch" loop, not one
dispatcher per screen.

**Jump table**: SAS/C's standard bounded-switch idiom (same shape as
`ExecuteAction`'s dispatcher, `scripting-engine.md` §5) at file `0xbbe4`:

```
0xbbe4  sub.l   #0x2b,d0        ; d0 -= 43 ('+') — normalize keycode
0xbbea  cmp.l   #0x35,d0        ; 53-entry range
0xbbf0  bcc.b   0xbbfc          ; out of range -> default (no-op)
0xbbf2  asl.l   #1,d0
0xbbf4  move.w  0xbb7a(pc,d0.w),d0
0xbbf8  jmp     0xbbfa(pc,d0.w)
0xbbfc  unlk a5 / rts           ; default
```

53 words at file `0xbb7a`-`0xbbe4` (PC-relative displacements from the
`JMP` extension word at `0xbbfa`), i.e. this dispatcher accepts the raw
ASCII value of any keystroke `0x2b`-`0x5f` (`'+'`-`'_'`) and jumps
directly to a handler if one exists for that byte, else falls through to
the no-op default. **21 distinct handler targets exist** among the 53
slots, covering exactly the 21 distinct letters shown across every menu
group in §1's table (`=` aliases `+`'s target, `?` aliases `/`'s target —
i.e. every printed hotkey has a live handler, and the two "extra" letters
in the table are just alternate keystrokes for an already-labelled
action). This 1:1 match between "every letter any menu shows" and "every
live jump-table slot" is itself strong structural confirmation that this
one dispatcher really does serve every screen in §1 (there is no
per-screen re-interpretation of the same keystroke found anywhere).

Resolved handler addresses (`real target = table word + 0xbbfa`,
cross-checked against message/table content, not just table position):

| Key | Target | Traced role |
|---|---|---|
| `I` | `0xb5dc` → `0x11bea` | **Inn** — confirmed byte-for-byte, §3.1 |
| `T` | `0xb902` → `0xde34` | **Training** — cost formula confirmed, §3.2 |
| `M` | `0xb6c6` → `0x1209a` | **Mystic** — party status/reputation scan, not fully traced, §3.3 |
| `N` | `0xb4b4` → `0x12c24`/`0x12bfc` | **New Member** (character creation), §4 |
| `A` | `0xb3be` → `0x10fca` | Selects an eligible character, opens a per-character info/equipment screen (reads the item-price cache neighbouring `inititem.dat`'s `hunk 1 +0x44BA` base) — **plausibly Armoury's per-character equip screen, not fully traced to the confirmed stock builder this pass; see §3.4/§5** |
| `O` | `0xb218` → (falls through to) `0x8b5a` | Directly and unambiguously calls the **confirmed** armoury-stock builder (`data-tables.md` §6.4); on-screen label for this letter is `"O) Load"`, not Armoury — **an open discrepancy, see §3.4/§5** |
| `G` | `0xb9be` → `0xf2e8` | **Trade Item** — transfers a carried loot item between two party members, confirmed, §3.7 |
| `B` | `0xb480` → `0x1183a` | **Bank** — confirmed, §3.6 |
| `L` | `0xb60a` → `0x1041a` | **Learn Spells** — confirmed, §3.5 |
| `D` | `0xb380` → `0xbca4` | **Distribute** — confirmed, §3.7 (two modes on one worker function: `Param=2` is this dispatcher key's own reachable mode, "reset" — un-equip the whole party and recall all carried loot into a shared pool; `Param=1` is a *second*, town-menu-unreachable mode auto-triggered on town arrival, which assigns gold/XP share weights and divides pooled combat XP) |
| `S`,`+`,`-`,`E`,`P`,`R`,`U`,`V`,`X`,`C` | various | Save/Add/Drop/Examine/Purge/Rename Member, Use Item, View Party, Exit, Cast Spell — not traced this pass |

Every handler shares the same idiom: check an eligibility flag or two
(`tst.w $2850.l`, etc.), optionally prompt "select a character" via a
shared helper at file `0x127f6` (`jsr $127ce.l`, raw operand needs `+0x28`)
with a numeric filter parameter (`0xe`, `0xd`, `0xb`, `0xc`, `0x40`, ...,
whose exact semantics weren't decoded), then call the facility's own
worker function, then `bra.w 0xbbfc` back to the dispatcher's exit. This
uniform shape is why individual handlers could be identified quickly by
their *worker* function's content rather than needing every eligibility
check decoded.

## 3. Facility mechanics

### 3.1 Inn — confirmed

Handler `I` → file `0xb5dc`, worker function file `0x11bea`-`0x1203c`.
Iterates every occupied party slot (`$3d0a + i×0x106`, the confirmed
262-byte character record, `scripting-engine.md` §7.5.3) and, per living
member (`+0x2C` Status `!= 0`):

1. **Ages the character by 1** (`+0x28` Age field, in 1/26-year units per
   the confirmed field map — `addq.w #1,(char.+0x28)` at file `0x11d5e`).
   A dead character (`Status == 0`) skips aging and instead shows a
   different message (string block at file `0x12043`, includes `" in
   peace."` — the death-flavoured branch).
2. **Chance-based Magic Power growth.** Reads
   `mpChart = hunk1+0x9CA[classIdx×15 + min(level,15)−1]` (byte; the
   same table character creation reads at `level=1`, §4.3) into a scratch
   field at char `+0x1A` (undocumented in the character-sheet map — it
   never appears on the printed sheet, purely an internal working value).
   If `mpChart > char.+0x1C` (confirmed **Magic Power max** field): rolls
   `Random(100)`, and if the roll is `< (mpChart − char.+0x1C) × 20`,
   increments `+0x1C` by 1 and sets `+0x1E` (**Magic Power current**) to
   the new `+0x1C`, showing `"Magic increases!"` (file `0x12043` string
   block). Gated off entirely (both the age tick and this growth) by a
   global flag at `$285a` (meaning not resolved — plausibly "already
   rested this visit").
3. **Full HP heal**, gated by a separate flag `$2846`: `char.+0x22`
   (**Hit Points current**) `:= char.+0x20` (**Hit Points max**) —
   `"The party's health improves!"` (same string block).
4. **Body-location repair**, same `$2846` gate: the six `+0xF2`-`+0xFC`
   body-location words (`scripting-engine.md` §7.5.3) are reset to `0`
   (`Okay`) **unless already `3` (`Gone`)** — a severed limb stays
   severed; the Inn cannot regrow a `Gone` location.

**This is P3's Temple-equivalent healing/curing**, not a separate
facility: full HP restore and (bounded) body-location repair both happen
at the Inn, gated by a room-availability-shaped flag rather than being a
separate paid service. No resurrection-of-the-dead logic was found in
this function (dead members get a flavour message only) — full-party
death is handled by the separate judgment mechanic already tracked as
`scripting-p3-death-judgment` in `TODO.md`, unrelated to the Inn.

**Confidence: confirmed** — every field offset used matches
`scripting-engine.md` §7.5.3's independently-derived character-record map
exactly (Age `+0x28`, Status `+0x2C`, Magic Power max/current `+0x1C`/
`+0x1E`, HP max/current `+0x20`/`+0x22`, body locations `+0xF2`-`+0xFC`),
and the on-screen message strings ("Inn welcomes you", "party's health
improves", "Magic increases", "in peace") match the mechanics decoded
around each one.

### 3.2 Training — cost formula and effect both confirmed

Handler `T` → file `0xb902`, worker file `0xde34`. Selects an eligible
character (alive, `Status != 3`, `Race != 0x11` — the same race-exclusion
value the Inn's MP-growth uses, §3.1), copies it into the `$30E0` scratch,
then computes a **training cost**:

```
level      = min(char.Level, 15)
base       = shopMarkup[$2856] × (20 − Charisma)        ; $2856 = current
                                                          ; armoury/town index,
                                                          ; hunk1+0x1144 markup
                                                          ; table, data-tables.md §7
levelTerm1 = hunk1+0xA4C[level-1]                        ; word table, 15 entries
classPct   = f(class, Strength, Dexterity, Constitution, Charisma)  ; per-class
                                                          ; formula, %*100 scale,
                                                          ; divisors 0x21/0x14/0x35/
                                                          ; 0x32/0x2b per class 0-4
                                                          ; (5th/Wizard uses
                                                          ; Constitution×2+Luck)
classPct   = max(classPct, 0x11)                         ; floor 17
levelTerm2 = hunk1+0xA6A[level-1]                         ; longword table, 15 entries
cost       = (levelTerm2 − 80) / 1000 × classPct / 100    ; scaled by a
                                                          ; conditional ×6 or
                                                          ; ×2 multiplier when
                                                          ; char.+0x22(?) is in
                                                          ; the 200-249 / >=250 range
cost       = cost − <running total already spent, $31E2>
```

If `cost > 0`, shows a confirmation window with the character's info.
This reuses the **same armoury markup table** (`data-tables.md` §7) that
prices Armoury goods — training cost is literally "town markup% × a
Charisma-modified base", i.e. training is priced per-town exactly like
shop goods are.

This is P3's own inline replacement for P1's separate `twns.int`
"per-class/level training-cost roll" container region (`dungeon-format.md`
`world-p1-twns-int-fields`); P3 has no equivalent file, and — as the task
brief anticipated — the formula lives entirely in code-embedded constant
tables (`hunk1+0xA4C`, `hunk1+0xA6A`, plus the already-known markup
table) rather than any loaded data file.

> **Correction/completion (this pass) — the actual training effect,
> traced past the confirm dialog (file `0xe0f6`-`0xe584`, resolving
> `town-p3-training-effect`).** Confirming (past the `$44b2`
> party-gold-vs-cost gate at file `0xe1c4`) applies **all** of the
> following:
>
> ```
> Level  = min(Level + 1, 21)                          ; file 0xe378
> Gold   = Gold − cost                                 ; $44b2, file 0xe3d6
>
> ; HP is re-rolled exactly like character creation (§4.3), but with a
> ; different die and the LEVEL-indexed column of the same table:
> diceCount = hunk1+0x94C[classIdx × 21 + (newLevel − 1)]  ; file 0xe406-0xe416
> newHP     = Σ Random(3), diceCount times                ; file 0xe3e8-0xe3f4 —
>                                                          ; note: Random(3), not
>                                                          ; Random(2)+1 as creation
>                                                          ; uses (§4.3) — a genuine,
>                                                          ; confirmed asymmetry
>                                                          ; between the two paths
> if newHP <= oldHPmax: newHP = oldHPmax + 1              ; guaranteed +1 floor
> HP max = HP current = newHP                             ; file 0xe44a/0xe452,
>                                                          ; full heal alongside
>                                                          ; the level-up
>
> ; then the game's own confirmed level-up skill-maxima routine runs,
> ; called 3 times in a loop (file 0xe530, `jsr $e67a(pc)` — the exact
> ; same function scripting-engine.md §7.5.3/§7.5.1 already traced end to
> ; end for FireBowMax and the other 8 skills: reads the 8 class/level
> ; skill tables and recomputes all 9 skill (current,max) pairs for the
> ; NEW level). The 3-call loop (each iteration also calling file
> ; `0xab44`, an unidentified small helper taking a `(charIdx, msgSet,
> ; selector)`-shaped argument set) matches the on-screen
> ; `"Skill(s) to train in:"` text (file `0x6717`'s string block) —
> ; Training presents (up to) 3 skills whose new maxima the player sees,
> ; not a single skill.
> ```
>
> **This makes Training P3's normal character-level-up mechanic, paid
> for in gold rather than earned through Experience** — it increments
> Level, re-rolls HP via the identical class/level dice table character
> creation uses (§4.3), and calls the exact same skill-maxima recompute
> function a real level-up would. There is no separate "Experience Points
> level-up" code path found or searched for this pass; whether one
> exists elsewhere (levelling from combat XP, independent of Training)
> is not settled — the `+0x102` Experience Points field (`scripting-
> engine.md` §7.5.3) is tracked but no consumer of it was located in
> this pass's reading window.
>
> **Confidence: confirmed** — every step disassembled directly (file
> `0xde34`-`0xe584`, contiguous), cross-referencing already-confirmed
> character-record fields (Level `+0x74`/`$3154`, HP max/current
> `+0x20`/`+0x22`/`$3100`/`$3102`) and the already-confirmed `0xe67a`
> skill routine. The `0xab44`/`0xab1c` helper functions' own exact
> per-skill selection logic (which 3 skills, and whether they're
> player-chosen or fixed) was not traced — a narrower residual gap than
> the original "effect entirely unknown" framing.

### 3.3 Mystic — fully traced: a pure status/flavour report, no mechanical effect

Handler `M` → file `0xb6c6`, worker file `0x1209a`-`0x123c4`. Loops every
living party member computing three per-character conditions —
`char.+0x5C != 0`, `char.+0x18 != 0` (neither field is in the confirmed
record map, §5), and `char.+0x8E` (**Social Class**, confirmed) `> 3`,
retaining the max Social Class value seen — then buckets an
elapsed-turns/reputation counter (`jsr $1e9ba`, file `0x1e992+0x28`)
against three thresholds (`0x1e`/`0x3c`/`0x5a` = 30/60/90) to pick one of
4 flavour-text title strings (`hunk1+0x17F4` pointer table, indices
`0x24`-`0x27`).

> **Completion (this pass, resolving `town-p3-mystic-effect`) — traced
> to `RTS` (file `0x123c4`).** After the title, the function prints **up
> to three further conditional message blocks**, one per condition
> above (each only if that condition was true for at least one living
> member), the third splitting into two different messages depending on
> whether the qualifying Social Class is exactly `4` (Darklord) or not
> (`5`, Superhero) — file `0x12328`-`0x1234e`. **The function performs
> zero field writes anywhere in its body** — no gold change, no stat
> mutation, no status change, nothing persisted. Mystic is a **pure
> read-only status/flavour report**: a reputation-tier greeting plus
> conditional lines calling out (a) whichever undocumented `+0x5C`
> condition applies to the party, (b) whichever undocumented `+0x18`
> condition applies, and (c) congratulating/remarking on any member who
> has achieved high Social Class (Darklord or Superhero), with distinct
> text for each. This is P3's "how is my party doing" narrative screen,
> not a shop, guild-dues mechanic, or curing service — those hypotheses
> from the earlier pass are refuted by the complete zero-writes trace.
>
> **Confidence: confirmed** for "no mechanical effect, purely
> informational" (the strongest possible claim — a complete trace to the
> function's own `RTS` with no field writes found). **Open**: the real
> names/meanings of the `+0x18`/`+0x5C` flags themselves (plausible
> guesses — curse/disease-style affliction flags, given the "Mystic"
> framing — were not cross-checked against any oracle this pass).

> **Completion (this pass) — writer search for `+0x18`/`+0x5C`
> (`town-p3-mystic-flag-names`): genuinely narrowed, still open, but now
> with strong positive evidence these are real, live game state.**
>
> **Direct-address search (code hunk): zero writers.** A raw-byte scan
> of the whole `CODE` hunk for the literal absolute addresses `0x3d22`
> (`+0x18`) and `0x3d66` (`+0x5C`) finds **exactly one occurrence of
> each, both inside Mystic's own read** (file `0x120fa`/`0x120e0`) — no
> other function in the binary references either address directly.
>
> **Script-opcode stat-index cross-check: both fields ARE reachable via
> the confirmed opcode 0x12/0x13/0x18/0x19 stat mechanism, and both
> really are exercised by shipped dungeon scripts.** Re-deriving the
> effective byte offset opcode 0x12's handler (`scripting-engine.md`
> §5/§6.3(b), file `0x1CCBE`) actually writes to: its `GetCharBase`
> helper (`jsr $1e2ca(pc)`, disassembled directly this pass) returns
> `$3d0a + charIdx×0x106 + 0x08` — **8 bytes past the record base**, not
> the base itself (this refines the existing doc's "`charBase[statIndex
> ×2]`" description — the "`+0`" implicit in that phrasing is actually
> `+8`). So **script `statIndex` N lands at record offset `0x08 + 2N`**:
> `+0x18` is `statIndex 8`, `+0x5C` is `statIndex 42`. Scanning all 11
> real `D/dnga.dat`-`dngk.dat` action tables (§2's packed/variable-stride
> decode) for opcode `0x12`/`0x13`/`0x18`/`0x19` records confirms **both
> indices are used in real shipped content** — but **only via opcode
> `0x13` (conditional test), never `0x12`/`0x18` (set)**:
>
> | File | Slot | Op | statIndex | Threshold (`Param2`) | Semantics (opcode `0x13`, §5: gate on *zero* members `>=` threshold) |
> |---|---|---|---|---|---|
> | `dnga.dat` | 50 | `0x13` | 8 (`+0x18`) | 200 | goto if no member has `+0x18 >= 200` |
> | `dnga.dat` | 80, 102 | `0x13` | 8 | 200 | same, two more triggers |
> | `dnga.dat` | 83 | `0x13` | 8 | 1 | goto if no member has `+0x18 >= 1` (boolean-style test) |
> | `dnga.dat` | 65, 99 | `0x13` | 42 (`+0x5C`) | 100 | goto if no member has `+0x5C >= 100` |
> | `dnga.dat` | 68 | `0x13` | 42 | 1 | goto if no member has `+0x5C >= 1` |
>
> Both a `>= 1` (boolean) and a `>= 100`/`>= 200` (counter-scale)
> threshold exist for each field in the *same file*, consistent with
> these being small accumulating counters (not plain 0/1 flags) gating
> different narrative tiers — matching Mystic's own `!= 0` read exactly
> (a `>=1` reading). **This settles that `+0x18`/`+0x5C` are real,
> meaningful, script-tested game state, not dead/unused fields** — a
> materially stronger result than the original "read-only, unnamed"
> framing — but **no writer was found anywhere**: not in this same
> 11-file script corpus (no `0x12`/`0x18` record ever targets index 8 or
> 42), not via direct CODE-hunk addressing. The two most likely
> remaining locations — computed (non-literal-address) writes via
> `GetCharBase` elsewhere in the binary (e.g. combat/status-effect code,
> which would not appear in either search performed) or character-
> creation logic using the same dynamic addressing — were not audited
> this pass; `GetCharBase`'s own full caller list was not enumerated.
>
> **Bonus finding, out of this task's scope to write up in full but
> worth flagging for `scripting-engine.md`'s own maintainers**: tracing
> opcode `0x12`'s handler end-to-end to derive `GetCharBase`'s offset
> also surfaced that the existing "P3's `0x12` unconditionally writes
> `charBase[statIndex×2]` — no alive-flag check" claim (§6.3(b)/§5) is
> **incomplete**: the real handler (a) *does* skip dead members
> (`char.+0x2C == 0` gates the loop body, file `0x1ccf0`-`0x1cd02`), and
> (b) has three special-cased `statIndex` values before falling through
> to the plain set: raw `0x75` (117, unremapped) triggers `LearnSpell(
> charIdx, 57)` (the exact function §3.5 traced for Divine Aid), and
> remapped `0x34`/`0xe`/`0xf` (52/14/15) instead subtract from
> Experience Points (`char.+0x102`) or deduct party gold (`$44b2`,
> capped `0xff00`) rather than writing a stat at all. Not corrected in
> `scripting-engine.md` this pass (out of this task's stated docs-only
> scope) — recorded here so it isn't lost; a future pass touching that
> file should fold it in.

### 3.4 Armoury — stock builder and dispatch letter both confirmed

`data-tables.md` §6.4's armoury-stock builder (file `0x8b5a`,
`stock[18 armouries][181 item ids]` read from `inititem.dat`'s
`hunk1+0x44BA` runtime cache) is **re-confirmed byte-exact** this pass
(re-disassembled independently and matched instruction-for-instruction
against that section's pseudocode). Which keystroke reaches it was
**initially ambiguous from static disassembly alone** and is now
**resolved by a screenshot oracle**:

- On-screen, the letter is `A` (`"A) Armoury"`, confirmed string, and
  confirmed live in `default_65.png`'s `Options` menu, §1).
- The dispatcher's `A` slot (file `0xb3be`) leads to a character-select
  loop whose per-character worker (file `0x10fca`) copies the selected
  character into the `$30E0` scratch and reads a table adjacent to the
  item-price cache (`$44b2`, next to the confirmed `$44BA` item-price
  base) — plausible as "open this character's equip screen", but static
  tracing alone did not reach `0x8b5a` within the instructions actually
  read this pass.
- The dispatcher's `O` slot (file `0xb218`) **does** directly and
  unambiguously reach `0x8b5a` (one of only 3 callers project-wide, the
  other 2 also standalone small functions). Its on-screen label,
  resolved via the same string-pointer-table technique as §1, is
  `"O) Load"` — i.e. loading a saved roster/game position, not opening a
  shop; this call is presumably `0x8b5a` being reused to rebuild whatever
  shop display is currently on screen as part of restoring UI state
  after a load, not evidence that `O` itself opens a shop.
- **`default_88.png` (already in this repo) settles it directly**: it
  shows the caption `"THIEF is in the armoury"` with an item list —
  `Clothing`/`Robes`/`Leather`/`Knife`/`Club`/`Mace`/`Healing Potion 5`/
  `Magic Potion 5`/`Scroll IV`/`Scroll VIII`, prices and point-values
  included — that matches `data-tables.md` §6.4's decoded **armoury 1**
  stock row *exactly*, item-for-item, in the same order (`"armoury 1
  (10): Clothing x5, Robes x5, Leather x1, Knife x1, Club x1, Mace x1,
  Healing Potion 5 x5, Magic Potion 5 x5, Scroll IV x200, Scroll VIII
  x200"`). This confirms two things at once: the Armoury really is
  reached per-character (`"THIEF is in the armoury"`, matching `A`'s
  character-select step at `0xb3be`/`0x10fca`), and the confirmed
  `0x8b5a` stock table really is what's displayed there. `A` is
  therefore the real Armoury dispatch letter; `O`'s reachability of the
  same builder is a secondary/incidental call, not the primary path.
  The `0x10fca`→`0x8b5a` link past what was statically traced this pass
  (i.e. the exact instructions that get from the equip-screen entry to
  the stock builder) remains unread, but is no longer in doubt about
  *which letter* — only about the exact intermediate call chain, a much
  narrower and lower-priority gap.

### 3.5 Learn Spells — eligibility, cost, and effect all confirmed

Handler `L` → file `0xb60a`, same character-select idiom as Inn/Training
(eligible: alive `Status != 0`, `Status != 3` ("Out"), `Race != 0x11`
(Undead) — identical exclusion set to Inn/Training §3.1/§3.2), worker
file `0x1041a`-`0x109cc` reached via `jsr $103f2.l` (raw operand,
real target `0x1041a`).

**Eligibility (party-wide progress gate, not just per-character).** The
function computes a **per-class spell-index range** from `char.+0x94`
(Class): Fighter `{0,0}`, Thief `{1,1}`, Priest `{2,4}`, Ranger `{5,6}`,
Monk `{7,8}`, Wizard `{9,12}` (file `0x10468`-`0x104b6`) — i.e. **each
class can only ever learn from a small, class-specific slice of the
57-entry spell table via this screen**, not the whole catalogue. A
helper at file `0x10b56` cross-references a `[spellIndex][15 level]`
byte availability table (`hunk1+0xD8E`) against that class's range and
the character's level, **excludes any spell index already present in a
global "spells discovered so far" tracking array** (`hunk1+0x3190`,
running count in `$3136`), and returns the count of genuinely
learnable-and-not-yet-known candidates. Learning is blocked (with a
message, file `0x105ac`) unless **both** `$3136` (party-wide spells
discovered) is `>=` a level/Intelligence-derived threshold **and** at
least one such candidate exists.

This means `$3136`/`hunk1+0x3190` gate which spells are *reachable* at
all — the small per-class starting ranges above (13 spell indices total
across all 6 classes, out of 57) are consistent with the manual's own
already-documented note that Divine spells (`#57+`) "may only be
acquired during [game progression]" (`data-tables.md` §3.1) — this pass
extends that same shape to the *entire* mid/high spell catalogue, not
just Divine Aid specifically. **Where `$3136`/`hunk1+0x3190` actually get
incremented (dungeon events? scrolls? plot flags?) was not traced this
pass** — a new, narrower open item, see §5.

**Cost formula** — reuses the same armoury markup table Training does:

```
threshold = f(level, class, Intelligence)      ; word table hunk1+0xA24[Int−3,
                                                ; capped 22] × level×classFactor,
                                                ; /90 (file 0x10544-0x10596)
delta     = threshold − $3136
base      = shopMarkup[$2856] × 9000 / 100     ; hunk1+0x1144, data-tables.md §7
classDiv  = per-class constant (2nd class switch, file 0x105f8-0x10650)
cost      = base × (Charisma × Intelligence / classDiv) / 100
cost      = clamp(cost, 1, 250)
```

If `cost > party gold` (`$44b2`), cancels with a message. **Gold is
deducted unconditionally on confirming**, before the success roll below
— failure still costs the money, matching the flavour of "the guild
takes payment for the lesson regardless of outcome."

**Which spell — browsed and chosen, not auto-unlocked.** The eligible
candidates are packed into a scratch list (`hunk1+0x2c6e`, spell-index
byte per slot) and the player scrolls/picks one via a list UI (file
`0x10808`-`0x108a0`, the same "keyboard-driven scroll list" idiom used
throughout this dispatcher's other facilities) — **not** a fixed
next-in-sequence unlock the way skill maxima recompute on level-up
(§3.2). Cancelling the list (a negative return code) aborts with no
gold spent.

**Success roll and the actual write, resolving the `knownSpells` field
offsets** (`src/state/CharacterState.ts`'s `knownSpells: number[]`):

```
roll = Random(20)
if roll > Intelligence: FAIL — gold already spent, nothing learned
else:                   SUCCESS
  spellIndex = candidateList[chosenSlot]        ; file 0x108f0
  LearnSpell(charIdx, spellIndex)                ; file 0x10adc
```

`LearnSpell` (file `0x10adc`-`0x10b54`), disassembled directly:

```
if spellIndex <= 0: no-op
elif spellIndex == 0x39 (57, "Divine Aid"):
    char.+0xF0 = spellIndex                      ; single dedicated word field
elif char.+0x56 < 0x20 (32):                      ; +0x56 = known-spell COUNT
    char.+0xB0[char.+0x56] = spellIndex           ; append to a 32-slot word array
    char.+0x56 += 1
```

So the confirmed field map (extending `scripting-engine.md` §7.5.3):
`+0x56` = **known-spell count** (word, 0-32), `+0xB0`-`+0xEF` = **known
spells array** (32 × word, raw spell indices 1-56, append-only, no
dedup check found — learning the same spell twice would append a
duplicate entry), `+0xF0` = **Divine Aid known flag** (word, holds `57`
once learned, `0` otherwise — its own dedicated slot because opcode
`0x19`'s hardcoded "`statIndex == 0x75` → check Divine Aid" special
case, `scripting-engine.md` §5, reads this exact convention rather than
scanning the general array). `+0xF0` sits immediately before the
confirmed `+0xF2` body-location block — a previously-undocumented 2-byte
gap, now filled. This is a **direct, offset-exact match** for the
`number[]`-of-spell-indices shape `src/state/CharacterState.ts` already
modelled `knownSpells` after, confirming that data-model choice was
right even before the real offsets were known.

**Confidence: confirmed** — every step disassembled directly and
contiguously (file `0x1041a`-`0x10b54`), cross-referencing already-
confirmed fields (Level, Class, Intelligence, Charisma, the armoury
markup table, the confirmed 57-entry spell name table `data-tables.md`
§3.1) and yielding two new, internally consistent character-record
fields plus one new class/level spell-availability table and one new
global "spells discovered" tracking pair. **Open**: what drives
`$3136`/`hunk1+0x3190` (§5), and whether a duplicate-spell guard exists
elsewhere (none was found in `LearnSpell` itself).

### 3.6 Bank — deposit/withdraw, fully confirmed

Handler `B` → file `0xb480`, worker file `0x1183a`-`0x11be8`. Eligibility
is a plain flag pair (`$288c == 0` and `$2850 != 0` — the latter is the
already-familiar "party size" global used as a nonzero gate throughout
this dispatcher). No per-character selection step, and no per-character
eligibility filter — the Bank operates on the whole party at once.

**Two persistent gold pools, confirmed**:

- **Carried gold**: the global `$44b2` (`u32`) — the same "party gold on
  hand" global already confirmed as the payment source for Training
  (§3.2) and Learn Spells (§3.5).
- **Banked gold**: `char.+0xFE` (`u32`), **per character**, already
  named "Gold in bank" in `scripting-engine.md` §7.5.3's confirmed field
  map (from the character-sheet draw routine) but never previously
  traced to a consumer. This pass confirms it really is a per-character
  balance, not a party-wide total — the Bank UI shows the *sum* across
  all party slots (`Σ char[i].+0xFE`, file `0x118bc`-`0x118e6`) but the
  storage itself is one field per character.

**The two Bank actions**, both disassembled directly to the function's
own `RTS`:

- **Withdraw All** (menu option 0, file `0x11a5c`-`0x11a8e`): `$44b2 +=
  Σ char[i].+0xFE` (the same sum just displayed), then `char[i].+0xFE =
  0` for every party slot. No partial withdrawal — it is all-or-nothing.
- **Deposit** (menu option 1, file `0x11a92`-`0x11bb4`): prompts for an
  amount (`jsr $3e0e.l` → real `0x3e36`, a numeric input widget; parsed
  via `jsr $20cbe.l` → real `0x20ce6`), clamped to `<= $44b2` (can't
  deposit more than carried), then:
  ```
  $44b2 -= amount
  share     = amount / partySize                        ; integer division
  remainder = amount − share × partySize
  repeat `remainder` times:
      pick a random living party member (jsr $18846.l → real 0x1886e)
      that member's char.+0xFE += 1
  for every party member i:
      char[i].+0xFE += share
  ```
  i.e. **the deposited amount is split evenly across every party
  member's own bank balance, with any division remainder distributed
  one gold piece at a time to randomly-chosen members** rather than
  being lost to integer rounding or dumped entirely on one character.

**Confidence: confirmed** — every step disassembled directly and
contiguously (file `0x1183a`-`0x11be8`), reusing the already-confirmed
`+0xFE`/`$44b2` fields and the same numeric-input/random-pick utility
functions Training and Learn Spells also use. No open items — this
facility is fully understood end to end.

### 3.7 Distribute and Trade Item — the post-dungeon loot/XP flow

These two turned out to be tightly linked, and neither is what a first
guess would suggest. **Trade Item is not a sell-to-town screen** (P3 has
no loot-selling mechanic anywhere in this dispatcher — see §3.8's note),
and **Distribute's town-menu-reachable behaviour is not "split gold"** —
that mechanic exists, but on a different, *automatic* code path through
the same worker function.

**`D) Distribute`, dispatcher key `D` (file `0xb380`) → worker file
`0xbca4`-`0xc31c`, called with `Param = 2` (`move.w #2,-(a7)` at file
`0xb3a0`, immediately before the call).** The worker function is shared
by two structurally distinct modes selected by this parameter; only
mode `2` is reachable from the town menu.

**Mode 2 (`D`'s own mode) — reset: un-equip everyone, recall all loot
into one shared pool.** For every party member: clears the three
confirmed equipment-slot fields (`+0x6A` armour, `+0x6C` melee weapon,
`+0x86` bow) plus one undocumented adjacent field `+0x68`; clears the
global item pool (`$44ac` count, `hunk1+0x4434` 60-slot word array —
the *same* pool combat's own loot-drop function writes into, see §3.8);
then, for each party member, scans their own **9-slot carried-item
array** (`hunk1+0x3da0`, `[partySize][9]` words — a newly-identified
per-character "backpack" table) for valid item ids (`1`-`179`) and
copies each one into the shared pool, incrementing `$44ac`. Finally
clears each member's carried-item array and their `+0x2A` item-count
field (§3.7's own newly-confirmed field, gating Trade Item below).
**Net effect: every character's worn gear and carried loot all end up
back in one shared, unassigned pool** — a full reset/recall, not a
distribution *to* anyone. It then falls into the *same* item-assignment
screen (`jsr $c3e6(pc)`, file `0xc1e0`) mode 1 also uses below — see the
correction block after §3.7's confidence line for the full trace of
what that screen does and why the two modes still feel different in
play despite sharing it.

**Mode 1 (auto-triggered on town arrival, not reachable via any town
menu key) — assign this trip's items, then assign share weights and
divide pooled XP.** The function's only other caller is at file
`0x798c`, inside the town screen's own entry/setup code (file
`0x7970`-`0x7994`): if `$44ae` (pooled XP, §3.8) `> 0` **or** `$44ac`
(pooled items) `> 0`, and a "currently showing" guard flag (`$288c`) is
clear, the game calls this same worker with `Param = 1` automatically —
no player action needed. This mode:
1. Runs a per-character prep pass (`jsr $cea4` for every member) and an
   unidentified helper (`jsr $c360`, not expanded this pass).
2. Sorts the shared item pool (`Sort($4434, $44ac)`, real function
   `$d0b4` — confirmed this pass to be a generic word-array sort, not an
   assignment step, see the correction block below).
3. **If `$44ac > 0`**: calls the confirmed item-assignment screen
   (`$c3e6`, see the correction block below) to let the player browse
   and assign this trip's pooled items to characters.
4. **If `$44ae > 0`**: for every party member, prompts (via the
   numeric-input widget also used by Bank/Learn Spells) for a **share
   weight**, stored at `char.+0x54` (a newly-identified field) —
   clamped `1`-`3` for living members, `0`-`3` for dead ones (a dead
   member can be given `0`, i.e. excluded).
5. Sums all members' `+0x54` into `totalShares`.
6. **First pass**: `quotient = $44ae / totalShares` (integer division);
   if `quotient > 0`, awards `quotient` individual `+1` increments to
   `char.+0x102` (**Experience Points**, already confirmed), each aimed
   at a **uniformly random** living member (`Random(partySize)`,
   *ignoring* the share weights) — file `0xc244`-`0xc26e`.
7. **Second pass**: `$44ae -= quotient`; `perShareRemainder =
   (new $44ae) / totalShares`; for every member, `char.+0x102 +=
   char.+0x54 × perShareRemainder` — file `0xc29a`-`0xc2ce`, this part
   *does* honour the share weights.
8. Shows a summary message, clears `$44ae` to `0`.

The exact narrative reason for splitting into an unweighted-random pass
followed by a weighted pass (rather than one weighted pass) wasn't
determined — both are disassembly-confirmed as written, not a
misreading, but why the design does it this way is not explained by the
code alone (recorded as an observation, not a solved question).

**`G) Trade Item`, dispatcher key `G` (file `0xb9be`) → worker file
`0xf2e8`-`0xf6ac`.** Picks an eligible character (filter param `0x40`)
whose `+0x2A` item count is nonzero, then browses **that character's
own** `hunk1+0x3da0` carried-item array (resolving each id through the
confirmed item-name pointer table `hunk1+0x11E8`) and lets the player
pick one. On picking an item, it prompts for a **second** character
(filter param `0x41`) — **the recipient** — checks the recipient's
`+0x2A` count is `< 9` (their own 9-slot array isn't full; if it is,
shows an "inventory full"-style message and cancels), then:
```
sourceChar.+0x3da0[]   : remove the picked item, shift remaining
                          entries down one slot, sourceChar.+0x2A -= 1
recipientChar.+0x3da0[recipientChar.+0x2A]  := pickedItemId
recipientChar.+0x2A += 1
```
**This is a direct item transfer between two named party members' own
carried-item inventories — there is no gold exchanged, and nothing is
sold to or bought from the town.** The original "sell loot back to the
Armoury" hypothesis is **refuted**: no code path in this function
touches `$44b2` (party gold), the armoury markup table, or
`inititem.dat`'s stock cache. Both source and recipient get a refresh
call afterward (`jsr $ce7c(pc)` → real `0xcea4`, the same per-character
refresh helper Distribute's mode 1 calls once per member at its own
start).

**Confidence: confirmed** for both facilities' overall shape and every
field/table cited (disassembled directly and contiguously — Distribute
file `0xbca4`-`0xc31c` plus its two call sites `0xb3a0`/`0x798c`; Trade
Item file `0xf2e8`-`0xf6ac`).

> **Completion (this pass) — `$c3e6`/`$d0b4` expanded, resolving
> `town-p3-distribute-pool-assignment-ui`.**
>
> **`$d0b4` (file `0xd0b4`-`0xd126`) is not an assignment UI at all —
> it's a generic in-place selection-sort over a `(array, count)` word
> array**, called from mode 1 as `Sort($4434, $44ac)`: it just sorts the
> shared pool's item ids before display. Unrelated to per-character
> assignment.
>
> **`$c3e6` (file `0xc3e6`-`0xcd76`) *is* the item-assignment screen,
> and it answers the coordinator's question directly: it is called from
> *both* modes, and it always processes the entire pool with no
> "this trip only" marker.** Structure, disassembled end to end:
> 1. Prints the roster (name, class, status) as a fixed header block.
> 2. Loops `i = 0` to `$44ac − 1` **unconditionally** — file `0xc60c`
>    (`clr.w -0x8(a5)`) through `0xcd3a` (`cmp.w $44ac.l,d0; blt.w
>    0xc614`) — showing every pool item's name (`hunk1+0x11E8`) and
>    stats (`hunk1+0xF10`/`0xF75`, the confirmed point-value/attributes-
>    required tables). For each item, it also computes every living
>    member's **capability score** against that item (`jsr $ce6c` — the
>    same helper `data-tables.md` §7 already confirmed backs the
>    Armoury's "N/A" display) and shows a per-character eligibility
>    indicator — i.e. this is a genuine "which of your items can each
>    character use" browse-and-assign grid, reusing the Armoury's own
>    eligibility logic. **No loop-start variable is derived from a
>    battle-start snapshot, a "new since last visit" count, or any
>    marker at all — the loop always starts at pool index `0`.**
> 3. After the loop: `$44ac = 0` (clears the *whole* pool), refresh
>    (`jsr $bc4a`), a message (`"..."`, file `0x1d74`), then **falls
>    straight through into the same tail this project already knew as
>    one of the 3 callers of the confirmed armoury-stock builder**
>    (file `0xcd48`-`0xcd76`, `jsr $8b32` → real `0x8b5a`) — this was
>    previously catalogued as a separate, unidentified caller; it's
>    actually `$c3e6`'s own final instructions, not a distinct function.
>    Rebuilding the armoury display right after an item-assignment
>    session makes sense if the party can be standing in the Armoury
>    while this runs.
>
> **So: item assignment genuinely happens on both the auto-trigger and
> the menu-`D` path, through one shared, unscoped function — there is
> no code-level "just this expedition's loot" restriction anywhere.**
> The owner's memory is **not wrong about what they experienced**, but
> the mechanism isn't a scoping rule in `$c3e6` itself — it's an
> emergent effect of *when* each mode runs and *what has had a chance
> to populate the pool by then*:
> - **Auto-trigger (mode 1)** fires on town arrival, gated on `$44ac >
>   0` (§3.8: only combat's `AddLootItem` — this trip's drops — has
>   touched the pool by this point, since mode 2's own recall logic
>   hasn't run yet). In practice, the pool `$c3e6` browses here really
>   does contain only what was found on the expedition just completed.
> - **Menu `D` (mode 2)** first runs its own reset (§3.7 above: clears
>   every character's equipment slots, dumps their entire `+0x3da0`
>   carried-item history — not just this trip's drops — into the same
>   pool) *before* falling into the identical `$c3e6` browse-and-assign
>   screen. So by the time `D` gets there, the pool is "everything the
>   party owns," not "this trip's loot."
>
> Same function, same code path, two different *pool contents* by
> construction — not two different assignment mechanisms. This is a
> more precise and more interesting answer than either the original
> "unexpanded, unknown" framing or a flat "yes, exactly as remembered";
> recorded here rather than forced into the owner's framing, per this
> pass's own instruction not to overclaim a match. No further residual
> item for this specific question — `town-p3-distribute-pool-
> assignment-ui` is closed.

### 3.8 Post-combat rewards — where gold, XP, and loot actually come from

Not part of the town dispatcher at all — as the task anticipated, this
lives in the combat-resolution code, confirmed by direct disassembly of
a battle-rewards function around file `0x19ce0`-`0x19dd4` (found by
cross-referencing writers of `$44ae`/`$44ac`, the two globals Distribute
§3.7 consumes) and a separate `AddLootItem` helper at file `0x1a1ba`.

```
; battle-rewards function, file ~0x19ce0
goldReward = MonsterField(monster, 0x22)     ; jsr $19e6a(pc), two calls
xpReward   = MonsterField(monster, 0x24)     ; reading two fields off the
                                              ; defeated monster's record —
                                              ; 0x22/0x24 are literally the
                                              ; monster record's own offsets:
                                              ; data-tables.md §3 already
                                              ; confirms +0x22 = Gold (u16),
                                              ; +0x24 = Experience (u8) —
                                              ; MonsterField(m, off) is a
                                              ; generic field-read helper,
                                              ; not a new/separate field
$44b2 += goldReward                          ; gold: awarded INSTANTLY,
                                              ; directly to carried gold
$44ae += xpReward                            ; XP: added to the POOL that
                                              ; Distribute's auto-triggered
                                              ; mode 1 (§3.7) later divides
; then computes goldReward/partySize and xpReward/partySize purely for
; a "your party earns ~X gold, ~Y XP" on-screen announcement — this
; per-member figure is NOT what actually lands in each character's
; +0x102; the real division happens later, in town, via §3.7's mode 1

; AddLootItem(itemId), file 0x1a1ba — called separately per dropped item
if $44ac >= 60 (0x3c):
    show "no room" message, discard the item
else:
    hunk1+0x4434[$44ac] = itemId
    $44ac += 1
```

This confirms the mechanism the project owner remembered as one linked
flow: **a battle awards gold immediately, but pools XP and drops items**
into two globals (`$44ae`, `$44ac`/`hunk1+0x4434`) that sit untouched
until the party is back in town, at which point Distribute's
auto-triggered mode 1 (§3.7) pops up unprompted to let the player
allocate share weights and see the pooled XP divided out. Trade Item
(§3.7) is the *separate*, player-initiated tool for moving already-
carried loot between party members afterward — not part of the
automatic post-battle flow itself.

**Confidence: confirmed** for the gold/XP split, `AddLootItem`'s shape,
and the `MonsterField` offsets themselves (`0x22`/`0x24` are exactly
`monsinfo.dat`'s own already-confirmed `+0x22` Gold (`u16`) and `+0x24`
Experience (`u8`) fields, `data-tables.md` §3 — `MonsterField(monster,
offset)` is simply a generic field-read helper over that same 38-byte
record, not a new field space). **Open**: the exact per-item monster
drop-table/probability logic that decides *which* items a defeated
monster drops — only the "add one item to the pool" primitive
(`AddLootItem`) was traced, not its caller or trigger condition.

## 4. Character creation

Reached via `N) New Member` (dispatcher key `N`, file `0xb4b4` →
`0x12bfc`/`0x12c24`). The function is large (roughly file `0x12c24`-
`0x13a0e`, immediately followed by the already-confirmed `FireBowMax`
skill-maxima function at `0x13a96`-`0x13b76`, `scripting-engine.md`
§7.5.3 — i.e. character creation and the level-up skill-maxima routine
sit back-to-back in the same source region, consistent with both being
part of one "apply a character's derived stats" code family).

### 4.1 Flow (mostly traced)

1. Race selection — a 6-per-page scrollable list drawn from the confirmed
   `hunk1+0x15BC` race-name table (`scripting-engine.md` §7.5.3),
   committed to `char.+0xA8`/`$3188`; a "random race" option present in
   the UI rolls `Random(10)+5` (range 6-15) directly into `$3188` instead
   of taking the list-scroll path. The exact commit point for the normal
   (non-random) list-scroll path wasn't isolated this pass — only the
   random-roll shortcut's write site was traced.
2. **Class selection — now traced** (found while chasing §4.2's
   `selector` producer): the same scrollable-list UI pattern reused
   against the confirmed `hunk1+0x1604` class-name table (6 entries),
   committed to `char.+0x94`/`$3174` at file `0x1309c`, immediately
   followed by a *second*, differently-shaped 2-item selection screen
   (file `0x130da`-`0x132a2`, also drawing from the class-name table but
   only 2 slots deep, committing to the same `$3174`) whose purpose
   wasn't identified this pass — possibly an alignment or sub-class
   choice that happens to reuse the class-name table's memory layout, or
   a UI quirk; not resolved.
3. Attribute rolls (§4.2).
4. Starting HP/MP (§4.3).
5. A social-class roll (`Random(75)`, bucketed at 30/60/90 into `$316E`,
   `×256` into `$31DE` — plausibly starting gold-by-social-class; not
   cross-checked against the confirmed Social Class field `+0x8E` this
   pass, recorded as unresolved).

### 4.2 Attribute roll — confirmed

For each of Strength, Intelligence, Dexterity, Constitution, Charisma
(`statIndex` 0-4, in that order — matches the confirmed attribute
display order `+0x0A`-`+0x14`, `scripting-engine.md` §7.5.3), a shared
roller at file `0x13faa` computes:

```
roll = Random(6) + Random(6) + Random(6)                          ; 3d6
roll += classModifier[classIdx][statIndex] − 10
roll += selectorModifier[selector][statIndex] − 10
roll += 3
```

— i.e. **classic 3d6 plus two additive class/selector modifiers**, each
centred on 10 (so a modifier table entry of 10 is a no-op, entries above
10 are positive, below are negative). `classIdx` is confirmed (the same
local the starting-HP/MP code below uses, cross-checked against
`hunk1+0x9CA`'s already-known-by-class MP chart, §4.3).

> **Correction/completion (this pass) — `selector`'s producer found,
> resolving `town-p3-charcreate-selector-table`, and the second table's
> size corrected.** Tracing `-0x1c(a5)` (the roller's `selector`
> argument) back through the character-creation function to where it's
> set, file `0x13320`: **`move.w $3188.l, -0x1c(a5)`** — `$3188` is
> `char.+0xA8`, the **confirmed Race field**. `selector` is simply
> **the character's own raw race index (0-17)**, not a coarse category
> — the original "table size only allows 6 rows" reasoning that led to
> the "hypothesis" framing was itself wrong: `hunk1+0x8AC` was only
> dumped 30 bytes on the original pass (matching the *class* table's
> size by analogy, without independently checking where the data
> actually stops); re-dumped at the full 18-row width this pass, it
> **is** a real 90-byte, 18-row table, and every row resolves to a
> thematically perfect racial stat-modifier profile (below). The
> `classModifier` table (`hunk1+0x88E`, confirmed 6×5, gap-verified
> against the next known table) is unaffected by this correction.

Byte-exact table contents (`hunk1+0x88E`, class-indexed, 6×5 bytes,
class order Fighter/Thief/Priest/Ranger/Monk/Wizard; `hunk1+0x8AC`,
**race**-indexed, 18×5 bytes, race order per the confirmed
`readP3RaceNames()` table — `data-tables.md` §4.1 — columns
Str/Int/Dex/Con/Cha for both):

| Class | Str | Int | Dex | Con | Cha |
|---|---|---|---|---|---|
| Fighter | 12 | 8 | 11 | 10 | 9 |
| Thief | 8 | 10 | 12 | 10 | 9 |
| Priest | 10 | 12 | 10 | 10 | 10 |
| Ranger | 10 | 11 | 10 | 10 | 11 |
| Monk | 10 | 10 | 11 | 10 | 10 |
| Wizard | 6 | 13 | 8 | 10 | 11 |

(Fighter +2 Str/−2 Int, Wizard −4 Str/+3 Int — thematically exactly what
a class-modifier table should look like, taken as strong circumstantial
confirmation of the row order and the `value − 10` reading.)

| Race | Str | Int | Dex | Con | Cha |
|---|---|---|---|---|---|
| 0 Human | 10 | 10 | 10 | 10 | 10 |
| 1 Dwarven | 12 | 9 | 9 | 11 | 9 |
| 2 Elven | 9 | 11 | 11 | 9 | 10 |
| 3 Gnome | 11 | 9 | 10 | 11 | 9 |
| 4 Halfling | 8 | 10 | 12 | 10 | 9 |
| 5 Random | 0 | 0 | 0 | 0 | 0 |
| 6 Gnoll | 12 | 5 | 9 | 13 | 3 |
| 7 Goblin | 9 | 6 | 10 | 9 | 3 |
| 8 Kobold | 9 | 7 | 11 | 11 | 5 |
| 9 Lizard Man | 11 | 6 | 9 | 10 | 5 |
| 10 Minotaur | 12 | 6 | 8 | 11 | 4 |
| 11 Ogre | 13 | 6 | 8 | 11 | 5 |
| 12 Orc | 11 | 8 | 9 | 10 | 6 |
| 13 Pixie | 8 | 10 | 13 | 8 | 9 |
| 14 Sprite | 8 | 10 | 14 | 8 | 9 |
| 15 Troll | 14 | 5 | 7 | 12 | 4 |
| 16 Elemental | 18 | 18 | 18 | 18 | 18 |
| 17 Undead | 20 | 17 | 17 | 19 | 17 |

Every row is thematically coherent — Human is the flat +0 baseline;
Dwarven/Gnome are Str/Con-heavy and Cha-poor; Elven is Int/Dex-heavy and
Str-poor; Halfling/Pixie/Sprite are Dex-heavy and Str-poor; the
"monstrous" races (Gnoll-Troll) all trade Int/Cha for Str/Con, matching
the class table's own thematic pattern above; **`5 Random` (a
character-creation menu option, not a playable race — `data-tables.md`
§4.1) is genuinely all-zero**, confirming it's never actually indexed
into this table in practice — the game's own "roll me a random race"
option (§4.1) immediately re-rolls to a concrete race (`6-15`) before
any stat math runs, so `selector = 5` never occurs for a real character.
Elemental/Undead's enormous uniform `+8`/`+7-10` bonuses are consistent
with them being rare, powerful, hard-to-unlock races elsewhere in this
project's corpus. This is now a fully self-consistent, byte-exact,
18-race table — no residual ambiguity.

**Luck** (the 6th attribute) is rolled separately, not through the
shared roller: `Luck = Random(6) + 7` (range 8-13), then adjusted by raw
race index (not the `selectorModifier` table above): `Luck × 2 / 5` for
most races, `Luck × 5 / 2` for races `{1, 4, 13}` — now nameable using
the same confirmed race order as the table above: **Dwarven, Halfling,
Pixie**. (Why these three specifically get the boosted-Luck path rather
than the ×2/5 path was not investigated — recorded as an observation,
not explained.)

**Confidence: confirmed**, formula shape, both tables' full byte
content, and the `selector = raw race index` producer all disassembled
directly (file `0x13320`, `0x13480`-`0x13594`, worker `0x13faa`-
`0x14030`). No open items remain in this subsection.

### 4.3 Starting HP and MP — confirmed

Computed at file `0x13380`-`0x13402`, immediately before the attribute
rolls in §4.2 (same function, same `classIdx` local):

```
mpChart      = hunk1+0x9CA[classIdx × 15 + 0]      ; byte; level-1 column of
                                                     ; the same [6][15] MP chart
                                                     ; the Inn reads for level-
                                                     ; based MP growth (§3.1)
MP max       = MP current = mpChart × 75 / 100

diceCount    = hunk1+0x94C[classIdx × 21 + 0]      ; byte; level-1 column of
                                                     ; a [6][21] table (columns
                                                     ; 1-20 not read at creation
                                                     ; — plausibly the same
                                                     ; chart read at higher
                                                     ; columns on level-up,
                                                     ; not confirmed)
HP max = HP current = Σ (Random(2) + 1), diceCount times   ; diceCount dice,
                                                             ; each 1d2+1 (range 2-3)
```

Byte-exact table contents (both class-indexed, class order
Fighter/Thief/Priest/Ranger/Monk/Wizard):

**MP chart** (`hunk1+0x9CA`, `[6 class][15 level]`, byte):

| Class | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 | L11 | L12 | L13 | L14 | L15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fighter | 7 | 7 | 8 | 8 | 9 | 9 | 10 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 18 |
| Thief | 6 | 6 | 7 | 7 | 8 | 8 | 9 | 10 | 11 | 12 | 13 | 13 | 14 | 14 | 15 |
| Priest | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 20 | 20 | 20 | 20 |
| Ranger | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 18 | 18 | 18 | 19 |
| Monk | 10 | 10 | 10 | 11 | 11 | 11 | 12 | 12 | 12 | 13 | 13 | 14 | 16 | 18 | 20 |
| Wizard | 10 | 11 | 11 | 12 | 13 | 14 | 14 | 15 | 16 | 16 | 17 | 17 | 18 | 19 | 20 |

**HP dice-count table** (`hunk1+0x94C`, `[6 class][21]`, byte — only
column 0 read at creation; full 21-column dump, remaining columns not
independently interpreted):

| Class | col0 (L1) | remaining columns |
|---|---|---|
| Fighter | 5 | 10 16 22 28 35 41 47 53 60 65 70 75 80 85 90 95 100 105 110 115 |
| Thief | 3 | 5 9 11 16 20 24 27 30 35 39 43 47 51 55 59 63 67 71 75 79 |
| Priest | 4 | 6 10 15 20 25 30 35 40 45 49 53 57 61 65 69 73 77 81 85 89 |
| Ranger | 4 | 9 14 20 25 30 36 42 48 55 60 65 70 75 80 85 90 95 100 105 110 |
| Monk | 4 | 5 9 11 16 22 27 31 35 40 44 48 52 56 60 64 68 72 76 80 84 |
| Wizard | 3 | 4 6 8 11 14 17 19 22 25 28 31 34 37 40 43 46 49 52 55 58 |

**Verification against the manual.** `data-tables.md` §7's already-
transcribed manual "Hit Points by Class and Level" chart states Fighter
level 1 = **10** (the manual's stated values are apparently a fixed
number, not a range — this table's earlier byte-search against that
chart, described in `data-tables.md` §7's correction block, was run
against the *wrong* table, `hunk1+0x0F10`, and correctly found no match
there). Fighter's `diceCount = 5` here gives a roll range of
`5×2 = 10` (all dice roll minimum `1+1`) to `5×3 = 15` (all roll maximum
`2+1`) — **the manual's stated value of 10 is exactly this formula's
minimum possible roll**, for the one data point available. This is
consistent with (though not conclusive proof of) the manual quoting a
"guaranteed floor" rather than every game instance rolling exactly the
same fixed number; no second manual level or class value was
cross-checked this pass.

**Confidence: confirmed** for the formula shape and both tables' byte
content (disassembled directly). **Rendered/plausible, not independently
verified against a second manual data point** for the specific claim
that the manual's numbers are this formula's minimum.

## 5. Paths tried / open items

| Item | Approach | Result |
|---|---|---|
| ~~Armoury dispatch letter (`A` vs `O`)~~ | Traced `A`'s handler (`0xb3be`) forward to its per-character worker (`0x10fca`), then reverse-searched every JSR caller of the confirmed stock builder (`0x8b5a`) | Two static findings disagreed (`A`'s trace stalled before reaching `0x8b5a`; the only dispatcher-reachable caller of `0x8b5a` was keyed to `O`, labelled `"Load"`) — **resolved by a screenshot oracle**, not a third disassembly method: `data/default_88.png` (already in this repo) shows `"THIEF is in the armoury"` with an item list matching `data-tables.md` §6.4's decoded armoury-1 stock row exactly. `A` is confirmed as the real Armoury letter; §3.4 |
| ~~Training's actual stat-increase effect~~ | Continued the disassembly straight past the confirm dialog (`0xe0f6`-`0xe584`, one contiguous read, no new method needed) | **Resolved**: Level+1 (capped 21), gold deducted, HP re-rolled via the same class/level dice table character creation uses (different die: `Random(3)` vs. creation's `Random(2)+1`), and the confirmed `0xe67a` skill-maxima routine invoked 3×; §3.2 |
| ~~Mystic's actual effect~~ | Continued the disassembly to the function's own `RTS` (`0x12178`-`0x123c4`) | **Resolved**: zero field writes found anywhere in the function — it's a pure read-only status/flavour report (reputation-tier title + up to 3 conditional lines), not a shop or mechanical service; §3.3 |
| ~~Character creation's `selector` modifier-table index~~ | Traced `-0x1c(a5)`'s producer backward from the roll site through the rest of the character-creation function (found at file `0x13320`) | **Resolved**: `selector = char.+0xA8` (raw race index, 0-17) — the earlier "table only allows 6 rows" reasoning was itself an artifact of an under-sized dump; re-dumped at the full 18-row width, every row resolves to a coherent per-race modifier. §4.2 |
| Tavern-equivalent hireling pool | Grepped `inititem.dat`, `monsinfo.dat`, and the `PhantasieIII` executable's `hunk1` region for a fixed-stride record array shaped like P1's 282-byte, 25-slot `twns.int` region 8 (`dungeon-format.md` `world-p1-twns-int-fields`) | No candidate found; P3 has no `twns.int`-shaped file at all (already established) and no in-executable table of this shape was found either — recorded as a genuine absence for this pass, not a search-technique failure, but not exhaustively ruled out (no amiberry oracle available to confirm no such screen exists in play) |
| Training's `0xab44` per-skill-selection helper | Read the 3-call loop shape (`0xe518`-`0xe534`) but did not disassemble `0xab44`'s own body | Open: which/how many skills Training actually improves beyond the level-up maxima recompute isn't pinned down — narrower than the original "effect entirely unknown" gap, see §3.2 |
| Mystic's `+0x18`/`+0x5C` character-record flags | (1) Direct CODE-hunk address search for `0x3d22`/`0x3d66` — only Mystic's own read found. (2) Derived their P3 script-opcode `statIndex` equivalents (8 and 42, via `GetCharBase`'s `+8` offset) and scanned all 11 real `D/dng*.dat` action tables for opcode `0x12`/`0x13`/`0x18`/`0x19` records referencing them | **Narrowed, not resolved**: both indices are real and tested by shipped content (opcode `0x13` conditionals at both a `>=1` boolean threshold and `>=100`/`>=200` counter thresholds, `dnga.dat`) — genuinely live game state, not dead fields — but **zero writes** found anywhere: no `0x12`/`0x18` (set) record targets either index in the whole script corpus, and no other CODE-hunk function references the addresses directly. Still open: a computed (non-literal-address) write via `GetCharBase` elsewhere (combat/status-effect code is the leading candidate) wasn't ruled out — `GetCharBase`'s own full caller list wasn't enumerated; see §3.3 |
| Learn Spells' `$3136`/`hunk1+0x3190` "spells discovered" tracker | Located the read side fully (§3.5: gates eligibility, filters the candidate list) but did not search for write sites | Open: what actually increments this party-wide counter (dungeon events, scrolls, plot flags?) is unknown — this is the mechanism by which the majority of P3's 57-spell catalogue becomes reachable at all, since Learn Spells' own per-class ranges only cover indices 0-12; see §3.5 |
| ~~Bank's mechanics~~ | Traced the worker (`0x1183a`) to its own `RTS` (`0x11be8`) | **Resolved**: Withdraw All (sum every `char.+0xFE` into `$44b2`, zero each) or Deposit (subtract an entered amount from `$44b2`, split evenly across every `char.+0xFE` with the integer-division remainder distributed one gold at a time to randomly-chosen members). No open items; §3.6 |
| ~~`D) Distribute`'s and `G) Trade Item`'s actual behaviour~~ (new, this pass) | Resolved `D`'s exact jump-table slot (`0xb380`, same 53-word table technique as everything else) and traced both workers to substantial completion, plus found `D`'s worker has a *second*, town-menu-unreachable mode auto-triggered on town arrival (found by reverse-searching its other JSR caller) | **Resolved, both refuting the "best guess" framing**: `D`'s reachable mode is an equip/carry reset+recall, not a gold split; the gold/XP split mechanic is real but lives on an automatic code path, not behind the `D` key. `G` is a character-to-character item transfer, not a sell-to-town mechanic — no code path in it touches `$44b2` or the armoury tables at all; §3.7 |
| Post-combat reward source for `$44ae`/`$44ac` (new, this pass) | Reverse-searched every writer of the two globals Distribute consumes | **Resolved**: found and traced the battle-rewards function (`~0x19ce0`) and `AddLootItem` (`0x1a1ba`) — gold is awarded instantly to `$44b2`, XP and items are pooled for the town-return flow; §3.8 |
| ~~Distribute's `jsr $c3e6(pc)`/`jsr $d0b4(pc)` calls~~ | Disassembled both functions end to end (`$d0b4` file `0xd0b4`-`0xd126`; `$c3e6` file `0xc3e6`-`0xcd76`) and checked whether mode 1's auto-trigger path also reaches either one | **Resolved**: `$d0b4` is a generic word-array sort (`Sort(pool, count)`), not an assignment step. `$c3e6` is the real item-assignment screen (browses the pool, shows per-character equip-capability via the confirmed Armoury capability helper `$ce6c`) — and it **is** reached from both modes, always processing the pool from index `0` to `$44ac-1` with no "this trip only" marker. The owner-remembered scoping difference is real in practice but emergent, not code-enforced: mode 1 fires before anything but combat drops has touched the pool, mode 2 explicitly refills the pool from *all* carried+equipped gear first. §3.7's correction block |
| Monster drop-table logic behind `AddLootItem`'s caller (new, this pass) | Traced `AddLootItem` and the gold/XP reward reads themselves but not their own callers/trigger conditions. (The `MonsterField` `0x22`/`0x24` offsets themselves needed no separate check — they're exactly `data-tables.md` §3's already-confirmed monster-record `+0x22` Gold/`+0x24` Experience fields, resolved immediately.) | Open: what decides *which* items a monster drops (probability, fixed table, a `monsinfo.dat` field not yet linked to it); see §3.8 |

None of the remaining open items need live-emulator verification —
they're all "keep reading a specific already-located function further"
or "cross-reference search a known global" work, not poke-and-observe
questions. No `mcp__amiberry__*` access was requested or used this pass.

## 6. What `TownScene`/`CharacterCreationScene` should do differently

- Rename the facility set to match §1: `Armoury`, `Bank`, `Inn`, `Mystic`,
  `Exit`, with `Learn Spells`/`Training` and roster management as
  separate menu groups — not `Armoury/Inn/Temple/Tavern/Training`.
- Wire the Inn to §3.1's confirmed mechanics: age +1/26 year, HP heal to
  max, body-location repair (except `Gone`), and the class/level MP-chart
  growth roll — not a stub.
- Wire `CharacterCreationScene.rollAttributes()` to §4.2's 3d6 +
  `classModifier[class]` + `raceModifier[race]` + 3 formula — both
  tables are now fully confirmed and ready to use directly, no
  placeholder needed.
- Wire `CharacterCreationScene.addMember()`'s starting HP/MP to §4.3's
  formula instead of the flat `10`.
- Wire the Training worker to §3.2's confirmed effect (Level+1, gold
  deduction, HP re-roll via the same class/level dice table, skill-maxima
  recompute) — it's a full level-up-for-gold mechanic, ready to implement
  end to end; Armoury is likewise ready (`data-tables.md` §6.4 +
  §3.4/§1's confirmed dispatch letter `A`).
- Mystic can be implemented as a pure read-only report screen (§3.3) —
  no state to track beyond what's already on the character record. The
  reputation-tier title and the high-Social-Class congratulation lines
  are fully reproducible now; the `+0x18`/`+0x5C`-driven lines can be
  wired to those two fields directly (they're now confirmed to be real
  `CharacterState`-worthy fields, tested with `>=1` boolean semantics
  matching Mystic's own `!= 0` read) even without knowing their English
  names or how the game itself ever sets them — a generic placeholder
  label ("Condition A"/"Condition B") is a reasonable interim choice for
  the *text*, but the underlying two numeric fields are worth adding to
  `CharacterState` now so dungeon scripts that test them (opcode `0x13`,
  confirmed present in real content, `dnga.dat`) have somewhere to read
  from even before a setter exists.
- Wire Learn Spells to §3.5's confirmed mechanic: eligible character →
  cost formula (reuses the armoury markup table, same shape as Training)
  → browse-and-pick from a class/level-filtered candidate list → gold
  deducted unconditionally → `Random(20) > Intelligence` failure roll →
  on success, append to `char.+0xB0`'s 32-slot array (`+0x56` count) or
  set the dedicated `+0xF0` Divine Aid flag. `src/state/CharacterState.ts`'s
  `knownSpells: number[]` is exactly the right shape for `+0xB0`'s array
  (Divine Aid needs its own boolean/flag, separate from the array, to
  match `+0xF0`). Because each class's reachable range via this screen
  is only a handful of low spell indices (0-12 total across all 6
  classes), a faithful implementation should not expose the rest of the
  57-entry spell catalogue through this screen — the `$3136` gap above
  means some other, unfound mechanism unlocks those in the real game.
- Wire Bank to §3.6's confirmed mechanic: display `$44b2` (carried) and
  `Σ char.+0xFE` (banked total) side by side, offer Withdraw All and
  Deposit(amount), and implement the even-split-plus-random-remainder
  distribution on deposit exactly as disassembled — no open items, this
  facility is ready to implement end to end.
- Implement the post-dungeon rewards flow as §3.8 describes, not as a
  town-menu action: on combat victory, add gold instantly to carried
  gold, and push XP/dropped items into two pending pools instead of
  applying them immediately. On town arrival, if either pool is
  nonempty, automatically present §3.7 mode 1's flow, **in its real
  order**: item-assignment first (only if items are pending), *then*
  share-weight prompts (1-3 per living member, 0-3 for dead) and the
  two-pass XP division (unweighted-random pass, then share-weighted
  pass) into each `char.+0x102` — only if XP is pending. Both the
  item-assignment screen and the share/XP screen are real, separate UI
  steps confirmed this pass, not one combined screen.
- The item-assignment screen (`$c3e6`, §3.7's correction block) is now
  fully specified: list every pool item with its name/stats, show each
  living member's equip-capability for it (reuse the same capability
  formula the Armoury already implements, `data-tables.md` §7), and let
  the player assign items to characters. Implement it as **one shared
  component** used by both the auto-triggered post-dungeon flow and
  `D) Distribute`'s reset — the only difference between the two call
  sites is what's already in the pool when it opens (this trip's drops
  only, vs. everything mode 2 just recalled), not the screen itself.
- `D) Distribute` (menu-reachable mode): un-equip the whole party,
  recall every character's carried-item history into the shared pool,
  then open the same item-assignment screen as above — a full
  "start over and re-sort everyone's gear" reset, not a partial one.
- `G) Trade Item` (§3.7) is a separate, ordinary town-menu action for
  moving an already-carried item from one character's 9-slot inventory
  (`char.+0x2A` count, `+0x3da0`-shaped array) to another's — implement
  it as a plain transfer, with no gold involved and no connection to
  Armoury/`inititem.dat` at all.
