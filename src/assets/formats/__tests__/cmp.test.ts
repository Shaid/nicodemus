import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { bitplaneByteOffset } from '../bitplane.ts';
import {
  decodeCmp,
  cmpToRGBA,
  decompressCmpBuffer,
  CMP_BUFFER_SIZE,
  CMP_STRIP_SIZE,
  type CmpInterleaveType,
} from '../cmp.ts';

const GRAPHICS_DIR = resolve('data/phantasieiii/amiga/Graphics');

function u16be(value: number): [number, number] {
  return [(value >> 8) & 0xff, value & 0xff];
}

/**
 * Build a synthetic RLE stream for one strip (one bitplane's 8,000 bytes):
 * an optional short literal run (opcode 0x01-0x7F), then a single
 * long-repeat opcode (0x00 + u16 count + one fill byte) covering the
 * remainder. Exercises two of the three opcode forms used by the real
 * format (literal run, opcode-0 long run) — see graphics-formats.md §4.2.
 * `literals` must be non-empty when provided: a literal-run opcode byte of
 * 0 would collide with the reserved long-run marker.
 */
function buildStripStream(literals: number[], fillByte: number): number[] {
  if (literals.length > 0 && literals.length >= 0x80) {
    throw new Error('test fixture literal run must fit in one opcode byte (< 0x80)');
  }
  const remaining = CMP_STRIP_SIZE - literals.length;
  const literalPart = literals.length > 0 ? [literals.length, ...literals] : [];
  return [...literalPart, 0x00, ...u16be(remaining), fillByte];
}

/** Build a full synthetic 4-strip RLE stream + minimal CMP header. */
function buildSyntheticCmp(type: CmpInterleaveType, literalsPerStrip: number[][]): Uint8Array {
  const streamBytes: number[] = [];
  for (let plane = 0; plane < 4; plane++) {
    streamBytes.push(...buildStripStream(literalsPerStrip[plane], 0xaa + plane));
  }
  const compressedSize = streamBytes.length + 1; // + type byte itself
  const header = new Uint8Array(0x23);
  header[0x20] = (compressedSize >> 8) & 0xff;
  header[0x21] = compressedSize & 0xff;
  header[0x22] = type;
  const file = new Uint8Array(header.length + streamBytes.length);
  file.set(header, 0);
  file.set(streamBytes, header.length);
  return file;
}

describe('decompressCmpBuffer — opcode semantics on a synthetic fixture', () => {
  it('places a short literal run followed by a long repeat run correctly for type 2 (vertical)', () => {
    const literals = [0x11, 0x22, 0x33];
    const file = buildSyntheticCmp(2, [literals, [], [], []]);
    const { buffer, bytesConsumed } = decompressCmpBuffer(file, 0x23, 2);
    expect(buffer.length).toBe(CMP_BUFFER_SIZE);

    // Vertical submode: byteX fixed at 0, line increments 0,1,2 for the
    // first three (literal) bytes of plane 0.
    const config = { width: 320, height: 200, bitplaneCount: 4, mode: 'interleaved' as const, interleave: 2 };
    expect(buffer[bitplaneByteOffset(0, 0, 0, config)]).toBe(0x11);
    expect(buffer[bitplaneByteOffset(0, 1, 0, config)]).toBe(0x22);
    expect(buffer[bitplaneByteOffset(0, 2, 0, config)]).toBe(0x33);
    // The long-repeat run fills the rest of the strip with 0xAA.
    expect(buffer[bitplaneByteOffset(0, 3, 0, config)]).toBe(0xaa);
    expect(buffer[bitplaneByteOffset(1, 0, 0, config)]).toBe(0xaa);

    const declaredCompressedSize = (file[0x20] << 8) | file[0x21];
    expect(bytesConsumed).toBe(declaredCompressedSize - 1);
  });

  it('places a short literal run followed by a long repeat run correctly for type 1 (horizontal)', () => {
    const literals = [0x11, 0x22, 0x33];
    const file = buildSyntheticCmp(1, [literals, [], [], []]);
    const { buffer } = decompressCmpBuffer(file, 0x23, 1);

    // Horizontal submode: line fixed at 0, byteX increments 0,1,2 for the
    // first three (literal) bytes of plane 0 — a different buffer position
    // than the type-2 case above for the same input bytes.
    const config = { width: 320, height: 200, bitplaneCount: 4, mode: 'interleaved' as const, interleave: 2 };
    expect(buffer[bitplaneByteOffset(0, 0, 0, config)]).toBe(0x11);
    expect(buffer[bitplaneByteOffset(1, 0, 0, config)]).toBe(0x22);
    expect(buffer[bitplaneByteOffset(2, 0, 0, config)]).toBe(0x33);
    expect(buffer[bitplaneByteOffset(0, 1, 0, config)]).toBe(0xaa);
  });

  it('assigns distinct strips to distinct bitplanes', () => {
    const file = buildSyntheticCmp(2, [[], [], [], []]);
    const { buffer } = decompressCmpBuffer(file, 0x23, 2);
    const config = { width: 320, height: 200, bitplaneCount: 4, mode: 'interleaved' as const, interleave: 2 };
    // Every strip in this fixture is a uniform fill of (0xAA + plane index).
    for (let plane = 0; plane < 4; plane++) {
      expect(buffer[bitplaneByteOffset(0, 0, plane, config)]).toBe(0xaa + plane);
    }
  });

  it('decodes a short-repeat opcode (0x80-0xFF: repeat next byte 256-opcode times)', () => {
    // Strip = one short-repeat run of 5 (opcode 0xFB = 256-5) filling with
    // 0x77, then a long run for the remainder.
    const shortRepeat = [0xfb, 0x77];
    const remaining = CMP_STRIP_SIZE - 5;
    const stream = [...shortRepeat, 0x00, ...u16be(remaining), 0x00];

    // Build a full 4-strip file where every strip uses this exact pattern.
    const allStreams: number[] = [];
    for (let plane = 0; plane < 4; plane++) allStreams.push(...stream);
    const fullCompressedSize = allStreams.length + 1;
    const header = new Uint8Array(0x23);
    header[0x20] = (fullCompressedSize >> 8) & 0xff;
    header[0x21] = fullCompressedSize & 0xff;
    header[0x22] = 2;
    const file = new Uint8Array(header.length + allStreams.length);
    file.set(header, 0);
    file.set(allStreams, header.length);

    const { buffer, bytesConsumed } = decompressCmpBuffer(file, 0x23, 2);
    const config = { width: 320, height: 200, bitplaneCount: 4, mode: 'interleaved' as const, interleave: 2 };
    for (let line = 0; line < 5; line++) {
      expect(buffer[bitplaneByteOffset(0, line, 0, config)]).toBe(0x77);
    }
    expect(buffer[bitplaneByteOffset(0, 5, 0, config)]).toBe(0x00);
    expect(bytesConsumed).toBe(fullCompressedSize - 1);
  });
});

describe('decodeCmp — golden files (graphics-formats.md §4.4)', () => {
  const goldenFiles: { name: string; expectedType: CmpInterleaveType }[] = [
    { name: 'title.cmp', expectedType: 2 },
    { name: 'heros.cmp', expectedType: 2 },
    { name: 'giant1.cmp', expectedType: 2 },
    { name: 'anatomy1.csh', expectedType: 2 },
    { name: 'dlgbttns.cmp', expectedType: 1 }, // the one confirmed type-1 (horizontal) file
  ];

  for (const { name, expectedType } of goldenFiles) {
    it(`decodes ${name} to a full 320x200 image with zero RLE-length deviation`, () => {
      const data = new Uint8Array(readFileSync(resolve(GRAPHICS_DIR, name)));
      const image = decodeCmp(data);
      expect(image.width).toBe(320);
      expect(image.height).toBe(200);
      expect(image.indices.length).toBe(320 * 200);
      expect(image.interleaveType).toBe(expectedType);

      const declaredCompressedSize = (data[0x20] << 8) | data[0x21];
      expect(image.rleBytesConsumed).toBe(declaredCompressedSize - 1);

      // Not blank: a legible image uses more than a couple of colours.
      const distinctColors = new Set(image.indices).size;
      expect(distinctColors).toBeGreaterThan(2);

      const rgba = cmpToRGBA(image);
      expect(rgba.length).toBe(320 * 200 * 4);
    });
  }

  it('every Graphics/*.cmp and *.csh file in the corpus decodes without a structural mismatch', () => {
    const files = readdirSync(GRAPHICS_DIR).filter((f) => /\.(cmp|csh)$/i.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const data = new Uint8Array(readFileSync(resolve(GRAPHICS_DIR, f)));
      expect(() => decodeCmp(data)).not.toThrow();
    }
  });
});
