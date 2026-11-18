/**
 * Phantasie I dungeon build step: decode `dngN`/`messN` pairs (N=1..10)
 * into one browser-friendly JSON asset per level — grid, header, star
 * table, action table (with resolved opcode effects) and every message.
 *
 * See docs/phantasie/dungeon-format.md §2-§4 and
 * docs/phantasie/scripting-engine.md §1-§5, and
 * docs/phantasie/implementation-plan.md Phase 3. All decoding is done by
 * `src/assets/formats/dungeon.ts`, `star-action.ts`, `messages.ts` and
 * `opcodes.ts`'s `P1_OPCODES` table; this module only assembles their
 * output into one JSON document per level and a manifest entry.
 *
 * Output (under `public/assets/phantasie/amiga/`): `dungeon-1.json`
 * through `dungeon-10.json`, one `type: 'dungeon'` manifest entry per file.
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson, findFileCI } from '@seer-project/pipeline';
import {
  DUNGEON_WIDTH,
  DUNGEON_HEIGHT,
  DUNGEON_STAR_TABLE_OFFSET,
  DUNGEON_ACTION_TABLE_OFFSET,
  decodeDungeonHeader,
  decodeDungeonGrid,
} from '../../src/assets/formats/dungeon.ts';
import {
  decodeStarTable,
  decodeReachableActions,
  buildActionEffect,
} from '../../src/assets/formats/star-action.ts';
import { P1_OPCODES } from '../../src/assets/formats/opcodes.ts';
import { decodeAllP1P2Messages } from '../../src/assets/formats/messages.ts';
import type { ManifestEntry } from './build-assets.ts';

export const P1_DUNGEON_LEVEL_COUNT = 10;

/** Decode one `dngN`/`messN` pair into the JSON shape every dungeon-level asset ships. */
export function buildDungeonLevel(dngData: Uint8Array, messData: Uint8Array | null, name: string) {
  const header = decodeDungeonHeader(dngData);
  const grid = decodeDungeonGrid(dngData);
  const stars = decodeStarTable(dngData, DUNGEON_STAR_TABLE_OFFSET).filter((s) => !s.empty);
  // Fixed 256-slot, slot-addressed table (dungeon-format.md §3.1 correction 2026-11-13): includes records past the 0x0D fill.
  const actions = decodeReachableActions(dngData, DUNGEON_ACTION_TABLE_OFFSET, stars).map((action) => ({
    ...action,
    effect: buildActionEffect(action, P1_OPCODES),
  }));
  const messages = messData ? decodeAllP1P2Messages(messData) : [];

  return {
    name,
    level: header.level,
    width: DUNGEON_WIDTH,
    height: DUNGEON_HEIGHT,
    cells: Array.from(grid),
    fixedEncounterTable: header.fixedEncounterTable,
    stars,
    actions,
    messages,
  };
}

export function buildDungeons(dataDir: string, outDir: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  mkdirSync(outDir, { recursive: true });

  for (let n = 1; n <= P1_DUNGEON_LEVEL_COUNT; n++) {
    const dngPath = resolve(dataDir, findFileCI(dataDir, `dng${n}`));
    if (!existsSync(dngPath)) continue;

    const messPath = resolve(dataDir, findFileCI(dataDir, `mess${n}`));
    const messData = existsSync(messPath) ? new Uint8Array(readFileSync(messPath)) : null;
    if (!messData) console.warn(`  ⚠ mess${n} not found — dungeon-${n} will have no message text`);

    const name = `dungeon-${n}`;
    const dungeon = buildDungeonLevel(new Uint8Array(readFileSync(dngPath)), messData, name);
    writeJson(resolve(outDir, `${name}.json`), dungeon, false);
    entries.push({ name, type: 'dungeon', sprites: 0, hasPalette: false, png: '' });
  }

  if (entries.length > 0) {
    console.log(`  Dungeons: ${entries.length} level(s) decoded → ${outDir}`);
  } else {
    console.warn('  ⚠ no dngN files found — skipping dungeon assets');
  }

  return entries;
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasie/build-dungeons.ts <dataDir> [outDir]');
    process.exit(1);
  }
  const outDir = process.argv[3] ?? resolve('public/assets/phantasie/amiga');
  const entries = buildDungeons(dataDir, outDir);
  const { upsertManifest } = await import('./build-assets.ts');
  upsertManifest(outDir, entries);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
