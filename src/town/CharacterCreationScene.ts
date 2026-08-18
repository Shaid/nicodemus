/**
 * Character creation — assemble a party (race + class + rolled attributes)
 * and hand it to the town. Data-backed from the real race/skill tables;
 * the attribute-roll and starting-HP/MP formulas are the confirmed
 * disassembly-traced math (town-format.md §4.2/§4.3), not placeholders.
 */

import { Container } from 'pixi.js';
import type { Scene, SceneContext } from '../app/Scene.ts';
import { classNames, type GameData } from '../data/GameDataLoader.ts';
import {
  makeButton,
  makeCentered,
  makeText,
  UI_COLOR_ACCENT,
  UI_COLOR_MUTED,
} from '../ui/menu.ts';
import { createCharacter, type CharacterState } from '../state/CharacterState.ts';
import { createParty } from '../state/PartyState.ts';
import { TownScene } from './TownScene.ts';
import { STARTING_TOWN } from '../overworld/OverworldScene.ts';
import { rollAttributes, startingHp, startingMp } from './character-creation-formulas.ts';

const ATTRIBUTE_NAMES = ['Strength', 'Intelligence', 'Dexterity', 'Constitution', 'Charisma', 'Luck'];

export class CharacterCreationScene implements Scene {
  name = 'character-creation';
  private ctx!: SceneContext;
  private readonly root = new Container();
  private readonly races: { index: number; name: string }[];
  private readonly classes: string[];
  private selectedRace = -1;
  private selectedClass = -1;
  private attributes: number[] = [];
  private roster: CharacterState[] = [];
  private readonly data: GameData;
  private viewWidth = 0;
  private viewHeight = 0;

  constructor(data: GameData) {
    this.data = data;
    // Race index 5 is "Random" — a character-creation menu option, not a
    // playable race (data-tables.md §4.1); excluded from the picker.
    this.races = data.races
      .filter((r) => r.name !== 'Random')
      .map((r) => ({ index: r.index, name: r.name }));
    this.classes = classNames(data);
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
    const oy = Math.max(0, Math.floor((this.viewHeight - 600) / 2));

    this.root.addChild(makeCentered('PHANTASIE III — Create Your Party', cx, 18 + oy, { size: 24, bold: true, color: UI_COLOR_ACCENT }));

    const leftX = cx - 480;
    const midX = cx - 150;
    const rightX = cx + 180;
    const y0 = 64 + oy;

    // Races
    this.root.addChild(makeText('Race', leftX, y0, { size: 15, bold: true, color: UI_COLOR_MUTED }));
    let ry = y0 + 26;
    for (const race of this.races) {
      const btn = makeButton({
        label: race.name,
        onClick: () => {
          this.selectedRace = race.index;
          this.attributes = [];
          this.render();
        },
        width: 150,
        height: 26,
        accent: this.selectedRace === race.index,
      });
      btn.position.set(leftX, ry);
      this.root.addChild(btn);
      ry += 30;
    }

    // Classes
    this.root.addChild(makeText('Class', midX, y0, { size: 15, bold: true, color: UI_COLOR_MUTED }));
    let cy = y0 + 26;
    this.classes.forEach((cls, i) => {
      const btn = makeButton({
        label: cls,
        onClick: () => {
          this.selectedClass = i;
          this.attributes = [];
          this.render();
        },
        width: 150,
        height: 30,
        accent: this.selectedClass === i,
      });
      btn.position.set(midX, cy);
      this.root.addChild(btn);
      cy += 36;
    });

    // Attributes
    const attrY = cy + 14;
    this.root.addChild(makeText('Attributes', midX, attrY, { size: 15, bold: true, color: UI_COLOR_MUTED }));
    const canRoll = this.selectedRace >= 0 && this.selectedClass >= 0;
    const roll = makeButton({
      label: 'Roll',
      onClick: () => {
        this.rerollAttributes();
        this.render();
      },
      width: 80,
      height: 28,
      accent: true,
      disabled: !canRoll,
    });
    roll.position.set(midX + 150, attrY - 6);
    this.root.addChild(roll);

    let ay = attrY + 26;
    if (this.attributes.length === ATTRIBUTE_NAMES.length) {
      ATTRIBUTE_NAMES.forEach((name, i) => {
        this.root.addChild(makeText(name, midX, ay, { size: 13, color: UI_COLOR_MUTED }));
        this.root.addChild(makeText(String(this.attributes[i]), midX + 150, ay, { size: 13 }));
        ay += 20;
      });
    } else {
      this.root.addChild(
        makeText(canRoll ? '(roll to generate)' : '(pick a race and class first)', midX, ay, { size: 13, color: UI_COLOR_MUTED }),
      );
    }

    // Roster + actions
    this.root.addChild(makeText(`Party (${this.roster.length}/6)`, rightX, y0, { size: 15, bold: true, color: UI_COLOR_MUTED }));
    let py = y0 + 28;
    for (const member of this.roster) {
      const raceName = this.races.find((r) => r.index === member.race)?.name ?? '?';
      this.root.addChild(makeText(`${member.name} — ${this.classes[member.classId]} ${raceName}`, rightX, py, { size: 13 }));
      py += 20;
    }

    const canAdd =
      this.selectedRace >= 0 && this.selectedClass >= 0 && this.attributes.length === ATTRIBUTE_NAMES.length && this.roster.length < 6;
    const add = makeButton({
      label: 'Add Member',
      onClick: () => {
        this.addMember();
        this.render();
      },
      width: 180,
      height: 34,
      disabled: !canAdd,
    });
    add.position.set(rightX, py + 8);
    this.root.addChild(add);

    const begin = makeButton({
      label: 'Begin Adventure',
      onClick: () => this.begin(),
      width: 180,
      height: 34,
      accent: true,
      disabled: this.roster.length === 0,
    });
    begin.position.set(rightX, py + 48);
    this.root.addChild(begin);
  }

  private rerollAttributes(): void {
    if (this.selectedRace < 0 || this.selectedClass < 0) return;
    this.attributes = rollAttributes(this.selectedClass, this.selectedRace);
  }

  private addMember(): void {
    if (this.roster.length >= 6) return;
    const raceName = this.races.find((r) => r.index === this.selectedRace)?.name ?? 'Human';
    const hp = startingHp(this.selectedClass);
    const mp = startingMp(this.selectedClass);
    this.roster.push(
      createCharacter({
        name: `${raceName} ${this.classes[this.selectedClass]} ${this.roster.length + 1}`,
        race: this.selectedRace,
        classId: this.selectedClass,
        hp,
        maxHp: hp,
        mp,
        maxMp: mp,
        attributes: [...this.attributes],
      }),
    );
    this.selectedRace = -1;
    this.selectedClass = -1;
    this.attributes = [];
  }

  private begin(): void {
    const party = createParty(this.roster);
    // TODO(starting-gold): the real new-party purse is not confirmed.
    party.gold = 200;
    this.ctx.replace(new TownScene(party, this.data, STARTING_TOWN));
  }
}
