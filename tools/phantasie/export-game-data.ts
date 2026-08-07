/**
 * Stage 1: parse Phantasie I's `game` HUNK executable into raw JSON tables
 * (monster names + sprite refs, race names, the confirmed palette).
 *
 * See docs/phantasie/data-tables.md §1 and
 * docs/phantasie/implementation-plan.md Phase 4.
 */
import { resolve } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeJson, findFileCI, type PlatformConfig } from '@seer-project/pipeline';
import { readP1MonsterNames, readP1RaceNames, readP1Palette } from '../../src/assets/formats/exe-data.ts';
import { readP1MonsterSpriteTable } from '../../src/assets/formats/sprite-bank.ts';
// getGameConfig is dynamically imported inside main() (CLI-only) to avoid a
// static circular import — game-config.ts imports exportGameData from this
// file to register the pipeline step.

export interface P1MonsterEntity {
  index: number;
  name: string;
  sprite: { byteOffset: number; width: number; height: number };
}

export interface P1Race {
  index: number;
  name: string;
}

/** Stage 1 entrypoint — registered as `exportGameData` in `game-config.ts`. */
export function exportGameData(config: PlatformConfig, dataDir: string): void {
  const outDir = resolve('data/extracted', config.assetDir);
  mkdirSync(outDir, { recursive: true });

  const exeName = config.executable ?? 'game';
  const gamePath = resolve(dataDir, findFileCI(dataDir, exeName));
  const game = new Uint8Array(readFileSync(gamePath));

  const monsterNames = readP1MonsterNames(game);
  const spriteRefs = readP1MonsterSpriteTable(game);
  const entities: P1MonsterEntity[] = monsterNames.map((name, index) => ({
    index,
    name,
    sprite: {
      byteOffset: spriteRefs[index].byteOffset,
      width: spriteRefs[index].width,
      height: spriteRefs[index].height,
    },
  }));

  const races: P1Race[] = readP1RaceNames(game).map((name, index) => ({ index, name }));
  const palette = readP1Palette(game);

  writeJson(resolve(outDir, 'entities.json'), entities);
  writeJson(resolve(outDir, 'races.json'), races);
  writeJson(resolve(outDir, 'palette.json'), { colors: palette });

  console.log(
    `Wrote ${entities.length} monster entities, ${races.length} races, and the confirmed palette to ${outDir}`,
  );
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasie/export-game-data.ts <dataDir>');
    process.exit(1);
  }

  const { getGameConfig } = await import('../shared/game-config.ts');
  const config = getGameConfig('phantasie', 'amiga');
  if (!config) throw new Error('Missing phantasie/amiga config');

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
