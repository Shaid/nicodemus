/**
 * Cross-game pixel oracle for the P1 (Amiga, Planar) and P2 (Atari ST,
 * Interleaved) sprite layouts (docs/phantasie/graphics-formats.md §9).
 *
 * Replaces the "decodes to > 1 distinct value" legibility asserts in
 * `sprite-bank.test.ts`, which random bytes also pass (2026-11-13 audit).
 * The two ports store the same art through different plane layouts and
 * different executables' tables, so pixel equality confirms both layouts and
 * both tables at once. Null controls (wrong layout, neighbouring sprite)
 * must collapse well below 100%.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  readP1MonsterSpriteTable,
  decodeP1MonsterSprite,
  decodeP1RaceSprite,
  readP2MonsterSpriteTable,
  decodeP2MonsterSprite,
  decodeP2RaceSprite,
} from '../sprite-bank.ts';
import { readP1MonsterNames, readP2MonsterNames } from '../exe-data.ts';
import { decodeBitplaneIndices } from '../bitplane.ts';

const P1 = 'data/phantasie/amiga';
const P2 = 'data/phantasieii/atarist/extracted/disk1';
const have = existsSync(resolve(P1, 'game')) && existsSync(resolve(P2, 'PHANT.PRG')) && existsSync(resolve(P2, '../disk2/MSTR2.PAT'));
const rd = (p: string) => new Uint8Array(readFileSync(resolve(p)));

function agree(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) n++;
  return n;
}

describe.skipIf(!have)('P1 Planar vs P2 Interleaved sprites — cross-game pixel equality', () => {
  it('all 32 race sprites (party1/2.pat vs PARTY1/2.PAT) are pixel-identical: 32,768/32,768', () => {
    let same = 0;
    let total = 0;
    let swapped = 0; // null control: P1 race i against P2 race i+1
    for (const bank of [1, 2]) {
      const p1 = rd(`${P1}/party${bank}.pat`);
      const p2 = rd(`${P2}/PARTY${bank}.PAT`);
      for (let r = 0; r < 16; r++) {
        const a = decodeP1RaceSprite(p1, r);
        same += agree(a, decodeP2RaceSprite(p2, r));
        swapped += agree(a, decodeP2RaceSprite(p2, (r + 1) % 16));
        total += a.length;
      }
    }
    expect(total).toBe(32768);
    expect(same).toBe(total);
    expect(swapped / total).toBeLessThan(0.8);
  });

  it('98 same-name same-size monsters (49 per bank, mstr1/2.pat vs MSTR1/2.PAT) are pixel-identical: 152,032/152,032', () => {
    const e1 = rd(`${P1}/game`);
    const e2 = rd(`${P2}/PHANT.PRG`);
    const r1 = readP1MonsterSpriteTable(e1);
    const r2 = readP2MonsterSpriteTable(e2);
    const n1 = readP1MonsterNames(e1);
    const n2 = readP2MonsterNames(e2);
    let pairs = 0;
    let same = 0;
    let total = 0;
    let wrongLayout = 0; // null control: decode the P2 sprite as Planar
    for (const bank of [1, 2]) {
      const p1 = rd(`${P1}/mstr${bank}.pat`);
      const p2 = rd(`data/phantasieii/atarist/extracted/disk${bank}/MSTR${bank}.PAT`);
      for (let i = 0; i < 80; i++) {
        const j = n2.indexOf(n1[i]);
        if (j < 0 || r1[i].width !== r2[j].width || r1[i].height !== r2[j].height) continue;
        const a = decodeP1MonsterSprite(p1, r1[i]);
        const b = decodeP2MonsterSprite(p2, r2[j]);
        pairs++;
        total += a.length;
        same += agree(a, b);
        const w = decodeBitplaneIndices(p2, r2[j].byteOffset, {
          width: r2[j].width,
          height: r2[j].height,
          bitplaneCount: 4,
          mode: 'planar',
        });
        wrongLayout += agree(a, w);
      }
    }
    expect(pairs).toBe(98);
    expect(total).toBe(152032);
    expect(same).toBe(total);
    expect(wrongLayout / total).toBeLessThan(0.8);
  });
});
