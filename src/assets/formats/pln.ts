/**
 * `D/PLN1`, `D/PLN2`, `D/PLN4` — Phantasie III's three non-overworld map
 * arrays: the Castle of Light, the Castle of Dark and the Netherworld.
 *
 * See docs/phantasie/dungeon-format.md §9.0.3.4 for the code-traced load
 * path (map-switch routine, hunk-0 addr `0x1EB1E`) and §9.0.3.4a for the
 * tile-bank proof this module comment summarises.
 *
 * **File layout.** Unlike `Graphics/phantasy.set` (`set.ts`), a `PLNn` file
 * carries *only* the map array — no header, no dimension bytes, no embedded
 * palette. It is exactly `width * height` content bytes, then 128-byte
 * disk-block padding filled with `contentLength mod 128`
 * (dungeon-format.md §9.0.3.1). The engine's own `Read()` length (`#$51` =
 * 81 for the castles, `#$1F0` = 496 for the Netherworld) and its
 * `$2808`/`$2806` width/max-Y pair both reproduce the padding-derived
 * content length and grid shape independently.
 *
 * **Tile bank — same one the overworld uses, confirmed byte-exact.** A cell
 * value here is a tile index into the *same* 250-entry bank
 * `Graphics/phantasy.set` bundles (`set.ts`'s `SetTileBank`), not a
 * separate castle/Netherworld art asset. This was the project's one
 * standing open question (`docs/phantasie/TODO.md`,
 * `world-p3-castle-netherworld-maps`) and it is now settled by exhaustive
 * disassembly:
 *
 * - The tile-bank pointer lives at hunk-1 `$290C`. A raw byte search for
 *   its absolute-long operand (`0000290C`) across the whole 137,352-byte
 *   CODE hunk finds exactly **5** references, and only **one** of them is a
 *   write: `move.l d0,$290c.l` at addr `0x7408`, part of a one-time
 *   boot-time buffer-allocation sequence (`jsr $5CC.l`, the bump allocator,
 *   with size `0x80E8` = 32,984 bytes) alongside every other fixed buffer
 *   the game ever uses (`$2948`, `$2960`, `$295C`, `$2964`, `$294C`). The
 *   other four references are reads: the two tile blitters (below) and
 *   `.set`'s own loader, which fills it with `Graphics/phantasy.set`'s
 *   32,000-byte picture region exactly once
 *   (`Read(fh, *(void **)$290C, 0x7D00)`, graphics-formats.md §5.4).
 *   `$290C` is therefore written **once, ever**, and always from
 *   `phantasy.set` — there is no code path that loads a second art bank for
 *   a castle or the Netherworld.
 * - The two routines that read tile art from `$290C` — `LoadTile` (addr
 *   `0x3834`, plain blit) and its masked-overlay sibling (addr `0x378A`,
 *   used for the party-marker cell) — each have **exactly one caller** in
 *   the whole binary, both inside the single 9x9 viewport blitter at addr
 *   `0x9B82`. That one blitter is reused unchanged for every active map
 *   (`$2908`/`$2806`/`$2808` are generic "active map" globals the
 *   map-switch routine repoints per map id); there is no second,
 *   castle-specific rendering routine anywhere in the binary.
 * - So: `$295C` (the buffer the castle/Netherworld loaders fill,
 *   `dungeon-format.md` §9.0.3.4) is a **different buffer for the raw grid
 *   bytes** than the overworld's own `$2964` — that part of the earlier
 *   "different buffer" phrasing was correct — but the **tile art** every
 *   grid's bytes are blitted through is the one shared bank at `$290C`,
 *   always `phantasy.set`'s. The TODO's "different buffer, so untested"
 *   framing conflated the map-cell buffer with the tile-art buffer; they
 *   are not the same thing, and only the latter matters for "same tile
 *   bank or not".
 *
 * This is also why the castle/Netherworld cell values are always in-bounds
 * for the shared 250-tile bank: the castles top out at `0x51` (81, well
 * under 250) and the Netherworld's border value `0xF9` (249) is the last
 * valid tile index, one under the blitter's own 250 clamp
 * (`setTileIndexForMapValue` in `set.ts` already handles it).
 */

export interface PlnGrid {
  width: number;
  height: number;
  /** Row-major, `cell[x,y]` at `y*width+x` — a tile index into the shared 250-tile bank (`set.ts`). */
  cells: Uint8Array;
}

/** Castle of Light / Castle of Dark engine read length `#$51` = 81 = 9 x 9. */
export const PLN_CASTLE_WIDTH = 9;
export const PLN_CASTLE_HEIGHT = 9;

/** The Netherworld engine read length `#$1F0` = 496 = 31 x 16. */
export const PLN_NETHERWORLD_WIDTH = 31;
export const PLN_NETHERWORLD_HEIGHT = 16;

/**
 * Slice a `PLNn` file's declared `width * height` content region. Trailing
 * disk-block padding, if the caller passed the whole file, is simply not
 * read — the same convention `decodeSet`/`decodeMusic` use elsewhere in
 * this project.
 */
export function decodePln(data: Uint8Array, width: number, height: number): PlnGrid {
  const size = width * height;
  if (data.length < size) {
    throw new Error(`PLN file too short: need ${size} bytes, got ${data.length}`);
  }
  return { width, height, cells: data.slice(0, size) };
}
