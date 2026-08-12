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

> **Correction (2026-08-12, implementation pass):** the "otherwise the
> choice count comes from the line immediately following the message
> body" bullet above is off by one. Checked against three real examples
> where the star's own `NbChoices` field (§1, the authoritative source the
> real interpreter actually uses) is independently known:
>
> | Message | File | Star `nbChoices` | Next-line raw byte | Real choice text |
> |---|---|---|---|---|
> | index 90 | `mess1` (`dng1` star slot 0) | 2 | 3 | `" TAKE THEM  LEAVE THEM..."` — 2 options |
> | index 69 | `mess1` (`dng1` star slot 2) | 3 | 4 | `"  READ IT    BURN IT    LEAVE IT..."` — 3 options |
> | index 59 | `mess4` (`dng4` star slot 0) | 9 | 10 | `" 1  2  3...9..."` — 9 options |
>
> In all three, the raw next-line byte is **exactly one more** than the
> real choice count — the same `storedValue = realValue + 1, 0 reserved`
> convention §1 already documents for the star record's own message-index
> field. The corrected heuristic is `embeddedChoiceCountHint =
> nextLine.lengthByte - 1` (still gated on the raw byte being `1..10`,
> per the original bullet). Slicing the choice-line text at the
> **corrected** count (not the raw byte) reproduces the real choice text
> exactly in all three cases; slicing at the raw, uncorrected byte value
> would append one spurious empty entry every time. The `<40 chars -> 3`
> and `==12 chars -> 10` branches are untouched by this correction — they
> are hardcoded literal constants in the reference source, not a stored
> byte subject to the same `+1` bias, and remain unverified beyond what
> was already documented. Implemented in
> `src/assets/formats/messages.ts`'s `decodeP1P2Message()` /
> `sliceChoiceText()`; see that module's doc comment for the full
> byte-level evidence and `messages.test.ts` for the regression tests
> covering all three examples above.

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
> **Correction (this pass):** the `0x12` row's "not settled by this
> source" caveat above described only the *reference tool's* interpreter,
> which turned out not to implement any mutation for this opcode at all.
> A real disassembly trace of P1's own `game` executable (§6.3) found the
> **actual** P1 game logic: opcode `0x12` genuinely is conditional, and
> applies to **every living party member** — for each: `if
> GetStat(char,Param1) < Param2: SetStat(char,Param1,Param2)` (a
> party-wide "raise stat to at least Param2" floor). The fan tool's
> non-mutating behavior was a fan-tool limitation, not accurate original
> game behavior. Opcode `0x13` was also found to be a **party-wide
> qualification gate** (proceeds only if *zero* living members are below
> the threshold), not a single-character check — see §6.3 for the full
> disassembly evidence (file offsets, byte-verified against the real
> executable). This P1 finding does not by itself resolve the P2/P3
> shared-vs-differing-code-path question the original row/paragraph
> raised — only P1's `game` was traced.

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
several opcodes above (`0x05`/`0x06`/`0x11`/`0x12`/`0x13`/etc.) were
originally only **hand-transcribed lookup tables embedded in the
reference tool's own source**, not parsed from or cross-checked against
any file in `data/`. This section previously flagged that as a gap
blocking real interpretation of several opcodes. As of this pass, the
item-name and monster-name tables are **located and independently
byte-verified** against this project's own executables and real dungeon
scripts; the character-stat table's *index-range* hypothesis is
empirically confirmed against real script data, though the underlying
in-memory character-record layout (which byte means "Strength" vs
"Level" etc.) is still not traced through code. See below.

### 6.1 Item name table — confirmed, all three games

A 181-entry, sequential (variable-length, NUL-terminated), 0-indexed
item-name string array exists in **all three games' executables**:

| Game | File | Offset | Index 0 (empty-slot sentinel) | Index 180 (last) |
|------|------|--------|-------------------------------|--------------------|
| P1 | `data/phantasie/amiga/game` | `0x5EFC` | `"NOTHING"` | `"DIAMOND E"` |
| P2 | `data/phantasieii/atarist/extracted/disk1/PHANT.PRG` | `0x1E9CC` | `"NOTHING"` | `"GOD RING"` |
| P3 | `data/phantasieiii/amiga/PhantasieIII` | `0x466C` | `"0"` (P3's own empty-slot convention, differs from P1/P2's `"NOTHING"` string) | `"Wand of Nikademus"` |

Located by grepping each executable for common RPG item-name substrings
(`SHIELD`, `SWORD`, `DAGGER`, ...), then reading the sequential
NUL-terminated string run containing the hits back to its start (a
distinctive index-0 placeholder in every case) and forward to where it
stops decoding as printable ASCII. **Structural cross-check**: in both P1
and P2, the item table is immediately followed by the same class-name
sequence (`THIEF, MONK, RANGER, FIGHTER, PRIEST, WIZARD`) and then
*exactly* the already-confirmed race-name table (`data-tables.md`
§1.4/§2.4) — i.e. this is the same string region already anchored by a
previously-confirmed table, not a coincidental unrelated string run. In
P3, the item table is immediately followed by a spell-name table using
the identical own-placeholder-at-index-0 convention (not decoded this
pass).

**Confirmed via real dungeon-script cross-check** (the strongest
evidence): every real action-table record with opcode `0x06` ("+Item")
across the full real corpus of dungeon files for all three games was
decoded (packed/variable-stride scan per §2 above; P1/P2 terminated by
`0x0D 0x0D` at base `0x05AA`; P3 fixed 256-slot capacity at base
`0x0393`, no terminator) and every referenced item index resolved
against that game's item table:

| Game | Files scanned | Distinct item indices referenced | Out-of-range (0-180) |
|------|-----------------|-------------------------------------|--------------------------|
| P1 | 10 (`dng1`-`dng10`) | 63 | **0** |
| P2 | 8 (`DNG1`-`DNG8`) | 44 | **0** |
| P3 | 11 (`dnga.dat`-`dngk.dat`) | 71 | **0** |

Zero out-of-range indices across 178 total distinct references, every one
resolving to a plausible, thematically-appropriate item (armor, weapons,
scrolls, rings, gems for P1/P2; P3's list additionally includes unique
named artifacts like `"Wand of Nikademus"` at the maximum index 180,
appropriate for an endgame item). The previously-cited example record
(`scripting-engine.md` §2's `dng1` slot-5 record, item index `0x33` = 51)
resolves to `"SM AXE"` — a plausible early loot drop, now independently
confirmed rather than just asserted.

**Confidence: confirmed, byte-exact.** Full detail and per-game offsets:
`data-tables.md` §1.5 (P1), §2.6 (P2), §3.1 (P3, plus a partial link to
`inititem.dat`'s already-hypothesized 181-record stride).

### 6.2 Monster name table — confirmed, all three games

The monster-name tables (`data-tables.md` §1.1 for P1, §2.1 for P2,
`monsinfo.dat`'s name field for P3 §3.1) were already confirmed as
byte-exact/legible in a prior pass, but had not been cross-checked
against real dungeon-script usage. This pass closes that gap: every real
opcode-`0x05`/`0x11` ("encounter") action record across the same file
corpus as above was decoded and its monster index resolved:

| Game | Distinct monster indices referenced | Out-of-range (0-79) |
|------|----------------------------------------|--------------------------|
| P1 | 18 | **0** |
| P2 | 8 | **0** |
| P3 | 8 | **0** |

All resolve to plausible, difficulty-appropriate monsters — P1/P2 show a
clear low-index-to-high-index power curve (`GIANT BEE`/`ORC` at low
indices through `ZEUS`/`BLACK LORD`/`HIGH DEVIL` near the top of the
range); P3 resolves index 77/78 to `Nikademus` (the game's named final
boss, referenced twice — plausible for a multi-phase final encounter) and
79 (`monsinfo.dat`'s last record) to `Lord Wood`.

**Confidence: confirmed** (index-space correctness cross-checked against
real data; the name tables themselves were already confirmed in a prior
pass — see the `data-tables.md` sections cited above).

### 6.3 Character stat table

Unlike the item/monster tables above, `GetStat`'s stat-index space is
**not** a data table sitting in a file or executable data segment that
can be located and read the same way — it's an addressing convention
used by code (`ExecuteAction`'s opcode `0x12`/`0x13`/`0x18`/`0x19`
handlers, per §5 above) against an in-memory per-character record. There
is nothing to "find" in the same sense as the item/monster string
tables; what can be verified is (a) whether the reference source's
claimed index *ranges* actually match what real shipped dungeon scripts
use, and (b) — deeper, and not yet done — what each index actually reads
from in the character record's real memory layout, which requires
tracing the executable's code rather than reading a data table.

**(a) Index-range hypothesis — empirically confirmed against real script
data.** The reference source's claimed P1/P2 index ranges (`1`-`13` core
attributes, `18`-`39` skills, `42`-`58` plot-flags/runes/equipment,
`61`-`120` spell-learned bitfield, `151`-`164` class/inventory/race/
equipment) were checked against every real opcode-`0x12`/`0x13` record in
the same P1 (`dng1`-`dng10`) and P2 (`DNG1`-`DNG8`) corpus used above:

- P1: stat indices `42, 43, 44, 45, 46, 47, 55, 161` used — all fall
  inside the `42-58` (plot-flags) or `151-164` (class/inventory) ranges.
- P2: stat indices `3, 8, 11, 13, 42, 49, 50, 53, 117, 151, 161, 162,
  163, 164` used — all fall inside `1-13` (core attributes), `42-58`
  (plot-flags), `61-120` (spell-learned bitfield, index 117), or
  `151-164` (class/inventory).

**Zero indices outside the hypothesized ranges** across both games' full
real script corpora. For P3's own opcode `0x12`/`0x13`/`0x18`/`0x19` (the
latter two using `Param2`, not `Param1`, as the actual stat index — see
§5), the documented "remap by subtracting `0x3D` (61) if raw value
`>= 0x3D`" rule was also checked: several real records use raw indices
`>= 61` (`117, 120, 122, 126, 127`), which after remapping land at
`56, 59, 61, 65, 66` — all comfortably inside P3's documented single flat
161-entry array (`0`-`160`), with no post-remap value ever landing
out-of-range. This confirms the remap rule is self-consistent with every
real P3 stat-index reference actually shipped, not just an untested gate.

**(b) `GetStat`/`SetStat` located and disassembled — confirmed, P1
(`game`).** Traced via the `amiga-disasm` agent (IRA + radare2), working
forward from the dungeon/message filename-format strings to the dungeon
loader, then to `ExecuteAction`'s opcode dispatcher, then into the two
stat-accessor routines opcodes `0x12`/`0x13` call. **Independently
spot-checked against the real file bytes in this pass** (not just taken
on the agent's word — every address below was re-read directly from
`data/phantasie/amiga/game` and byte-compared against the claimed
disassembly, all matches exact):

| Function | File offset (`game`) | Confirmed bytes at that offset |
|----------|-------------------------|-----------------------------------|
| `ExecuteAction` (enclosing function) | `0x10E40` | `4E56 FFDE 48E7 3800` (`LINK.W A6,#-34; MOVEM.L D2-D4,-(A7)`) |
| Opcode dispatch `JMP (PC,D0.L)` | `0x10FC6` | `4EFB 0802` |
| Opcode `0x12` handler | `0x1132A` | `54AE FFFC 426E FFE6 3039 0000 0000 322E` |
| Opcode `0x13` handler | `0x113B6` | `6C22 48C1 302E FFEE 48C0 2F00 2F01 6100` |
| Shared index→address resolver | `0x1142C` | `4E56 FFFC 302E 000E` |
| `GetStat` | `0x116EA` | `4E56 0000 302E 000A 48C0 …` |
| `SetStat` | `0x11710` | `4E56 0000 302E 000A 48C0 …` |

(`game`'s `HUNK_HEADER` parses as a real 240-hunk table, per
`data-tables.md` §8's open note on hunk addressing; the function
containing `GetStat`/`SetStat` lives in raw hunk index 99 — file offsets
`63624`-`72064` — and, notably, **IRA's own `-preproc` auto-detect pass
misclassified this entire function as `DC.L` data, not code**; the trace
had to fall back to extracting the raw CODE hunk and disassembling it
standalone with radare2, cross-substituting IRA's already-resolved
relocation-address comments for symbol names. Worth remembering for any
future disassembly pass over this binary's hunk 99 specifically.)

**Addressing scheme: direct index arithmetic through a range-check
chain — not a jump table, not one flat array.** The shared resolver at
`0x1142C` is a linear `CMPI.W`/`Bcc` chain that tests `statIndex` against
each range boundary in turn; once matched, it computes
`address = charBase + charIndex*0x11A(282) + f(statIndex)` (0x11A = 282
bytes per character record; `f` is `statIndex*2 + a per-range constant`,
i.e. every stat is a 16-bit word field). `GetStat` calls this resolver
then does `MOVE.W (address),D0`; `SetStat` does `MOVE.W value,(address)`.
Every real range boundary found in the resolver's own branch chain lines
up with the fan-tool-derived range hypothesis at the top of this
section (`1-13`, `18-39` in two sub-blocks, `42` as its own special case
plus `43-47`/`48-50`/`56-58`, `60-120`, `152-160`/`162-164`) — this is
now **code-level confirmed**, not just empirically consistent with real
script data as in (a) above.

**Two real P1 game-logic bugs/behaviors also surfaced by this trace,
correcting the fan-tool's documented behavior** (see §5's table above,
which should be read as superseded by this finding for P1's opcode
`0x12`):
- **Opcode `0x12` ("Set character stat") is genuinely conditional in the
  real P1 game**, and applies to **every living party member**, not a
  single character: for each living member (character-record field
  `+0x18` != 0 means alive), `if GetStat(char,Param1) < Param2: SetStat(char,Param1,Param2)`
  — a party-wide "raise stat to at least Param2" floor. The fan tool's
  claim that "the interpreter code does not branch... it always just
  displays the string, without applying any stat mutation" (§5) is a
  **fan-tool limitation**, not real P1 behavior.
- **Opcode `0x13` ("Conditional") is a party-wide qualification gate**:
  it counts how many living party members have
  `GetStat(char,Param1) < Param2`, and only proceeds (calling
  `ShowMessage`) if that count is **zero** — i.e. *every* living member
  must meet the threshold, not a single check against one character as
  the simplified §4/§5 description implies.

**(c) Full resolver range table — confirmed, extracted byte-exact this
pass.** The `0x1142C` resolver was fully disassembled end-to-end (not
just the range boundaries already known) and every branch's own formula
was independently re-derived from its literal instruction operands
(constants below double-checked against the raw file bytes, not just the
capstone mnemonic text, after an initial hand-transcription slip on one
block — see "paths tried" note below). `d0` is `statIndex`; `charBase =
charIndex*0x11A + 4`; all fields are 16-bit words, so every formula's
step is `offset(statIndex) = A + 2*statIndex` (or `2*(statIndex - K)`,
the same thing) for some per-block constant `A`, except the divide-by-2
skills sub-blocks noted below:

| Guard (inclusive) | Formula: `offset =` | Notes |
|---|---|---|
| `statIndex` 1-13 | `2*statIndex − 2` | "core" range; `0x11434`, confirmed bytes `0C40 000E 6C1E` (`CMPI.W #$E,D0; BGE.W ...`) |
| `statIndex` 18-19 | `2*statIndex − 0xC` | collides in byte-offset with the top of the 1-13 range — see below |
| `statIndex` 20-39, even | `0x1E + 2*⌊(statIndex−20)/2⌋` | "skills" range, even sub-array |
| `statIndex` 20-39, odd | `0x32 + 2*⌊(statIndex−21)/2⌋` | "skills" range, odd sub-array — **not a bitfield**: both sub-blocks are plain per-index 16-bit word arrays (`DIVS.W #2,D0` splits by parity into two separate arrays), no bit-shift/mask logic exists in the resolver itself |
| `statIndex` == 42 | `0x46` (fixed) | single dedicated field, no arithmetic |
| `statIndex` 43-50 | `2*statIndex − 0xE` | one continuous formula split across two adjacent code blocks (43-47 then 48-50) with an identical result — confirms these were meant as one contiguous sub-range |
| `statIndex` 56-58 | `2*statIndex + 0x86` | confirmed bytes at guard `0x115AC`: `0C40 003B 6C2E` (`CMPI.W #$3B,D0; BGE.W ...`) then `0C40 0037` (`CMPI.W #$37,D0`) → handles exactly `{56,57,58}` |
| `statIndex` == 55 | `0x5A` (fixed) | its own dedicated single-field check at `0x1168C`, confirmed bytes `0C6E 0037 000E 661A` (`CMPI.W #$37,0xE(A6); BNE.W ...`) — **not** part of the 56-58 block; `statIndex` 51-54 have **no handler at all** (fall through to the error path below) |
| `statIndex` 60-120 | `2*statIndex − 0x62` | "spell-learned" range — same caveat as 20-39: a plain per-index word array, not a packed bitfield, at the resolver level |
| `statIndex` 152-160 | `2*statIndex − 0x108` | "class/inventory/race" range, first sub-block |
| `statIndex` 162-164 | `2*statIndex − 0x54` | same range, second sub-block — includes `char.+0xF2` at `statIndex 163` (§7.3) |
| `statIndex` == 161 (`0xA1`) | `0x100` (fixed) | its own dedicated single-field check at `0x116AE` |
| anything else | *(error path)* | `PEA $237; JSR $32A` (resolves via reloc to file offset `0x28376`, hunk 86 — an error/assert handler, not traced further) then returns a fixed pointer (`LEA $72.L,A0`) |

Two genuine **byte-offset collisions** fall out of this table (different
`statIndex` values addressing the identical underlying word): `statIndex`
13 and `statIndex` 18 both resolve to `charBase+0x18` (the confirmed
"alive" flag byte, per §6.3(b) below); `statIndex` 54 and `statIndex` 163
were *not* found to collide (54 has no handler at all — see above — only
163 maps to offset `0xF2`). These aren't parser bugs; they're read
directly off the real branch-chain arithmetic and are worth preserving
as-is rather than "fixed."

**Using this table to bind the combat formula's mystery fields (§7.1b/
§7.2a/§7.3) to real `statIndex` values** — even without an English name,
this pins every one down to an exact, cross-referenceable slot:

| Character field (record offset) | `statIndex` | Resolver block |
|---|---|---|
| `+0xC` (§7.3's monster-attacks-player armor-like subtrahend) | **7** | core range (1-13) |
| `+0x16` (current HP, already confirmed via `Die()`) | **12** | core range |
| `+0x18` (alive flag, already confirmed) | **13** (aliases 18) | core range / 18-19 |
| `+0xF6` (§7.3's damage-reduction field) | **56** | 56-58 |
| `+0xF8` (§7.2a's damage-multiplier stat) | **57** | 56-58 |
| `+0xFA` (§7.1b's to-hit divide dividend) | **58** | 56-58 |
| `+0xF2` (§7.3's special-case extra damage reduction) | **163** | 162-164 |

All within the doc's original range hypothesis (`1-13` core, `42-58`
plot-flags/equipment, `151-164` class/inventory/race) — the combat-stat
fields cluster at the very top of the `42-58` bucket (56-58) and inside
the `162-164` tail of the class/inventory bucket, both structurally
plausible for "equipped weapon"/"worn armor"-style derived stats.
Monster-side fields (`+0x2E`, `+0x14`, `+0x38`) are **not** reachable via
this resolver at all — monsters use a completely separate flat 58-byte
array (§7.1/§7.3), with no analogous `GetMonsterStat` abstraction found
or searched for this pass.

**Individual index *names* (which is "Strength" vs. "Armor Class" vs.
"Level", etc.) — still open, but the display-routine search technique
suggested for this was exhausted, not skipped.** Two real leads were
chased to a conclusive (negative) result:

1. **`GetStat`/`SetStat` call-site search, exhaustive.** Every
   `HUNK_RELOC32` entry in *every* hunk of the binary was scanned for a
   reference to `GetStat`'s (`0x116EA`) or `SetStat`'s (`0x11710`) own
   file offset (hunk-relative `0x1E62`/`0x1E88` within their containing
   hunk). Result: **exactly two** cross-hunk call sites exist in the
   whole binary, at file offsets `0xEFA2`/`0xEFD8`, and both are inside
   the *same* function — a shared per-living-party-member utility at file
   offset `0xEDEA` (hunk containing `0xE53C`-`0xF49C`, the same hunk as
   `playerDamage`/`Die`) that implements the party-wide opcode-`0x12`
   floor-raise (`if GetStat(char,i) < v: SetStat(char,i,v)`) already
   described in §6.3(b) above — **not** a character-sheet display
   routine. Combined with the two same-hunk `BSR`s from the opcode
   `0x12`/`0x13` handlers already known, this means `GetStat`/`SetStat`
   are used **exclusively** by the dungeon-script interpreter's dynamic
   stat opcodes; the character-sheet UI, if it exists as compiled code in
   this binary, reads character-record fields directly by raw offset,
   bypassing the abstract accessor entirely. This directly contradicts
   the premise that tracing `GetStat` callers would reveal a display
   routine — a real, evidence-backed negative result, not an unexplored
   gap.
2. **Character-sheet label-string search.** The template strings
   themselves *were* found — real, byte-confirmed data, correcting a
   wrong lead recorded by the previous pass (see "paths tried" below):
   file offset `0x23126` holds a run of label templates with embedded
   `XXX` value placeholders — `STRENGTH`, `INTELLIGENCE`, `DEXTERITY`,
   `CONSTITUTION`, `CHARISMA`, `LUCK` (17-byte fixed stride each), then
   `AGE`, `HIT POINTS`, `MAGIC`, `GOLD IN BANK`, `EX. PTS`, `SCORE`
   (20-byte fixed stride each), followed by `RUNES:`/spell-school names,
   `SPELLS`/`EQUIPMENT`/`SKILLS`/`POTIONS`, and further menu/status
   strings (`PURGE`, `KEEP`, `HEALTH REPORT:`, `F I G H T`, etc.) — 33
   entries total. A 33-entry, fully `HUNK_RELOC32`-relocated 32-bit
   pointer table immediately follows at file offset `0x234DA`-`0x2355E`,
   one pointer per label in the same order (confirmed by decoding all 33
   pointer values and checking each lands exactly at its label's real
   string start).

   > **Correction (§6.3(d), `re-codebreaker` pass):** the "33-entry
   > pointer table at `0x234DA`-`0x2355E`" is a **mid-table window**, not
   > the table. The real structure is a single **164-entry** global
   > string-pointer table whose slots `0`-`163` occupy file offsets
   > **`0x232E2`** through **`0x23571`** inclusive (slot *n* at
   > `0x232E2 + 4n`; hunk-84-relative base `0x0D4A`; a further relocated
   > longword at `0x23572` points at an empty string and may be a 165th
   > slot — no code references it), covering *every* UI string in the game
   > (blank line buffers, race/class names, shop and inn text, the
   > character sheet, combat menus). `0x234DA` is simply the address of
   > **slot 126**, the first character-sheet label. Every one of the 164
   > longwords is `HUNK_RELOC32`-relocated except slot 155, which is a
   > deliberate `NULL`/empty-string entry. This mis-sizing is what made
   > the "zero references to the pointer-table base" negative below look
   > decisive: the *real* base (`0x232E2`) is referenced from code **20
   > times**, and code reaches individual slots as `base + 4*index` with
   > the index in a register or an immediate stack push — an addressing
   > shape a per-slot relocation scan is structurally blind to. See
   > `negative-from-addressing-root-not-shapes.md`.

   An exhaustive reloc scan (999 total references to this
   `DATA` hunk across the whole binary) found real, individually-`LEA`'d
   code references to pointer-table entries **18, 20, 27-32** (the
   `SPELLS`/`SKILLS`/`PURGE`/`KEEP`/`HEALTH REPORT:`/`F I G H T`/
   `INSPECT`/`BLACK KNIGHTS!!!` menu-option labels), living in a real,
   traceable menu-display region (hunks at file offsets `0x7820`-`0x86A4`
   and `0x8F30`/`0x963A`/`0x9674`/`0x147A2`/`0x285FE`-`0x28612`) — but
   **zero** references, individual or loop-based (no code anywhere
   references the pointer table's own base at `0x234DA`, which a
   runtime-indexed loop would need), to entries **0-11** (the `XXX`-value
   core-attribute/resource labels actually wanted for this task). The
   core-stat block's own display routine, if compiled into this binary at
   all, does not reach these particular label strings through any
   statically-relocatable absolute reference — genuinely inconclusive,
   not just "not found yet."

   **Exact confirmed label bytes** (12 numeric-stat entries, re-read
   directly from `data/phantasie/amiga/game` this pass, byte-exact):

   ```
   0x23126  "STRENGTH     XXX\0"          (17 bytes)
   0x23137  "INTELLIGENCE XXX\0"          (17 bytes)
   0x23148  "DEXTERITY    XXX\0"          (17 bytes)
   0x23159  "CONSTITUTION XXX\0"          (17 bytes)
   0x2316a  "CHARISMA     XXX\0"          (17 bytes)
   0x2317b  "LUCK         XXX\0"          (17 bytes)
   0x2318c  "AGE         XXXXXXX\0"       (20 bytes)
   0x231a0  "HIT POINTS  XXX/XXX\0"       (20 bytes)  -- cur/max, TWO placeholders
   0x231b4  "MAGIC       XXX/XXX\0"       (20 bytes)  -- cur/max, TWO placeholders
   0x231c8  "GOLD IN BANK  XXXXX\0"       (20 bytes)
   0x231dc  "EX. PTS  XXXXXXXXXX\0"       (20 bytes)
   0x231f0  "SCORE           XXX\0"       (20 bytes)
   ```

   followed immediately by `RUNES:`/spell-school names, matching the "33
   entries total" count above. Note `HIT POINTS`/`MAGIC` are two-value
   (`XXX/XXX`) formats, unlike the single-value core attributes — a
   useful discriminating signal for any future trace of the format call
   site (it must read two word fields for these two labels, one for the
   rest).

3. **New this pass: checked whether either of two previously-uninspected
   files in `data/phantasie/amiga/` (`backup`, 21,464 bytes; `f`, 2,416
   bytes) might be a save-state/character-record oracle** (byte-pattern
   cross-check technique that resolved a P3 escalation earlier this
   session). Both turned out to be **separate small AmigaOS HUNK
   executables, not data files** — `file` identifies both as
   `AmigaOS loadseg()ble executable/binary`, and both parse as valid
   `HUNK_HEADER` files (`backup`: 94 hunks; `f`: 9 hunks). `strings`
   confirms `backup` is the "Phantasie backup utility" referenced by the
   game's install docs — a whole-**file**-level disk-copy tool (menu text
   `"Transfer characters to backup disk"` / `"...from backup disk"`,
   operating on `TWNS.DAT`/`GUILD.DAT`/`DNG.SAV`/`DNGX.SAV`/`SACK.DAT` as
   opaque files, `df0:%s` path formatting) with **no field-level
   character-record logic** visible anywhere in its string table — it
   copies save files, it doesn't parse them. `f` is an unrelated 9-hunk
   `StealMem`/`AllocMem`-vector memory-stealing boot helper (`"Error!
   Can't exit. AllocMem vector in use!"`), with no game-data content at
   all. `game.cnf` (the project's IRA symbol-table config, 92 `SYMBOL`
   lines) was also checked for any user-named character-record fields —
   all 92 are AmigaOS library call names (`_BeginIO`, `_LoadRGB4`, etc.)
   or anonymous `.Lxx` labels, nothing stat-related. **This avenue is
   closed, negative** — a real, checked path, not an unexplored gap.

**Paths tried** (for the label/pointer-table search):

| Approach | Result | Why it didn't resolve the naming question |
|---|---|---|
| `GetStat`/`SetStat` exhaustive reloc-based caller search | 2 call sites found, both a non-display party utility | Confirms UI doesn't route through `GetStat` — a real negative, not a dead end |
| Scan for absolute/reloc reference to label block base (`0x23126`) | 0 hits anywhere in the binary | Rules out a single fixed-base loop reading the labels directly |
| Scan for absolute/reloc reference to pointer-table base (`0x234DA`) or any of its first 12 slots | 0 hits; only slots 18+ referenced (menu code) | ~~Rules out a loop *or* individual `LEA`s reaching the core-stat slots via this table~~ — **wrong, and the reason the whole search stalled.** `0x234DA` is not the table base; the real base is `0x232E2` (§6.3(d) correction) and it *is* referenced 20 times. The negative was true-but-vacuous: it enumerated instruction *shapes* (per-slot relocations) rather than the *addressing root* (one relocated base + register/immediate index). See `negative-from-addressing-root-not-shapes.md` |
| Census of the `0x11A` (282) character-record stride constant across all CODE hunks (the technique proposed in the escalation brief) | 259 occurrences of the literal; 322 code sites load the character-array base | Far too broad to discriminate — nearly every gameplay routine indexes the character array. Abandoned in favour of the string-table root |
| Enumerate the true string-table addressing root, then classify its consumers | **Solved** — 20 `ADDA.L #0x0D4A,An` sites total, leading to `SetStringN`/`PatchStringAt`, whose literal `(slot, column)` arguments name every field | §6.3(d) |
| Search for a compact word/byte stride-delta table (in case the display uses a smaller side table instead of the 32-bit pointer table) | Not found | The previous pass's `0x1EF46`/`0x07924` citation, re-examined this pass, turned out to be unrelated 12-bit-Amiga-colour palette-set code (`ANDI.L #$F00`/`#$F0`/`#$F`, `LSR.L #8`/`#4` — RGB nibble extraction), not a template table or its setup code at all; that lead is now **retracted** rather than "not chased further" |
| Investigate `backup`/`f` as a possible save-state/character-record byte oracle | Both are unrelated HUNK executables (file-level backup utility; memory-stealing boot helper), not data | Closed: neither file contains parseable character-record bytes to pattern-match against the resolver's offset formula |

Given three genuinely distinct search strategies (call-site tracing,
data-reference tracing, and a save-file/oracle search) all came back
negative for the *same* question (which raw offset is Strength/Level/
etc.), this was escalated to `re-codebreaker` this pass — see below.
The label/pointer-table structure itself, and the definitive "GetStat
isn't used for display" finding, remain real, useful, byte-confirmed
progress in their own right (see the field→`statIndex` binding table
above, which sidesteps the naming question entirely for the
combat-formula fields that motivated this search).

**Escalation status:** handed to `re-codebreaker`, which **solved it** —
see §6.3(d) below. (The suggested `0x11A`-multiply census was *not* the
technique that worked: 259 occurrences of the constant exist, ~322 code
sites load the character-array base, so that search is far too broad to
discriminate. What worked was going up one level — from the mis-sized
pointer table to the *real* 164-entry string table, then from the string
table's genuine addressing root to the two UI primitives that consume it.)

### 6.3(d) Character-sheet field names — CONFIRMED

Every `statIndex` in the core `1`-`13` range, plus four non-`GetStat`-
addressable fields and the whole SKILLS screen, is now bound to its
**English label as printed by the game**, by instruction-level trace of
the routine that builds the character sheet. **51 of 51 cited
instructions re-read byte-exact from `data/phantasie/amiga/game`; 0
mismatches.** All offsets below are **file-relative** unless marked
`char.+` (character-record-relative).

**The primitives** (all byte-verified):

| Routine | File offset | Signature | Body evidence |
|---|---|---|---|
| `StrTab` | `0x232E2` | 164 × `char*`, `HUNK_RELOC32`-relocated (slot 155 is a deliberate `NULL`) | every slot resolved; slot *n* text listed in the map below |
| `SetStringN(n, src)` | `0x8548` | `strcpy(StrTab[n], src)` | `302E 000A / 48C0 / E580 / 2040 / D1FC 0000 0D4A / 2F2E 000C / 2F10` — index×4 + table base, pushes `StrTab[n]` and `src` to a copy helper |
| `PatchStringAt(n, src, col)` | `0x7BD0` | overwrite `StrTab[n][col..]` with `src` until `src`'s NUL | `202E 0008 / E580 / 2040 / D1FC 0000 0D4A / 2250 / D3EE 0010` then a byte-copy loop — `D3EE 0010` adds the *column* argument to the resolved string pointer |
| `Fmt3u(v)` | `0xA8F2` | `sprintf(buf,"%3u",v); return buf` | `PEA 0x6A(DATA30)` → `"%3u"`, `JSR` sprintf, returns `&buf` |
| `sprintf(dst,fmt,…)` | `0x2B834` | varargs formatter | `LINK A6,#-0x118 / LEA 0x10(A6),A0 / MOVE.L 8(A6),-0x14(A6) / MOVEA.L 0xC(A6),A0` then a format-char loop |
| `udiv32(D0,D1)` | `0x2D510` | unsigned 32-bit divide, quotient `D0` | 32-iteration restoring division (`MOVEQ #31,D3 / ASL.L / ROXL.L / CMP.L / SUB.L / DBRA`) |

**The routine.** `BuildCharacterSheetStrings(char *rec)` at file offset
**`0xAA4A`** (CODE hunk 29, `LINK A6,#-0x10; MOVEM.L D2/D3/A2/A3,-(SP)` =
`4E56 FFF0 48E7 2030`). Its single caller is `ShowCharacterSheet` at
`0x8428` (which then wires up the `SPELLS`/`SKILLS`/`PURGE`/`KEEP` menu
options — the already-known slots 144/146/153/154), called in turn from
`0x2C9E`. The record pointer arrives as `8(A6)` and is read with
`206E 0008` (`MOVEA.L 8(A6),A0`) before every field access.

**The confirmed binding.** Each row is one `sprintf` + `PatchStringAt`
pair; `col` is the literal column constant passed as the third argument:

| `statIndex` | `char.+` | Read instruction (file offset) | fmt | `StrTab` slot | col | **English name** |
|---|---|---|---|---|---|---|
| **1** | `0x00` | `3010` @ `0xAAD6` | `%3u` | 126 `"STRENGTH     XXX"` | 13 | **Strength** |
| **2** | `0x02` | `30280002` @ `0xAAFA` | `%3u` | 127 `"INTELLIGENCE XXX"` | 13 | **Intelligence** |
| **3** | `0x04` | `30280004` @ `0xAB20` | `%3u` | 128 `"DEXTERITY    XXX"` | 13 | **Dexterity** |
| **4** | `0x06` | `30280006` @ `0xAB48` | `%3u` | 129 `"CONSTITUTION XXX"` | 13 | **Constitution** |
| **5** | `0x08` | `30280008` @ `0xAB70` | `%3u` | 130 `"CHARISMA     XXX"` | 13 | **Charisma** |
| **6** | `0x0A` | `3028000A` @ `0xAB98` | `%3u` | 131 `"LUCK         XXX"` | 13 | **Luck** |
| 7 | `0x0C` | *(not read by this routine)* | — | — | — | *no label — see below* |
| 8 | `0x0E` | *(not read by this routine)* | — | — | — | *no label — see below* |
| **9** | `0x10` | `32280010` @ `0xAC4E` | `%3u/%-3u` 2nd | 134 `"MAGIC       XXX/XXX"` | 12 | **Magic — maximum** |
| **10** | `0x12` | `30280012` @ `0xAC48` | `%3u/%-3u` 1st | 134 | 12 | **Magic — current** |
| **11** | `0x14` | `32280014` @ `0xAC0A` | `%3u/%-3u` 2nd | 133 `"HIT POINTS  XXX/XXX"` | 12 | **Hit Points — maximum** |
| **12** | `0x16` | `30280016` @ `0xAC04` | `%3u/%-3u` 1st | 133 | 12 | **Hit Points — current** |
| **13** (≡18) | `0x18` | `32280018` @ `0xAA92` | `%s` (3rd) | 125 `"LEVEL XX WIZARD HALFLING OKAY"` | — | **Status** (index into `DEAD`/`OK`/`SLEEP`… at `0x6A74`) |
| **42** | `0x46` | `30280046` @ `0xAD00` | `%3u` | 137 `"SCORE           XXX"` | 16 | **Score** |
| **161** | `0x100` | `32280100` @ `0xAA82` | `%s` (2nd) | 125 | — | **Race** (index into `HUMAN`/`DWARF`/… at `0x6A26`) |
| — | `0x58` | `30280058` @ `0xAA6C` | `%3d` | 125 | — | **Level** |
| — | `0xDC` | `322800DC` @ `0xAA72` | `%s` (1st) | 125 | — | **Class** (index into `THIEF`/`MONK`/`RANGER`/`FIGHTER`/`PRIEST`/`WIZARD` at `0x69A6`) |
| — | `0x106` | `30280106` @ `0xAC8E` | `%5u` | 135 `"GOLD IN BANK  XXXXX"` | 14 | **Gold in Bank** (u16) |
| — | `0x108` | `30280108` @ `0xABC2` | `%7u` | 132 `"AGE         XXXXXXX"` | 12 | **Age** — displayed as `char.+0x108 / 26` (`MOVEQ #26,D1` @ `0xABC6`, then `udiv32`) |
| — | `0x10A` | `2F28010A` @ `0xACC8` | `%10lu` | 136 `"EX. PTS  XXXXXXXXXX"` | 9 | **Experience Points** (**32-bit** longword) |
| — | `0x10E` | `D0FC010E` @ `0xAA56` | `%s` | 124 `"KATI ZOLI  "` | — | **Name** (in-record character array) |

> **This overturns the naive positional reading the brief warned about.**
> `AGE` is **not** `statIndex 7` (`char.+0x0C`) — it is `char.+0x108`, a
> field outside the `GetStat` resolver's addressable set entirely, and it
> is *transformed* (`/26`) before display. Likewise `HIT POINTS` is not
> `statIndex 8`: the four resource words sit at `0x10`/`0x12`/`0x14`/
> `0x16` in **max-then-current order per resource, Magic before Hit
> Points** — the opposite of the label order on screen. Walking the
> twelve labels against sequential `statIndex` values 1-12 would have got
> the six core attributes right, `statIndex 9` half-right by coincidence
> (`0x10` really is Magic, but the *maximum*, not the displayed pair),
> and the remaining five (`7`, `8`, `10`, `11`, `12`) flatly wrong —
> including mislabelling the already-confirmed current-HP field
> (`statIndex 12`) as "Score".

**Independent second oracle — placeholder geometry, 12/12 zero
deviation.** Each label's `XXX…` run is a trailing placeholder whose
position and length are *data*, while the column constant and the
`printf` field width are *code*. They were compared mechanically for all
twelve labels: in every case the code's column literal equals the byte
index of the string's trailing `X`/`/` run **exactly**, the format's
field width equals that run's length **exactly**, and the run ends
exactly at the string's terminator (e.g. `"EX. PTS  XXXXXXXXXX"` → col 9,
width 10, run at index 9 length 10; `"HIT POINTS  XXX/XXX"` → col 12,
width 7 for `%3u/%-3u`, run at index 12 length 7). **0 mismatches across
12 labels.** This is a genuine cross-check, not a restatement of the
trace: the strings and the code were authored independently of each
other, so a wrong slot→label assignment would put a number in the wrong
column for at least one entry.

**Third cross-check — the same HP/MP binding, from an unrelated
routine.** The party-roster line builder at `0x13718`-`0x13786` (CODE
hunk 44) formats `"%-10.9s%c HP%4d/%-4dA:%-3.2dMP%4d/%-3d "` (DATA hunk
45, `0x13F2A`) and pushes `char.+0x16` then `char.+0x14` for the HP pair
and `char.+0x12` then `char.+0x10` for the MP pair — the identical
current/maximum assignment, reached through a completely different
format string and call path. It also reveals the roster's `A:` (armour)
value is **computed**, not stored: `char.+0xFA / 75 + 1`
(`322800FA / 48C1 / 83FC004B / 5241` @ `0x136EC` — re-verified byte-exact
this pass, one instruction, `48C1` = `EXT.L D1`, omitted from the
original citation) — which names **`statIndex 58`
= armour rating (raw)**, closing part of §7.3's open list.

**SKILLS screen — also confirmed** (same `PatchStringAt` mechanism, same
routine's tail, byte-verified read instructions):

| `char.+` | Read @ | `StrTab` slot | col | Name |
|---|---|---|---|---|
| `0x1E` | `0xAE5A` | 50 `"ATTACK 255 "` | 7 | **Attack** |
| `0x20` | `0xAE80` | 51 `"PARRY  255 "` | 7 | **Parry** |
| `0x30` | `0xAEA6` | 52 `"SWIM   255 "` | 7 | **Swim** |
| `0x28` | `0xAECC` | 53 `"LISTEN 255 "` | 7 | **Listen** |
| `0x24` | `0xAEF2` | 54 `"SPOT TRAP   255 "` | 12 | **Spot Trap** |
| `0x26` | `0xAF18` | 55 `"DISARM TRAP 255 "` | 12 | **Disarm Trap** |
| `0x22` | `0xAF3E` | 56 `"FIND ITEM   255 "` | 12 | **Find Item** |
| `0x2C` | `0xAF64` | 57 `"PICK LOCK   255 "` | 12 | **Pick Lock** |

Note the offsets are **not** in screen order (`0x1E, 0x20, 0x30, 0x28,
0x24, 0x26, 0x22, 0x2C`) — another mapping that positional guessing would
have got wrong. These fall in the resolver's `statIndex 20-39`
even/odd split (§6.3(c)); `0x1E`→`20`, `0x20`→`22`, `0x22`→`24`,
`0x24`→`26`, `0x26`→`28`, `0x28`→`30`, `0x2C`→`34`, `0x30`→`38` under the
even sub-array formula `0x1E + 2*⌊(statIndex−20)/2⌋`.

**Still unnamed: `statIndex 7` (`char.+0x0C`) and `statIndex 8`
(`char.+0x0E`).** Neither is read by any display routine in this binary,
so no label exists to bind them to. A census of all 322 code sites that
load the character-array base (`ADDA.L #4,An` relocated to BSS hunk 13)
and the first `d16(An)` displacement each uses found **exactly one**
access site for each: `char.+0x0C` at `0xDB8E` (CODE hunk 35 — the combat
dispatcher, §7.3's armour-like subtrahend) and `char.+0x0E` at `0x1DA6C`
(CODE hunk 71 — the inn/rest routine, where it is used as
`char.+0x0E − char.+0x10(max Magic)`). *Caveat:* that census reads only
the **first** displacement after each base load, so it is shape-based and
may undercount; it is evidence that these fields have no display
consumer, not a proof that they have only one reader each.

> **Narrowing for `statIndex 8` (2026-08-11) — a manual-backed lead, not
> a naming.** The Phantasie I manual (plaintext copy at
> `~/Development/amigagames/Phantasie/Manual`; the same text is in
> `~/Development/amigadocs/game-manuals/Phantasie_I_and_Phantasie_II_Rulebook_SSI_text.pdf`,
> which does have a real text layer) says of the town Inn:
> *"Characters who have cast spells during their adventures may find their
> maximum limit for magic has been raised after resting at an inn."*
> That is a described behaviour with no field bound to it anywhere in this
> document — and the one and only access site found for `char.+0x0E` is in
> the **inn/rest routine** at `0x1DA6C`, where it is used as
> `char.+0x0E − char.+0x10 (maximum Magic)`. A "magic exercised since the
> last rest" accumulator that the inn compares against the current maximum
> is exactly the shape that sentence implies. **Confidence: hypothesis** —
> the inn routine's use of the difference was never traced past the
> subtraction, so what it does with the result is unknown, and the field is
> deliberately left unnamed here.
>
> No comparable lead exists for `statIndex 7` (`char.+0x0C`); the naive
> "AGE" reading is refuted above.

**Confidence:** every row of the two binding tables above is
**confirmed** — instruction-level trace, 51/51 bytes re-read from the
real file with 0 mismatches, plus two independent structural oracles
(placeholder geometry 12/12 zero deviation; the roster routine's
independent HP/MP agreement). The `/26` age divisor is confirmed as an
operation; the *unit* it converts from (fortnights? days?) is a
**hypothesis**, not established. The "no label exists for `statIndex`
7/8" negative is **evidence-backed but shape-based** — see caveat above.

**Confidence:** index-*range* hypothesis — **confirmed**, both
empirically (real-data cross-check, zero violations across two games'
full script corpora, including the P3 remap rule) and now at the
**code level** (P1's actual resolver branch chain, byte-verified against
the real executable). The per-character-record addressing formula
(`base + charIndex*0x11A + statIndex*2 + rangeConstant`) is **confirmed**
for P1. Opcode `0x12`/`0x13`'s real control flow (party-wide floor-raise
/ party-wide qualification gate) is **confirmed**, superseding the
fan-tool's documented (and apparently fan-tool-only) "no mutation"
behavior. **The resolver's full range table (every branch's formula) is
now confirmed**, byte-verified end-to-end, giving an exact
`statIndex → record-byte-offset` mapping across the whole valid domain
(`1`-`164`) — see (c) above. This let five combat-formula fields
(`char.+0xC/+0xF6/+0xF8/+0xFA/+0xF2`, §7.1b/§7.2a/§7.3) be bound to exact
`statIndex` values (`7`/`56`/`57`/`58`/`163`) without needing a name.
Individual index-to-**name** semantics (which index is literally called
"Strength" vs. "HP" in the original game) are now **confirmed** for the
whole core `1`-`13` range plus `statIndex` 42/58/161 and the eight SKILLS
fields — see **§6.3(d)**, which located the character-sheet display
routine at `0xAA4A` after correcting a mis-sized pointer table that had
made the earlier search look conclusive. Only `statIndex` 7 and 8 remain
unnamed, and for a structural reason: no display routine in the binary
reads them. See `TODO.md`.

## 7. Combat resolution

This is genuinely new ground — no prior pass in this project looked at
combat resolution at all. Traced via the `amiga-disasm` agent, starting
from data cross-references to combat-message format strings found by a
plain `strings` scan of `data/phantasie/amiga/game`
(`"%s HITS"` at file offset `0xE4CF`, `"%s MISSES"` at `0xE4D7`, a second
`"%s HITS"`/`"%s MISSES"` pair at `0xE4E1`/`0xE50A`, `"%s TAKES %d
DAMAGE"` at `0xF839` and `0xF854`). **Independently spot-checked against
the real file bytes in this pass** — every offset below was re-read
directly from `game` and byte-compared against the claimed disassembly;
all matched exactly.

### 7.1 Hit/miss resolution — function located, decision point confirmed

**Function**: file offset `0xC8B0`-`0xDF94` (a single `LINK.W A6,#-40` /
`4E56 FFD8` entry at `0xC8B0`, confirmed byte-exact, with 7 internal exit
points returning different D0 result codes) — a combat-round message
dispatcher that also emits related messages sharing the same small DATA
pool (`%s AWAKENS`, `%s CASTS A SPELL`, `%s IS HEALED`, `MONSTERS RUN`,
`A STUNNING BLOW`, etc. — not exclusively a hit/miss function, but the
hit/miss branch lives inside it).

**The hit/miss decision itself, byte-verified against the real file:**

```
0xD782  B2 80                    CMP.L   D0,D1
0xD784  6C 00 01 00              BGE.W   →MISS (falls through to "%s HITS" path
                                              on NOT-taken, i.e. HIT is the fall-through)
0xD788  20 6F 00 0A              MOVEA.L 0xA(A7),A0      ; character-name field pointer
0xD78C  D1 FC 00 00 00 04        ADDA.L  #4,A0
0xD792  D0 FC 01 0E              ADDA.W  #0x10E,A0
0xD798  48 79 00 00 00 73        PEA.L   0x73            ; "%s HITS" (DATA hunk +0x73)
```

So: `D0 >= D1` → miss (branches away to the `"%s MISSES"` path); fall
through (`D0 < D1`) → hit. **D0 is produced by a 32-bit signed-divide
call** (traced to a confirmed SAS/C-style software divide runtime helper
at file offset `0x2D550` — a classic shift/subtract loop with `dbra
D3,...` over 32 iterations, **not** a PRNG), with a monster-record field
(58-byte-stride monster-instance array, field `+0x2E`, read via
`muls.w #0x3A,D1`) subtracted from the quotient — plausibly an
armor/defense value, not confirmed. **D1** (the roll/threshold side of
the compare) comes from a stack-cached value set up earlier in the
function.

Two general-purpose compiler-support routines were identified as
landmarks for tracing this binary: logical hunk 203 @ file offset
`0x2D550` = 32-bit signed divide (`D0`=dividend, `D1`=divisor → `D0`=
quotient, `D1`=remainder, standard restoring-division shift/subtract
loop); logical hunk 206 @ file offset `0x2D6B0` = 32-bit multiply
(`mulu.w`+`swap` composition, standard 68000-lacks-32×32-multiply
workaround). Both are called repeatedly throughout this function and
turned out to be the key to unwinding the RNG below.

### 7.1a RNG source — confirmed

**The actual random-number source is a straightforward linear
congruential generator, located and disassembled this pass.** Traced by
resolving the `HUNK_RELOC32` target of every `JSR` in the hit/miss
function via this project's own hunk parser (extended to record, per
`CODE`/`DATA` hunk, the `(hunkRelativeOffset → targetHunkIndex)` reloc
list — the same technique the `game-re` tooling notes call out for
translating a pre-relocation stored operand into its real target hunk).
Independently re-read from the real file bytes in this pass:

- **`GetRandom()`** — file offset `0x2C874` (hunk 182, entry offset 0),
  bytes `4E56 FFFC` (`LINK.W A6,#-4`) confirmed. Body:
  `seed = (seed * 3677 + 3) mod 32768`, where the multiply routes through
  the shared multiply helper (hunk 206, `0x2D6B0`) and the modulo through
  the shared divide helper (hunk 203, `0x2D550`, taking the **remainder**
  half of its `D0`/`D1` output). The global seed itself is read/written
  through a small mode-dispatched accessor at file offset `0x2C8D0`
  (`mode==0` → copy global into the caller's local; `mode==1` → copy the
  caller's local into the global), and there's a distinct public seeding
  entry point at file offset `0x2C8BC` that calls the same accessor with
  `mode=1` directly against a caller-supplied value (an `SRand()`-style
  entry, not otherwise traced this pass). Constants `3677`/`3`/`32768`
  are a classic textbook LCG triple (multiplier/increment/modulus,
  modulus a power of two) — nothing timer- or hardware-derived; this
  matches the prior pass's finding that a whole-file scan for
  `$BFxxxx`/`$DFF0xx` hardware-timer addresses found zero matches.
  `GetRandom()` returns a 15-bit value in `0..32767`.
- **`RollPercent()`** — file offset `0x1DD5E` (inside hunk 71, the
  "bundled multi-entry utility hunk" the prior pass flagged, entry offset
  `0x103A` — **not** `0x1050`, the other candidate the prior pass
  recorded; see below for what `0x1050`/hunk 53's `0x85E` turned out to
  be). Body, byte-confirmed: calls `GetRandom()`, then
  `divide(GetRandom_result, 0x147)` (`0x147` = 327, via the same hunk-203
  divide helper) and returns the **quotient**. Since `GetRandom()`'s
  range is `0..32767` and `327*100 = 32700 ≤ 32767 < 327*101`, the
  quotient is always in `0..100` — i.e. `RollPercent()` is a roll on a
  0-100 scale (slightly biased toward the low end: only seed values
  `32700..32767`, 68 of 32768, produce `100`, versus 327 seeds for every
  other result — a real, if minor, original-game quirk worth preserving
  faithfully rather than "fixing" to a clean uniform 0-100 roll).
  `RollPercent()` is called pervasively throughout the hit/miss/message
  function for other probability gates too — e.g. a confirmed ~16.7%-ish
  "monster awakens" check at file offset `0xC964`
  (`jsr RollPercent(); cmpi.w #0x10,D0; bgt.w → skip`, i.e. proceed only
  if the roll is `<= 0x10`(16)).
- **The hit/miss compare's `D1` (roll/threshold) operand is exactly this
  `RollPercent()` call**, made immediately before the compare at file
  offset `0xD730` (`JSR $103A`, confirmed via the same reloc-target
  lookup) with its `D0` return value carried untouched through the
  intervening character/monster-record address arithmetic down to the
  `CMP.L D0,D1` at `0xD782`.
- **Hunk 53 offset `0x85E` (file offset `0x15A8E`) is *not* the RNG** —
  this resolves the prior pass's open "two candidate call sites"
  ambiguity. It's called (with args `(charIndexExt, 1)`) immediately
  *before* the `RollPercent()` call at `0xD728`, but its `D0` return
  value is unconditionally clobbered by `RollPercent()`'s own call
  before anything reads it — dead at this specific call site. Function
  itself (disassembled far enough to characterize, not fully unwound):
  a `LINK.W A6,#-6`-framed dispatcher that switches on a mode argument
  (`0`/`1`/`2`/else) and, in the traced `1` case, linearly scans a
  per-slot word array at `+0xF0` for a matching value — a party/monster
  *group lookup* utility, structurally unrelated to random-number
  generation. Called here purely for a side effect (or for a return
  value consumed by a different call site elsewhere in the binary, not
  this one).

### 7.1b Full to-hit formula — confirmed

Continuing the trace from `0xD680` through `0xD782` (all byte-verified
against the real file):

```
HitChance  = quotient( char[charIdx].field_0xFA  /  localDivisor )
             - monster[monIdx].field_0x2E
Roll       = RollPercent()                       ; 0..100
Miss if Roll >= HitChance, else Hit
```

where:

- `char[charIdx]` uses the confirmed 282-byte (`0x11A`) character-record
  stride and `+4` base offset already established for `GetStat`/
  `SetStat` (§6.3) and the player-damage function (§7.2) — an
  independent cross-check that this is the same record layout, now
  three-for-three.
- `field_0xFA` is a new field this pass located but did not name — a
  16-bit character-record stat read via `MOVE.W 0xFA(A0),D2` then fed as
  the divide's dividend. Plausibly an attack/to-hit-related stat, not
  independently confirmed against a display routine. **Now bound to an
  exact `statIndex` (a follow-up pass, §6.3(c)): `statIndex 58`**, via
  the fully-disassembled `GetStat`/`SetStat` resolver's own
  `56-58` branch (`offset = 2*statIndex + 0x86`) — still no English
  name, but no longer just a raw, unplaced byte offset.
- `localDivisor` (the disassembly's `-0x1E(A6)` stack local) is **not** a
  fixed constant — it's computed a few instructions earlier at `0xD5DC`-
  `0xD604`: `localDivisor = quotient(charOrGroupArray[+0x146][idx] / 10)`
  using the 68000's native single-instruction `DIVS.W #10,D0` (not the
  32-bit compiler-runtime routine — this one fits in a 16-bit divide).
  The **remainder** of that same division (`... % 10`) is used a few
  instructions later to index a 10-entry word table at `+0x132`, whose
  looked-up value becomes `monIdx` (the `-0x8(A6)` local, confirmed
  reused for the 58-byte monster-instance stride at `+0x16E` in both
  this compare and the damage step below). This `array[+0x146]` /
  `table[+0x132]` pair strongly suggests a packed `(group*10 +
  slotWithinGroup)` encoding for "who is currently attacking whom" set
  up earlier in the function (outside this pass's traced range) — real
  semantics of `+0x146`/`+0x132` not resolved this pass.
- `monster[monIdx].field_0x2E` — the same monster field already
  documented (58-byte/`0x3A` stride, base `+0x16E`), read via
  `muls.w #0x3A,D1` — plausibly armor/defense, not independently
  confirmed against a display routine. Monster records are **not**
  reachable via the `GetStat` resolver at all (§6.3(c)) — no equivalent
  binding is possible for monster-side fields with the techniques tried
  so far.

**Confidence:** the arithmetic shape (divide → subtract → compare against
a `RollPercent()` 0-100 roll, miss on `roll >= threshold`) and every
operand's *source* (which field, which record, which stride) are
**confirmed** — byte-verified disassembly, cross-checked stride/base
against two independently-traced record accessors. `char.field_0xFA` is
now bound to `statIndex 58` (§6.3(c)) — a real narrowing, though still
without an English name (that search was exhausted, not skipped — see
§6.3(c)'s "paths tried" table). `monster.field_0x2E`'s semantics and what
`+0x146`/`+0x132` actually track remain **open**.

### 7.2 Damage application — two confirmed functions, player vs. monster

The two `"%s TAKES %d DAMAGE"` string copies are **not duplicate call
sites of one shared function** — they're two structurally distinct
functions, one per target-record type:

**Player-damage function, file offset `0xEFF2`** (`4E56 FFFE` `LINK.W
A6,#-2`, confirmed byte-exact):
- Character index → record address via `MULS.W #0x11A,D1` — the
  **same 282-byte character-record stride already confirmed for
  `GetStat`/`SetStat`** (§6.3), an independent cross-check that this is
  the same character-record layout.
- Reads field `+0x18` (the same alive-flag byte already confirmed in
  §6.3's `GetStat`/`SetStat` trace) — skips damage application if dead.
- **New confirmed field**: `+0x16` (word) = current HP. `HP - damage`
  computed, then: negative or exactly zero → calls a `Die()` subroutine
  at file offset `0xF0F0` (clears `+0x18` and `+0x16` to zero, decrements
  a global living-member counter at a relocated absolute address);
  otherwise writes the new HP back to `+0x16`.

**Monster-damage function, file offset `0xF232`** (`4E56 FFFC` `LINK.W
A6,#-4`, confirmed byte-exact at entry): structurally different from the
player path — indexes into a monster-*group* table (`ASL.L #4` shift
combined with a per-slot index into a `+0x102`/`+0x132`-based structure)
rather than the 282-byte player stride, and writes the post-damage HP
directly into the computed table cell. Both functions still read the
same 58-byte (`0x3A`) monster-instance stride at base `+0x16E` for stat
lookups (matching the stride already used by the hit/miss armor-field
read in §7.1).

### 7.2a Damage magnitude formula — confirmed (party-attacks-monster path)

The instructions immediately following the "Hit" branch of the §7.1b
compare (`0xD788`-`0xD864`, all byte-verified) compute the actual damage
value and call `monsterDamage()` — which pins down, for the first time,
which direction this specific hit/miss block models: **a party member
attacking a monster** (the mirror "monster attacks player" case, which
calls the player-damage function instead, is a separate, structurally
similar block located in a follow-up pass — see §7.3).

```
weaponStat  = char[charIdx].field_0xF8                    ; word
variance    = roundedHalf( RollPercent() )                ; ⌊√roll⌋, 0..10 (see below)
raw         = variance * weaponStat                        ; 32-bit multiply
raw        -= monster[monIdx].field_0x14 * 10
groupAdj    = quotient( charOrGroupArray[+0x146][charIdx] * 100  /  0x43 )
adjusted    = raw + 0x23 - groupAdj                         ; 0x23 = 35
Damage      = quotient( adjusted / 10 )
monsterDamage(slot = localDivisor%10-indexed local, group = -0xA(A6) local, Damage)
```

Every operation and operand *source* above was independently re-read
from the real file and cross-checked against the `HUNK_RELOC32` target
of each `JSR` (the same reloc-target-resolution technique as §7.1a):
the two `JSR`s at `0xD7F2`/`0xD830`/`0xD846` resolve to the same
hunk-206 multiply and hunk-203 divide helpers already confirmed in
§7.1/§7.1a; the `JSR` at `0xD864` resolves to file offset `0xF232` —
byte-exact the monster-damage function's own entry point confirmed
above, closing the loop between this formula and the already-documented
damage-application function.

- `field_0xF8` (new field, char record) — a 16-bit stat read right before
  the roll, multiplied into the raw damage. Plausibly a weapon/attack-
  power stat; not independently confirmed. **Bound to `statIndex 57`**
  (§6.3(c), same `56-58` resolver block as `field_0xFA`'s `statIndex 58`
  above — the to-hit stat and the damage-multiplier stat are adjacent
  slots in the stat table).
- **`roundedHalf()` — fully confirmed this pass, and it is *not* "roughly
  half the roll."** Full disassembly (`0x1D714`-`0x1D772`, hunk 71 offset
  `0x9F0`) shows a classic **Newton's-method integer square root**:
  `x₀ = ⌊n/2⌋` (or return `0` immediately if `x₀ == 0` — see the quirk
  below); then repeat `x' = ⌊(x + n/x) / 2⌋` (using signed `DIVS.W`
  truncating division throughout), updating `x ← x'`, **until
  `|x_prev − x'| ≤ 1`**, at which point `x'` is returned. Hand-simulated
  against two concrete inputs to confirm: `roundedHalf(100)` converges
  `50 → 26 → 14 → 10 → 10` (Δ=0, stop) `= 10 = √100` exactly;
  `roundedHalf(50)` converges `25 → 13 → 8 → 7` (Δ=1, stop) `= 7 =
  ⌊√50⌋` (√50 ≈ 7.07). So `variance = roundedHalf(RollPercent())` is
  approximately `⌊√roll⌋`, ranging `0..10` for `roll` `0..100` — a much
  more compressed, low-biased distribution than the previously-documented
  "`≈ roll/2`" guess (range `0..50`) implied. **A real, faithfully-
  preserved original-game quirk**: input `n = 1` returns `0`, not the
  mathematically correct `⌊√1⌋ = 1` — because the initial estimate
  `⌊1/2⌋ = 0` trips the early-exit branch (`if x₀ == 0: return 0`)
  *before* the Newton loop ever runs. `n = 0` also returns `0`, but that
  one's mathematically correct anyway.
- `monster[monIdx].field_0x14` — new monster field (58-byte/`0x3A`
  stride, base `+0x16E`, same record already used for the hit/miss armor
  field `+0x2E`), scaled by 10 and subtracted — plausibly a monster
  level/defense value; not independently confirmed.
- `charOrGroupArray[+0x146][charIdx] * 100 / 0x43` — the **same**
  `+0x146` array from §7.1b's `localDivisor`, this time read directly
  (not divided by 10 first) and run through `*100/67` — `0x43` (67) has
  no obvious game-design meaning found this pass; flagged as an open
  constant.
- The 32-bit multiply/divide calls all route through the same two shared
  compiler-runtime helpers already confirmed in §7.1a (hunk 206
  multiply, hunk 203 divide, quotient half of the output each time) —
  further confirmation these two hunks are this binary's general-purpose
  arithmetic runtime, not RNG-specific.

**Confidence:** the sequence of operations and every operand's source
address/field-offset are **confirmed** (byte-verified, reloc-resolved
call targets). **`roundedHalf()`'s exact algorithm is now confirmed**
(Newton's-method integer square root, see above — no longer an
approximation). `field_0xF8` is now bound to `statIndex 57` (§6.3(c)).
`monster.field_0x14`'s semantics and the `0x43`(67) constant's
game-design meaning remain **open** — `0x43` was checked against
`roundedHalf`'s new sqrt-based understanding for a cleaner explanation
(`100/67 ≈ 1.4925`, close to but not exactly `×1.5`) with no conclusive
result.

### 7.3 Monster-attacks-player branch (mirror direction) — confirmed

Located this pass using the same anchor technique as §7.2a, run in
reverse: the `HUNK_RELOC32` list of the hit/miss dispatcher hunk
(`0xC8B0`-`0xDF94`) was scanned for any entry targeting `playerDamage`'s
own file offset (`0xEFF2`, hunk-relative `0xAB6` within its containing
hunk) instead of `monsterDamage`'s. This found **exactly one** such call,
at file offset `0xDC98`/operand `0xDC9A` (raw pre-relocation bytes `4E B9
00 00 0A B6`, confirmed byte-exact against the real file) — i.e. a
second, structurally-parallel hit/miss+damage block earlier believed
"not located" (§7.3's old text) lives inside the *same* dispatcher
function, at file offset `~0xD91A`-`0xDCAA`, just before the
already-documented party-attacks-monster block (§7.1b starts at
`0xD680`).

**Hit/miss compare, byte-verified:**

```
0xDBA6  B2 80        CMP.L   D0,D1
0xDBA8  6C 00 01 BE  BGE.W   →MISS (target 0xDD68)
```

**Formula** (every operation and operand source independently re-read
from the real file, every `JSR` target re-resolved via its own
`HUNK_RELOC32` entry the same way as §7.1a/§7.2a — this cross-check
caught and corrected one transcription slip mid-trace, where an initial
read mistook a call into the confirmed **multiply** helper (hunk 206,
`0x2D6B0`) for the divide helper; the reloc lookup settled it):

```
localA     = quotient( monster[monIdx].field_0x38 / 82 )        ; 0xDA26-0xDA30
HitChance  = ( quotient( monster[monIdx].field_0x38 / localA )
               − char[charIdx].field_0xC ) * 10                  ; 0xDB68-0xDB9C
Roll       = RollPercent() * 6                                   ; 0xDB4E-0xDB54, 0..600
Miss if Roll >= HitChance, else Hit                               ; 0xDBA6-0xDBA8
```

- `monster[monIdx].field_0x38` — a new monster field (58-byte/`0x3A`
  stride, base `+0x16E`, same monster record already used throughout
  §7.1/§7.2), read via `MOVE.W 0x38(A0),D1` — used twice: once pre-scaled
  by `/82`, then divided by that pre-scaled value again. Not
  independently confirmed against a display routine; plausibly a monster
  attack/level stat, given its structural role (mirrors `field_0x14`'s
  role in §7.2a's damage formula, both scaled/subtracted terms).
- `char[charIdx].field_0xC` — **bound to `statIndex 7`** via the
  `GetStat` resolver's core (`1-13`) range (§6.3(c)) — the *first* combat
  field this pass could place in the core-attribute range rather than the
  `42-58`/`151-164` buckets. Structurally plays the player's
  "armor/defense" role (subtracted from the monster's attack value,
  mirroring `monster.field_0x2E`'s role in §7.1b) — a real hypothesis,
  not display-confirmed.
- `Roll = RollPercent()*6` (range `0..600`) rather than a bare
  `RollPercent()` (range `0..100`) — a genuine, confirmed asymmetry from
  the party-attacks-monster direction's compare, not a transcription
  choice; the two directions use differently-scaled roll/threshold pairs
  even though both ultimately call the same `RollPercent()`.

**Damage formula**, byte-verified from `0xDBAC` (immediately after the
Hit branch) through the `playerDamage()` call at `0xDC98`:

```
base    = quotient( roundedHalf(RollPercent()) * monster[monIdx].field_0x16 / 15 )
Damage  = base − char[charIdx].field_0xF6
if statusArray[+0x146][charIdx] == 3 and Damage > 0:
    Damage -= char[charIdx].field_0xF2
    statusArray[+0x146][charIdx] = 4
    statusArray[+0x138][charIdx] = 4
playerDamage(charIdx, Damage, 0)
```

- `monster[monIdx].field_0x16` — new monster field, same 58-byte/base
  `+0x16E` record, read via `MOVE.W 0x16(A0),D1` and multiplied into the
  roll — plausibly the monster's own weapon/attack-power stat (the
  structural mirror of `char.field_0xF8`, `statIndex 57`, in §7.2a).
- The final divisor is **`15`** (`DIVS.W #$F,D0`), not the `10` used in
  §7.2a's party-attacks-monster damage formula — a second confirmed
  formula-shape asymmetry between the two directions.
- `char[charIdx].field_0xF6` — **bound to `statIndex 56`** (§6.3(c),
  same `56-58` resolver block as `field_0xF8`/`field_0xFA`) — plausibly a
  base armor/damage-reduction stat.
- `char[charIdx].field_0xF2` — **bound to `statIndex 163`** (§6.3(c),
  `162-164` block) — a *conditional*, extra damage reduction, applied
  only when `statusArray[+0x146][charIdx] == 3`. Given `+0x146` gets set
  to `4` (alongside a second, parallel array at `+0x138`, also set to
  `4`) as a side effect of this same branch, `+0x146`/`+0x138` read here
  much more like small-integer **per-character combat-stance/status
  flags** (values seen: `3`, `4`) than the "numeric stat array" framing
  §7.1b/§7.2a's citations implied — a refinement, not a contradiction:
  §7.1b's `localDivisor = quotient(array[+0x146][idx] / 10)` and §7.2a's
  `array[+0x146][charIdx] * 100 / 67` readings are still byte-accurate,
  just now with a stronger hint about what kind of value `+0x146` holds
  (a small mode/state code rather than a large numeric stat) in at least
  this one branch. Not fully resolved.
- `playerDamage(charIdx, Damage, 0)` call, byte-verified via
  `HUNK_RELOC32`: operand at `0xDC9A` resolves to hunk-relative `0xAB6`
  in the hunk starting at file offset `0xE53C` → `0xE53C + 0xAB6 =
  0xEFF2`, exactly `playerDamage`'s already-confirmed entry point
  (§7.2).
- `RollPercent()`, `roundedHalf()`, the divide helper (hunk 203), and the
  multiply helper (hunk 206) are all **reused unchanged** from the
  party-attacks-monster direction — independently re-confirmed via reloc
  lookup at every call site in this block, not assumed.

A second `monsterDamage()` call site exists earlier in the same
dispatcher hunk, at file offset `0xCD90` (in addition to the
already-documented one at `0xD864`/§7.2a) — not traced this pass; likely
a second attack-resolution instance (e.g. a multi-monster combat round)
rather than a third distinct formula, but this is not confirmed.

**Confidence:** function location, the hit/miss compare, and the full
sequence of operations for both the to-hit and damage formulas — all
**confirmed**, byte-verified disassembly with every `JSR` target
independently resolved via its own `HUNK_RELOC32` entry (catching and
correcting one initial multiply-vs-divide misreading in the process).
Four combat fields (`char.+0xC`/`+0xF6`/`+0xF2`, `monster.+0x38`/`+0x16`)
are new this pass; three of the four character-side fields are now bound
to exact `statIndex` values (`7`/`56`/`163`) via §6.3(c)'s resolver
table. Individual field *English names*, `monster.field_0x38`/
`field_0x16`'s semantics, and the exact role of the `+0x146`/`+0x138`
status-flag arrays remain **open**.

### 7.3.1 What's still open (P1)

- **Individual field *names*** (English labels, not byte offsets or
  `statIndex` values — those are now resolved for most of the fields
  below, see §6.3(c)): `statIndex 7` (`char.+0xC`), `56` (`char.+0xF6`),
  `57` (`char.+0xF8`), `58` (`char.+0xFA`), `163` (`char.+0xF2`).
  `monster.field_0x2E`/`0x14`/`0x38`/`0x16` have **no** `statIndex`
  binding available at all — monsters aren't reachable via `GetStat`
  (§6.3(c)). The display-routine search needed to get real names was
  exhaustively tried this pass and came back negative — see §6.3(c)'s
  "paths tried" table; a future pass wanting to push further should
  treat this as an `re-codebreaker`-worthy sub-problem (two genuinely
  distinct search strategies already failed) rather than repeat the same
  approach.
- What `array[+0x146]`/`+0x138`/`table[+0x132]` fully track (now
  narrowed to "small per-character combat-stance/status codes," §7.3
  above, but not fully enumerated) and what the `0x43`(67) damage-formula
  constant means (§7.2a).
- The second `monsterDamage()` call site at file offset `0xCD90` (§7.3
  above) — not traced.
- Spell-effect dispatch/application — not reached this pass.

**Confidence:** function locations and the player/monster damage-function
split — **confirmed**. Both hit/miss compares (party→monster, §7.1b, and
now monster→party, §7.3) and both damage formulas' operation sequences
and operand sources are **confirmed** — byte-verified disassembly with
every `JSR` target resolved via its `HUNK_RELOC32` entry. `roundedHalf()`
is now a **fully confirmed** exact algorithm (§7.2a). Individual field
*names* and the remaining bullets above stay **open**.

### 7.4 Phantasie II (`PHANT.PRG`, Atari ST) — combat fully confirmed, formula byte-identical to P1

Traced the same way as P1: located `%s HITS`/`%s MISSES`/
`%s TAKES %d DAMAGE`/`%s AWAKENS` in `PHANT.PRG`
(`data/phantasieii/atarist/extracted/disk1/PHANT.PRG`), then found each
string's real code cross-reference by byte-scanning the file for its
**logical address** (`fileOffset - 0x1C`, i.e. the file offset minus the
28-byte GEMDOS `.PRG` header — every string had exactly one 32-bit
literal match in the code, confirming this addressing convention holds
for `PHANT.PRG` the same way raw file offsets already work for P1/P3's
tables per `data-tables.md`). Disassembled the surrounding code
(`r2 -a m68k -b 32` against the file with its 28-byte header stripped, so
r2 addresses line up 1:1 with the logical addresses the code itself
uses).

**Hit/miss+damage block located at logical address `~0x8700`-`0x87B0`**
(file offset `~0x871C`-`0x87CC`), and it is **structurally near-identical
to P1's**, right down to shared magic constants — strong evidence this is
the same underlying formula the shared P1/P2 dungeon/scripting engine
(per this project's corpus notes) also shares for combat:

- Character record: `MULS.W #0x13E,D1` then `ADD.L #0x25162,D1` — a
  318-byte stride (P2's own value, different from P1's 282 — expected,
  different build) **plus an explicit base-pointer add**, unlike P1's
  hit/miss trace where the equivalent step never showed a visible base
  add (still an open oddity for P1, `TODO.md`'s `data-p1-hunk-addressing`).
- `DIVS.W -0x20(A6),D1` immediately after reading a character-record
  field — the exact same "stat field / local divisor" shape as P1's
  `field_0xFA / localDivisor` (§7.1b).
- Monster record: `MULS.W #0x3A,D2` (**the same 58-byte stride as P1**)
  `+ ADD.L #0x25D9A,D2`, then field `+0x2E` subtracted — **the same
  monster armor-field offset as P1**.
- `CMP.W D1,D0` / `BGE.W → MISS` — same compare-and-branch shape as P1
  (word compare here vs. P1's long compare, the only structural
  difference found).
- On the Hit path: pushes the `%s HITS` string pointer, calls a
  sprintf-style routine then a display routine, then immediately computes
  damage using **the same `0x43`(67) and `0x64`(100) constants as P1's
  damage formula** (§7.2a's `*100/0x43` step), an array lookup indexed by
  character index with an absolute base (`0x25F7E`, the P2 analogue of
  P1's `+0x146` array), then two more calls.
- Those two calls (logical `0x1A606`/`0x1A65A`) were disassembled and
  confirmed to be **P2's own 32-bit multiply and signed-divide compiler-
  runtime helpers** (same role as P1's hunk 206/203, different addresses
  and slightly different implementation shape — P2's divide includes an
  explicit divide-by-zero guard P1's didn't show) — not the RNG itself.

**RNG call site — confirmed this pass.** Working from the same stripped-
`.PRG` file (`tail -c +29 PHANT.PRG`, so a raw-file offset in the stripped
copy equals the documented logical address directly — the same convention
already established for `PHANT.PRG`'s data tables), the block was
disassembled with `r2 -a m68k -b 32 -n` (the `-n` flag matters — without it
r2 auto-detects a binary loader for this file and remaps `pd` addresses
away from real file offsets, producing all-`0xFFFF` garbage at the correct
logical addresses; confirmed by comparing `r2`'s raw byte view against
`xxd` at the same address). The instruction immediately preceding the
hit/miss compare is `JSR $FD40` (logical `0x8706`), with `D0` (its return
value) carried untouched into the `CMP.W D1,D0`/`BGE.W` compare at
`0x873C`/`0x873E` — structurally the exact same placement as P1's
`RollPercent()` call immediately before `CMP.L D0,D1`.

`$FD40` (`LINK.W A6,#-4`) is a thin wrapper, byte-confirmed:

```
0xFD40  LINK.W A6,#-4
0xFD44  JSR $1AD22            ; raw generator, see below
0xFD4A  EXT.L D0
0xFD4C  DIVS.W #0x147,D0      ; 0x147 = 327, IDENTICAL to P1's RollPercent() divisor
0xFD54  UNLK A6 / RTS         ; returns the quotient (0..100, same low-end-biased range as P1)
```

**The raw generator itself, `$1AD22`, is *not* a multiply-add-mod LCG** —
a real, byte-confirmed structural difference from both P1 and P3. It's a
small additive/summing generator over a 7-word (14-byte) circular table at
logical address `$242DE`, with a rotating write-index word at `$242EC`
(cycling `0..6`, wrapping to `0` on reaching `7`):

```
sum = table[0] + table[1] + ... + table[6]     ; ALWAYS sums indices 0..6, not lag-offset
index = (index + 1) mod 7
table[index] = sum
return sum >> 1
```

Every call re-sums the *entire* current table state (not a fixed pair of
lagged positions the way a textbook additive/Fibonacci generator usually
is), overwrites one rotating slot with the new sum, and returns half of
it. The companion seeding routine, `$1AD88` (byte-confirmed,
`LINK.W A6,#0`), writes the caller's seed value into `table[0]` then runs
`(seed & 0x3F) + 1` warm-up calls through `$1AD22` before returning — a
classic "prime the buffer" pattern for this class of generator, and a
different concrete algorithm from P1's `3677/3/32768` LCG despite serving
the identical structural role (fed into the identical `/327` `RollPercent()`
wrapper, down to the same divisor constant).

**Full to-hit formula — confirmed, byte-identical in shape and field
offsets to P1's (§7.1b):**

```
0x870c  D1 = charIdx * 0x13E(318) + $25162           ; char record ptr (explicit ADD.L, P2's own stride)
0x871c  D1 = char.+0xFA                                ; SAME field offset as P1
0x8722  D1 = D1 / localDivisor  (-0x20(a6))
0x8726  D2 = monIdx * 0x3A(58) + $25D9A                ; monster record ptr (SAME 58-byte stride as P1)
0x8736  D2 = monster.+0x2E                              ; SAME field offset as P1
0x873a  D1 -= D2                                        ; HitChance
0x8706  D0 = JSR $FD40                                  ; Roll (0..100)
0x873c  CMP.W D1,D0 / BGE.W →miss (0x8850)             ; Miss if D0(Roll) >= D1(HitChance)
```

**Full damage-magnitude formula — confirmed, byte-identical in shape,
field offsets, and constants to P1's `§7.2a`:**

```
weaponStat = char.+0xF8                                 ; SAME field offset as P1
variance   = roundedHalf(RollPercent())                 ; roundedHalf confirmed at file offset 0xF80E,
                                                          ; byte-identical Newton's-method integer-sqrt
                                                          ; shape to P1's (same early-exit-on-n=1 quirk)
raw        = variance * weaponStat
raw       -= monster.+0x14 * 10                          ; SAME field offset as P1
groupAdj   = quotient( charOrGroupArray[$25F7E][charIdx] * 100 / 0x43 )   ; SAME 100/67 constants as P1
adjusted   = raw + 0x23(35) - groupAdj                    ; SAME +35 constant as P1
Damage     = quotient( adjusted / 10 )
monsterDamage(slot, group, Damage)                        ; call at file offset 0x99E0
```

Both the multiply (`$1A606`) and divide (`$1A65A`) compiler-runtime
helpers already identified in a prior pass are reused unchanged throughout
(re-confirmed by direct call-target inspection, not reloc-resolved — P2's
`.PRG` uses plain absolute addressing for these intra-file calls, no
relocation fixup needed for the offsets used here).

**Confidence:** the RNG call site (`JSR $FD40` at logical `0x8706`), its
wrapper (`$FD40`, divisor `0x147`), the raw generator's exact algorithm
(`$1AD22`, table-sum-and-rotate, not an LCG), its seeding routine
(`$1AD88`), the full to-hit compare, and the full damage-magnitude
formula (including `roundedHalf()`'s exact algorithm at `$F80E`) are all
**confirmed** — byte-verified disassembly of the real `PHANT.PRG`, with
every field offset and constant cross-checked against P1's already-
confirmed equivalents (all match exactly except the two expected
structural differences: P2's 318-byte character stride vs. P1's 282, and
P2's `0x1AD22` additive generator vs. P1's `3677/3/32768` LCG). The
monster-attacks-player mirror direction (P1's §7.3) was **not traced for
P2** this pass — out of scope for the RNG-focused ask, and a reasonable
next step given how directly P1's template has transferred so far.

### 7.5 Phantasie III (`PhantasieIII`, Amiga) — to-hit and damage formulas fully confirmed

P3 uses a **different addressing convention** than P1/P2's hit/miss code:
`PhantasieIII` is a 3-hunk HUNK executable (one large CODE hunk holding
essentially the whole program, `data/phantasieiii/amiga/PhantasieIII`)
whose code references nearby data via **`PEA`/`LEA` PC-relative
addressing** (opcode `0x487A`, `PEA d16(PC)`) rather than `HUNK_RELOC32`-
patched absolute longs — a real byte-scan (`p + s16(word_at(p)) ==
targetOffset`, scanning every word-aligned position `p` in the CODE
hunk) found exactly one `PEA d16(PC)` reference for each of five combat
message strings (`" hits!"`, `" misses"`, `" damage! "`, `" damage and
dies."`, `" awakens"`), confirming the technique and giving single, real
xrefs to trace from — the P3 analogue of P1/P2's absolute-address string
scan.

**RNG — confirmed, a classic LCG, structurally distinct from P1's but
the same general algorithm shape:**

- **`Random(range)`**, file offset `0xAAA6` (`LINK.W A5,#0`): clamps
  `range` to `>= 1`, calls a raw-seed getter (file offset `0x1BD8`... the
  call target resolves to a function starting at file offset `0x1C00`,
  see below — the small gap between the call's literal operand and the
  function's real `LINK` entry wasn't resolved to a single instruction
  this pass, but the function found at `0x1C00` is unambiguously the
  seed-update routine reached from this call chain), then computes
  `1 + (rawSeed % range)` using the 68000's native single-instruction
  `DIVS.W` (remainder half of the quotient/remainder pair, via `SWAP`).
  Returns `1..range` inclusive — e.g. called with a literal `100` at the
  hit/miss site below, giving a `1..100` roll (P3's analogue of P1's
  `RollPercent()`, parameterized instead of hardcoded).
- **Seed-update routine, file offset `0x1C00`** (`LINK.W A5,#-2`):
  `seed = (seed * 25173 + 13849) mod 65536`, then the result is further
  reduced against `0x7FFF`(32767) via the same divide-helper call
  pattern (likely a range-clamp to keep the value in a positive 15-bit
  span, not fully resolved bit-exact this pass). **`25173`/`13849`/
  `65536` is the textbook "quick and dirty" LCG triple** (the same
  constants popularized as an example generator in Numerical Recipes) —
  a different concrete LCG than P1's `3677`/`3`/`32768`, as expected for
  an independently-built engine variant, but the same *algorithm family*
  (multiply-add-mod, modulus a power of two) — both multiply and modulo
  route through P3's own compiler-runtime helpers at file offsets
  `0x210FC` (multiply) and `0x211FC` (divide), confirmed by disassembling
  both (32-bit multiply/divide shapes, not otherwise notable).

**Hit/miss dispatcher — fully traced this pass, file offset `~0x164B8`-
`0x166CE` (a per-target loop; the `~0x16560`-`0x1668A` range cited
previously is the loop body's tail half).**

**Methodology correction — `HUNK_RELOC32` *does* resolve P3's intra-CODE-
hunk `JSR`/`LEA` absolute-long call targets, contrary to the prior pass's
blanket claim that reloc-based lookup "finds nothing at all" for P3.**
Parsing the file's own `HUNK_HEADER`/`HUNK_CODE`/`HUNK_RELOC32` structure
directly (Python, not `parseHunks()` — needed the raw hunk-relative
offset lists, which `parseHunks()` doesn't expose) shows the CODE hunk
(hunk 0) payload starts at file offset `0x28` (`HUNK_HEADER` + the
`HUNK_CODE` marker/size longwords), and its own `HUNK_RELOC32` block lists
1,465 offsets relocated against hunk 0 itself (intra-hunk absolute
references) and 4,676 against hunk 1. For every intra-hunk-0 entry, the
raw pre-relocation operand equals `targetFileOffset - 0x28` — i.e.
**`targetFileOffset = rawOperand + 0x28`**. This was verified against two
targets *already independently confirmed* by the unrelated PC-relative-
string-scan technique from the prior pass, closing two of its own open
notes: `JSR $AA7E` (raw) → `$AA7E + 0x28 = $AAA6` = `Random()`'s
already-confirmed entry point (byte-verified `4E55 0000` at `0xAAA6`);
and the "raw-seed getter" call operand `$1BD8` → `$1BD8 + 0x28 = $1C00`
= the already-confirmed seed-update routine — resolving the prior pass's
"small gap... wasn't resolved to a single instruction" note exactly. This
correction/technique is reusable for any future P3 trace: an intra-file
`JSR $addr.L` whose target doesn't disassemble to sane code almost always
means `+0x28` is needed; whether it's actually reloc-listed can be checked
against the parsed offset set for certainty. (The earlier LEA-referenced
lookup-table addresses below turned out to be reloc-listed against **hunk
1**, not hunk 0 — see §7.5.1 below; those addresses are hunk-1 offsets
that land in the DATA hunk's **uninitialized BSS tail**, so no
`+hunk1FileBase` correction can ever resolve them to file content. They
are reported raw because raw *is* the correct form: they are runtime
variable addresses, not stored-table addresses.)

Also confirmed: `r2`'s automatic binary-loader detection actively
misleads on this file — running `r2 -a m68k -b 32` (no `-n`) remaps `pd`
addresses away from real file offsets (every byte reads back as `0xFFFF`
at addresses that `xxd` shows real content for). **Always pass `-n`** when
disassembling `PhantasieIII` directly with r2; verified by comparing `r2`'s
own `px` byte view against `xxd` at the same address.

**Full to-hit formula, both branches, byte-verified:**

The dispatcher's outer loop (`0x164B8`-`0x166CE`, iterating once per
target while `-0x54(A5) < -0x5A(A5)`) reads a per-call class/type value at
`+8(A5)` and a monster-record pointer at `+0xA(A5)` (`monster.+0x28` is
read off this pointer throughout — the P3 analogue of P1/P2's monster
armor field, at its own offset). An earlier switch on a class-derived
local (`-0x5C(A5)`) selects one of two structurally distinct formula
branches:

```
# "spellcaster" branch (class == 4 or 15), 0x16512-0x16556:
threshold = table[$2A6C][classIdx] - quotient(monster.+0x28 / 2)
dieRoll   = Random(table[$2A7A][classIdx])            ; JSR $AA7E → Random(), reloc-resolved

# "other classes" branch (default), 0x1655A-0x165EA:
threshold = quotient(table[$2A42][classIdx] / perCharDivisor(-0x5A(A5))) - monster.+0x28
if table[$3D36][classIdx * 0x106]==4: threshold -= 0x28(40)
adjTerm   = (table[$3D12][classIdx*0x106] - average(table[$3D12][all classIdx], stride 0x106)) * 0x1E(30)
                                                        ; average() is a real confirmed helper function
                                                        ; at file offset 0x17B9E (PC-relative call, no
                                                        ; reloc correction needed): sums table[$3D12] over
                                                        ; every classIdx up to a global count at $2850,
                                                        ; then divides by that count
threshold += adjTerm
if difficultyMode(+0xE(A5)) == 2: threshold -= 0xF(15)
dieRoll   = Random(table[$2A50][classIdx])

# both branches converge, 0x165EE-0x1662A:
if monster[someIndexedField] == 1: threshold = 100      ; guaranteed-hit override
threshold = max(threshold, 1)
Roll      = Random(100)                                  ; 1..100 inclusive
Miss if Roll > threshold, else Hit                        ; STRICT >, not >= (a genuine P3-specific
                                                            ; comparison-operator difference from P1/P2)
```

> **Correction (2026-08-09, `re-codebreaker`):** the index written
> `classIdx` throughout the block above is **not a class index** — it is a
> **party-member index** (`0..partyCount-1`), and the "tables" are not
> tables. Three independent code-level facts establish this, all
> byte-verified:
>
> 1. `average()` at `0x17B9E` loops `i = 0; i < word at $2850; i++`, so
>    `$2850` is a **runtime party-member count**, not a compile-time class
>    count (`0x164DA` reads the same global, subtracts 1, and compares it
>    against `+8(A5)` — an "is this the last party member" test).
> 2. `$3D0A` is the base of a **7-element array of 262-byte character
>    records** (`0x106` = 262 is the record stride, used as a *byte*
>    offset directly — there is **no** additional `×2`, so the stride is
>    262 bytes, not 524). `$3D36` and `$3D12` are therefore not separate
>    tables but **fields** of that record: `$3D0A + 0x2C` and
>    `$3D0A + 0x08`.
> 3. `$2A18`, `$2A42`, `$2A50`, `$2A6C`, `$2A7A` are members of a bank of
>    parallel **7-word (14-byte) per-party-member arrays** on a strict
>    14-byte grid (see §7.5.1), populated per combat by the setup loops at
>    `0x15072` / `0x152DA` from the character records.
>
> Corrected reading (same operations, corrected operand semantics):
>
> ```
> i = party-member index (+8(A5));  party[] = 262-byte records at $3D0A
>
> # "spellcaster" branch (party[i] weapon-mode == 4 or 15), 0x16512-0x16556:
> threshold = combatDefence[i]  - quotient(monster.+0x28 / 2)      ; $2A6C[i] = party[i].+0x48
> dieRoll   = Random(combatSpellDie[i])                            ; $2A7A[i], see §7.5.1
>
> # default branch, 0x1655A-0x165EA:
> threshold = quotient(combatAttackSkill[i] / attacksThisRound) - monster.+0x28
>                                                                  ; $2A42[i] = party[i].+0x30
> if party[i].+0x2C == 4: threshold -= 40                          ; +0x2C = character STATUS
> adjTerm   = (party[i].+0x08 - average over all party members of .+0x08) * 30
> threshold += adjTerm
> if difficultyMode(+0xE(A5)) == 2: threshold -= 15
> dieRoll   = Random(combatDamageDie[i])                           ; $2A50[i], see §7.5.1
> ```
>
> `party[i].+0x2C` is confirmed as the **character status** field
> independently of the formula: the dispatcher at `0x163AA`-`0x163EC`
> skips the target outright when it is `0`, `2`, or `3` (empty slot /
> dead / disabled), which is exactly the shape of a status guard, and
> every live character in the shipped `gamesave.dat` has `+0x2C == 1`.

`Random()`'s two call sites in this block (`0x165E2`/`0x1661E`, both raw
operand `$AA7E`) are the **same reloc-verified target** as the already-
confirmed `Random()` wrapper — this pass adds a second, previously-
undocumented call site (`0x165E2`, called with a class-indexed die-size
table value as the range argument, immediately after the threshold
compare setup) on top of the already-known `Random(100)` roll call.

**Damage magnitude — confirmed, and structurally simpler than P1/P2's.**
`dieRoll` above (accumulated in local `-0x5E(A5)`, set by whichever
branch executed) **is itself the damage value** — P3 rolls a single die
against a class-indexed die-size table (`$2A7A` for the spellcaster
branch, `$2A50` otherwise), rather than P1/P2's weapon-stat × variance −
armor − group-adjustment formula. A genuine, confirmed engine-design
difference, not a partial trace.

**Damage application — located and confirmed.** The Hit path's final call
(raw operand `$1833E`, reloc-resolved via the `+0x28` rule to file offset
`$18366`, `LINK.W A5,#-0x54`, byte-verified) is P3's monster-damage-
application function, the analogue of P1's `monsterDamage()`
(`0xF232`)/P2's `0x99E0` call. Its calling-convention stack layout (derived
from the caller's 6-value push sequence at `0x166E`-`0x1680`) resolves to
`8(A5)` = monster-record pointer (the same pointer read at `+0xA(A5)` in
the outer function), `0xC(A5)` = `Damage` (the `dieRoll` value above),
`0xE(A5)` = a target-slot index (the outer function's own `-0x56(A5)`
local, itself the return value of a "find next valid target" helper at
raw `$187DA` → reloc-resolved `$18802`, called once per loop iteration).
Confirmed body behavior: `*(monsterPtr + (slotIndex+2)*2) -= Damage`,
clamped to a floor of `0` if the subtraction goes negative, then sets a
global "monster took damage" flag. Structurally the same shape as
P1/P2's HP-decrement-and-clamp-at-zero (`Die()`/floor logic), applied to
a per-slot monster-group HP table rather than a fixed record field —
consistent with P1's own monster-damage function (§7.2) also indexing a
group table rather than a flat record.

### 7.5.1 The `$2Axx`/`$3Dxx` addresses are BSS, not stored tables — resolved

> **Correction (2026-08-09, `re-codebreaker`):** the previous pass recorded
> these as "class-indexed lookup tables whose file location is unresolved,
> blocked on an unexplained `HUNK_HEADER`-vs-`HUNK_DATA` size mismatch."
> **The size mismatch is not an anomaly and not a parse error — it is the
> answer.** `PhantasieIII`'s DATA hunk is a merged `data+bss` section: the
> `HUNK_HEADER` declares the *allocation* size (`0x1AC3` longwords =
> 27,404 bytes) while the `HUNK_DATA` block stores only the *initialized*
> prefix (`0x9DF` longwords = 10,108 bytes = `0x277C`). The remaining
> 17,296 bytes are the zero-filled BSS tail, present in memory at load
> time but **absent from the file**. Every one of the cited addresses
> (`0x2A18`, `0x2A42`, `0x2A50`, `0x2A6C`, `0x2A7A`, `0x3D0A`, `0x3D12`,
> `0x3D36`) is `>= 0x277C`, so **no `dataHunkFileBase` exists that could
> resolve them** — there are no bytes in the file to resolve to. They are
> runtime variables, filled per combat from the character records. The
> prior pass's two failed searches were searching for something that
> cannot exist.

**Hunk layout — confirmed**, whole-file walk terminating exactly at EOF
(`0x2AB50`), no residue:

| File offset | Block | Contents |
|-------------|-------|----------|
| `0x000000` | `HUNK_HEADER` | 3 hunks; declared sizes `0x8622` / `0x1AC3` / `0x1` longwords |
| `0x000020` | `HUNK_CODE` (hunk 0) | payload `0x28`-`0x218B0` (137,352 B) |
| `0x0218B0` | `HUNK_RELOC32` | 1,465 offsets → hunk 0; 4,676 → hunk 1 |
| `0x0278C0` | `HUNK_DATA` (hunk 1) | payload `0x278C8`-`0x2A044` — **only 10,108 B stored** of a 27,404 B hunk |
| `0x02A044` | `HUNK_RELOC32` | 70 offsets → hunk 1; 627 → hunk 0 |
| `0x02AB44` | `HUNK_BSS` (hunk 2) | 4 B |

**Evidence that `0x277C` is the real data/BSS boundary (four independent
checks, zero deviations):**

1. **Physical impossibility of the alternative.** `0x278C8 + 27,404 =
   0x2E434`, past the 174,928-byte EOF. The stored payload can only be
   10,108 bytes.
2. **Sharp reference split.** Of the 4,676 code→hunk-1 relocations, the
   highest operand value below the boundary is `0x26B8` and the lowest at
   or above it is **exactly `0x277C`** — the first BSS variable sits at
   offset 0 of the tail, with no reference straddling the line. 575 refs
   (12.3%) fall in stored data, 4,100 (87.7%) in the tail.
3. **No initialized pointer aims into the tail.** All 70 hunk-1→hunk-1
   stored pointers have values `< 0x277C` (max `0x2578`), and every
   reloc *position* in the DATA hunk is `< 0x277C` (max `0x267E`) —
   you cannot relocate a longword that was never stored.
4. **SAS/C small-data signature.** The single hunk-1 relocation whose
   value exceeds even the allocation size (`0x7FFE`, at file offset
   `0x20DE0`) disassembles as `LEA $7FFE.L,A4` immediately followed by
   `RTS` — the textbook SAS/C `__LinkerDB` / A4 base setup
   (`A4 = dataBase + 32766`). SAS/C's linker is exactly the toolchain
   that emits a merged `__MERGED` data+bss hunk with a short
   `HUNK_DATA` block.

**What the addresses actually are — confirmed:**

`$3D0A` is a **7-element array of 262-byte character records** (the
active party: 6 usable slots plus a sentinel). Confirmed two ways: the
`MULS.W #0x106,D0` stride literal used directly as a byte offset, and the
next referenced BSS variable sitting at `0x4434` = `0x3D0A + 7 × 262`
exactly.

`$2A18` onward is a bank of parallel **7-word (14-byte) per-party-member
arrays**, every referenced base landing on a strict 14-byte grid from
`0x2A18` (`0x2A18`, `0x2A26`, `0x2A34`, `0x2A42`, `0x2A50`, `0x2A5E`
(unreferenced), `0x2A6C`, `0x2A7A`, `0x2A88`), matching the 7-slot party
array. The setup loop at `0x15072` opens by clearing index `$2850`
(the live party count) in `$2A18`/`$2A26` — the 7th slot is a terminator.

**Per-combat population — confirmed** (setup loops `0x15072`-`0x152D8`
and `0x152DA`-`0x15512`; `charRec` = `$3D0A + i × 262`):

| Array | Filled from | Notes |
|-------|-------------|-------|
| `$2A18[i]` | `charRec.+0x6E` | Weapon/attack mode. Overridden to `3` or `5` by encumbrance/status guards on `charRec.+0x30`(<76), `+0x2C`(==4), `+0x86`(==0) and a predicate call at `0x188B6` |
| `$2A26[i]` | `charRec.+0x70` | |
| `$2A34[i]` | `rampTable[charRec.+0x6A]` | via the **stored** byte table at hunk 1 `+0x0F10`; clamped to `>= 1` |
| `$2A42[i]` | `charRec.+0x30` | the to-hit "attack skill" operand |
| `$2A50[i]` | `rampTable[charRec.+0x6C]` if `+0x6C > 0`, else `$2A42[i] / 25` | clamped `>= 1`; the default-branch damage die |
| `$2A6C[i]` | `charRec.+0x48` | the spellcaster-branch threshold base |
| `$2A7A[i]` | `rampTable[charRec.+0x86] × 2 + 4` | clamped `>= 1`; the spellcaster-branch die |

**The one genuinely stored table this trail leads to: hunk 1 `+0x0F10`
(file offset `0x287D8`)** — a 202-byte lookup table (indices `0x00`-`0xC9`)
consisting of concatenated arithmetic ramps (`0..20`, `1..10`, `2..11`,
`1..20`, a ¾-slope `1..20`, a 1.25-slope `2..25`, `0..20`, `×2` and `×3`
ramps). Referenced from 24 sites. Immediately after it, at `+0x0FDA`, a
word table begins with `0,1,1,1,1,2,6,10,21,29,46,73,97,136,181,246,321,
406,521,650` — an experience-per-level curve. **Confidence: location and
content confirmed** (byte-verified, inside the stored region); per-ramp
semantics **hypothesis**. In the shipped `gamesave.dat` the index fields
`+0x6A`/`+0x6C` are `22`/`64` for every character (default starting
equipment), so real content variation was not exercised.

**`gamesave.dat` is a raw dump of four BSS regions — confirmed
byte-exact.** The save writer (`0x1FB18`, `MODE_NEWFILE` `0x3EE`) and the
loader (`0x1FCA6`, `MODE_OLDFILE` `0x3ED`) issue four mirrored
`Write`/`Read` calls with identical `(buffer, length)` pairs:

| `gamesave.dat` range | Length | hunk 1 offset | Contents |
|---|---|---|---|
| `0x0000`-`0x1996` | 6,550 | `0x5174` | **guild roster, 25 × 262-byte character records** (`6550 = 25 × 262` exactly) |
| `0x1996`-`0x2146` | 1,968 | `0x3D0A` | **active party, 7 × 262-byte records** (1,834 B) + 134 B of adjacent globals |
| `0x2146`-`0x216A` | 36 | `0x2CD4` | 18 words of game state, snapshotted from `$281C`-`$2866` just before the write |
| `0x216A`-`0x2E24` | 3,258 | `0x44BA` | **item table, `3258 = 181 × 18` exactly** |

`6,550 + 1,968 + 36 + 3,258 = 11,812` = the exact size of
`data/phantasieiii/amiga/gamesave.dat`, with zero bytes unaccounted for.
Decoding the file at a 262-byte stride yields printable names at field
`+0` in every populated slot: `THIEF`, `FIGHTER`, `WIZARD`, `MONK`,
`PRIEST`, `RANGER` at roster slots 0-5, three creature records
(`Air`/`Mist`/`Mud`, HP 150/200/250) at 6-8, and the same six characters
again at file offset `0x1996` — i.e. as party slots 0-5, with slot 6
empty. This makes `gamesave.dat` a **direct oracle for the runtime
contents** of the character records the combat formulas read.

Character-record fields established by this trail (262-byte stride,
big-endian words):

| Offset | Field | Confidence |
|--------|-------|------------|
| `+0x00` | Name, 8-byte NUL-padded ASCII | confirmed |
| `+0x08` | **Rank** — combat position `0`-`3` (the manual's Front/Middle/Back), driving the party sprite's screen X via the jump table at file `0x1b456`; the to-hit term is `(rank − partyAverageRank) × 30`. `2` for every shipped record | **confirmed** (§7.5.3) |
| `+0x0A`-`+0x14` | Six attributes, order **Strength, Intelligence, Dexterity, Constitution, Charisma, Luck** — `FIGHTER` peaks at `+0x0A` (19), `WIZARD` at `+0x0C` (18), `THIEF` at `+0x0E` (21), matching that order | **confirmed** (upgraded from *rendered* this pass — §7.5.2's character-sheet template string prints these 6 labels in this exact order, independent of the class-peak-value reasoning) |
| `+0x20`/`+0x22` | **Maximum / current** HP (`8`/`8` THIEF, `12` FIGHTER, `200` Mist) — *order corrected 2026-08-10: the sheet prints `+0x22` to the left of the `/` and `+0x20` to the right, and the manual (p.7) defines that display as `current / total`. §7.5.3* | **confirmed** |
| `+0x2C` | Status; `1` = active, `0`/`2`/`3` skip the target, `4` takes a −40 to-hit penalty | confirmed |
| `+0x30`-`+0x53` | Nine `(percentage, attribute-derived maximum)` word pairs. **The order is NOT the on-screen label order** — corrected 2026-08-10, see §7.5.3: `+0x30` Attack, `+0x34` Parry, `+0x38` Find Item, `+0x3C` Find Trap, `+0x40` Disarm Trap, `+0x44` Listen, `+0x48` Fire Bow, `+0x4C` Pick Lock, `+0x50` Swimming | **confirmed** (§7.5.3, two independent code paths) |
| `+0x48` | **Fire Bow** skill percentage (§7.5.3) — read by the **Fire/missile** branch of the to-hit formula, not a "spellcaster" branch; not a separate field, it is skill pair 6 of the `+0x30` block | **confirmed** |
| `+0x6A`, `+0x6C`, `+0x86` | Equipped **armour** / **melee weapon** / **bow** item ids — indices into the item point-value table at `+0x0F10` (`data-tables.md` §7). Shipped values `22`/`64`/`41`-`44` = Robes / Mace / Self Bow / Short Bow | **confirmed** |
| `+0x6E`, `+0x70` | Combat-menu selection (the manual's Thrust/Attack/Slash/Lunge/Aim/Spell/Parry/Fire menu); `4`/`15` select the Fire/missile branch | confirmed |
| `+0x106` | (= record stride; next record) | confirmed |

**Bonus confirmation for `inititem.dat`:** the save block at hunk 1
`0x44BA` is `0xCBA` = **3,258 = 181 × 18** bytes, matching
`data-tables.md` §6's previously *hypothesis*-level "181 records × 18
bytes" reading of `inititem.dat` — now independently corroborated by a
hardcoded length in the save/load code rather than by stride analysis.

Paths tried (superseded — recorded so they are not repeated):

| Approach | Result | Why it failed |
|----------|--------|----------------|
| `+dataHunkFileBase` (`0x278C8`) | Longword sequence incrementing by 4 | The target offset is past the stored payload entirely; the bytes read were the DATA hunk's own trailing `HUNK_RELOC32` block, not data |
| Brute-force byte-offset search for a monotonic small-value run | False positive at base `0x20562` | Resolved into the CODE hunk's `HUNK_RELOC32` block; reloc offset lists are themselves small increasing numbers |
| Treating the `HUNK_HEADER`-vs-`HUNK_DATA` size mismatch as a parse error to root-cause | No parse error exists | The mismatch is the intended SAS/C merged data+bss encoding; both figures are correct and mean different things (allocation vs. stored) |

**Confidence:** RNG algorithm (`Random(range)` wrapper and the `0x1C00`
LCG) — **confirmed** (unchanged from the prior pass). The `+0x28`
CODE-hunk reloc-resolution technique — **confirmed**, cross-validated
against two independently-already-known targets. Hit/miss dispatcher
location, both to-hit-formula branches' full operation sequences, the
hit/miss compare (including its `>` vs. P1/P2's `>=` difference), the
damage-magnitude formula (a single class-indexed die roll), and the
damage-application function's location and confirmed behavior — all
**confirmed**, byte-verified disassembly with call targets resolved via
the reloc technique above. The `$2Axx`/`$3Dxx` addresses' nature (BSS,
not stored tables), the DATA-hunk size-field mismatch (SAS/C merged
data+bss, not an anomaly), the 262-byte character-record stride, the
per-combat population of the per-party-member arrays, and the
`gamesave.dat` block map — all **confirmed** in §7.5.1. Field *names* and
the `+0x0F10` ramp table's semantics are addressed in §7.5.2 below.

### 7.5.2 Character-record field names — skill labels confirmed via the executable's own on-screen text; ramp table and body-location hypotheses tested against the manual

This pass used the new primary source (`implementation-plan.md`'s
addendum — the real SSI 1987 rule book) both directly (numeric charts) and
indirectly (as a naming hypothesis to test against the binary's *own*
text, which turned out to be the decisive evidence).

**The 9 skill-pair names — found as literal on-screen strings in
`PhantasieIII`, not just inferred from the manual.** Grepping the binary
for the manual's skill names turned up two live hits, both part of the
game's actual UI text, not fan-tool artifacts:

1. **A 9-entry short-label array**, file offset `0x5674`-`0x56c3`:
   `Attack\0 Parry\0 Swimming\0 Listen\0 Find Trap\0 Disarm Trap\0 Find
   Item\0 Pick Lock\0 Fire Bow\0` — found via the same "shared string-by-ID
   pointer table" mechanism as the race names (§4.1): parsing the DATA
   hunk's own `HUNK_RELOC32` block (hunk 1 → hunk 0 references) and
   searching for entries whose raw pre-relocation value equals
   `stringOffset - 0x28` locates 9 consecutive 4-byte pointer-table slots
   at file offset `0x29064`-`0x29084` (string-ID `120`-`128` in the same
   generic UI-string table documented in §4.1 — computed as `(0x29064 -
   0x28e84)/4 = 120`, where `0x28e84` is that table's already-confirmed
   ID-0 base), each resolving (`+0x28`) to exactly one of the 9 label
   strings above, in that exact order.
2. **The static character-sheet screen template**, file offset `0x57d3`
   (string ID `145` in the same table, at pointer-table slot `0x290c8`),
   a two-column form layout printed as one pre-formatted string with `\r`
   line breaks (split into two adjacent strings — `0x57d3`-`0x58c8` then
   `0x58c9`-`0x5966` — at a `\x00` mid-block, not independently
   investigated further):
   ```
   Name:              Score:
   Level:             Exp:
   Race:              Gold:
   Class:             Age:
   Origin:
   Status:            Attack:
   Social:            Parry:
                      Swimming:
   Strength:          Listen:
   Intelligence:      Find Trap:
   Dexterity          Disarm Trap:
   Constitution:      Find Item:
   Charisma:          Pick Lock:
   Luck:              Fire Bow:

   Hit Points:    /
   Magic Power:   /
   ```
   This independently reproduces the exact same 9-skill order in the
   right-hand column (`Attack, Parry, Swimming, Listen, Find Trap, Disarm
   Trap, Find Item, Pick Lock, Fire Bow`), and additionally gives the
   6-attribute left-column order used to upgrade `+0x0A`-`+0x14` above to
   confirmed: `Strength, Intelligence, Dexterity, Constitution, Charisma,
   Luck`.

Both on-screen sources agree with each other and with the manual's own
skill list (`Attack, Parry, Swim, Listen, Spot Trap, Disarm Trap, Find
Item, Pick Lock, Fire Bow`) in identical order, 9/9, differing only in
cosmetic wording (`Swim`→`Swimming`, `Spot Trap`→`Find Trap` — the
in-game label, not a manual transcription error). This is also the same
order §5.1's independently-derived 8-entry class/level skill-progression
table already used for its first 8 skills (`Attack, Parry, Swim, Listen,
Spot trap, Disarm, Spot item, Pick lock`) — a third, structurally
unrelated confirmation of the same ordering.

> **Correction (2026-08-10, `game-re`) — the pair↔name binding below was
> a *sequential* assumption and it is wrong for 6 of the 9 skills.** The
> character-sheet draw routine has now been located and disassembled
> (file `0x13b78`), and the skills are stored in an order that does **not**
> follow the on-screen label order. The corrected, confirmed mapping is in
> §7.5.3; the hypothesis table below is preserved as the superseded
> reading. Only Attack (`+0x30`), Parry (`+0x34`) and Pick Lock (`+0x4C`)
> were guessed correctly.

**Binding these names to the `+0x30`-`+0x53` character-record pairs —
strong hypothesis, not fully disassembly-confirmed.** A byte-level trace
of the character-sheet screen's own draw routine (reading `charRec.+0x30`,
`+0x34`, ... `+0x50` sequentially alongside printing each of the 9 labels
above, the P3 analogue of the technique that fully confirmed P1's stat
names in §6.3(d)) was **attempted this pass and did not complete**: the
draw routine's char-record pointer setup was not isolated from
`PhantasieIII`'s other `$5174` (guild-roster base)/`$3D0A` (active-party
base) consumers in the time available — both bases have dozens of xrefs
(record-copy/sort/init routines for roster management, save/load, and
combat setup all reference them), and none inspected this pass turned out
to be the sheet-display draw loop itself. What **is** independently
confirmed, and converges on the same order:

- `+0x30` (pair 0) is already disassembly-confirmed (§7.5 above) as the
  combat to-hit "attack skill" operand — matching label 1, **Attack**,
  exactly.
- No alternative ordering is supported by any evidence found this pass;
  every source that names the 9 skills (manual, both on-screen strings,
  the independently-derived §5.1 table) agrees on the same sequence.

Given this convergence, the naming below is recorded as a **strong,
explicitly-labeled hypothesis** (not "confirmed" — the gap is a specific,
nameable one: the print loop's field-by-field offset reads were not
traced) — a future pass wanting full confirmation should trace the
character-sheet draw routine from string ID `145`'s consumer, isolating
it from the many `$5174`/`$3D0A` xrefs found this pass (see below); that
would be the natural next step, and re-codebreaker-worthy if it doesn't
resolve quickly:

| Pair | Offset (cur/max) | Name (hypothesis) |
|------|-------------------|---------------------|
| 0 | `+0x30`/`+0x32` | Attack (role **confirmed** independently, §7.5) |
| 1 | `+0x34`/`+0x36` | Parry |
| 2 | `+0x38`/`+0x3A` | Swimming |
| 3 | `+0x3C`/`+0x3E` | Listen |
| 4 | `+0x40`/`+0x42` | Find Trap |
| 5 | `+0x44`/`+0x46` | Disarm Trap |
| 6 | `+0x48`/`+0x4A` | Find Item (spellcaster-branch threshold base reuses this slot — see the field table above; a genuinely odd design choice if correct, flagged not explained) |
| 7 | `+0x4C`/`+0x4E` | Pick Lock |
| 8 | `+0x50`/`+0x52` | Fire Bow |

Xref clusters found while searching for the draw routine (recorded so a
future pass doesn't repeat the search from scratch): `$5174` (roster base)
has reference sites at file offsets `0x7856`, `0x8ad2`(roster-zero-init,
inspected, ruled out), `0x8d42`, `0x8d60`, `0x8d7e`, `0xb7ca`, `0xbc6e`,
`0xd206`-`0xd830` (combat cluster, already traced), `0x12a08`, `0x140a4`
(record-swap/sort routine, inspected, ruled out — moves whole 262-byte
records around by score, doesn't read individual skill fields),
`0x140be`, `0x14112`, `0x1fc0c`, `0x1fcf0`; `$3D0A` (active-party base)
has 69 further sites, overwhelmingly the already-traced combat setup
loops. None of the un-inspected sites were disassembled this pass.

> **Correction (2026-08-10, `game-re`) — the "202-byte ramp table" is two
> 101-byte per-item stat tables, and it is now fully identified.** The
> block at hunk 1 `+0x0F10` is **not one table of concatenated arithmetic
> ramps**; it is `pointValue[itemId]` (101 bytes, `+0x0F10`) immediately
> followed by `attributesRequired[itemId]` (101 bytes, `+0x0F75`), both
> indexed by item id `0`-`100` — `101 + 101 = 202`, exact. Both bases are
> used directly by the armoury-stock builder at file `0x8b5a`
> (`lea $f10.l,a1` / `lea $f75.l,a1`, indexed by the loop's item id), and
> both are **byte-exact against the SSI rule book's own COMBAT EQUIPMENT
> tables on pages 17-18** — 200/200 values, 0 mismatches. The "ramps" are
> the item catalogue's ascending-quality runs (20 shields, 10+10 armours,
> 20 bows, 20+20 weapons), not a numeric design curve. Likewise the word
> table at `+0x0FDA` described below as "an experience-per-level curve" is
> the **181-entry item base-price table** (`0x0FDA + 181×2 = 0x1144`,
> exactly the start of the 18-entry armoury markup table). Full write-up:
> `data-tables.md` §7. The three character-record index fields
> `+0x6A`/`+0x6C`/`+0x86` are therefore **equipment-slot item ids**
> (armour / melee weapon / bow), and the shipped `gamesave.dat` values
> `22`/`64`/`41`-`44` resolve to Robes / Mace / Self Bow / Short Bow.
> The HP/MP-chart test recorded below stays valid as a refutation, and is
> now explained: the tables are indexed by item, never by class or level.

**Ramp table (`+0x0F10`, file `0x287D8`) tested directly against the
manual's Hit Points and Magic Points charts — no match, exhausted.** The
manual's "Hit Points by Class and Level" (rule book's own page 11) and
"Maximum Magic Points at Different Levels by Class" (page 14) tables were
re-read directly from the source PDF this pass (not taken on trust from
the task brief's paraphrase) and match it exactly: the 6-class × 15-level
HP chart (`FIGHTER: 10 20 32 44 56 70 82 94 106 120 130 140 150 160 170`,
...) and MP chart (`WIZARD: 10 11 12 13 14 14 15 16 16 17 17 18 19 20
20`, ...) were compared against every contiguous 90-byte (15×6) window of
the 202-byte
table, and against the table's own structure directly. The table's real
byte content (dumped this pass, byte-exact):

```
offset  0: 0,1,2,...,20                              (21 bytes: 0..20 ramp)
offset 21: 1,2,...,10, 2,3,...,10                      (20 bytes: 1..10, then 2..10 continuing)
offset 41: 1,2,...,20                                  (20 bytes: 1..20 ramp)
offset 61: 1,2,3,4,4,5,6,6,7,8,9,9,10,11,12,12,13,14,15,15  (20 bytes: ~0.75×n slope, 1..20 domain)
offset 81: 2,3,4,5,7,8,9,10,11,13,14,15,16,17,19,20,21,22,23,25  (20 bytes: ~1.25×n slope, 2..25)
offset101: 0,1,2,...,19                                (20 bytes: 0..19 ramp)
offset121: 20, then 0,2,4,...,20,0,0,2,4,...,14,16     (a ×2 ramp resetting mid-run)
offset141: 0,2,4,...,38                                (20 bytes: 0..38, ×2 ramp)
offset161: 3,6,9,...,57,60, 3,6,9,...,57,60            (a ×3 ramp, repeated twice)
```

This confirms the previous pass's characterization exactly (pure
concatenated arithmetic ramps of varying slope/domain, byte-exact) — and
rules out the manual's HP/MP charts categorically: neither chart is a
simple arithmetic progression (HP per level has an irregular, decreasing
per-level delta; MP per level even more so), so no window of this table
— which contains *only* constant-slope runs — can match either chart at
any offset, scale, or byte transform tried (raw, ×2, ÷2, +constant). **No
match; this specific hypothesis is now closed as tested-and-refuted**,
not merely untried. The table's real role remains open — it is generic
enough (bare 0..N/scaled-N ramps) to plausibly serve as a shared
"percentage/die-size scaling" lookup used by several unrelated systems
(the three confirmed character-record index fields `+0x6A`/`+0x6C`/`+0x86`
feed combat die sizes, §7.5.1's population table above), not necessarily
a single semantic table at all.

**Body-location hypothesis (Head/Torso/L-Arm/R-Arm/L-Leg/R-Leg ×
Okay/Injured/Broken/Gone, re-read directly from the manual's own
"Mortality: Hit Points and Body Areas" section, rule book page 12: *"Each
character and monster has 6 Body Locations: Head, Torso, Left and Right
Arm, and Left and Right Leg. These Locations may be Okay (O), Injured
(I), Broken (B), or Gone (G)"*) tested against P1's
`+0x146`/`+0x138`/`+0x132` fields — structurally refuted, and no P3
equivalent exists to test it against.** These three fields are
**P1-specific** (`char.+0x146` etc. use P1's 282-byte `game`-executable
character record, §7.1b/§7.3 — not P3's 262-byte record; no analogous P3
field has been located in this project's docs, and this pass didn't find
one while searching for the skill/attribute strings above). Testing the
hypothesis against what's actually confirmed about these P1 fields:

- `array[+0x146][charIdx]` and `table[+0x132]` are indexed **only by
  character index** — one value per character, not per-body-location.
  Representing 6 independent body-part states would need either 6 slots
  per character (not what's read: the code reads a single `+0x146[idx]`
  word) or a packed multi-bit encoding read via bitfield extraction — but
  the actual disassembly (§7.1b) shows `array[+0x146][idx] / 10` (quotient
  feeds a divisor) and `% 10` (remainder indexes a 10-entry table) — a
  base-10 `group*10+slot` split, not a 2-bits-per-location bitfield
  extraction (which would use `AND`/`LSR` by powers of 2, not `DIVS #10`).
  A base-10 split has no natural relationship to 6 body locations × 4
  states (24 combinations, not 10 or a multiple of 10).
- §7.3's later trace shows `+0x146[charIdx] == 3` gating a scalar
  compare-and-branch that sets **both** `+0x146[charIdx]` and
  `+0x138[charIdx]` to `4` — consistent with the already-documented
  "small per-character combat-stance/status code" reading, not with a
  6-element per-location array (a single `== 3` compare against a whole
  6-location bitfield would only fire for one specific *combination* of
  all 6 locations simultaneously, an implausible gate condition for
  ordinary combat code).

**Verdict: refuted for the specific fields the hypothesis was proposed
against.** `+0x146`/`+0x138`/`+0x132` are consistent with a monster-group
"who's attacking whom" targeting index (§7.1b's own `group*10+slot`
reading, already documented) or a small combat-stance enum, not body-part
damage tracking. Whether P3 (the game the manual actually describes)
implements body-location damage anywhere in its own, still only
partially-explored 262-byte character record is a genuinely open
question this pass didn't have a candidate field to test it against — not
escalated to `TODO.md` as a new item since no evidence points to *where*
such a field would be, only that these three specific P1 fields aren't it.

**Confidence:** the 9 on-screen skill-label strings and their exact
in-game order — **confirmed**, byte-verified against the real
`PhantasieIII` executable via the reloc-resolved string-pointer table
technique, cross-checked against the manual and against §5.1's
independently-derived table (3-for-3 agreement). The specific
pair-offset↔name binding above — **strong hypothesis**, not confirmed
(the draw-routine trace didn't complete this pass). The 6-attribute label
order — **confirmed** (upgraded from *rendered*, §7.5.1's field table
above). The ramp table's HP/MP-chart hypothesis — **tested and refuted**,
byte-exact. The body-location hypothesis against P1's `+0x146`/`+0x138`/
`+0x132` — **tested and refuted** structurally; no P3 equivalent field
identified to test it against.

### 7.5.3 P3 character record — field names CONFIRMED via the character-sheet draw routine

The draw routine §7.5.2 could not isolate has been found: **file
`0x13b78`**. It was located not by chasing `$5174`/`$3D0A` xrefs (the
search that failed) but by looking up the sheet-template string's own
**pointer-table slot**: string ID 145 sits at file `0x290c8` = hunk 1
`+0x1800`, and a `HUNK_RELOC32` scan for a stored longword equal to
`0x1800` gives **exactly one** hit, at file `0x13b98` — inside the
routine that prints it.

The routine does not read the roster or party arrays at all. It reads a
**flat 262-byte "current character" scratch copy based at hunk 1
`$30E0`** (BSS), so every `$30xx`/`$31xx` address it touches is
`recordBase + fieldOffset` with `recordBase = 0x30E0`. That the scratch
struct really is a character record is over-determined: the four fields
the **roster line printer** at file `0x129ec` reads out of the *real*
262-byte records (`$5174 + i×0x106`) land on the same four offsets, and
each is fed to the same string sub-table:

| Roster printer (`0x129ec`) | Record offset | Scratch (`0x13b78`) | String table |
|---|---|---|---|
| name, col 2 | `+0x00` | `$30E0` | — |
| race, col 10 | `+0xA8` | `$3188` | `+0x15BC` (race names, ID 0) |
| level, col 21 | `+0x74` | `$3154` | — (numeric) |
| class, col 24 | `+0x94` | `$3174` | `+0x1604` (class names, ID 18) |
| status, col 32 | `+0x2C` | `$310C` | `+0x165C` (ID 40) |

`$3174`/`$3154` are also the exact two globals the **skills-table reader**
in `data-tables.md` §5.2 reads as `classIndex`/`level` — a third
independent agreement on the same scratch base.

**Confirmed field map** (262-byte stride; screen row/column are the
sheet's, template blocks printed at col 3, rows 3 and 13):

| Offset | Size | Field | Evidence |
|---|---|---|---|
| `+0x00` | 8 | Name, NUL-padded ASCII | sheet row 3; roster col 2 |
| `+0x08` | 2 | **Rank** (combat position, `0`-`3`) | see below |
| `+0x0A`-`+0x14` | 6×2 | Strength, Intelligence, Dexterity, Constitution, Charisma, Luck | sheet rows 11-16, col 18, in this order |
| `+0x1C`/`+0x1E` | 2+2 | Magic Power **max** / **current** | sheet row 19: `+0x1E` printed left of the `/`, `+0x1C` right |
| `+0x20`/`+0x22` | 2+2 | Hit Points **max** / **current** | sheet row 18, same rule; manual p.7: *"two numbers: current hit points / total hit points"* |
| `+0x28` | 2 | Age, in 1/26 year (printed as `value / 26`) | sheet row 6 col 29, `divs #26`; manual p.7 *"the age of the adventurer in years"* |
| `+0x2C` | 2 | Status → `Dead, Okay, Asleep, Out, Down` (ID 40) | sheet row 8 |
| `+0x30`-`+0x53` | 9×(2+2) | Nine skills — **see the corrected order below** | sheet rows 8-16 col 36; skills-init at `0xe67a` |
| `+0x58` | 2 | Origin (continent) → `Gelnor, Ferronrah, Netherworld, Scandor` (ID −6) | sheet row 7 |
| `+0x6A` | 2 | Equipped **armour** item id | `data-tables.md` §7 |
| `+0x6C` | 2 | Equipped **melee weapon** item id | " |
| `+0x6E`/`+0x70` | 2+2 | Combat-menu selection (the manual's Thrust/Attack/Slash/Lunge/Aim/Spell/Parry/Fire menu) | §7.5.1 |
| `+0x74` | 2 | Level | sheet row 4 |
| `+0x82` | 2 | Score | sheet row 3 col 29 |
| `+0x86` | 2 | Equipped **bow** item id | `data-tables.md` §7 |
| `+0x8E` | 2 | Social class → `Peasant, Labourer, Craftsman, Noble, Darklord, Superhero` (ID 30) | sheet row 9 |
| `+0x94` | 2 | Class → `Fighter, Thief, Priest, Ranger, Monk, Wizard` (ID 18) | sheet row 6 |
| `+0xA8` | 2 | Race → the 18 `readP3RaceNames()` entries (ID 0) | sheet row 5 |
| `+0xF2`-`+0xFC` | 6×2 | **Body locations** — Head, Torso, L-Arm, R-Arm, L-Leg, R-Leg, each `0`-`3` → `Okay, Injured, Broken, Gone` (ID 36) | sheet rows 18-23 col 31, a 6-iteration loop at `0x13f5c` |
| `+0xFE` | 4 | Gold in bank (`u32`) | sheet row 5 col 29 |
| `+0x102` | 4 | Experience points (`u32`) | sheet row 4 col 29 |

> This also **answers the body-location question §7.5.2 left open for P3.**
> The manual's *"Each character and monster has 6 Body Locations: Head,
> Torso, Left and Right Arm, and Left and Right Leg… Okay (O), Injured
> (I), Broken (B), or Gone (G)"* is implemented in P3 as exactly six
> consecutive words at `+0xF2`, each indexing a four-entry string table
> (`Okay/Injured/Broken/Gone`, table base hunk 1 `+0x164C`). §7.5.2's
> refutation of the hypothesis against P1's `+0x146`/`+0x138`/`+0x132`
> stands unchanged — those really aren't it; the P3 field simply hadn't
> been found yet.

**The nine skills — corrected order (supersedes §7.5.2's table).** Two
independent code paths agree byte-for-byte:

1. The **sheet draw routine** prints the nine labels' values at rows 8-16.
2. The **skills-init / level-up routine** at file `0xe67a` reads
   `data-tables.md` §5.1's eight class/level tables in their documented
   order and writes each result into a specific field pair.

| Label (screen order) | §5.1 class table | Record offset (pair) |
|---|---|---|
| Attack | `0x28386` (hunk 1 `+0xABE`) | `+0x30` / `+0x32` |
| Parry | `0x283E0` (`+0xB18`) | `+0x34` / `+0x36` |
| Swimming | `0x28439` (`+0xB71`) | **`+0x50` / `+0x52`** |
| Listen | `0x28493` (`+0xBCB`) | **`+0x44` / `+0x46`** |
| Find Trap | `0x284ED` (`+0xC25`) | **`+0x3C` / `+0x3E`** |
| Disarm Trap | `0x28547` (`+0xC7F`) | **`+0x40` / `+0x42`** |
| Find Item | `0x285A1` (`+0xCD9`) | **`+0x38` / `+0x3A`** |
| Pick Lock | `0x285FB` (`+0xD33`) | `+0x4C` / `+0x4E` |
| Fire Bow | *(none — no class table)* | **`+0x48` / `+0x4A`** |

Fire Bow having no class/level table is itself confirmation: `0xe67a`
computes the other eight as
`new = (classTable[class][level] + old) / 2 + max − 49` but Fire Bow as
`new = old / 2 + max − 49`, with no table load — matching §5.1's count of
exactly **eight** 90-byte tables for **nine** skills.

**The second word of each pair is an attribute-derived maximum —
confirmed, 48/48.** §7.5.1 called these `(current, max)` pairs on
structural grounds. For eight of the nine, word 1 is exactly
`2 × governingAttribute + 30`, verified against all six shipped
`gamesave.dat` characters with **zero mismatches across 48 checks**:

| Skill | Governing attribute |
|---|---|
| Attack | Strength |
| Parry, Disarm Trap, Pick Lock | Dexterity |
| Listen, Find Trap, Find Item | Intelligence |
| Swimming | Constitution |

Fire Bow's maximum does not fit this form (values `134/91/82/96/80/64`
against Dex `21/15/11/18/12/9`) and its rule was not derived — the only
sub-item of the character record still open. Note also that the three
`Air`/`Mist`/`Mud` elemental records carry word 1 = `0` with word 0 up to
`255`, which independently rules out the alternative "word 1 is the
current value" reading.

**`+0x08` is the character's combat Rank — confirmed.** §7.5.1 recorded
it only as "value averaged across the party and ×30'd in the to-hit
adjustment; `2` for every shipped record". The party-sprite X-placement
routine at file `0x1b456` resolves it: it switches on
`party[i].+0x08` through a 4-entry jump table and writes the sprite's
screen X, clamping any out-of-range value back to `0`:

```
0x1b4b8:  if (unsigned)rank >= 4 -> x = 0x8F, rank = 0     ; clamp
0x1b4c2:  jump table at 0x1b4b0:
            rank 0 -> x = 0x8F (143)
            rank 1 -> x = 0x8A (138)
            rank 2 -> x = 0x85 (133)
            rank 3 -> x = 0x7B (123)
0x1b4d2:  spriteX[i] = x
```

This is the manual's own combat-menu `Other → Front / Middle / Back`
option (rule book p.10: *"Front… where he has the greatest chance to hit
and be hit by melee weapons"*, *"Back… where he is the least likely to
hit with, or be hit by, melee attacks"*), and it explains the to-hit term
`(party[i].+0x08 − partyAverage(+0x08)) × 30` in §7.5's default branch:
it is a *relative* position bonus, worth 30 points per rank step away
from the party's mean. The shipped default of `2` for every character is
the middle of the 0-3 range. **Which end of the range is "Front" was not
independently pinned down** — the X coordinates decrease with rank, so
rank 3 is the leftmost figure, but the party's screen side relative to
the monsters was not traced.

> **Correction to §7.5's branch label:** the branch it calls the
> *"spellcaster" branch* (taken when the combat-menu field
> `charRec.+0x6E` is `4` or `15`) reads `charRec.+0x48`, which is now
> confirmed to be **Fire Bow**, and its die comes from
> `pointValue[charRec.+0x86]` — the equipped **bow**'s point value
> (`data-tables.md` §7). It is the **Fire (missile) branch**, matching the
> manual's `Fire` combat-menu entry (*"lets the adventurer fire his
> bow"*), not a spellcasting path. §7.5's operation sequence is unchanged;
> only the branch's name and the operands' identities are corrected. This
> also removes §7.5.2's "odd-looking reuse" note about `+0x48` — there is
> no reuse: `+0x48` is Fire Bow and the missile branch is the one place a
> Fire Bow skill belongs.

**Confidence: confirmed** — every row of the field map above is a direct
disassembly read with a matching on-screen label from the game's own
template string, cross-checked against the roster printer's independent
reads of the real 262-byte records, and every field decodes to plausible,
mutually-consistent values across all nine shipped `gamesave.dat` records
(six characters whose `+0x94` class field resolves to exactly the class
name stored in their own `+0x00` name field, 6/6; all six `Origin` =
`Scandor`, P3's setting; all `Status` = `Okay`; all body locations
`Okay`; starting gold `0`-`768`).

## Open questions

| Item | What's known | What's missing |
|------|-------------|-----------------|
| P1/P2 message choice-count heuristics (§3.1) | Documented from the reference parser | Not independently re-derived from real `mess*` data; the exact original-game encoding intent for the length/choice-count overloading is unclear even in the source |
| P3 `0xF0` embedded-newline code (§3.2) | Documented from the reference parser | Not observed in the small sample of Amiga messages decoded in this pass — unconfirmed against real Amiga data |
| ~~P1 opcode `0x12` (§5)~~ | **Resolved for P1** — disassembly trace of the real `game` executable (§6.3) confirms genuinely conditional, party-wide "raise stat to floor" behavior; the reference tool's "no mutation" behavior was its own limitation | P2/P3 not independently traced — only P1's `game` was disassembled this pass |
| P2 opcode `0x13`'s "goto Action" (§5) | Declared in the display string; P1's `0x13` traced this pass turned out to be a party-wide qualification gate (§6.3), not a single-character check as previously assumed, which may inform but doesn't settle the P2-specific question | P2's own executable (`PHANT.PRG`) not disassembled this pass — still unresolved whether the "goto Action" description is a reference-tool bug or accurate original P2 behavior |
| ~~P2-exclusive opcodes `0x14`-`0x17`~~ | **Resolved** — confirmed absent from all 10 P1 `dng*` files and confirmed present/used in all 8 real P2 `DNG*` files (§5 above, `dungeon-format.md` §7) | Exact per-opcode semantics (jump targets, percent-chance rolls) still only source-derived, not independently re-derived from the raw bytes |
| ~~Item/monster name tables (§6.1/§6.2)~~ | **Resolved** — both located in all three games' executables and confirmed byte-exact against 178 (item) + 34 (monster) real dungeon-script references across all 29 real dungeon files in the project, zero out-of-range indices | None — fully confirmed |
| Character stat table (§6.3) | Index-*range* hypothesis confirmed against real P1/P2/P3 script data (zero violations); P3's remap-by-`0x3D` rule also confirmed self-consistent; **the full `GetStat`/`SetStat` resolver range table is now confirmed byte-exact end-to-end (§6.3(c))**, giving an exact `statIndex → record-byte-offset` mapping for the whole `1`-`164` domain | Individual index→**name** semantics (which byte is *called* Strength/Level/etc. in the original game) still open — the display-routine search this needs was exhaustively tried and came back negative (§6.3(c)'s "paths tried" table: `GetStat` has only 2 call sites total, neither a display routine; no code references the located label-string block or its pointer table for the core-stat slots) |
| P1 combat field semantics (§7.1b/§7.2a/§7.3) | Five character-record fields now bound to exact `statIndex` values via §6.3(c)'s resolver table: `char.+0xC`→`7`, `+0xF6`→`56`, `+0xF8`→`57`, `+0xFA`→`58`, `+0xF2`→`163`. The monster-attacks-player mirror branch (§7.3) is now located and fully formula-confirmed, alongside the already-confirmed party-attacks-monster direction (§7.1b/§7.2a). `roundedHalf()` is now a fully confirmed exact algorithm (Newton's-method integer sqrt, §7.2a) | English names for the bound `statIndex` values; `monster.field_0x2E`/`0x14`/`0x38`/`0x16` (no `statIndex` binding possible — monsters aren't `GetStat`-addressable); the `+0x146`/`+0x138`/`+0x132` status-array semantics; the `0x43`(67) damage constant |
| ~~P2 combat RNG call site (§7.4)~~ | **Resolved** — `JSR $FD40` at logical `0x8706` confirmed as the call site (immediately before the hit/miss compare, same placement as P1's `RollPercent()`); the raw generator (`$1AD22`) turned out to be a table-sum-and-rotate additive generator, not an LCG; the full to-hit and damage-magnitude formulas are now confirmed byte-identical in shape/offsets/constants to P1's | The monster-attacks-player mirror direction (P1's §7.3) — not traced for P2 |
| ~~P3 to-hit/damage formula (§7.5/§7.5.1)~~ | **Resolved** — both to-hit branches, the hit/miss compare, the damage-magnitude formula (a single die roll against a per-party-member die-size array), and the damage-application function's location/behavior are all confirmed, via a corrected `HUNK_RELOC32`-based call-target-resolution technique (`target = rawOperand + 0x28`); the `$2Axx`/`$3Dxx` addresses turned out to be BSS runtime variables (a merged SAS/C `data+bss` hunk), not stored tables — root-caused and confirmed byte-exact against `gamesave.dat`'s live character records (§7.5.1) | Two narrower residual items carried forward to `TODO.md`: `scripting-p3-ramp-table-semantics` (per-ramp meaning of the one genuinely *stored* lookup table) and `scripting-p3-charrecord-field-names` (English names for the 262-byte character-record fields) |
| ~~P3 character-record field names + ramp table (§7.5.2)~~ | **Resolved 2026-08-10 (§7.5.3, `data-tables.md` §7).** The character-sheet draw routine was located at file `0x13b78` — via the sheet template string's own pointer-table slot (`0x1800`, a single `HUNK_RELOC32` hit), not via the `$5174`/`$3D0A` xref search that failed — giving a confirmed name for every character-record field, plus the P3 body-location array at `+0xF2` the previous pass had no candidate for. **§7.5.2's sequential skill-pair binding is refuted for 6 of 9 skills**; the corrected order is confirmed by two independent code paths. The `+0x0F10` "ramp table" is two 101-byte per-item stat tables (point value, attributes required), byte-exact against the rule book's pages 17-18 across 200/200 values. `+0x08` is the combat **Rank**. | Fire Bow's attribute-derived maximum (`+0x4A`) is the one field whose formula was not derived — the other eight are exactly `2 × governingAttribute + 30` (48/48 checks). Which end of the `+0x08` rank range the manual calls "Front" was not independently pinned down. |
