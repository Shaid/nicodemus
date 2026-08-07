/**
 * Stage 1: parse Phantasie III's `monsinfo.dat` and `PhantasieIII` HUNK
 * executable into raw JSON tables (monster entities + skills).
 *
 * See docs/phantasie/data-tables.md §3 and §5, and
 * docs/phantasie/implementation-plan.md Phase 2.
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeJson, findFileCI, type PlatformConfig } from '@seer-project/pipeline';
import { decodeMonsterTable, type MonsterRecord } from '../../src/assets/formats/monster-data.ts';
import {
  resolveMonsterSpriteIndex,
  spriteCellRect,
  P3_SPRITE_BANKS,
  type SpriteCellRect,
} from '../../src/assets/formats/sprite-bank.ts';
import { readP3SkillTables } from '../../src/assets/formats/exe-data.ts';
// Dynamically imported inside main() (CLI-only) to avoid a static circular
// import: game-config.ts imports exportGameData from this file to register
// the pipeline step, so this file must not statically import game-config.ts
// back.

export interface EntitySpriteRef {
  bankIndex: number;
  bankFile: string;
  cellIndex: number;
  isGiant: boolean;
  normalRect: SpriteCellRect;
  attackingRect: SpriteCellRect;
}

export interface EntityRecord extends MonsterRecord {
  /** Resolved sprite-bank/cell reference (graphics-formats.md §6), or null
   *  if this record's spriteIndex falls outside every documented range. */
  sprite: EntitySpriteRef | null;
}

function resolveEntitySprite(spriteIndex: number): EntitySpriteRef | null {
  try {
    const ref = resolveMonsterSpriteIndex(spriteIndex);
    const bank = P3_SPRITE_BANKS[ref.bank];
    return {
      bankIndex: ref.bank,
      bankFile: bank.file,
      cellIndex: ref.cell,
      isGiant: ref.isGiant,
      normalRect: spriteCellRect(bank, ref.cell, false),
      attackingRect: spriteCellRect(bank, ref.cell, true),
    };
  } catch {
    return null;
  }
}

/** Stage 1 entrypoint — registered as `exportGameData` in `game-config.ts`. */
export function exportGameData(config: PlatformConfig, dataDir: string): void {
  const outDir = resolve('data/extracted', config.assetDir);
  mkdirSync(outDir, { recursive: true });

  const monsinfoPath = resolve(dataDir, findFileCI(dataDir, 'monsinfo.dat'));
  let entities: EntityRecord[] = [];
  if (existsSync(monsinfoPath)) {
    const data = new Uint8Array(readFileSync(monsinfoPath));
    entities = decodeMonsterTable(data).map((monster) => ({
      ...monster,
      sprite: resolveEntitySprite(monster.spriteIndex),
    }));
  } else {
    console.warn(`  ⚠ ${monsinfoPath} not found — writing empty entities.json`);
  }
  writeJson(resolve(outDir, 'entities.json'), entities);

  const exeName = config.executable ?? 'PhantasieIII';
  const exePath = resolve(dataDir, findFileCI(dataDir, exeName));
  const skills = existsSync(exePath) ? readP3SkillTables(new Uint8Array(readFileSync(exePath))) : [];
  if (skills.length === 0) console.warn(`  ⚠ ${exePath} not found — writing empty skills.json`);
  writeJson(resolve(outDir, 'skills.json'), skills);

  console.log(`Wrote ${entities.length} entities and ${skills.length} skill tables to ${outDir}`);
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasieiii/export-game-data.ts <dataDir>');
    process.exit(1);
  }

  const { getGameConfig } = await import('../shared/game-config.ts');
  const config = getGameConfig('phantasieiii', 'amiga');
  if (!config) throw new Error('Missing phantasieiii/amiga config');

  exportGameData(config, dataDir);
}

// Exact-path comparison, not a filename-suffix check: every game in this
// project has its own export-game-data.ts/build-assets.ts with the *same*
// basename, so an endsWith('export-game-data.ts') check can't tell which
// one is the actual entrypoint — it would fire for every such file loaded
// as a side effect of game-config.ts's static imports (which register all
// of them), not just the one the user actually ran.
const isStandalone = process.argv[1] === fileURLToPath(import.meta.url);
if (isStandalone) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
