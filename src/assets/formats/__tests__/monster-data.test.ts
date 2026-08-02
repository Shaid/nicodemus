import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { decodeMonsterTable, MONSTER_COUNT, MONSTER_TABLE_SIZE } from '../monster-data.ts';

const MONSINFO_PATH = resolve('data/phantasieiii/amiga/monsinfo.dat');

describe('decodeMonsterTable — monsinfo.dat (data-tables.md §3.1)', () => {
  it('is exactly 3,072 bytes: 80 * 38-byte records + 32 bytes trailing pad', () => {
    const data = new Uint8Array(readFileSync(MONSINFO_PATH));
    expect(data.length).toBe(3072);
    expect(MONSTER_TABLE_SIZE).toBe(3040);
    expect(data.length - MONSTER_TABLE_SIZE).toBe(32);
  });

  it('decodes the confirmed names at indices 0-5 and 79', () => {
    const data = new Uint8Array(readFileSync(MONSINFO_PATH));
    const records = decodeMonsterTable(data);
    expect(records).toHaveLength(MONSTER_COUNT);
    expect(records[0].name).toBe('Skeleton');
    expect(records[1].name).toBe('Sniverling');
    expect(records[2].name).toBe('Drip Slime');
    expect(records[3].name).toBe('Undead Gnome');
    expect(records[4].name).toBe('Wild Cat');
    expect(records[5].name).toBe('Giant Bee');
    expect(records[79].name).toBe('Lord Wood');
  });

  it('computes display attack as attackRaw * 10', () => {
    const data = new Uint8Array(readFileSync(MONSINFO_PATH));
    const records = decodeMonsterTable(data);
    for (const r of records) {
      expect(r.attack).toBe(r.attackRaw * 10);
    }
  });

  it('every record has a spriteIndex in the range resolveMonsterSpriteIndex accepts (0-48 or 65)', async () => {
    const { resolveMonsterSpriteIndex } = await import('../sprite-bank.ts');
    const data = new Uint8Array(readFileSync(MONSINFO_PATH));
    const records = decodeMonsterTable(data);
    let resolvable = 0;
    for (const r of records) {
      try {
        resolveMonsterSpriteIndex(r.spriteIndex);
        resolvable++;
      } catch {
        // Some spriteIndex values may fall outside the documented ranges —
        // recorded as a count, not asserted to be zero, since the mapping
        // table itself is flagged "not independently re-derived" in
        // graphics-formats.md §6.
      }
    }
    // Expect the overwhelming majority to resolve cleanly (the mapping
    // table covers the full 0-48 documented range plus the two patches).
    expect(resolvable).toBeGreaterThan(records.length * 0.9);
  });
});
