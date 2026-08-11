# Phantasie Graphics Formats

This document describes every image/sprite container format found in the
Phantasie I (Amiga), Phantasie II (Atari ST), and Phantasie III (Amiga)
data files: the raw uncompressed full-screen picture formats (P1 and P2,
each a different plane layout), the RLE-compressed `.CMP`/`.CSH` bitmap
format, the `.SET` world-map-plus-tileset container, the shared palette
encoding, and the sprite-bank addressing conventions used to carve
individual monster/race sprites out of these containers.

Source of ground truth: a third-party reverse-engineering tool's C# source
(`Cmp.cs`, `Set.cs`, `Sprite.cs`, `Palette.cs`, `Bank.cs`, `BanksManager.cs`,
`BytesArray.cs`, plus the `*ManagerP1`/`*ManagerP2`/`*ManagerP3` and
`Monster.cs`/`Race.cs` classes that drive them) was read to recover the
algorithms, then every offset, formula, and decoded pixel/text result below
was independently re-derived from scratch and checked against this
project's own `data/phantasie/amiga/` and `data/phantasieiii/amiga/` files.
No code from that tool is reproduced here — only the structure it revealed,
described in prose, tables, and pseudocode. **§10 (P2's `.PIC` format) is
the one exception** — the reference tool has no P2 `.PIC` support at all
(it was never even attempted before this project's own pass), so every
finding there comes from this project's own `START.PRG`/`PHANT.PRG`
disassembly, with no reference-tool starting point.

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
cyan, light blue, blue, red, grey, magenta, white).

> **Correction (2026-08-09, re-codebreaker):** applying the `AmigaToST`
> even-nibble lookup to **P1's Amiga executable palettes is wrong**, even
> though it very nearly works. `data/phantasie/amiga/game` is an AmigaOS
> HUNK executable and its palette words go straight into
> `graphics.library/LoadRGB4` (call site byte-confirmed —
> `data-tables.md` §1.3a), which honours all four bits per channel. The
> correct decode is `component * 17` on the raw nibble. Across P1's five
> palettes, 235 of 240 nibbles happen to be even (so the two decodes
> agree there) but 5 are the odd value `11` — `pal2[3]` `0x0EB0`,
> `pal2[4]` `0x008B`, `pal3[12]` `0x0EBB` (twice), `pal4[2]` `0x0EB0` —
> and the even-only lookup silently zeroes those channels. `AmigaToST`
> remains correct for the genuinely ST-sourced P2/P3 container palettes.

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
correctly. The palette comes from the `game` executable, resolved by
tracing the picture-loading code directly (not by analogy) — see below.

**`decor.pic` and `final.pic` — confirmed, byte-exact.** Both files are
opened by *one* function occupying `game` file offset `0xBA48`-`0xC370`
(a raw `HUNK_CODE` hunk — logical hunk index 32 of 240, via `amitools`'
`HunkReader`). Located by grepping the raw executable for the filename
strings (`strings -a -t x`), then resolving each string's real caller via
an exhaustive `HUNK_RELOC32` cross-reference scan (technique: for every
`HUNK_ABSRELOC32` block, the *currently stored* 4-byte value at each
listed slot is the target's own pre-relocation hunk-relative offset —
computing each `.pic` string's hunk-relative offset and searching every
reloc slot in the file for a match finds every real `PEA <string>`
call site, byte-exact, no disassembly needed for the search itself; see
`game-re-tooling/amiga.md`'s "Resolving a JSR/PEA/absolute-long operand's
real target hunk" section). Within that same function, exactly one call
to a small "copy palette + call `LoadRGB4`" helper (`game+0x1F1CA`,
identified by a distinctive byte-fingerprint search rather than trusting
IRA's own internal — non-file-offset — address numbering, see the caveat
below) is made, with the `PEA` operand immediately preceding it resolving
(via the same reloc32 technique) to `game+0x194BC` — **the already-confirmed
P1 monster/race palette** (`data-tables.md` §1.3). `decor.pic` and
`final.pic` are both shown during the game's ending sequence (their PEA'd
strings sit immediately next to a run of "WELL DONE, MY SMALL FRIENDS...
YOU HAVE REMOVED A GREAT EVIL FROM GELNOR..." victory-text strings in the
same data block) — reusing the monster/race palette for the ending
artwork, rather than a bespoke one, is a plausible authoring choice, and
the rendered result confirms it: `decor.pic` renders as a legible
throne-room scene (starry sky through arched windows, columns, torches,
knight figures) and `final.pic` as a wizard on a rocky mountain under a
blue sky — see `src/assets/formats/__tests__/pic.test.ts`'s
`PIC_FILES_USING_MONSTER_RACE_PALETTE` tests.

As a side effect, this trace also located the array of alternate
16-colour palettes surrounding `0x194BC`, each tied to a different game
screen/context. **The full array, the setter's pseudocode, and the
exhaustive per-screen call-site map are now in `data-tables.md` §1.3a**
— that is the single source of truth; the summary below is the
`.pic`-relevant slice only.

> **Correction (2026-08-09, re-codebreaker):** the earlier version of
> this section said the palette-set helper at `0x1F1CA` "has exactly 7
> callers in the whole binary (an exhaustive reloc32 scan), none of
> which are the `cover1.pic`/`cover2.pic`/`logo.pic` loading code."
> It has **10**. Three of them are intra-hunk `bsr`s, which a
> relocation-table scan is structurally incapable of seeing (a `bsr` is
> PC-relative and needs no relocation entry), and one of those three —
> at `game+0x1F0AA` — *is* the cover-picture code. Compounding this, the
> scanner used was built on `amitools`' `HunkReader`, whose `reloc`
> field is a `{target_hunk: [offsets]}` **dict**: hunk 77's single
> `HUNK_ABSRELOC32` block contains 57 groups but only 19 distinct target
> hunks (target hunk 236 alone appears in 27 separate groups), so each
> repeat silently overwrote the previous list. 203 of the binary's 6,389
> relocation entries (3.2%, across 15 hunks) were missing from that
> scan, including the `jsr _LoadRGB4` slot itself — which is why a
> whole-binary search for `_LoadRGB4` callers returned zero. Both the
> "hunk 77 has no callers" and the "no reloc caller reaches the cover
> code" negatives were artefacts of these two blind spots, not facts
> about the binary. See `game-re-tooling/amiga.md`.

> **Correction (2026-08-09, re-codebreaker):** the earlier claim that
> hunk 77 spans `game+0x1ED64`-`0x1F164` is wrong by `0x1000`. Its
> `HUNK_HEADER`-declared size is 1,280 **longwords** = 5,120 bytes, so
> it spans `0x1ED64`-`0x20164`. The palette-set helper at `0x1F1CA` is
> therefore *inside hunk 77*, not in a separate hunk — the whole
> "hunk 77 never calls the palette helper" premise came from this
> arithmetic slip.

> **Correction (2026-08-09, re-codebreaker):** `"FPelnor.pic"` at
> `game+0x4027` is not leaked linker/debug data and has no odd leading
> `F`. The real string is `"Pelnor.pic"` at `game+0x4028`, byte 0 of
> **DATA hunk 6** — a perfectly ordinary loaded string. The apparent
> `F` at `0x4027` is the low byte of that hunk's own `HUNK_DATA` size
> longword (`0x00000046` = 70 longwords = 280 bytes), i.e. a canonical
> header field misread as string content. It has exactly one reference
> in the binary: `pea` at `game+0x20FC` (hunk 5 `+0x90`), immediately
> before the `jsr` to `showPic` at `game+0x2102`.

**`cover1.pic` / `cover2.pic` — confirmed, byte-exact.** Both are shown
by one function at `game+0x1F042` (hunk 77 `+0x2DE`, called from hunk 2
`+0x38`, the main dispatcher), the title sequence:

```
init();                                   /* opens libraries/screen/window */
showPic("cover1.pic");                    /* game+0x1F050 */
Read("cover2.pic", tempBitMap.Planes[0], 32000, 0);
buf = AllocMem(3000); Read("tamb.dat", buf, 2850, 0);   /* title music */
SetPalette(pal4 /* game+0x194DC */);      /* pea game+0x1F0A6, bsr game+0x1F0AA */
drainIntuiMessages();
startMusic(buf);                          /* game+0x28CF8 */
showPic("cover2.pic");                    /* game+0x1F0C6 — already resident */
FreeMem(buf, 3000); SetPointer(...); initMenus();   /* game+0x20A80 = hunk 80 */
```

The `pea` operand at `game+0x1F0A6` resolves through hunk 77's own
`HUNK_RELOC32` list to hunk 69 `+0xB4` = `game+0x194DC`. This is the
only palette set anywhere in the sequence, and it precedes `cover2.pic`'s
blit while also being the first non-black palette after `init()`'s
`SetBlackPalette()`, so it governs both cover images.

**`pelnor.pic` — confirmed, byte-exact.** `showPic("Pelnor.pic")` at
`game+0x2102` (hunk 5 `+0x96`) is the town screen, entered from hunk 2
at `+0x5E` (first entry, argument `2`) and `+0x136` (re-entry, argument
`0`). **Both** paths reach `SelectTown(idx)` (hunk 29 `+0`,
`game+0xA10C`) before the blit, and `SelectTown`'s `pea` at
`game+0xA13C` resolves to hunk 69 `+0x54` = `game+0x1947C` (`pal1`):

- argument `0`: hunk 5 `+0x78` calls `SelectTown` directly;
- argument `≠0`: hunk 5 `+0x62` calls the town-init routine at hunk 5
  `+0xEA`, whose two exit branches both converge on `+0x20C`, which
  calls `+0x21E` (`EnterTownProper`), which calls `SelectTown` at
  `+0x232`. An earlier `SetPalette(pal4)` inside that init (via hunk 26
  `+0xC44`) is for the intervening new-game/load-game panel and is
  overridden by `SelectTown` before the picture is blitted.

**`logo.pic` — confirmed: it has no palette of its own.** `ShowLogo()`
at `game+0x21734` (hunk 80 `+0xCB4`) does
`AllocMem(0x1B80 = 7040)` → `Read("logo.pic", buf, 7040, 0)` → store
`buf` into image slot `hunk81+0x2C` → `drawImage(0x1B)` → `FreeMem`. It
contains no `SetPalette`/`LoadRGB4`/`SetRGB4` call, and its only two
callers are the Info-menu item handler at hunk 80 `+0x2B2`/`+0x2C2`,
reachable only while the town screen is up — so it renders under the
town's `pal1` (`game+0x1947C`). The yellow Andromeda star (colour index
4) is the discriminator: `pal1[4] = 0x0EE0` (yellow), `pal4[4] =
0x0C22` (dark red).

**How a `.pic` reaches the screen** (confirmed — `showPic(name)` at
`game+0x1F288`, hunk 77 `+0x524`; the shared path for `Pelnor.pic`,
`decor.pic`, `final.pic`, `cover1.pic`, `cover2.pic`):

```
if (strcmp(name, "cover2.pic") != 0)              /* already-resident check */
    Read(name, tempBitMap.Planes[0], 32000, 0);   /* ptr at hunk79+0x14 */
WaitTOF();
*(UWORD *)0xDFF096 = 0x0100;                      /* DMACON: bitplane DMA off */
BltBitMapRastPort(&tempBitMap /* hunk79+0xC */, 0, 0,
                  windowRastPort, 0, 0, 320, 200, 0xC0);
WaitTOF();
*(UWORD *)0xDFF096 = 0x8100;                      /* DMACON: bitplane DMA on  */
```

`hunk79+0x14` is `tempBitMap.Planes[0]` (offset 8 within the `BitMap`
struct at `hunk79+0xC`), which is why a single flat 32,000-byte `Read`
lands as four contiguous 8,000-byte planes — an independent, code-level
confirmation of the contiguous-plane layout above, on top of the size
arithmetic. `logo.pic` does not go through `showPic` (different
dimensions; drawn as an image/shape instead).

> **A genuine addressing caveat, confirmed this pass:** IRA's own
> disassembly output (`;0xXXXX` address comments in its `.asm`) uses a
> **virtual, non-file-offset addressing scheme** for this binary. Its
> reported `_LoadRGB4`/`_SetRGB4` stub addresses (`0x28B6C`/`0x28C30`)
> are wrong as file offsets; the real ones are `game+0x2EC88` and
> `game+0x2ED4C`, and they are *named*, not guessed — this executable
> ships an intact `HUNK_SYMBOL` block for its `amiga.lib` stub hunks
> (94 symbols across hunks 227-237, covering `exec`, `dos`, `graphics`
> and `intuition` entry points). Read the symbol table first; it makes
> every library call site self-documenting. Every address in this
> section was independently derived from real file bytes
> (`HUNK_SYMBOL`, `HUNK_RELOC32`) rather than trusted from IRA's
> address comments — see `game-re-tooling/amiga.md`.

**Confidence: confirmed** — layout, dimensions, absence of an embedded
header/palette, **and the real in-game palette for all six files**. The
greyscale substitute is no longer needed anywhere in this format.

Palette assignment summary:

| File(s) | Palette | Offset | Set at |
|---------|---------|--------|--------|
| `cover1.pic`, `cover2.pic` | `pal4` | `game+0x194DC` | `game+0x1F0AA` (title sequence) |
| `pelnor.pic` | `pal1` | `game+0x1947C` | `game+0xA142` (`SelectTown`) |
| `logo.pic` | `pal1` (inherited, no set of its own) | `game+0x1947C` | — |
| `decor.pic`, `final.pic` | `pal3` | `game+0x194BC` | `game+0xBFF8` (ending sequence) |

Independent render check (second oracle, agreeing with the operand
resolution on every file): each `.pic` was rendered under all four
candidate palettes, and the assignments above are the only coherent
ones — the mismatches are gross, not marginal. `pelnor.pic` under
`pal1` gives a grey road (index 11 → `0x666`), green trees (index 6 →
`0x0E0`) and legible coloured `BANK`/`INN`/`ARMORY` signage; under
`pal4` those same two indices are `0x04E`/`0x048`, turning both the road
and the trees blue. `cover1.pic` and `cover2.pic` share one stone-arch
frame drawn from the same indices, and only `pal4` renders it as grey
stone with a red `SSI` logo and yellow Andromeda star.

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
| `0x0000` | 1 | Unused byte | `0xFA` (250) in `phantasy.set`. **Read and discarded by the game** — see §5.4 |
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

### 5.3 What the map array actually encodes — confirmed hypothesis

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

**Confirmed this pass (structural + rendered evidence, not code-traced —
no `.set`-consuming code was located in `PhantasieIII`): each map-cell
byte is an X pixel-column index (0-241, well within the picture's 0-319
width) into the accompanying picture.** Two independent lines of evidence:

1. **Frequency distribution reveals two populations, not a flat index
   space.** A handful of values dominate by area (`197`→1,063 cells,
   `0`→889, `227`→325, `1`→243, ... — 20 values already cover ~90% of the
   map) while a long tail is near-uniform-single-occurrence. Strikingly,
   values **24 through 49 — 26 consecutive integers — each occur in the
   map array *exactly once***, at scattered, non-adjacent `(x,y)`
   coordinates across the whole 50×75 grid (verified by locating every
   occurrence: e.g. value 24 at `(14,4)`, value 33 at `(44,66)`, value 47
   at `(24,20)` — no spatial clustering). This is the signature of one
   map cell per named location (town/dungeon/landmark) sharing an index
   space with bulk terrain, not a small closed "biome selector" set — a
   real RPG world map plausibly has on the order of two dozen named
   places.
2. **Rendering `picture[row][mapValue]` for any fixed row (tested at
   rows 20/50/100/150/180) reproduces the already-confirmed continent
   silhouette *and* adds geographically coherent detail that falls out of
   the raw bytes with no further interpretation:** value `227`
   (the second-most-common non-zero value) forms long, connected,
   winding lines through the landmass — a river network; value `0` forms
   a clean, closed border around the whole landmass — ocean; several
   other high-frequency values form blob-shaped regions — plausible
   forest/plains/hill terrain types. **Decisively**, values 24-49 (the
   26 single-occurrence "location" values identified above) land squarely
   within the picture's **city/castle-skyline column range** (the picture,
   left to right, is water / city-skyline / transition / snow-mountains /
   hill-terrain / forest / water / forest / water) — i.e. every named
   location on the map automatically gets a distinct "building facade"
   colour as its marker, purely as a side effect of the column-index
   scheme, with zero additional logic needed. This is not a coincidence a
   wrong hypothesis could produce by chance across two independently
   tested properties (frequency-distribution shape and picture-column
   semantics).

The exact row the real renderer samples was **not** determined (no
`.set`-consuming code was found in `PhantasieIII`'s disassembly — see the
"Confirmed byte, semantics" note above; the searched call site near the
file's one `"Graphics/Phantasy.set"` string reference is a general
resource-init routine, not the map-render code specifically). This does
not weaken the column-index confirmation: the rendered result is
essentially identical in *shape* and *feature type* (rivers/forest/ocean/
towns) at every row tested, differing only in the specific texture/shade
sampled — which is exactly what "one terrain type per column, texture
varies down the column" predicts. Implemented as
`terrainColumnForMapValue`/`terrainPixelIndexForMapValue` in
`src/assets/formats/set.ts`.

This reclassifies `.SET` from "sprite sheet" (its file extension's naming
pattern by association with `.CSH` might suggest) to "world map
container" — a correction to the task brief's working assumption, not to
any earlier version of this document.

> **Correction (2026-08-11) — the `.set`-consuming code has now been found,
> and the single-occurrence-values claim needs two fixes.** See
> `dungeon-format.md` §9.0.5 for the full evidence.
>
> 1. **The column-index reading is now confirmed at code level**, not just
>    structurally. The paragraph above says "no `.set`-consuming code was
>    found in `PhantasieIII`'s disassembly". It exists: the 9 × 9 viewport
>    blitter at hunk-0 addr `0x9B82` computes `base + Y*50 + X`
>    (`muls.w $2808.l` at addr `0x9BAA` — one of only **two** such
>    instructions in the entire 137,352-byte CODE hunk), fetches the byte
>    at addr `0x9C1C`, and pushes it **verbatim, with no transform of any
>    kind**, as the argument to the tile blitter at addr `0x3834`. The
>    exact picture row it samples is still not pinned down, so
>    `terrainPixelIndexForMapValue`'s row parameter remains a rendering
>    choice.
> 2. **The value range is `25`-`52` plus `54`, not `24`-`49`**, and it is
>    30 map cells, not 26 — value `50` legitimately occurs **twice** (two
>    inns share one graphic), `24` is an ordinary Water-band cell with no
>    location attached, and `53` never occurs in the map at all.
> 3. **The mechanism is refuted even though the correlation is real.**
>    "Every named location on the map gets a distinct marker value" is
>    true, and each of the 30 cells is now bound to a concrete name
>    (Pendragon, Sandy Shores, … , The Deadly Inn — full table in
>    `dungeon-format.md` §9.0.5.5). But the engine does **not** read the
>    tile value to know what is there: it identifies every named place by a
>    chain of hardcoded `(x, y)` comparisons at hunk-0 addr `0x9C6A`, which
>    never touches the map array at all. The marker values are the artwork,
>    not the lookup key. A separate terrain classifier at addr `0xA4A6`
>    does branch on the map byte, but only into terrain-look bands
>    (`0`/`1`/`2`-`25`/`61`-`67`/`68`-`74`/`90`-`114`/…); the only compare
>    immediate it has anywhere in the `24`-`49` window is the `25` that
>    closes the Water band.
>
> Practical consequence for this pipeline: the 30 marker values **can** be
> used to place named-location pins on a rendered world map, and the names
> are now known — but they must be treated as a rendering convenience
> derived from `dungeon-format.md` §9.0.5.5's table, not as a decoded
> engine mechanism.

### 5.4 The `.SET` reader — located; the leading byte is read and discarded

The `.set` **loader** — distinct from the map *renderer* found separately
(§5.3's 2026-08-11 correction, `dungeon-format.md` §9.0.5) — is at
**file offset `0x2800`** (hunk 0, addr `0x27D8`). It was reached from the
one `"Graphics/Phantasy.set"` string (file `0x7df1`) by the PC-relative
`PEA d16(PC)` xref scan (`game-re-tooling/amiga.md`): exactly one hit, at
file `0x7576`, whose enclosing call is `jsr $27d8.l` →
`0x27d8 + 0x28 = 0x2800`.

The routine is a straight sequence of AmigaOS `Read()` calls and confirms
§5.1's layout field by field, from code rather than byte accounting:

```
LoadSet(char *name /* +8(a5) */, void *mapBuf /* +0xC(a5) */)
  0x280c:  fh = Open(name, MODE_OLDFILE)              ; 0x3ED
  0x281c:  if (!fh) goto fail
  0x282c:  Read(fh, &leadingByte, 1)                  ; -> -$9(a5)
  0x2842:  Read(fh, &height,      1)                  ; -> -$B(a5)
  0x2858:  Read(fh, &width,       1)                  ; -> -$A(a5)
  0x2870:  Read(fh, $2AEE, 0x20)                      ; 32-byte ST palette
  0x2894:  Read(fh, mapBuf, height * width)           ; muls.w at 0x2886
  0x28ac:  Read(fh, *(void **)$290C, 0x7D00)          ; 32,000-byte picture
  0x28ba:  Close(fh)
  0x28c8:  $2806 = height ; $2808 = width             ; published as globals
```

**The leading byte is dead.** `-$9(a5)` is referenced exactly once in the
whole function — the `PEA -$9(a5)` at `0x2824` that hands `Read()` its
destination. It is never loaded, compared, stored to a global, or passed
anywhere; the function returns at `0x2904` without touching it again.
So whatever `0xFA` meant to whoever produced `phantasy.set` (an authoring
tool's version stamp, a field another platform's build consumed, a
sentinel), **the Amiga build ignores it entirely**, and no checksum or
version hypothesis can be tested against behaviour because there is no
behaviour to test. That closes the question as far as this executable can
answer it.

Two things this also settles for §5.1:

- The `0x7D00` (32,000) picture read and the `0x20` (32) palette read are
  **hardcoded constants in the reader**, not inferences from file size;
  only the map array's length is computed (`height × width`).
- The field order is confirmed as *(unused byte, **height**, **width**)* —
  the two dimension bytes are read into separate byte locals in that
  order and published to `$2806`/`$2808`, so `phantasy.set`'s `75`/`50` is
  height-then-width as documented, not the reverse.

**Confidence: confirmed** — code-traced, byte-verified.

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
P3 — see `data-tables.md` §3) through a piecewise mapping:
`spriteIndex` 0-14 → bank 2 cell `spriteIndex`; 15-26 → bank 1 cell
`spriteIndex-15`; 27 → bank 0 cell 10; 28-35 → bank 3 cell `spriteIndex-28`;
36-41 → bank 4 cell `spriteIndex-36`; 42-43 → bank 5 cell `spriteIndex-42`
(giant); 44-47 → bank 6 cell `spriteIndex-44` (giant). A monster is
rendered "giant" size (80×72 instead of 32×48) whenever `spriteIndex > 41`.
Race sprites (P3) always use bank 0 (the `heros.cmp` file) at 32×48, never
giant.

**Independently re-derived and byte-verified this session** via a direct
disassembly trace of `PhantasieIII` (not just cross-checked against real
data as before) — the piecewise dispatcher lives at real file offset
`0x1B4F0`-`0x1B6E2` (`PhantasieIII`'s single CODE hunk starts at file
offset `0x28`; the dispatcher's own hunk-relative range, as seen directly
in a flat disassembly of the extracted CODE hunk, is `0x1B4C8`-`0x1B6BA`).
Every threshold and bank assignment above matches the source-transcribed
table exactly: `CMPI.W` immediates `0x0F`(15)/`0x1C`(28)/`0x24`(36)/
`0x2A`(42)/`0x2C`(44) in that order, each followed by `MOVE.W #bankNum,
-0x8(A5)` setting bank `2`/`1`/`3`/`4`/`5`/`6` respectively, and a nested
`CMPI.W #0xC,-0x2(A5)` / `BNE` inside the bank-1 branch implementing the
`spriteIndex==27 → bank 0 cell 10` special case exactly as documented
(cell `12` in the *already-subtracted* local — `27-15`  — triggers it).

**Correction:** the previously-documented single-value patches
(`spriteIndex==48` → bank 0 cell 11 "elemental"; `spriteIndex==65` → bank
2 cell 0 "wild dog") **do not exist in the real function.** There is no
per-value check at all past 44-47: any `spriteIndex >= 48` is clamped to
exactly `48`, the monster's own in-memory record field (the same field
the `spriteIndex` was just read from) is overwritten with the constant
`14`, and the function returns *without* drawing anything on that call —
i.e. the real fallback is "re-resolve as `spriteIndex 14`" (bank 2 cell
14), not either of the two previously-documented special cases. Two real
monsters in the shipped `monsinfo.dat` hit this exact path: `Mud
Elemental` (`spriteIndex` byte value `48`) and `Wolf` (`spriteIndex` `65`
— not "Wild Dog", which itself has `spriteIndex 0`; the "wild dog" label
on the `==65` patch was a misidentification carried over from the
reference source). `resolveMonsterSpriteIndex()` in
`src/assets/formats/sprite-bank.ts` updated to match — see
`src/assets/formats/__tests__/sprite-bank.test.ts`.

The per-race `bankSpriteIndex` table this needs (analogous to the
per-monster `spriteIndex` field above) was searched for in the Amiga
`PhantasieIII` executable in the same session that located the P3 race
*name* table (`data-tables.md` §4.1) but was **not found** — see
`data-tables.md` §4.2 for the two search approaches tried. Race sprites
currently render using race index directly as the bank-0 cell index (an
unverified identity-mapping assumption), not a located table.

**Confidence: confirmed** for the grid math, file/bank assignment, and
now the `spriteIndex` piecewise mapping itself (directly re-derived from
`PhantasieIII` disassembly, byte-exact for the 0-47 range; the two
out-of-range special cases corrected as above) — e.g. `giant1.cmp`'s
decoded picture visibly contains exactly 2 rows of distinct sprite pairs
within the first 144 of its 200 canvas rows, matching `200/72 = 2` rows
fitting.

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
| `.pic` (P1) | confirmed | not embedded; real per-screen palette confirmed for all 6 files (§3, `data-tables.md` §1.3a) | confirmed legible + correct colours (title screen, town scene, ending art, credits panel) | **confirmed** |
| `.cmp`/`.csh` (P3) | confirmed | confirmed embedded, decoded correctly | confirmed legible + correct colours (title screen text, sprite grids) | **confirmed** |
| `.set` (P3) | confirmed (header/map/picture split, byte-exact) | confirmed (same ST encoding) | picture confirmed legible; map array's terrain-panel *semantics* unverified | **confirmed** (container layout); **hypothesis** (map cell meaning) |
| `.pat` sprite banks (P1) | confirmed, byte-exact | confirmed (via executable table, `data-tables.md` §1.3) | confirmed legible, name-matched sprites | **confirmed** |
| `.cmp` sprite-bank grid math (P3) | confirmed (structural) | n/a (inherits CMP palette) | confirmed visually consistent | **confirmed** (grid + `spriteIndex`→bank table, both byte-exact via disassembly) |
| `.pat` sprite banks (P2) | confirmed, ST word-interleaved (interleave=2) | confirmed (`PHANT.PRG` executable table, `data-tables.md` §2.3) | confirmed legible, name-matched sprites (skeleton, orc, cobra, human/dwarf/ogre race sprites) | **confirmed** |
| `.PIC` full-screen pictures (P2) | confirmed, ST word-interleaved (interleave=2), five distinct (width,height,bitplane) shapes (§10) | confirmed, three disassembly-traced `Setpalette` sources (§10) | confirmed legible + correct colours for 5/6 files (title, town, ending scenes); `crowd.pic` legible but palette source one inference step weaker | **confirmed** (5 files); **confirmed, palette one inference step weaker** (`crowd.pic`) |

## 9. Open questions

- **`.pic` real in-game palette — RESOLVED for all 6 files.**
  `decor.pic`/`final.pic` → `pal3` `game+0x194BC`;
  `cover1.pic`/`cover2.pic` → `pal4` `game+0x194DC`;
  `pelnor.pic` and (by inheritance) `logo.pic` → `pal1` `game+0x1947C`.
  Every assignment is byte-exact via `HUNK_RELOC32` operand resolution
  **and** independently confirmed by pixel-level render (§3). The two
  earlier `HUNK_RELOC32`-only searches came back empty for reasons that
  are now understood and documented as corrections in §3 (intra-hunk
  `bsr` call sites are invisible to a relocation scan; `amitools`'
  dict-shaped `reloc` field had silently dropped 203 of 6,389 entries;
  hunk 77's declared size was mis-converted from longwords to bytes).
  Closed — no `re-codebreaker` follow-up needed.
- **`.set` map-array terrain semantics — RESOLVED, confirmed hypothesis.**
  Each map-cell byte is an X pixel-column index into the accompanying
  picture (the picture is a strip of contiguous terrain-type bands, not a
  single scene) — confirmed via two independent lines of evidence (the
  value-frequency distribution's two populations, and the picture-sampled
  render reproducing the already-confirmed continent silhouette plus new
  geographically coherent detail with zero further interpretation). See
  §5.3. No C# reference exists for this — the reference tool skips these
  bytes entirely, so this was derived from scratch against real data. The
  exact row the real game samples from was not determined (no
  `.set`-consuming code was located in `PhantasieIII`'s disassembly).
- **`.set`'s leading unknown byte** (`0xFA` in `phantasy.set`) —
  **RESOLVED 2026-08-10: the byte is read into a stack local and never
  used.** The `.set` reader has now been located at file `0x2800` (see
  §5.4) via the PC-relative `PEA d16(PC)` xref from the
  `"Graphics/Phantasy.set"` string — the trace two earlier passes said
  they needed. It issues `Read(fh, &local, 1)` for this byte and then
  never references that local again anywhere in the function. It is
  therefore not a checksum, version or dimension field *as far as this
  executable is concerned*: no code path can observe it, so the earlier
  checksum tests were testing a hypothesis the binary could never have
  implemented. Whatever it meant to the authoring tool or another
  platform's build is not recoverable from the Amiga data set (only one
  `.set` file exists here). Closed.
- **P3 `.cmp` sprite-bank `spriteIndex` mapping table — RESOLVED,
  confirmed byte-exact, with one correction.** See §6: the piecewise
  thresholds and bank assignments for `spriteIndex` 0-47 are now
  independently re-derived from `PhantasieIII` disassembly
  (`game+0x1B4F0`-`0x1B6E2`) and match the source-transcribed table
  exactly. The two `==48`/`==65` single-value patches did **not**
  verify — real behavior is a generic out-of-range fallback (clamp to 48,
  self-correct to 14 in the monster struct), not per-value special cases.
  `src/assets/formats/sprite-bank.ts`'s `resolveMonsterSpriteIndex`
  updated to match.
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

## 10. Phantasie II raw full-screen pictures (`.PIC`, Atari ST)

Files: `COVER1.PIC`, `COVER2.PIC` (`data/phantasieii/atarist/extracted/disk1/`),
`PELNOR.PIC`, `DECOR.PIC`, `FINAL2.PIC`, `CROWD.PIC`
(`data/phantasieii/atarist/extracted/disk2/`). These six files were
extracted from the `.stx` floppy images (`stx-extraction.md`) but never
decoded until this pass — earlier sessions correctly confirmed P2's `.PAT`
sprite banks (§9) but explicitly left `.PIC` "never independently
confirmed" (`implementation-plan.md` Phase 7).

**Confidence: confirmed**, layout and dimensions for all six files;
palette confirmed via disassembly for five of six (`crowd.pic`'s palette
is inherited by absence-of-evidence rather than its own traced
`Setpalette` call — see the note at the end of this section).

### 10.1 Layout — same convention as `.PAT`, not P1's `.pic`

No header, no embedded palette, no compression — like P1's `.pic` (§3),
the entire file is raw pixel data with nothing before byte 0. But unlike
P1's `.pic`, the plane layout is the **ST word-interleaved-by-2**
convention (`bitplane.ts`'s `'interleaved'` mode, §1) — the same
convention already confirmed for P2's `.PAT` sprite banks (§9), not P1's
contiguous-bitplane `Planar` mode. Both candidate layouts were rendered
against the two 32,000-byte files (`COVER1.PIC`, `PELNOR.PIC`): `Planar`
produces vertical-striped noise; `Interleaved` produces an immediately
legible title screen and town scene respectively (greyscale renders were
checked first, before any palette work, per the project's verification
discipline).

| File | Size | Width × Height | Bitplanes | Notes |
|------|------|-----------------|-----------|-------|
| `COVER1.PIC`, `PELNOR.PIC` | 32,000 | 320 × 200 | 4 | Full ST low-res screen |
| `COVER2.PIC` | 21,600 | 320 × 135 | 4 | Overlay onto screen rows 65-199 (§10.2) |
| `DECOR.PIC` | 24,800 | 320 × 155 | 4 | Partial-height picture (top rows only) |
| `FINAL2.PIC` | 25,600 | 320 × 160 | 4 | Partial-height picture |
| `CROWD.PIC` | 11,160 | 320 × 93 | 3 | Loaded to an auxiliary buffer, not the screen (§10.4) |

`width/8 * height * bitplanes` reproduces the exact file size in every
case with zero remainder (e.g. `320/8*93*3 = 11160`), independent of
rendering — the same structural check §3 uses for P1's `.pic`.
`decodeP2Pic()` in `src/assets/formats/pic.ts` looks up these five shapes
by file size (unique per size, since no two shipped files share a size
with different shapes).

### 10.2 `COVER1.PIC` / `COVER2.PIC` — `START.PRG`'s title sequence

Neither file is referenced anywhere in `PHANT.PRG` (no `"COVER"` string of
any case exists in that 155,785-byte executable) — they are shown by the
much smaller `START.PRG` (2,567 bytes, a GEMDOS `.PRG`, magic `0x601A` at
file offset 0, 28-byte header, 286-byte text segment at file offset
`0x1C`-`0x13A`), which then `Pexec`s (GEMDOS function `0x4B`) `PHANT.PRG`
to hand off to the main game. Traced by disassembling the whole 286-byte
text segment (small enough to read in full) with Capstone:

```
d4 = Physbase()                                     ; XBIOS #2, text 0x48-0x50
Setpalette(0x176)                                    ; all-black, text 0x52 — hides load flicker
Getrez() != 0  -> error "Sorry! ... LOW resolution"  ; XBIOS #4, text 0x36
Fopen("cover1.pic"); Fread(d4, 0x7D00); Fclose()      ; text 0x74, generic loader at text 0xBE
Setpalette(0x156)                                    ; text 0x78 — the REAL palette (§10.2a)
d4 += 0x28A0                                          ; text 0x9C
Fopen("cover2.pic"); Fread(d4, 0x7D00); Fclose()      ; text 0xA2, same loader
```

Every string/constant operand was independently resolved: `"cover1.pic"`
sits at file offset `0x1BB` (text address `0x1BB-0x1C=0x19F`, matching the
literal `move.l #$19f,d0` immediately before the first load call);
`"cover2.pic"` at file offset `0x1C5` (text address `0x1A9`, matching
`move.l #$1a9,d0`); `"phant.prg"` at file offset `0x1B2`, consumed by the
trailing `Pexec` call (not shown above).

The generic loader at text `0xBE` (file `0xDA`) always requests
`0x7D00 = 32,000` bytes regardless of the target file's real size — a
short `Fread` for `cover2.pic` (21,600 real bytes) simply stops early,
which is exactly why `COVER2.PIC`'s own file size (320×135×4bpp = 21,600)
matches the *portion of the buffer it actually overwrites*, not the
buffer's full extent.

**`d4 += 0x28A0` (10,400 bytes) before the `cover2.pic` load is the
independent, code-level confirmation of `COVER2.PIC`'s dimensions.**
`0x28A0 / (40 bytes/row) = 65` — `cover2.pic` is blitted starting at
screen row 65, not row 0, leaving `cover1.pic`'s own rows 0-64 (its
"PHANTASIE II" logotype and the top of the stone archway) visible
above it. `cover2.pic`'s own height, `135`, exactly completes the
screen: `65 + 135 = 200`. This is a stronger, code-derived confirmation
than the byte-count factorisation alone (which has multiple candidate
`(width,height,bitplanes)` solutions — §10.5).

#### 10.2a The real title palette — `START.PRG` file offset `0x172`

`Setpalette` (XBIOS function 6, `trap #$E`) is called directly (no
wrapper) twice in `START.PRG`: once at text address `0x5C` (file `0x78`)
with operand `0x176` (file offset `0x192`) — 16 words, **all zero**,
confirmed by direct byte inspection — setting an all-black screen while
`cover1.pic` streams in from disk; and once at text address `0x82` (file
`0x9E`) with operand `0x156` (file offset `0x172`), immediately **after**
`cover1.pic` loads and **before** `cover2.pic` loads, so both files share
this one real palette (nothing resets it in between):

```
0x172: 0x0000 0x0521 0x0700 0x0444 0x0750 0x0770 0x0300 0x0400
       0x0501 0x0077 0x0555 0x0027 0x0111 0x0222 0x0333 0x0777
```

Both operand addresses were found two ways that agree: (1) a whole-file
byte scan for any 16 consecutive ST-shaped colour words (each nibble
`0-7`) with high value diversity, which flagged `0x172` as the strongest
candidate in the whole 2,567-byte file; (2) the literal `move.l
#$156,-(a7)` operand at text `0x78`, resolved to the same file offset —
independent confirmation, not a single search technique. Rendered under
this palette, `COVER1.PIC` is an immediately recognisable "PHANTASIE II"
title screen (blue logotype, red/pink curtain and archway, grey checkered
floor, a gold knight-helm centrepiece, red "SSI" logo); `COVER2.PIC`
reads "by WINSTON DOUGLAS WOOD / ATARI ST version 1.0 / by LDW" over the
same floor/archway backdrop — the game's Atari-ST-original credits
screen, shown as an animated overlay onto the bottom of the title image.
`readP2CoverPalette()` in `src/assets/formats/exe-data.ts`.

### 10.3 `PELNOR.PIC` — `PHANT.PRG`'s town palette

`PHANT.PRG` references `"PELNOR.PIC"` (uppercase, file offset `0x23af1`)
and `"pelnor.pic"` (lowercase, file offset `0x1fbc3`) once each. The
uppercase reference is only an existence check (`Fopen` immediately
followed by `Fclose`, function at text `0x13710`, file `0x1372C` — no
`Fread` in that function at all); the real load routine uses the
lowercase string, at text `0x43EE` (file `0x440A`, inside the function at
text `0x4382`/file `0x439E`): `Malloc(0x7D00)` (GEMDOS `0x48`), `Fopen`,
`Fread(buffer, 0x7D00)`, `Fclose`, then a `0x140×0xC8` (320×200) blit —
matching `PELNOR.PIC`'s confirmed full-screen dimensions.

**Palette**, traced by walking the caller chain into this function
(`0x4382` ← `0x4706` ← the town-entry loop at text `0xECB0`, which is
itself preceded by a call to the function at text `0x2D0E`, file
`0x2D2A`): that function's body opens with `Setpalette(0x23a62)`
(text `0x2D28`, file `0x2D44`), so this palette is set immediately before
`pelnor.pic` is ever displayed:

```
0x23a7e: 0x0000 0x0040 0x0650 0x0331 0x0030 0x0400 0x0310 0x0222
         0x0444 0x0333 0x0035 0x0257 0x0555 0x0600 0x0210 0x0777
```

Rendered, `PELNOR.PIC` is the town scene: blue sky, red-roofed
half-timbered buildings, a brown/red castle gate with a checkered grey
street, a green tree — directly comparable in composition to P1's own
`pelnor.pic` town screen (§3), now confirmed for P2 too.
`readP2TownPalette()` in `src/assets/formats/exe-data.ts`; the offset is
`P2_PIC_TOWN_PALETTE_OFFSET`, a genuinely different 16-word table from
the already-confirmed monster/race palette 32 bytes later at `0x23a9e`
(`P2_PALETTE_OFFSET`/`readP2Palette()`) — verified distinct byte-for-byte
in `exe-data.test.ts`.

### 10.4 `DECOR.PIC` / `FINAL2.PIC` / `CROWD.PIC` — the ending sequence, monster/race palette

All three strings (`"decor.pic"` × 2, `"final2.pic"` × 2, `"crowd.pic"`)
sit together in `PHANT.PRG`'s data segment (file offsets
`0x239a7`-`0x23a53`), and all three loads happen inside one contiguous
stretch of code (text `0x12BEA`-`0x1306A`, no intervening function
boundary through `decor.pic`'s load and its immediate follow-on text/UI
calls):

- `decor.pic`: `Logbase()` (XBIOS #3) into `d7`, then `Fread(d7, 0x7d00)`
  from `"decor.pic"` (file `0x239c3`) via a shared file-load helper at
  text `0x13526` (file `0x13542`) — the same generic loader pattern as
  P1's `showPic`. **`Setpalette(0x23a82)` (text `0x12d3e`, file `0x12d5a`)
  is called inside this same function, right after the load** — operand
  `0x23a82` resolves to file offset `0x23a9e`, **the already-confirmed
  monster/race palette** (`P2_PALETTE_OFFSET`/`readP2Palette()`,
  `data-tables.md` §2.3). Reusing the combat palette for the ending
  artwork mirrors P1's own `decor.pic`/`final.pic` (§3), which do the same
  thing with P1's monster/race table — a real, repeated authoring
  convention across both games, not a coincidence.
- `final2.pic`: loaded via the same `0x13526` helper (text `0x12fda`,
  file `0x12ff6`) shortly after `decor.pic`, still inside the ending
  sequence, with **no intervening `Setpalette` call** — it inherits the
  palette `decor.pic` just set.
- `crowd.pic`: loaded via the same helper (text `0x13020`, file
  `0x1303c`) immediately after `final2.pic`, also with no intervening
  `Setpalette` — but into a **fixed absolute buffer address `$24f34`**,
  not `Logbase()`. That address falls inside `PHANT.PRG`'s **BSS**
  segment (`0x2468C`-`0x28348`, computed from the `HUNK_HEADER`-style
  GEMDOS header's `data_len`/`bss_len` fields), i.e. uninitialised
  runtime memory with no static file content — confirming `crowd.pic` is
  *not* blitted straight to the screen the way the other five files are,
  but staged into a working buffer for some further compositing step this
  pass did not trace. The read length requested for `crowd.pic`,
  `0x2b98 = 11,160`, is also the **first and only file-exact (not the
  generic `0x7d00`) length** among all six files — a second, independent
  signal that `crowd.pic` is handled differently from the rest.

Rendered under the monster/race palette, `decor.pic` is a temple/throne
interior (columns, arched windows, torch-bearing guards on plinths) and
`final2.pic` a stone archway with waterfalls either side and a crowd of
tiny audience figures along the bottom — both immediately legible and
thematically consistent with an ending sequence. `crowd.pic`, decoded
flat as one 320×93×3bpp image, renders as four horizontal bands of small,
individually-coloured spectator figures with arms raised — legible as "a
crowd", though given §10.4's buffer-target finding, the real game may
compose it onto the screen in smaller pieces (e.g. as a scrolling/tiled
strip) rather than as one flat blit; this does not change the pixel
content, only how confident the layout-as-a-single-picture framing is.

**Confidence:** `decor.pic`/`final2.pic` — confirmed, direct
`Setpalette` xref. `crowd.pic` — confirmed layout (byte-exact,
file-length-matched read); palette confirmed by absence of any
intervening `Setpalette` call between it and `decor.pic`'s (one inference
step weaker than a direct xref, but no contradicting evidence found, and
the render is coherent and non-garish under this palette).

### 10.5 Why file size alone doesn't determine `(width, height, bitplanes)`

Unlike the two 32,000-byte files (where `320×200×4bpp` is the only
plausible ST low-res factorisation), `COVER2.PIC`/`DECOR.PIC`/
`FINAL2.PIC`/`CROWD.PIC`'s sizes each admit several candidate
`(width,height,bitplanes)` triples with `width` a multiple of 16 and
`height`/`bitplanes` in plausible ranges (e.g. `21,600` bytes factors as
`320×135×4`, `240×180×4`, `160×270×4`, and others). Every dimension in
§10.1's table beyond the two 32,000-byte files was cross-checked against
a **second, independent signal**, not size factorisation alone:

- `COVER2.PIC`: the `d4 += 0x28A0` buffer-offset arithmetic in `START.PRG`
  (§10.2) exactly matches `320×135×4bpp`'s byte count and no other
  candidate.
- `DECOR.PIC`/`FINAL2.PIC`: rendered at `320×N×4bpp` for every
  size-factorisation candidate `N`; only `320` width (matching every
  other confirmed P2/P1 full-screen picture) produced coherent art —
  narrower candidate widths (e.g. `240`, `160`) produced recognisable but
  visibly *tiled/repeated* content, the signature of a wrong stride
  rather than a genuinely narrower picture.
- `CROWD.PIC`: `320×93×3bpp` was the only candidate — at any width other
  than 320, or at 4bpp (which does not divide `11,160` evenly for
  `width=320`), the render was either structurally impossible (non-integer
  height) or produced the same repeated-tiling artefact as above. 3bpp
  (8 colours) is plausible for a smaller/simpler sub-picture — and is
  independently consistent with §10.4's finding that `crowd.pic` is
  handled differently (a staged buffer, not a direct screen blit) from
  every 4bpp full-screen file.

None of this changes the final confirmed table in §10.1 — it records the
verification path so a future pass doesn't have to re-walk the same
candidate space.
