/**
 * Common scene contract for the Phantasie runtime (docs/implementation.md
 * §0): the app owns one PixiJS `Application` + stage and delegates to a
 * `SceneManager` that swaps `Scene` implementations. Menu-style scenes
 * (creation, town, combat) are event-driven and ignore `update`; traversal
 * scenes (dungeon, overworld) consume it.
 */

import type { Container } from 'pixi.js';
import type { KeyState, PointerState } from '@seer-project/engine-2d';

export interface SceneContext {
  stage: Container;
  pointer: PointerState;
  keys: KeyState;
  /** Snapshot at mount time; use `handleResize` to track later changes. */
  viewWidth: number;
  viewHeight: number;
  /** Replace the current scene (the old scene is unmounted and its stage children destroyed). */
  replace(next: Scene): void;
}

export interface Scene {
  readonly name: string;
  mount(ctx: SceneContext): void;
  unmount(): void;
  update(dtMs: number): void;
  handleResize(width: number, height: number): void;
}
