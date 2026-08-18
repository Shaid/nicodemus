/**
 * Title screen — Continue (if a save exists) or New Game. Boots into the
 * runtime via `resumeScene`/`CharacterCreationScene` (docs/implementation.md
 * §A5/A6).
 */

import { Container } from 'pixi.js';
import type { Scene, SceneContext } from './Scene.ts';
import type { GameData } from '../data/GameDataLoader.ts';
import { loadGame, clearGame } from '../state/save/SaveManager.ts';
import { resumeScene } from './resume.ts';
import { CharacterCreationScene } from '../town/CharacterCreationScene.ts';
import { makeCentered, makeMenu, UI_COLOR_ACCENT, UI_COLOR_MUTED } from '../ui/menu.ts';

export class TitleScene implements Scene {
  name = 'title';
  private ctx!: SceneContext;
  private readonly root = new Container();
  private readonly data: GameData;
  private viewWidth = 0;
  private viewHeight = 0;

  constructor(data: GameData) {
    this.data = data;
  }

  mount(ctx: SceneContext): void {
    this.ctx = ctx;
    this.viewWidth = ctx.viewWidth;
    this.viewHeight = ctx.viewHeight;
    ctx.stage.addChild(this.root);
    this.render();
  }

  unmount(): void {}

  update(): void {}

  handleResize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.render();
  }

  private render(): void {
    this.root.removeChildren();
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;
    this.root.addChild(makeCentered('PHANTASIE III', cx, cy - 140, { size: 40, bold: true, color: UI_COLOR_ACCENT }));
    this.root.addChild(makeCentered('A reverse-engineered browser re-implementation', cx, cy - 100, { size: 13, color: UI_COLOR_MUTED }));

    const items: { label: string; onClick: () => void }[] = [];
    if (loadGame()) items.push({ label: 'Continue', onClick: () => this.continueGame() });
    items.push({ label: 'New Game', onClick: () => this.newGame() });
    const menu = makeMenu(items, cx - 110, cy - 40);
    this.root.addChild(menu);
  }

  private continueGame(): void {
    const save = loadGame();
    if (!save) return;
    this.ctx.replace(resumeScene(save, this.data));
  }

  private newGame(): void {
    clearGame();
    this.ctx.replace(new CharacterCreationScene(this.data));
  }
}
