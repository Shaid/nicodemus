# Phantasie Scripting Engine: Stars, Actions, and Messages

This document covers the record formats and interpreter algorithm behind
Phantasie's dungeon event system: a **star** is a trigger placed on a
`0xDD`-`0xFF` cell (see `dungeon-format.md` §4); triggering one shows a
**message**, optionally offers the player a choice, and then walks a chain
of **actions** — small opcode+parameters records that mutate game state,
branch, loop, or jump to another star.

As with the companion dungeon-format document, Phantasie I and Phantasie II
share one engine (see `dungeon-format.md` §1); every format and algorithm
below is identical between them unless a difference is called out. Phantasie
III uses its own (structurally close, but not byte-identical) engine.

## 1. Star (trigger) record

Fixed base size 5 bytes, growing in 5-byte increments when a star offers
more than 3 choices (see the size formula below). Identical layout in all
three games.

| Byte | Field | Encoding |
|------|-------|----------|
| 0 | Flags + message index | Bit 7 = one-use flag; bits 6-0 = `messageIndex + 1` (so stored value `0x00` never occurs for an active star; stored value `0xFF` is the dedicated "inactive" sentinel, checked as a full-byte equality, not just the high bit) |
| 1 | Choice count | Number of dialogue choices offered (`1` = no real choice, just "press a key") |
| 2..N | Action index list | One byte per choice, each an index into the action table |

Fields, derived from byte 0/1:

- **IsActive**: byte 0 `== 0xFF` → inactive (never triggers; `ReadCell`
  simply stops if it lands on an inactive star).
- **IsOneUse**: bit 7 of byte 0. When set, the interpreter overwrites byte 0
  with `0xFF` after the star fires once, permanently deactivating it in the
  in-memory copy (not written back to disk by the reference tool, which is
  read-only; the real game presumably does persist this to the save state).
- **MessageIndex**: `(byte0 & 0x7F) − 1`.
- **NbChoices**: byte 1, verbatim.
- **ActionsIndex[]**: `NbChoices` bytes starting at byte 2 — one action-table
  index per choice. When `NbChoices <= 1` there is exactly one action index
  (byte 2) and no real branching.

**Record size formula** (in 5-byte units): `size = ((byte1 + 1) / 5) + 1`
using integer division. This only grows past 1 unit when `NbChoices` is
large enough that the per-choice action-index list overflows the 3
remaining bytes of the first 5-byte slot (i.e. `NbChoices > 3`).

**Table layout**: a fixed 35-slot array is scanned starting from the table's
base offset (`0x04FB` for P1/P2, `0x02E4` for P3 — see `dungeon-format.md`
§3/§5). The scan walks slot-index by slot-index (not byte-by-byte): at each
index, if the byte at that slot's address is `0x00`, the slot is empty and
the scan advances by exactly 1 index; otherwise a star record is decoded
there and the scan advances by that record's `Size` (which may consume more
than one slot). This is why an oversized (`NbChoices > 3`) star can make
some star-index values used as `ActionsIndex`/goto targets land "inside"
what looks like a neighboring star's slot range — the table is a packed,
variable-stride array, not a flat fixed-stride one.

**Confirmed** against `data/phantasie/amiga/dng1`: the first star record's
raw bytes are `5B 02 4B 00 00`, decoding to `MessageIndex = (0x5B & 0x7F) −
1 = 90`, `IsOneUse = false` (bit 7 of `0x5B` is 0), `NbChoices = 2`,
`ActionsIndex = [0x4B, 0x00]`, `Size = ((2+1)/5)+1 = 1` slot — internally
consistent (a 2-choice star fits in one 5-byte slot with room to spare).

## 2. Action (script) record

Base size 2 bytes, doubling to 4 bytes for a fixed set of opcodes that need
a third parameter. **The double-sized opcode set is byte-for-byte identical
between the P1/P2 engine and the P3 engine**: `0x0C, 0x0D, 0x0E, 0x0F, 0x12,
0x13, 0x15, 0x17, 0x18, 0x19`.

| Byte | Field | Encoding |
|------|-------|----------|
| 0 | Flags + opcode | Bit 7 = **cleared** means "this is the last action in the chain" (inverted sense — a set bit means execution continues to the next slot); bit 6 = one-use flag; bits 5-0 = opcode (0x00-0x3F) |
| 1 | Param 1 | Always present |
| 2 | Param 2 | Only valid if the record is double-sized (opcode in the set above) |
| 3 | Param 3 | Only valid if the record is double-sized |

- **IsActive**: byte 0 `== 0x00` (opcode 0 with no flags — also opcode
  `0x00`'s own meaning is "Stop", see the opcode table below, so this
  overlaps with "the chain intentionally ends here").
- **IsLastAction**: `(byte0 >> 7) & 1 == 0` → true (chain ends after this
  action executes, unless the opcode itself sets an explicit jump target).
- **IsOneUse**: `(byte0 >> 6) & 1 == 1`. Same one-shot-deactivation
  convention as stars, but the inactive sentinel for actions is `0x00`
  (not `0xFF`).
- **OpCode**: `byte0 & 0x3F`.

**Table layout**: same packed/variable-stride scanning convention as the
star table, walking by 2-byte-aligned slots from the table's base address
(`0x05AA` for P1/P2, `0x0393` for P3). See `dungeon-format.md` §3.1/§5.1 for
how each engine detects the end of the table (P1/P2: explicit `0x0D 0x0D`
terminator scan; P3: fixed 256-slot capacity bounded by the following
message-pointer table, no terminator needed).

**Confirmed** against `data/phantasie/amiga/dng1`: the action table's first
5 slots (indices 0-4) are all-zero (`IsActive = false`, i.e. unused/inert
placeholder slots — the reference parser still decodes and stores them, it
just never chains into them), and slot index 5 (address `0x5AA + 5*2 =
0x5B4`) decodes to `C6 33`: `OpCode = 0xC6 & 0x3F = 0x06` ("+Item"),
`IsLastAction = false` (bit 7 of `0xC6` = 1 → chain continues),
`IsOneUse = true` (bit 6 of `0xC6` = 1), `Param1 = 0x33` (item index 51).
This is a well-formed, plausible record.

## 3. Message record

The two engines diverge sharply here — Phantasie I/II messages live in a
separate `MESS`-prefixed file with a length-prefixed, per-line offset table;
Phantasie III embeds messages in the dungeon file itself behind a simple
pointer table into a null-terminated string pool.

### 3.1 Phantasie I/II message format

The paired `MESSn` file (see `dungeon-format.md` §2) opens with a table of
115 **little-endian** 2-byte word offsets — one entry per *line slot*, not
one per logical message (`0x0000`-`0x00E5`, i.e. `115 * 2 = 230 = 0xE6`
bytes). Text itself starts immediately after, at absolute file offset
`0x00E6`; a given line's actual text address is `0x00E6 + word_value`.

**Confirmed byte-exact** against `data/phantasie/amiga/mess1`: the word
table's entries increase in roughly-41-byte steps (`0x0000, 0x0000, 0x0029,
0x0052, 0x0052, 0x0052, 0x007B, 0x00A4, 0x00CD, 0x00CD, ...`), and decoding
text at `0x00E6 + 0x0029` yields the literal, human-readable bytes `01 20
20 "THE PARTY MEMBERS CHOKE AND GASP." ...` (41 bytes total) — a length
byte (`0x01` here) followed by 40 characters of space-padded text. Decoding
at `0x00E6 + 0x0052` similarly yields `28 "   --- A DAMP DARK STONE TUNNEL
--- "` (`0x28` = 40, meaning this line uses the full 40-character width).

**Line-record format** (each line is a 41-byte unit: length byte + 40 text
bytes):

- The reader reads a candidate line's **first content byte as a length
  value** (not a display character — see below), then the next 40 bytes as
  raw fixed-width text.
- A message's *first* line's length byte tells the reader how many total
  text characters the message occupies, spanning as many 40-char line slots
  as needed; when the message's last partial line ends, the very next
  line's own first byte (if in the range 1-10) is interpreted as an embedded
  **choice count** for a subsequent multiple-choice prompt.
- **Duplicate/zero-length detection**: if two consecutive word-table
  entries are equal, that message slot is empty (returns "no content", used
  to fill unused message indices). If a word value is `0xFFFF`, the slot is
  explicitly excluded.
- **Choice-count heuristics** (from the reference parser, preserved as
  documented behavior even though the exact original encoding intent isn't
  fully clear): if the total message length is under 40 characters, the
  message is assumed to offer exactly 3 choices; a length of exactly 12
  implies 10 choices; otherwise the choice count comes from the line
  immediately following the message body. Per-choice answer text width is
  11 characters normally, 3 characters when there are more than 7 choices,
  5 characters when there are exactly 8.
- **Display formatting**: rendered text wraps at 40 characters, joining
  wrapped lines with a configurable end-of-line marker (`0xB6`, `¶`, shown
  when the caller wants visible line-break markers; a plain space
  otherwise). Choice text, if present, is appended as `"N) <choice text>"`
  per line.

**Confidence: confirmed** for the offset table structure, base address, and
the 41-byte length-prefixed line unit (verified byte-exact against real
game data as shown above). The choice-count heuristics are taken as
documented behavior from the reference implementation; they were not
independently re-derived from `data/phantasie/amiga/mess1` in this pass.

### 3.2 Phantasie III message format

Simpler and self-contained. A 110-slot pointer table at dungeon-file offset
`0x0593` (see `dungeon-format.md` §5.2) holds one 2-byte **big-endian** word
per message; `real_address = word − 0x0800`. A zero word means "empty
slot." Message text at the resolved address is a flat run of bytes,
**null-terminated** (Atari ST convention — the reference source also
documents `0x0D`-terminated variants for Apple II and C64 ports of the same
game, not applicable to the Amiga data this project has).

**Confirmed byte-exact** against `data/phantasieiii/amiga/D/dnga.dat`:
resolving and decoding message slots 0 and 5-13 yields clean, legible text
with zero garbage bytes or truncation, e.g. slot 5 → `"Arrows fire from a
slit in the roof."`, slot 6 → `"Molten lead is poured from the roof."`,
slot 12 → `"Waste disposal area"`, slot 13 → `"Damp, dark stone passage."`

**Display formatting**: three message "types" are used by different action
opcodes/star triggers — `OneLine`, `Windowed`, and `Fullscreen`. Only
`OneLine` renders the raw text unmodified; `Windowed` and `Fullscreen` both
apply the same word-wrap logic (wrap at 38 characters on the Atari-ST
convention this project's data follows; 40 on the reference source's
Apple II/C64 branches). Within the raw text, byte value `0xF0` is an
**explicit newline control code** — the wrap logic treats it as a forced
line break (resetting the running line-length counter) rather than a
literal character, on top of the automatic 38-character wrap. No `0xF0`
bytes were observed in the sampled Amiga messages, so this control code
remains unconfirmed against real Amiga data specifically (the sample
messages decoded were all single physical lines).

## 4. Star → message → choice → action interpreter algorithm

This is the control-flow loop that `ReadCell` hands off to when the player
steps on a `0xDD`-`0xFF` cell. It is identical in structure between all
three games (P3's version differs only in which message-display type/API it
calls, not in the control flow itself).

```
ExecuteStar(starIndex):
  loop:
    star = LoadStar(starIndex)          # lazily decoded on first reference
    if not star.IsActive:
      stop                              # star was already used up / disabled

    ShowMessage(star.MessageIndex)      # windowed message display
    if star.NbChoices > 1:
      choice = PromptPlayerForNumber(1..star.NbChoices)
    else:
      choice = 1

    actionIndex = star.ActionsIndex[choice - 1]

    loop:                                # action chain
      action = LoadAction(actionIndex)
      nextActionIndex = actionIndex + action.Size   if not action.IsLastAction else null
      nextStarIndex = null

      ExecuteAction(action)              # opcode dispatch, may override
                                          # nextActionIndex / nextStarIndex
                                          # (jumps/conditionals), or force a
                                          # STOP by setting nextActionIndex
                                          # to null directly (opcodes 0x00,
                                          # 0x10, 0x11)

      if action.IsOneUse:
        action.Deactivate()              # in-memory only in the reference
                                          # tool; writes 0x00 to byte 0

      if nextActionIndex is null:
        break                            # end of this action chain
      actionIndex = nextActionIndex

    if star.IsOneUse:
      star.Deactivate()                  # writes 0xFF to byte 0

    if nextStarIndex is null:
      stop
    starIndex = nextStarIndex            # opcode 0x16 sets this: "goto star"
```

Two structural notes worth preserving:

- **"Last action" is a chain-continuation flag, not an end-of-table
  marker.** An action with `IsLastAction = true` simply means "don't
  auto-advance to the next slot" — the chain can still be redirected
  elsewhere by an explicit jump opcode (`0x14`/`0x16`/etc., see §5) even on
  what would otherwise be the final record.
- **One-use deactivation happens after the opcode executes**, so an
  opcode's own side effects (including a jump) still take place on the
  triggering pass; only *subsequent* triggers of the same star/action see
  the deactivated state.

## 5. Action opcode table

Both engines assign the same meaning to opcodes `0x00`-`0x13` (with the
`0x12`/`0x13` P1-vs-P2 caveat noted below). Phantasie III additionally
defines `0x14`-`0x1B`; Phantasie II defines a *different*, shorter
`0x14`-`0x17` (Phantasie I does not use any of `0x14`+ — the reference
parser throws if it ever encounters one in a Phantasie I file). Params are
numbered 1-3, corresponding to record bytes 1-3 (only Param 1 exists for
single-sized records).

| Opcode | Size | Effect | Chain behavior |
|--------|------|--------|-----------------|
| `0x00` | 1 | Stop — no-op terminator | Forces end of chain regardless of the "last action" bit |
| `0x01`-`0x04` | 1 | Trap (shock-type flavor), `damage = [1, Param1]` | Continue per bit-7 flag |
| `0x05` | 1 | Encounter, no surprise; `Param1` = monster index | Continue |
| `0x06` | 1 | Give item; `Param1` = item index | Continue |
| `0x07` | 1 | Add gold (shown in a window); `amount = Param1 * 256` | Continue |
| `0x08` | 1 | Add gold (silent); same amount formula as `0x07` | Continue |
| `0x09` | 1 | Remove gold (windowed); `amount = Param1 * 250` in P2, `Param1 * 256` in P3 — **confirmed engine difference**, flagged with a "not 256?" comment in the P2 source itself | Continue |
| `0x0A` | 1 | Remove gold (silent); same multiplier discrepancy as `0x09` | Continue |
| `0x0B` | 1 | Show a fullscreen message; `messageIndex = Param1 - 1` | Continue |
| `0x0C` | 2 | Teleport party (windowed); `Param1`=x, `Param2`=y | Continue |
| `0x0D` | 2 | Teleport party (silent); same params | Continue |
| `0x0E` | 2 | Set dungeon cell (windowed); `Param1`=x, `Param2`=y, `Param3`=new cell value | Continue |
| `0x0F` | 2 | Set dungeon cell (silent); same params | Continue |
| `0x10` | 1 | Trap (normal-type), `damage=[1,Param1]` | **Forces stop** regardless of flag bits |
| `0x11` | 1 | Encounter, party surprised; `Param1`=monster index | **Forces stop** |
| `0x12` | 2 | Set character stat; `Param1`=stat index, `Param2`=value (`Param3` expected `0x00`) | Continue. **P1/P2 source note:** the reference tool's *display string* for this opcode differs between P1 (renders as `"If Stat < value Then Stat = value"`, i.e. looks conditional) and P2 (renders as unconditional `"Stat = value"`) — but the actual interpreter code (`ExecuteAction`) does not branch on the P1/P2 flag for this opcode at all; it always just displays the string, without applying any stat mutation. Whether P1's real game logic is genuinely conditional here, or the differing display text is simply an unresolved authoring inconsistency in the reference tool, is **not settled** by this source. |
| `0x13` | 2 | Conditional; `Param1`=stat index, `Param2`=threshold value | If `stat < value`: **P2 declared behavior** (per its display string) is "goto Action `Param3`"; **P1 declared behavior** is "move party back and show Message `Param3-1`". **However**, the actual `ExecuteAction` code path for this opcode is shared (no P1/P2 branch) and always calls `ShowMessage(Param3 - 1)` — never performs a goto. This means the P2 "goto Action" description is either aspirational/unimplemented in the reference tool, or `ExecuteAction` itself has a bug for the P2 case. **Preserved as an open, unresolved discrepancy in the reference source**, not resolved by this project. |
| `0x14`* | 1 | (P2 only) Unconditional "goto Action `Param1`" | Sets next action index directly |
| `0x15`* | 1 | (P2 only) `Param1`=percent chance to **not** jump; on success, "goto Action `Param2`" | Conditional jump |
| `0x16`* | 1 | (P2 only) "goto Star `Param1 - 1`" | Ends the action chain and redirects `ExecuteStar`'s outer loop to a different star |
| `0x17`* | 1 | (P2 only) "!! GAME WON !!" — win-condition marker | Forces stop |

*`0x14`-`0x17` are gated behind the P2 flag in the P1/P2 engine; Phantasie I
data throws if encountered. **Confirmed** by scanning all ten
`data/phantasie/amiga/dng*` files' decoded action-table opcodes: the
per-file maximum opcode value never exceeds `0x13` across any of the 10
files (P1 never emits `0x14`+). **Independently confirmed on the P2 side
too**: scanning all 8 real `data/phantasieii/atarist/extracted/disk2/DNG1`-
`DNG8` files' decoded action-table opcodes finds `0x14`-`0x17` values
actually present and used in shipped content (e.g. `DNG8`'s highest opcode
observed is `0x17`, the win-condition marker) — the documented P1/P2
opcode-space split is real, not just a static gate in the reference tool
that happens to never fire. See `dungeon-format.md` §7.

Phantasie III's own `0x14`-`0x1B` (a disjoint, differently-numbered set —
**do not conflate with P2's `0x14`-`0x17` above**, they are different
engines' opcode spaces that happen to reuse some of the same numeric
values for different effects past `0x13`):

| Opcode | Size | Effect |
|--------|------|--------|
| `0x14` | 1 | Unconditional "goto Action `Param1`" |
| `0x15` | 1 | `Param1`=percent chance to **not** jump; on success, "goto Action `Param2`" |
| `0x16` | 1 | "goto Star `Param1 - 1`" |
| `0x17` | 2 | Conditional: if the party owns item `Param1`, "goto Action `Param2`" |
| `0x18` | 2 | Set/clear a stat bitmask: `value = 1 << (Param1 - 1)`; if `Param3 != 0`, OR it into stat `Param2`, else AND it out |
| `0x19` | 2 | Conditional bitmask test: if stat `Param2` has bit `(1 << (Param1-1))` set, "goto Action `Param3`". Special case: if the raw stat-index value is `0x75`, this instead means "does any party member know the spell Divine Aid" and jumps unconditionally to `Param3` on a match |
| `0x1A` | 1 | Conditional: if the party contains a Dwarf or Gnome, "goto Action `Param1`" |
| `0x1B` | 1 | Increment a stat for every living party member (capped at 30, per the reference source's inline comment) |

For opcodes `0x12`, `0x13`, `0x18`, `0x19` in Phantasie III, a raw stat-index
`Param` value `>= 0x3D` (and `>= 0x79`, per the source's literal — but
practically this reduces to just `>= 0x3D` since `0x79 > 0x3D`) is remapped
by subtracting `0x3D` before use as a stat-table index — this rebasing
convention is specific to Phantasie III and has no equivalent in the P1/P2
opcode set.

## 6. Character stat / item / monster name tables

`GetStat`, the item-name table, and the monster-name table referenced by
several opcodes above (`0x05`/`0x06`/`0x11`/`0x12`/`0x13`/etc.) are all
**hand-transcribed lookup tables embedded in the reference tool's own
source**, not parsed from any file in `data/`. They're mentioned here only
because several opcodes' semantics depend on indexing into them (e.g.
opcode `0x06`'s `Param1` is meaningless without an item-name table to
resolve it against). Approximate sizes, for context: ~181 items and ~80
monsters in both the P1/P2 tables and the P3 table (counts nearly identical
across all three games' hardcoded tables); P1/P2's stat table covers index
ranges `1`-`13` (core attributes/HP/MP), `18`-`39` (skills, in
skill/training pairs), `42`-`58` (plot-flag scores, runes, equipment
slots), `61`-`120` (a 60-entry spell-learned bitfield/list), and `151`-`164`
(class, inventory slots, race, equipment values); P3's stat table is a
single flat 161-entry array covering a broader mix of core attributes,
skills, mission-progress bitfields, inventory, race/class, and a
33-entry learned-spell block. None of these tables were cross-checked
against this project's own `data/` files in this pass — see
`dungeon-format.md` §8-§9 for what *is* confirmed from real data.

## Open questions

| Item | What's known | What's missing |
|------|-------------|-----------------|
| P1/P2 message choice-count heuristics (§3.1) | Documented from the reference parser | Not independently re-derived from real `mess*` data; the exact original-game encoding intent for the length/choice-count overloading is unclear even in the source |
| P3 `0xF0` embedded-newline code (§3.2) | Documented from the reference parser | Not observed in the small sample of Amiga messages decoded in this pass — unconfirmed against real Amiga data |
| P1 opcode `0x12` (§5) | Two conflicting descriptions in the reference source (conditional vs. unconditional) | Neither is confirmed against actual P1 game behavior; the interpreter code doesn't implement either interpretation's mutation, only a display string |
| P2 opcode `0x13`'s "goto Action" (§5) | Declared in the display string | The actual interpreter never performs the jump — always shows a message instead. Unresolved whether this is a reference-tool bug or the accurate original behavior |
| ~~P2-exclusive opcodes `0x14`-`0x17`~~ | **Resolved** — confirmed absent from all 10 P1 `dng*` files and confirmed present/used in all 8 real P2 `DNG*` files (§5 above, `dungeon-format.md` §7) | Exact per-opcode semantics (jump targets, percent-chance rolls) still only source-derived, not independently re-derived from the raw bytes |
| Stat/item/monster name tables (§6) | Approximate sizes and index-range structure from the reference source | Not derived from or cross-checked against this project's `data/` files at all — likely embedded in the game executables rather than these dungeon-format data files, and out of scope for this pass |
