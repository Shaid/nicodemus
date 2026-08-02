import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { decodePic, picGreyscalePalette, picToRGBA } from '../pic.ts';

const P1_DIR = resolve('data/phantasie/amiga');

describe('decodePic — .pic full-screen pictures (graphics-formats.md §3)', () => {
  const fullScreenFiles = ['cover1.pic', 'cover2.pic', 'decor.pic', 'final.pic', 'pelnor.pic'];

  for (const name of fullScreenFiles) {
    it(`decodes ${name} as a 320x200 image (32,000 bytes, zero unexplained remainder)`, () => {
      const data = new Uint8Array(readFileSync(resolve(P1_DIR, name)));
      expect(data.length).toBe(32000);
      const image = decodePic(data);
      expect(image.width).toBe(320);
      expect(image.height).toBe(200);
      expect(image.indices.length).toBe(320 * 200);
      // Legible art uses more than a couple of colour indices.
      expect(new Set(image.indices).size).toBeGreaterThan(2);
    });
  }

  it('decodes logo.pic as a 176x80 image (7,040 bytes)', () => {
    const data = new Uint8Array(readFileSync(resolve(P1_DIR, 'logo.pic')));
    expect(data.length).toBe(7040);
    const image = decodePic(data);
    expect(image.width).toBe(176);
    expect(image.height).toBe(80);
    expect(image.indices.length).toBe(176 * 80);
  });

  it('rejects a file whose size does not match any confirmed .pic dimension', () => {
    expect(() => decodePic(new Uint8Array(100))).toThrow(/Unrecognised \.pic file size/);
  });

  it('every .pic file actually present in data/phantasie/amiga decodes cleanly', () => {
    const files = readdirSync(P1_DIR).filter((f) => /\.pic$/i.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const data = new Uint8Array(readFileSync(resolve(P1_DIR, f)));
      expect(() => decodePic(data)).not.toThrow();
    }
  });
});

describe('picToRGBA / picGreyscalePalette', () => {
  it('renders a 16-level neutral greyscale ramp', () => {
    const palette = picGreyscalePalette();
    expect(palette).toHaveLength(16);
    expect(palette[0]).toEqual({ r: 0, g: 0, b: 0 });
    expect(palette[15]).toEqual({ r: 255, g: 255, b: 255 });
    // Strictly increasing.
    for (let i = 1; i < 16; i++) expect(palette[i].r).toBeGreaterThan(palette[i - 1].r);
  });

  it('produces an RGBA buffer of the right size, fully opaque', () => {
    const data = new Uint8Array(readFileSync(resolve(P1_DIR, 'logo.pic')));
    const image = decodePic(data);
    const rgba = picToRGBA(image);
    expect(rgba.length).toBe(176 * 80 * 4);
    for (let i = 0; i < rgba.length; i += 4) expect(rgba[i + 3]).toBe(255);
  });
});
