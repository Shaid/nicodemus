/**
 * Stage 2: decode Phantasie II's raw `.PAT` sprite banks and `.PIC`
 * full-screen pictures into web-native PNG + JSON assets.
 *
 * `.PAT` uses the confirmed ST word-Interleaved plane layout
 * (graphics-formats.md §9) — not P1's Planar layout, despite identical
 * `.pat`/`.PAT` naming and (for `PARTY*.PAT`) a matching file size with P1.
 *
 * `.PIC` (graphics-formats.md §10) uses the same ST word-Interleaved
 * layout plus one of three disassembly-confirmed per-file palette
 * sources — `COVER1.PIC`/`COVER2.PIC` from `START.PRG`, `PELNOR.PIC` from
 * `PHANT.PRG`'s town palette, and `DECOR.PIC`/`FINAL2.PIC`/`CROWD.PIC`
 * from `PHANT.PRG`'s existing monster/race palette.
 *
 * See docs/phantasie/graphics-formats.md §9-§10, docs/phantasie/data-tables.md
 * §2, and docs/phantasie/implementation-plan.md Phase 7.
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePNG, writeJson, findFileCI, type PlatformConfig } from '@seer-project/pipeline';
import { indicesToRGBA, type RGB } from '../../src/assets/formats/palette.ts';
import {
  readP2MonsterNames,
  readP2RaceNames,
  readP2Palette,
  readP2CoverPalette,
  readP2TownPalette,
} from '../../src/assets/formats/exe-data.ts';
import {
  readP2MonsterSpriteTable,
  decodeP2MonsterSprite,
  decodeP2RaceSprite,
  P2_RACE_COUNT,
} from '../../src/assets/formats/sprite-bank.ts';
import {
  decodeP2Pic,
  picToRGBA,
  P2_PIC_PALETTE_SOURCE_BY_FILE,
  type P2PicPaletteSource,
} from '../../src/assets/formats/pic.ts';
// getGameConfig is dynamically imported inside main() (CLI-only) to avoid a
// static circular import — game-config.ts imports buildAssets from this
// file to register the pipeline step.

interface ManifestEntry {
  name: string;
  sprites: number;
  hasPalette: boolean;
  png: string;
}

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

/**
 * Resolve a P2 asset filename against `dataDir` (disk 1, the canonical
 * source — see implementation-plan.md Phase 7), falling back to a sibling
 * `disk2` directory for the handful of files only present there
 * (`MSTR2.PAT`). Disk 2's non-numbered, non-1995-dated files are confirmed
 * pristine shipped assets, not save state (stx-extraction.md §6) — only
 * the `OUT*.DAT`/`TWNS.DAT`/`GUILD.DAT`/`SACK.DAT`/`*.SAV` family is
 * save-tainted, none of which this pipeline touches.
 */
function resolveP2File(dataDir: string, filename: string): string | null {
  const direct = resolve(dataDir, findFileCI(dataDir, filename));
  if (existsSync(direct)) return direct;

  const disk2Dir = join(dirname(dataDir), 'disk2');
  if (existsSync(disk2Dir)) {
    const viaDisk2 = resolve(disk2Dir, findFileCI(disk2Dir, filename));
    if (existsSync(viaDisk2)) return viaDisk2;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grid atlas packer — lays out variable-size sprites into one PNG, cell
// size = the largest sprite's bounding box (frames record each sprite's
// real, possibly-smaller, w/h). Same approach as tools/phantasie/build-assets.ts.
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
// .PAT sprite banks — confirmed P2 palette (data-tables.md §2.3) + confirmed
// ST word-Interleaved plane layout (graphics-formats.md §9).
// ---------------------------------------------------------------------------

function buildMonsterBankAsset(
  dataDir: string,
  outDir: string,
  patFile: string,
  atlasName: string,
  exe: Uint8Array,
  palette: RGB[],
): ManifestEntry | null {
  const patPath = resolveP2File(dataDir, patFile);
  if (!patPath) return null;

  const patData = new Uint8Array(readFileSync(patPath));
  const refs = readP2MonsterSpriteTable(exe);
  const names = readP2MonsterNames(exe);

  const sprites = refs.map((ref, i) => ({
    name: `${i}-${names[i] || 'unknown'}`,
    width: ref.width,
    height: ref.height,
    indices: decodeP2MonsterSprite(patData, ref),
  }));

  const atlas = packGridAtlas(sprites, palette, 10);
  return writeAtlas(outDir, atlasName, atlas, palette);
}

function buildRaceBankAsset(
  dataDir: string,
  outDir: string,
  patFile: string,
  atlasName: string,
  exe: Uint8Array,
  palette: RGB[],
): ManifestEntry | null {
  const patPath = resolveP2File(dataDir, patFile);
  if (!patPath) return null;

  const patData = new Uint8Array(readFileSync(patPath));
  const names = readP2RaceNames(exe);

  const sprites = Array.from({ length: P2_RACE_COUNT }, (_, i) => ({
    name: `${i}-${names[i] || 'unknown'}`,
    width: 32,
    height: 32,
    indices: decodeP2RaceSprite(patData, i),
  }));

  const atlas = packGridAtlas(sprites, palette, 8);
  return writeAtlas(outDir, atlasName, atlas, palette);
}

// ---------------------------------------------------------------------------
// .PIC full-screen pictures — graphics-formats.md §10. Fixed filename list
// (not a directory scan) since the six files are split across disk1/disk2
// and resolved the same way `.PAT` is, via `resolveP2File`.
// ---------------------------------------------------------------------------

const P2_PIC_FILES = ['COVER1.PIC', 'COVER2.PIC', 'PELNOR.PIC', 'DECOR.PIC', 'FINAL2.PIC', 'CROWD.PIC'];

function buildP2PicAssets(
  dataDir: string,
  outDir: string,
  exe: Uint8Array | null,
  startPrg: Uint8Array | null,
): ManifestEntry[] {
  const entries: ManifestEntry[] = [];

  const paletteBySource: Partial<Record<P2PicPaletteSource, RGB[]>> = {};
  if (startPrg) paletteBySource.cover = readP2CoverPalette(startPrg);
  if (exe) paletteBySource.town = readP2TownPalette(exe);
  if (exe) paletteBySource.monsterRace = readP2Palette(exe);

  for (const file of P2_PIC_FILES) {
    const picPath = resolveP2File(dataDir, file);
    if (!picPath) {
      console.warn(`  ⚠ ${file} not found — skipping`);
      continue;
    }
    const name = file.replace(/\.pic$/i, '').toLowerCase();
    const source = P2_PIC_PALETTE_SOURCE_BY_FILE[name];
    const palette = source ? paletteBySource[source] : undefined;
    if (!palette) {
      console.warn(`  ⚠ ${file}: no palette available for source '${source}' — skipping`);
      continue;
    }

    const data = new Uint8Array(readFileSync(picPath));
    const image = decodeP2Pic(data);
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

/** Stage 2 entrypoint — registered as `buildAssets` in `game-config.ts`. */
export function buildAssets(config: PlatformConfig, dataDir: string): void {
  const outDir = resolve('public/assets', config.assetDir, config.platform);
  mkdirSync(outDir, { recursive: true });

  const entries: ManifestEntry[] = [];

  const exeName = config.executable ?? 'PHANT.PRG';
  const exePath = resolve(dataDir, findFileCI(dataDir, exeName));
  let exe: Uint8Array | null = null;
  if (existsSync(exePath)) {
    exe = new Uint8Array(readFileSync(exePath));
    const palette = readP2Palette(exe);

    const mstr1 = buildMonsterBankAsset(dataDir, outDir, 'MSTR1.PAT', 'mstr1', exe, palette);
    if (mstr1) entries.push(mstr1);
    const mstr2 = buildMonsterBankAsset(dataDir, outDir, 'MSTR2.PAT', 'mstr2', exe, palette);
    if (mstr2) entries.push(mstr2);
    const party1 = buildRaceBankAsset(dataDir, outDir, 'PARTY1.PAT', 'party1', exe, palette);
    if (party1) entries.push(party1);
    const party2 = buildRaceBankAsset(dataDir, outDir, 'PARTY2.PAT', 'party2', exe, palette);
    if (party2) entries.push(party2);
  } else {
    console.warn(`  ⚠ ${exePath} not found — skipping .PAT sprite bank assets`);
  }

  let startPrg: Uint8Array | null = null;
  const startPrgPath = resolveP2File(dataDir, 'START.PRG');
  if (startPrgPath) {
    startPrg = new Uint8Array(readFileSync(startPrgPath));
  } else {
    console.warn('  ⚠ START.PRG not found — skipping COVER1.PIC/COVER2.PIC (no palette source)');
  }

  entries.push(...buildP2PicAssets(dataDir, outDir, exe, startPrg));

  upsertManifest(outDir, entries);
  console.log(`Wrote ${entries.length} asset(s) to ${outDir}`);
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasieii/build-assets.ts <dataDir>');
    process.exit(1);
  }

  const { getGameConfig } = await import('../shared/game-config.ts');
  const config = getGameConfig('phantasieii', 'atarist');
  if (!config) throw new Error('Missing phantasieii/atarist config');

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
