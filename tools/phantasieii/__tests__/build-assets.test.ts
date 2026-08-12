import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { buildRscAssets } from '../build-assets.ts';

/**
 * `p2-rsc-strings-unwired` (docs/phantasie/TODO.md) — confirms
 * `buildRscAssets` actually wires the already-tested `gem-rsc.ts` decoder
 * into the pipeline, against the real extracted `.RSC` files, not a
 * fixture. See dungeon-format.md §8.6.7 for the format and
 * `src/assets/formats/__tests__/gem-rsc.test.ts` for the decoder's own
 * unit coverage.
 */
const DATA_DIR = resolve('data/phantasieii/atarist/extracted/disk1');
const OUT_DIR = mkdtempSync(join(tmpdir(), 'nicodemus-rsc-assets-'));

afterAll(() => rmSync(OUT_DIR, { recursive: true, force: true }));

describe('buildRscAssets — real PHANT.RSC/OUT.RSC/BACKUP.RSC pipeline run', () => {
  const entries = buildRscAssets(DATA_DIR, OUT_DIR);

  it('emits one text manifest entry per source file', () => {
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.name)).toEqual(['phant-rsc', 'out-rsc', 'backup-rsc']);
    for (const entry of entries) {
      expect(entry.type).toBe('text');
      expect(entry.png).toBe('');
      expect(entry.hasPalette).toBe(false);
    }
  });

  it('backup-rsc.json tree 0 contains the real P1<->P2 character-transfer strings', () => {
    const asset = JSON.parse(readFileSync(join(OUT_DIR, 'backup-rsc.json'), 'utf-8'));
    expect(asset.sourceFile).toBe('BACKUP.RSC');
    expect(asset.treeCount).toBe(11);
    const tree0 = asset.trees[0].strings as string[];
    expect(tree0.some((s) => s.includes('FROM PHANTASIE 1 TO PHANTASIE 2'))).toBe(true);
    expect(tree0.some((s) => s.includes('FROM PHANTASIE 2 TO PHANTASIE 1'))).toBe(true);
  });

  it('phant-rsc.json carries the "WE DID IT AGAIN FOR YOU!" ST-conversion credits string', () => {
    const asset = JSON.parse(readFileSync(join(OUT_DIR, 'phant-rsc.json'), 'utf-8'));
    expect(asset.treeCount).toBe(26);
    const allStrings = asset.trees.flatMap((t: { strings: string[] }) => t.strings);
    expect(allStrings).toContain('WE DID IT AGAIN FOR YOU!');
  });

  it('out-rsc.json carries the section-refusal strings and the one free-string form_alert template', () => {
    const asset = JSON.parse(readFileSync(join(OUT_DIR, 'out-rsc.json'), 'utf-8'));
    expect(asset.treeCount).toBe(44);
    expect(asset.trees[15].strings).toEqual([' THE RIVER STYX ']);
    expect(asset.trees[17].strings).toEqual([' THAT IS THE OCEAN ']);
    expect(asset.freeStrings).toEqual(['[0][Not enough Magic     ][ SORRY ]']);
  });
});
