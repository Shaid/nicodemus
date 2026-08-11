/**
 * Phantasie palette decoding — Atari ST 12-bit RGB444 words.
 *
 * See docs/phantasie/graphics-formats.md §2. Both the ST-native container
 * files (`.cmp`/`.csh`/`.set`) and the Phantasie I Amiga executable's
 * embedded palette table store colours as the same 16-bit word (bits 15-12
 * unused, 11-8 = red nibble, 7-4 = green nibble, 3-0 = blue nibble), but
 * decode that word through two different final-value lookup tables.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * ST 3-bit-per-channel -> 8-bit channel lookup: a linear 0-7 -> 0-255 ramp
 * (step ~= 36.4), exposing the Atari ST's native 3-bit hardware palette as
 * 8-bit colour. Indexed by `nibble & 7`.
 */
export const ST_CHANNEL_LOOKUP: readonly number[] = [
  0x00, 0x24, 0x49, 0x6d, 0x92, 0xb6, 0xdb, 0xff,
];

/**
 * The Amiga port's 16-entry variant (`AmigaToST`): only even indices are
 * populated, since the ST->Amiga port doubled each 3-bit ST value into the
 * low bits of Amiga's native 4-bit-per-channel OCS palette registers. Odd
 * indices intentionally resolve to 0 — this reproduces the confirmed index
 * 12 anomaly in data-tables.md §1.3 (odd green/blue nibbles decoding to 0)
 * rather than "fixing" it; that anomaly is documented as an open question,
 * not a bug in this lookup table.
 */
export const AMIGA_TO_ST_CHANNEL_LOOKUP: readonly number[] = [
  0x00, 0x00, 0x24, 0x00, 0x49, 0x00, 0x6d, 0x00, 0x92, 0x00, 0xb6, 0x00, 0xdb, 0x00, 0xff, 0x00,
];

/**
 * Native Amiga OCS 4-bit-per-channel -> 8-bit: `component * 17`
 * (equivalently `n << 4 | n`), the exact 0-15 -> 0-255 mapping.
 *
 * This — not `AMIGA_TO_ST_CHANNEL_LOOKUP` — is the correct decode for the
 * palettes embedded in `data/phantasie/amiga/game`, whose words are handed
 * verbatim to `graphics.library/LoadRGB4` (call site byte-confirmed at
 * `game+0x1F218`; see data-tables.md §1.3a). `LoadRGB4` honours all four
 * bits per channel, so every nibble value 0-15 is legal and the even-only
 * ST doubling table silently zeroes the odd ones — which really happens in
 * 5 of the 240 nibbles across P1's five palettes (the value 11), including
 * `pal4[2]`/`pal2[3]` `0x0EB0`, where the even-only lookup turns a
 * yellow-orange into pure red. See data-tables.md §1.3's correction block.
 */
export const AMIGA_OCS_CHANNEL_LOOKUP: readonly number[] = [
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
];

/**
 * Phantasie III (Amiga) container palettes: the ST 3-bit word is **doubled
 * into an Amiga OCS 4-bit register at runtime**, then handed to
 * `graphics.library/LoadRGB4`.
 *
 * Ground truth is `setPalette()` in `data/phantasieiii/amiga/PhantasieIII`,
 * file offset `0x11D6` (single CODE hunk starts at file offset `0x28`, so
 * hunk-relative `0x11AE`):
 *
 * ```
 * for (i = 0; i < 16; i++) tmp[i] = (pal[i] & 0x0777) << 1;   // 0x11DE-0x1210
 * LoadRGB4(viewPort, tmp, 16);                                // 0x1222
 * ```
 *
 * `LoadRGB4` is called from exactly **one** site in the whole executable
 * (`PhantasieIII+0x1224`), and there is no `SetRGB4` call and no direct
 * `$DFF180` colour-register write anywhere — so this is the only path a
 * colour ever reaches the screen. Each 3-bit channel value `n` therefore
 * lands in the OCS register as `2n`, i.e. 8-bit `2n * 17 = 34n` — **not**
 * the Atari ST's own `n * 36.43` ramp (`ST_CHANNEL_LOOKUP`). The difference
 * is small but real: the brightest value `7` displays as `0xEE` (238) on
 * the Amiga, not `0xFF`.
 *
 * The `& 0x0777` mask is lossless on the shipped data: all 288 palette
 * words across the 18 embedded P3 palettes (13 `Graphics/*.cmp`/`*.csh`,
 * `phantasy.set`, `D/w0`-`w4.cmp`) have a zero high nibble and all three
 * channel nibbles in 0-7 — zero deviations.
 *
 * See graphics-formats.md §2's 2026-08-11 correction block.
 */
export const AMIGA_FROM_ST_CHANNEL_LOOKUP: readonly number[] = [
  0x00, 0x22, 0x44, 0x66, 0x88, 0xaa, 0xcc, 0xee,
];

export type PaletteVariant = 'st' | 'amigaToSt' | 'amiga' | 'amigaFromSt';

/** Decode one 16-bit ST-style RGB444 word into an 8-bit RGB triple. */
export function decodeColorWord(word: number, variant: PaletteVariant): RGB {
  const r = (word >> 8) & 0xf;
  const g = (word >> 4) & 0xf;
  const b = word & 0xf;
  if (variant === 'st') {
    return {
      r: ST_CHANNEL_LOOKUP[r & 7],
      g: ST_CHANNEL_LOOKUP[g & 7],
      b: ST_CHANNEL_LOOKUP[b & 7],
    };
  }
  if (variant === 'amigaFromSt') {
    return {
      r: AMIGA_FROM_ST_CHANNEL_LOOKUP[r & 7],
      g: AMIGA_FROM_ST_CHANNEL_LOOKUP[g & 7],
      b: AMIGA_FROM_ST_CHANNEL_LOOKUP[b & 7],
    };
  }
  if (variant === 'amiga') {
    return {
      r: AMIGA_OCS_CHANNEL_LOOKUP[r],
      g: AMIGA_OCS_CHANNEL_LOOKUP[g],
      b: AMIGA_OCS_CHANNEL_LOOKUP[b],
    };
  }
  return {
    r: AMIGA_TO_ST_CHANNEL_LOOKUP[r],
    g: AMIGA_TO_ST_CHANNEL_LOOKUP[g],
    b: AMIGA_TO_ST_CHANNEL_LOOKUP[b],
  };
}

/** Decode a 16-colour (32-byte) palette table found at `offset` in `data`. */
export function decodePalette16(data: Uint8Array, offset: number, variant: PaletteVariant): RGB[] {
  const colors: RGB[] = [];
  for (let i = 0; i < 16; i++) {
    const word = (data[offset + i * 2] << 8) | data[offset + i * 2 + 1];
    colors.push(decodeColorWord(word, variant));
  }
  return colors;
}

/**
 * Render palette-index pixels to an RGBA buffer.
 *
 * `transparentIndexZero` punches index 0 through as alpha=0 — useful when
 * compositing a cropped sprite over something else. Defaults to false,
 * matching Phantasie's own confirmed behaviour for full-screen pictures
 * (`MasksEnum.Opaque` — index 0 paints as a real background colour, see
 * graphics-formats.md §1).
 */
export function indicesToRGBA(
  indices: Uint8Array,
  palette: RGB[],
  transparentIndexZero = false,
): Uint8Array {
  const rgba = new Uint8Array(indices.length * 4);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const c = palette[idx] ?? { r: 0, g: 0, b: 0 };
    rgba[i * 4] = c.r;
    rgba[i * 4 + 1] = c.g;
    rgba[i * 4 + 2] = c.b;
    rgba[i * 4 + 3] = transparentIndexZero && idx === 0 ? 0 : 255;
  }
  return rgba;
}
