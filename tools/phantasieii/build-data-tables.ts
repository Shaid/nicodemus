/**
 * Stage 2: republish Phantasie II's `PHANT.PRG`-embedded monster/race/item
 * name tables as flat, table-ready JSON assets under
 * `public/assets/phantasieii/atarist/`, so the public docs site's
 * `DataTable.astro` component can browse them.
 *
 * Deliberately does not read Stage 1's `data/extracted/` output — see
 * `tools/phantasieiii/build-data-tables.ts`'s doc comment for the
 * rationale (every Stage 2 step in this project re-derives from the raw
 * game files directly, keeping the two stages independently runnable).
 *
 * See docs/phantasie/data-tables.md §2.
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson, findFileCI } from '@seer-project/pipeline';
import {
  readP2MonsterNames,
  readP2RaceNames,
  readP2ItemNames,
} from '../../src/assets/formats/exe-data.ts';
import { readP2MonsterSpriteTable } from '../../src/assets/formats/sprite-bank.ts';
import type { ManifestEntry } from './build-assets.ts';

interface NamedRow {
  index: number;
  name: string;
}

interface MonsterRow extends NamedRow {
  width: number;
  height: number;
}

export function buildDataTables(dataDir: string, outDir: string): ManifestEntry[] {
  mkdirSync(outDir, { recursive: true });
  const entries: ManifestEntry[] = [];

  const exePath = resolve(dataDir, findFileCI(dataDir, 'PHANT.PRG'));
  if (!existsSync(exePath)) {
    console.warn(`  ⚠ ${exePath} not found — skipping monsters/races/items data-table assets`);
    return entries;
  }
  const exe = new Uint8Array(readFileSync(exePath));

  const spriteRefs = readP2MonsterSpriteTable(exe);
  const monsters: MonsterRow[] = readP2MonsterNames(exe).map((name, index) => ({
    index,
    name,
    width: spriteRefs[index].width,
    height: spriteRefs[index].height,
  }));
  writeJson(resolve(outDir, 'monsters.json'), monsters);
  entries.push({ name: 'monsters', type: 'data-table', sprites: 0, hasPalette: false, png: '' });

  const races: NamedRow[] = readP2RaceNames(exe).map((name, index) => ({ index, name }));
  writeJson(resolve(outDir, 'races.json'), races);
  entries.push({ name: 'races', type: 'data-table', sprites: 0, hasPalette: false, png: '' });

  const items: NamedRow[] = readP2ItemNames(exe).map((name, index) => ({ index, name }));
  writeJson(resolve(outDir, 'items.json'), items);
  entries.push({ name: 'items', type: 'data-table', sprites: 0, hasPalette: false, png: '' });

  console.log(`  Data tables: ${entries.length} table(s) → ${outDir}`);
  return entries;
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasieii/build-data-tables.ts <dataDir> [outDir]');
    process.exit(1);
  }
  const outDir = process.argv[3] ?? resolve('public/assets/phantasieii/atarist');
  const entries = buildDataTables(dataDir, outDir);
  const { upsertManifest } = await import('./build-assets.ts');
  upsertManifest(outDir, entries);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
