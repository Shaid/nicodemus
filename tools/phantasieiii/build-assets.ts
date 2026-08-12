/**
 * Stage 2: decode Phantasie III's `.cmp`/`.csh`/`.set` resource files into
 * web-native PNG + JSON assets for the runtime engine and asset viewer.
 *
 * See docs/phantasie/graphics-formats.md §4-§6 and
 * docs/phantasie/implementation-plan.md Phase 1.
 */
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePNG, writeJson, type PlatformConfig } from '@seer-project/pipeline';
import { decodeCmp, cmpToRGBA, decodeCmpHeaderPalette } from '../../src/assets/formats/cmp.ts';
import { decodeSet } from '../../src/assets/formats/set.ts';
import { indicesToRGBA, type RGB } from '../../src/assets/formats/palette.ts';
import {
  P3_SPRITE_BANKS,
  P3_ENCOUNTER_PALETTE_BANK,
  isP3SpriteBankFile,
} from '../../src/assets/formats/sprite-bank.ts';
import { buildWorldMap } from './build-map.ts';
import { buildCastleMaps } from './build-castle-maps.ts';
import { buildMusicAssets } from './build-music.ts';
import { buildDungeons } from './build-dungeons.ts';
import { buildDataTables } from './build-data-tables.ts';
// getGameConfig is dynamically imported inside main() (CLI-only) to avoid a
// static circular import — game-config.ts imports buildAssets from this
// file to register the pipeline step.

export interface ManifestEntry {
  name: string;
  sprites: number;
  hasPalette: boolean;
  png: string;
  /**
   * Which view the entry opens in. Absent (the default) means the ordinary
   * sprite-atlas / picture canvas; `'map'` is the world-map view, which
   * reads `<name>.json` + `<name>-pois.json` instead of an atlas; `'music'`
   * is the player, which reads `music/<name>.bin` and decodes it in the
   * browser (see `tools/phantasieiii/build-music.ts`). `'dungeon'` is a
   * decoded dungeon level (grid + star/action tables + messages) —
   * `<name>.json` holds the full document; see `build-dungeons.ts` and
   * `scripting-engine.md`. `'data-table'` is a browsable data table
   * (monsters/races/items/spells/skills, no PNG) — `<name>.json` holds a
   * flat array of row objects; see `build-data-tables.ts` and the public
   * site's `DataTable.astro`.
   */
  type?: 'atlas' | 'map' | 'music' | 'dungeon' | 'data-table';
}

/** Upsert-by-name merge into an existing manifest.json, since multiple
 *  build steps may contribute entries (see AGENTS conventions). */
export function upsertManifest(outDir: string, entries: ManifestEntry[]): void {
  const manifestPath = resolve(outDir, 'manifest.json');
  let existing: ManifestEntry[] = [];
  if (existsSync(manifestPath)) {
    try {
      existing = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestEntry[];
    } catch {
      existing = [];
    }
  }
  const byName = new Map(existing.map((e) => [e.name, e]));
  for (const entry of entries) byName.set(entry.name, entry);
  writeJson(manifestPath, Array.from(byName.values()));
}

/** Name of a `.cmp`/`.csh` file without its extension — the asset key. */
function baseName(filename: string): string {
  return filename.replace(/\.(cmp|csh)$/i, '');
}

/**
 * The palette the game actually installs for the encounter screen — the
 * header palette of `heros.cmp` (sprite bank 0). Every sprite bank renders
 * under it; the other six banks' own header palettes are loaded into a
 * shared scratch global and then discarded without ever reaching the
 * hardware. See graphics-formats.md §4.5 for the disassembly evidence.
 */
function readEncounterPalette(graphicsDir: string): RGB[] | undefined {
  const path = resolve(graphicsDir, P3_ENCOUNTER_PALETTE_BANK);
  if (!existsSync(path)) return undefined;
  return decodeCmpHeaderPalette(new Uint8Array(readFileSync(path)));
}

function buildCmpAssets(graphicsDir: string, outDir: string): ManifestEntry[] {
  const files = readdirSync(graphicsDir).filter((f) => /\.(cmp|csh)$/i.test(f));
  const entries: ManifestEntry[] = [];
  const encounterPalette = readEncounterPalette(graphicsDir);

  for (const file of files) {
    const name = baseName(file);
    const data = new Uint8Array(readFileSync(resolve(graphicsDir, file)));
    // Sprite banks render under the encounter palette, not their own
    // header palette (graphics-formats.md §4.5). `heros.cmp` is itself the
    // source of that palette, so the override is a no-op for it.
    const paletteOverride = isP3SpriteBankFile(file) ? encounterPalette : undefined;
    const image = decodeCmp(data, { palette: paletteOverride });
    const rgba = cmpToRGBA(image);
    writePNG(resolve(outDir, `${name}.png`), rgba, image.width, image.height);
    writeJson(resolve(outDir, `${name}.pal.json`), {
      colors: image.palette,
      // Preserved for provenance where the two differ: the bytes really are
      // in the file, the game just never installs them.
      ...(paletteOverride
        ? { source: P3_ENCOUNTER_PALETTE_BANK, unusedHeaderColors: image.headerPalette }
        : {}),
    });

    // Sprite-bank files additionally get a grid-cell frame list so the
    // viewer/engine can address individual monster/race sprites.
    const bank = P3_SPRITE_BANKS.find((b) => b.file.toLowerCase() === file.toLowerCase());
    const frames = bank
      ? Array.from({ length: bank.cols * bank.rows }, (_, i) => {
          const col = i % bank.cols;
          const row = Math.floor(i / bank.cols);
          return {
            name: `cell${i}`,
            x: col * bank.cellWidth,
            y: row * bank.cellHeight,
            w: bank.cellWidth,
            h: bank.cellHeight,
          };
        })
      : [];

    writeJson(resolve(outDir, `${name}.json`), {
      frames,
      width: image.width,
      height: image.height,
    });

    entries.push({ name, sprites: frames.length, hasPalette: true, png: `${name}.png` });
  }

  return entries;
}

function buildSetAssets(graphicsDir: string, outDir: string): ManifestEntry[] {
  const setPath = resolve(graphicsDir, 'phantasy.set');
  if (!existsSync(setPath)) return [];

  const data = new Uint8Array(readFileSync(setPath));
  const set = decodeSet(data);
  const rgba = indicesToRGBA(set.picture.indices, set.palette, false);
  const name = 'phantasy';
  writePNG(resolve(outDir, `${name}.png`), rgba, set.picture.width, set.picture.height);
  writeJson(resolve(outDir, `${name}.pal.json`), { colors: set.palette });
  writeJson(resolve(outDir, `${name}.json`), {
    frames: [],
    width: set.picture.width,
    height: set.picture.height,
  });

  return [{ name, sprites: 0, hasPalette: true, png: `${name}.png` }];
}

/** Stage 2 entrypoint — registered as `buildAssets` in `game-config.ts`. */
export function buildAssets(config: PlatformConfig, dataDir: string): void {
  const outDir = resolve('public/assets', config.assetDir, config.platform);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(resolve(outDir, 'data'), { recursive: true });

  const graphicsDir = resolve(dataDir, 'Graphics');
  const cmpEntries = buildCmpAssets(graphicsDir, outDir);
  const setEntries = buildSetAssets(graphicsDir, outDir);
  const mapEntries = buildWorldMap(dataDir, outDir);
  const castleMapEntries = buildCastleMaps(dataDir, outDir);
  const musicEntries = buildMusicAssets(dataDir, outDir);
  const dungeonEntries = buildDungeons(dataDir, outDir);
  const dataTableEntries = buildDataTables(dataDir, outDir);

  const entries = [
    ...cmpEntries,
    ...setEntries,
    ...mapEntries,
    ...castleMapEntries,
    ...musicEntries,
    ...dungeonEntries,
    ...dataTableEntries,
  ];
  upsertManifest(outDir, entries);

  console.log(`Wrote ${entries.length} asset(s) to ${outDir}`);
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasieiii/build-assets.ts <dataDir>');
    process.exit(1);
  }

  const { getGameConfig } = await import('../shared/game-config.ts');
  const config = getGameConfig('phantasieiii', 'amiga');
  if (!config) throw new Error('Missing phantasieiii/amiga config');

  buildAssets(config, dataDir);
}

// Exact-path comparison — see the matching comment in export-game-data.ts:
// every game's build-assets.ts shares the same basename, so a suffix check
// can't tell which one is the real entrypoint.
const isStandalone = process.argv[1] === fileURLToPath(import.meta.url);
if (isStandalone) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
