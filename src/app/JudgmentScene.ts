/**
 * Death-judgment screen — shown when a party is wiped out in combat.
 *
 * The real Phantasie III mechanic is a judgment scene: a dead party is
 * brought before a god (rendered via `D/W0`-`W2.cmp`) who obliterates,
 * reanimates as undead, or resurrects each character, with odds that shift
 * as the game progresses (owner-confirmed, `dungeon-format.md` §9.0.1's
 * 2026-08-18 correction block; tracked as `scripting-p3-death-judgment` in
 * `TODO.md`). The trigger condition, per-outcome odds, and which god
 * presides are NOT yet reverse-engineered, so this project's placeholder
 * policy forbids guessing them — this scene shows the real, confirmed `w2`
 * backdrop and a UI-only explanation, not a simulated judgment.
 *
 * "Continue" fully heals and revives the party (`reviveParty`) rather than
 * simulating any real outcome — a deliberately generous debug/testing
 * placeholder (owner's call) so a wipe doesn't require recreating
 * characters from scratch every test run. Its real job is still closing the
 * previous silent-softlock gap: a wiped party used to return straight to
 * the overworld with no game-over path or acknowledgement at all.
 */

import { Assets, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Scene, SceneContext } from './Scene.ts';
import type { GameData } from '../data/GameDataLoader.ts';
import { reviveParty, type PartyState } from '../state/PartyState.ts';
import { savePartyLocation } from '../state/save/SaveManager.ts';
import { OverworldScene, type OverworldStart } from '../overworld/OverworldScene.ts';
import { makeButton, makeCentered, UI_COLOR_ACCENT, UI_COLOR_MUTED } from '../ui/menu.ts';
import { DEFAULT_GAME, DEFAULT_PLATFORM } from '../game-id.ts';

export class JudgmentScene implements Scene {
  name = 'judgment';
  private ctx!: SceneContext;
  private readonly root = new Container();
  private readonly party: PartyState;
  private readonly data: GameData;
  private readonly returnTo: OverworldStart;
  private readonly base: string;
  private viewWidth = 0;
  private viewHeight = 0;

  constructor(party: PartyState, data: GameData, returnTo: OverworldStart) {
    this.party = party;
    this.data = data;
    this.returnTo = returnTo;
    this.base = `/assets/${DEFAULT_GAME}/${DEFAULT_PLATFORM}`;
  }

  mount(ctx: SceneContext): void {
    this.ctx = ctx;
    this.viewWidth = ctx.viewWidth;
    this.viewHeight = ctx.viewHeight;
    ctx.stage.addChild(this.root);
    this.render();
    void this.loadBackdrop();
  }

  unmount(): void {}

  update(): void {}

  handleResize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.render();
  }

  private async loadBackdrop(): Promise<void> {
    try {
      const texture = await Assets.load<Texture>(`${this.base}/w2.png`);
      const sprite = new Sprite(texture);
      const scale = Math.max(this.viewWidth / texture.width, this.viewHeight / texture.height);
      sprite.scale.set(scale);
      sprite.position.set((this.viewWidth - texture.width * scale) / 2, (this.viewHeight - texture.height * scale) / 2);
      this.ctx.stage.addChildAt(sprite, 0);
      const tint = new Graphics().rect(0, 0, this.viewWidth, this.viewHeight).fill({ color: 0x000000, alpha: 0.5 });
      this.ctx.stage.addChildAt(tint, 1);
    } catch {
      // No backdrop — the plain dark background is fine.
    }
  }

  private render(): void {
    this.root.removeChildren();
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;

    this.root.addChild(makeCentered('Your party has fallen', cx, cy - 60, { size: 28, bold: true, color: UI_COLOR_ACCENT }));
    this.root.addChild(
      makeCentered(
        'In the original game, a fallen party is brought before a god for judgment —',
        cx,
        cy - 16,
        { size: 13, color: UI_COLOR_MUTED },
      ),
    );
    this.root.addChild(
      makeCentered(
        'obliterated, reanimated as undead, or resurrected. That mechanic is not yet',
        cx,
        cy + 4,
        { size: 13, color: UI_COLOR_MUTED },
      ),
    );
    this.root.addChild(
      makeCentered(
        'reverse-engineered, so — for now — Continue just heals the party back up.',
        cx,
        cy + 24,
        { size: 13, color: UI_COLOR_MUTED },
      ),
    );

    const button = makeButton({ label: 'Continue', onClick: () => this.continueGame(), width: 200, height: 38, accent: true });
    button.position.set(cx - 100, cy + 70);
    this.root.addChild(button);
  }

  private continueGame(): void {
    reviveParty(this.party);
    savePartyLocation(this.party, { kind: 'overworld', x: this.returnTo.x, y: this.returnTo.y });
    this.ctx.replace(new OverworldScene(this.party, this.data, this.returnTo));
  }
}
