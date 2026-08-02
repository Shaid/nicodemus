import { describe, it, expect } from 'vitest';
import {
  bitplaneByteOffset,
  bitplaneBufferSize,
  decodeBitplaneIndices,
  cropIndices,
  type BitplaneConfig,
} from '../bitplane.ts';

describe('bitplaneBufferSize', () => {
  it('reproduces the confirmed .pic file sizes (graphics-formats.md §3)', () => {
    expect(
      bitplaneBufferSize({ width: 320, height: 200, bitplaneCount: 4, mode: 'planar' }),
    ).toBe(32000);
    expect(
      bitplaneBufferSize({ width: 176, height: 80, bitplaneCount: 4, mode: 'planar' }),
    ).toBe(7040);
  });

  it('reproduces the CMP decompressed-image size regardless of mode', () => {
    expect(
      bitplaneBufferSize({
        width: 320,
        height: 200,
        bitplaneCount: 4,
        mode: 'interleaved',
        interleave: 2,
      }),
    ).toBe(32000);
  });
});

describe('bitplaneByteOffset — planar mode', () => {
  const config: BitplaneConfig = { width: 16, height: 2, bitplaneCount: 2, mode: 'planar' };
  // width/8 = 2 bytes/row/plane; plane stride = width*height/8 = 4 bytes.
  it('lays out planes as contiguous blocks (plane 0 fully, then plane 1)', () => {
    expect(bitplaneByteOffset(0, 0, 0, config)).toBe(0);
    expect(bitplaneByteOffset(1, 0, 0, config)).toBe(1);
    expect(bitplaneByteOffset(0, 1, 0, config)).toBe(2);
    expect(bitplaneByteOffset(1, 1, 0, config)).toBe(3);
    expect(bitplaneByteOffset(0, 0, 1, config)).toBe(4);
    expect(bitplaneByteOffset(1, 1, 1, config)).toBe(7);
  });
});

describe('bitplaneByteOffset — interleaved (ST) mode', () => {
  // 4bpp, interleave=2: bytes for byteX 0 and 1 share an 8-byte block,
  // ordered plane0-even, plane0-odd, plane1-even, plane1-odd, ...
  const config: BitplaneConfig = {
    width: 320,
    height: 200,
    bitplaneCount: 4,
    mode: 'interleaved',
    interleave: 2,
  };

  it('groups the 4 planes of a 16-pixel column into one 8-byte interleaved block', () => {
    expect(bitplaneByteOffset(0, 0, 0, config)).toBe(0);
    expect(bitplaneByteOffset(1, 0, 0, config)).toBe(1);
    expect(bitplaneByteOffset(0, 0, 1, config)).toBe(2);
    expect(bitplaneByteOffset(1, 0, 1, config)).toBe(3);
    expect(bitplaneByteOffset(0, 0, 2, config)).toBe(4);
    expect(bitplaneByteOffset(0, 0, 3, config)).toBe(6);
    // Next 16-pixel column block starts 8 bytes later.
    expect(bitplaneByteOffset(2, 0, 0, config)).toBe(8);
    expect(bitplaneByteOffset(3, 0, 0, config)).toBe(9);
  });

  it('advances a full row (160 bytes = width/8 * bitplaneCount) per line', () => {
    expect(bitplaneByteOffset(0, 1, 0, config)).toBe(160);
    expect(bitplaneByteOffset(0, 2, 0, config)).toBe(320);
  });
});

describe('decodeBitplaneIndices', () => {
  it('assembles a simple 2-plane, 8x1 planar image byte-exactly', () => {
    // width=8 -> 1 byte/row/plane; height=1; 2 planes.
    // plane0 byte = 0b10110000 (bits for x=0..7, MSB first)
    // plane1 byte = 0b00000000
    const config: BitplaneConfig = { width: 8, height: 1, bitplaneCount: 2, mode: 'planar' };
    const data = new Uint8Array([0b10110000, 0b00000000]);
    const indices = decodeBitplaneIndices(data, 0, config);
    // colorIndex = plane0bit | (plane1bit << 1); plane1 is all 0 here.
    expect(Array.from(indices)).toEqual([1, 0, 1, 1, 0, 0, 0, 0]);
  });

  it('assembles a 2-plane interleaved image and produces a 2-bit color index', () => {
    const config: BitplaneConfig = {
      width: 16,
      height: 1,
      bitplaneCount: 2,
      mode: 'interleaved',
      interleave: 2,
    };
    // Block layout: [plane0-byte0, plane0-byte1, plane1-byte0, plane1-byte1]
    // plane0 bytes cover x=0..15 (byteX 0,1); set every bit -> plane0 bit=1 everywhere.
    // plane1 bytes all 0 -> plane1 bit=0 everywhere. colorIndex should be 1 for every pixel.
    const data = new Uint8Array([0xff, 0xff, 0x00, 0x00]);
    const indices = decodeBitplaneIndices(data, 0, config);
    expect(indices.length).toBe(16);
    expect(Array.from(new Set(indices))).toEqual([1]);
  });
});

describe('cropIndices', () => {
  it('extracts a rectangular region from a row-major index buffer', () => {
    // 4x3 source buffer:
    // 0  1  2  3
    // 4  5  6  7
    // 8  9 10 11
    const src = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const cropped = cropIndices(src, 4, { x: 1, y: 1, width: 2, height: 2 });
    expect(Array.from(cropped)).toEqual([5, 6, 9, 10]);
  });
});
