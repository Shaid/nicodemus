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
import { writePNG, writeJson, type PlatformConfig } from '@seer/pipeline';
import { decodeCmp, cmpToRGBA } from '../../src/assets/formats/cmp.ts';
import { decodeSet } from '../../src/assets/formats/set.ts';
import { indicesToRGBA } from '../../src/assets/formats/palette.ts';
import { P3_SPRITE_BANKS } from '../../src/assets/formats/sprite-bank.ts';
// getGameConfig is dynamically imported inside main() (CLI-only) to avoid a
// static circular import — game-config.ts imports buildAssets from this
// file to register the pipeline step.

interface ManifestEntry {
  name: string;
  sprites: number;
  hasPalette: boolean;
  png: string;
}

/** Upsert-by-name merge into an existing manifest.json, since multiple
 *  build steps may contribute entries (see AGENTS conventions). */
function upsertManifest(outDir: string, entries: ManifestEntry[]): void {
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

function buildCmpAssets(graphicsDir: string, outDir: string): ManifestEntry[] {
  const files = readdirSync(graphicsDir).filter((f) => /\.(cmp|csh)$/i.test(f));
  const entries: ManifestEntry[] = [];

  for (const file of files) {
    const name = baseName(file);
    const data = new Uint8Array(readFileSync(resolve(graphicsDir, file)));
    const image = decodeCmp(data);
    const rgba = cmpToRGBA(image);
    writePNG(resolve(outDir, `${name}.png`), rgba, image.width, image.height);
    writeJson(resolve(outDir, `${name}.pal.json`), {
      colors: image.palette,
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

  // Bonus artifact: the raw map array, for future terrain-semantics work
  // (TODO gfx-set-map-semantics) — not a rendered asset, just decoded data.
  writeJson(resolve(outDir, 'data', 'set-map.json'), {
    width: set.mapWidth,
    height: set.mapHeight,
    unknownByte: set.unknownByte,
    cells: Array.from(set.mapArray),
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

  upsertManifest(outDir, [...cmpEntries, ...setEntries]);

  console.log(`Wrote ${cmpEntries.length + setEntries.length} asset(s) to ${outDir}`);
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
