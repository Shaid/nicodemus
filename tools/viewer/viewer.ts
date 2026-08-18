import { setHidden, type AtlasMeta, type PaletteData, type AtlasFrame } from './shared.ts';
import { WorldMapViewer } from './map-viewer.ts';
import { MusicPlayer } from './music-player.ts';
import { DungeonViewer } from './dungeon-viewer.ts';
import { setDataTabActive, isDataTabActive, renderDataList, setDataAssetBase } from './data-view.ts';
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
const paletteBar = document.getElementById('palette-bar')!;

let manifest: ManifestEntry[] = [];
let selected: ManifestEntry | null = null;
let currentAtlas: AtlasMeta | null = null;
let currentPalette: PaletteData | null = null;
let currentFrames: AtlasFrame[] = [];
let currentFrame = 0;
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
  renderList();
  drawAsset();
}

/** World-map entries bypass the atlas canvas entirely. */
async function showMap(asset: ManifestEntry) {
  titleEl.textContent = `${asset.name} — world map`;
  metaEl.textContent = '';
  frameInfoEl.textContent = 'drag to pan · scroll to zoom';
  setHidden(frameStrip, true);
  setHidden(paletteBar, true);
  mapViewer ??= new WorldMapViewer(canvasWrap);
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
  musicPlayer ??= new MusicPlayer(canvasWrap);
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
  dungeonViewer ??= new DungeonViewer(canvasWrap);
  await dungeonViewer.show(ASSET_BASE, asset.name, currentGame);
  metaEl.textContent = dungeonViewer.summary;
}

function drawAsset() {
  if (selected?.type === 'map' || selected?.type === 'music' || selected?.type === 'dungeon') return;
  if (!selected || !currentAtlas) {
    titleEl.textContent = 'No asset selected';
    metaEl.textContent = '';
    frameInfoEl.textContent = '';
    setHidden(frameStrip, true);
    setHidden(paletteBar, true);
    canvasWrap.innerHTML = '<div class="state-panel"><span class="state-icon">🖼</span><span class="state-title">Select an asset</span></div>';
    return;
  }

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

    const img = new Image();
    img.onload = () => {
      canvasWrap.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, frame.w * zoom);
      canvas.height = Math.max(1, frame.h * zoom);
      canvasWrap.appendChild(canvas);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, frame.x, frame.y, frame.w, frame.h, 0, 0, canvas.width, canvas.height);
    };
    img.onerror = () => {
      canvasWrap.innerHTML = '<div class="state-panel state-error"><span class="state-icon">⚠</span><span class="state-title">Failed to load image</span></div>';
    };
    img.src = `${ASSET_BASE}/${selected.name}.png`;

    renderPalette(currentPalette);
  } else {
    drawFullAtlas(selected, currentAtlas, zoom);
  }
}

function drawFullAtlas(asset: ManifestEntry, atlas: AtlasMeta, zoom: number) {
  titleEl.textContent = `${asset.name} — full atlas`;
  metaEl.textContent = `${atlas.width}×${atlas.height}, ${atlas.frames.length} sprites`;
  setHidden(frameStrip, true);

  const img = new Image();
  img.onload = () => {
    const cw = Math.max(1, atlas.width * zoom);
    const ch = Math.max(1, atlas.height * zoom);
    canvasWrap.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvasWrap.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, cw, ch);

    ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
    ctx.lineWidth = 1;
    for (const f of atlas.frames) {
      ctx.strokeRect(f.x * zoom, f.y * zoom, Math.max(1, f.w * zoom), Math.max(1, f.h * zoom));
    }

    renderPalette(currentPalette);
  };
  img.onerror = () => {
    canvasWrap.innerHTML = '<div class="state-panel state-error"><span class="state-icon">⚠</span><span class="state-title">Failed to load image</span></div>';
  };
  img.src = `${ASSET_BASE}/${asset.name}.png`;
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

frameSlider.addEventListener('input', () => {
  if (!selected) return;
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
    currentFrame = (currentFrame - 1 + currentFrames.length) % currentFrames.length;
    drawAsset();
  }
  if (e.code === 'ArrowRight' && currentFrames.length > 0) {
    e.preventDefault();
    currentFrame = (currentFrame + 1) % currentFrames.length;
    drawAsset();
  }
});

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
