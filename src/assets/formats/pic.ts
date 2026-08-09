/**
 * Raw uncompressed `.pic`/`.PIC` full-screen picture decoders — Phantasie I
 * (Amiga) at the top of this file, Phantasie II (Atari ST) in the
 * `decodeP2Pic`/`P2_PIC_*` section below.
 *
 * See docs/phantasie/graphics-formats.md §3: no header, no palette, no
 * compression — the entire file is raw pixel data in classic Amiga
 * contiguous-bitplane order (`bitplane.ts`'s 'planar' mode).
 *
 * **Palette, now confirmed for all six files** (graphics-formats.md §3,
 * data-tables.md §1.3a). The executable holds five 16-colour palettes and
 * picks one per screen via a shared `SetPalette()` helper at
 * `game+0x1F1CA`; `PIC_PALETTE_SLOT_BY_FILE` maps each `.pic` to the slot
 * its own display code selects. Every assignment was established two ways
 * that agree: byte-exact `HUNK_RELOC32` resolution of the `pea` operand at
 * the governing `SetPalette` call site, and a pixel-level render check
 * against all four candidate palettes.
 *
 * `logo.pic` sets no palette of its own — it is drawn as an image over the
 * town screen from the Info menu, so it inherits slot 1 in practice.
 *
 * `picGreyscalePalette()` is retained only as a diagnostic fallback for a
 * `.pic` not named in the map; it is no longer used by the pipeline for
 * any shipped file.
 */

import { decodeBitplaneIndices, bitplaneBufferSize, type BitplaneConfig } from './bitplane.ts';
import { indicesToRGBA, type RGB } from './palette.ts';

export interface PicImage {
  width: number;
  height: number;
  indices: Uint8Array;
}

/** The two confirmed `.pic` dimensions, keyed by file size (graphics-formats.md §3). */
const PIC_DIMENSIONS_BY_SIZE: Record<number, { width: number; height: number }> = {
  32000: { width: 320, height: 200 }, // cover1/cover2/decor/final/pelnor.pic
  7040: { width: 176, height: 80 }, // logo.pic
};

export function decodePic(data: Uint8Array): PicImage {
  const dims = PIC_DIMENSIONS_BY_SIZE[data.length];
  if (!dims) {
    throw new Error(
      `Unrecognised .pic file size: ${data.length} bytes (expected 32000 or 7040 — see graphics-formats.md §3)`,
    );
  }
  const config: BitplaneConfig = {
    width: dims.width,
    height: dims.height,
    bitplaneCount: 4,
    mode: 'planar',
  };
  // Structural cross-check: width/8 * height * bitplanes must reproduce the
  // exact file size (graphics-formats.md §3's independent confirmation).
  const expectedSize = bitplaneBufferSize(config);
  if (expectedSize !== data.length) {
    throw new Error(
      `Internal error: computed .pic buffer size ${expectedSize} != file size ${data.length}`,
    );
  }
  const indices = decodeBitplaneIndices(data, 0, config);
  return { width: dims.width, height: dims.height, indices };
}

/**
 * Neutral 16-level greyscale palette. Diagnostic fallback only — every
 * shipped `.pic` now has a confirmed in-game palette (see
 * `PIC_PALETTE_SLOT_BY_FILE`).
 */
export function picGreyscalePalette(): RGB[] {
  const colors: RGB[] = [];
  for (let i = 0; i < 16; i++) {
    const v = Math.round((i / 15) * 255);
    colors.push({ r: v, g: v, b: v });
  }
  return colors;
}

export function picToRGBA(image: PicImage, palette: RGB[] = picGreyscalePalette()): Uint8Array {
  return indicesToRGBA(image.indices, palette, false);
}

/**
 * `.pic` files (by base name, case-insensitive, no extension) confirmed to
 * use the P1 monster/race palette (`game+0x194BC`, slot 3) — kept as a
 * named subset for the existing regression test; `PIC_PALETTE_SLOT_BY_FILE`
 * is the complete mapping.
 */
export const PIC_FILES_USING_MONSTER_RACE_PALETTE: readonly string[] = ['decor', 'final'];

/**
 * Every `.pic` file's confirmed executable palette slot (index into
 * `exe-data.ts`'s `P1_PALETTE_SLOT_OFFSETS`). Keys are lower-case base
 * names without the extension.
 *
 * | File | Slot | Offset | Set at (file offset) |
 * |------|------|--------|----------------------|
 * | `cover1`, `cover2` | 4 | `game+0x194DC` | `0x1F0AA` — title sequence |
 * | `pelnor` | 1 | `game+0x1947C` | `0xA142` — `SelectTown()` |
 * | `logo` | 1 | `game+0x1947C` | inherited (no set of its own) |
 * | `decor`, `final` | 3 | `game+0x194BC` | `0xBFF8` — ending sequence |
 *
 * See graphics-formats.md §3 for the call-flow evidence per file.
 */
export const PIC_PALETTE_SLOT_BY_FILE: Readonly<Record<string, number>> = {
  cover1: 4,
  cover2: 4,
  pelnor: 1,
  logo: 1,
  decor: 3,
  final: 3,
};

// ---------------------------------------------------------------------------
// Phantasie II (Atari ST) `.PIC` full-screen pictures — graphics-formats.md
// §10. Same raw-uncompressed-no-header convention as P1's `.pic`, but ST
// word-Interleaved-by-2 plane layout (`bitplane.ts`'s 'interleaved' mode —
// the same convention P2's `.PAT` sprite banks already confirmed use),
// **not** P1's contiguous Planar layout, and a *per-file* palette rather
// than one shared executable table.
// ---------------------------------------------------------------------------

export interface P2PicDimensions {
  width: number;
  height: number;
  bitplaneCount: number;
}

/**
 * The five confirmed `.PIC` shapes, keyed by file size — graphics-formats.md
 * §10. `cover1`/`pelnor` fill the whole 320x200x4bpp ST low-res screen;
 * `cover2`/`decor`/`final2` are shorter (a partial-screen overlay/picture —
 * confirmed via disassembly for `cover2`, which is blitted to
 * `Physbase()+0x28A0` = row 65 of the screen, exactly matching its own
 * 135-row height: `65+135=200`); `crowd` is additionally reduced to 3
 * bitplanes (8 colours) and is loaded to a separate buffer rather than
 * directly into the screen, per graphics-formats.md §10's note.
 */
const P2_PIC_DIMENSIONS_BY_SIZE: Record<number, P2PicDimensions> = {
  32000: { width: 320, height: 200, bitplaneCount: 4 }, // COVER1.PIC, PELNOR.PIC
  21600: { width: 320, height: 135, bitplaneCount: 4 }, // COVER2.PIC
  24800: { width: 320, height: 155, bitplaneCount: 4 }, // DECOR.PIC
  25600: { width: 320, height: 160, bitplaneCount: 4 }, // FINAL2.PIC
  11160: { width: 320, height: 93, bitplaneCount: 3 }, // CROWD.PIC
};

export function decodeP2Pic(data: Uint8Array): PicImage {
  const dims = P2_PIC_DIMENSIONS_BY_SIZE[data.length];
  if (!dims) {
    throw new Error(
      `Unrecognised P2 .PIC file size: ${data.length} bytes (expected one of ${Object.keys(P2_PIC_DIMENSIONS_BY_SIZE).join(', ')} — see graphics-formats.md §10)`,
    );
  }
  const config: BitplaneConfig = {
    width: dims.width,
    height: dims.height,
    bitplaneCount: dims.bitplaneCount,
    mode: 'interleaved',
    interleave: 2,
  };
  // Same structural cross-check as P1's decodePic.
  const expectedSize = bitplaneBufferSize(config);
  if (expectedSize !== data.length) {
    throw new Error(
      `Internal error: computed P2 .PIC buffer size ${expectedSize} != file size ${data.length}`,
    );
  }
  const indices = decodeBitplaneIndices(data, 0, config);
  return { width: dims.width, height: dims.height, indices };
}

/**
 * Which of P2's three confirmed palette sources (graphics-formats.md §10)
 * a given `.PIC` file (lower-case base name, no extension) uses:
 *
 * - `'cover'` — `START.PRG`'s title palette (`readP2CoverPalette`),
 *   confirmed via the `Setpalette` call at `START.PRG` file offset `0x94`.
 * - `'town'` — `PHANT.PRG`'s town palette (`readP2TownPalette`), confirmed
 *   via the `Setpalette` call at `PHANT.PRG` file offset `0x2d44`, in the
 *   town-entry function called just before `pelnor.pic` is loaded.
 * - `'monsterRace'` — `PHANT.PRG`'s existing monster/race palette
 *   (`readP2Palette`), confirmed via the `Setpalette` call at `PHANT.PRG`
 *   file offset `0x12d5a`, inside the same function that loads
 *   `decor.pic`; `final2.pic` and `crowd.pic` are loaded immediately
 *   afterward in the same "ending sequence" with no intervening
 *   `Setpalette` call, so they inherit it (weaker confidence for `crowd`,
 *   which is loaded to an auxiliary buffer rather than the screen — see
 *   graphics-formats.md §10).
 */
export type P2PicPaletteSource = 'cover' | 'town' | 'monsterRace';

export const P2_PIC_PALETTE_SOURCE_BY_FILE: Readonly<Record<string, P2PicPaletteSource>> = {
  cover1: 'cover',
  cover2: 'cover',
  pelnor: 'town',
  decor: 'monsterRace',
  final2: 'monsterRace',
  crowd: 'monsterRace',
};
