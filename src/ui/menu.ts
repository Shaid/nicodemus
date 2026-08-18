/**
 * Minimal PixiJS menu primitives for the modal town/creation/combat scenes
 * (docs/implementation.md §0). Buttons use PixiJS's own pointer events —
 * `PointerState`/`KeyState` on the scene context are reserved for the
 * traversal scenes' grid/step movement, not menu hit-testing.
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js';

export const UI_FONT = 'Arial, Helvetica, sans-serif';
export const UI_COLOR_TEXT = 0xe7eef0;
export const UI_COLOR_MUTED = 0x8a9aa0;
export const UI_COLOR_ACCENT = 0x4fd6ca;
export const UI_COLOR_PANEL = 0x1e2a2e;
export const UI_COLOR_BUTTON = 0x24333a;
export const UI_COLOR_BUTTON_HOVER = 0x2f454e;

export interface TextOptions {
  size?: number;
  color?: number;
  bold?: boolean;
}

function textStyle(opts: TextOptions): TextStyle {
  return new TextStyle({
    fontFamily: UI_FONT,
    fontSize: opts.size ?? 16,
    fill: opts.color ?? UI_COLOR_TEXT,
    ...(opts.bold ? { fontWeight: 'bold' } : {}),
  });
}

/** Top-left-anchored label. */
export function makeText(text: string, x: number, y: number, opts: TextOptions = {}): Text {
  const t = new Text({ text, style: textStyle(opts) });
  t.position.set(x, y);
  return t;
}

/** Horizontally-centred label (anchor x = 0.5). */
export function makeCentered(text: string, cx: number, y: number, opts: TextOptions = {}): Text {
  const t = makeText(text, cx, y, opts);
  t.anchor.x = 0.5;
  return t;
}

export interface ButtonSpec {
  label: string;
  onClick: () => void;
  width?: number;
  height?: number;
  accent?: boolean;
  disabled?: boolean;
}

export function makeButton(spec: ButtonSpec): Container {
  const width = spec.width ?? 200;
  const height = spec.height ?? 36;
  const fill = spec.accent ? UI_COLOR_ACCENT : UI_COLOR_BUTTON;
  const hover = spec.accent ? 0x6be3da : UI_COLOR_BUTTON_HOVER;
  const bg = new Graphics().roundRect(0, 0, width, height, 5).fill(fill);
  const label = makeText(spec.label, width / 2, height / 2, {
    size: 14,
    color: spec.accent ? 0x0d1417 : UI_COLOR_TEXT,
  });
  label.anchor.set(0.5);

  const container = new Container();
  container.addChild(bg, label);

  if (spec.disabled) {
    container.alpha = 0.4;
    return container;
  }

  container.eventMode = 'static';
  container.cursor = 'pointer';
  container.on('pointerover', () => {
    bg.clear().roundRect(0, 0, width, height, 5).fill(hover);
  });
  container.on('pointerout', () => {
    bg.clear().roundRect(0, 0, width, height, 5).fill(fill);
  });
  container.on('pointertap', spec.onClick);
  return container;
}

/** Vertical stack of buttons; returns a positioned container. */
export function makeMenu(
  items: { label: string; onClick: () => void }[],
  x: number,
  y: number,
  width = 220,
  height = 38,
  gap = 10,
): Container {
  const container = new Container();
  container.position.set(x, y);
  let cy = 0;
  for (const item of items) {
    const button = makeButton({ label: item.label, onClick: item.onClick, width, height });
    button.position.set(0, cy);
    container.addChild(button);
    cy += height + gap;
  }
  return container;
}
