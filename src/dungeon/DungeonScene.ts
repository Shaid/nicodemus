/**
 * Phantasie III dungeon scene (docs/implementation.md §A1): grid-stepped
 * movement, wall collision, and star triggering over a top-down tile
 * render. Runs the real `executeStar`/`executeStarChain` interpreter
 * through the A0 `DungeonHost`, and drives the message/choice UI itself —
 * the star's message and choice are presented *before* the chain runs, so
 * the interpreter stays synchronous and unchanged (the presenter only
 * queues opcode-0x0B fullscreen messages raised mid-chain, shown after).
 *
 * Tile art (A7, corrected 2026-08-18): each cell is a real `Dng.csh` icon
 * (`DungeonRenderer.ts`'s `dngIconNameFor()`), matching the original
 * game's own per-cell tile stamp — see `graphics-formats.md` §4.6. A flat
 * colour fill (`colorFor()`) is used only if the icon atlas fails to load.
 *
 * Known first-pass simplifications, all marked: secret walls block (no
 * secret-door pass-through), locked doors block (no pick-lock), encounters
 * are a stub until A2, the player starts at the first non-wall cell (the
 * real entry point is the dungeon-exit destination table, not yet emitted),
 * and interactive choice is only offered on the star's first hop — a
 * `gotoStar` chain's later choices auto-resolve to 1.
 */

import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Scene, SceneContext } from '../app/Scene.ts';
import type { GameData } from '../data/GameDataLoader.ts';
import type { PartyState } from '../state/PartyState.ts';
import {
  starTableToMap,
  actionTableToMap,
  type DecodedAction,
  type DecodedStar,
} from '../assets/formats/star-action.ts';
import { p3TrapDamage, p3TrapMessageIndex } from '../assets/formats/dungeon-p3.ts';
import { DungeonHost, type DungeonHostEvent } from './DungeonHost.ts';
import { colorFor, cellClassAt, dngIconNameFor } from './DungeonRenderer.ts';
import { makeButton, makeCentered, makeText, UI_COLOR_ACCENT, UI_COLOR_MUTED, UI_COLOR_PANEL } from '../ui/menu.ts';
import { OverworldScene } from '../overworld/OverworldScene.ts';
import { CombatScene } from '../combat/CombatScene.ts';
import { loadGame, saveDungeonLocation } from '../state/save/SaveManager.ts';
import { DEFAULT_GAME, DEFAULT_PLATFORM } from '../game-id.ts';

interface AtlasFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasJson {
  frames: AtlasFrame[];
  width: number;
  height: number;
}

interface DungeonData {
  name: string;
  level: number;
  width: number;
  height: number;
  cells: number[];
  fixedEncounterTable: number[];
  stars: DecodedStar[];
  actions: DecodedAction[];
  messages: (string | null)[];
}

export interface DungeonReturn {
  x: number;
  y: number;
}

type Mode = 'walk' | 'modal';

export class DungeonScene implements Scene {
  name = 'dungeon';
  private ctx!: SceneContext;
  private readonly root = new Container();
  private readonly gridLayer = new Container();
  private readonly hud = new Container();
  private readonly modal = new Container();
  private readonly party: PartyState;
  private readonly data: GameData;
  private readonly base: string;
  private readonly dungeonName: string;
  private readonly returnTo: DungeonReturn;
  private viewWidth = 0;
  private viewHeight = 0;

  private level = 0;
  private width = 0;
  private height = 0;
  private cells: number[] = [];
  private fixedEncounterTable: number[] = [];
  private messages: (string | null)[] = [];
  private starsMap = new Map<number, DecodedStar>();
  private actionsMap = new Map<number, DecodedAction>();
  private host: DungeonHost | null = null;
  private grid = new Graphics();
  private readonly tileLayer = new Container();
  private tilePool: Sprite[] = [];
  private iconTextures = new Map<string, Texture>();
  private marker = new Graphics();
  private cellSize = 16;
  private originX = 0;
  private originY = 0;
  private x = 0;
  private y = 0;
  private mode: Mode = 'walk';
  private notice = '';
  private ready = false;
  private readonly resumeAt: DungeonReturn | undefined;

  constructor(party: PartyState, data: GameData, dungeonName: string, returnTo: DungeonReturn, resumeAt?: DungeonReturn) {
    this.party = party;
    this.data = data;
    this.dungeonName = dungeonName;
    this.returnTo = returnTo;
    this.resumeAt = resumeAt;
    this.base = `/assets/${DEFAULT_GAME}/${DEFAULT_PLATFORM}`;
  }

  mount(ctx: SceneContext): void {
    this.ctx = ctx;
    this.viewWidth = ctx.viewWidth;
    this.viewHeight = ctx.viewHeight;
    ctx.stage.addChild(this.root);
    this.root.addChild(this.gridLayer, this.hud, this.modal);
    this.showLoading();
    void this.load();
  }

  unmount(): void {}

  update(): void {
    if (!this.ready || this.mode !== 'walk') return;
    const keys = this.ctx.keys;
    let dx = 0;
    let dy = 0;
    if (keys.consumePress('ArrowUp') || keys.consumePress('KeyW')) dy = -1;
    else if (keys.consumePress('ArrowDown') || keys.consumePress('KeyS')) dy = 1;
    else if (keys.consumePress('ArrowLeft') || keys.consumePress('KeyA')) dx = -1;
    else if (keys.consumePress('ArrowRight') || keys.consumePress('KeyD')) dx = 1;
    if (dx !== 0 || dy !== 0) this.tryStep(dx, dy);
  }

  handleResize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    if (this.ready) {
      this.layout();
      this.redrawGrid();
      this.updateMarker();
      this.renderHud();
    } else {
      this.showLoading();
    }
  }

  private showLoading(): void {
    this.hud.removeChildren();
    this.hud.addChild(makeCentered('Loading dungeon…', this.viewWidth / 2, this.viewHeight / 2, { color: UI_COLOR_MUTED }));
  }

  private async load(): Promise<void> {
    try {
      const res = await fetch(`${this.base}/${this.dungeonName}.json`);
      if (!res.ok) throw new Error(`${res.status}`);
      const d = (await res.json()) as DungeonData;
      this.level = d.level;
      this.width = d.width;
      this.height = d.height;
      this.cells = d.cells;
      this.messages = d.messages;
      this.fixedEncounterTable = d.fixedEncounterTable;
      this.starsMap = starTableToMap(d.stars);
      this.actionsMap = actionTableToMap(d.actions);
      this.applySavedDeactivation();
      this.host = new DungeonHost({
        gameId: DEFAULT_GAME,
        party: this.party,
        stars: this.starsMap,
        actions: this.actionsMap,
        presenter: {
          // The star's own message is shown by runStarFlow *before* the
          // chain; only mid-chain opcode-0x0B messages get queued here.
          showMessage: (index, fullscreen) => {
            if (fullscreen) this.queuedMessages.push(this.messageText(index));
          },
          promptChoice: (min) => min,
        },
      });

      this.grid = new Graphics();
      this.gridLayer.addChild(this.grid, this.tileLayer);
      this.marker = new Graphics();
      this.gridLayer.addChild(this.marker);

      await this.loadIconAtlas();
      this.findStart();
      this.layout();
      this.redrawGrid();
      this.updateMarker();
      this.renderHud();
      this.ready = true;
    } catch (e) {
      this.hud.removeChildren();
      this.hud.addChild(makeCentered(`Failed to load dungeon: ${String(e)}`, this.viewWidth / 2, this.viewHeight / 2, { color: 0xff7a7a }));
    }
  }

  private applySavedDeactivation(): void {
    const save = loadGame();
    for (const i of save?.deactivatedStars[this.dungeonName] ?? []) {
      const star = this.starsMap.get(i);
      if (star) star.isActive = false;
    }
    for (const i of save?.deactivatedActions[this.dungeonName] ?? []) {
      const action = this.actionsMap.get(i);
      if (action) action.isActive = false;
    }
  }

  private save(): void {
    const stars = [...this.starsMap.values()].filter((s) => !s.isActive).map((s) => s.slotIndex);
    const actions = [...this.actionsMap.values()].filter((a) => !a.isActive).map((a) => a.slotIndex);
    saveDungeonLocation(this.party, this.dungeonName, this.returnTo, { x: this.x, y: this.y }, stars, actions);
  }

  private findStart(): void {
    if (this.resumeAt) {
      this.x = this.resumeAt.x;
      this.y = this.resumeAt.y;
      return;
    }
    // TODO(dungeon-entry): real entry is the dungeon-exit destination table
    // (dungeon-format.md §3), not yet emitted to JSON; start at the first
    // non-wall cell.
    for (let yy = 0; yy < this.height; yy++) {
      for (let xx = 0; xx < this.width; xx++) {
        const cls = cellClassAt(this.cells, this.width, xx, yy, this.level);
        if (cls.kind !== 'wall' && cls.kind !== 'secretWall') {
          this.x = xx;
          this.y = yy;
          return;
        }
      }
    }
  }

  /**
   * `dng.png` is not a backdrop — it's the real 320x200 canvas `Dng.csh`'s
   * 9 dungeon-view icons are packed into (graphics-formats.md §4.6). Slice
   * the named frames `dng.json` now carries (built by
   * `extractDngIconFrames()`, `tools/phantasieiii/build-assets.ts`) into
   * per-role `Texture`s for `redrawGrid()`. Failure just falls back to the
   * flat-colour render (`colorFor()`).
   */
  private async loadIconAtlas(): Promise<void> {
    try {
      const [texture, atlas] = await Promise.all([
        Assets.load<Texture>(`${this.base}/dng.png`),
        fetch(`${this.base}/dng.json`).then((r) => r.json() as Promise<AtlasJson>),
      ]);
      texture.source.scaleMode = 'nearest';
      for (const f of atlas.frames) {
        if (!f.name || f.name.startsWith('icon0x')) continue; // still-unassigned slots (§4.6)
        this.iconTextures.set(
          f.name,
          new Texture({ source: texture.source, frame: new Rectangle(f.x, f.y, f.w, f.h) }),
        );
      }
    } catch {
      // No atlas — colorFor()'s flat fill is still a faithful fallback.
    }
  }

  private layout(): void {
    const cellW = Math.floor(this.viewWidth / (this.width + 3));
    const cellH = Math.floor((this.viewHeight - 40) / (this.height + 2));
    this.cellSize = Math.max(8, Math.min(28, Math.min(cellW, cellH)));
    this.originX = Math.floor((this.viewWidth - this.width * this.cellSize) / 2);
    this.originY = 12;
    this.gridLayer.position.set(this.originX, this.originY);
  }

  private redrawGrid(): void {
    this.grid.clear();
    if (this.iconTextures.size === 0) {
      // Fallback: no atlas loaded, flat-colour fill per cell.
      for (let yy = 0; yy < this.height; yy++) {
        for (let xx = 0; xx < this.width; xx++) {
          const cls = cellClassAt(this.cells, this.width, xx, yy, this.level);
          this.grid.rect(xx * this.cellSize, yy * this.cellSize, this.cellSize, this.cellSize).fill(colorFor(cls));
        }
      }
      this.tileLayer.removeChildren();
      this.tilePool = [];
      return;
    }

    // Real tile art: one pooled Sprite per cell, `Dng.csh`'s own icon
    // (`dngIconNameFor`) scaled up to fill the cell, nearest-neighbour.
    let i = 0;
    for (let yy = 0; yy < this.height; yy++) {
      for (let xx = 0; xx < this.width; xx++) {
        const cls = cellClassAt(this.cells, this.width, xx, yy, this.level);
        const tex = this.iconTextures.get(dngIconNameFor(cls));
        if (!tex) continue;
        let sprite = this.tilePool[i];
        if (!sprite) {
          sprite = new Sprite();
          this.tilePool[i] = sprite;
          this.tileLayer.addChild(sprite);
        }
        sprite.texture = tex;
        sprite.position.set(xx * this.cellSize, yy * this.cellSize);
        sprite.width = this.cellSize;
        sprite.height = this.cellSize;
        sprite.visible = true;
        i++;
      }
    }
    for (; i < this.tilePool.length; i++) this.tilePool[i].visible = false;
  }

  private updateMarker(): void {
    this.marker.clear();
    this.marker
      .rect(this.x * this.cellSize + 2, this.y * this.cellSize + 2, this.cellSize - 4, this.cellSize - 4)
      .fill({ color: 0xffffff, alpha: 0.85 });
  }

  private tryStep(dx: number, dy: number): void {
    const nx = this.x + dx;
    const ny = this.y + dy;
    if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) return;
    const cls = cellClassAt(this.cells, this.width, nx, ny, this.level);
    switch (cls.kind) {
      case 'wall':
      case 'secretWall': // TODO(secret-walls): passable once discovered
        return;
      case 'door':
        if (cls.state === 'locked') return; // TODO(pick-lock)
        break;
      default:
        break;
    }
    this.x = nx;
    this.y = ny;
    this.notice = '';
    this.updateMarker();
    this.dispatch(cls);
    this.renderHud();
    this.save();
  }

  private dispatch(cls: ReturnType<typeof cellClassAt>): void {
    const code = this.cells[this.y * this.width + this.x];
    switch (cls.kind) {
      case 'trap':
        this.onTrap(code);
        break;
      case 'randomEncounter':
        // Rolls among monsters[monsterIndex0..+2] (§4); pick one of the three.
        this.launchCombat(Math.min(79, cls.monsterIndex0 + Math.floor(Math.random() * 3)));
        break;
      case 'fixedEncounter':
        this.launchCombat(this.fixedEncounterTable[cls.fixedEncounterIndex] ?? 0);
        break;
      case 'door':
        if (cls.state === 'encounter') this.launchCombat(Math.min(79, cls.monsterIndex0 ?? 0));
        break;
      case 'star':
        void this.onStar(cls.starIndex);
        break;
      case 'stairsExit':
        this.exitDungeon();
        break;
      case 'triggeredTrap':
      case 'specialMessage':
      case 'bottomMessage':
      case 'unassigned':
      case 'stairsInter':
        break;
      default:
        break;
    }
  }

  private launchCombat(monsterIndex: number): void {
    this.ctx.replace(
      new CombatScene(this.party, this.data, monsterIndex, {
        kind: 'dungeon',
        dungeonName: this.dungeonName,
        returnTo: this.returnTo,
        resumeAt: { x: this.x, y: this.y },
      }),
    );
  }

  private onTrap(code: number): void {
    const damage = p3TrapDamage(code);
    for (const m of this.party.members) {
      if (m && m.alive) m.hp = Math.max(0, m.hp - damage);
    }
    this.cells[this.y * this.width + this.x] = 0x07; // triggered-trap sentinel
    this.notice = `Trap! ${this.messageText(p3TrapMessageIndex(code))} (-${damage} HP)`;
    this.redrawGrid();
  }

  private exitDungeon(): void {
    this.ctx.replace(new OverworldScene(this.party, this.data, this.returnTo));
  }

  // -- star / message / choice flow ---------------------------------------

  private queuedMessages: string[] = [];

  private async onStar(starIndex: number): Promise<void> {
    const star = this.starsMap.get(starIndex);
    if (!star || !star.isActive || !this.host) return;
    this.mode = 'modal';
    await this.showMessage(this.messageText(star.messageIndex));
    let choice = 1;
    if (star.nbChoices > 1) choice = await this.promptChoice(star.nbChoices);
    this.host.triggerStar(starIndex, choice);
    for (const ev of this.host.events) this.handleEvent(ev);
    this.host.events.length = 0;
    for (const text of this.queuedMessages) await this.showMessage(text);
    this.queuedMessages = [];
    this.mode = 'walk';
    this.redrawGrid();
    this.renderHud();
    this.save();
  }

  private handleEvent(ev: DungeonHostEvent): void {
    switch (ev.type) {
      case 'encounter':
        this.notice = 'Combat is the next build step.';
        break;
      case 'teleport':
        this.x = ev.x;
        this.y = ev.y;
        this.updateMarker();
        break;
      case 'setCell':
        this.cells[ev.y * this.width + ev.x] = ev.cell;
        this.redrawGrid();
        break;
      case 'win':
        this.notice = '!! GAME WON !!';
        break;
    }
  }

  private showMessage(text: string): Promise<void> {
    return new Promise((resolve) => {
      this.modal.removeChildren();
      const panel = this.makePanel();
      this.modal.addChild(panel);
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        this.modal.addChild(makeText(line, this.modalX() + 20, this.modalY() + 16 + i * 22, { size: 15 }));
      });
      const cont = makeButton({ label: 'Continue', onClick: () => this.closeModal(resolve), width: 130, height: 32, accent: true });
      cont.position.set(this.modalX() + 20, this.modalY() + 16 + lines.length * 22 + 10);
      this.modal.addChild(cont);
    });
  }

  private promptChoice(count: number): Promise<number> {
    return new Promise((resolve) => {
      this.modal.removeChildren();
      const panel = this.makePanel();
      this.modal.addChild(panel);
      this.modal.addChild(makeText('Choose:', this.modalX() + 20, this.modalY() + 16, { size: 15, bold: true }));
      for (let i = 0; i < count; i++) {
        const btn = makeButton({
          label: `${i + 1}`,
          onClick: () => this.closeModal(resolve, i + 1),
          width: 44,
          height: 30,
        });
        btn.position.set(this.modalX() + 20 + (i % 5) * 54, this.modalY() + 48 + Math.floor(i / 5) * 40);
        this.modal.addChild(btn);
      }
    });
  }

  private closeModal<T>(resolve: (v: T) => void, value?: T): void {
    this.modal.removeChildren();
    resolve(value as T);
  }

  private makePanel(): Graphics {
    const w = Math.min(560, this.viewWidth - 40);
    const h = 200;
    const px = this.modalX();
    const py = this.modalY();
    return new Graphics().roundRect(px, py, w, h, 8).fill({ color: UI_COLOR_PANEL, alpha: 0.96 });
  }

  private modalX(): number {
    return Math.floor((this.viewWidth - Math.min(560, this.viewWidth - 40)) / 2);
  }

  private modalY(): number {
    return Math.floor(this.viewHeight / 2 - 80);
  }

  private messageText(index: number): string {
    const m = this.messages[index];
    return m === undefined || m === null ? '(no message)' : m;
  }

  private renderHud(): void {
    this.hud.removeChildren();
    const cls = cellClassAt(this.cells, this.width, this.x, this.y, this.level);
    this.hud.addChild(makeText(`(${this.x}, ${this.y}) — ${cls.kind}`, 12, this.viewHeight - 54, { size: 12, color: UI_COLOR_MUTED }));
    if (this.notice) this.hud.addChild(makeText(this.notice, 12, this.viewHeight - 34, { size: 12, color: UI_COLOR_ACCENT }));
    this.hud.addChild(makeText('Arrows / WASD to move', 12, this.viewHeight - 74, { size: 11, color: UI_COLOR_MUTED }));
  }
}
