/**
 * Town hub — a modal menu over the party. Phantasie III has no separate
 * town-data format (a town is just a `LocateSpecial()` marker with
 * `type: 'town'`), and its real in-town interaction structure is NOT yet
 * reverse-engineered (docs/implementation.md §A4's investigation
 * prerequisite). This is a placeholder hub whose Armoury browses the real
 * item catalogue; Inn/Temple/Tavern/Training and the per-town stock
 * selection (`inititem.dat`) are stubbed with TODOs.
 */

import { Container } from 'pixi.js';
import type { Scene, SceneContext } from '../app/Scene.ts';
import { classNames, type GameData } from '../data/GameDataLoader.ts';
import {
  makeButton,
  makeCentered,
  makeMenu,
  makeText,
  UI_COLOR_ACCENT,
  UI_COLOR_MUTED,
} from '../ui/menu.ts';
import { giveItem, removeGold, type PartyState } from '../state/PartyState.ts';
import { savePartyLocation } from '../state/save/SaveManager.ts';
import { OverworldScene } from '../overworld/OverworldScene.ts';

const ARMOURY_PAGE_SIZE = 14;

export interface TownLocation {
  x: number;
  y: number;
  name: string;
}

export class TownScene implements Scene {
  name = 'town';
  private ctx!: SceneContext;
  private readonly root = new Container();
  private readonly classes: string[];
  private view: 'hub' | 'armoury' = 'hub';
  private armouryPage = 0;
  private notice = '';
  private readonly party: PartyState;
  private readonly data: GameData;
  private readonly location: TownLocation | undefined;
  private viewWidth = 0;
  private viewHeight = 0;

  constructor(party: PartyState, data: GameData, location?: TownLocation) {
    this.party = party;
    this.data = data;
    this.location = location;
    this.classes = classNames(data);
  }

  mount(ctx: SceneContext): void {
    this.ctx = ctx;
    this.viewWidth = ctx.viewWidth;
    this.viewHeight = ctx.viewHeight;
    ctx.stage.addChild(this.root);
    if (this.location) {
      savePartyLocation(this.party, { kind: 'town', x: this.location.x, y: this.location.y, name: this.location.name });
    }
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
    if (this.view === 'hub') this.renderHub();
    else this.renderArmoury();
  }

  private renderHub(): void {
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;
    this.root.addChild(makeCentered(this.location?.name ?? 'Town', cx, 40, { size: 26, bold: true, color: UI_COLOR_ACCENT }));

    const roster = this.party.members
      .filter((m) => m !== null)
      .map((m) => `${m.name} (${this.classes[m.classId]} Lv${m.level}, HP ${m.hp}/${m.maxHp})`);
    this.root.addChild(makeCentered(`Gold: ${this.party.gold}${roster.length ? '  |  ' + roster.join('  |  ') : ''}`, cx, 84, { size: 13, color: UI_COLOR_MUTED }));

    const menu = makeMenu(
      [
        { label: 'Armoury', onClick: () => this.openArmoury() },
        { label: 'Inn', onClick: () => this.stub('The Inn is not implemented yet.') },
        { label: 'Temple', onClick: () => this.stub('The Temple is not implemented yet.') },
        { label: 'Tavern', onClick: () => this.stub('The Tavern is not implemented yet.') },
        { label: 'Training', onClick: () => this.stub('Training is not implemented yet.') },
        { label: 'Leave Town', onClick: () => this.leaveTown() },
      ],
      cx - 110,
      cy - 100,
    );
    this.root.addChild(menu);

    if (this.notice) this.root.addChild(makeCentered(this.notice, cx, cy + 140, { size: 13, color: UI_COLOR_ACCENT }));
  }

  private openArmoury(): void {
    this.view = 'armoury';
    this.armouryPage = 0;
    this.render();
  }

  private leaveTown(): void {
    // From a specific town, leave to its overworld cell; otherwise the
    // default starting town (see OverworldScene's DEFAULT_START).
    this.ctx.replace(new OverworldScene(this.party, this.data, this.location));
  }

  private stub(message: string): void {
    this.notice = message;
    this.render();
  }

  private renderArmoury(): void {
    const cx = this.viewWidth / 2;
    const startX = cx - 240;
    this.root.addChild(makeCentered(`Armoury — Gold: ${this.party.gold}`, cx, 20, { size: 22, bold: true, color: UI_COLOR_ACCENT }));

    // TODO(town-armoury-stock): the real shop sells a per-town subset from
    // `inititem.dat` (`stock[18 armouries][181 item ids]`, data-tables.md
    // §6.4) at a per-armoury markup. This lists the full catalogue at base
    // price until that stock table is wired into a runtime asset.
    const items = this.data.items.filter((i) => i.index !== 0);
    const pageStart = this.armouryPage * ARMOURY_PAGE_SIZE;
    const pageItems = items.slice(pageStart, pageStart + ARMOURY_PAGE_SIZE);

    let y = 56;
    for (const item of pageItems) {
      this.root.addChild(makeText(item.name, startX, y, { size: 13 }));
      this.root.addChild(makeText(`${item.basePrice} gp`, startX + 260, y, { size: 13, color: UI_COLOR_MUTED }));
      const buy = makeButton({
        label: 'Buy',
        onClick: () => this.buyItem(item.index),
        width: 60,
        height: 22,
        disabled: this.party.gold < item.basePrice,
      });
      buy.position.set(startX + 340, y - 3);
      this.root.addChild(buy);
      y += 26;
    }

    const navY = y + 14;
    const prev = makeButton({
      label: '< Prev',
      onClick: () => {
        this.armouryPage = Math.max(0, this.armouryPage - 1);
        this.render();
      },
      width: 90,
      height: 30,
      disabled: this.armouryPage === 0,
    });
    prev.position.set(startX, navY);
    this.root.addChild(prev);

    const next = makeButton({
      label: 'Next >',
      onClick: () => {
        this.armouryPage += 1;
        this.render();
      },
      width: 90,
      height: 30,
      disabled: pageStart + ARMOURY_PAGE_SIZE >= items.length,
    });
    next.position.set(startX + 110, navY);
    this.root.addChild(next);

    const back = makeButton({
      label: 'Back',
      onClick: () => {
        this.view = 'hub';
        this.armouryPage = 0;
        this.render();
      },
      width: 90,
      height: 30,
    });
    back.position.set(startX + 360, navY);
    this.root.addChild(back);
  }

  private buyItem(index: number): void {
    const item = this.data.items.find((i) => i.index === index);
    if (!item || this.party.gold < item.basePrice) return;
    removeGold(this.party, item.basePrice);
    giveItem(this.party, index);
    if (this.location) {
      savePartyLocation(this.party, { kind: 'town', x: this.location.x, y: this.location.y, name: this.location.name });
    }
    this.render();
  }
}
