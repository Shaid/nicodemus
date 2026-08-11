/**
 * World-map view for the asset viewer.
 *
 * Renders the assembled Phantasie I overworld (77 x 126 cells, built by
 * `tools/phantasie/build-map.ts`) on a Canvas 2D surface with drag-to-pan,
 * wheel zoom toward the cursor, and toggleable overlay layers.
 *
 * The terrain byte is not a per-cell graphics index — the real game plots
 * the visible map from each section's own display list against the 16 x 16
 * area-fill patterns in the executable's icon bank, one per terrain class
 * (docs/phantasie/dungeon-format.md §8.2.4a). That bank is now decoded, and
 * `build-map.ts` bakes the true-to-hardware picture to
 * `screens/world-map.png` (1512 x 693) plus a `textures/terrain-icons.png`
 * strip of the twelve patterns.
 *
 * This *view* stays a flat-colour rendering of the gameplay grid on
 * purpose: it is the layer the party actually walks on (movement cost,
 * passability, fog, event dispatch), it needs per-cell hit-testing for the
 * POI overlay, and the grid's axes are the engine's, not the screen's — see
 * §8.2.1's 2026-08-11 correction, where `x` here is the north-south index
 * and `y` the east-west one, so this grid is a quarter-turn from the baked
 * picture. Each swatch below is now taken from its class's own real art,
 * and every class name is confirmed (§8.3.3a).
 */
import { setHidden } from './shared.ts';

export interface WorldMapData {
  width: number;
  height: number;
  sectionWidth: number;
  sectionHeight: number;
  sectionStrideX: number;
  sectionStrideY: number;
  sections: number[];
  /** Row-major revealed tile codes, `cell[x,y]` at `y * width + x`. */
  cells: number[];
}

export type WorldPoiType = 'town' | 'dungeon' | 'text' | 'bump' | 'silent' | 'other';

export interface WorldPoi {
  section: number;
  col: number;
  row: number;
  x: number;
  y: number;
  type: WorldPoiType;
  tile: number;
  index: number;
  param: number;
  label: string;
  message?: string[];
}

interface TileClassStyle {
  color: string;
  /** English name, all confirmed — dungeon-format.md §8.3.3a. */
  name: string;
  note?: string;
}

/**
 * One flat colour per terrain class (`tile / 10`), each keyed off the
 * dominant ink of that class's own 16 x 16 fill pattern in the icon bank,
 * lightened enough to stay legible against the black most of those patterns
 * use as their background. Classes 4 and 5 have no pattern at all — the
 * engine draws them as markers — so those two are chosen freely.
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
  text: { color: '#7fd7ff', shape: 'circle' },
  bump: { color: '#b48cff', shape: 'circle' },
  silent: { color: '#9aa0a6', shape: 'square' },
  other: { color: '#ffffff', shape: 'square' },
};

/** World pixels per map cell at zoom 1. Arbitrary — nothing is baked. */
const CELL = 8;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 12;
/** Below this on-screen cell size, marker captions are suppressed as noise. */
const LABEL_MIN_CELL_PX = 7;

function tileClassOf(code: number): number {
  return Math.floor(code / 10);
}

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

  /** Fired on a click that wasn't a pan. Tile-grid coordinates, not pixels. */
  onTileClick: ((x: number, y: number) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.strip = document.getElementById('map-strip')!;
    this.coordEl = document.getElementById('map-coord')!;
    this.detailEl = document.getElementById('map-detail')!;
    this.legendEl = document.getElementById('map-legend')!;
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
  }

  hide(): void {
    this.teardown();
    this.container.classList.remove('map-mode');
    setHidden(this.strip, true);
    this.map = null;
    this.pois = [];
    this.poiByCell.clear();
  }

  /** Human-readable summary for the viewer toolbar. */
  get summary(): string {
    if (!this.map) return '';
    return `${this.map.width}×${this.map.height} cells, ${this.pois.length} POIs`;
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
   * The world grid has 4 x 5 section slots but only 18 ship a file: slots 17
   * and 20 are addressable but empty (dungeon-format.md §8.3.2). Those cells
   * come out of `assembleWorld()` as byte 0, which is indistinguishable from
   * a real class-0 land tile — so mark them and draw nothing there rather
   * than 950 cells of phantom grassland.
   */
  private buildCoverage(map: WorldMapData): void {
    this.covered = new Uint8Array(map.width * map.height);
    for (const section of map.sections) {
      const slot = section - 1;
      const ox = (slot % 4) * map.sectionStrideX;
      const oy = Math.floor(slot / 4) * map.sectionStrideY;
      for (let row = 0; row < map.sectionHeight; row++) {
        const y = oy + row;
        if (y >= map.height) continue;
        this.covered.fill(1, y * map.width + ox, y * map.width + ox + map.sectionWidth);
      }
    }
  }

  private buildLegend(): void {
    this.legendEl.innerHTML = '';
    const used = new Set<number>();
    const cells = this.map?.cells ?? [];
    for (let i = 0; i < cells.length; i++) {
      if (this.covered[i]) used.add(tileClassOf(cells[i]));
    }
    for (const cls of Array.from(used).sort((a, b) => a - b)) {
      const style = TILE_CLASS_STYLES[cls];
      const item = document.createElement('span');
      item.className = 'map-legend-item';
      const label = style?.name ?? `Class ${cls}`;
      item.title = style?.note ? `${label} (class ${cls}) — ${style.note}` : `${label} (class ${cls})`;
      const sw = document.createElement('span');
      sw.className = 'map-legend-swatch';
      sw.style.background = style?.color ?? UNKNOWN_CLASS_COLOR;
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

    // Only touch cells actually on screen — at MAX_ZOOM the full 9,702-cell
    // sweep is almost entirely off-canvas.
    const x0 = Math.max(0, Math.floor(-this.offsetX / this.zoom / CELL));
    const y0 = Math.max(0, Math.floor(-this.offsetY / this.zoom / CELL));
    const x1 = Math.min(map.width, Math.ceil((viewW - this.offsetX) / this.zoom / CELL) + 1);
    const y1 = Math.min(map.height, Math.ceil((viewH - this.offsetY) / this.zoom / CELL) + 1);

    if (this.layers.terrain) this.drawTerrain(ctx, map, x0, y0, x1, y1);
    if (this.layers.sections) this.drawSections(ctx, map);
    if (this.layers.pois) this.drawPois(ctx);

    ctx.restore();
  }

  private drawTerrain(
    ctx: CanvasRenderingContext2D,
    map: WorldMapData,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    // Rects are laid out in unscaled world units, so at a fractional zoom
    // neighbours land on fractional device pixels and antialias into hairline
    // seams. Overrunning each rect by one CSS pixel closes them: runs are
    // drawn left-to-right and rows top-to-bottom, so the overrun is painted
    // over by whatever comes next.
    const bleed = 1 / this.zoom;

    for (let y = y0; y < y1; y++) {
      let runStart = x0;
      let runColor = '';
      for (let x = x0; x <= x1; x++) {
        const i = y * map.width + x;
        const color =
          x < x1 && this.covered[i]
            ? (TILE_CLASS_STYLES[tileClassOf(map.cells[i])]?.color ?? UNKNOWN_CLASS_COLOR)
            : '';
        if (color === runColor) continue;
        // Merge equal-colour runs into one fillRect: whole ocean rows would
        // otherwise cost 77 fills each.
        if (runColor !== '' && x > runStart) {
          ctx.fillStyle = runColor;
          ctx.fillRect(
            runStart * CELL,
            y * CELL,
            (x - runStart) * CELL + bleed,
            CELL + bleed,
          );
        }
        runStart = x;
        runColor = color;
      }
    }
  }

  private drawSections(ctx: CanvasRenderingContext2D, map: WorldMapData): void {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1 / this.zoom;
    for (let i = 0; i < map.sections.length; i++) {
      const slot = map.sections[i] - 1;
      const ox = (slot % 4) * map.sectionStrideX;
      const oy = Math.floor(slot / 4) * map.sectionStrideY;
      ctx.strokeRect(
        ox * CELL,
        oy * CELL,
        map.sectionWidth * CELL,
        map.sectionHeight * CELL,
      );
      if (this.zoom * CELL >= LABEL_MIN_CELL_PX) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = `${10 / this.zoom}px monospace`;
        ctx.fillText(`§${map.sections[i]}`, ox * CELL + 2 / this.zoom, oy * CELL + 11 / this.zoom);
      }
    }
  }

  private drawPois(ctx: CanvasRenderingContext2D): void {
    const showLabels = this.layers.labels && this.zoom * CELL >= LABEL_MIN_CELL_PX;
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

      // Only towns and dungeons get a caption at every zoom — 101 markers of
      // running text at once is unreadable.
      const captioned = poi.type === 'town' || poi.type === 'dungeon';
      if (!showLabels || !captioned) continue;
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
    const i = y * this.map!.width + x;
    if (!this.covered[i]) return `(${x}, ${y}) — no shipped section covers this cell`;
    const code = this.map!.cells[i];
    const poi = this.poiByCell.get(i);
    const base = `(${x}, ${y}) tile ${code} · class ${tileClassOf(code)} · variant ${tileVariantOf(code)}`;
    return poi ? `${base} · ${poi.type}` : base;
  }

  private describeCellVerbose(x: number, y: number): string {
    const poi = this.poiByCell.get(y * this.map!.width + x);
    if (!poi) return this.describeCell(x, y);
    const parts = [
      this.describeCell(x, y),
      `section ${poi.section} (${poi.col}, ${poi.row})`,
      `record +2=${poi.index} +3=${poi.param}`,
    ];
    if (poi.message?.length) parts.push(`“${poi.message.join(' / ')}”`);
    else parts.push(poi.label);
    return parts.join(' — ');
  }
}
