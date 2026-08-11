/**
 * Phantasie III's three non-overworld map assets: the Castle of Light, the
 * Castle of Dark and the Netherworld — `D/PLN1`, `D/PLN2`, `D/PLN4`.
 *
 * See docs/phantasie/dungeon-format.md §9.0.3.4/§9.0.3.4a and
 * `src/assets/formats/pln.ts`'s module comment for the full decode and the
 * byte-exact proof these three grids index the *same* 250-tile bank
 * `Graphics/phantasy.set` bundles (`tools/phantasieiii/build-map.ts`
 * already bakes that bank to `textures/terrain-tiles.png` — this step
 * reuses that file rather than re-emitting it).
 *
 * Each plane gets the same `WorldMapData`/`WorldPoi` JSON shape the
 * overworld ships (`tools/viewer/map-viewer.ts`'s format-agnostic map
 * view), just smaller and with no mosaic fields (a single global grid,
 * same as the overworld):
 *
 * | File                              | Contents                              |
 * |------------------------------------|---------------------------------------|
 * | `<plane>.json`                     | grid, class lookup, tile-strip ref    |
 * | `<plane>-pois.json`                | `{ pois }` — the plane's 2 markers    |
 * | `screens/<plane>.png`              | the whole plane pre-rendered          |
 *
 * The Netherworld uses its own re-banded terrain classifier
 * (`p3NetherworldTerrainClass`); the two castles use the ordinary overworld
 * one (`p3TerrainClass`) — `dungeon-format.md` §9.0.3.4 confirms the
 * castles' cell values fall in the *standard* Bright-mist/Dense-Fog bands,
 * not the Netherworld-only re-banding, which is gated on a flag the game
 * only sets for the Netherworld.
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePNG, writeJson, findFileCI } from '@seer-project/pipeline';
import { decodeSet, renderTileGrid, type SetFile } from '../../src/assets/formats/set.ts';
import { decodePln, type PlnGrid } from '../../src/assets/formats/pln.ts';
import {
  P3_PLANES,
  P3_TERRAIN_NAMES,
  p3NetherworldTerrainClassTable,
  planeLocations,
  type P3Plane,
} from '../../src/assets/formats/p3-planes.ts';
import { p3TerrainClassTable } from '../../src/assets/formats/p3-overworld.ts';
import { indicesToRGBA } from '../../src/assets/formats/palette.ts';
import { terrainClassColors, TILE_SHEET_COLUMNS } from './build-map.ts';
import type { ManifestEntry } from './build-assets.ts';
import type { WorldPoi } from './build-map.ts';

/** `<plane>` asset-name key each of `P3_PLANES` maps to. */
export const PLANE_ASSET_NAMES: Record<P3Plane['id'], string> = {
  1: 'castle-of-light',
  2: 'castle-of-dark',
  4: 'netherworld',
};

/** Per plane-id, the `256`-entry `value -> class` table it renders through. */
function terrainClassTableFor(id: P3Plane['id']): number[] {
  return id === 4 ? p3NetherworldTerrainClassTable() : p3TerrainClassTable();
}

/** Build one plane's POI list from its two `LocateSpecial()` markers, reading the real cell byte. */
export function buildPlanePois(plane: P3Plane, grid: PlnGrid): WorldPoi[] {
  return planeLocations(plane.id).map((loc): WorldPoi => ({
    x: loc.x,
    y: loc.y,
    type: loc.type,
    tile: grid.cells[loc.y * grid.width + loc.x],
    index: loc.index,
    label: loc.name,
    ...(loc.file ? { file: loc.file } : {}),
  }));
}

/**
 * Read `Graphics/phantasy.set` (for the shared palette + tile bank) and
 * every `D/PLNn` file that exists, and emit each plane's map artefacts.
 * Returns the manifest entries to merge into `manifest.json`; a missing
 * `.set` or `PLNn` file just means fewer entries, not a hard failure.
 */
export function buildCastleMaps(dataDir: string, outDir: string): ManifestEntry[] {
  const graphicsDir = resolve(dataDir, findFileCI(dataDir, 'Graphics'));
  const setPath = resolve(graphicsDir, findFileCI(graphicsDir, 'phantasy.set'));
  if (!existsSync(setPath)) {
    console.warn('  ⚠ Graphics/phantasy.set not found — skipping castle/Netherworld maps');
    return [];
  }
  const set: SetFile = decodeSet(new Uint8Array(readFileSync(setPath)));

  const dDir = resolve(dataDir, 'D');
  if (!existsSync(dDir)) {
    console.warn('  ⚠ D/ folder not found — skipping castle/Netherworld maps');
    return [];
  }

  mkdirSync(resolve(outDir, 'screens'), { recursive: true });

  const entries: ManifestEntry[] = [];
  const classColorCache = new Map<string, (string | null)[]>();

  for (const plane of P3_PLANES) {
    const planeFile = resolve(dDir, findFileCI(dDir, plane.file.slice(2).toLowerCase())); // 'D/PLN1' -> 'pln1'
    if (!existsSync(planeFile)) {
      console.warn(`  ⚠ ${plane.file} not found — skipping ${plane.name}`);
      continue;
    }

    const grid = decodePln(new Uint8Array(readFileSync(planeFile)), plane.width, plane.height);
    const name = PLANE_ASSET_NAMES[plane.id];
    const terrainClassByValue = terrainClassTableFor(plane.id);
    const classify = (value: number) => terrainClassByValue[value] ?? -1;

    let colors = classColorCache.get(name);
    if (!colors) {
      colors = terrainClassColors(set, grid.cells, classify);
      classColorCache.set(name, colors);
    }

    const image = renderTileGrid(set.tiles, grid.cells, grid.width, grid.height);
    writePNG(
      resolve(outDir, `screens/${name}.png`),
      indicesToRGBA(image.pixels, set.palette, false),
      image.width,
      image.height,
    );

    const pois = buildPlanePois(plane, grid);

    writeJson(resolve(outDir, `${name}.json`), {
      width: grid.width,
      height: grid.height,
      cellWidth: set.tiles.tileWidth,
      cellHeight: set.tiles.tileHeight,
      terrainClassNames: P3_TERRAIN_NAMES,
      terrainClassByValue,
      terrainClassColors: colors,
      // Reuse the overworld's already-baked bank — same file, same tile
      // indices (pln.ts's module comment has the byte-exact proof).
      terrainTiles: 'textures/terrain-tiles.png',
      terrainTileColumns: TILE_SHEET_COLUMNS,
      terrainTileCount: set.tiles.count,
      image: `screens/${name}.png`,
      imageWidth: image.width,
      imageHeight: image.height,
      cells: Array.from(grid.cells),
    });
    writeJson(resolve(outDir, `${name}-pois.json`), { pois });

    console.log(`  ${plane.name}: ${grid.width}×${grid.height} cells, ${pois.length} POIs → ${outDir}`);

    entries.push({
      name,
      type: 'map',
      sprites: 0,
      hasPalette: false,
      png: `screens/${name}.png`,
    });
  }

  return entries;
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasieiii/build-castle-maps.ts <dataDir> [outDir]');
    process.exit(1);
  }
  const outDir = process.argv[3] ?? resolve('public/assets/phantasieiii/amiga');
  const entries = buildCastleMaps(dataDir, outDir);
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
