---
title: .PAT Sprite Banks — Word-Interleaved Sprite Layout
description: Phantasie II's monster and race sprite banks, and the render comparison that settled which bitplane layout they use.
---

`MSTR1.PAT`/`MSTR2.PAT` (76,832 bytes each — monster sprites, normal and
attacking pose) and `PARTY1.PAT`/`PARTY2.PAT` (8,192 bytes each — the 16
playable races, same two poses) hold Phantasie II's entire sprite art. Like
Phantasie I's equivalent files, there's no header, no embedded palette, no
compression — pure concatenated bitplane data, addressed by offset tables
in the executable rather than any structure inside the `.PAT` files
themselves.

> **The file size alone does not tell you the bitplane layout — only a
> pixel-level render does.** `PARTY1.PAT`/`PARTY2.PAT` are byte-exact size
> matches with Phantasie I's `party1.pat`/`party2.pat`, which briefly
> suggested they might share P1's plane layout too. They don't: all four P2
> files use the Atari ST word-interleaved layout, and the size match was a
> coincidence — both layout conventions store the same total byte count per
> sprite, just arranged differently.

## The layout question

This project's pixel-extraction pipeline supports two layout modes (full
formula on the shared [Bitplanes & Palette](../../formats/bitplane-and-palette/)
page):

- **Planar** — Phantasie I's Amiga-native convention: bitplane 0's bytes
  entirely, then plane 1's, etc.
- **Interleaved** (interleave = 2) — the Atari ST convention Phantasie III's
  `.CMP` container carries over unchanged: bitplane bytes for a given
  16-pixel column interleave every other word.

Both conventions store `width/8 * height * bitplaneCount` bytes per sprite —
identical totals, different arrangement — so byte counts alone can't
distinguish them. Settling it required rendering real data both ways and
checking which produced a legible image:

| File | Index | Dims | `Planar` render | `Interleaved` render |
|------|------:|-----:|-------------------|--------------------------|
| `MSTR1.PAT` | 0 (SKELETON) | 32×34 | noise | clean skeleton figure, arms down |
| `MSTR1.PAT` | 8 (ORC) | 32×32 | noise | clean red/brown warrior, sword + round shield |
| `MSTR1.PAT` | 17 | 80×39 | noise | clean orange/red cobra/serpent |
| `MSTR2.PAT` | 0 (SKELETON, attack pose) | 32×34 | noise | clean skeleton, arms raised |
| `PARTY1.PAT` | 0 (HUMAN) | 32×32 | noise | clean knight figure, sword + green shield |
| `PARTY1.PAT` | 1 (DWARF) | 32×32 | noise | clean blue/gold armoured figure with axe |
| `PARTY1.PAT` | 7 (OGRE) | 32×32 | noise | clean grey/tan figure, round shield |

Every `Interleaved` render is immediately recognisable and matches the name
the index resolves to; every `Planar` render of the same bytes is
unstructured noise. **Confidence: confirmed** — for both `MSTR*.PAT` and
`PARTY*.PAT`, correcting the earlier size-match guess.

## Sprite addressing

Individual sprites are located via two parallel tables in `PHANT.PRG`, not
by any structure inside the `.PAT` files:

| Table | Offset | Stride | Entries |
|---|---|---|---|
| Sprite byte offset (big-endian longword) | `0x23D90` | 4 bytes | 80 |
| Width/height (big-endian word pair) | `0x2114A` | 4 bytes | 80 |

`MSTR1.PAT` holds the "normal" pose and `MSTR2.PAT` the "attacking" pose, at
the *same* offset for a given monster index — both files share one offset
table. `PARTY1.PAT`/`PARTY2.PAT` need no table: race `index`'s byte offset
is simply `index * 32*32/2 = index * 512` (fixed 32×32, 16 races).

**Confirmed byte-exact.** Summing `width/8 * height * bitplaneCount` (the
layout-independent byte-count formula) across all 80 entries of the
width/height table reproduces exactly **76,832 bytes** — `MSTR1.PAT`'s and
`MSTR2.PAT`'s real size — with the 80 offsets landing perfectly
contiguously in index order: no gaps, no overlaps, first offset 0, last
`offset + size = 76,832`. Widths are mostly 32 (61 of 80 entries), with
larger monsters at 48/64/80. `PARTY1.PAT`'s size (8,192) is exactly
`16 * 512`, with zero remainder.

## Palette

The 16-word palette at `0x23A9E` decodes under the raw ST 3-bit-per-channel
lookup (§2 of the shared [Bitplanes & Palette](../../formats/bitplane-and-palette/)
page — **not** the Amiga `AmigaToST` even-nibble variant, since `PHANT.PRG`
is itself the Atari ST binary storing genuine 3-bit nibbles) to a plausible,
distinct 16-colour palette: black, brown, red, orange, gold, yellow, green,
dark green, olive, cyan, sky blue, blue, a light pink/white shade, grey,
magenta, white. The same 16 colours serve all four `.PAT` files — confirmed
by diffing the extracted `.pal.json` sidecars for `mstr1`, `mstr2`, `party1`,
and `party2`, byte-identical across all four.

Notably, index 12 (the light pink/white shade, `(255,219,219)`) decodes
cleanly here where Phantasie I's `AmigaToST`-decoded version of the same
palette family left that index as an unrepresented odd-nibble outlier — this
P2 finding independently explains what that P1 outlier's true colour intent
was, since the Amiga port's even-nibble-only lookup cannot represent odd ST
nibble values exactly.

## Worked example

Monster index 0 in the width/height table at `0x2114A` reads `32×34`; its
offset-table entry at `0x23D90` reads `0`. Decoding `MSTR1.PAT` bytes
`0`-`543` (`32/8 * 34 * 4 = 544` bytes) under the `Interleaved` formula with
this palette produces a clean, recognisable white skeleton figure — matching
the name table's entry 0, `SKELETON` (see
[Characters, Items & Combat](../../phantasieii/characters-and-combat/)).

## Full-screen pictures

The six `.PIC` files (`COVER1.PIC`, `COVER2.PIC`, `CROWD.PIC`, `DECOR.PIC`,
`FINAL2.PIC`, `PELNOR.PIC`) are a related but separate format — same ST
word-Interleaved layout as this page's `.PAT` sprite banks, but a
per-file palette rather than one shared table, resolved by disassembling
`START.PRG`/`PHANT.PRG` from scratch (no reference-tool source exists for
this one). See [Screens](../../phantasieii/screens/) for the renders and
`docs/phantasie/graphics-formats.md` §10 for the full trace.

## Runtime parser

This project's own render was derived from a third-party reference tool's
`Sprite.CreateBitmap` logic (`ModesEnum.Interleaved`, interleave = 2) — see
`docs/phantasie/graphics-formats.md` §1 and §9 for the generic pixel formula
and the full render-comparison evidence.
