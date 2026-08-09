---
title: Bitplanes & Palette
description: The shared pixel-extraction formula and 12-bit ST-style palette encoding underneath every image format in all three Phantasie games.
---

Every image format across all three games — Phantasie I's raw `.pic`/`.PAT`
files, Phantasie II's Atari ST `.PAT` sprite banks, Phantasie III's
compressed `.CMP`/`.CSH`/`.SET` files — reduces to the same generic
bitplane pixel-extraction routine underneath. What differs is only how
bytes are laid out in memory before that routine runs.

## One pixel formula, two layout modes

```
byteX = x >> 3
for each bitplane b in 0..bitplaneCount-1:
    offset = (byteX mod interleaveSize)
           + (byteX div interleaveSize) * (bitplaneCount * interleaveSize)
           + b * bitplaneStride
           + y * scanlineStride
    bit = (byte at offset) >> (7 - (x mod 8)) & 1
    colorIndex |= bit << b
pixel = palette[colorIndex]
```

| Mode | Used by | `interleaveSize` | `scanlineStride` | `bitplaneStride` |
|---|---|---|---|---|
| **Planar** | Phantasie I's `.pic`/`.PAT` (raw Amiga bitplanes) | `width/8` | `width/8` | `width*height/8` |
| **Interleaved** (interleave = 2) | Phantasie II's `.PAT` and Phantasie III's `.CMP`/`.CSH`/`.SET` (Atari ST word-interleaved) | 2 | `width/8 * bitplaneCount` | 2 |

**Planar** is the classic Amiga-native layout: bitplane 0's entire
`width/8 * height` bytes, then bitplane 1's, then plane 2's, then plane 3's,
contiguously. **Interleaved** is the Atari ST convention Phantasie II and
III's container formats carry over unchanged: bitplane bytes for a given
16-pixel column interleave every other word.

Confirmed by exclusion, not just formula-matching: decoding a `.pic` file
under the interleaved convention (with or without a 32-byte offset, in case
it were an unheadered `.CMP`) produces only noise; the plain planar
convention with no header at all renders correctly. The reverse holds for
Phantasie III's ST-inherited container files.

Index 0 in every palette is transparent for sprite compositing, but
Phantasie's full-screen pictures always render opaque (index 0 paints
background colour, not a punch-through).

## Palette encoding — Atari ST 12-bit RGB444

Both the ST-native container files' embedded palettes and the Amiga
executables' palette tables (Phantasie I's monster/race palette in `game`,
Phantasie III's in `PhantasieIII`) store colours as the same 16-bit word:

```
Byte 15-12: unused (always 0 in every sample observed)
Byte 11-8:  Red nibble
Byte 7-4:   Green nibble
Byte 3-0:   Blue nibble
```

Two different lookup tables turn a nibble into an 8-bit channel value,
depending on where the palette word came from:

**ST-native** (Phantasie II/III's container-embedded palettes): the nibble
is 0-7 (3-bit ST hardware range), expanded via a linear ramp —

```
ST lookup: [0x00, 0x24, 0x49, 0x6D, 0x92, 0xB6, 0xDB, 0xFF]
```

**Amiga-native** (Phantasie I and III's Amiga *executable* palette tables):
the nibble is 0-15 (4-bit Amiga OCS/ECS range), expanded via a plain
`component * 17` scale — the correct decode for a word that goes straight
into `graphics.library`'s `LoadRGB4`, which honours all four bits per
channel.

<details>
<summary>A published correction: the even-nibble shortcut looks right until it isn't</summary>

An earlier pass used a 16-entry `AmigaToST` lookup that only populates even
indices (`[0x00,0x00, 0x24,0x00, 0x49,0x00, …]`) — a shortcut that
happened to work almost everywhere, since 235 of Phantasie I's 240 palette
nibbles are even. The **5 that aren't** (`pal2[3]`, `pal2[4]`, `pal3[12]`
twice, `pal4[2]`, all the odd value `11`) silently decoded to a zeroed
channel under that lookup. Tracing the palette word's real consumer — the
`LoadRGB4` call site in `game`, byte-confirmed — showed it honours all four
bits, so the correct decode is the plain `component * 17` scale, not an
even-only table. `AmigaToST` remains correct for the genuinely ST-sourced
Phantasie II/III container palettes, which really are 3-bit values.

</details>

## Ground-truth oracle

Every rendered image on this site uses this decoding. The strongest single
check: Phantasie I's `cover1.pic` decodes to a fully legible, correctly
coloured "PHANTASIE" title screen — brown gate, blue sword, red copyright
banner — under exactly this formula and palette, with no manual color
correction.

See each game's own graphics page for its container format (compression,
headers, sprite-bank addressing) built on top of this foundation.
