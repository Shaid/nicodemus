# Phantasie Graphics Formats

This document describes every image/sprite container format found in the
Phantasie I (Amiga) and Phantasie III (Amiga) data files: the raw
uncompressed full-screen picture format, the RLE-compressed `.CMP`/`.CSH`
bitmap format, the `.SET` world-map-plus-tileset container, the shared
palette encoding, and the sprite-bank addressing conventions used to carve
individual monster/race sprites out of these containers.

Source of ground truth: a third-party reverse-engineering tool's C# source
(`Cmp.cs`, `Set.cs`, `Sprite.cs`, `Palette.cs`, `Bank.cs`, `BanksManager.cs`,
`BytesArray.cs`, plus the `*ManagerP1`/`*ManagerP2`/`*ManagerP3` and
`Monster.cs`/`Race.cs` classes that drive them) was read to recover the
algorithms, then every offset, formula, and decoded pixel/text result below
was independently re-derived from scratch and checked against this
project's own `data/phantasie/amiga/` and `data/phantasieiii/amiga/` files.
No code from that tool is reproduced here — only the structure it revealed,
described in prose, tables, and pseudocode.

## 1. Platform split: two families, one engine underneath

Phantasie's graphics fall into two families that share one generic
bitplane-assembly engine but differ in **plane layout convention**:

| Family | Files | Plane layout | Palette |
|--------|-------|---------------|---------|
| Amiga-native, raw | `*.pic` (P1), `mstr*.pat`/`party*.pat` (P1) | Classic contiguous Amiga bitplanes — plane 0 entirely, then plane 1, etc. (`Sprite.ModesEnum.Planar`, interleave value unused/0) | External (looked up in the executable), or none for the sprite banks |
| Atari-ST-native container, inherited by the Amiga P3 port | `*.cmp`, `*.csh`, `.set` (P3) | Word-interleaved-by-2 — bitplane bytes for a given 16-pixel column interleave every other word (`Sprite.ModesEnum.Interleaved`, interleave = 2) | Embedded in the file, ST 12-bit RGB444 word format (§2) |

**Confidence: confirmed.** Phantasie III was originally an Atari ST game;
its Amiga port carried the ST-style word-interleaved bitmap container and ST
palette encoding over unchanged (only the RLE compressor and file container
are ST/SSI conventions — nothing Amiga-specific was added). Phantasie I's
Amiga graphics, by contrast, use the platform-native contiguous-bitplane
layout throughout, with no embedded palette (the palette lives in the
executable — see `data-tables.md` §1). This split was confirmed by
independently rendering representative files from both families with both
candidate plane layouts and observing that only the layout listed above
produces a legible image (garbage/noise with the other) — see §3 and §4 for
the specific renders.

Both families are ultimately assembled by the same generic pixel-extraction
routine, parameterised by `(width, height, bitplane count, mode, interleave
size)`. `Sprite.ModesEnum` names four modes (`Chunky`, `Interleaved`,
`Scanline`, `Planar`); only `Interleaved` (ST container files) and `Planar`
(P1 raw `.pat`/`.pic`) are used anywhere in the Phantasie corpus examined
here.

Generic pixel formula (all modes reduce to this, just with different
`interleaveSize`/`scanlineStride`/`bitplaneStride`):

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

| Mode | `interleaveSize` | `scanlineStride` | `bitplaneStride` |
|------|-------------------|-------------------|-------------------|
| `Planar` (P1 raw) | `width/8` | `width/8` | `width*height/8` |
| `Interleaved` (ST container, interleave=2) | 2 | `width/8 * bp` | 2 |

Index 0 in every palette is treated as transparent/background by the
reference tool's mask logic (`WriteColor`, `MasksEnum`); Phantasie itself
always renders with `MasksEnum.Opaque` for full-screen pictures, so index 0
still paints black/background-colour rather than being punched through —
transparency only matters for sprite compositing, which the reference tool
implements but this pass did not need to re-derive (no compositing
requirement identified in the data files examined).

## 2. Palette encoding — Atari ST 12-bit RGB444

Both the ST-native container files and the P1 Amiga palette table (embedded
in the executable, see `data-tables.md` §1) store colours as this same
16-bit word, just interpreted through two different final-value lookup
tables:

| Bits | Field |
|------|-------|
| 15-12 | unused (always 0 in every sample observed) |
| 11-8 | Red nibble, 0-7 (ST) |
| 7-4 | Green nibble, 0-7 (ST) |
| 3-0 | Blue nibble, 0-7 (ST) |

The 3-bit-range nibble (0-7) is expanded to an 8-bit channel value via a
fixed 8-entry lookup table:

```
ST lookup: [0x00, 0x24, 0x49, 0x6D, 0x92, 0xB6, 0xDB, 0xFF]
```

i.e. channel byte = `lookup[nibble & 7]`. This is a linear 0-7 → 0-255 ramp
(step ≈ 36.4), standard for exposing an Atari ST's 3-bit-per-channel
hardware palette as 8-bit colour.

The Amiga executable palette table (P1) uses a **16-entry** variant of the
same lookup, `AmigaToST`, where only even indices are populated
(`[0x00,0x00, 0x24,0x00, 0x49,0x00, 0x6D,0x00, 0x92,0x00, 0xB6,0x00,
0xDB,0x00, 0xFF,0x00]`) — i.e. the same 16-bit word format is read, but the
nibble is expected to always be even (the Amiga port doubled the ST's 3-bit
values into the low bits of Amiga's native 4-bit-per-channel OCS palette
registers, a standard ST→Amiga colour-porting convention). Confirmed: the P1
palette at `game+0x194BC` decodes under this lookup to a fully plausible
16-colour palette (black, brown, red, orange, yellow, two greens, olive,
cyan, light blue, blue, red, grey, magenta, white) with all-but-one entry
using even nibbles (see `data-tables.md` §1.3 for the full table and the one
outlier).

**Confidence: confirmed** — every rendered image in §3/§4 below uses this
decoding and produces recognisable art with correct-looking colours (e.g.
`title.cmp`'s red/orange "PHANTASIE III" logotype, `heros.cmp`'s green/brown
soldier sprites).

## 3. Raw uncompressed picture format (`.pic`, Phantasie I Amiga)

Files: `cover1.pic`, `cover2.pic`, `decor.pic`, `final.pic`, `pelnor.pic`
(each exactly 32,000 bytes) and `logo.pic` (7,040 bytes).

No header, no palette, no compression — the entire file is raw pixel data
in classic Amiga contiguous-bitplane order: bitplane 0's full
`width/8 * height` bytes, immediately followed by bitplane 1's, then plane
2's, then plane 3's (`Sprite.ModesEnum.Planar`, see §1's formula).

| File(s) | Size | Width × Height | Bitplanes | Bytes/plane |
|---------|------|-----------------|-----------|--------------|
| `cover1.pic`, `cover2.pic`, `decor.pic`, `final.pic`, `pelnor.pic` | 32,000 | 320 × 200 | 4 | 8,000 |
| `logo.pic` | 7,040 | 176 × 80 | 4 | 1,760 |

`width/8 * height * bitplanes` reproduces the exact file size in every case
(`320/8*200*4 = 32000`; `176/8*80*4 = 7040`) — a clean structural
confirmation independent of rendering.

**Palette:** not embedded in these files. The task specification's original
guess that `.pic` might be an un-RLE'd variant of the CMP container (with
its 32-byte ST-palette prefix) was tested and **rejected**: decoding any
`.pic` file under the ST word-interleaved-by-2 convention (with or without
a 32-byte offset) produces only noise, while the plain contiguous-bitplane
convention with **no header at all** (data starts at byte 0) renders
correctly. The palette must come from elsewhere — most likely the game
executable, by analogy with the confirmed P1 monster/race palette at
`game+0x194BC` (see `data-tables.md` §1.3), though no direct code trace
was done to find a *screen*-picture-specific palette table; a neutral
16-level greyscale test palette was used for all renders below, sufficient
to confirm layout/legibility but not real in-game colour.

**Confidence: confirmed** (layout, dimensions, absence of header/palette).
**Not verified:** real in-game colours (greyscale substitute used).

Verification evidence — every file renders as fully legible, recognisable
game art under the contiguous-bitplane decode:

- `cover1.pic` → the Phantasie title screen (castle door, sword, "PHANTASIE"
  logotype, "COPYRIGHT STRATEGIC SIMULATIONS INC. 1982", "ANDROMEDA
  SOFTWARE").
- `decor.pic` → a temple/throne-room interior scene (columns, statues,
  torches).
- `final.pic` → a wizard figure atop a mountain.
- `pelnor.pic` → a town scene (bank, chapel, castle gate, half-timbered
  building) under an `Info / Town / Options` menu bar — this is the
  in-game town screen.
- `logo.pic` (176×80) → "Phantasie Version 1.0", the SSI logo, "ANDROMEDA
  SOFTWARE", "Copyright Strategic Simulations Inc. 1987", "K.Massa,
  Z.Horvath" — a splash/credits panel.

The same word-interleaved-by-2 decode attempted on any of these files
(the CMP/ST convention) produces only static/noise, confirming the two
plane conventions are genuinely different and file-family-specific, not
interchangeable.

## 4. Compressed bitmap format (`.CMP` / `.CSH`, Phantasie III)

Files: `Graphics/*.cmp` (heros, giant1, giant2, purple1, purple2, yellow1,
yellow2, title, dlgbttns) and `Graphics/*.csh` (anatomy1, anatomy2, dng,
scroll). **`.CSH` is byte-for-byte the same container format as `.CMP`** —
the reference tool's file-open dialog routes both extensions to the
identical parser class, distinguishing only `.SET` (§5) as a different
format. The extension is purely a content-classification convention used
by the original game/tools (`.CSH` files hold small UI icon sheets; `.CMP`
files hold full pictures or monster/race sprite banks — see §6), not a
different byte layout.

### 4.1 Header

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `0x0000` | 32 | ST palette | 16 × 16-bit words, see §2 |
| `0x0020` | 2 | Compressed data size | Big-endian word. **Counts from the type byte (`0x0022`) to the end of the RLE stream, inclusive of the type byte** — i.e. `RLE stream byte length = compressedDataSize − 1`. Confirmed exactly across 6 sample files (delta was always exactly −1, not approximately). |
| `0x0022` | 1 | Type | `1` = horizontal interleave submode, `2` = vertical interleave submode (§4.3) |
| `0x0023` | variable | RLE stream | Decompresses to exactly 32,000 bytes (320×200×4bpp) in every file tested |
| after RLE stream | 0-127 | Padding | Repeated single filler byte (not necessarily zero) up to the next 128-byte file-size boundary. Every `.cmp`/`.csh` file size observed is an exact multiple of 128. Not part of the image; safe to ignore. |

### 4.2 RLE algorithm

Applied independently to each of 4 "vertical strips" (`j = 0..3`), each
strip producing 8,000 of the 32,000 output bytes, decoded in strip order.
Pseudocode (byte-for-byte match with the reference decompressor, expressed
generically):

```
for j in 0..3:
    line = 0
    column = j * 2          # strip j starts at output column j*2
    written_this_strip = 0
    while written_this_strip < 8000:
        opcode = read_u8()
        if opcode == 0:
            runLength = read_u16_be()     # long literal/repeat run
            repeatByte = True
        elif opcode >= 0x80:
            runLength = -(opcode - 0xFF - 1)   # i.e. 256 - opcode
            repeatByte = True
        else:
            runLength = opcode
            repeatByte = False              # each of the runLength bytes is read individually

        firstByteOfRun = True
        value = 0
        for k in 0..runLength-1:
            if firstByteOfRun or not repeatByte:
                value = read_u8()
                firstByteOfRun = False
            output[line*160 + column] = value
            written_this_strip += 1
            advance (line, column) per submode (§4.3)
```

In plain terms: opcode `0x01..0x7F` means "read N distinct bytes, output
each once" (a literal run — a **copy**, not a repeat, despite the
"RLE"-shaped opcode space); opcode `0x00` means "read a 16-bit count, then
read **one** byte and repeat it that many times"; opcode `0x80..0xFF` means
"repeat the next single byte `256 - opcode` times" (a short repeat run,
2-128 bytes). This is a compact literal/repeat RLE scheme, not the more
common PackBits-style "positive=literal-run-of-N-distinct-bytes,
negative=repeat-next-byte" split by itself — the 0x00 opcode is a distinct
third case for **long** repeat runs (>128), which plain PackBits handles by
chaining multiple negative opcodes instead.

**Confidence: confirmed.** Verified structurally (every one of 6 sample
files decompresses to exactly 32,000 output bytes, matching 320×200×4bpp
with zero deviation) and visually (see §4.4 — legible, correctly-coloured
game art, including readable title-screen text).

### 4.3 Interleave submodes

The decompressed 32,000-byte buffer is written in one of two column-advance
patterns, selected by the type byte:

- **Type 2 (vertical, "not horizontal")** — after each output byte, advance
  `line`; on wrapping past line 200, reset `line=0` and advance `column`
  (skipping to the next even column + 6, per the `if (column % 2 == 0)
  column += 6` step — this implements the word-interleave-by-2 addressing
  from within the write pattern itself, rather than as a separate
  post-process).
- **Type 1 (horizontal)** — after each output byte, advance `column`
  directly (same even-column skip rule), never touching `line` until the
  8,000-byte strip is exhausted.

Both submodes write into the *same* 320×200×4bpp buffer, which is then
rendered using the standard §1 `Interleaved` (interleave=2) pixel formula
regardless of which submode produced it — the submode only changes the
*order* in which RLE-run bytes are assigned to buffer positions, not the
buffer's final byte layout or how it's read for display.

Observed in the corpus: `dlgbttns.cmp` uses type 1; every other sampled
file (`heros`, `giant1`, `giant2`, `purple1`, `purple2`, `yellow1`,
`yellow2`, `title`, `anatomy1`, `anatomy2`, `dng`, `scroll`) uses type 2.

### 4.4 Verification

All renders used the file's own embedded palette (§2) and the RLE
algorithm above, piped through the §1 `Interleaved` (interleave=2) pixel
formula. Results:

- `title.cmp` → the actual Phantasie III Amiga title screen: "PHANTASIE
  III / THE WRATH OF NIKADEMUS / BY WINSTON DOUGLAS WOOD / AMIGA VERSION BY
  WESTWOOD / © 1987 SSI", fully legible red/orange text on a decorative
  border, plus an archer illustration — colours and layout both correct.
- `heros.cmp` → a grid of ~15 humanoid sprites (soldiers/warriors in
  green/brown armour, some carrying shields/weapons) tiled in a regular
  32×48 grid — matches the "hero/soldier bank" role assigned to it by
  `BanksManager` (bank index 0, see §6).
- `giant1.cmp` → two purple serpent/dragon sprites and two blue ogre/giant
  sprites, tiled at 80×72 spacing — matches its "giant" bank role (uses the
  larger sprite cell size, see §6).
- `anatomy1.csh`, `dng.csh`, `scroll.csh` → small icon sprites (a handful
  of tiny UI glyphs, roughly 16×16-24×24px) scattered across an otherwise
  black 320×200 canvas near the top-left — consistent with `.CSH` being an
  icon sheet rather than a full picture, using only a small corner of the
  fixed 320×200 canvas.

Rendering the same files with the P1-style contiguous-bitplane convention
(§3) instead of word-interleave-by-2 was **not** separately re-tested for
CMP (the correct convention was already established from the CSH/CMP
render quality above and from Sprite.cs's own `CreateBitmap` call passing
`Interleaved`/interleave=2 explicitly for all `.cmp` decodes) — noted here
only as a path not separately re-walked, not a gap in the positive
evidence.

## 5. World map + tileset container (`.SET`, Phantasie III)

File: `Graphics/phantasy.set` (35,840 bytes). This is **not** a generic
sprite sheet — decoding it reveals it is Phantasie III's **overworld map**
bundled together with the terrain-art picture used to render it.

### 5.1 Header and layout

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `0x0000` | 1 | Unknown byte | `0xFA` (250) in `phantasy.set`; not consumed by anything else in the format — possibly a version/checksum byte |
| `0x0001` | 1 | Map height (tiles) | `75` |
| `0x0002` | 1 | Map width (tiles) | `50` |
| `0x0003` | 32 | ST palette | Same 16×16-bit-word encoding as §2 |
| `0x0023` | `width*height` = 3,750 | Map/terrain array | Row-major, `cell[x,y]` at `y*width+x`; one byte per overworld tile |
| `0x0023 + 3750` = `0x0EC1` | 32,000 | Picture data | Same 320×200×4bpp buffer format as CMP's decompressed output (word-interleave-by-2), **uncompressed** — written directly, no RLE stage |
| after picture data | ≤127 | Padding | Repeated filler byte to the next 128-byte boundary (file is `35840 = 128*280` bytes exactly) |

Total accounted for: `35 + 3750 + 32000 = 35785`; actual file size `35840`;
difference `55` bytes of trailing padding — consistent with the same
128-byte disk-block padding convention seen on every `.cmp`/`.csh` file.

**Confidence: confirmed** — every byte of the file is accounted for by this
layout with zero unexplained gap (35 header + 3750 map + 32000 picture +
55 padding = 35840, exact).

### 5.2 Picture-data byte traversal quirk

The reference decoder's byte-consumption order for the picture-data region
is an odd column-block traversal (`for column-block c in 0..19: for line
in 0..207: for x in 0..7: consume one byte`, breaking as soon as 32,000
bytes total have been consumed) rather than the CMP decoder's row/column
strip walk. Despite the different traversal, it deposits bytes into the
*same* 320×200×4bpp buffer layout (`buffer[c*8 + x + y*160]`, stride 160)
that the standard `Interleaved` pixel formula (§1) reads — the two
decoders are just two different ways of writing the identical target
buffer shape, one via RLE-run positions, the other via a raw linear copy
that happens to be organized in 8-byte-wide column blocks. This traversal
detail only matters if re-implementing the byte-consumption order exactly;
the resulting rendered image is unaffected.

### 5.3 What the map array actually encodes — hypothesis

The reference tool's `Set` class reads the map array's `width*height` bytes
purely to skip past them (`stream.Position = 1+1+1+32+width*height`) — it
never interprets their values. This project independently examined them:

- Value range: 0-241, 196 distinct values across the 3,750 cells.
- Rendering the array directly as a greyscale heightmap (byte value →
  brightness, nearest-neighbour scaled 4×) produces an unmistakable
  **continent silhouette** — a landmass outline with visible bays,
  peninsulas, and internal shading regions, not noise.
- The accompanying 320×200 picture data, when rendered, is **not** a
  small-tile grid — it shows a handful of large, distinct terrain/scenery
  panels side by side (a city/castle skyline on the left, a mountain range,
  a forest/plains strip, a swamp-like textured band on the right),
  consistent with a "biome selector" image rather than a conventional
  16×16 tile atlas.

**Hypothesis (not independently confirmed against any oracle):** the map
array is Phantasie III's world/region map, one byte per world cell, and
each byte's value selects a terrain/biome subregion of the picture panel
(or otherwise indexes a terrain-type table elsewhere, e.g. in the
executable) rather than addressing individual small tiles. The exact
byte→terrain-panel mapping formula was not derived. This reclassifies
`.SET` from "sprite sheet" (its file extension's naming pattern by
association with `.CSH` might suggest) to "world map container" — a
correction to the task brief's working assumption, not to any earlier
version of this document.

## 6. Sprite-bank grid extraction (Phantasie III `.CMP` monster/race banks)

Seven of the `.cmp` files are not single pictures but **grids of small
sprites** packed into the fixed 320×200 canvas, addressed by a bank
index/grid-cell scheme:

| Bank index | File | Cell size | Cells that fit (320/cellW × 200/cellH, integer) |
|------------|------|-----------|---------------------------------------------------|
| 0 | `heros.cmp` | 32×48 | 10 × 4 |
| 1 | `purple1.cmp` | 32×48 (80×72 if "giant") | 10 × 4 |
| 2 | `yellow1.cmp` | 32×48 | 10 × 4 |
| 3 | `purple2.cmp` | 32×48 | 10 × 4 |
| 4 | `yellow2.cmp` | 32×48 | 10 × 4 |
| 5 | `giant1.cmp` | 80×72 | 4 × 2 |
| 6 | `giant2.cmp` | 80×72 | 4 × 2 |

Extraction formula (per sprite index `i`, `isAttacking` flag folding into
the index):

```
index2 = i*2 + (isAttacking ? 1 : 0)
cellsPerRow = 320 / cellWidth
x = (index2 % cellsPerRow) * cellWidth
y = (index2 / cellsPerRow) * cellHeight      # integer division
sprite = crop(decodedBank, x, y, cellWidth, cellHeight)
```

i.e. each bank stores a monster's **normal** and **attacking** pose as
adjacent cells in the same grid (`index2` and `index2+1`), not as two
separate banks — `purple1.cmp`/`purple2.cmp` and `yellow1.cmp`/
`yellow2.cmp` being separate *files* is a capacity split (more monsters
than fit in one 320×200 canvas at 32×48), not a normal/attacking split.

**Which monster uses which bank/cell** is resolved by a per-monster
`spriteIndex` field read from the monster data table (`monsinfo.dat` in
P3 — see `data-tables.md` §3) through a hardcoded piecewise mapping:
`spriteIndex` 0-14 → bank 2 cell `spriteIndex`; 15-26 → bank 1 cell
`spriteIndex-15`; 27 → bank 0 cell 10; 28-35 → bank 3 cell `spriteIndex-28`;
36-41 → bank 4 cell `spriteIndex-36`; 42-43 → bank 5 cell `spriteIndex-42`
(giant); 44-47 → bank 6 cell `spriteIndex-44` (giant); with two explicit
single-value patches (`spriteIndex==48` → bank 0 cell 11, an "elemental"
special case; `spriteIndex==65` → bank 2 cell 0, a "wild dog" special
case). A monster is rendered "giant" size (80×72 instead of 32×48) whenever
`spriteIndex > 41`, except for the two patched values above. Race sprites
(P3) always use bank 0 (the `heros.cmp` file) at 32×48, never giant.

**Confidence: confirmed for the grid math and file/bank assignment**
(directly transcribed from source and structurally self-consistent: e.g.
`giant1.cmp`'s decoded picture visibly contains exactly 2 rows of distinct
sprite pairs within the first 144 of its 200 canvas rows, matching
`200/72 = 2` rows fitting). **Not independently re-derived**: the
`spriteIndex` piecewise bank-mapping table above and the giant/normal size
cutoff — these were read from source and are structurally plausible (bank
boundaries at 15, 27, 28, 36, 42, 44 match the cell counts each bank
declares) but not cross-checked against a second, independent source for
this pass.

## 7. Phantasie I raw sprite banks (`.pat`)

Files: `mstr1.pat`, `mstr2.pat` (68,016 bytes each — monster sprites,
normal/attacking pose) and `party1.pat`, `party2.pat` (8,192 bytes each —
player race sprites, normal/attacking pose).

No header, no embedded palette, no compression — pure concatenated
`Planar`-mode (§1) bitplane data (P1's Amiga-native raw convention, same as
`.pic`). Individual sprites are addressed by **byte offset tables stored in
the game executable** (`game`), not by any structure inside the `.pat`
files themselves:

- **`mstr1.pat`/`mstr2.pat`** (monster sprites): variable per-monster
  dimensions, read from two parallel 80-entry tables in `game` — a 4-byte
  big-endian longword sprite byte-offset at `game+0x16842 + index*4`, and a
  2×2-byte big-endian word width/height pair at `game+0x1EA8 + index*4`.
  `mstr1.pat` holds the "normal" pose, `mstr2.pat` the "attacking" pose, at
  the *same* offset for a given monster index (both files share one offset
  table).
- **`party1.pat`/`party2.pat`** (race sprites): fixed 32×32, 16 races, no
  table needed — sprite `index`'s byte offset is simply
  `index * 32*32/2` = `index * 512`.

**Confidence: confirmed, byte-exact.** Summing `width/8*height*4` (the
`Planar`-mode sprite byte size) for all 80 entries of the `mstr1.pat`
offset/dimension table reproduces the file's exact size with **zero**
discrepancy (`sum = 68,016` = `mstr1.pat`'s actual size), and the 80
computed offsets are perfectly contiguous in index order (`offset[i+1] ==
offset[i] + size[i]` holds for every `i`) — i.e. the table describes a
tightly-packed, non-overlapping, gapless sequence of sprites that exactly
fills the file. `party1.pat`'s size (8,192) is exactly `16 * 512`, matching
the fixed-size race-sprite formula with zero remainder.

Visual confirmation: monster index 0 (name "SKELETON", from the name table
— see `data-tables.md` §1.2) decodes to a clearly recognisable white
skeleton figure; monster index 8 (name "ORC") decodes to a red/brown
armoured warrior with a sword and a round shield — both rendered with the
confirmed P1 palette (§2) and the `Planar` pixel formula, both immediately
recognisable as the named creature.

## 8. Confidence summary

| Format | Layout | Palette | Rendered content | Confidence |
|--------|--------|---------|-------------------|------------|
| `.pic` (P1) | confirmed | not embedded, substitute greyscale used | confirmed legible (title screen, town scene, etc.) | **confirmed** (layout); **unverified** (real colours) |
| `.cmp`/`.csh` (P3) | confirmed | confirmed embedded, decoded correctly | confirmed legible + correct colours (title screen text, sprite grids) | **confirmed** |
| `.set` (P3) | confirmed (header/map/picture split, byte-exact) | confirmed (same ST encoding) | picture confirmed legible; map array's terrain-panel *semantics* unverified | **confirmed** (container layout); **hypothesis** (map cell meaning) |
| `.pat` sprite banks (P1) | confirmed, byte-exact | confirmed (via executable table, `data-tables.md` §1.3) | confirmed legible, name-matched sprites | **confirmed** |
| `.cmp` sprite-bank grid math (P3) | confirmed (structural) | n/a (inherits CMP palette) | confirmed visually consistent | **confirmed** (grid); **not independently re-derived** (spriteIndex→bank table) |
| `.pat` sprite banks (P2) | confirmed, ST word-interleaved (interleave=2) | confirmed (`PHANT.PRG` executable table, `data-tables.md` §2.3) | confirmed legible, name-matched sprites (skeleton, orc, cobra, human/dwarf/ogre race sprites) | **confirmed** |

## 9. Open questions

- **`.pic` real in-game palette.** Confirmed the raw pixel layout and
  dimensions; the actual colour values were not tracked down (no palette
  table specific to full-screen pictures was located in `game` — only the
  P1 monster/race palette at `game+0x194BC` was confirmed, and it's not
  obviously the same palette a title/town screen would use). Would need a
  disassembly trace of the screen-loading code in `game`/`run` to locate,
  or an emulator screenshot for a direct colour oracle.
- **`.set` map-array terrain semantics.** The byte→visual-terrain mapping
  (which of the picture's terrain panels a given map-cell value selects,
  and whether values 0-241 map onto sub-regions of a single decoded
  picture or index some other terrain-lookup table) is an open hypothesis,
  not a confirmed decode. No C# reference exists for this — the reference
  tool skips these bytes entirely.
- **`.set`'s leading unknown byte** (`0xFA` in `phantasy.set`) — meaning
  not identified; not consumed by the reference decoder.
- **P3 `.cmp` sprite-bank `spriteIndex` mapping table** (§6) — transcribed
  from source, structurally plausible, but not independently re-derived
  from the raw monster data or cross-checked against a second source.
- **Phantasie II (Atari ST) graphics — RESOLVED, confirmed.** `data/phantasieii/atarist/`'s
  two `.stx` Pasti floppy-disk images have been desectorized and their
  individual files extracted to `data/phantasieii/atarist/extracted/`; see
  `docs/phantasie/stx-extraction.md` for the extraction method. Both
  candidate plane layouts (P1's raw contiguous `Planar` convention and the
  ST `Interleaved`/interleave=2 convention used by P3's CMP container) were
  independently rendered against real extracted data using the confirmed
  P2 executable palette (`data-tables.md` §2.3) and read against the
  project's own real `PHANT.PRG` sprite offset/dimension tables (also newly
  confirmed, `data-tables.md` §2):

  | File | Index | Dims | `Planar` render | `Interleaved` render |
  |------|-------|------|-------------------|--------------------------|
  | `MSTR1.PAT` | 0 (SKELETON) | 32×34 | noise | clean skeleton figure, arms down |
  | `MSTR1.PAT` | 8 (ORC) | 32×32 | noise | clean red/brown warrior with sword+round shield |
  | `MSTR1.PAT` | 17 | 80×39 | noise | clean orange/red cobra/serpent |
  | `MSTR2.PAT` | 0 (SKELETON, attack pose) | 32×34 | noise | clean skeleton, arms raised (attacking) |
  | `PARTY1.PAT` | 0 (HUMAN) | 32×32 | noise | clean knight figure, sword+green shield |
  | `PARTY1.PAT` | 1 (DWARF) | 32×32 | noise | clean blue/gold armoured figure with axe |
  | `PARTY1.PAT` | 7 (OGRE) | 32×32 | noise | clean grey/tan figure with round shield |

  Every `Interleaved` render is immediately recognisable, legible sprite art
  matching the creature/race the index/name resolves to (per the newly
  confirmed name tables, `data-tables.md` §2); every `Planar` render of the
  same bytes is unstructured noise. **Confidence: confirmed** — both for
  `MSTR*.PAT` (as hypothesized) **and** for `PARTY*.PAT` (which the
  file-size-match with P1 had suggested, incorrectly, might keep P1's
  layout — see the correction below). The generic `Interleaved` pixel
  formula in §1 applies unchanged, using the P2 executable's own palette
  (`data-tables.md` §2.3) rather than P1's `game+0x194BC` table.

  > **Correction:** `stx-extraction.md` §7's file-size-match observation
  > (`PARTY1.PAT`/`PARTY2.PAT` being byte-exact size matches with P1's
  > `party1.pat`/`party2.pat`, unlike the larger `MSTR*.PAT`) was flagged
  > there as "consistent with... but not confirming" a per-file layout
  > split. The render evidence above shows this reasoning does not hold:
  > **all four P2 `.pat` files use the same ST word-interleaved layout**,
  > including `PARTY*.PAT` despite its coincidental size match with P1's
  > planar-layout files. Byte count alone cannot distinguish the two
  > layouts (both conventions store the same total
  > `width/8 * height * bitplanes` bytes per sprite, just arranged
  > differently) — this was a case of a plausible-looking but ultimately
  > unrelated coincidence, not a real correlation. Only a pixel-level
  > render, done here, resolves it.
