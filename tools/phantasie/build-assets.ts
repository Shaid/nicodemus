/**
 * Stage 2: decode Phantasie I's raw `.pic` pictures and `.pat` sprite banks
 * into web-native PNG + JSON assets.
 *
 * See docs/phantasie/graphics-formats.md §3 and §7, and
 * docs/phantasie/implementation-plan.md Phase 4.
 */
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePNG, writeJson, findFileCI, type PlatformConfig } from '@seer-project/pipeline';
import {
  decodePic,
  picToRGBA,
  picGreyscalePalette,
  PIC_PALETTE_SLOT_BY_FILE,
} from '../../src/assets/formats/pic.ts';
import { indicesToRGBA, type RGB } from '../../src/assets/formats/palette.ts';
import {
  readP1MonsterNames,
  readP1RaceNames,
  readP1Palette,
  readP1PaletteSlot,
} from '../../src/assets/formats/exe-data.ts';
import {
  readP1MonsterSpriteTable,
  decodeP1MonsterSprite,
  decodeP1RaceSprite,
  P1_RACE_COUNT,
} from '../../src/assets/formats/sprite-bank.ts';
import { buildWorldMap } from './build-map.ts';
// getGameConfig is dynamically imported inside main() (CLI-only) to avoid a
// static circular import — game-config.ts imports buildAssets from this
// file to register the pipeline step.

export interface ManifestEntry {
  name: string;
  sprites: number;
  hasPalette: boolean;
  png: string;
  /**
   * Which viewer to open the entry in. Absent (the default) means the
   * ordinary sprite-atlas / picture view; `'map'` is the world-map view,
   * which reads `<name>.json` + `<name>-pois.json` instead of a PNG.
   */
  type?: 'atlas' | 'map';
}

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

// ---------------------------------------------------------------------------
// .pic full-screen pictures. All six files now have a confirmed in-game
// palette, selected per file by `PIC_PALETTE_SLOT_BY_FILE` (an index into
// the executable's five-slot palette array) — see graphics-formats.md §3 and
// data-tables.md §1.3a. The greyscale substitute survives only for a `.pic`
// that isn't in the map (i.e. an unexpected extra file), and for the case
// where the executable itself is missing from the data dir.
// ---------------------------------------------------------------------------

function buildPicAssets(dataDir: string, outDir: string, game: Uint8Array | null): ManifestEntry[] {
  const files = readdirSync(dataDir).filter((f) => /\.pic$/i.test(f));
  const greyscale = picGreyscalePalette();
  const entries: ManifestEntry[] = [];

  for (const file of files) {
    const name = file.replace(/\.pic$/i, '');
    const slot = PIC_PALETTE_SLOT_BY_FILE[name.toLowerCase()];
    const palette = game && slot !== undefined ? readP1PaletteSlot(game, slot) : greyscale;
    if (palette === greyscale) {
      console.warn(`  ⚠ ${file}: no confirmed palette slot — falling back to greyscale`);
    }
    const data = new Uint8Array(readFileSync(resolve(dataDir, file)));
    const image = decodePic(data);
    const rgba = picToRGBA(image, palette);
    writePNG(resolve(outDir, `${name}.png`), rgba, image.width, image.height);
    writeJson(resolve(outDir, `${name}.pal.json`), { colors: palette });
    writeJson(resolve(outDir, `${name}.json`), {
      frames: [],
      width: image.width,
      height: image.height,
    });
    entries.push({ name, sprites: 0, hasPalette: true, png: `${name}.png` });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Grid atlas packer — lays out variable-size sprites into one PNG, cell
// size = the largest sprite's bounding box (frames record each sprite's
// real, possibly-smaller, w/h).
// ---------------------------------------------------------------------------

interface AtlasFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function packGridAtlas(
  sprites: { name: string; width: number; height: number; indices: Uint8Array }[],
  palette: RGB[],
  columns: number,
): { rgba: Uint8Array; width: number; height: number; frames: AtlasFrame[] } {
  const cellW = Math.max(...sprites.map((s) => s.width));
  const cellH = Math.max(...sprites.map((s) => s.height));
  const rows = Math.ceil(sprites.length / columns);
  const atlasWidth = columns * cellW;
  const atlasHeight = rows * cellH;
  const rgba = new Uint8Array(atlasWidth * atlasHeight * 4); // transparent background

  const frames: AtlasFrame[] = [];
  sprites.forEach((sprite, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * cellW;
    const y = row * cellH;
    const spriteRgba = indicesToRGBA(sprite.indices, palette, true);
    for (let sy = 0; sy < sprite.height; sy++) {
      const srcStart = sy * sprite.width * 4;
      const dstStart = ((y + sy) * atlasWidth + x) * 4;
      rgba.set(spriteRgba.subarray(srcStart, srcStart + sprite.width * 4), dstStart);
    }
    frames.push({ name: sprite.name, x, y, w: sprite.width, h: sprite.height });
  });

  return { rgba, width: atlasWidth, height: atlasHeight, frames };
}

function writeAtlas(
  outDir: string,
  name: string,
  atlas: { rgba: Uint8Array; width: number; height: number; frames: AtlasFrame[] },
  palette: RGB[],
): ManifestEntry {
  writePNG(resolve(outDir, `${name}.png`), atlas.rgba, atlas.width, atlas.height);
  writeJson(resolve(outDir, `${name}.pal.json`), { colors: palette });
  writeJson(resolve(outDir, `${name}.json`), {
    frames: atlas.frames,
    width: atlas.width,
    height: atlas.height,
  });
  return { name, sprites: atlas.frames.length, hasPalette: true, png: `${name}.png` };
}

// ---------------------------------------------------------------------------
// .pat sprite banks — confirmed P1 palette (data-tables.md §1.3).
// ---------------------------------------------------------------------------

function buildMonsterBankAsset(
  dataDir: string,
  outDir: string,
  patFile: string,
  atlasName: string,
  game: Uint8Array,
  palette: RGB[],
): ManifestEntry | null {
  const patPath = resolve(dataDir, findFileCI(dataDir, patFile));
  if (!existsSync(patPath)) return null;

  const patData = new Uint8Array(readFileSync(patPath));
  const refs = readP1MonsterSpriteTable(game);
  const names = readP1MonsterNames(game);

  const sprites = refs.map((ref, i) => ({
    name: `${i}-${names[i] || 'unknown'}`,
    width: ref.width,
    height: ref.height,
    indices: decodeP1MonsterSprite(patData, ref),
  }));

  const atlas = packGridAtlas(sprites, palette, 10);
  return writeAtlas(outDir, atlasName, atlas, palette);
}

function buildRaceBankAsset(
  dataDir: string,
  outDir: string,
  patFile: string,
  atlasName: string,
  game: Uint8Array,
  palette: RGB[],
): ManifestEntry | null {
  const patPath = resolve(dataDir, findFileCI(dataDir, patFile));
  if (!existsSync(patPath)) return null;

  const patData = new Uint8Array(readFileSync(patPath));
  const names = readP1RaceNames(game);

  const sprites = Array.from({ length: P1_RACE_COUNT }, (_, i) => ({
    name: `${i}-${names[i] || 'unknown'}`,
    width: 32,
    height: 32,
    indices: decodeP1RaceSprite(patData, i),
  }));

  const atlas = packGridAtlas(sprites, palette, 8);
  return writeAtlas(outDir, atlasName, atlas, palette);
}

/** Stage 2 entrypoint — registered as `buildAssets` in `game-config.ts`. */
export function buildAssets(config: PlatformConfig, dataDir: string): void {
  const outDir = resolve('public/assets', config.assetDir, config.platform);
  mkdirSync(outDir, { recursive: true });

  const entries: ManifestEntry[] = [];

  const exeName = config.executable ?? 'game';
  const gamePath = resolve(dataDir, findFileCI(dataDir, exeName));
  const game = existsSync(gamePath) ? new Uint8Array(readFileSync(gamePath)) : null;
  const monsterRacePalette = game ? readP1Palette(game) : undefined;

  entries.push(...buildPicAssets(dataDir, outDir, game));

  if (game) {
    const palette = monsterRacePalette!;

    const mstr1 = buildMonsterBankAsset(dataDir, outDir, 'mstr1.pat', 'mstr1', game, palette);
    if (mstr1) entries.push(mstr1);
    const mstr2 = buildMonsterBankAsset(dataDir, outDir, 'mstr2.pat', 'mstr2', game, palette);
    if (mstr2) entries.push(mstr2);
    const party1 = buildRaceBankAsset(dataDir, outDir, 'party1.pat', 'party1', game, palette);
    if (party1) entries.push(party1);
    const party2 = buildRaceBankAsset(dataDir, outDir, 'party2.pat', 'party2', game, palette);
    if (party2) entries.push(party2);
  } else {
    console.warn(`  ⚠ ${gamePath} not found — skipping .pat sprite bank assets`);
  }

  // The overworld: maps.int + out*.dat -> world-map.json / world-map-pois.json.
  entries.push(...buildWorldMap(dataDir, outDir));

  upsertManifest(outDir, entries);
  console.log(`Wrote ${entries.length} asset(s) to ${outDir}`);
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasie/build-assets.ts <dataDir>');
    process.exit(1);
  }

  const { getGameConfig } = await import('../shared/game-config.ts');
  const config = getGameConfig('phantasie', 'amiga');
  if (!config) throw new Error('Missing phantasie/amiga config');

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
