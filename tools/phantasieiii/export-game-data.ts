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
import {
  readP3SkillTables,
  readP3RaceNames,
  readP3RaceSpriteCells,
  readP3Items,
  readP3SpellNames,
  type P3ItemsData,
} from '../../src/assets/formats/exe-data.ts';
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
  /** Resolved sprite-bank/cell reference (graphics-formats.md §6). Null only
   *  as a defensive fallback — `resolveMonsterSpriteIndex` no longer throws
   *  for any real `spriteIndex` byte value (0-255): out-of-range values
   *  (>=48) now resolve via the disassembly-confirmed self-correction
   *  fallback (bank 2 cell 14) rather than throwing. */
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

export interface RaceSpriteRef {
  bankIndex: number;
  bankFile: string;
  cellIndex: number;
  normalRect: SpriteCellRect;
  attackingRect: SpriteCellRect;
}

export interface RaceRecord {
  index: number;
  name: string;
  /** Idle-pose bank-0 cell index (data-tables.md §4.2's confirmed
   *  `readP3RaceSpriteCells()` table — several races deliberately share a
   *  cell, this is NOT an identity mapping with `index`). */
  sprite: RaceSpriteRef;
}

/**
 * Races always resolve to bank 0 (`heros.cmp`), unlike monsters — see
 * `readP3RaceSpriteCells()`'s doc comment (data-tables.md §4.2).
 */
function resolveRaceSprite(cellIndex: number): RaceSpriteRef {
  const bank = P3_SPRITE_BANKS[0];
  return {
    bankIndex: 0,
    bankFile: bank.file,
    cellIndex,
    normalRect: spriteCellRect(bank, cellIndex, false),
    attackingRect: spriteCellRect(bank, cellIndex, true),
  };
}

export interface SpellRecord {
  index: number;
  name: string;
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
  const exeExists = existsSync(exePath);
  const exe = exeExists ? new Uint8Array(readFileSync(exePath)) : null;
  if (!exeExists) console.warn(`  ⚠ ${exePath} not found — writing empty skills/races/items/spells JSON`);

  const skills = exe ? readP3SkillTables(exe) : [];
  writeJson(resolve(outDir, 'skills.json'), skills);

  let races: RaceRecord[] = [];
  if (exe) {
    const raceCells = readP3RaceSpriteCells(exe);
    races = readP3RaceNames(exe).map((name, index) => ({
      index,
      name,
      sprite: resolveRaceSprite(raceCells[index]),
    }));
  }
  writeJson(resolve(outDir, 'races.json'), races);

  const itemsData: P3ItemsData = exe ? readP3Items(exe) : { items: [], shopMarkups: [] };
  writeJson(resolve(outDir, 'items.json'), itemsData);

  const spells: SpellRecord[] = exe
    ? readP3SpellNames(exe).map((name, index) => ({ index, name }))
    : [];
  writeJson(resolve(outDir, 'spells.json'), spells);

  console.log(
    `Wrote ${entities.length} entities, ${skills.length} skill tables, ${races.length} races, ` +
      `${itemsData.items.length} items, and ${spells.length} spells to ${outDir}`,
  );
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
