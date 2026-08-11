/**
 * Phantasie III world-map build step: turn `Graphics/phantasy.set`'s 50 x 75
 * map array and its 250-tile terrain bank into the same browser-friendly
 * JSON the P1/P2 map viewer already consumes, plus the named-location
 * markers `LocateSpecial()` hardcodes.
 *
 * P3's overworld is structurally unlike P1's and P2's, and the JSON reflects
 * that rather than pretending otherwise:
 *
 * - **No mosaic.** There is one global 50 x 75 grid in one file, so none of
 *   the `section*` fields P1/P2 emit apply and none are written. The viewer
 *   treats their absence as "every cell is real", which for P3 it is.
 * - **No `out*.dat` POI table.** The engine identifies every named place by
 *   hardcoded `(x, y)` comparisons (dungeon-format.md §9.0.5.4), so the POI
 *   list is transcribed in `src/assets/formats/p3-overworld.ts` rather than
 *   parsed out of a data file.
 * - **The terrain byte *is* a graphics index here** — unlike P1/P2, where it
 *   is a class code the engine renders through a separate icon bank. Each
 *   byte selects one of 250 16 x 16 tiles bundled in the same file
 *   (graphics-formats.md §5.3), so P3 gets real terrain art with no
 *   icon-bank blocker: `terrainTiles` is a baked strip of the actual bank
 *   and the viewer blits cells straight out of it.
 * - The terrain *classes* P1/P2 use for their legend still exist for P3, but
 *   as a separate classifier over the same byte (dungeon-format.md §9.0.5.3),
 *   so they ship as an explicit `terrainClassByValue` lookup instead of
 *   P1/P2's implicit `floor(code / 10)`.
 *
 * Output (under `public/assets/phantasieiii/amiga/`):
 *
 * | File                         | Contents                                    |
 * |------------------------------|---------------------------------------------|
 * | `world-map.json`             | grid, class lookup, tile-strip reference     |
 * | `world-map-pois.json`        | `{ pois }` — the 30 hardcoded locations      |
 * | `textures/terrain-tiles.png` | the 250-tile bank as one 25 x 10 strip       |
 * | `screens/world-map.png`      | the whole world pre-rendered, 800 x 1200     |
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePNG, writeJson, findFileCI } from '@seer-project/pipeline';
import {
  SET_TILE_HEIGHT,
  SET_TILE_WIDTH,
  decodeSet,
  renderSetTileSheet,
  renderTileGrid,
  setTileIndexForMapValue,
  type SetFile,
} from '../../src/assets/formats/set.ts';
import {
  P3_OVERWORLD_LOCATIONS,
  P3_TERRAIN_NAMES,
  P3_TERRAIN_UNCLASSIFIED,
  p3TerrainClass,
  p3TerrainClassTable,
  type P3LocationType,
} from '../../src/assets/formats/p3-overworld.ts';
import { indicesToRGBA, type RGB } from '../../src/assets/formats/palette.ts';
import type { ManifestEntry } from './build-assets.ts';

/** Asset name the viewer's manifest entry (and its JSON files) use — same as P1/P2. */
export const WORLD_MAP_ASSET_NAME = 'world-map';

/** Tiles per row in the baked strip. 250 = 25 x 10 exactly, no ragged last row. */
export const TILE_SHEET_COLUMNS = 25;

/**
 * POI marker kind. P1/P2's vocabulary plus `inn`, which P3 has as its own
 * `LocateSpecial()` type (`$282E == 3`) with its own name table, and which
 * neither earlier game distinguishes.
 */
export type WorldPoiType = 'town' | 'dungeon' | 'inn';

export interface WorldPoi {
  /** World column 0-49, east-west, column 0 = west. */
  x: number;
  /** World row 0-74, north-south, row 0 = north. */
  y: number;
  type: WorldPoiType;
  /** The map-array byte at this cell — here a real tile index, not a class code. */
  tile: number;
  /** The engine's own index within its type's name table. */
  index: number;
  /** Byte-exact name from the executable's name table — never invented. */
  label: string;
  /** `D/DNG?.DAT` this entrance opens, dungeons only. */
  file?: string;
}

/**
 * Place the hardcoded location table onto the real map grid, reading each
 * marker's tile out of the file rather than assuming one. Pure — the caller
 * supplies the decoded `.set`, so this is directly testable.
 */
export function buildWorldPois(set: SetFile): WorldPoi[] {
  const pois = P3_OVERWORLD_LOCATIONS.map((loc): WorldPoi => {
    const type: P3LocationType = loc.type;
    return {
      x: loc.x,
      y: loc.y,
      type,
      tile: set.mapArray[loc.y * set.mapWidth + loc.x],
      index: loc.index,
      label: loc.name,
      ...(loc.file ? { file: loc.file } : {}),
    };
  });
  pois.sort((a, b) => a.y - b.y || a.x - b.x);
  return pois;
}

/**
 * One representative colour per terrain class: the mean colour of every
 * pixel the class actually contributes to the rendered world, weighted by
 * how many cells use each of its tiles. Derived from the real artwork, not
 * chosen by eye — and a mean rather than a mode, because several classes'
 * modal ink is the same flat green or brown while their overall look is
 * plainly different (Meadows vs Forest, Mountains vs A bridge). Classes the
 * shipped map never uses get no entry (`null`), so the legend cannot invent
 * a swatch for terrain that is not there.
 *
 * `cells`/`classify` default to the overworld's own array and classifier so
 * every existing call keeps working unchanged; `build-castle-maps.ts` passes
 * a plane's own grid and (for the Netherworld) its re-banded classifier,
 * since the overworld's `phantasy.set` array never uses the castle/
 * Netherworld-only value bands and would otherwise leave those classes with
 * no colour at all.
 */
export function terrainClassColors(
  set: SetFile,
  cells: ArrayLike<number> = set.mapArray,
  classify: (value: number) => number = p3TerrainClass,
): (string | null)[] {
  const sums = P3_TERRAIN_NAMES.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
  const cellsPerValue = new Map<number, number>();
  for (let i = 0; i < cells.length; i++) {
    const value = cells[i];
    cellsPerValue.set(value, (cellsPerValue.get(value) ?? 0) + 1);
  }

  for (const [value, weight] of cellsPerValue) {
    const cls = classify(value);
    if (cls === P3_TERRAIN_UNCLASSIFIED) continue;
    const tile = setTileIndexForMapValue(value, set.tiles.count);
    const base = tile * SET_TILE_WIDTH * SET_TILE_HEIGHT;
    const acc = sums[cls];
    for (let i = 0; i < SET_TILE_WIDTH * SET_TILE_HEIGHT; i++) {
      const color = set.palette[set.tiles.indices[base + i]];
      acc.r += color.r * weight;
      acc.g += color.g * weight;
      acc.b += color.b * weight;
      acc.n += weight;
    }
  }

  return sums.map((acc) =>
    acc.n === 0
      ? null
      : rgbToHex({
          r: Math.round(acc.r / acc.n),
          g: Math.round(acc.g / acc.n),
          b: Math.round(acc.b / acc.n),
        }),
  );
}

function rgbToHex(color: RGB): string {
  const hex = (v: number) => Math.min(Math.max(Math.round(v), 0), 255).toString(16).padStart(2, '0');
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

/**
 * Render the whole 50 x 75 world at native tile resolution (800 x 1200) by
 * blitting each cell's tile — the same thing the game's 9 x 9 viewport
 * blitter at hunk-0 addr `0x3834` does, just for every cell at once.
 */
export function renderWorldImage(set: SetFile): { width: number; height: number; pixels: Uint8Array } {
  return renderTileGrid(set.tiles, set.mapArray, set.mapWidth, set.mapHeight);
}

/**
 * Read the real file and emit the map artefacts. Returns the manifest
 * entries to merge into `manifest.json` (empty if the data is missing).
 */
export function buildWorldMap(dataDir: string, outDir: string): ManifestEntry[] {
  const graphicsDir = resolve(dataDir, findFileCI(dataDir, 'Graphics'));
  const setPath = resolve(graphicsDir, findFileCI(graphicsDir, 'phantasy.set'));
  if (!existsSync(setPath)) {
    console.warn('  ⚠ Graphics/phantasy.set not found — skipping world map');
    return [];
  }

  const set = decodeSet(new Uint8Array(readFileSync(setPath)));

  mkdirSync(resolve(outDir, 'textures'), { recursive: true });
  mkdirSync(resolve(outDir, 'screens'), { recursive: true });

  const sheet = renderSetTileSheet(set.tiles, TILE_SHEET_COLUMNS);
  // `false`: index 0 is an ordinary opaque colour in the terrain bank (it is
  // the ink most of the land tiles are outlined in), not a transparency key.
  writePNG(
    resolve(outDir, 'textures/terrain-tiles.png'),
    indicesToRGBA(sheet.indices, set.palette, false),
    sheet.width,
    sheet.height,
  );
  writeJson(resolve(outDir, 'textures/terrain-tiles.json'), {
    width: sheet.width,
    height: sheet.height,
    frames: Array.from({ length: set.tiles.count }, (_, i) => ({
      name: `tile-${i}`,
      x: (i % TILE_SHEET_COLUMNS) * SET_TILE_WIDTH,
      y: Math.floor(i / TILE_SHEET_COLUMNS) * SET_TILE_HEIGHT,
      w: SET_TILE_WIDTH,
      h: SET_TILE_HEIGHT,
    })),
  });

  const image = renderWorldImage(set);
  writePNG(
    resolve(outDir, `screens/${WORLD_MAP_ASSET_NAME}.png`),
    indicesToRGBA(image.pixels, set.palette, false),
    image.width,
    image.height,
  );

  const pois = buildWorldPois(set);

  // Compact: the grid is 3,750 numbers and one-per-line is unreadable anyway.
  writeJson(
    resolve(outDir, `${WORLD_MAP_ASSET_NAME}.json`),
    {
      width: set.mapWidth,
      height: set.mapHeight,
      cellWidth: SET_TILE_WIDTH,
      cellHeight: SET_TILE_HEIGHT,
      terrainClassNames: P3_TERRAIN_NAMES,
      // P3's class is a banded classifier over the byte, not P1/P2's
      // `floor(code / 10)` — ship the lookup so the viewer needs no rule.
      terrainClassByValue: p3TerrainClassTable(),
      terrainClassColors: terrainClassColors(set),
      terrainTiles: 'textures/terrain-tiles.png',
      terrainTileColumns: TILE_SHEET_COLUMNS,
      terrainTileCount: set.tiles.count,
      image: `screens/${WORLD_MAP_ASSET_NAME}.png`,
      imageWidth: image.width,
      imageHeight: image.height,
      cells: Array.from(set.mapArray),
    },
    false,
  );
  writeJson(resolve(outDir, `${WORLD_MAP_ASSET_NAME}-pois.json`), { pois });

  console.log(
    `  World map: ${set.mapWidth}×${set.mapHeight} cells, ${pois.length} POIs, ` +
      `${set.tiles.count} terrain tiles → ${outDir}`,
  );

  return [
    {
      name: WORLD_MAP_ASSET_NAME,
      type: 'map',
      sprites: 0,
      hasPalette: false,
      png: `screens/${WORLD_MAP_ASSET_NAME}.png`,
    },
  ];
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasieiii/build-map.ts <dataDir> [outDir]');
    process.exit(1);
  }
  const outDir = process.argv[3] ?? resolve('public/assets/phantasieiii/amiga');
  const entries = buildWorldMap(dataDir, outDir);
  // Dynamically imported so the standalone path is the only thing that
  // creates a build-assets -> build-map -> build-assets module cycle.
  const { upsertManifest } = await import('./build-assets.ts');
  upsertManifest(outDir, entries);
}

// Exact-path comparison — see the matching comment in build-assets.ts.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
