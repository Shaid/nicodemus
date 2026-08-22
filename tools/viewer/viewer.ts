import { setHidden, type AtlasMeta, type PaletteData, type AtlasFrame } from './shared.ts';
import { WorldMapViewer } from './map-viewer.ts';
import { MusicPlayer } from './music-player.ts';
import { DungeonViewer } from './dungeon-viewer.ts';
import { setDataTabActive, isDataTabActive, renderDataList, setDataAssetBase } from './data-view.ts';
import {
  downloadScreenshot,
  recordClip,
  downloadClip,
  createPopover,
  buildGradingFilterString,
  type CaptureSource,
  type RecordClipDriver,
  type GradingOptions,
} from '@seer-project/canvas-export';
import {
  createRetroDisplayRenderer,
  resolveRetroDisplayOptions,
  type DisplayProfile,
  type RetroDisplayOptions,
  type RetroDisplayRenderer,
} from '@seer-project/retro-display';
import {
  GAME_IDS,
  GAME_DISPLAY_NAMES,
  DEFAULT_GAME,
  DEFAULT_PLATFORM,
  isGameId,
  isPlatformId,
  type GameId,
  type PlatformId,
} from '../../src/game-id.ts';

/**
 * Per-game/platform asset output directory, mirroring the `assetDir` field
 * each entry declares in `tools/shared/game-config.ts`. Duplicated here
 * (rather than imported) because that file is Node-oriented — it imports
 * `@seer-project/pipeline` — and importing it directly into this browser-run script
 * would pull Node-only code into the viewer's bundle (architecture-overview.md
 * §2's dependency rule: `src/`/browser code must never depend on `tools/`
 * Node internals). Every game happens to have `assetDir === gameId` today,
 * but this map is keyed independently so that stops being an assumption
 * baked into the viewer if a future game's `assetDir` ever diverges.
 */
const GAME_PLATFORMS: Record<GameId, { platform: PlatformId; assetDir: string }[]> = {
  phantasie: [{ platform: 'amiga', assetDir: 'phantasie' }],
  phantasieii: [{ platform: 'atarist', assetDir: 'phantasieii' }],
  phantasieiii: [{ platform: 'amiga', assetDir: 'phantasieiii' }],
};

function assetDirFor(game: GameId, platform: PlatformId): string {
  const entry = GAME_PLATFORMS[game].find((p) => p.platform === platform);
  return entry?.assetDir ?? game;
}

function assetBaseFor(game: GameId, platform: PlatformId): string {
  return `/assets/${assetDirFor(game, platform)}/${platform}`;
}

interface ManifestEntry {
  name: string;
  sprites: number;
  hasPalette: boolean;
  png: string;
  /**
   * Which view the entry opens in. Absent (every sprite atlas and picture)
   * means the ordinary PNG-backed canvas; `'map'` means the world-map view,
   * which fetches `<name>.json` + `<name>-pois.json` and draws vector-ish
   * flat-coloured cells instead — see `map-viewer.ts`; `'music'` means the
   * Web Audio player, which fetches the raw `music/<name>.bin` stream and
   * decodes it in the browser — see `music-player.ts`. `'dungeon'` means
   * the dungeon grid view — fetches `<name>.json` and draws a flat-coloured
   * top-down cell grid, with click-to-inspect for star triggers — see
   * `dungeon-viewer.ts`. `'data-table'` entries (written by each game's
   * `build-data-tables.ts` for the public docs site's `DataTable.astro`)
   * carry no atlas/palette JSON in this shape at all — they're filtered out
   * of this list entirely and browsed instead through the Data tab
   * (`data-view.ts`), which reads the same underlying JSON files directly.
   */
  type?: 'atlas' | 'map' | 'music' | 'dungeon' | 'data-table';
}

const listEl = document.getElementById('list')!;
const listMetaEl = document.getElementById('list-meta')!;
const searchEl = document.getElementById('search') as HTMLInputElement;
const dataSearchEl = document.getElementById('data-search') as HTMLInputElement;
const tabAssetsBtn = document.getElementById('tab-assets') as HTMLButtonElement;
const tabDataBtn = document.getElementById('tab-data') as HTMLButtonElement;
const assetSidebarEl = document.getElementById('asset-sidebar')!;
const dataSidebarEl = document.getElementById('data-sidebar')!;
const assetViewEl = document.getElementById('asset-view')!;
const pageTitleEl = document.getElementById('page-title')!;
const gameSelectEl = document.getElementById('game-select') as HTMLSelectElement;
const platformSelectEl = document.getElementById('platform-select') as HTMLSelectElement;
const titleEl = document.getElementById('title')!;
const metaEl = document.getElementById('meta')!;
const frameInfoEl = document.getElementById('frame-info')!;
const canvasWrap = document.getElementById('canvas-wrap')!;
const zoomEl = document.getElementById('zoom') as HTMLSelectElement;
const bgEl = document.getElementById('bg') as HTMLSelectElement;
const frameStrip = document.getElementById('frame-strip')!;
const frameSlider = document.getElementById('frame-slider') as HTMLInputElement;
const frameLabel = document.getElementById('frame-label')!;
const playToggleEl = document.getElementById('play-toggle') as HTMLButtonElement;
const paletteBar = document.getElementById('palette-bar')!;
const spriteScreenshotBtn = document.getElementById('sprite-screenshot') as HTMLButtonElement;
const spriteRecordBtn = document.getElementById('sprite-record') as HTMLButtonElement;
const spriteDisplayToggle = document.getElementById('sprite-display-toggle') as HTMLButtonElement;
const spriteDisplayPanel = document.getElementById('sprite-display-panel')!;
const displayProfileEl = document.getElementById('display-profile') as HTMLSelectElement;
const displayScanlineEl = document.getElementById('display-scanline') as HTMLInputElement;
const displayMaskEl = document.getElementById('display-mask') as HTMLInputElement;
const displayCurvatureEl = document.getElementById('display-curvature') as HTMLInputElement;
const displayVignetteEl = document.getElementById('display-vignette') as HTMLInputElement;
const displayGlowEl = document.getElementById('display-glow') as HTMLInputElement;
const displayChromaticEl = document.getElementById('display-chromatic') as HTMLInputElement;
const gradingBrightnessEl = document.getElementById('grading-brightness') as HTMLInputElement;
const gradingContrastEl = document.getElementById('grading-contrast') as HTMLInputElement;
const gradingSaturateEl = document.getElementById('grading-saturate') as HTMLInputElement;
const gradingHueEl = document.getElementById('grading-hue') as HTMLInputElement;
const gradingResetBtn = document.getElementById('grading-reset') as HTMLButtonElement;

let manifest: ManifestEntry[] = [];
let selected: ManifestEntry | null = null;
/** The list as currently filtered/searched — kept in sync by renderList(), used by Up/Down keyboard navigation. */
let currentFilteredList: ManifestEntry[] = [];
let currentAtlas: AtlasMeta | null = null;
let currentPalette: PaletteData | null = null;
let currentFrames: AtlasFrame[] = [];
let currentFrame = 0;
/** Colour grading applied via `ctx.filter` in the atlas Canvas2D draw path, and composited in place for the map/dungeon/music views (Phase 4 of 2d-export-proposal.md) — persists across asset switches, like zoom/background. */
let gradingOptions: GradingOptions = {};
/** Post-display simulation (Phases 5-6) — persists across asset switches. Renderer created lazily (first non-'none' selection) since it opens its own WebGL2 context. */
let displayOptions: RetroDisplayOptions = { profile: 'none' };
let retroDisplayRenderer: RetroDisplayRenderer | null = null;
/** Created on first use — most sessions never open the map. */
let mapViewer: WorldMapViewer | null = null;
/** Likewise: no AudioContext exists until a music asset is opened. */
let musicPlayer: MusicPlayer | null = null;
/** Likewise: no dungeon fetch until a dungeon asset is opened. */
let dungeonViewer: DungeonViewer | null = null;

let currentGame: GameId = DEFAULT_GAME;
let currentPlatform: PlatformId = DEFAULT_PLATFORM;
let ASSET_BASE = assetBaseFor(currentGame, currentPlatform);

/** Read `?game=`/`?platform=`/`?asset=` from the URL, falling back to the
 *  game-id module's defaults, and clamping to a platform that's actually
 *  valid for the chosen game (per `GAME_PLATFORMS` above). `asset` is left
 *  unvalidated here — it can only be checked against a loaded manifest. */
function parseInitialSelection(): { game: GameId; platform: PlatformId; asset: string | null } {
  const params = new URLSearchParams(location.search);
  const gameParam = params.get('game');
  const platformParam = params.get('platform');

  const game = isGameId(gameParam) ? gameParam : DEFAULT_GAME;
  const platformsForGame = GAME_PLATFORMS[game];
  const platform =
    isPlatformId(platformParam) && platformsForGame.some((p) => p.platform === platformParam)
      ? platformParam
      : platformsForGame[0].platform;

  return { game, platform, asset: params.get('asset') };
}

/** `?asset=` from the initial URL, consumed by the first manifest load. */
let pendingAsset: string | null = null;

function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set('game', currentGame);
  url.searchParams.set('platform', currentPlatform);
  if (selected) url.searchParams.set('asset', selected.name);
  else url.searchParams.delete('asset');
  history.replaceState({}, '', url);
}

function populateGameSelect() {
  gameSelectEl.innerHTML = '';
  for (const id of GAME_IDS) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = GAME_DISPLAY_NAMES[id];
    gameSelectEl.appendChild(opt);
  }
  gameSelectEl.value = currentGame;
}

function populatePlatformSelect() {
  platformSelectEl.innerHTML = '';
  for (const { platform } of GAME_PLATFORMS[currentGame]) {
    const opt = document.createElement('option');
    opt.value = platform;
    opt.textContent = platform;
    platformSelectEl.appendChild(opt);
  }
  platformSelectEl.value = currentPlatform;
}

async function loadManifest(): Promise<ManifestEntry[]> {
  try {
    const res = await fetch(`${ASSET_BASE}/manifest.json`);
    if (!res.ok) throw new Error('Manifest not found');
    return await res.json();
  } catch {
    return [];
  }
}

async function loadJSON<T>(name: string): Promise<T | null> {
  try {
    const res = await fetch(`${ASSET_BASE}/${name}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Switch to a different game/platform: recompute the asset base, update
 *  the URL and page chrome, and reload the manifest from scratch. */
async function switchGamePlatform(game: GameId, platform: PlatformId) {
  currentGame = game;
  currentPlatform = platform;
  ASSET_BASE = assetBaseFor(currentGame, currentPlatform);
  setDataAssetBase(ASSET_BASE, currentGame);

  pageTitleEl.textContent = `${GAME_DISPLAY_NAMES[currentGame]} (${currentPlatform}) — Asset Viewer`;
  document.title = pageTitleEl.textContent;

  // Cleared before updateUrl() so a stale `?asset=` doesn't survive the
  // switch — the name almost certainly doesn't exist in the new manifest.
  selected = null;
  stopPlayback();
  updateUrl();
  currentAtlas = null;
  currentPalette = null;
  currentFrames = [];
  currentFrame = 0;
  mapViewer?.hide();
  musicPlayer?.hide();
  dungeonViewer?.hide();

  // `data-table` entries have no atlas/palette shape and are browsed
  // through the Data tab instead — see the `ManifestEntry.type` doc comment.
  manifest = (await loadManifest()).filter((a) => a.type !== 'data-table');
  // `?asset=` is honoured once, on the load that the URL was parsed for —
  // switching game/platform afterwards starts from no selection again.
  const wanted = pendingAsset;
  pendingAsset = null;
  const preselect = wanted ? manifest.find((a) => a.name === wanted) : undefined;
  if (manifest.length === 0) {
    listEl.innerHTML = '<div class="no-results"><p>No assets found.</p><p style="margin-top:8px;font-size:11px;">Run <code>npm run build-assets</code> first.</p></div>';
  }
  if (preselect) {
    await selectAsset(preselect);
    return;
  }
  renderList();
  drawAsset();
}

function renderList() {
  const q = searchEl.value.trim().toLowerCase();
  const filtered = q ? manifest.filter(a => a.name.includes(q)) : manifest;
  currentFilteredList = filtered;

  listMetaEl.textContent = `${filtered.length} of ${manifest.length} assets`;

  listEl.innerHTML = '';
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'no-results';
    empty.textContent = 'No matching assets.';
    listEl.appendChild(empty);
    return;
  }

  for (const a of filtered) {
    const item = document.createElement('div');
    item.className = 'item';
    if (selected === a) item.classList.add('selected');
    const dim =
      a.type === 'map' || a.type === 'music' || a.type === 'dungeon'
        ? `<span class="tag">${a.type}</span>`
        : `${a.sprites}sp${a.hasPalette ? ' · pal' : ''}`;
    item.innerHTML = `<span class="item-label">${a.name}</span><span class="item-dim">${dim}</span>`;
    item.addEventListener('click', () => selectAsset(a));
    listEl.appendChild(item);
  }
}

async function selectAsset(asset: ManifestEntry) {
  selected = asset;
  currentFrame = 0;
  stopPlayback();
  updateUrl();

  if (asset.type === 'map' || asset.type === 'music' || asset.type === 'dungeon') {
    currentAtlas = null;
    currentPalette = null;
    currentFrames = [];
    renderList();
    if (asset.type === 'map') {
      musicPlayer?.hide();
      dungeonViewer?.hide();
      await showMap(asset);
    } else if (asset.type === 'music') {
      mapViewer?.hide();
      dungeonViewer?.hide();
      await showMusic(asset);
    } else {
      mapViewer?.hide();
      musicPlayer?.hide();
      await showDungeon(asset);
    }
    return;
  }

  mapViewer?.hide();
  musicPlayer?.hide();
  dungeonViewer?.hide();
  currentAtlas = await loadJSON<AtlasMeta>(`${asset.name}.json`);
  currentPalette = asset.hasPalette ? await loadJSON<PaletteData>(`${asset.name}.pal.json`) : null;
  currentFrames = currentAtlas?.frames ?? [];
  // Primed here, once per asset, so drawAsset() -> drawSpriteFrame()/
  // drawFullAtlas() above can stay fully synchronous for every subsequent
  // redraw of THIS asset (frame nav, zoom change, autoplay tick).
  await loadCachedAtlasImage(`${ASSET_BASE}/${asset.name}.png`);
  renderList();
  drawAsset();
}

/** Step Up/Down through the currently-filtered sidebar list, wrapping around,
 *  and scroll the newly-selected item into view. */
async function navigateList(delta: 1 | -1): Promise<void> {
  if (currentFilteredList.length === 0) return;
  const currentIndex = selected ? currentFilteredList.indexOf(selected) : -1;
  const nextIndex =
    currentIndex === -1
      ? 0
      : (currentIndex + delta + currentFilteredList.length) % currentFilteredList.length;
  await selectAsset(currentFilteredList[nextIndex]!);
  listEl.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' });
}

/** World-map entries bypass the atlas canvas entirely. */
async function showMap(asset: ManifestEntry) {
  titleEl.textContent = `${asset.name} — world map`;
  metaEl.textContent = '';
  frameInfoEl.textContent = 'drag to pan · scroll to zoom';
  setHidden(frameStrip, true);
  setHidden(paletteBar, true);
  setHidden(spriteDisplayToggle, false);
  spriteRecordBtn.disabled = false;
  spriteRecordBtn.title = 'Record a watermarked clip of the sprite animation';
  const isNew = !mapViewer;
  mapViewer ??= new WorldMapViewer(canvasWrap);
  if (isNew) mapViewer.onAfterDraw = applyPostProcessingInPlace;
  await mapViewer.show(ASSET_BASE, asset.name);
  metaEl.textContent = mapViewer.summary;
}

/** Music entries open the Web Audio player and its piano roll. */
async function showMusic(asset: ManifestEntry) {
  titleEl.textContent = `${asset.name} — music`;
  metaEl.textContent = '';
  frameInfoEl.textContent = 'click the roll to inspect a note';
  setHidden(frameStrip, true);
  setHidden(paletteBar, true);
  setHidden(spriteDisplayToggle, false);
  spriteRecordBtn.disabled = false;
  spriteRecordBtn.title = 'Record a watermarked clip of the sprite animation';
  const isNew = !musicPlayer;
  musicPlayer ??= new MusicPlayer(canvasWrap);
  if (isNew) musicPlayer.onAfterDraw = applyPostProcessingInPlace;
  await musicPlayer.show(ASSET_BASE, asset.name);
  metaEl.textContent = musicPlayer.summary;
}

/** Dungeon entries open the flat-coloured grid view with click-to-inspect. */
async function showDungeon(asset: ManifestEntry) {
  titleEl.textContent = `${asset.name} — dungeon`;
  metaEl.textContent = '';
  frameInfoEl.textContent = 'click a cell to inspect it';
  setHidden(frameStrip, true);
  setHidden(paletteBar, true);
  setHidden(spriteDisplayToggle, false);
  spriteRecordBtn.disabled = false;
  spriteRecordBtn.title = 'Record a watermarked clip of the sprite animation';
  const isNew = !dungeonViewer;
  dungeonViewer ??= new DungeonViewer(canvasWrap);
  if (isNew) dungeonViewer.onAfterDraw = applyPostProcessingInPlace;
  await dungeonViewer.show(ASSET_BASE, asset.name, currentGame);
  metaEl.textContent = dungeonViewer.summary;
}

/** Redraws whichever non-atlas view is currently active, so a grading/display-profile slider change is reflected immediately — these views don't otherwise call back into drawAsset(). No-op for the atlas view (drawAsset() itself handles that) or when nothing is selected. */
function refreshActiveSecondaryView(): void {
  if (selected?.type === 'map') mapViewer?.redraw();
  else if (selected?.type === 'music') musicPlayer?.redraw();
  else if (selected?.type === 'dungeon') dungeonViewer?.redraw();
}

// ── Persistent canvas + image cache (Phase 2 of 2d-export-proposal.md) ──
//
// The previous atlas implementation did `canvasWrap.innerHTML = ''` +
// created a BRAND NEW `<canvas>` on every single draw, and re-fetched/
// re-decoded the atlas PNG via a fresh `Image()` on every redraw even
// though nothing about the image itself had changed. That broke
// `canvas.captureStream()` (Phase 3's video export — a `MediaStreamTrack`
// goes to `ended` on the first frame advance if its source element gets
// replaced) and wasted work on every zoom change or frame-nav click.

const spriteCanvas2D = document.createElement('canvas');
/** Persistent Canvas2D canvas used only to composite grading (ctx.filter) over a raw-draw source — shared by both post-processing entry points below. */
const gradingCompositeCanvas2D = document.createElement('canvas');

/** Makes `canvas` the sole child of `canvasWrap` — a no-op (no DOM mutation) if it already is, so this is cheap to call unconditionally on every redraw. */
function mountSpriteCanvas(canvas: HTMLCanvasElement): void {
  if (canvasWrap.firstElementChild === canvas && canvasWrap.children.length === 1) return;
  canvasWrap.innerHTML = '';
  canvasWrap.appendChild(canvas);
}

/**
 * Runs `source` through grading then retro-display (whichever are active)
 * and returns the final canvas — `source` itself, unmodified, if neither
 * is active. Shared by `applyPostProcessing()` (mounts the result as the
 * atlas view's displayed canvas) and `applyPostProcessingInPlace()`
 * (composites the result back onto `source`, for the map/dungeon/music
 * views, each of which owns its own mouse/click listeners and so can't be
 * swapped for a different element).
 */
function postProcess(source: HTMLCanvasElement): HTMLCanvasElement {
  let current: HTMLCanvasElement = source;

  const gradingFilter = buildGradingFilterString(gradingOptions);
  if (gradingFilter !== 'none') {
    gradingCompositeCanvas2D.width = source.width;
    gradingCompositeCanvas2D.height = source.height;
    const ctx = gradingCompositeCanvas2D.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, gradingCompositeCanvas2D.width, gradingCompositeCanvas2D.height);
    ctx.filter = gradingFilter;
    ctx.drawImage(source, 0, 0);
    ctx.filter = 'none';
    current = gradingCompositeCanvas2D;
  }

  if (displayOptions.profile !== 'none') {
    retroDisplayRenderer ??= createRetroDisplayRenderer(displayOptions);
    retroDisplayRenderer.setOptions(displayOptions);
    retroDisplayRenderer.render(current);
    current = retroDisplayRenderer.canvas;
  }

  return current;
}

/** Atlas view: mounts whichever canvas `postProcess()` produces as canvasWrap's displayed canvas. */
function applyPostProcessing(source: HTMLCanvasElement): void {
  mountSpriteCanvas(postProcess(source));
}

/**
 * Map/dungeon/music views: composites grading/retro-display back onto
 * `canvas` itself, in place, so the element identity those views' own
 * event listeners are bound to stays stable. A no-op (leaves `canvas`
 * exactly as its owner just drew it) when neither grading nor a display
 * profile is active.
 */
function applyPostProcessingInPlace(canvas: HTMLCanvasElement): void {
  const result = postProcess(canvas);
  if (result === canvas) return;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(result, 0, 0, canvas.width, canvas.height);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

/** One-slot cache (plain atlas image) keyed by URL — `selectAsset()` primes this before its final `drawAsset()` call, so every subsequent redraw of THIS asset (zoom change, frame nav, autoplay tick) can stay fully synchronous. */
let cachedAtlasImage: HTMLImageElement | null = null;
let cachedAtlasImageUrl: string | null = null;

async function loadCachedAtlasImage(url: string): Promise<void> {
  if (cachedAtlasImageUrl === url && cachedAtlasImage) return;
  try {
    cachedAtlasImage = await loadImage(url);
    cachedAtlasImageUrl = url;
  } catch {
    cachedAtlasImage = null;
    cachedAtlasImageUrl = null;
  }
}

function drawAsset() {
  if (selected?.type === 'map' || selected?.type === 'music' || selected?.type === 'dungeon') return;
  if (!selected || !currentAtlas) {
    titleEl.textContent = 'No asset selected';
    metaEl.textContent = '';
    frameInfoEl.textContent = '';
    setHidden(frameStrip, true);
    setHidden(paletteBar, true);
    setHidden(spriteDisplayToggle, true);
    canvasWrap.innerHTML = '<div class="state-panel"><span class="state-icon">🖼</span><span class="state-title">Select an asset</span></div>';
    return;
  }
  setHidden(spriteDisplayToggle, false);

  const zoom = Number(zoomEl.value);
  const frame = currentFrames[currentFrame];

  if (frame) {
    titleEl.textContent = `${selected.name} — sprite ${currentFrame + 1}/${currentFrames.length}`;
    metaEl.textContent = `${frame.w}×${frame.h}`;
    frameInfoEl.textContent = `atlas ${currentAtlas.width}×${currentAtlas.height}`;
    setHidden(frameStrip, currentFrames.length <= 1);
    frameSlider.max = String(currentFrames.length - 1);
    frameSlider.value = String(currentFrame);
    frameLabel.textContent = `Sprite ${currentFrame + 1} / ${currentFrames.length}`;
    // Recording plays through currentFrames — meaningless (and disabled,
    // like the play/pause button already is) for a single-frame asset.
    spriteRecordBtn.disabled = currentFrames.length <= 1;
    spriteRecordBtn.title = currentFrames.length <= 1 ? 'This asset has only one frame' : 'Record a watermarked clip of the sprite animation';

    drawSpriteFrame(frame, zoom);
  } else {
    drawFullAtlas(selected, currentAtlas, zoom);
  }
}

/** Draws one atlas frame into the persistent Canvas2D canvas — synchronous, relying on `selectAsset()` having already primed `cachedAtlasImage` for this asset. Safe to call every autoplay tick/frame-nav/zoom-change. */
function drawSpriteFrame(frame: AtlasFrame, zoom: number): void {
  const url = `${ASSET_BASE}/${selected!.name}.png`;
  if (!cachedAtlasImage || cachedAtlasImageUrl !== url) {
    canvasWrap.innerHTML = '<div class="state-panel state-error"><span class="state-icon">⚠</span><span class="state-title">Failed to load image</span></div>';
    return;
  }

  mountSpriteCanvas(spriteCanvas2D);
  spriteCanvas2D.width = Math.max(1, frame.w * zoom);
  spriteCanvas2D.height = Math.max(1, frame.h * zoom);
  const ctx = spriteCanvas2D.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, spriteCanvas2D.width, spriteCanvas2D.height);
  ctx.drawImage(cachedAtlasImage, frame.x, frame.y, frame.w, frame.h, 0, 0, spriteCanvas2D.width, spriteCanvas2D.height);

  renderPalette(currentPalette);
  applyPostProcessing(spriteCanvas2D);
}

function drawFullAtlas(asset: ManifestEntry, atlas: AtlasMeta, zoom: number) {
  titleEl.textContent = `${asset.name} — full atlas`;
  metaEl.textContent = `${atlas.width}×${atlas.height}, ${atlas.frames.length} sprites`;
  setHidden(frameStrip, true);

  const url = `${ASSET_BASE}/${asset.name}.png`;
  if (!cachedAtlasImage || cachedAtlasImageUrl !== url) {
    canvasWrap.innerHTML = '<div class="state-panel state-error"><span class="state-icon">⚠</span><span class="state-title">Failed to load image</span></div>';
    return;
  }

  mountSpriteCanvas(spriteCanvas2D);
  const cw = Math.max(1, atlas.width * zoom);
  const ch = Math.max(1, atlas.height * zoom);
  spriteCanvas2D.width = cw;
  spriteCanvas2D.height = ch;
  const ctx = spriteCanvas2D.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(cachedAtlasImage, 0, 0, cw, ch);

  ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
  ctx.lineWidth = 1;
  for (const f of atlas.frames) {
    ctx.strokeRect(f.x * zoom, f.y * zoom, Math.max(1, f.w * zoom), Math.max(1, f.h * zoom));
  }

  renderPalette(currentPalette);
  applyPostProcessing(spriteCanvas2D);
}

function renderPalette(palette: PaletteData | null) {
  paletteBar.innerHTML = '';
  if (!palette) { setHidden(paletteBar, true); return; }
  setHidden(paletteBar, false);

  const label = document.createElement('span');
  label.textContent = `Palette (${palette.colors.length} colors):`;
  label.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-right: 6px; white-space: nowrap;';
  paletteBar.appendChild(label);

  for (let i = 0; i < Math.min(256, palette.colors.length); i++) {
    const c = palette.colors[i];
    if (!c) continue;
    const swatch = document.createElement('div');
    swatch.className = 'palette-color';
    swatch.title = `Index ${i}: rgb(${c.r}, ${c.g}, ${c.b})`;
    swatch.style.background = `rgb(${c.r}, ${c.g}, ${c.b})`;
    paletteBar.appendChild(swatch);
  }
}

searchEl.addEventListener('input', renderList);

zoomEl.addEventListener('change', () => {
  if (selected) drawAsset();
});

bgEl.addEventListener('change', () => {
  canvasWrap.classList.remove('bg-black', 'bg-white');
  if (bgEl.value === 'black') canvasWrap.classList.add('bg-black');
  if (bgEl.value === 'white') canvasWrap.classList.add('bg-white');
});

// ── Animation autoplay ───────────────────────────────────────────────────
//
// The atlas view never had this — added here as a Phase 3 prerequisite:
// recording "the sprite animation" is a non-sequitur without a
// live-preview notion of animation playback to record in the first
// place. Milliseconds between frames matches the interval already used
// in siren/flower/chimera/ceres's equivalent viewers. Meaningless for the
// map/dungeon/music views (no frame sequence to step through), so
// `togglePlayback()` only ever fires for the atlas view's `currentFrames`.

const AUTOPLAY_INTERVAL_MS = 150;
let playTimer: ReturnType<typeof setInterval> | null = null;

function stopPlayback(): void {
  if (playTimer !== null) {
    clearInterval(playTimer);
    playTimer = null;
  }
  playToggleEl.textContent = '▶';
  playToggleEl.classList.remove('playing');
}

function togglePlayback(): void {
  if (playTimer !== null) {
    stopPlayback();
    return;
  }
  if (currentFrames.length <= 1) return;
  playToggleEl.textContent = '⏸';
  playToggleEl.classList.add('playing');
  playTimer = setInterval(() => {
    currentFrame = (currentFrame + 1) % currentFrames.length;
    drawAsset();
  }, AUTOPLAY_INTERVAL_MS);
}

playToggleEl.addEventListener('click', togglePlayback);

frameSlider.addEventListener('input', () => {
  if (!selected) return;
  stopPlayback();
  currentFrame = Number(frameSlider.value);
  drawAsset();
});

/** Switches between the "Assets" (image/map/music/dungeon manifest browser) and
 *  "Data" (decoded JSON table browser) tabs — two entirely separate sidebar
 *  lists and main-panel views, never both visible together. */
function switchTab(tab: 'assets' | 'data'): void {
  const toAssets = tab === 'assets';
  tabAssetsBtn.classList.toggle('active', toAssets);
  tabAssetsBtn.setAttribute('aria-selected', String(toAssets));
  tabDataBtn.classList.toggle('active', !toAssets);
  tabDataBtn.setAttribute('aria-selected', String(!toAssets));

  setHidden(assetSidebarEl, !toAssets);
  setHidden(searchEl, !toAssets);
  setHidden(dataSidebarEl, toAssets);
  setHidden(dataSearchEl, toAssets);
  setHidden(assetViewEl, !toAssets);

  setDataTabActive(!toAssets);
  if (!toAssets) renderDataList();
}

tabAssetsBtn.addEventListener('click', () => switchTab('assets'));
tabDataBtn.addEventListener('click', () => switchTab('data'));

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (isDataTabActive()) return; // Data tab has its own table, not the asset list — these shortcuts don't apply.
  if (e.code === 'ArrowLeft' && currentFrames.length > 0) {
    e.preventDefault();
    stopPlayback();
    currentFrame = (currentFrame - 1 + currentFrames.length) % currentFrames.length;
    drawAsset();
  }
  if (e.code === 'ArrowRight' && currentFrames.length > 0) {
    e.preventDefault();
    stopPlayback();
    currentFrame = (currentFrame + 1) % currentFrames.length;
    drawAsset();
  }
  if (e.code === 'ArrowUp') {
    e.preventDefault();
    void navigateList(-1);
  }
  if (e.code === 'ArrowDown') {
    e.preventDefault();
    void navigateList(1);
  }
});

/** Watermark text for an export — covers all four views (atlas/map/dungeon/music). */
function spriteWatermarkText(asset: ManifestEntry): string {
  const gameLabel = GAME_DISPLAY_NAMES[currentGame];
  return `${asset.name} — ${gameLabel} (${currentPlatform}) — nicodemus — a seer project`;
}

/**
 * Screenshot export (Part 1 of `2d-export-proposal.md`), shared by all
 * four views. `canvas` is a **getter** resolving whichever single canvas
 * the currently-active view mounted into `canvasWrap` — the atlas view's
 * persistent `spriteCanvas2D` (or retro-display's own WebGL2 output), or
 * the map/dungeon/music view's own canvas. `renderNow` re-applies
 * post-processing for the atlas view (its buffer can go stale between the
 * last actual draw and a later Screenshot click) and re-renders whichever
 * secondary view is active for the same reason.
 */
const spriteCaptureSource: CaptureSource = {
  get canvas() {
    return canvasWrap.querySelector('canvas') as HTMLCanvasElement;
  },
  renderNow: () => {
    if (selected?.type === 'map' || selected?.type === 'music' || selected?.type === 'dungeon') {
      refreshActiveSecondaryView();
    } else {
      applyPostProcessing(spriteCanvas2D);
    }
  },
};

spriteScreenshotBtn.addEventListener('click', () => {
  if (!selected) return;
  void downloadScreenshot(spriteCaptureSource, selected.name, {
    watermark: { text: spriteWatermarkText(selected) },
  });
});

/**
 * Video export (Phase 3), built on Phase 2's persistent atlas canvas —
 * `canvas.captureStream()` needs a stable element across frame advances.
 * For the atlas view this does draw-then-advance (draw the current frame,
 * then advance for the next capture) rather than advance-then-draw, which
 * would skip frame 0 on the very first capture. The map/dungeon/music
 * views have no frame sequence to advance — recording just re-renders
 * whatever is currently on screen (a static map/dungeon pan, or the
 * piano roll mid-playback if the user started music playing first).
 */
const spriteRecordCaptureSource: CaptureSource = {
  get canvas() {
    return canvasWrap.querySelector('canvas') as HTMLCanvasElement;
  },
  renderNow: () => {
    if (selected?.type === 'map' || selected?.type === 'music' || selected?.type === 'dungeon') {
      refreshActiveSecondaryView();
      return;
    }
    drawAsset();
    if (currentFrames.length > 0) currentFrame = (currentFrame + 1) % currentFrames.length;
  },
};

const spriteRecordDriver: RecordClipDriver = {
  start() {
    stopPlayback();
    if (selected?.type === 'map' || selected?.type === 'music' || selected?.type === 'dungeon') return;
    currentFrame = 0;
    drawAsset();
  },
  stop() {
    if (selected?.type === 'map' || selected?.type === 'music' || selected?.type === 'dungeon') return;
    currentFrame = 0;
    drawAsset();
  },
};

spriteRecordBtn.addEventListener('click', () => {
  void (async () => {
    if (!selected || spriteRecordBtn.disabled) return;
    spriteRecordBtn.disabled = true;
    try {
      const result = await recordClip(spriteRecordCaptureSource, {
        driver: spriteRecordDriver,
        fps: 12,
        durationSeconds: 2,
        watermark: { text: spriteWatermarkText(selected) },
      });
      downloadClip(result, selected.name);
    } catch (err) {
      console.error('sprite recording failed', err);
    } finally {
      spriteRecordBtn.disabled = selected?.type !== 'map' && selected?.type !== 'music' && selected?.type !== 'dungeon' && currentFrames.length <= 1;
    }
  })();
});

/**
 * Display profile + colour grading + export (Phases 4-6 of
 * `2d-export-proposal.md`) — one floating panel (same `createPopover`
 * toggle/outside-click/Escape behavior as the other seer-project viewers)
 * housing the retro-display profile/effect sliders, the grading sliders,
 * and the screenshot/record buttons. Shared across all four views.
 */
createPopover(spriteDisplayToggle, spriteDisplayPanel);

/**
 * Grades via `ctx.filter` (not `style.filter` — the CSS property is
 * compositor-level only and would not appear in a screenshot/recording).
 * Baked into `spriteCanvas2D` for the atlas view (`drawSpriteFrame`/
 * `drawFullAtlas` -> `applyPostProcessing` -> `postProcess`); composited
 * in place onto whichever secondary-view canvas is active.
 */
function onGradingSliderChange(): void {
  gradingOptions = {
    brightness: Number(gradingBrightnessEl.value),
    contrast: Number(gradingContrastEl.value),
    saturate: Number(gradingSaturateEl.value),
    hueRotate: Number(gradingHueEl.value),
  };
  drawAsset();
  refreshActiveSecondaryView();
}

gradingBrightnessEl.addEventListener('input', onGradingSliderChange);
gradingContrastEl.addEventListener('input', onGradingSliderChange);
gradingSaturateEl.addEventListener('input', onGradingSliderChange);
gradingHueEl.addEventListener('input', onGradingSliderChange);

gradingResetBtn.addEventListener('click', () => {
  gradingBrightnessEl.value = '1';
  gradingContrastEl.value = '1';
  gradingSaturateEl.value = '1';
  gradingHueEl.value = '0';
  gradingOptions = {};
  drawAsset();
  refreshActiveSecondaryView();
});

/**
 * Effect sliders meaningful for the currently-selected profile are enabled;
 * the rest are disabled (not hidden — the layout stays stable as the user
 * flips between profiles). `'none'` disables all of them; `scanlineIntensity`
 * is additionally disabled for `'lcd-subpixel'`, which `RetroDisplayOptions`
 * documents as a no-op there (a flat panel has no scanlines to simulate).
 */
function updateDisplayControlsEnabled(): void {
  const active = displayOptions.profile !== 'none';
  for (const el of [displayMaskEl, displayCurvatureEl, displayVignetteEl, displayGlowEl, displayChromaticEl]) {
    el.disabled = !active;
  }
  displayScanlineEl.disabled = !active || displayOptions.profile === 'lcd-subpixel';
}

function onDisplaySliderChange(): void {
  displayOptions = {
    profile: displayProfileEl.value as DisplayProfile,
    scanlineIntensity: Number(displayScanlineEl.value),
    maskIntensity: Number(displayMaskEl.value),
    curvature: Number(displayCurvatureEl.value),
    vignette: Number(displayVignetteEl.value),
    glow: Number(displayGlowEl.value),
    chromaticAberration: Number(displayChromaticEl.value),
  };
  drawAsset();
  refreshActiveSecondaryView();
}

displayScanlineEl.addEventListener('input', onDisplaySliderChange);
displayMaskEl.addEventListener('input', onDisplaySliderChange);
displayCurvatureEl.addEventListener('input', onDisplaySliderChange);
displayVignetteEl.addEventListener('input', onDisplaySliderChange);
displayGlowEl.addEventListener('input', onDisplaySliderChange);
displayChromaticEl.addEventListener('input', onDisplaySliderChange);

displayProfileEl.addEventListener('change', () => {
  const profile = displayProfileEl.value as DisplayProfile;
  const preset = resolveRetroDisplayOptions({ profile });
  displayScanlineEl.value = String(preset.scanlineIntensity);
  displayMaskEl.value = String(preset.maskIntensity);
  displayCurvatureEl.value = String(preset.curvature);
  displayVignetteEl.value = String(preset.vignette);
  displayGlowEl.value = String(preset.glow);
  displayChromaticEl.value = String(preset.chromaticAberration);
  onDisplaySliderChange();
  updateDisplayControlsEnabled();
});

updateDisplayControlsEnabled();

gameSelectEl.addEventListener('change', () => {
  const game = gameSelectEl.value;
  if (!isGameId(game)) return;
  const platform = GAME_PLATFORMS[game][0].platform;
  populatePlatformSelectAndSwitch(game, platform);
});

platformSelectEl.addEventListener('change', () => {
  const platform = platformSelectEl.value;
  if (!isPlatformId(platform)) return;
  void switchGamePlatform(currentGame, platform);
});

function populatePlatformSelectAndSwitch(game: GameId, platform: PlatformId) {
  currentGame = game;
  populatePlatformSelect();
  void switchGamePlatform(game, platform);
}

(async () => {
  const initial = parseInitialSelection();
  currentGame = initial.game;
  currentPlatform = initial.platform;
  pendingAsset = initial.asset;
  populateGameSelect();
  populatePlatformSelect();
  await switchGamePlatform(currentGame, currentPlatform);
})();
