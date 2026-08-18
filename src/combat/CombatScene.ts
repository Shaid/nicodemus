/**
 * Combat scene — a modal, turn-based battle UI over the party (docs/
 * implementation.md §A2). Renders HP bars and a running combat log; "Fight"
 * runs one full round, "Flee"/victory/defeat return to the dungeon (or the
 * overworld on defeat).
 */

import { Container, Graphics } from 'pixi.js';
import type { Scene, SceneContext } from '../app/Scene.ts';
import type { GameData } from '../data/GameDataLoader.ts';
import type { PartyState } from '../state/PartyState.ts';
import type { CharacterState } from '../state/CharacterState.ts';
import { createP3Rng } from './formulas/combat-rng.ts';
import { createBattle, isVictory, isDefeat, runRound, type Battle } from './CombatEngine.ts';
import { makeButton, makeCentered, makeText, UI_COLOR_ACCENT, UI_COLOR_MUTED, UI_COLOR_TEXT } from '../ui/menu.ts';
import { DungeonScene } from '../dungeon/DungeonScene.ts';
import { OverworldScene } from '../overworld/OverworldScene.ts';

export interface CombatResume {
  dungeonName: string;
  returnTo: { x: number; y: number };
  resumeAt: { x: number; y: number };
}

export class CombatScene implements Scene {
  name = 'combat';
  private ctx!: SceneContext;
  private readonly root = new Container();
  private readonly party: PartyState;
  private readonly data: GameData;
  private readonly resume: CombatResume;
  private readonly rng = createP3Rng(Date.now() & 0x7fff);
  private battle: Battle;
  private over = false;
  private viewWidth = 0;
  private viewHeight = 0;

  constructor(party: PartyState, data: GameData, monsterIndex: number, resume: CombatResume) {
    this.party = party;
    this.data = data;
    this.resume = resume;
    const record = data.monsters[monsterIndex] ?? data.monsters[0];
    this.battle = createBattle(
      party.members.filter((m): m is CharacterState => m !== null),
      record,
      record.encounterGroupSize,
    );
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
    this.root.addChild(makeCentered('Combat', cx, 16, { size: 24, bold: true, color: UI_COLOR_ACCENT }));

    const top = 56;

    this.root.addChild(makeText('Monsters', cx - 260, top, { size: 14, bold: true, color: UI_COLOR_MUTED }));
    let my = top + 24;
    for (const slot of this.battle.monsters) {
      this.root.addChild(makeText(slot.record.name, cx - 260, my, { size: 13 }));
      this.hpBar(cx - 100, my + 3, 180, slot.hp, slot.record.hp);
      my += 30;
    }

    this.root.addChild(makeText('Party', cx + 60, top, { size: 14, bold: true, color: UI_COLOR_MUTED }));
    let py = top + 24;
    for (const member of this.battle.party) {
      this.root.addChild(makeText(`${member.name}${member.alive ? '' : ' (down)'}`, cx + 60, py, { size: 13 }));
      this.hpBar(cx + 220, py + 3, 160, member.hp, member.maxHp);
      py += 30;
    }

    // Combat log (last 6 entries)
    const logTop = this.viewHeight - 260;
    this.root.addChild(makeText('Log', cx - 260, logTop, { size: 14, bold: true, color: UI_COLOR_MUTED }));
    const recent = this.battle.log.slice(-6);
    recent.forEach((line, i) => {
      this.root.addChild(makeText(line, cx - 260, logTop + 22 + i * 18, { size: 12, color: UI_COLOR_TEXT }));
    });

    if (this.over) {
      const label = isVictory(this.battle) ? 'Victory!' : 'Defeat';
      this.root.addChild(makeCentered(label, cx, this.viewHeight / 2, { size: 28, bold: true, color: UI_COLOR_ACCENT }));
      const cont = makeButton({ label: 'Continue', onClick: () => this.finish(), width: 150, height: 36, accent: true });
      cont.position.set(cx - 75, this.viewHeight / 2 + 40);
      this.root.addChild(cont);
    } else {
      const fight = makeButton({ label: 'Fight', onClick: () => this.fight(), width: 140, height: 36, accent: true });
      fight.position.set(cx - 160, this.viewHeight - 90);
      this.root.addChild(fight);
      const flee = makeButton({ label: 'Flee', onClick: () => this.flee(), width: 140, height: 36 });
      flee.position.set(cx + 20, this.viewHeight - 90);
      this.root.addChild(flee);
    }
  }

  private fight(): void {
    runRound(this.battle, this.data, this.rng);
    if (isVictory(this.battle)) {
      this.party.gold += this.battle.monsters[0].record.gold; // TODO(combat-rewards): XP and per-monster loot
      this.over = true;
    } else if (isDefeat(this.battle)) {
      this.over = true;
    }
    this.render();
  }

  private flee(): void {
    this.ctx.replace(new DungeonScene(this.party, this.data, this.resume.dungeonName, this.resume.returnTo, this.resume.resumeAt));
  }

  private finish(): void {
    if (isDefeat(this.battle)) {
      this.ctx.replace(new OverworldScene(this.party, this.data, this.resume.returnTo));
    } else {
      this.ctx.replace(new DungeonScene(this.party, this.data, this.resume.dungeonName, this.resume.returnTo, this.resume.resumeAt));
    }
  }

  private hpBar(x: number, y: number, width: number, current: number, max: number): void {
    const frac = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    const g = new Graphics();
    g.roundRect(x, y, width, 12, 3).fill(0x222a2e);
    g.roundRect(x, y, Math.round(width * frac), 12, 3).fill(frac > 0.3 ? 0x3fae6a : 0xd9822b);
    this.root.addChild(g);
  }
}
