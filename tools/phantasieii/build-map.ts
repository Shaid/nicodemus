/**
 * Phantasie II world-map build step: assemble the 17 outdoor sections into
 * the 201 x 77 overworld grid and emit it, plus a point-of-interest marker
 * list, as browser-friendly JSON for the asset viewer.
 *
 * See docs/phantasie/dungeon-format.md §8.6 (the P2 `OUT*.DAT` layout,
 * `MAPS.INT`, and how the sparse 17-section mosaic tiles into two separate
 * landmasses, east and west). All decoding is done by `src/assets/formats/outdoor.ts`; this
 * module places section-local data into world coordinates and serialises it
 * — the exact same shape as `tools/phantasie/build-map.ts`'s P1 step, just
 * parameterised by `PHANTASIE2_OUTDOOR` instead of the P1 default.
 *
 * Output (under `public/assets/phantasieii/atarist/`):
 *
 * | File                          | Contents                                 |
 * |-------------------------------|------------------------------------------|
 * | `world-map.json`              | `{ width, height, cells }` — revealed codes |
 * | `world-map-pois.json`         | `{ pois }` — world markers + messages     |
 * | `screens/world-map.png`       | the composited overworld picture          |
 * | `textures/terrain-icons.png`  | the twelve 16 x 16 fill patterns          |
 *
 * The terrain art is real: the per-section display list's `iconIndex` **is**
 * the terrain class (§8.6.8a, 8,752/8,801 cells), so each pixel of the
 * baked picture is that class's 16 x 16 VDI `vsf_udpat` fill pattern from
 * `PHANT.PRG`'s icon bank at file `0x21DF2`.
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson, findFileCI, writePNG } from '@seer-project/pipeline';
import { indicesToRGBA } from '../../src/assets/formats/palette.ts';
import { readP2OutdoorPalette } from '../../src/assets/formats/exe-data.ts';
import {
  OUTDOOR_SECTION_HEIGHT,
  OUTDOOR_SECTION_WIDTH,
  PHANTASIE2_OUTDOOR,
  SECTION_NUMBER_BY_BLOCK_P2,
  TILE_CLASS_DUNGEON,
  TILE_TOWN,
  WORLD_SECTIONS_NS,
  WORLD_SECTIONS_EW_P2,
  WORLD_SECTION_STRIDE_EW,
  WORLD_SECTION_STRIDE_NS,
  EVENT_VARIANT_BUMP,
  EVENT_VARIANT_NONE,
  EVENT_VARIANT_TEXT,
  OUTDOOR_CELL_WIDTH,
  OUTDOOR_CELL_HEIGHT,
  OUTDOOR_ICON_BANK_OFFSET_P2,
  OUTDOOR_ICON_COUNT,
  OUTDOOR_ICON_WIDTH,
  OUTDOOR_ICON_HEIGHT,
  OUTDOOR_MAP_ORIGIN_X,
  OUTDOOR_MAP_ORIGIN_Y,
  OUTDOOR_MAP_WIDTH,
  OUTDOOR_MAP_HEIGHT,
  TERRAIN_CLASS_NAMES_P2,
  assembleWorld,
  decodeMapsInt,
  decodeOutdoorIconBank,
  decodeOutdoorSection,
  poiMessage,
  rasteriseOutdoorSection,
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
 * Duplicated from `build-assets.ts` rather than imported, deliberately: that
 * file statically imports `buildWorldMap` from this one (mirroring P1's
 * `build-assets.ts` -> `build-map.ts` wiring), so a real (non-type) import
 * back from here would be a genuine circular value-import at module-load
 * time, not just a type-only cycle. See `main()` below for how `build-map.ts`
 * still reaches `build-assets.ts`'s `upsertManifest` safely (a dynamic
 * import, used only by the standalone-run path).
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

/**
 * The shipped `OUT*.DAT` files in `MAPS.INT` block order — sparse (17 of 32
 * mosaic slots), see dungeon-format.md §8.6.2/§8.6.3.
 */
export const OUTDOOR_FILE_NAMES: readonly string[] = SECTION_NUMBER_BY_BLOCK_P2.map(
  (section) => `OUT${section}.DAT`,
);

/**
 * POI kind, derived from the tile the record sits on rather than from the
 * record itself, mirroring P1's convention (dungeon-format.md §8.6.4 — the
 * scan/dispatch logic is instruction-identical to P1's).
 */
export type WorldPoiType = 'town' | 'dungeon' | 'text' | 'bump' | 'silent' | 'other';

export interface WorldPoi {
  /** Section number (the `OUT*.DAT` ordinal), not a `MAPS.INT` block. */
  section: number;
  /** Section-local column 0-19. */
  col: number;
  /** Section-local row 0-25, file order (row 0 = north). */
  row: number;
  /** World column 0-200, east-west, column 0 = west. */
  x: number;
  /** World row 0-76, north-south, row 0 = north. */
  y: number;
  type: WorldPoiType;
  /** Revealed (fog-flag-stripped) tile code the record sits on. */
  tile: number;
  /** Record byte `+2`: message index, town id (1-10, confirmed clean) or dungeon id (1-8) by type. */
  index: number;
  /** Record byte `+3`: non-zero only on class-5 records, meaning unknown. */
  param: number;
  /** Short marker caption — see `labelFor` for why towns/dungeons stay index-only. */
  label: string;
  /** Resolved text lines, for the records that address the text block. */
  message?: string[];
}

export interface WorldMapOutput {
  world: AssembledWorld;
  pois: WorldPoi[];
}

/**
 * North-west corner of a section in world cells — identical arithmetic to
 * P1's, parameterised by P2's own east-west section count (both games are
 * 4 sections deep north-south; see dungeon-format.md §8.2.1/§8.3.2's
 * 2026-08-11 axis correction).
 */
export function sectionOrigin(section: number): { x: number; y: number } {
  const slot = section - 1;
  const ewIndex = Math.floor(slot / WORLD_SECTIONS_NS);
  const nsIndex = slot % WORLD_SECTIONS_NS;
  return {
    x: (WORLD_SECTIONS_EW_P2 - 1 - ewIndex) * WORLD_SECTION_STRIDE_EW,
    y: nsIndex * WORLD_SECTION_STRIDE_NS,
  };
}

/**
 * Place a section-local (col, row) onto the assembled world grid. `row` is
 * the file's east-west axis (`fileRow`) and maps to world `x` as
 * `25 - fileRow`; `col` is the north-south axis and maps directly to
 * world `y`.
 */
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
  return { x: origin.x + (OUTDOOR_SECTION_HEIGHT - 1 - row), y: origin.y + col };
}

/** Classify a POI by the tile it sits on — same dispatch order as P1 (dungeon-format.md §8.6.4). */
export function poiTypeForTile(code: number): WorldPoiType {
  const tile = revealedTileCode(code);
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

function labelFor(type: WorldPoiType, index: number, message: string[] | undefined): string {
  if (type === 'text') {
    const line = message?.find((l) => l !== '');
    if (line) return line.length > LABEL_MAX ? `${line.slice(0, LABEL_MAX - 1)}…` : line;
  }
  switch (type) {
    // `+2` is a clean 1..10 town index and a clean 1..8 dungeon index for P2
    // (dungeon-format.md §8.6.4 — a materially cleaner result than P1's),
    // but still not tied to TWNS.INT's name roster or DNG1-8's own labels
    // (world-p1-town-index's open question, unresolved for P2 too).
    case 'town':
      return `Town ${index}`;
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
export function sectionPoisToWorld(section: number, decoded: OutdoorSection): WorldPoi[] {
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
      label: labelFor(type, poi.index, message),
      ...(message && message.length > 0 ? { message } : {}),
    };
  });
}

/**
 * Assemble the world from already-loaded section grids and collect every
 * section's POI records into world coordinates. Pure — the caller supplies
 * the bytes, so this is directly testable against the real data files.
 *
 * `sectionGrids` is optional: when `MAPS.INT` is available it is the
 * pristine master (§8.6.2) and is preferred, otherwise the grids embedded
 * in the `OUT*.DAT` files are used. Either way the grids must be in
 * `SECTION_NUMBER_BY_BLOCK_P2` order.
 */
export function buildWorldFromSections(
  sections: readonly { section: number; decoded: OutdoorSection }[],
  sectionGrids?: readonly Uint8Array[],
): WorldMapOutput {
  const grids = sectionGrids ?? sections.map((s) => s.decoded.grid);
  const world = assembleWorld(grids, PHANTASIE2_OUTDOOR);
  const pois = sections.flatMap((s) => sectionPoisToWorld(s.section, s.decoded));
  pois.sort((a, b) => a.y - b.y || a.x - b.x);
  return { world, pois };
}

/**
 * World-image geometry. P2's sections tile 8 wide (east-west) x 4 tall
 * (north-south) sharing one cell at each seam (dungeon-format.md §8.6.3),
 * and each cell is drawn 12 x 9 pixels (`PHANT.PRG` addr `0x5764` stores
 * the same four words P1's `game+0x173B0` does), so the assembled overworld
 * picture is `201 * 12` x `77 * 9` = 2412 x 693.
 */
export const WORLD_MOSAIC_COLUMNS_P2 = WORLD_SECTIONS_EW_P2; // 8
export const WORLD_MOSAIC_ROWS_P2 = WORLD_SECTIONS_NS; // 4
export const WORLD_IMAGE_WIDTH_P2 =
  ((WORLD_MOSAIC_COLUMNS_P2 - 1) * WORLD_SECTION_STRIDE_EW + OUTDOOR_SECTION_HEIGHT) *
  OUTDOOR_CELL_WIDTH; // 2412
export const WORLD_IMAGE_HEIGHT_P2 =
  ((WORLD_MOSAIC_ROWS_P2 - 1) * WORLD_SECTION_STRIDE_NS + OUTDOOR_SECTION_WIDTH) *
  OUTDOOR_CELL_HEIGHT; // 693

/**
 * North-west pixel corner of a section's map rectangle in the world image —
 * `sectionOrigin()` in cells, scaled by the 12 x 9 cell size.
 */
export function sectionImageOrigin(section: number): { x: number; y: number } {
  const origin = sectionOrigin(section);
  return { x: origin.x * OUTDOOR_CELL_WIDTH, y: origin.y * OUTDOOR_CELL_HEIGHT };
}

/**
 * Composite every section's display list into one world-sized raster of
 * terrain-class indices, then paint it with the 16 x 16 VDI fill patterns
 * from the icon bank (dungeon-format.md §8.6.8). Returns palette indices.
 */
export function renderWorldImage(
  sections: readonly { section: number; decoded: OutdoorSection }[],
  icons: readonly Uint8Array[],
): { width: number; height: number; pixels: Uint8Array } {
  const width = WORLD_IMAGE_WIDTH_P2;
  const height = WORLD_IMAGE_HEIGHT_P2;
  const classes = new Int16Array(width * height).fill(-1);

  for (const { section, decoded } of sections) {
    // `drawPerimeter: false` — P2 turns the VDI fill perimeter off
    // (`vsf_perimeter(handle, 0)` at addr `0x52F4`), unlike P1's `AreaEnd`.
    const raster = rasteriseOutdoorSection(decoded, undefined, undefined, false);
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
 *
 * `dataDir` is disk1 (the canonical source, matching `buildAssets`'s own
 * convention) — `MAPS.INT`/`TWNS.INT` live there directly, and `OUT*.DAT`
 * resolves through `resolveP2File`'s disk2 fallback, the same way
 * `buildAssets` resolves `MSTR2.PAT`.
 */
export function buildWorldMap(dataDir: string, outDir: string): ManifestEntry[] {
  const sections: { section: number; decoded: OutdoorSection }[] = [];
  for (let block = 0; block < OUTDOOR_FILE_NAMES.length; block++) {
    const path = resolveP2File(dataDir, OUTDOOR_FILE_NAMES[block]);
    if (!path) {
      console.warn(`  ⚠ ${OUTDOOR_FILE_NAMES[block]} not found — skipping world map`);
      return [];
    }
    sections.push({
      section: SECTION_NUMBER_BY_BLOCK_P2[block],
      decoded: decodeOutdoorSection(new Uint8Array(readFileSync(path)), PHANTASIE2_OUTDOOR),
    });
  }

  const mapsIntPath = existsSync(resolve(dataDir, findFileCI(dataDir, 'MAPS.INT')))
    ? resolve(dataDir, findFileCI(dataDir, 'MAPS.INT'))
    : null;
  let grids: Uint8Array[] | undefined;
  if (mapsIntPath) {
    grids = decodeMapsInt(new Uint8Array(readFileSync(mapsIntPath)), PHANTASIE2_OUTDOOR);
  } else {
    console.warn('  ⚠ MAPS.INT not found — assembling from the OUT*.DAT grids instead');
  }

  const { world, pois } = buildWorldFromSections(sections, grids);

  mkdirSync(outDir, { recursive: true });

  // Real terrain art: the icon bank and its palette both live in
  // `PHANT.PRG` (dungeon-format.md §8.6.8). Without the executable we still
  // emit the gameplay grid and POIs, just no picture.
  const exePath = resolveP2File(dataDir, 'PHANT.PRG');
  let worldPng = '';
  let iconsPng = '';
  if (exePath) {
    const exe = new Uint8Array(readFileSync(exePath));
    const palette = readP2OutdoorPalette(exe);
    const icons = decodeOutdoorIconBank(exe, OUTDOOR_ICON_BANK_OFFSET_P2);

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
    iconsPng = 'textures/terrain-icons.png';
    writeJson(resolve(outDir, 'textures/terrain-icons.json'), {
      width: strip.width,
      height: strip.height,
      frames: TERRAIN_CLASS_NAMES_P2.map((name, i) => ({
        name: `class-${i}-${name.toLowerCase().replace(/\s+/g, '-')}`,
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
    console.warn('  ⚠ PHANT.PRG not found — no terrain art rendered');
  }

  writeJson(
    resolve(outDir, `${WORLD_MAP_ASSET_NAME}.json`),
    {
      width: world.width,
      height: world.height,
      sectionWidth: OUTDOOR_SECTION_WIDTH,
      sectionHeight: OUTDOOR_SECTION_HEIGHT,
      sectionStrideEW: WORLD_SECTION_STRIDE_EW,
      sectionStrideNS: WORLD_SECTION_STRIDE_NS,
      sectionsEW: WORLD_SECTIONS_EW_P2,
      sectionsNS: WORLD_SECTIONS_NS,
      sections: SECTION_NUMBER_BY_BLOCK_P2,
      terrainClassNames: TERRAIN_CLASS_NAMES_P2,
      cellWidth: OUTDOOR_CELL_WIDTH,
      cellHeight: OUTDOOR_CELL_HEIGHT,
      ...(iconsPng ? { terrainIcons: iconsPng } : {}),
      ...(worldPng
        ? {
            image: worldPng,
            imageWidth: WORLD_IMAGE_WIDTH_P2,
            imageHeight: WORLD_IMAGE_HEIGHT_P2,
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
    console.error('Usage: npx tsx tools/phantasieii/build-map.ts <dataDir> [outDir]');
    process.exit(1);
  }
  const outDir = process.argv[3] ?? resolve('public/assets/phantasieii/atarist');
  const entries = buildWorldMap(dataDir, outDir);
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
