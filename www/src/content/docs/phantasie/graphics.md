---
title: Graphics Formats
description: Phantasie I's raw uncompressed .pic full-screen pictures and .pat sprite banks, and the palette-decode correction behind their colour.
---

Phantasie I's Amiga graphics use the platform-native, contiguous-bitplane
layout throughout — see [Bitplanes & Palette](../../formats/bitplane-and-palette/)
for the shared pixel-extraction formula every image in the trilogy reduces
to. This page covers what's specific to this game: file layout, the
executable-side palette and sprite-address tables, and the palette-decode
correction that made all 6 full-screen pictures render in true colour this
session.

> **`.pic` files have no header and no embedded palette.** Decoding one
> under the Atari-ST word-interleaved convention (correct for Phantasie
> II/III) — with or without a 32-byte offset, in case it were an unheadered
> `.CMP` — produces only noise. The plain contiguous-bitplane convention
> with **no header at all** (pixel data starts at byte 0) is the only one
> that renders correctly, and the real palette has to be traced through the
> `game` executable's loading code, not assumed from a fixed table: there
> are **5** candidate palettes, and the wrong one produces a plausible but
> wrong-coloured image, not obvious noise.

## `.pic` — raw full-screen pictures

| File(s) | Size | Width × Height | Bitplanes | Bytes/plane |
|---|---|---|---|---|
| `cover1.pic`, `cover2.pic`, `decor.pic`, `final.pic`, `pelnor.pic` | 32,000 | 320 × 200 | 4 | 8,000 |
| `logo.pic` | 7,040 | 176 × 80 | 4 | 1,760 |

`width/8 * height * bitplanes` reproduces the exact file size in every case
(`320/8*200*4 = 32,000`; `176/8*80*4 = 7,040`) — a structural confirmation
independent of rendering.

### Palette assignment — 5 slots, resolved per file

The executable holds **five** consecutive 16-colour palettes in DATA hunk 69
(`pal0`-`pal4`, `game+0x1945C`-`0x194FC`), and a single shared setter
(`SetPalette`, `game+0x1F1CA`) selects among them per screen. Which palette
governs which `.pic` file was resolved by tracing every `SetPalette` call
site (`HUNK_RELOC32` for cross-hunk calls, plus 3 intra-hunk `bsr`s a
relocation-only scan misses) against the picture-loading code:

| File(s) | Palette | Offset | Set at |
|---|---|---|---|
| `cover1.pic`, `cover2.pic` | `pal4` | `game+0x194DC` | `game+0x1F0AA` (title sequence) |
| `pelnor.pic` | `pal1` | `game+0x1947C` | `game+0xA142` (`SelectTown`) |
| `logo.pic` | `pal1` (inherited — no `SetPalette` of its own) | `game+0x1947C` | — |
| `decor.pic`, `final.pic` | `pal3` | `game+0x194BC` | `game+0xBFF8` (ending sequence) |

`logo.pic` never calls `SetPalette`/`LoadRGB4`/`SetRGB4`; its only two
callers are reachable exclusively from the town's Info menu, so it renders
under whatever palette the town screen already set (`pal1`) — confirmed by
the yellow Andromeda star (`pal1[4] = 0x0EE0`, yellow; `pal4[4] = 0x0C22`,
dark red — the wrong palette turns the star red).

**How a `.pic` reaches the screen** (`showPic(name)`, `game+0x1F288`):

```
if (strcmp(name, "cover2.pic") != 0)              /* already-resident check */
    Read(name, tempBitMap.Planes[0], 32000, 0);
WaitTOF();
*(UWORD *)0xDFF096 = 0x0100;                      /* DMACON: bitplane DMA off */
BltBitMapRastPort(&tempBitMap, 0, 0, windowRastPort, 0, 0, 320, 200, 0xC0);
WaitTOF();
*(UWORD *)0xDFF096 = 0x8100;                      /* DMACON: bitplane DMA on  */
```

One flat 32,000-byte `Read` lands directly as four contiguous 8,000-byte
planes at `tempBitMap.Planes[0]` — an independent, code-level confirmation
of the header-less contiguous-plane layout, on top of the size arithmetic.
`logo.pic` doesn't go through `showPic` (different dimensions; drawn as an
`intuition` image instead).

**Confirmed, all 6 files render as legible, correctly coloured game art**:
`cover1.pic`/`cover2.pic` → the title screen (stone gate, sword,
"PHANTASIE" logotype, copyright banner); `pelnor.pic` → the town screen
(bank, chapel, gate, half-timbered building under an `Info / Town /
Options` menu bar); `decor.pic` → a temple/throne-room interior; `final.pic`
→ a wizard on a mountain; `logo.pic` → the "Phantasie Version 1.0" /
"K.Massa, Z.Horvath" credits panel.

## `.pat` — sprite banks

| File(s) | Size | Sprites | Dimensions |
|---|---|---|---|
| `mstr1.pat`, `mstr2.pat` | 68,016 bytes each | 80 (normal pose / attack pose) | variable per monster |
| `party1.pat`, `party2.pat` | 8,192 bytes each | 16 (normal pose / attack pose) | fixed 32×32 |

No header, no embedded palette, no compression — pure concatenated
contiguous-bitplane data, addressed by tables stored in `game`, not by any
structure inside the `.pat` files:

- **Monsters**: a 4-byte big-endian sprite byte-offset per index at
  `game+0x16842 + index*4`, and a 2×2-byte big-endian width/height pair at
  `game+0x1EA8 + index*4`. `mstr1.pat` holds the normal pose, `mstr2.pat`
  the attacking pose, at the *same* offset for a given monster.
- **Races**: no table needed — race `index`'s sprite starts at
  `index * 32*32/2 = index * 512`, all 16 races being a fixed 32×32.

**Confirmed, byte-exact.** Summing `width/8*height*4` for all 80 monster
entries reproduces `mstr1.pat`'s exact 68,016-byte size with **zero**
discrepancy, and the 80 computed offsets are perfectly contiguous
(`offset[i+1] == offset[i] + size[i]` for every `i`). `party1.pat`'s size
(8,192) is exactly `16 * 512`, zero remainder. Monster index 0
(`SKELETON`) and index 8 (`ORC`) decode to immediately recognisable
figures under the confirmed palette; see [Sprite
Galleries](../../phantasie/sprites/) for all 80 monsters and all 16 races.

## The palette correction

Both `.pic` and `.pat` ultimately read the same 16-bit `$0RGB` colour word
(see [Bitplanes & Palette](../../formats/bitplane-and-palette/) for the full
encoding), but this word is consumed by **two different lookup
tables** depending on where it comes from — and this session corrected
which one applies to Phantasie I's own Amiga executable palettes.

**Wrong (the earlier reading):** treat every `$0RGB` word as Atari-ST
3-bit-per-channel data, expanding each nibble through a 16-entry
`AmigaToST` table that only populates *even* indices
(`[0x00,0x00, 0x24,0x00, …, 0xFF,0x00]`) — any odd nibble silently decodes
to a zeroed channel.

**Correct:** `data/phantasie/amiga/game` is an AmigaOS `HUNK` executable,
and its palette words go straight into `graphics.library/LoadRGB4` (call
site byte-confirmed at `game+0x1F218`), which honours **all four bits**
per channel. The correct decode is the plain `component * 17` scale on the
raw nibble — no even/odd constraint. `AmigaToST` remains correct, but only
for the genuinely ST-sourced Phantasie II/III container palettes.

Across P1's five palettes, 235 of 240 nibbles happen to be even, so the two
decodes mostly agree — which is exactly why the bug stayed invisible. The
**5 that don't** are all the value `11`: `pal2[3]` (`0x0EB0`), `pal2[4]`
(`0x008B`), `pal3[12]` (`0x0EBB`, both nibbles odd), and `pal4[2]`
(`0x0EB0`).

`pal3` — the monster/race sprite palette — is affected at index 12:

<style>
.sw { display:inline-block; width:0.8em; height:0.8em; border-radius:2px;
      vertical-align:-0.1em; margin-right:0.15em;
      border:1px solid rgba(128,128,128,.45); }
</style>

| Index | Word | Wrong decode (even-nibble) | Correct decode (`×17`) |
|---|---|---|---|
| 12 | `0x0EBB` | <span class="sw" style="background:rgb(238,0,0)"></span>`rgb(238,0,0)` — pure red | <span class="sw" style="background:rgb(238,187,187)"></span>`rgb(238,187,187)` — pale salmon |

**Confirmed, all 6 `.pic` files**: this session's asset pipeline already
renders every `.pic` through the corrected `component*17` decode (via
`readP1PaletteSlot()`) — `cover1.pic` decodes to a fully legible,
correctly coloured title screen with no manual colour correction, the
strongest single check for this whole page.

**Still open for the `.pat` sprite banks.** The `.pat` monster/race sprite
renderer (`readP1Palette()`) has **not** yet been switched to the corrected
decode — it still uses the even-nibble `AmigaToST` lookup, so the
committed `mstr1.png`/`mstr2.png`/`party1.png`/`party2.png` atlases
currently render `pal3`'s index 12 as pure red rather than the correct pale
salmon. The fix is understood and documented, not applied, because
flipping it changes committed golden RGB expectations in
`palette.test.ts`/`sprite-bank.test.ts`. See [Status & Open
Work](../../phantasie/status/) (`gfx-p1-palette-decode-variant`).

## The open bits

- The `.pat` sprite-bank palette decode above — tracked as
  `gfx-p1-palette-decode-variant`.
- The non-dungeon world files (`twns.int`, `out*.dat`, `maps.int`,
  `scrolls.dtx`, `tamb.dat`) carry no image data of their own but are
  otherwise mostly unexplored — see
  [Status & Open Work](../../phantasie/status/).

See `docs/phantasie/graphics-formats.md` §§1-3, 7-9 for the full evidence
trail, including the exhaustive `HUNK_RELOC32` correction notes for how the
`SetPalette` call-site search was originally undercounted.
