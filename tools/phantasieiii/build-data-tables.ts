/**
 * Stage 2: republish Phantasie III's executable-embedded/`monsinfo.dat`
 * data tables (monsters, races, spells, items, skills) as flat, table-ready
 * JSON assets under `public/assets/phantasieiii/amiga/`, so the public docs
 * site's `DataTable.astro` component can browse them.
 *
 * This step deliberately does **not** read Stage 1's `data/extracted/`
 * output (`export-game-data.ts`'s `entities.json`/`skills.json`) — every
 * other Stage 2 build step in this project (`build-dungeons.ts`,
 * `build-map.ts`, `build-castle-maps.ts`) re-derives its output straight
 * from the raw game files rather than depending on Stage 1's JSON, keeping
 * the two stages independently runnable/testable. This module follows that
 * same convention and calls the confirmed decoder functions
 * (`src/assets/formats/exe-data.ts`, `monster-data.ts`) directly.
 *
 * `entities.json` (Stage 1) already carries the full `MonsterRecord` shape
 * plus a resolved sprite ref, which is exactly what a flat, primitive-only
 * table row needs, so `monsters.json` here is that same
 * `decodeMonsterTable()` output, unmodified — no `sprite` object though
 * (that's atlas-cell data, not a table column; the sprite galleries already
 * cover it visually).
 *
 * See docs/phantasie/data-tables.md §3, §4, §6, §7 and
 * docs/phantasie/implementation-plan.md.
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson, findFileCI } from '@seer-project/pipeline';
import { decodeMonsterTable } from '../../src/assets/formats/monster-data.ts';
import {
  readP3SkillTables,
  readP3RaceNames,
  readP3RaceSpriteCells,
  readP3Items,
  readP3SpellNames,
  readP3ArmouryStock,
} from '../../src/assets/formats/exe-data.ts';
import type { ManifestEntry } from './build-assets.ts';

interface RaceTableRow {
  index: number;
  name: string;
  bankFile: string;
  cellIndex: number;
}

interface SkillTableRow {
  skill: string;
  class: string;
  levels: number[];
}

export function buildDataTables(dataDir: string, outDir: string): ManifestEntry[] {
  mkdirSync(outDir, { recursive: true });
  const entries: ManifestEntry[] = [];

  const monsinfoPath = resolve(dataDir, findFileCI(dataDir, 'monsinfo.dat'));
  if (existsSync(monsinfoPath)) {
    const monsters = decodeMonsterTable(new Uint8Array(readFileSync(monsinfoPath)));
    writeJson(resolve(outDir, 'monsters.json'), monsters);
    entries.push({ name: 'monsters', type: 'data-table', sprites: 0, hasPalette: false, png: '' });
  } else {
    console.warn(`  ⚠ ${monsinfoPath} not found — skipping monsters data-table asset`);
  }

  const exeName = 'PhantasieIII';
  const exePath = resolve(dataDir, findFileCI(dataDir, exeName));
  if (!existsSync(exePath)) {
    console.warn(`  ⚠ ${exePath} not found — skipping races/items/spells/skills data-table assets`);
    if (entries.length > 0) console.log(`  Data tables: ${entries.length} table(s) → ${outDir}`);
    return entries;
  }
  const exe = new Uint8Array(readFileSync(exePath));

  const raceNames = readP3RaceNames(exe);
  const raceCells = readP3RaceSpriteCells(exe);
  const races: RaceTableRow[] = raceNames.map((name, index) => ({
    index,
    name,
    bankFile: 'heros.cmp',
    cellIndex: raceCells[index],
  }));
  writeJson(resolve(outDir, 'races.json'), races);
  entries.push({ name: 'races', type: 'data-table', sprites: 0, hasPalette: false, png: '' });

  const { items, shopMarkups } = readP3Items(exe);
  writeJson(resolve(outDir, 'items.json'), items);
  entries.push({ name: 'items', type: 'data-table', sprites: 0, hasPalette: false, png: '' });

  const shopMarkupRows = shopMarkups.map((markupPercent, armoury) => ({ armoury, markupPercent }));
  writeJson(resolve(outDir, 'shop-markups.json'), shopMarkupRows);
  entries.push({ name: 'shop-markups', type: 'data-table', sprites: 0, hasPalette: false, png: '' });

  const spells = readP3SpellNames(exe).map((name, index) => ({ index, name }));
  writeJson(resolve(outDir, 'spells.json'), spells);
  entries.push({ name: 'spells', type: 'data-table', sprites: 0, hasPalette: false, png: '' });

  const skillRows: SkillTableRow[] = readP3SkillTables(exe).flatMap((table) =>
    Object.entries(table.byClass).map(([cls, levels]) => ({ skill: table.name, class: cls, levels })),
  );
  writeJson(resolve(outDir, 'skills.json'), skillRows);
  entries.push({ name: 'skills', type: 'data-table', sprites: 0, hasPalette: false, png: '' });

  const inititemPath = resolve(dataDir, findFileCI(dataDir, 'inititem.dat'));
  if (existsSync(inititemPath)) {
    const armouryStock = readP3ArmouryStock(new Uint8Array(readFileSync(inititemPath)));
    writeJson(resolve(outDir, 'armoury-stock.json'), armouryStock);
    entries.push({ name: 'armoury-stock', type: 'data-table', sprites: 0, hasPalette: false, png: '' });
  } else {
    console.warn(`  ⚠ ${inititemPath} not found — skipping armoury-stock data-table asset`);
  }

  console.log(`  Data tables: ${entries.length} table(s) → ${outDir}`);
  return entries;
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasieiii/build-data-tables.ts <dataDir> [outDir]');
    process.exit(1);
  }
  const outDir = process.argv[3] ?? resolve('public/assets/phantasieiii/amiga');
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
