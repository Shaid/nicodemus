---
title: .CMP/.CSH/.SET — Compressed Graphics
description: Phantasie III's RLE-compressed bitmap format and its combined world-map-plus-picture container, including a real bug caught and fixed during implementation.
---

Phantasie III replaces Phantasie I's raw, uncompressed `.pic`/`.pat` files
(see the [P1 graphics page](../../phantasie/graphics/)) with a compressed
container format of its own: `.CMP`/`.CSH` for pictures and sprite banks,
and `.SET` for a combined overworld map + terrain picture. Both build on the
same [bitplane pixel formula and 12-bit ST palette encoding](../../formats/bitplane-and-palette/)
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
[Interleaved (interleave=2)](../../formats/bitplane-and-palette/) pixel formula
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
  total, see [Sprite Galleries](../../phantasieiii/sprites/)) — matches its
  assigned "hero/soldier bank" role (bank index 0).
- `giant1.cmp` → two grey-blue serpent/dragon sprites and two green
  ogre/giant sprites, tiled at 80×72 spacing.
- `anatomy1.csh`/`dng.csh`/`scroll.csh` → small icon sprites scattered
  across an otherwise black canvas — consistent with `.CSH` being an icon
  sheet, using only a small corner of the fixed 320×200 canvas.

### The header palette is not always the palette

A `.cmp`'s 32-byte header palette is a real field, but for the sprite banks
it is **not** what the game displays. `PhantasieIII`'s loader reads every
`.cmp` header palette into one shared global (`loadCmp`, file offset
`0x1264`, destination `DATA+0x2AEE`), and the caller decides what to do with
it. `loadBanks()` (`0x7F64`) copies that scratch into a per-bank slot for
banks 0, 1 and 2 only — and of those three slots, **only slot 0
(`heros.cmp`, `DATA+0x2BCE`) is ever installed**, by the encounter-screen
redraw at `0x19936`. Slots 1 and 2 have exactly one reference each in the
whole executable: their own store. Banks 3-6 (`purple2`, `yellow2`,
`giant1`, `giant2`) are not copied out at all — their palettes are
overwritten by the next bank's load.

So all seven banks render under `heros.cmp`'s palette. Decoding `giant1.cmp`
with its own header palette gives a purple dragon and a blue giant; the game
shows a grey-blue dragon and a green giant. Verified pixel-exact against an
independent third-party render: **0 mismatches across 384,000 pixels** for
the six non-`heros` banks, versus 36,487 under their own header palettes —
while the four `D/w*.cmp` scene files stay at 0 mismatches under *their* own
palettes, so the rule is bank-specific, not a global override.

A related correction applies to the colour ramp itself. The Amiga port
converts the ST palette word at runtime — `setPalette()` at file offset
`0x11D6` computes `(word & 0x0777) << 1` and hands the result to
`graphics.library/LoadRGB4` (its only caller anywhere in the binary; there
is no `SetRGB4` and no direct `$DFF180` write). Each 3-bit channel value
`n` therefore reaches the screen as `2n` out of 15, i.e. 8-bit `n × 34` —
not the Atari ST's own `n × 36.43` ramp. The brightest value is `0xEE`, not
`0xFF`.

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
without interpreting them. This project traced them to the code that
consumes them.

**Each map-cell byte is a tile index into a 250-entry bank of 16 × 16 ×
4bpp tiles**, and that bank *is* the 32,000-byte "picture" region —
250 × 128 = 32,000 exactly. Two routines settle it between them:

- The 9 × 9 viewport blitter at addr `0x9B82` computes `base + Y*50 + X`,
  fetches the byte, and pushes it **verbatim, with no transform of any
  kind**, to the tile blitter at addr `0x3834`.
- That tile blitter clamps the value to 250, multiplies it by 128
  (`asl.w #7`), adds the `.set` picture-buffer pointer the loader parked in
  `$290C`, and then runs 16 iterations of "four consecutive words → the
  four screen bitplanes, advance one scanline". A tile is 16 rows ×
  (plane0, plane1, plane2, plane3) words = 128 bytes — the standard Amiga
  interleaved-bitplane tile layout.

Rendering all 3,750 cells through the bank produces an 800 × 1200 image of
Phantasie III's world with real terrain art: ocean, forest canopy, mountain
ridges, desert, paved roads, rivers and bridges. Tiles `0` and `1` come out
as single flat colours, which is exactly why the game's terrain classifier
gives them their own two scalar `Water` tests ahead of its `2`-`25` band —
an independent confirmation that falls out of the decode for free.

> **A hypothesis this replaced.** An earlier pass, working before the
> consuming code had been found, concluded that the byte was an **X
> pixel-column index** into a 320 × 200 picture. That reading reproduced
> the continent silhouette convincingly — but only because both readings
> are monotone in the byte value: the on-disk order is tile-major, and the
> column-block remap above lays 12.5 consecutive tiles down each 16-pixel
> strip of the 320 × 200 view, so "pixel column *v*" and "tile *v*" land in
> neighbouring terrain regions for every *v*. A plausible picture is not the
> same as the right mechanism; the difference in practice is a flat colour
> per cell versus the actual artwork.

### The named locations

Thirty cells carry distinctive values (`25`-`52` and `54`) that occur in the
whole 3,750-cell array exactly once each — twice for value `50`, where two
inns share a graphic. Those are the **building facades** for Phantasie
III's towns, dungeon entrances and inns.

They are artwork, not a lookup key. The engine identifies every named place
through `LocateSpecial()` at addr `0x9C6A`, a flat if-chain of hardcoded
`(x, y)` comparisons against the party position, which never reads the map
array at all. Phantasie III has no `out*.dat`/`maps.int` equivalent — there
is no POI side table to decode, only coordinates compiled into the code.

Cross-checking the 30 recovered arms against the real file gives a perfect
bijection: every arm's cell carries a value that occurs in the map exactly
as many times as that value has arms. That is what binds each coordinate to
a concrete name — Pendragon, Sandy Shores, Flagler, the Mystic Inn, "A cave
smelling of sulphur", and the rest.

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
Tables](../../phantasieiii/data-tables/)) through a piecewise mapping:
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
playable races is now **located and confirmed** (a correction — three
earlier search approaches came back empty, see [Status & Open
Work](../../phantasieiii/status/) for why each was structurally blind to
it): 19 bytes at file `0x299D8`, found by disassembling the party-sprite
cell extractor at `0x1B2DA` directly. It is **not** an identity mapping —
6 of 18 races share a cell with another race — confirmed against 13
rendered `heros.cmp` cell crops, 13/13 matching. See [Data
Tables](../../phantasieiii/data-tables/) for the full table.

## The open bits

- `.SET`'s leading header byte (`0xFA` in `phantasy.set`) — meaning
  unknown; simple checksums were tested and ruled out.
- The exact picture row `.SET`'s map renderer samples — not determined, no
  consuming code located.

Full detail and the paths already tried: [Status & Open
Work](../../phantasieiii/status/).

See also [Data Tables](../../phantasieiii/data-tables/) for `monsinfo.dat`'s
`spriteIndex` field, and [Sprite Galleries](../../phantasieiii/sprites/) and
[Extracted Screens](../../phantasieiii/screens/) for the rendered output.
