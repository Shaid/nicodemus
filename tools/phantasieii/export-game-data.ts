/**
 * Stage 1: parse Phantasie II's `PHANT.PRG` Atari ST executable into raw
 * JSON tables (monster names + sprite refs, race names, the confirmed
 * palette) — the same table shapes as Phantasie I's `game`, at P2's own
 * confirmed offsets.
 *
 * See docs/phantasie/data-tables.md §2 and
 * docs/phantasie/implementation-plan.md Phase 7.
 */
import { resolve } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeJson, findFileCI, type PlatformConfig } from '@seer-project/pipeline';
import { readP2MonsterNames, readP2RaceNames, readP2Palette } from '../../src/assets/formats/exe-data.ts';
import { readP2MonsterSpriteTable } from '../../src/assets/formats/sprite-bank.ts';
// getGameConfig is dynamically imported inside main() (CLI-only) to avoid a
// static circular import — game-config.ts imports exportGameData from this
// file to register the pipeline step.

export interface P2MonsterEntity {
  index: number;
  name: string;
  sprite: { byteOffset: number; width: number; height: number };
}

export interface P2Race {
  index: number;
  name: string;
}

/** Stage 1 entrypoint — registered as `exportGameData` in `game-config.ts`. */
export function exportGameData(config: PlatformConfig, dataDir: string): void {
  const outDir = resolve('data/extracted', config.assetDir);
  mkdirSync(outDir, { recursive: true });

  const exeName = config.executable ?? 'PHANT.PRG';
  const exePath = resolve(dataDir, findFileCI(dataDir, exeName));
  const exe = new Uint8Array(readFileSync(exePath));

  const monsterNames = readP2MonsterNames(exe);
  const spriteRefs = readP2MonsterSpriteTable(exe);
  const entities: P2MonsterEntity[] = monsterNames.map((name, index) => ({
    index,
    name,
    sprite: {
      byteOffset: spriteRefs[index].byteOffset,
      width: spriteRefs[index].width,
      height: spriteRefs[index].height,
    },
  }));

  const races: P2Race[] = readP2RaceNames(exe).map((name, index) => ({ index, name }));
  const palette = readP2Palette(exe);

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
    console.error('Usage: npx tsx tools/phantasieii/export-game-data.ts <dataDir>');
    process.exit(1);
  }

  const { getGameConfig } = await import('../shared/game-config.ts');
  const config = getGameConfig('phantasieii', 'atarist');
  if (!config) throw new Error('Missing phantasieii/atarist config');

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
