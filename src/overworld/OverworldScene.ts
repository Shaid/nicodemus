/**
 * Phantasie III overworld traversal (docs/implementation.md §A3).
 *
 * Renders the pre-baked `screens/world-map.png` (the whole 50 x 75 grid at
 * native 16px tiles, from `tools/phantasieiii/build-map.ts`) under a bounded
 * `TopDownCamera` that follows the party token, and steps the party across
 * the grid on arrow/WASD input. Named locations come from
 * `world-map-pois.json` (the 30 hardcoded `LocateSpecial()` coordinates);
 * stepping onto a town offers entry back into `TownScene`.
 *
 * Deliberate consolidations vs. the plan's file list: `OverworldInput.ts`
 * and `OverworldHost.ts` are folded in here — P3's input is a handful of
 * `KeyState` presses and its "host" is a plain `(x,y) -> POI` map lookup,
 * not worth three files. `render/tile-render.ts` is also skipped for now:
 * P3 ships a pre-rendered whole-world PNG, so the "blit" is one `Sprite`,
 * not a per-cell tile blit (that helper is deferred until A7's art swap
 * actually needs a shared viewport-culled blitter).
 */

import { Assets, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { DisplayMode, TopDownCamera, createDiamondMarker } from '@seer-project/engine-2d';
import type { Scene, SceneContext } from '../app/Scene.ts';
import type { GameData } from '../data/GameDataLoader.ts';
import type { PartyState } from '../state/PartyState.ts';
import { makeCentered, makeText, UI_COLOR_ACCENT, UI_COLOR_MUTED } from '../ui/menu.ts';
import { TownScene } from '../town/TownScene.ts';
import { DungeonScene } from '../dungeon/DungeonScene.ts';
import { CombatScene } from '../combat/CombatScene.ts';
import { rollOverworldEncounter } from './p3-encounter-formulas.ts';
import { savePartyLocation } from '../state/save/SaveManager.ts';
import { DEFAULT_GAME, DEFAULT_PLATFORM } from '../game-id.ts';

interface WorldMapData {
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  terrainClassNames: string[];
  terrainClassByValue: number[];
  imageWidth: number;
  imageHeight: number;
  cells: number[];
}

interface WorldPoi {
  x: number;
  y: number;
  type: 'town' | 'dungeon' | 'inn';
  index: number;
  label: string;
  file?: string;
}

export interface OverworldStart {
  x: number;
  y: number;
}

// TODO(overworld-start): Pendragon (town index 1) is assumed as the starting
// town — the game's canonical new-party origin is not separately confirmed.
// Pendragon is town-format.md §3.4's confirmed armoury 1 (cross-checked
// against default_88.png's "THIEF is in the armoury" screenshot).
export const STARTING_TOWN = { x: 24, y: 37, name: 'Pendragon', armouryIndex: 1 };
const DEFAULT_START: OverworldStart = { x: STARTING_TOWN.x, y: STARTING_TOWN.y };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return (await res.json()) as T;
}

export class OverworldScene implements Scene {
  name = 'overworld';
  private ctx!: SceneContext;
  private readonly root = new Container();
  private readonly world = new Container();
  private readonly hud = new Container();
  private readonly party: PartyState;
  private readonly data: GameData;
  private readonly base: string;
  private viewWidth = 0;
  private viewHeight = 0;

  private mapData: WorldMapData | null = null;
  private poiByCell = new Map<string, WorldPoi>();
  private camera: TopDownCamera | null = null;
  private marker: Graphics | null = null;
  private x: number;
  private y: number;
  private notice = '';
  private ready = false;

  constructor(party: PartyState, data: GameData, start: OverworldStart = DEFAULT_START) {
    this.party = party;
    this.data = data;
    this.x = start.x;
    this.y = start.y;
    this.base = `/assets/${DEFAULT_GAME}/${DEFAULT_PLATFORM}`;
  }

  mount(ctx: SceneContext): void {
    this.ctx = ctx;
    this.viewWidth = ctx.viewWidth;
    this.viewHeight = ctx.viewHeight;
    ctx.stage.addChild(this.root);
    this.root.addChild(this.world, this.hud);
    this.showLoading();
    void this.load();
  }

  unmount(): void {}

  update(): void {
    if (!this.ready) return;
    const keys = this.ctx.keys;
    let dx = 0;
    let dy = 0;
    if (keys.consumePress('ArrowUp') || keys.consumePress('KeyW')) dy = -1;
    else if (keys.consumePress('ArrowDown') || keys.consumePress('KeyS')) dy = 1;
    else if (keys.consumePress('ArrowLeft') || keys.consumePress('KeyA')) dx = -1;
    else if (keys.consumePress('ArrowRight') || keys.consumePress('KeyD')) dx = 1;
    if (dx !== 0 || dy !== 0) this.step(dx, dy);
    if (keys.consumePress('Enter')) this.enterLocation();
  }

  handleResize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    if (this.camera) {
      this.camera.setViewSize(width, height);
      this.follow();
    }
    if (this.ready) this.renderHud();
    else this.showLoading();
  }

  private showLoading(): void {
    this.hud.removeChildren();
    this.hud.addChild(makeCentered('Loading world map…', this.viewWidth / 2, this.viewHeight / 2, { color: UI_COLOR_MUTED }));
  }

  private async load(): Promise<void> {
    try {
      const [mapData, poisJson, texture] = await Promise.all([
        fetchJson<WorldMapData>(`${this.base}/world-map.json`),
        fetchJson<{ pois: WorldPoi[] }>(`${this.base}/world-map-pois.json`),
        Assets.load<Texture>(`${this.base}/screens/world-map.png`),
      ]);
      this.mapData = mapData;
      for (const poi of poisJson.pois) this.poiByCell.set(`${poi.x},${poi.y}`, poi);
      this.buildWorld(texture);
      this.ready = true;
      this.renderHud();
    } catch (e) {
      this.hud.removeChildren();
      this.hud.addChild(makeCentered(`Failed to load world map: ${String(e)}`, this.viewWidth / 2, this.viewHeight / 2, { color: 0xff7a7a }));
    }
  }

  private buildWorld(texture: Texture): void {
    const map = this.mapData!;
    const sprite = new Sprite(texture);
    sprite.texture.baseTexture.scaleMode = 'nearest';
    this.world.addChild(sprite);

    this.marker = createDiamondMarker(8, UI_COLOR_ACCENT, 1, 0x000000, 2);
    this.world.addChild(this.marker);

    this.camera = new TopDownCamera(map.imageWidth, map.imageHeight, this.viewWidth, this.viewHeight, new DisplayMode());
    this.camera.setZoom(2);
    this.updateMarker();
    this.follow();
  }

  private step(dx: number, dy: number): void {
    const map = this.mapData!;
    const nx = Math.max(0, Math.min(map.width - 1, this.x + dx));
    const ny = Math.max(0, Math.min(map.height - 1, this.y + dy));
    if (nx === this.x && ny === this.y) return;
    this.x = nx;
    this.y = ny;
    this.notice = '';
    this.updateMarker();
    this.follow();
    this.renderHud();
    savePartyLocation(this.party, { kind: 'overworld', x: this.x, y: this.y });

    // dungeon-format.md §9.0.6: no roll at all on a named location or on
    // impassable/hazard terrain (rollOverworldEncounter's own exclusion).
    if (!this.poiByCell.has(`${this.x},${this.y}`)) {
      const encounter = rollOverworldEncounter(this.x, this.y, this.terrainClassAt(this.x, this.y));
      if (encounter) {
        this.ctx.replace(
          new CombatScene(this.party, this.data, encounter.monsterIndex, { kind: 'overworld', x: this.x, y: this.y }),
        );
      }
    }
  }

  private enterLocation(): void {
    const poi = this.poiByCell.get(`${this.x},${this.y}`);
    if (!poi) return;
    if (poi.type === 'town') {
      // `poi.index` is `LocateSpecial()`'s marker index — for the 14 real
      // towns (index 1-14) this lines up exactly with the confirmed
      // `inititem.dat` armoury row of the same number (town-format.md
      // §3.4). Not derived for any other POI type, so this is safe even
      // though `WorldPoi.index` is defined for dungeon/inn markers too.
      this.ctx.replace(new TownScene(this.party, this.data, { x: poi.x, y: poi.y, name: poi.label, armouryIndex: poi.index }));
      return;
    }
    if (poi.type === 'dungeon') {
      this.ctx.replace(new DungeonScene(this.party, this.data, this.dungeonName(poi.file), { x: poi.x, y: poi.y }));
      return;
    }
    this.notice = `${poi.label} — inn (not implemented yet)`;
    this.renderHud();
  }

  private dungeonName(file?: string): string {
    const m = /DNG([A-Z])/i.exec(file ?? '');
    return m ? `dungeon-${m[1].toLowerCase()}` : 'dungeon-a';
  }

  private updateMarker(): void {
    const map = this.mapData!;
    this.marker?.position.set((this.x + 0.5) * map.cellWidth, (this.y + 0.5) * map.cellHeight);
  }

  private follow(): void {
    if (!this.camera) return;
    const map = this.mapData!;
    this.camera.moveTo((this.x + 0.5) * map.cellWidth, (this.y + 0.5) * map.cellHeight);
    this.world.scale.set(this.camera.zoom);
    this.world.position.set(-this.camera.left * this.camera.zoom, -this.camera.top * this.camera.zoom);
  }

  private renderHud(): void {
    this.hud.removeChildren();
    const terrain = this.terrainName(this.x, this.y);
    this.hud.addChild(makeText(`(${this.x}, ${this.y}) — ${terrain}`, 12, 12, { size: 13, color: UI_COLOR_MUTED }));
    const poi = this.poiByCell.get(`${this.x},${this.y}`);
    if (poi) this.hud.addChild(makeText(`${poi.label} — press Enter to enter`, 12, 34, { size: 13, color: UI_COLOR_ACCENT }));
    if (this.notice) this.hud.addChild(makeText(this.notice, 12, 56, { size: 13, color: UI_COLOR_ACCENT }));
    this.hud.addChild(makeText('Arrows / WASD to move', 12, this.viewHeight - 30, { size: 12, color: UI_COLOR_MUTED }));
  }

  private terrainClassAt(x: number, y: number): number {
    const map = this.mapData!;
    return map.terrainClassByValue[map.cells[y * map.width + x]];
  }

  private terrainName(x: number, y: number): string {
    const map = this.mapData!;
    const cls = this.terrainClassAt(x, y);
    return cls >= 0 ? map.terrainClassNames[cls] : 'unclassified';
  }
}
