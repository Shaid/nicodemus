/**
 * Phantasie III dungeon build step: decode the 11 self-contained `D/dngX.dat`
 * files (X = a..k) into one browser-friendly JSON asset per level — grid,
 * header, star table, action table (with resolved opcode effects) and
 * every message, all read from the single file (P3 embeds its messages
 * in-line, unlike P1/P2's separate `MESS*` file).
 *
 * See docs/phantasie/dungeon-format.md §5 and
 * docs/phantasie/scripting-engine.md §1-§5, and
 * docs/phantasie/implementation-plan.md Phase 3. Decoding is done by
 * `src/assets/formats/dungeon-p3.ts`, `star-action.ts`, `messages.ts` and
 * `opcodes.ts`'s `P3_OPCODES` table (the P3-exclusive `0x14`-`0x1B` set);
 * this module only assembles their output into one JSON document per level.
 *
 * **Level naming:** assets are named `dungeon-a`..`dungeon-k` after the
 * file's own letter suffix, not a derived level number — the header's own
 * `level` byte is non-unique across files (e.g. `dngh`-`dngk` all read
 * `level=5`, the same "multiple files share one depth level" pattern
 * P1/P2 use — dungeon-format.md §8's `level*12+offset` roster convention),
 * so it can't double as a unique asset key. `level` is still included as a
 * JSON field on each decoded document.
 *
 * Output (under `public/assets/phantasieiii/amiga/`): `dungeon-a.json`
 * through `dungeon-k.json`, one `type: 'dungeon'` manifest entry per file.
 */
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson, findFileCI } from '@seer-project/pipeline';
import {
  DUNGEON_P3_WIDTH,
  DUNGEON_P3_HEIGHT,
  DUNGEON_P3_STAR_TABLE_OFFSET,
  DUNGEON_P3_ACTION_TABLE_OFFSET,
  DUNGEON_P3_ACTION_TABLE_SLOT_COUNT,
  decodeDungeonP3Header,
  decodeDungeonP3Grid,
  decodeP3MessagePointers,
} from '../../src/assets/formats/dungeon-p3.ts';
import {
  decodeStarTable,
  decodeActionTable,
  buildActionEffect,
} from '../../src/assets/formats/star-action.ts';
import { P3_OPCODES } from '../../src/assets/formats/opcodes.ts';
import { decodeAllP3Messages } from '../../src/assets/formats/messages.ts';
import type { ManifestEntry } from './build-assets.ts';

/** `dnga.dat`..`dngk.dat` — see the module comment's naming note. */
export const P3_DUNGEON_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'] as const;

export function buildDungeonLevel(data: Uint8Array, name: string) {
  const header = decodeDungeonP3Header(data);
  const grid = decodeDungeonP3Grid(data);
  const stars = decodeStarTable(data, DUNGEON_P3_STAR_TABLE_OFFSET).filter((s) => !s.empty);
  const actions = decodeActionTable(data, DUNGEON_P3_ACTION_TABLE_OFFSET, {
    slotCount: DUNGEON_P3_ACTION_TABLE_SLOT_COUNT,
  }).map((action) => ({
    ...action,
    effect: buildActionEffect(action, P3_OPCODES),
  }));
  const pointers = decodeP3MessagePointers(data);
  const messages = decodeAllP3Messages(data, pointers);

  return {
    name,
    level: header.level,
    width: DUNGEON_P3_WIDTH,
    height: DUNGEON_P3_HEIGHT,
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

  const dDir = resolve(dataDir, findFileCI(dataDir, 'D'));
  if (!existsSync(dDir)) {
    console.warn('  ⚠ D/ folder not found — skipping dungeon assets');
    return entries;
  }
  const filesInDir = readdirSync(dDir);

  for (const letter of P3_DUNGEON_LETTERS) {
    const target = `dng${letter}.dat`;
    const match = filesInDir.find((f) => f.toLowerCase() === target);
    if (!match) continue;

    const name = `dungeon-${letter}`;
    const data = new Uint8Array(readFileSync(resolve(dDir, match)));
    const dungeon = buildDungeonLevel(data, name);
    writeJson(resolve(outDir, `${name}.json`), dungeon, false);
    entries.push({ name, type: 'dungeon', sprites: 0, hasPalette: false, png: '' });
  }

  if (entries.length > 0) {
    console.log(`  Dungeons: ${entries.length} level(s) decoded → ${outDir}`);
  } else {
    console.warn('  ⚠ no D/dngX.dat files found — skipping dungeon assets');
  }

  return entries;
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasieiii/build-dungeons.ts <dataDir> [outDir]');
    process.exit(1);
  }
  const outDir = process.argv[3] ?? resolve('public/assets/phantasieiii/amiga');
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
