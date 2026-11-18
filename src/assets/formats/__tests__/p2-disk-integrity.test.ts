/**
 * Phantasie II disk-image integrity checks (docs/phantasie/stx-extraction.md
 * §4/§6, 2026-11-13 audit): an independent FAT12 walk of the reconstructed
 * `.st` images, and the OUT*.DAT vs MAPS.INT terrain-grid equality. These
 * replace the circular "mdir total = du total" evidence.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const RAW = 'data/phantasieii/atarist/raw';
const EXT = 'data/phantasieii/atarist/extracted';
const have = existsSync(resolve(RAW, 'disk2.st')) && existsSync(resolve(EXT, 'disk2'));

interface Entry {
  name: string;
  size: number;
  chain: number[];
  end: number;
}

function walk(img: Uint8Array): { fat1EqualsFat2: boolean; entries: Entry[]; clusterBytes: number } {
  const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
  const bps = dv.getUint16(11, true);
  const spc = img[13];
  const res = dv.getUint16(14, true);
  const nf = img[16];
  const nroot = dv.getUint16(17, true);
  const spf = dv.getUint16(22, true);
  const fat1 = img.slice(res * bps, (res + spf) * bps);
  const fat2 = img.slice((res + spf) * bps, (res + 2 * spf) * bps);
  const ent = (n: number) => {
    const o = (n * 3) >> 1;
    const v = fat1[o] | (fat1[o + 1] << 8);
    return n & 1 ? (v >> 4) & 0xfff : v & 0xfff;
  };
  const root = (res + nf * spf) * bps;
  const cb = bps * spc;
  const entries: Entry[] = [];
  for (let i = 0; i < nroot; i++) {
    const e = root + i * 32;
    if (img[e] === 0 || img[e] === 0xe5 || (img[e + 11] & 0x18) !== 0) continue;
    const name = String.fromCharCode(...img.slice(e, e + 8)).trim() +
      '.' + String.fromCharCode(...img.slice(e + 8, e + 11)).trim();
    const start = dv.getUint16(e + 26, true);
    const size = dv.getUint32(e + 28, true);
    const chain: number[] = [];
    let c = start;
    while (c >= 2 && c < 0xff0 && chain.length < 5000) {
      chain.push(c);
      c = ent(c);
    }
    entries.push({ name, size, chain, end: c });
  }
  return { fat1EqualsFat2: fat1.every((b, i) => b === fat2[i]), entries, clusterBytes: cb };
}

describe.skipIf(!have)('Phantasie II disk images — independent FAT12 walk', () => {
  for (const disk of [1, 2]) {
    it(`disk ${disk}: FAT1 == FAT2, every chain ends 0xFFF; chain length = ceil(size/cluster) except the DNG.SAV cross-link`, () => {
      const w = walk(new Uint8Array(readFileSync(resolve(RAW, `disk${disk}.st`))));
      expect(w.fat1EqualsFat2).toBe(true);
      const bad = w.entries.filter(
        (e) => e.end !== 0xfff || e.chain.length !== Math.ceil(e.size / w.clusterBytes),
      );
      expect(bad.map((e) => e.name)).toEqual(disk === 2 ? ['DNG.SAV'] : []);
    });
  }

  it('disk 2: DNG.SAV and DNGX.SAV share cluster chain [333,334,335]; DNG.SAV is exactly DNGX.SAV[0:1024] (one piece of evidence, not two)', () => {
    const w = walk(new Uint8Array(readFileSync(resolve(RAW, 'disk2.st'))));
    const a = w.entries.find((e) => e.name === 'DNG.SAV')!;
    const b = w.entries.find((e) => e.name === 'DNGX.SAV')!;
    expect(a.chain).toEqual([333, 334, 335]);
    expect(b.chain).toEqual(a.chain);
    const da = readFileSync(resolve(EXT, 'disk2/DNG.SAV'));
    const db = readFileSync(resolve(EXT, 'disk2/DNGX.SAV'));
    expect(da.length).toBe(1024);
    expect(Buffer.compare(da, db.subarray(0, 1024))).toBe(0);
    // Null control: an ordinary pair (DNG1 / DNG2) is not a prefix of each other.
    const d1 = readFileSync(resolve(EXT, 'disk2/DNG1'));
    const d2 = readFileSync(resolve(EXT, 'disk2/DNG2'));
    expect(Buffer.compare(d1.subarray(0, 1024), d2.subarray(0, 1024))).not.toBe(0);
  });
});

describe.skipIf(!have || !existsSync(resolve(EXT, 'disk1/MAPS.INT')))('Phantasie II OUT*.DAT vs MAPS.INT', () => {
  it('all 17 OUT*.DAT terrain grids (first 520 B) equal distinct MAPS.INT 520-byte blocks; a 1-byte shift matches 0', () => {
    const m = readFileSync(resolve(EXT, 'disk1/MAPS.INT'));
    expect(m.length).toBe(17 * 520);
    const files = readdirSync(resolve(EXT, 'disk2')).filter((f) => /^OUT\d+\.DAT$/.test(f));
    expect(files).toHaveLength(17);
    const used = new Set<number>();
    let shifted = 0;
    for (const f of files) {
      const d = readFileSync(resolve(EXT, 'disk2', f));
      let hit = -1;
      for (let k = 0; k < 17; k++) {
        if (Buffer.compare(d.subarray(0, 520), m.subarray(k * 520, (k + 1) * 520)) === 0) hit = k;
        if (Buffer.compare(d.subarray(1, 521), m.subarray(k * 520, (k + 1) * 520)) === 0) shifted++;
      }
      expect(hit).toBeGreaterThanOrEqual(0);
      used.add(hit);
    }
    expect(used.size).toBe(17);
    expect(shifted).toBe(0);
  });
});
