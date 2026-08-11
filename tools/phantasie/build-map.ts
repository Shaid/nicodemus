/**
 * Phantasie I world-map build step: assemble the 18 outdoor sections into
 * the single 77 x 126 overworld grid and emit it, plus a point-of-interest
 * marker list, as browser-friendly JSON for the asset viewer.
 *
 * See docs/phantasie/dungeon-format.md §8.2 (the `out*.dat` record layout
 * and its POI table) and §8.3 (`maps.int` and how the sections tile). All
 * decoding is done by `src/assets/formats/outdoor.ts`; this module only
 * places section-local data into world coordinates and serialises it.
 *
 * Output (under `public/assets/phantasie/amiga/`):
 *
 * | File                          | Contents                                |
 * |-------------------------------|-----------------------------------------|
 * | `world-map.json`              | `{ width, height, cells }` — flat codes  |
 * | `world-map-pois.json`         | `{ pois }` — world markers + messages    |
 * | `screens/world-map.png`       | the real 1512 x 693 overworld picture    |
 * | `textures/terrain-icons.png`  | the twelve 16 x 16 fill patterns         |
 *
 * Phantasie I's terrain byte is not a per-*cell* graphics index, but the
 * per-section display list's `iconIndex` **is** the terrain class
 * (dungeon-format.md §8.2.4a), so the art is baked by replaying each
 * section's display list as filled polygons and painting the result with
 * that class's 16 x 16 `AreaPtrn` pattern from the executable's icon bank.
 * The gameplay grid stays a separate, flat-coloured layer in the viewer —
 * it is the layer the party walks on, and its axes are the engine's rather
 * than the screen's (see `tools/viewer/map-viewer.ts`).
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePNG, writeJson, findFileCI } from '@seer-project/pipeline';
import { indicesToRGBA } from '../../src/assets/formats/palette.ts';
import { readP1PaletteSlot } from '../../src/assets/formats/exe-data.ts';
import {
  OUTDOOR_SECTION_HEIGHT,
  OUTDOOR_SECTION_WIDTH,
  SECTION_NUMBER_BY_BLOCK,
  TILE_CLASS_DUNGEON,
  TILE_TOWN,
  WORLD_COLUMNS,
  WORLD_SECTION_STRIDE_X,
  WORLD_SECTION_STRIDE_Y,
  EVENT_VARIANT_BUMP,
  EVENT_VARIANT_NONE,
  EVENT_VARIANT_TEXT,
  OUTDOOR_CELL_HEIGHT,
  OUTDOOR_CELL_WIDTH,
  OUTDOOR_ICON_COUNT,
  OUTDOOR_ICON_HEIGHT,
  OUTDOOR_ICON_WIDTH,
  OUTDOOR_MAP_ORIGIN_X,
  OUTDOOR_MAP_ORIGIN_Y,
  OUTDOOR_MAP_HEIGHT,
  OUTDOOR_MAP_WIDTH,
  OUTDOOR_PALETTE_SLOT,
  TERRAIN_CLASS_NAMES,
  assembleWorld,
  decodeOutdoorIconBank,
  rasteriseOutdoorSection,
  decodeMapsInt,
  decodeOutdoorSection,
  poiMessage,
  revealedTileCode,
  tileAt,
  tileClass,
  tileVariant,
  type AssembledWorld,
  type OutdoorSection,
} from '../../src/assets/formats/outdoor.ts';
import type { ManifestEntry } from './build-assets.ts';

/** Asset name the viewer's manifest entry (and its JSON files) use. */
export const WORLD_MAP_ASSET_NAME = 'world-map';

/**
 * The shipped `out*.dat` files in `maps.int` block order. There is no
 * `out17.dat`, so this is *not* `out1..out18` — the section numbers come
 * straight from `SECTION_NUMBER_BY_BLOCK` (dungeon-format.md §8.3.1).
 */
export const OUTDOOR_FILE_NAMES: readonly string[] = SECTION_NUMBER_BY_BLOCK.map(
  (section) => `out${section}.dat`,
);

/**
 * POI kind, derived from the tile the record sits on rather than from the
 * record itself — the tile is what the engine actually dispatches on
 * (dungeon-format.md §8.2.2). Only `town` is confirmed; `dungeon` is the
 * documented hypothesis for tile class 5.
 */
export type WorldPoiType = 'town' | 'dungeon' | 'text' | 'bump' | 'silent' | 'other';

export interface WorldPoi {
  /** Section number 1-19 (the `out*.dat` ordinal), not a `maps.int` block. */
  section: number;
  /** Section-local column 0-19. */
  col: number;
  /** Section-local row 0-25, file order (row 0 = north). */
  row: number;
  /** World column 0-76. */
  x: number;
  /** World row 0-125, row 0 = north. */
  y: number;
  type: WorldPoiType;
  /** Revealed (fog-flag-stripped) tile code the record sits on. */
  tile: number;
  /** Record byte `+2`: message index, town id or dungeon id by type. */
  index: number;
  /** Record byte `+3`: the dungeon entry column on class-5 records (§8.2.2a). */
  param: number;
  /**
   * Short marker caption. Towns carry their real `twns.int` name (§8.2.2a);
   * dungeons are still numbered, since `dng1`-`dng10` ship no name strings.
   */
  label: string;
  /** Resolved text lines, for the records that address the text block. */
  message?: string[];
}

export interface WorldMapOutput {
  world: AssembledWorld;
  pois: WorldPoi[];
}

/**
 * North-west corner of a section in world cells. Identical arithmetic to
 * `assembleWorld()` — `slot = section - 1`, four sections per mosaic row,
 * strides of 19/25 because neighbours share an edge (dungeon-format.md
 * §8.3.2).
 */
export function sectionOrigin(section: number): { x: number; y: number } {
  const slot = section - 1;
  return {
    x: (slot % WORLD_COLUMNS) * WORLD_SECTION_STRIDE_X,
    y: Math.floor(slot / WORLD_COLUMNS) * WORLD_SECTION_STRIDE_Y,
  };
}

/** Place a section-local (col, row) onto the assembled world grid. */
export function sectionCellToWorld(
  section: number,
  col: number,
  row: number,
): { x: number; y: number } {
  if (
    col < 0 ||
    col >= OUTDOOR_SECTION_WIDTH ||
    row < 0 ||
    row >= OUTDOOR_SECTION_HEIGHT
  ) {
    throw new RangeError(
      `section ${section} cell (${col}, ${row}) outside the ` +
        `${OUTDOOR_SECTION_WIDTH}x${OUTDOOR_SECTION_HEIGHT} grid`,
    );
  }
  const origin = sectionOrigin(section);
  return { x: origin.x + col, y: origin.y + row };
}

/** Classify a POI by the tile it sits on, mirroring the engine's dispatch order. */
export function poiTypeForTile(code: number): WorldPoiType {
  const tile = revealedTileCode(code);
  // Whole-tile specials are tested before the variant arms (game+0x18214).
  if (tile === TILE_TOWN) return 'town';
  if (tileClass(tile) === TILE_CLASS_DUNGEON) return 'dungeon';
  switch (tileVariant(tile)) {
    case EVENT_VARIANT_TEXT:
      return 'text';
    case EVENT_VARIANT_BUMP:
      return 'bump';
    case EVENT_VARIANT_NONE:
      return 'silent';
    default:
      return 'other';
  }
}

const LABEL_MAX = 30;

/**
 * `twns.int`'s town-record array: 12 records of 292 bytes at file offset
 * 2446, name at record `+0x118` (dungeon-format.md §8.1 — both the base and
 * the name offset are code-confirmed, from `game+0x7280` and `game+0xA14E`).
 */
export const TWNS_RECORD_BASE = 2446;
export const TWNS_RECORD_STRIDE = 292;
export const TWNS_RECORD_COUNT = 12;
export const TWNS_NAME_OFFSET = 0x118;
export const TWNS_NAME_LENGTH = 10;

/** Read the twelve town names in record order (record 0 = PELNOR). */
export function readTownNames(twnsInt: Uint8Array): string[] {
  const names: string[] = [];
  for (let i = 0; i < TWNS_RECORD_COUNT; i++) {
    const at = TWNS_RECORD_BASE + i * TWNS_RECORD_STRIDE + TWNS_NAME_OFFSET;
    const raw = twnsInt.subarray(at, at + TWNS_NAME_LENGTH);
    let end = raw.length;
    for (let j = 0; j < raw.length; j++) {
      if (raw[j] === 0x00) {
        end = j;
        break;
      }
    }
    names.push(new TextDecoder('ascii').decode(raw.subarray(0, end)).trim());
  }
  return names;
}

/**
 * `SelectTown()` at `game+0xA10C`: the POI record's `+2` is 1-based, and
 * `99` is an explicit alias for record 11 (`OLYMPIA`).
 */
export function townRecordIndex(poiIndex: number): number {
  return poiIndex === 99 ? 11 : poiIndex - 1;
}

function labelFor(
  type: WorldPoiType,
  index: number,
  message: string[] | undefined,
  townNames?: readonly string[],
): string {
  if (type === 'text') {
    const line = message?.find((l) => l !== '');
    if (line) return line.length > LABEL_MAX ? `${line.slice(0, LABEL_MAX - 1)}…` : line;
  }
  switch (type) {
    case 'town': {
      // `+2` is a 1-based index into twns.int's 12 records, with 99 aliased
      // to record 11 — confirmed at `game+0xA10C` (dungeon-format.md §8.2.2a).
      const name = townNames?.[townRecordIndex(index)];
      return name && name !== '' ? name : `Town ${index}`;
    }
    case 'dungeon':
      return `Dungeon ${index}`;
    case 'text':
      return `Text ${index}`;
    case 'bump':
      return `Event ${index}`;
    case 'silent':
      return `Marker ${index}`;
    default:
      return `POI ${index}`;
  }
}

/** Convert one decoded section's POI records into world-coordinate markers. */
export function sectionPoisToWorld(
  section: number,
  decoded: OutdoorSection,
  townNames?: readonly string[],
): WorldPoi[] {
  return decoded.pois.map((poi) => {
    const tile = revealedTileCode(tileAt(decoded.grid, poi.col, poi.row));
    const type = poiTypeForTile(tile);
    const message = type === 'text' ? poiMessage(decoded, poi).filter((l) => l !== '') : undefined;
    const { x, y } = sectionCellToWorld(section, poi.col, poi.row);
    return {
      section,
      col: poi.col,
      row: poi.row,
      x,
      y,
      type,
      tile,
      index: poi.index,
      param: poi.param,
      label: labelFor(type, poi.index, message, townNames),
      ...(message && message.length > 0 ? { message } : {}),
    };
  });
}

/**
 * Assemble the world from already-loaded section grids and collect every
 * section's POI records into world coordinates. Pure — the caller supplies
 * the bytes, so this is directly testable against the real data files.
 *
 * `sectionGrids` is optional: when `maps.int` is available it is the
 * pristine master (§8.3.1) and is preferred, otherwise the grids embedded
 * in the `out*.dat` files are used. Either way the grids must be in
 * `SECTION_NUMBER_BY_BLOCK` order.
 */
export function buildWorldFromSections(
  sections: readonly { section: number; decoded: OutdoorSection }[],
  sectionGrids?: readonly Uint8Array[],
  townNames?: readonly string[],
): WorldMapOutput {
  const grids = sectionGrids ?? sections.map((s) => s.decoded.grid);
  const world = assembleWorld(grids);
  const pois = sections.flatMap((s) => sectionPoisToWorld(s.section, s.decoded, townNames));
  pois.sort((a, b) => a.y - b.y || a.x - b.x);
  return { world, pois };
}

/**
 * World-image geometry. Sections tile 5 wide (east-west) x 4 tall
 * (north-south) sharing one cell at each seam (dungeon-format.md §8.3.2's
 * 2026-08-11 correction), and each cell is drawn 12 x 9 pixels
 * (`game+0x173B0`), so the assembled overworld picture is
 * `126 * 12` x `77 * 9` = 1512 x 693.
 */
export const WORLD_MOSAIC_COLUMNS = 5;
export const WORLD_MOSAIC_ROWS = 4;
export const WORLD_IMAGE_WIDTH =
  ((WORLD_MOSAIC_COLUMNS - 1) * (OUTDOOR_SECTION_HEIGHT - 1) + OUTDOOR_SECTION_HEIGHT) *
  OUTDOOR_CELL_WIDTH; // 1512
export const WORLD_IMAGE_HEIGHT =
  ((WORLD_MOSAIC_ROWS - 1) * (OUTDOOR_SECTION_WIDTH - 1) + OUTDOOR_SECTION_WIDTH) *
  OUTDOOR_CELL_HEIGHT; // 693

/**
 * North-west pixel corner of a section's map rectangle in the world image.
 * `section - 1 = 4 * p + q`; `p` counts **westward** (so the eastward index
 * is `4 - p`) and `q` counts **southward** — the arrival-coordinate arms of
 * `ChangeSection` at `game+0x184E4`.
 */
export function sectionImageOrigin(section: number): { x: number; y: number } {
  const slot = section - 1;
  const p = Math.floor(slot / 4);
  const q = slot % 4;
  return {
    x: (WORLD_MOSAIC_COLUMNS - 1 - p) * (OUTDOOR_SECTION_HEIGHT - 1) * OUTDOOR_CELL_WIDTH,
    y: q * (OUTDOOR_SECTION_WIDTH - 1) * OUTDOOR_CELL_HEIGHT,
  };
}

/**
 * Composite every section's display list into one world-sized raster of
 * terrain-class indices, then paint it with the 16 x 16 area-fill patterns
 * from the icon bank (dungeon-format.md §8.2.4a). Returns palette indices.
 */
export function renderWorldImage(
  sections: readonly { section: number; decoded: OutdoorSection }[],
  icons: readonly Uint8Array[],
): { width: number; height: number; pixels: Uint8Array } {
  const width = WORLD_IMAGE_WIDTH;
  const height = WORLD_IMAGE_HEIGHT;
  const classes = new Int16Array(width * height).fill(-1);

  for (const { section, decoded } of sections) {
    const raster = rasteriseOutdoorSection(decoded);
    const origin = sectionImageOrigin(section);
    for (let sy = 0; sy < OUTDOOR_MAP_HEIGHT; sy++) {
      const dy = origin.y + sy;
      if (dy < 0 || dy >= height) continue;
      for (let sx = 0; sx < OUTDOOR_MAP_WIDTH; sx++) {
        const dx = origin.x + sx;
        if (dx < 0 || dx >= width) continue;
        const v =
          raster.icons[(OUTDOOR_MAP_ORIGIN_Y + sy) * raster.width + (OUTDOOR_MAP_ORIGIN_X + sx)];
        if (v >= 0) classes[dy * width + dx] = v;
      }
    }
  }

  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cls = classes[y * width + x];
      if (cls < 0 || cls >= icons.length) continue;
      pixels[y * width + x] =
        icons[cls][(y % OUTDOOR_ICON_HEIGHT) * OUTDOOR_ICON_WIDTH + (x % OUTDOOR_ICON_WIDTH)];
    }
  }
  return { width, height, pixels };
}

/** Lay the twelve 16 x 16 icons out as a single 192 x 16 strip. */
export function renderIconStrip(icons: readonly Uint8Array[]): {
  width: number;
  height: number;
  pixels: Uint8Array;
} {
  const width = OUTDOOR_ICON_COUNT * OUTDOOR_ICON_WIDTH;
  const height = OUTDOOR_ICON_HEIGHT;
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < icons.length && i < OUTDOOR_ICON_COUNT; i++) {
    for (let y = 0; y < OUTDOOR_ICON_HEIGHT; y++) {
      for (let x = 0; x < OUTDOOR_ICON_WIDTH; x++) {
        pixels[y * width + i * OUTDOOR_ICON_WIDTH + x] = icons[i][y * OUTDOOR_ICON_WIDTH + x];
      }
    }
  }
  return { width, height, pixels };
}

/**
 * Read the real files and emit the two JSON artefacts. Returns the manifest
 * entries to merge into `manifest.json` (empty if the data is missing).
 */
export function buildWorldMap(dataDir: string, outDir: string): ManifestEntry[] {
  const sections: { section: number; decoded: OutdoorSection }[] = [];
  for (let block = 0; block < OUTDOOR_FILE_NAMES.length; block++) {
    const path = resolve(dataDir, findFileCI(dataDir, OUTDOOR_FILE_NAMES[block]));
    if (!existsSync(path)) {
      console.warn(`  ⚠ ${OUTDOOR_FILE_NAMES[block]} not found — skipping world map`);
      return [];
    }
    sections.push({
      section: SECTION_NUMBER_BY_BLOCK[block],
      decoded: decodeOutdoorSection(new Uint8Array(readFileSync(path))),
    });
  }

  const mapsIntPath = resolve(dataDir, findFileCI(dataDir, 'maps.int'));
  let grids: Uint8Array[] | undefined;
  if (existsSync(mapsIntPath)) {
    grids = decodeMapsInt(new Uint8Array(readFileSync(mapsIntPath)));
  } else {
    console.warn('  ⚠ maps.int not found — assembling from the out*.dat grids instead');
  }

  const twnsPath = resolve(dataDir, findFileCI(dataDir, 'twns.int'));
  const townNames = existsSync(twnsPath)
    ? readTownNames(new Uint8Array(readFileSync(twnsPath)))
    : undefined;
  if (!townNames) console.warn('  ⚠ twns.int not found — town markers stay numbered');

  const { world, pois } = buildWorldFromSections(sections, grids, townNames);

  mkdirSync(outDir, { recursive: true });

  // Real terrain art: the icon bank + palette both live in `game`
  // (dungeon-format.md §8.2.4a). Without the executable we still emit the
  // gameplay grid and POIs, just no picture.
  const gamePath = resolve(dataDir, findFileCI(dataDir, 'game'));
  let worldPng = '';
  if (existsSync(gamePath)) {
    const gameExe = new Uint8Array(readFileSync(gamePath));
    const palette = readP1PaletteSlot(gameExe, OUTDOOR_PALETTE_SLOT);
    const icons = decodeOutdoorIconBank(gameExe);

    const image = renderWorldImage(sections, icons);
    mkdirSync(resolve(outDir, 'screens'), { recursive: true });
    writePNG(
      resolve(outDir, `screens/${WORLD_MAP_ASSET_NAME}.png`),
      indicesToRGBA(image.pixels, palette),
      image.width,
      image.height,
    );
    worldPng = `screens/${WORLD_MAP_ASSET_NAME}.png`;

    const strip = renderIconStrip(icons);
    mkdirSync(resolve(outDir, 'textures'), { recursive: true });
    writePNG(
      resolve(outDir, 'textures/terrain-icons.png'),
      indicesToRGBA(strip.pixels, palette),
      strip.width,
      strip.height,
    );
    writeJson(resolve(outDir, 'textures/terrain-icons.json'), {
      width: strip.width,
      height: strip.height,
      frames: TERRAIN_CLASS_NAMES.map((name, i) => ({
        name: `class-${i}-${name.toLowerCase()}`,
        x: i * OUTDOOR_ICON_WIDTH,
        y: 0,
        w: OUTDOOR_ICON_WIDTH,
        h: OUTDOOR_ICON_HEIGHT,
      })),
    });
    console.log(
      `  Terrain art: ${image.width}×${image.height} world picture + ` +
        `${OUTDOOR_ICON_COUNT} 16×16 fill patterns`,
    );
  } else {
    console.warn('  ⚠ game executable not found — no terrain art rendered');
  }
  // Compact: the grid is 9,702 numbers and one-per-line is unreadable anyway.
  writeJson(
    resolve(outDir, `${WORLD_MAP_ASSET_NAME}.json`),
    {
      width: world.width,
      height: world.height,
      sectionWidth: OUTDOOR_SECTION_WIDTH,
      sectionHeight: OUTDOOR_SECTION_HEIGHT,
      sectionStrideX: WORLD_SECTION_STRIDE_X,
      sectionStrideY: WORLD_SECTION_STRIDE_Y,
      sections: SECTION_NUMBER_BY_BLOCK,
      terrainClassNames: TERRAIN_CLASS_NAMES,
      cellWidth: OUTDOOR_CELL_WIDTH,
      cellHeight: OUTDOOR_CELL_HEIGHT,
      ...(worldPng
        ? {
            image: worldPng,
            imageWidth: WORLD_IMAGE_WIDTH,
            imageHeight: WORLD_IMAGE_HEIGHT,
          }
        : {}),
      cells: Array.from(world.cells),
    },
    false,
  );
  writeJson(resolve(outDir, `${WORLD_MAP_ASSET_NAME}-pois.json`), { pois });

  console.log(
    `  World map: ${world.width}×${world.height} cells, ${pois.length} POIs → ${outDir}`,
  );

  return [
    {
      name: WORLD_MAP_ASSET_NAME,
      type: 'map',
      sprites: 0,
      hasPalette: true,
      png: worldPng,
    },
  ];
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/phantasie/build-map.ts <dataDir> [outDir]');
    process.exit(1);
  }
  const outDir = process.argv[3] ?? resolve('public/assets/phantasie/amiga');
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
