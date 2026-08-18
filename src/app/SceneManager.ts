/**
 * SceneManager — swaps one active `Scene` at a time, owning the shared
 * stage/input/view-dimensions the scenes are built against. The app wires
 * only the ticker and resize listener; scene lifecycle lives here.
 */

import type { Container } from 'pixi.js';
import type { KeyState, PointerState } from '@seer-project/engine-2d';
import type { Scene } from './Scene.ts';

export interface SceneManagerOptions {
  stage: Container;
  pointer: PointerState;
  keys: KeyState;
  viewWidth: number;
  viewHeight: number;
}

export class SceneManager {
  private current: Scene | null = null;
  private readonly stage: Container;
  private readonly pointer: PointerState;
  private readonly keys: KeyState;
  private viewWidth: number;
  private viewHeight: number;

  constructor(opts: SceneManagerOptions) {
    this.stage = opts.stage;
    this.pointer = opts.pointer;
    this.keys = opts.keys;
    this.viewWidth = opts.viewWidth;
    this.viewHeight = opts.viewHeight;
  }

  replace(next: Scene): void {
    this.current?.unmount();
    const removed = this.stage.removeChildren();
    for (const child of removed) child.destroy({ children: true });

    this.current = next;
    next.mount({
      stage: this.stage,
      pointer: this.pointer,
      keys: this.keys,
      viewWidth: this.viewWidth,
      viewHeight: this.viewHeight,
      replace: (s) => this.replace(s),
    });
  }

  update(dtMs: number): void {
    this.current?.update(dtMs);
  }

  handleResize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.current?.handleResize(width, height);
  }
}
