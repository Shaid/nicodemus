/**
 * World-map view for the asset viewer. Format-agnostic: the same pan/zoom
 * canvas serves Phantasie I (126 x 77 cells), Phantasie II (201 x 77) and
 * Phantasie III (50 x 75), because everything that actually differs between
 * the three arrives as data in `world-map.json` rather than as a branch here.
 *
 * The world x-axis is east-west, y is north-south (`x=0`/`y=0` is the
 * north-west corner). For P1/P2 `assembleWorld()` in
 * `src/assets/formats/outdoor.ts` already places every cell in this
 * orientation (dungeon-format.md §8.2.1/§8.3.2's 2026-08-11 axis
 * correction); P3's grid is a single 50 x 75 array straight out of
 * `phantasy.set` with no mosaic and so no orientation ambiguity at all.
 *
 * Three things vary by game, all optional fields:
 *
 * - **Mosaic geometry** (`sections`, `section*`). P1/P2 assemble the world
 *   from sparse section files, so cells no shipped section covers must be
 *   drawn as holes rather than phantom grassland. P3 ships one global grid
 *   in one file — it omits these fields and every cell is real.
 * - **How a cell byte becomes a terrain class.** P1/P2 use `floor(code/10)`,
 *   which is the engine's own rule. P3 classifies the byte through a banded
 *   chain instead (dungeon-format.md §9.0.5.3) and ships the result as an
 *   explicit `terrainClassByValue` lookup.
 * - **Terrain art.** P1's terrain byte is *not* a graphics index — the game
 *   plots each cell from a 16 x 16 area-fill pattern per class in the
 *   executable's icon bank (dungeon-format.md §8.2.4a), so P1 ships
 *   `terrainIcons`, one pattern per class. **P2 works the same way** and
 *   now ships its own strip too (§8.6.8): same 128-byte plane-major
 *   entries, reached through the Atari ST's GEM VDI `vsf_udpat` instead of
 *   AmigaOS's `AreaPtrn`, from `PHANT.PRG`'s bank at file `0x21DF2`. P3's byte *is* a direct tile index
 *   into a 250-tile bank bundled in the same file (graphics-formats.md
 *   §5.3), so it ships `terrainTiles`, a strip addressed per cell **value**,
 *   and gets its real artwork with no per-class approximation at all.
 */
import { setHidden } from './shared.ts';

export interface WorldMapData {
  width: number;
  height: number;

  // ─── Mosaic geometry — P1/P2 only; absent means one global grid. ───
  sectionWidth?: number;
  sectionHeight?: number;
  /** East-west stride between adjacent sections' origins. */
  sectionStrideEW?: number;
  /** North-south stride between adjacent sections' origins. */
  sectionStrideNS?: number;
  /** Mosaic columns east-west the section numbers span (game-specific). */
  sectionsEW?: number;
  /** Mosaic rows north-south — always 4, the engine's own hardcoded depth. */
  sectionsNS?: number;
  sections?: number[];

  // ─── Terrain classification and legend. ───
  /** English name per terrain class. P1: confirmed dungeon-format.md §8.3.3a; P3: §9.0.5.3's name table. */
  terrainClassNames?: string[];
  /** 256-entry `cell byte -> class` lookup (P3). Absent means P1/P2's `floor(code/10)`. */
  terrainClassByValue?: number[];
  /** `#rrggbb` per class, derived from the real art. Absent entries fall back to the built-in palette. */
  terrainClassColors?: (string | null)[];

  // ─── Terrain art. ───
  /** `<assetBase>`-relative strip of one 16x16 fill pattern per **class**, in class order (P1). */
  terrainIcons?: string;
  /** `<assetBase>`-relative strip of one tile per **cell value** (P3). */
  terrainTiles?: string;
  /** Tiles per row in `terrainTiles`. */
  terrainTileColumns?: number;
  /** How many tiles the strip holds; values at or past it are clamped, as the game's blitter does. */
  terrainTileCount?: number;

  /** Row-major revealed tile codes, `cell[x,y]` at `y * width + x`. */
  cells: number[];
}

export type WorldPoiType = 'town' | 'dungeon' | 'inn' | 'text' | 'bump' | 'silent' | 'other';

export interface WorldPoi {
  /** World column, east-west. */
  x: number;
  /** World row, north-south. */
  y: number;
  type: WorldPoiType;
  /** The cell byte the marker sits on. */
  tile: number;
  /** Engine-side index for the marker's kind. */
  index: number;
  /** Short marker caption. */
  label: string;

  // ─── P1/P2 record provenance — absent for P3, which has no POI file. ───
  /** Section number the record came from. */
  section?: number;
  /** Section-local column. */
  col?: number;
  /** Section-local row. */
  row?: number;
  /** Record byte `+3`; meaning unknown. */
  param?: number;
  /** Resolved text lines, for records that address a text block. */
  message?: string[];

  // ─── P3 extras. ───
  /** `D/DNG?.DAT` a dungeon entrance opens. */
  file?: string;
}

interface TileClassStyle {
  color: string;
  /** English name, all confirmed — dungeon-format.md §8.3.3a. */
  name: string;
  note?: string;
}

/**
 * P1/P2 fallback: one flat colour per terrain class (`tile / 10`), each keyed
 * off the dominant ink of that class's own 16 x 16 fill pattern in the icon
 * bank, lightened enough to stay legible against the black most of those
 * patterns use as their background. Classes 4 and 5 have no pattern at all —
 * the engine draws them as markers — so those two are chosen freely.
 *
 * A map that ships `terrainClassNames`/`terrainClassColors` (P3) uses those
 * instead; this table is never consulted for it.
 */
const TILE_CLASS_STYLES: TileClassStyle[] = [
  { color: '#2f7a1e', name: 'Grassland', note: 'movement cost 75' },
  { color: '#2b5200', name: 'Forest', note: 'movement cost 150' },
  { color: '#8a5520', name: 'Hills', note: 'movement cost 225' },
  { color: '#6e3a12', name: 'Mountains', note: 'movement cost 300' },
  { color: '#f2d24b', name: 'Town / Inn', note: 'tile 40 town, tile 41 inn' },
  { color: '#c0392b', name: 'Dungeon', note: 'entrance to dng1-dng10' },
  { color: '#6b6b6b', name: 'Path', note: 'cheapest terrain, cost 60' },
  { color: '#4d4d4d', name: 'Mist', note: 'astral plane / Olympus only' },
  { color: '#7a4a08', name: 'Desert' },
  { color: '#b06a10', name: 'Desert', note: 'second art variant' },
  { color: '#0780af', name: 'Ocean', note: 'tile 100 impassable' },
  { color: '#2230d0', name: 'Lake', note: 'three cells in the whole world' },
];
const UNKNOWN_CLASS_COLOR = '#ff00ff';

const POI_STYLES: Record<WorldPoiType, { color: string; shape: 'diamond' | 'circle' | 'square' }> = {
  town: { color: '#ffe14d', shape: 'diamond' },
  dungeon: { color: '#ff6a5a', shape: 'diamond' },
  inn: { color: '#7cf2b0', shape: 'diamond' },
  text: { color: '#7fd7ff', shape: 'circle' },
  bump: { color: '#b48cff', shape: 'circle' },
  silent: { color: '#9aa0a6', shape: 'square' },
  other: { color: '#ffffff', shape: 'square' },
};

/** Marker kinds that always carry a caption. The rest would be unreadable en masse. */
const CAPTIONED_POI_TYPES = new Set<WorldPoiType>(['town', 'dungeon', 'inn']);

/**
 * Cross-game "reskin": paint Phantasie I/II's terrain classes with a
 * similarly-named Phantasie III tile, borrowed from its real bundled
 * artwork (graphics-formats.md §5.3) since P3's 250-tile bank has far more
 * visual variety than P1's 12-pattern icon bank or P2's own. **This is a
 * fun approximation, not an RE claim** — Phantasie I/II never shipped this
 * art or anything like it; the mapping below is a same-name-or-closest
 * match chosen by eye, not derived from any format fact. Classes with no
 * reasonable P3 counterpart (Town, Dungeon, and P2's Dark Void/Molten
 * Lava, whose own tile values are only reachable from the *castle/
 * Netherworld* maps this project hasn't decoded yet) are left unmapped and
 * fall back to native rendering even with the skin on.
 *
 * Values are representative tile indices from the middle of each class's
 * confirmed value band (`P3_TERRAIN_BANDS` in `src/assets/formats/
 * p3-overworld.ts`) — any value in-band renders that class's art, the
 * exact choice doesn't matter beyond "not an edge case".
 */
const P3_SKIN_TILE_BY_CLASS_NAME: Record<string, number> = {
  Grassland: 196, // Meadows band 188-205
  Forest: 233, // Forest band 225-241
  Hills: 134, // Hills band 115-154
  Mountains: 102, // Mountains band 90-114
  Path: 219, // Pathway band 214-224
  Mist: 71, // Bright mist band 68-74
  Desert: 171, // Desert band 155-187
  Ocean: 13, // Water band 2-25
  Lake: 13, // Water band 2-25
};
/** P3 is a single game/platform pair — see viewer.ts's own `GAME_PLATFORMS`. */
const P3_SKIN_ASSET_BASE = '/assets/phantasieiii/amiga';

/** World pixels per map cell at zoom 1. Arbitrary — nothing is baked. */
const CELL = 8;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 12;
/** Below this on-screen cell size, marker captions are suppressed as noise. */
const LABEL_MIN_CELL_PX = 7;
/**
 * P3's dungeon markers are captioned with the engine's own descriptive
 * sentence ("A cave smelling of sulphur") rather than a one-word place name,
 * and on a 50-cell-wide world those run into each other at fit zoom. Anything
 * past this many characters waits for a closer look.
 */
const LABEL_LONG_CHARS = 15;
const LABEL_LONG_MIN_CELL_PX = 16;

/** Class-code cells (P1/P2) split into a class and an art variant this way. */
function tileVariantOf(code: number): number {
  return code % 10;
}

export class WorldMapViewer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private detach: (() => void)[] = [];

  private map: WorldMapData | null = null;
  private pois: WorldPoi[] = [];
  private poiByCell = new Map<number, WorldPoi>();
  /** 1 where some shipped section wrote the cell — see `buildCoverage()`. */
  private covered: Uint8Array = new Uint8Array(0);
  /**
   * One repeating `CanvasPattern` per terrain **class**, cropped from
   * `terrainIcons` (P1 only). Empty while loading or when no strip is
   * available — `drawTerrain()` falls back to a flat class colour then.
   */
  private terrainPatterns: (CanvasPattern | null)[] = [];
  /** The per-cell-**value** tile strip (P3). Cells blit straight out of it. */
  private tileSheet: HTMLImageElement | null = null;
  /** Cross-game "Phantasie III art" reskin patterns, by local class index — see `P3_SKIN_TILE_BY_CLASS_NAME`. */
  private p3SkinPatterns: (CanvasPattern | null)[] = [];
  private p3SkinLoaded = false;
  private useP3Skin = false;
  /** Cached across `show()` calls — P3's own map never changes mid-session. */
  private static p3SkinSheetPromise: Promise<{ img: HTMLImageElement; columns: number } | null> | null = null;

  private zoom = 1;
  private offsetX = 0;
  private offsetY = 0;
  private dragging = false;
  private dragMoved = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  private layers = { terrain: true, pois: true, labels: true, sections: false };

  private strip: HTMLElement;
  private coordEl: HTMLElement;
  private detailEl: HTMLElement;
  private legendEl: HTMLElement;
  private legendNoteEl: HTMLElement | null;

  /** Fired on a click that wasn't a pan. Tile-grid coordinates, not pixels. */
  onTileClick: ((x: number, y: number) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.strip = document.getElementById('map-strip')!;
    this.coordEl = document.getElementById('map-coord')!;
    this.detailEl = document.getElementById('map-detail')!;
    this.legendEl = document.getElementById('map-legend')!;
    this.legendNoteEl = document.getElementById('map-legend-note');
  }

  // ─── Public API ────────────────────────────────────────────────────────

  /** Load and display `<base>/<name>.json` + `<base>/<name>-pois.json`. */
  async show(assetBase: string, name: string): Promise<void> {
    this.teardown();
    this.container.innerHTML = '';
    this.container.classList.add('map-mode');
    setHidden(this.strip, false);
    this.detailEl.textContent = '';
    this.coordEl.textContent = '';

    let map: WorldMapData;
    try {
      const res = await fetch(`${assetBase}/${name}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      map = (await res.json()) as WorldMapData;
    } catch (err) {
      this.container.innerHTML =
        '<div class="state-panel state-error"><span class="state-icon">⚠</span>' +
        '<span class="state-title">Failed to load the world map</span>' +
        '<span class="state-detail">Run <code>npm run build-assets</code> first.</span></div>';
      console.warn('world map load failed:', err);
      return;
    }

    this.map = map;
    this.pois = [];
    try {
      const res = await fetch(`${assetBase}/${name}-pois.json`);
      if (res.ok) this.pois = ((await res.json()) as { pois?: WorldPoi[] }).pois ?? [];
    } catch {
      // POIs are an overlay; a missing file just means no markers.
    }
    this.poiByCell = new Map(this.pois.map((p) => [p.y * map.width + p.x, p]));
    this.buildCoverage(map);

    this.buildCanvas();
    this.buildLegend();
    this.bindStrip();
    this.fit();

    this.terrainPatterns = [];
    this.tileSheet = null;
    this.p3SkinPatterns = [];
    this.p3SkinLoaded = false;
    this.useP3Skin = false;
    if (map.terrainIcons) void this.loadTerrainPatterns(assetBase, map.terrainIcons);
    if (map.terrainTiles) void this.loadTileSheet(assetBase, map.terrainTiles);
    this.bindP3Skin();
  }

  hide(): void {
    this.teardown();
    this.container.classList.remove('map-mode');
    setHidden(this.strip, true);
    this.map = null;
    this.pois = [];
    this.poiByCell.clear();
    this.terrainPatterns = [];
    this.tileSheet = null;
    this.p3SkinPatterns = [];
    this.p3SkinLoaded = false;
    this.useP3Skin = false;
  }

  /** Human-readable summary for the viewer toolbar. */
  get summary(): string {
    if (!this.map) return '';
    return `${this.map.width}×${this.map.height} cells, ${this.pois.length} POIs`;
  }

  // ─── Terrain classification ────────────────────────────────────────────

  /**
   * The terrain class of a cell byte. P3 ships an explicit 256-entry lookup
   * (its classifier is a banded chain, not arithmetic); P1/P2 use the
   * engine's own `floor(code / 10)`.
   */
  private classOf(code: number): number {
    const table = this.map?.terrainClassByValue;
    return table ? (table[code] ?? -1) : Math.floor(code / 10);
  }

  private classNameOf(cls: number): string {
    return this.map?.terrainClassNames?.[cls] ?? TILE_CLASS_STYLES[cls]?.name ?? `Class ${cls}`;
  }

  private classColorOf(cls: number): string {
    return this.map?.terrainClassColors?.[cls] ?? TILE_CLASS_STYLES[cls]?.color ?? UNKNOWN_CLASS_COLOR;
  }

  // ─── Setup ─────────────────────────────────────────────────────────────

  private teardown(): void {
    for (const off of this.detach) off();
    this.detach = [];
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }

  private on(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.detach.push(() => target.removeEventListener(type, fn));
  }

  private buildCanvas(): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'map-canvas';
    this.container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;

    this.on(canvas, 'wheel', ((e: WheelEvent) => this.onWheel(e)) as EventListener);
    this.on(canvas, 'mousedown', ((e: MouseEvent) => this.onMouseDown(e)) as EventListener);
    this.on(canvas, 'mouseleave', () => {
      this.coordEl.textContent = '';
    });
    this.on(window, 'mousemove', ((e: MouseEvent) => this.onMouseMove(e)) as EventListener);
    this.on(window, 'mouseup', ((e: MouseEvent) => this.onMouseUp(e)) as EventListener);

    this.resizeObserver = new ResizeObserver(() => {
      this.sizeCanvas();
      this.draw();
    });
    this.resizeObserver.observe(this.container);
  }

  /**
   * Crop each class's 16x16 icon out of the strip into its own canvas, then
   * build a `CanvasPattern` per class scaled so one repeat covers exactly
   * one world cell (`CELL` px at zoom 1) — `drawTerrain()`'s existing
   * equal-colour-run merge works unchanged with a pattern as `fillStyle`.
   */
  private async loadTerrainPatterns(assetBase: string, iconsPath: string): Promise<void> {
    const img = await loadImage(`${assetBase}/${iconsPath}`);
    if (!img) {
      console.warn('terrain icons unavailable, falling back to flat colours');
      return;
    }
    if (this.map?.terrainIcons !== iconsPath) return; // a newer show() started

    const iconSize = img.height; // strip is one row, iconSize x iconSize per class
    const count = Math.floor(img.width / iconSize);
    const patterns: (CanvasPattern | null)[] = [];
    for (let i = 0; i < count; i++) {
      const cell = document.createElement('canvas');
      cell.width = iconSize;
      cell.height = iconSize;
      const cellCtx = cell.getContext('2d')!;
      cellCtx.drawImage(img, i * iconSize, 0, iconSize, iconSize, 0, 0, iconSize, iconSize);
      const pattern = this.ctx?.createPattern(cell, 'repeat') ?? null;
      pattern?.setTransform(new DOMMatrix().scale(CELL / iconSize));
      patterns.push(pattern);
    }
    this.terrainPatterns = patterns;
    this.draw();
  }

  /** Load the per-cell-value tile strip (P3). Kept as one image and blitted from. */
  private async loadTileSheet(assetBase: string, tilesPath: string): Promise<void> {
    const img = await loadImage(`${assetBase}/${tilesPath}`);
    if (!img) {
      console.warn('terrain tile strip unavailable, falling back to flat class colours');
      return;
    }
    if (this.map?.terrainTiles !== tilesPath) return; // a newer show() started
    this.tileSheet = img;
    this.draw();
  }

  /**
   * Show the "Phantasie III art" toggle only for a map that could use it —
   * one with its own class vocabulary (P1/P2) and not already showing P3's
   * own real tiles (P3 itself, where the toggle would be a no-op).
   */
  private bindP3Skin(): void {
    const label = document.getElementById('map-p3-skin-label');
    const checkbox = document.getElementById('map-p3-skin') as HTMLInputElement | null;
    if (!label || !checkbox) return;
    const eligible = Boolean(this.map?.terrainClassNames) && !this.map?.terrainTiles;
    setHidden(label, !eligible);
    checkbox.checked = false;
    if (!eligible) return;
    this.on(checkbox, 'change', () => {
      this.useP3Skin = checkbox.checked;
      if (this.useP3Skin && !this.p3SkinLoaded) void this.loadP3Skin();
      else this.draw();
    });
  }

  /**
   * Fetch P3's own world map (cached process-wide — see
   * `p3SkinSheetPromise`) purely for its tile strip and column count, then
   * crop one pattern per *local* class from `P3_SKIN_TILE_BY_CLASS_NAME`.
   * A class with no entry there (or no P3 map loaded at all) just has no
   * pattern, which `drawTerrainClasses()` already falls back on gracefully.
   */
  private async loadP3Skin(): Promise<void> {
    WorldMapViewer.p3SkinSheetPromise ??= (async () => {
      try {
        const jsonRes = await fetch(`${P3_SKIN_ASSET_BASE}/world-map.json`);
        if (!jsonRes.ok) return null;
        const p3Map = (await jsonRes.json()) as WorldMapData;
        if (!p3Map.terrainTiles || !p3Map.terrainTileColumns) return null;
        const img = await loadImage(`${P3_SKIN_ASSET_BASE}/${p3Map.terrainTiles}`);
        return img ? { img, columns: p3Map.terrainTileColumns } : null;
      } catch (err) {
        console.warn('Phantasie III tile skin unavailable:', err);
        return null;
      }
    })();

    const sheet = await WorldMapViewer.p3SkinSheetPromise;
    this.p3SkinLoaded = true;
    if (!sheet || !this.map?.terrainClassNames) {
      this.draw();
      return;
    }

    const { img, columns } = sheet;
    const tileW = Math.floor(img.width / columns);
    const tileH = tileW; // square tiles, confirmed graphics-formats.md §5.3
    const patterns: (CanvasPattern | null)[] = [];
    this.map.terrainClassNames.forEach((name, cls) => {
      const tile = P3_SKIN_TILE_BY_CLASS_NAME[name];
      if (tile === undefined) {
        patterns[cls] = null;
        return;
      }
      const cell = document.createElement('canvas');
      cell.width = tileW;
      cell.height = tileH;
      cell
        .getContext('2d')!
        .drawImage(img, (tile % columns) * tileW, Math.floor(tile / columns) * tileH, tileW, tileH, 0, 0, tileW, tileH);
      const pattern = this.ctx?.createPattern(cell, 'repeat') ?? null;
      pattern?.setTransform(new DOMMatrix().scale(CELL / tileW));
      patterns[cls] = pattern;
    });
    this.p3SkinPatterns = patterns;
    this.draw();
  }

  /**
   * A section's mosaic origin in world cells — `(section-1) % sectionsNS` is
   * the north-south index (0 = north), `floor((section-1)/sectionsNS)` the
   * east-west index counted from the **east** (dungeon-format.md
   * §8.2.1/§8.3.2's 2026-08-11 axis correction — `sectionsEW` varies per
   * game, `sectionsNS` is always the engine's hardcoded 4).
   */
  private sectionOrigin(map: WorldMapData, section: number): { x: number; y: number } {
    const slot = section - 1;
    const sectionsNS = map.sectionsNS ?? 1;
    const ewIndex = Math.floor(slot / sectionsNS);
    const nsIndex = slot % sectionsNS;
    return {
      x: ((map.sectionsEW ?? 1) - 1 - ewIndex) * (map.sectionStrideEW ?? 0),
      y: nsIndex * (map.sectionStrideNS ?? 0),
    };
  }

  /**
   * A mosaic world grid has `sectionsEW * sectionsNS` section slots but only
   * some ship a file (e.g. P1: 18 of 20; P2: 17 of 32 — dungeon-format.md
   * §8.3.2/§8.6.3). Those cells come out of `assembleWorld()` as byte 0,
   * which is indistinguishable from a real class-0 land tile — so mark them
   * and draw nothing there rather than phantom grassland.
   *
   * A map with no mosaic at all (P3: one 50 x 75 array, one file) has no
   * such holes; every cell is real and gets drawn.
   */
  private buildCoverage(map: WorldMapData): void {
    this.covered = new Uint8Array(map.width * map.height);
    if (!map.sections || map.sectionWidth === undefined || map.sectionHeight === undefined) {
      this.covered.fill(1);
      return;
    }
    for (const section of map.sections) {
      const { x: ox, y: oy } = this.sectionOrigin(map, section);
      for (let row = 0; row < map.sectionWidth; row++) {
        const y = oy + row;
        if (y >= map.height) continue;
        this.covered.fill(1, y * map.width + ox, y * map.width + ox + map.sectionHeight);
      }
    }
  }

  private buildLegend(): void {
    this.legendEl.innerHTML = '';
    if (this.legendNoteEl) {
      // P3 renders the real bundled artwork; P1/P2's flat class colours are
      // stand-ins for an icon bank that is only decoded for P1.
      const real = Boolean(this.map?.terrainTiles);
      this.legendNoteEl.textContent = real
        ? 'Terrain class (colours sampled from the real tiles):'
        : 'Terrain class (placeholder colours):';
    }

    const used = new Set<number>();
    const cells = this.map?.cells ?? [];
    for (let i = 0; i < cells.length; i++) {
      if (this.covered[i]) {
        const cls = this.classOf(cells[i]);
        if (cls >= 0) used.add(cls);
      }
    }
    for (const cls of Array.from(used).sort((a, b) => a - b)) {
      const item = document.createElement('span');
      item.className = 'map-legend-item';
      const label = this.classNameOf(cls);
      const note = this.map?.terrainClassNames ? undefined : TILE_CLASS_STYLES[cls]?.note;
      item.title = note ? `${label} (class ${cls}) — ${note}` : `${label} (class ${cls})`;
      const sw = document.createElement('span');
      sw.className = 'map-legend-swatch';
      sw.style.background = this.classColorOf(cls);
      item.appendChild(sw);
      item.appendChild(document.createTextNode(label));
      this.legendEl.appendChild(item);
    }
  }

  private bindStrip(): void {
    const bind = (id: string, layer: keyof typeof this.layers) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return;
      el.checked = this.layers[layer];
      this.on(el, 'change', () => {
        this.layers[layer] = el.checked;
        this.draw();
      });
    };
    bind('map-layer-terrain', 'terrain');
    bind('map-layer-pois', 'pois');
    bind('map-layer-labels', 'labels');
    bind('map-layer-sections', 'sections');

    // The section overlay is meaningless for a single-file world grid.
    const sectionToggle = document.getElementById('map-layer-sections')?.closest('label');
    if (sectionToggle instanceof HTMLElement) setHidden(sectionToggle, !this.map?.sections);

    const fitBtn = document.getElementById('map-fit');
    if (fitBtn) this.on(fitBtn, 'click', () => this.fit());
  }

  // ─── Geometry ──────────────────────────────────────────────────────────

  private sizeCanvas(): void {
    if (!this.canvas || !this.ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private fit(): void {
    if (!this.map || !this.canvas) return;
    this.sizeCanvas();
    const viewW = this.canvas.clientWidth;
    const viewH = this.canvas.clientHeight;
    const mapW = this.map.width * CELL;
    const mapH = this.map.height * CELL;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(viewW / mapW, viewH / mapH) * 0.95));
    this.offsetX = (viewW - mapW * this.zoom) / 2;
    this.offsetY = (viewH - mapH * this.zoom) / 2;
    this.draw();
  }

  private clientToCell(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!this.map || !this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - this.offsetX) / this.zoom / CELL);
    const y = Math.floor((clientY - rect.top - this.offsetY) / this.zoom / CELL);
    if (x < 0 || x >= this.map.width || y < 0 || y >= this.map.height) return null;
    return { x, y };
  }

  // ─── Drawing ───────────────────────────────────────────────────────────

  private draw(): void {
    const map = this.map;
    const ctx = this.ctx;
    if (!map || !ctx || !this.canvas) return;

    const viewW = this.canvas.clientWidth;
    const viewH = this.canvas.clientHeight;
    ctx.clearRect(0, 0, viewW, viewH);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.zoom, this.zoom);

    // Only touch cells actually on screen — at MAX_ZOOM the full sweep is
    // almost entirely off-canvas.
    const x0 = Math.max(0, Math.floor(-this.offsetX / this.zoom / CELL));
    const y0 = Math.max(0, Math.floor(-this.offsetY / this.zoom / CELL));
    const x1 = Math.min(map.width, Math.ceil((viewW - this.offsetX) / this.zoom / CELL) + 1);
    const y1 = Math.min(map.height, Math.ceil((viewH - this.offsetY) / this.zoom / CELL) + 1);

    if (this.layers.terrain) {
      if (this.tileSheet) this.drawTerrainTiles(ctx, map, x0, y0, x1, y1);
      else this.drawTerrainClasses(ctx, map, x0, y0, x1, y1);
    }
    if (this.layers.sections && map.sections) this.drawSections(ctx, map);
    if (this.layers.pois) this.drawPois(ctx);

    ctx.restore();
  }

  /**
   * P3: blit each cell's own 16x16 tile out of the bundled bank. The cell
   * byte is the tile index verbatim — the game's blitter does exactly this,
   * including the clamp for values past the end of the bank.
   */
  private drawTerrainTiles(
    ctx: CanvasRenderingContext2D,
    map: WorldMapData,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    const sheet = this.tileSheet!;
    const columns = map.terrainTileColumns ?? 1;
    const count = map.terrainTileCount ?? columns * Math.max(1, Math.round(sheet.height / 16));
    const tileW = Math.floor(sheet.width / columns);
    const tileH = Math.floor(sheet.height / Math.ceil(count / columns));
    // Neighbouring cells land on fractional device pixels at a fractional
    // zoom and antialias into hairline seams; a one-CSS-pixel overrun, drawn
    // left-to-right and top-to-bottom, is painted over by whatever follows.
    const bleed = 1 / this.zoom;
    ctx.imageSmoothingEnabled = false;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * map.width + x;
        if (!this.covered[i]) continue;
        const tile = Math.min(Math.max(map.cells[i], 0), count - 1);
        ctx.drawImage(
          sheet,
          (tile % columns) * tileW,
          Math.floor(tile / columns) * tileH,
          tileW,
          tileH,
          x * CELL,
          y * CELL,
          CELL + bleed,
          CELL + bleed,
        );
      }
    }
  }

  /** P1/P2: one class-wide fill per cell — a repeating icon pattern, or a flat colour. */
  private drawTerrainClasses(
    ctx: CanvasRenderingContext2D,
    map: WorldMapData,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    const bleed = 1 / this.zoom;
    // -1 = uncovered (no fill), otherwise a terrain class index.
    const NONE = -1;

    for (let y = y0; y < y1; y++) {
      let runStart = x0;
      let runClass = NONE;
      for (let x = x0; x <= x1; x++) {
        const i = y * map.width + x;
        const cls = x < x1 && this.covered[i] ? this.classOf(map.cells[i]) : NONE;
        if (cls === runClass) continue;
        // Merge equal-class runs into one fillRect: whole ocean rows would
        // otherwise cost 77 fills each. A texture pattern tiles correctly
        // across a wide fillRect the same way a flat colour does.
        if (runClass !== NONE && x > runStart) {
          const skinned = this.useP3Skin ? this.p3SkinPatterns[runClass] : undefined;
          ctx.fillStyle = skinned ?? this.terrainPatterns[runClass] ?? this.classColorOf(runClass);
          ctx.fillRect(runStart * CELL, y * CELL, (x - runStart) * CELL + bleed, CELL + bleed);
        }
        runStart = x;
        runClass = cls;
      }
    }
  }

  private drawSections(ctx: CanvasRenderingContext2D, map: WorldMapData): void {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1 / this.zoom;
    for (const section of map.sections ?? []) {
      const { x: ox, y: oy } = this.sectionOrigin(map, section);
      ctx.strokeRect(
        ox * CELL,
        oy * CELL,
        (map.sectionHeight ?? 0) * CELL,
        (map.sectionWidth ?? 0) * CELL,
      );
      if (this.zoom * CELL >= LABEL_MIN_CELL_PX) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = `${10 / this.zoom}px monospace`;
        ctx.fillText(`§${section}`, ox * CELL + 2 / this.zoom, oy * CELL + 11 / this.zoom);
      }
    }
  }

  private drawPois(ctx: CanvasRenderingContext2D): void {
    const cellPx = this.zoom * CELL;
    const showLabels = this.layers.labels && cellPx >= LABEL_MIN_CELL_PX;
    const showLongLabels = cellPx >= LABEL_LONG_MIN_CELL_PX;
    const r = CELL * 0.55;
    const fontPx = 11 / this.zoom;

    for (const poi of this.pois) {
      const style = POI_STYLES[poi.type] ?? POI_STYLES.other;
      const cx = poi.x * CELL + CELL / 2;
      const cy = poi.y * CELL + CELL / 2;

      ctx.fillStyle = style.color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1 / this.zoom;
      ctx.beginPath();
      if (style.shape === 'diamond') {
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
      } else if (style.shape === 'circle') {
        ctx.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
      } else {
        ctx.rect(cx - r * 0.6, cy - r * 0.6, r * 1.2, r * 1.2);
      }
      ctx.fill();
      ctx.stroke();

      if (!showLabels || !CAPTIONED_POI_TYPES.has(poi.type)) continue;
      if (poi.label.length > LABEL_LONG_CHARS && !showLongLabels) continue;
      ctx.font = `${fontPx}px monospace`;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3 / this.zoom;
      ctx.fillStyle = style.color;
      const tx = cx + r + 2 / this.zoom;
      const ty = cy + fontPx / 3;
      ctx.strokeText(poi.label, tx, ty);
      ctx.fillText(poi.label, tx, ty);
    }
  }

  // ─── Interaction ───────────────────────────────────────────────────────

  private onWheel(e: WheelEvent): void {
    if (!this.canvas) return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    // Keep the cell under the cursor pinned while the scale changes.
    this.offsetX = mx - (mx - this.offsetX) * (next / this.zoom);
    this.offsetY = my - (my - this.offsetY) * (next / this.zoom);
    this.zoom = next;
    this.draw();
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.canvas) return;
    this.dragging = true;
    this.dragMoved = false;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragOffsetX = this.offsetX;
    this.dragOffsetY = this.offsetY;
    this.canvas.style.cursor = 'grabbing';
  }

  private onMouseMove(e: MouseEvent): void {
    const cell = this.clientToCell(e.clientX, e.clientY);
    this.coordEl.textContent = cell ? this.describeCell(cell.x, cell.y) : '';

    if (!this.dragging) return;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    // A few pixels of jitter is still a click, not a pan.
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.dragMoved = true;
    this.offsetX = this.dragOffsetX + dx;
    this.offsetY = this.dragOffsetY + dy;
    this.draw();
  }

  private onMouseUp(e: MouseEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.canvas) this.canvas.style.cursor = 'grab';
    if (this.dragMoved) return;
    const cell = this.clientToCell(e.clientX, e.clientY);
    if (!cell) return;
    this.detailEl.textContent = this.describeCellVerbose(cell.x, cell.y);
    this.onTileClick?.(cell.x, cell.y);
  }

  private describeCell(x: number, y: number): string {
    const map = this.map!;
    const i = y * map.width + x;
    if (!this.covered[i]) return `(${x}, ${y}) — no shipped section covers this cell`;
    const code = map.cells[i];
    const cls = this.classOf(code);
    const poi = this.poiByCell.get(i);
    // A per-value tile index has no "art variant" digit; a class code does.
    const base = map.terrainClassByValue
      ? `(${x}, ${y}) tile ${code} · ${cls >= 0 ? this.classNameOf(cls) : 'named location'}`
      : `(${x}, ${y}) tile ${code} · class ${cls} · variant ${tileVariantOf(code)}`;
    return poi ? `${base} · ${poi.type}` : base;
  }

  private describeCellVerbose(x: number, y: number): string {
    const poi = this.poiByCell.get(y * this.map!.width + x);
    if (!poi) return this.describeCell(x, y);
    const parts = [this.describeCell(x, y)];
    if (poi.section !== undefined) {
      parts.push(`section ${poi.section} (${poi.col}, ${poi.row})`);
      parts.push(`record +2=${poi.index} +3=${poi.param}`);
    } else {
      parts.push(`${poi.type} ${poi.index}`);
    }
    if (poi.message?.length) parts.push(`“${poi.message.join(' / ')}”`);
    else parts.push(poi.label);
    if (poi.file) parts.push(`opens ${poi.file}`);
    return parts.join(' — ');
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
