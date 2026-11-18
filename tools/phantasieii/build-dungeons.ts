/**
 * Phantasie II dungeon build step: decode `DNGn`/`MESSn` pairs (n=1..8)
 * into one browser-friendly JSON asset per level — same shape as
 * `tools/phantasie/build-dungeons.ts`'s P1 step, parameterised by
 * `P2_OPCODES` (the P2-exclusive `0x14`-`0x17` opcode set,
 * scripting-engine.md §5) instead of `P1_OPCODES`.
 *
 * See docs/phantasie/dungeon-format.md §7 (P2's shared-with-P1 header/grid
 * offsets, confirmed against real extracted `DNG*`/`MESS*` files) and
 * docs/phantasie/scripting-engine.md §1-§5.
 *
 * Output (under `public/assets/phantasieii/atarist/`): `dungeon-1.json`
 * through `dungeon-8.json`, one `type: 'dungeon'` manifest entry per file.
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
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
import { P2_OPCODES } from '../../src/assets/formats/opcodes.ts';
import { decodeAllP1P2Messages } from '../../src/assets/formats/messages.ts';
import type { ManifestEntry } from './build-assets.ts';

export const P2_DUNGEON_LEVEL_COUNT = 8;

/**
 * DNGn/MESSn only ever ship on disk 2 (dungeon-format.md §2), never disk 1
 * — a small local resolver rather than importing `resolveP2File` from
 * `./build-assets.ts`, which would create a real (value-level, not just
 * type-level) circular import between the two modules since this file is
 * itself imported by `build-assets.ts` (mirrors `build-map.ts`'s existing
 * `import type` -only reference to `ManifestEntry` below).
 */
function resolveDisk2File(dataDir: string, filename: string): string | null {
  const direct = resolve(dataDir, findFileCI(dataDir, filename));
  if (existsSync(direct)) return direct;
  const disk2Dir = join(dirname(dataDir), 'disk2');
  if (existsSync(disk2Dir)) {
    const viaDisk2 = resolve(disk2Dir, findFileCI(disk2Dir, filename));
    if (existsSync(viaDisk2)) return viaDisk2;
  }
  return null;
}

export function buildDungeonLevel(dngData: Uint8Array, messData: Uint8Array | null, name: string) {
  const header = decodeDungeonHeader(dngData);
  const grid = decodeDungeonGrid(dngData);
  const stars = decodeStarTable(dngData, DUNGEON_STAR_TABLE_OFFSET).filter((s) => !s.empty);
  // Fixed 256-slot, slot-addressed table (dungeon-format.md §3.1 correction 2026-11-13): includes records past the 0x0D fill.
  const actions = decodeReachableActions(dngData, DUNGEON_ACTION_TABLE_OFFSET, stars).map((action) => ({
    ...action,
    effect: buildActionEffect(action, P2_OPCODES),
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

  for (let n = 1; n <= P2_DUNGEON_LEVEL_COUNT; n++) {
    const dngPath = resolveDisk2File(dataDir, `DNG${n}`);
    if (!dngPath || !existsSync(dngPath)) continue;

    const messPath = resolveDisk2File(dataDir, `MESS${n}`);
    const messData = messPath && existsSync(messPath) ? new Uint8Array(readFileSync(messPath)) : null;
    if (!messData) console.warn(`  ⚠ MESS${n} not found — dungeon-${n} will have no message text`);

    const name = `dungeon-${n}`;
    const dungeon = buildDungeonLevel(new Uint8Array(readFileSync(dngPath)), messData, name);
    writeJson(resolve(outDir, `${name}.json`), dungeon, false);
    entries.push({ name, type: 'dungeon', sprites: 0, hasPalette: false, png: '' });
  }

  if (entries.length > 0) {
    console.log(`  Dungeons: ${entries.length} level(s) decoded → ${outDir}`);
  } else {
    console.warn('  ⚠ no DNGn files found — skipping dungeon assets');
  }

  return entries;
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasieii/build-dungeons.ts <dataDir> [outDir]');
    process.exit(1);
  }
  const outDir = process.argv[3] ?? resolve('public/assets/phantasieii/atarist');
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
