import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { decodeCmp } from '../cmp.ts';
import { classifyCell } from '../dungeon.ts';
import {
  DNG_FIRST_GLOBAL_ICON_INDEX,
  DNG_ICON_WIDTH,
  DNG_LOCAL_ICON_NAME,
  dngIconNameFor,
  extractDngIconFrames,
} from '../dng-icons.ts';

const DNG_PATH = resolve('data/phantasieiii/amiga/Graphics/dng.csh');

describe('extractDngIconFrames — Dng.csh real icon content (graphics-formats.md §4.6)', () => {
  it('finds exactly 9 real (non-empty) icon frames, all 8px wide', () => {
    const data = new Uint8Array(readFileSync(DNG_PATH));
    const image = decodeCmp(data);
    const frames = extractDngIconFrames(image);
    expect(frames).toHaveLength(9);
    for (const f of frames) expect(f.w).toBe(DNG_ICON_WIDTH);
  });

  it('places icons on the confirmed 5-per-row, 48px/48-scanline grid, content starting at row+1', () => {
    const data = new Uint8Array(readFileSync(DNG_PATH));
    const image = decodeCmp(data);
    const frames = extractDngIconFrames(image);
    const byIndex = new Map(frames.map((f) => [f.globalIndex, f]));

    // i=0 (0x2D): slot (0,0), content starts at y=1 (row 0 is the reserved
    // per-icon height byte read by LAB_010D, not pixel content).
    expect(byIndex.get(0x2d)).toMatchObject({ x: 0, y: 1 });
    // i=4 (0x31, 'star'): 5th column of row 0 -> x = 4*48 = 192.
    expect(byIndex.get(0x31)).toMatchObject({ x: 192, y: 1 });
    // i=5 (0x32, 'floor'): first column of row-group 1 -> y = 48+1 = 49.
    expect(byIndex.get(0x32)).toMatchObject({ x: 0, y: 49 });
    // i=8 (0x35): last real icon; global index 0x2D+8 = 0x35, matching
    // Scroll.csh's own icon range starting one slot later at 0x36.
    expect(byIndex.get(0x35)).toMatchObject({ x: 144, y: 49 });
  });

  it('confirms 0x2D≡0x34 (stairsExit) and 0x2E(wall)≡0x35 are pixel-identical duplicate slots', () => {
    // Confirmed against real Amiga screenshots (data/default_72.png,
    // default_74.png — graphics-formats.md §4.6): 0x34's icon renders
    // identically to 0x2D's (no distinct "stairs" glyph), and 0x35 is a
    // plain duplicate of the wall icon, not a separate cursor icon.
    const data = new Uint8Array(readFileSync(DNG_PATH));
    const image = decodeCmp(data);
    const pixelsFor = (globalIndex: number) => {
      const f = extractDngIconFrames(image).find((fr) => fr.globalIndex === globalIndex)!;
      const rows: number[][] = [];
      for (let r = 0; r < f.h; r++) {
        const row: number[] = [];
        for (let c = 0; c < f.w; c++) row.push(image.indices[(f.y + r) * image.width + f.x + c]);
        rows.push(row);
      }
      return rows;
    };
    expect(pixelsFor(0x2d)).toEqual(pixelsFor(0x34));
    expect(pixelsFor(0x2e)).toEqual(pixelsFor(0x35));
    // ...but the two pairs are genuinely different patterns from each other.
    expect(pixelsFor(0x2d)).not.toEqual(pixelsFor(0x2e));
  });

  it('assigns every dispatched local slot its role name from LAB_1388', () => {
    expect(DNG_LOCAL_ICON_NAME[0]).toBeNull(); // 0x2D reserved
    expect(DNG_LOCAL_ICON_NAME[0x2e - DNG_FIRST_GLOBAL_ICON_INDEX]).toBe('wall');
    expect(DNG_LOCAL_ICON_NAME[0x2f - DNG_FIRST_GLOBAL_ICON_INDEX]).toBe('doorHorizontal');
    expect(DNG_LOCAL_ICON_NAME[0x30 - DNG_FIRST_GLOBAL_ICON_INDEX]).toBe('doorVertical');
    expect(DNG_LOCAL_ICON_NAME[0x31 - DNG_FIRST_GLOBAL_ICON_INDEX]).toBe('star');
    expect(DNG_LOCAL_ICON_NAME[0x32 - DNG_FIRST_GLOBAL_ICON_INDEX]).toBe('floor');
    expect(DNG_LOCAL_ICON_NAME[0x34 - DNG_FIRST_GLOBAL_ICON_INDEX]).toBe('stairsExit');
  });
});

describe('dngIconNameFor — CellClass -> Dng.csh icon role', () => {
  it('maps wall/secretWall to the same wall icon (indistinguishable until discovered)', () => {
    expect(dngIconNameFor(classifyCell(0x00, 0))).toBe('wall');
    expect(dngIconNameFor(classifyCell(0x01, 0))).toBe('wall');
  });

  it('maps horizontal vs vertical doors to their own icons, regardless of door state', () => {
    expect(dngIconNameFor(classifyCell(0xb9, 0))).toBe('doorHorizontal'); // open
    expect(dngIconNameFor(classifyCell(0xc6, 0))).toBe('doorHorizontal'); // locked
    expect(dngIconNameFor(classifyCell(0xc8, 0))).toBe('doorVertical'); // open
    expect(dngIconNameFor(classifyCell(0xd5, 0))).toBe('doorVertical'); // locked
  });

  it('maps star and stairsExit to their own icons', () => {
    expect(dngIconNameFor(classifyCell(0xdd, 0))).toBe('star');
    expect(dngIconNameFor(classifyCell(0xd7, 0))).toBe('stairsExit');
  });

  it('hides traps/encounters/messages behind the generic floor icon, matching the original (not visible until stepped on)', () => {
    expect(dngIconNameFor(classifyCell(0x02, 0))).toBe('floor'); // trap
    expect(dngIconNameFor(classifyCell(0x08, 0))).toBe('floor'); // randomEncounter
    expect(dngIconNameFor(classifyCell(0x12, 0))).toBe('floor'); // specialMessage
    expect(dngIconNameFor(classifyCell(0x80, 0))).toBe('floor'); // fixedEncounter
  });
});
