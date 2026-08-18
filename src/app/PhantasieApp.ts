/**
 * PhantasieApp — the thin, game-specific orchestrator from docs/
 * implementation.md §0. Owns one PixiJS `Application` + stage directly
 * (deliberately NOT `@seer-project/engine-2d`'s `Game`, which hardwires one
 * `TopDownCamera` to one free-pan `InputManager` for the app's lifetime),
 * plus the shared `PointerState`/`KeyState` primitives, and delegates to a
 * `SceneManager`.
 */

import { Application, type Container } from 'pixi.js';
import { KeyState, PointerState } from '@seer-project/engine-2d';
import { SceneManager } from './SceneManager.ts';
import type { Scene } from './Scene.ts';

export class PhantasieApp {
  readonly stage!: Container;
  private app!: Application;
  private scenes!: SceneManager;

  private constructor() {}

  static async create(container: HTMLElement, firstScene: Scene): Promise<PhantasieApp> {
    const app = new PhantasieApp();
    await app.init(container, firstScene);
    return app;
  }

  private async init(container: HTMLElement, firstScene: Scene): Promise<void> {
    this.app = new Application();
    await this.app.init({
      resizeTo: container,
      backgroundColor: 0x000000,
      antialias: false,
    });
    container.appendChild(this.app.canvas);
    (this as { stage: Container }).stage = this.app.stage;

    this.scenes = new SceneManager({
      stage: this.stage,
      pointer: new PointerState(this.app.canvas),
      keys: new KeyState(window),
      viewWidth: this.app.screen.width,
      viewHeight: this.app.screen.height,
    });

    window.addEventListener('resize', () => {
      this.scenes.handleResize(this.app.screen.width, this.app.screen.height);
    });

    this.app.ticker.add((ticker) => this.scenes.update(ticker.deltaMS));

    this.scenes.replace(firstScene);
  }
}
