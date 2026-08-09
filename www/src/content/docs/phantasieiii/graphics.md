---
title: .CMP/.CSH/.SET — Compressed Graphics
description: Phantasie III's RLE-compressed bitmap format and its combined world-map-plus-picture container, including a real bug caught and fixed during implementation.
---

Phantasie III replaces Phantasie I's raw, uncompressed `.pic`/`.pat` files
(see the [P1 graphics page](/phantasie/graphics/)) with a compressed
container format of its own: `.CMP`/`.CSH` for pictures and sprite banks,
and `.SET` for a combined overworld map + terrain picture. Both build on the
same [bitplane pixel formula and 12-bit ST palette encoding](/formats/bitplane-and-palette/)
every image format in the trilogy shares — what's specific to this game is
the compression and container layer sitting on top of it.

> **`.CSH` is not a different format from `.CMP`.** Both extensions route
> through the identical container parser — `.CSH` is used by convention for
> small UI icon sheets and `.CMP` for full pictures or monster/race sprite
> banks, but the byte layout is exactly the same. Don't special-case the
> extension when writing a decoder.

## `.CMP`/`.CSH` header and RLE stream

```
+0x0000  32 bytes   ST palette (16 × 16-bit words, see the shared palette page)
+0x0020   2 bytes   Compressed data size, big-endian — counts from the type
                     byte (+0x0022) to the end of the RLE stream, inclusive.
                     RLE stream byte length = compressedDataSize − 1.
+0x0022   1 byte    Type: 1 = horizontal interleave submode, 2 = vertical
+0x0023   variable  RLE stream — decompresses to exactly 32,000 bytes
                     (320×200×4bpp) in every one of the 6 sample files tested
after RLE      0-127 bytes  Padding to the next 128-byte file-size boundary
```

The `compressedDataSize − 1 = RLE stream length` relationship is confirmed
exactly across 6 sample files — the delta was always exactly `−1`, never
approximately.

### The RLE opcode scheme

Applied independently to each of 4 vertical strips (8,000 output bytes per
strip), decoded strip by strip:

```
opcode == 0x00        long run: read a big-endian u16 count, read ONE byte,
                       repeat it that many times
opcode 0x01-0x7F       literal run: read N distinct bytes, output each once
                       (a copy, not a repeat, despite the RLE-shaped opcode space)
opcode 0x80-0xFF       short repeat run: repeat the next single byte
                       (256 − opcode) times — 2 to 128 bytes
```

This is a compact literal/repeat scheme, not the more familiar PackBits
split on its own — PackBits handles long repeat runs (>128 bytes) by
chaining multiple negative opcodes, where this format gives long runs their
own distinct `0x00` opcode.

**Confidence: confirmed.** Verified structurally (every one of 6 sample
files decompresses to exactly 32,000 bytes with zero deviation from
320×200×4bpp) and visually (below).

### Two interleave submodes

The decompressed 32,000-byte buffer is written in one of two column-advance
patterns, selected by the header's type byte — both submodes write into the
*same* buffer layout, read back by the standard
[Interleaved (interleave=2)](/formats/bitplane-and-palette/) pixel formula
regardless of which submode produced it:

- **Type 2 (vertical)** — advance `line` after each byte; on wrapping past
  line 200, reset and advance `column` (skipping to the next even column +
  6, which implements word-interleave-by-2 addressing from within the write
  pattern itself).
- **Type 1 (horizontal)** — advance `column` directly after each byte, same
  even-column skip rule, never touching `line` until the 8,000-byte strip
  is exhausted.

Observed in the corpus: `dlgbttns.cmp` uses type 1; every other sampled file
(`heros`, `giant1`, `giant2`, `purple1`, `purple2`, `yellow1`, `yellow2`,
`title`, `anatomy1`, `anatomy2`, `dng`, `scroll`) uses type 2.

### Verification

Every file in `Graphics/*.cmp`/`*.csh` decodes to real, legible art using
this scheme:

- `title.cmp` → the actual title screen: "PHANTASIE III / THE WRATH OF
  NIKADEMUS / BY WINSTON DOUGLAS WOOD / AMIGA VERSION BY WESTWOOD / © 1987
  SSI", fully legible on a decorative border, plus an archer illustration.
- `heros.cmp` → a 10×4 grid of humanoid sprites at 32×48 spacing (40 cells
  total, see [Sprite Galleries](/phantasieiii/sprites/)) — matches its
  assigned "hero/soldier bank" role (bank index 0).
- `giant1.cmp` → two purple serpent/dragon sprites and two blue ogre/giant
  sprites, tiled at 80×72 spacing.
- `anatomy1.csh`/`dng.csh`/`scroll.csh` → small icon sprites scattered
  across an otherwise black canvas — consistent with `.CSH` being an icon
  sheet, using only a small corner of the fixed 320×200 canvas.

## `.SET` — world map + picture container

`Graphics/phantasy.set` (35,840 bytes) is **not** a generic sprite sheet
despite sharing `.CMP`/`.CSH`'s palette convention — it bundles Phantasie
III's overworld map together with the terrain-art picture used to render
it.

```
+0x0000   1 byte     Unknown header byte (0xFA/250 in phantasy.set — see
                      "The open bits" below)
+0x0001   1 byte     Map height (tiles) — 75
+0x0002   1 byte     Map width (tiles) — 50
+0x0003  32 bytes    ST palette
+0x0023  3,750 bytes Map array — row-major, cell[x,y] at y*width+x
+0x0EC1 32,000 bytes Picture data — same 320×200×4bpp buffer format as
                      CMP's decompressed output, but UNCOMPRESSED
after picture ≤127    Padding to the next 128-byte boundary
```

`35 + 3,750 + 32,000 = 35,785`; actual file size `35,840`; the `55`-byte
difference is trailing padding, consistent with the same convention seen on
every `.cmp`/`.csh` file. **Confidence: confirmed** — every byte of the
file is accounted for with zero unexplained gap.

> **A real bug caught and fixed during implementation.** The first attempt
> at this decoder assumed the picture region was already stored in
> row-major order and produced visual noise. The picture-data bytes are
> actually stored in an odd **column-block-major** order — the reference
> decoder walks `for column-block c in 0..19: for line in 0..199: for x in
> 0..7: consume one byte`, depositing each byte at
> `buffer[c*8 + x + line*160]` — which has to be explicitly undone before
> handing the bytes to the standard row-major pixel formula. The fix is
> `remapSetPictureBytes()` in `src/assets/formats/set.ts`; a smoothness
> regression test now guards against this silently breaking again. Once
> remapped, `phantasy.set` renders the documented terrain panels correctly.

### What the map array encodes

The reference tool's own `.SET` reader skips past the map array's bytes
without interpreting them. This project examined them independently:

- Value range 0-241, 196 distinct values across the 3,750 cells.
- Rendered directly as a greyscale heightmap, the array produces an
  unmistakable continent silhouette — bays, peninsulas, and internal
  shading, not noise.
- The picture region, rendered, is not a small tile grid — it's a handful
  of large, distinct terrain panels side by side (a city/castle skyline,
  mountains, forest/plains, a swamp-textured band).

**Confirmed hypothesis** (structural and rendered evidence, not code-traced
— no `.set`-consuming code was located in `PhantasieIII`): **each map-cell
byte is an X pixel-column index (0-241) into the accompanying picture.**
Two independent lines of evidence converge:

1. **Frequency distribution reveals two populations.** A handful of values
   dominate by area (`197` → 1,063 cells, `0` → 889, `227` → 325, ...), and
   strikingly, values **24 through 49 — 26 consecutive integers — each
   occur in the map array exactly once**, scattered at non-adjacent
   coordinates. That's the signature of one map cell per named location
   (town/dungeon/landmark), not a small closed "biome selector" set.
2. **Rendering `picture[row][mapValue]` for any fixed row reproduces the
   confirmed silhouette and adds geographically coherent detail**: value
   `227` forms winding, connected lines (a river network); value `0` forms
   a clean closed border (ocean); other high-frequency values form
   blob-shaped regions (forest/plains/hills). **Decisively**, the 26
   single-occurrence "location" values land squarely within the picture's
   city/castle-skyline column range — every named location on the map
   automatically gets a distinct "building facade" colour as its marker,
   purely as a side effect of the column-index scheme.

The exact row the real game samples wasn't determined — no `.set`-consuming
render code was located to trace it from. This doesn't weaken the
column-index confirmation: the rendered result is essentially identical in
*shape and feature type* at every row tested (20/50/100/150/180), differing
only in the specific texture sampled — exactly what "one terrain type per
column, texture varies down the column" predicts. Implemented as
`terrainColumnForMapValue`/`terrainPixelIndexForMapValue` in
`src/assets/formats/set.ts`.

## Sprite-bank grid extraction

Seven `.cmp` files aren't single pictures but grids of small sprites packed
into the fixed 320×200 canvas:

| Bank index | File | Cell size | Grid |
|---|---|---|---|
| 0 | `heros.cmp` | 32×48 | 10 × 4 |
| 1 | `purple1.cmp` | 32×48 | 10 × 4 |
| 2 | `yellow1.cmp` | 32×48 | 10 × 4 |
| 3 | `purple2.cmp` | 32×48 | 10 × 4 |
| 4 | `yellow2.cmp` | 32×48 | 10 × 4 |
| 5 | `giant1.cmp` | 80×72 | 4 × 2 |
| 6 | `giant2.cmp` | 80×72 | 4 × 2 |

Each bank stores a monster's **normal** and **attacking** pose as adjacent
cells in the same grid, not as two separate banks:

```
index2 = spriteIndex*2 + (isAttacking ? 1 : 0)
cellsPerRow = 320 / cellWidth
x = (index2 % cellsPerRow) * cellWidth
y = (index2 / cellsPerRow) * cellHeight     # integer division
```

**Which monster uses which bank/cell** is resolved by a per-monster
`spriteIndex` field in `monsinfo.dat` (see [Data
Tables](/phantasieiii/data-tables/)) through a piecewise mapping:
`spriteIndex` 0-14 → bank 2 cell `spriteIndex`; 15-26 → bank 1 cell
`spriteIndex-15`; 27 → bank 0 cell 10; 28-35 → bank 3 cell `spriteIndex-28`;
36-41 → bank 4 cell `spriteIndex-36`; 42-43 → bank 5 cell `spriteIndex-42`
(giant); 44-47 → bank 6 cell `spriteIndex-44` (giant). A monster renders at
giant size (80×72 instead of 32×48) whenever `spriteIndex > 41`. Race
sprites always use bank 0 (`heros.cmp`) at 32×48, never giant.

**Independently re-derived and byte-verified via direct disassembly of
`PhantasieIII`** (dispatcher at file offset `0x1B4F0`-`0x1B6E2`): every
threshold and bank assignment above matches exactly — `CMPI.W` immediates
`0x0F`(15)/`0x1C`(28)/`0x24`(36)/`0x2A`(42)/`0x2C`(44) in order, each
followed by the corresponding bank-number `MOVE.W`, and a nested compare
implementing the `spriteIndex==27 → bank 0 cell 10` special case exactly.

> **Correction: the previously-documented single-value patches for
> `spriteIndex==48`/`==65` do not exist in the real function.** There is no
> per-value check past 44-47 at all — any `spriteIndex >= 48` is clamped to
> exactly `48`, the monster's own in-memory record field is overwritten
> with the constant `14`, and the function returns without drawing on that
> call — i.e. the real fallback is "re-resolve as `spriteIndex 14`" (bank 2
> cell 14), not either of the two previously-documented special cases. Two
> real monsters hit this path: `Mud Elemental` (`spriteIndex` byte value
> `48`) and `Wolf` (`spriteIndex` `65` — not "Wild Dog", which itself has
> `spriteIndex 0`; the "wild dog" label on the old `==65` patch was a
> misidentification carried over from the reference source).
> `resolveMonsterSpriteIndex()` in `src/assets/formats/sprite-bank.ts`
> updated to match, guarded by a regression test.

The per-race `bankSpriteIndex` table this same formula needs for the 18
playable races was searched for and **not found** — see [Status & Open
Work](/phantasieiii/status/) for the three approaches tried. Race sprites
currently render using race index directly as the bank-0 cell index, an
**unverified working hypothesis**, not a located table.

## The open bits

- `.SET`'s leading header byte (`0xFA` in `phantasy.set`) — meaning
  unknown; simple checksums were tested and ruled out.
- The exact picture row `.SET`'s map renderer samples — not determined, no
  consuming code located.
- The per-race sprite-index table — not located, three search approaches
  tried.

Full detail and the paths already tried: [Status & Open
Work](/phantasieiii/status/).

See also [Data Tables](/phantasieiii/data-tables/) for `monsinfo.dat`'s
`spriteIndex` field, and [Sprite Galleries](/phantasieiii/sprites/) and
[Extracted Screens](/phantasieiii/screens/) for the rendered output.
