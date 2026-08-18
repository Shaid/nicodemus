/**
 * Town hub — a modal menu over the party. Real Phantasie III town
 * facilities and mechanics (`docs/phantasie/town-format.md`, disassembly-
 * confirmed): **Armoury**, **Bank**, **Inn**, **Mystic**, **Training**,
 * **Learn Spells** — not the earlier placeholder's invented
 * "Temple/Tavern" (neither exists anywhere in the game).
 *
 * Wired to real mechanics: Armoury (real per-town stock + markup pricing,
 * `town-format.md` §3.4/§6.4), Inn (full HP heal + class/level MP-growth
 * roll for the whole party, §3.1), Training (level-up paid for in gold —
 * Level+1, HP re-roll via the confirmed dice table, §3.2), Learn Spells
 * (the confirmed per-class candidate ranges, `Random(20) > Intelligence`
 * roll, gold spent even on failure, §3.5), Bank (deposit/withdraw between
 * carried and per-character banked gold, §3.6), Cast Spell (Healing I-IV
 * and Resurrection only — `spell-format.md` §3 confirms the real dispatcher
 * refuses every other spell index from this non-combat entry point too, so
 * this isn't a partial implementation). Mystic is implemented as the doc's
 * own suggested interim substitute — a read-only party-status report —
 * since the real flavour-text trigger flags (`char.+0x18`/`+0x5C`) aren't
 * named yet.
 *
 * On mount, if `party.pendingXp > 0` (combat pooled XP awaiting division —
 * `CombatScene`, town-format.md §3.8), the town auto-opens the XP-divide
 * screen before the hub — the confirmed auto-trigger (§3.7 mode 1), minus
 * the item-assignment half of that same screen (no per-character
 * inventory exists yet to assign into — see `PartyState.items`' own doc
 * comment).
 *
 * Two confirmed gating mechanisms are deliberately NOT modelled, both
 * flagged in `TODO.md` as genuinely unresolved rather than skipped for
 * convenience: the Inn's `$2846`/`$285a` room-availability flags (meaning
 * unresolved — the Inn always applies here), and Learn Spells' party-wide
 * `$3136`/`hunk1+0x3190` "spells discovered" progress gate (what
 * increments it was never traced — every class-range candidate is always
 * offered here, not gated behind game progress).
 *
 * The backdrop is the real `w4.cmp` main-town-view art (`dungeon-format.md`
 * §9.0.1) — `w3.cmp`'s per-area interaction overlays are not wired in yet.
 */

import { Assets, Container, Graphics, Sprite, type Texture } from 'pixi.js';
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
import {
  giveItem,
  removeGold,
  occupiedMembers,
  livingMembers,
  totalBankedGold,
  bankDeposit,
  bankWithdrawAll,
  divideXp,
  type PartyState,
} from '../state/PartyState.ts';
import type { CharacterState } from '../state/CharacterState.ts';
import { savePartyLocation } from '../state/save/SaveManager.ts';
import { OverworldScene } from '../overworld/OverworldScene.ts';
import { DEFAULT_GAME, DEFAULT_PLATFORM } from '../game-id.ts';
import { mpChartValue, trainingHp, uniformDie } from './character-creation-formulas.ts';
import { SPELL_MP_COST, SPELL_RESURRECTION, isCastableHere, applyHealing, applyResurrection } from './spell-formulas.ts';

const ARMOURY_PAGE_SIZE = 14;
/** Undead's raw race index (data-tables.md §4.1) — excluded from Inn MP-growth and Training, town-format.md §3.1/§3.2. */
const RACE_EXCLUDED_FROM_TRAINING_AND_MP_GROWTH = 17;
const MAX_LEVEL = 21;
/**
 * Training's actual gold cost formula (town-format.md §3.2) is confirmed in
 * shape — `armouryMarkup% × a Charisma-modified base`, two level-indexed
 * tables (`hunk1+0xA4C`/`0xA6A`) and a per-class stat formula with
 * different divisors — but neither table's byte contents nor the per-class
 * formula's exact closed form were transcribed, so it can't be reproduced
 * here without guessing. This flat placeholder (matching this project's
 * existing `starting-gold` placeholder pattern) stands in until those
 * tables are dumped.
 */
function trainingCostPlaceholder(newLevel: number): number {
  return newLevel * 50;
}

/** `char.+0x94`/[6][class] spell-index range each class can learn from via this screen — Fighter/Thief/Priest/Ranger/Monk/Wizard order (town-format.md §3.5, file `0x10468`-`0x104b6`). */
const CLASS_SPELL_RANGE: [number, number][] = [
  [0, 0], // Fighter
  [1, 1], // Thief
  [2, 4], // Priest
  [5, 6], // Ranger
  [7, 8], // Monk
  [9, 12], // Wizard
];
/** Confirmed formula shape (`base × Charisma×Intelligence/classDiv, clamped 1-250`, town-format.md §3.5) but `classDiv`'s per-class constants weren't transcribed — same placeholder treatment as Training's cost. */
const LEARN_SPELL_COST_PLACEHOLDER = 100;
/** Str/Int/Dex/Con/Cha/Luck — `CharacterState.attributes`' confirmed order (scripting-engine.md §7.5.3). */
const ATTR_INTELLIGENCE = 1;
const ATTR_CONSTITUTION = 3;

export interface TownLocation {
  x: number;
  y: number;
  name: string;
  /**
   * Which of the 18 confirmed `inititem.dat` armoury rows this town's
   * Armoury sells from (data-tables.md §6.4). Derived from the town's
   * `LocateSpecial()` marker index — the 14 real towns' indices (1-14)
   * line up exactly with the 14 non-empty armoury rows (armoury-1 =
   * Pendragon, cross-checked against `default_88.png`; town-format.md
   * §3.4). `undefined` for a town this mapping hasn't been derived for.
   */
  armouryIndex?: number;
}

type View = 'hub' | 'armoury' | 'training' | 'mystic' | 'learn-spells' | 'bank' | 'divide-xp' | 'cast-spell';

export class TownScene implements Scene {
  name = 'town';
  private ctx!: SceneContext;
  private readonly root = new Container();
  private readonly classes: string[];
  private view: View = 'hub';
  private armouryPage = 0;
  private notice = '';
  private readonly party: PartyState;
  private readonly data: GameData;
  private readonly location: TownLocation | undefined;
  private readonly base: string;
  private viewWidth = 0;
  private viewHeight = 0;
  private backdrop: Sprite | null = null;
  private tint: Graphics | null = null;
  /** Per-living-member share weight for the XP-divide screen, `livingMembers()` order — town-format.md §3.7 mode 1's confirmed 1-3 clamp. */
  private xpShareWeights: number[] = [];
  /** Cast Spell's two-step wizard state: caster chosen, then a spell needing a target. */
  private castCaster: CharacterState | null = null;
  private castSpellIndex: number | null = null;

  constructor(party: PartyState, data: GameData, location?: TownLocation) {
    this.party = party;
    this.data = data;
    this.location = location;
    this.classes = classNames(data);
    this.base = `/assets/${DEFAULT_GAME}/${DEFAULT_PLATFORM}`;
  }

  mount(ctx: SceneContext): void {
    this.ctx = ctx;
    this.viewWidth = ctx.viewWidth;
    this.viewHeight = ctx.viewHeight;
    ctx.stage.addChild(this.root);
    if (this.location) {
      savePartyLocation(this.party, { kind: 'town', x: this.location.x, y: this.location.y, name: this.location.name, armouryIndex: this.location.armouryIndex });
    }
    if (this.party.pendingXp > 0) {
      this.view = 'divide-xp';
      this.xpShareWeights = livingMembers(this.party).map(() => 1);
    }
    this.render();
    void this.loadBackdrop();
  }

  unmount(): void {}

  update(): void {}

  handleResize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    if (this.backdrop) this.fitBackdrop(this.backdrop);
    if (this.tint) this.tint.clear().rect(0, 0, this.viewWidth, this.viewHeight).fill({ color: 0x000000, alpha: 0.45 });
    this.render();
  }

  private async loadBackdrop(): Promise<void> {
    try {
      const texture = await Assets.load<Texture>(`${this.base}/w4.png`);
      const sprite = new Sprite(texture);
      this.fitBackdrop(sprite);
      this.backdrop = sprite;
      this.ctx.stage.addChildAt(sprite, 0);
      // A flat tint behind the UI, not the room art itself — the busy
      // street/gatehouse backdrop otherwise fights the menu text for
      // legibility (real Phantasie III drew its own opaque dialog panels
      // over this same art; this project's UI uses plain text instead).
      this.tint = new Graphics().rect(0, 0, this.viewWidth, this.viewHeight).fill({ color: 0x000000, alpha: 0.45 });
      this.ctx.stage.addChildAt(this.tint, 1);
    } catch {
      // No backdrop — the plain dark background is fine.
    }
  }

  private fitBackdrop(sprite: Sprite): void {
    const tex = sprite.texture;
    const scale = Math.max(this.viewWidth / tex.width, this.viewHeight / tex.height);
    sprite.scale.set(scale);
    sprite.position.set((this.viewWidth - tex.width * scale) / 2, (this.viewHeight - tex.height * scale) / 2);
  }

  private render(): void {
    this.root.removeChildren();
    if (this.view === 'hub') this.renderHub();
    else if (this.view === 'armoury') this.renderArmoury();
    else if (this.view === 'training') this.renderTraining();
    else if (this.view === 'learn-spells') this.renderLearnSpells();
    else if (this.view === 'bank') this.renderBank();
    else if (this.view === 'divide-xp') this.renderDivideXp();
    else if (this.view === 'cast-spell') this.renderCastSpell();
    else this.renderMystic();
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
        { label: 'Bank', onClick: () => this.openBank() },
        { label: 'Inn', onClick: () => this.useInn() },
        { label: 'Mystic', onClick: () => this.openMystic() },
        { label: 'Training', onClick: () => this.openTraining() },
        { label: 'Learn Spells', onClick: () => this.openLearnSpells() },
        { label: 'Cast Spell', onClick: () => this.openCastSpell() },
        { label: 'Leave Town', onClick: () => this.leaveTown() },
      ],
      cx - 110,
      cy - 140,
      220,
      34,
      8,
    );
    this.root.addChild(menu);

    if (this.notice) this.root.addChild(makeCentered(this.notice, cx, cy + 190, { size: 13, color: UI_COLOR_ACCENT }));
  }

  private openArmoury(): void {
    this.view = 'armoury';
    this.armouryPage = 0;
    this.notice = '';
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

  // -- Inn (§3.1) ----------------------------------------------------------

  /**
   * Whole-party action (not per-character). Full HP heal plus a chance-
   * based Magic Power growth roll, exactly as traced. The confirmed
   * age-tick and body-location-repair effects aren't modeled: aging has no
   * consumer anywhere in this build, and nothing yet damages a body
   * location (no injury system exists), so repairing one would be a
   * guaranteed no-op today. The `$2846`/`$285a` gating flags (meaning
   * unresolved) aren't modeled either — the Inn always applies here.
   */
  private useInn(): void {
    const messages: string[] = [];
    for (const member of livingMembers(this.party)) {
      member.hp = member.maxHp;
      const mpChart = mpChartValue(member.classId, member.level);
      if (member.race !== RACE_EXCLUDED_FROM_TRAINING_AND_MP_GROWTH && mpChart > member.maxMp) {
        if (uniformDie(100) <= (mpChart - member.maxMp) * 20) {
          member.maxMp += 1;
          member.mp = member.maxMp;
          messages.push(`${member.name}'s magic increases!`);
        }
      }
    }
    this.stub(`The party's health improves!${messages.length ? ' ' + messages.join(' ') : ''}`);
  }

  // -- Mystic (§3.3) — interim read-only party-status report --------------

  private openMystic(): void {
    this.view = 'mystic';
    this.notice = '';
    this.render();
  }

  private renderMystic(): void {
    const cx = this.viewWidth / 2;
    this.root.addChild(makeCentered('Mystic — Party Status', cx, 20, { size: 22, bold: true, color: UI_COLOR_ACCENT }));
    this.root.addChild(
      makeCentered(
        'The real Mystic report (reputation-tier flavour text) is not fully traced yet — this is a plain status summary.',
        cx,
        48,
        { size: 11, color: UI_COLOR_MUTED },
      ),
    );

    let y = 84;
    for (const member of occupiedMembers(this.party)) {
      const status = member.alive ? `HP ${member.hp}/${member.maxHp}  MP ${member.mp}/${member.maxMp}` : 'fallen';
      this.root.addChild(
        makeText(`${member.name} — ${this.classes[member.classId]} Lv${member.level}  ${status}`, cx - 240, y, { size: 13 }),
      );
      y += 24;
    }

    const back = makeButton({ label: 'Back', onClick: () => this.backToHub(), width: 90, height: 30 });
    back.position.set(cx - 45, y + 20);
    this.root.addChild(back);
  }

  // -- Bank (§3.6) — deposit/withdraw between carried and banked gold -----

  private openBank(): void {
    this.view = 'bank';
    this.notice = '';
    this.render();
  }

  /** Fixed deposit amounts — the real game prompts for a free-typed amount (`town-format.md` §3.6); this UI has no numeric text-input widget yet, so a few preset amounts plus "Deposit All" stand in. */
  private static readonly BANK_DEPOSIT_PRESETS = [10, 50, 100];

  private renderBank(): void {
    const cx = this.viewWidth / 2;
    this.root.addChild(makeCentered(`Bank — Carried: ${this.party.gold}gp`, cx, 20, { size: 22, bold: true, color: UI_COLOR_ACCENT }));
    this.root.addChild(
      makeCentered(`Banked (all members): ${totalBankedGold(this.party)}gp`, cx, 46, { size: 13, color: UI_COLOR_MUTED }),
    );
    this.root.addChild(
      makeCentered(
        'Deposit amount is a few presets — the real game prompts for a typed amount, which this UI doesn\'t support yet.',
        cx,
        66,
        { size: 11, color: UI_COLOR_MUTED },
      ),
    );

    let y = 100;
    this.root.addChild(makeText('Deposit:', cx - 220, y, { size: 13 }));
    let bx = cx - 130;
    for (const amount of TownScene.BANK_DEPOSIT_PRESETS) {
      const btn = makeButton({
        label: `${amount}gp`,
        onClick: () => this.deposit(amount),
        width: 80,
        height: 28,
        disabled: this.party.gold < amount,
      });
      btn.position.set(bx, y - 4);
      this.root.addChild(btn);
      bx += 90;
    }
    const depositAll = makeButton({
      label: 'Deposit All',
      onClick: () => this.deposit(this.party.gold),
      width: 110,
      height: 28,
      disabled: this.party.gold <= 0,
    });
    depositAll.position.set(bx, y - 4);
    this.root.addChild(depositAll);
    y += 44;

    const withdraw = makeButton({
      label: 'Withdraw All',
      onClick: () => this.withdrawAll(),
      width: 130,
      height: 30,
      accent: true,
      disabled: totalBankedGold(this.party) <= 0,
    });
    withdraw.position.set(cx - 220, y);
    this.root.addChild(withdraw);
    y += 46;

    if (this.notice) this.root.addChild(makeText(this.notice, cx - 220, y, { size: 12, color: UI_COLOR_ACCENT }));
    const back = makeButton({ label: 'Back', onClick: () => this.backToHub(), width: 90, height: 30 });
    back.position.set(cx - 220, y + 30);
    this.root.addChild(back);
  }

  private deposit(amount: number): void {
    bankDeposit(this.party, amount);
    this.notice = `Deposited ${amount}gp, split across the party.`;
    this.render();
  }

  private withdrawAll(): void {
    const amount = totalBankedGold(this.party);
    bankWithdrawAll(this.party);
    this.notice = `Withdrew ${amount}gp from the bank.`;
    this.render();
  }

  // -- XP divide (§3.7 mode 1) — auto-triggered on town arrival ------------

  private renderDivideXp(): void {
    const cx = this.viewWidth / 2;
    this.root.addChild(makeCentered('Divide Experience', cx, 20, { size: 22, bold: true, color: UI_COLOR_ACCENT }));
    this.root.addChild(
      makeCentered(`Your party has ${this.party.pendingXp} pooled Experience to divide.`, cx, 48, { size: 13, color: UI_COLOR_MUTED }),
    );
    this.root.addChild(
      makeCentered(
        'Set each member\'s share (1-3) — higher gets a larger cut of the split. The real screen also lets you assign this trip\'s loot here; this build has no per-character inventory yet to assign it into.',
        cx,
        68,
        { size: 11, color: UI_COLOR_MUTED },
      ),
    );

    const living = livingMembers(this.party);
    let y = 108;
    living.forEach((member, i) => {
      this.root.addChild(makeText(`${member.name} — ${this.classes[member.classId]} Lv${member.level}`, cx - 220, y, { size: 13 }));
      const minus = makeButton({
        label: '-',
        onClick: () => {
          this.xpShareWeights[i] = Math.max(1, this.xpShareWeights[i] - 1);
          this.render();
        },
        width: 28,
        height: 24,
      });
      minus.position.set(cx + 80, y - 4);
      this.root.addChild(minus);
      this.root.addChild(makeCentered(String(this.xpShareWeights[i]), cx + 120, y, { size: 13 }));
      const plus = makeButton({
        label: '+',
        onClick: () => {
          this.xpShareWeights[i] = Math.min(3, this.xpShareWeights[i] + 1);
          this.render();
        },
        width: 28,
        height: 24,
      });
      plus.position.set(cx + 140, y - 4);
      this.root.addChild(plus);
      y += 30;
    });

    const confirm = makeButton({ label: 'Divide', onClick: () => this.confirmDivideXp(), width: 120, height: 34, accent: true });
    confirm.position.set(cx - 220, y + 16);
    this.root.addChild(confirm);
  }

  private confirmDivideXp(): void {
    divideXp(this.party, this.xpShareWeights);
    this.view = 'hub';
    this.notice = "The party's experience is divided.";
    this.render();
  }

  // -- Training (§3.2) — a per-character paid level-up ---------------------

  private openTraining(): void {
    this.view = 'training';
    this.notice = '';
    this.render();
  }

  private eligibleForTraining(member: CharacterState): boolean {
    return member.alive && member.race !== RACE_EXCLUDED_FROM_TRAINING_AND_MP_GROWTH && member.level < MAX_LEVEL;
  }

  private renderTraining(): void {
    const cx = this.viewWidth / 2;
    const startX = cx - 220;
    this.root.addChild(makeCentered(`Training — Gold: ${this.party.gold}`, cx, 20, { size: 22, bold: true, color: UI_COLOR_ACCENT }));
    this.root.addChild(
      makeCentered(
        'Cost is a placeholder (the real per-class/stat formula\'s tables aren\'t transcribed yet) — Level+1, HP re-roll, and the gold deduction are the confirmed effect.',
        cx,
        48,
        { size: 11, color: UI_COLOR_MUTED },
      ),
    );

    let y = 84;
    for (const member of occupiedMembers(this.party)) {
      const eligible = this.eligibleForTraining(member);
      const newLevel = Math.min(member.level + 1, MAX_LEVEL);
      const cost = trainingCostPlaceholder(newLevel);
      this.root.addChild(
        makeText(`${member.name} — ${this.classes[member.classId]} Lv${member.level}`, startX, y, { size: 13 }),
      );
      const train = makeButton({
        label: eligible ? `Train (${cost}gp)` : 'Ineligible',
        onClick: () => this.trainMember(member),
        width: 130,
        height: 26,
        disabled: !eligible || this.party.gold < cost,
      });
      train.position.set(startX + 300, y - 4);
      this.root.addChild(train);
      y += 30;
    }

    if (this.notice) this.root.addChild(makeText(this.notice, startX, y + 10, { size: 12, color: UI_COLOR_ACCENT }));
    const back = makeButton({ label: 'Back', onClick: () => this.backToHub(), width: 90, height: 30 });
    back.position.set(startX, y + 34);
    this.root.addChild(back);
  }

  private trainMember(member: CharacterState): void {
    if (!this.eligibleForTraining(member)) return;
    const newLevel = Math.min(member.level + 1, MAX_LEVEL);
    const cost = trainingCostPlaceholder(newLevel);
    if (this.party.gold < cost) return;

    removeGold(this.party, cost);
    const newHp = trainingHp(member.classId, newLevel, member.maxHp);
    member.level = newLevel;
    member.maxHp = newHp;
    member.hp = newHp;
    // TODO(town-p3-training-skill-selection): the confirmed skill-maxima
    // recompute (the same `0xe67a` routine FireBowMax uses) isn't wired
    // here — this build derives combat skill values on the fly from
    // `data.skills` by class/level (`combat/formulas/p3-combat.ts`'s
    // `attackSkillAt`) rather than baking them into the character record,
    // so there's no per-character skill state for Training to update yet.

    this.notice = `${member.name} trains to level ${newLevel}! (HP ${newHp})`;
    this.render();
  }

  // -- Learn Spells (§3.5) --------------------------------------------------

  private openLearnSpells(): void {
    this.view = 'learn-spells';
    this.notice = '';
    this.render();
  }

  private eligibleForSpells(member: CharacterState): boolean {
    return member.alive && member.race !== RACE_EXCLUDED_FROM_TRAINING_AND_MP_GROWTH;
  }

  /** Candidate spells: this class's confirmed range, minus anything already known. */
  private learnableSpells(member: CharacterState): { index: number; name: string }[] {
    const [start, end] = CLASS_SPELL_RANGE[member.classId];
    return this.data.spells.filter((s) => s.index >= start && s.index <= end && !member.knownSpells.includes(s.index));
  }

  private renderLearnSpells(): void {
    const cx = this.viewWidth / 2;
    const startX = cx - 260;
    this.root.addChild(makeCentered(`Learn Spells — Gold: ${this.party.gold}`, cx, 20, { size: 22, bold: true, color: UI_COLOR_ACCENT }));
    this.root.addChild(
      makeCentered(
        `Cost is a placeholder (the real per-class divisor isn't transcribed yet). ${LEARN_SPELL_COST_PLACEHOLDER}gp is spent even if the roll fails — Random(20) must not exceed Intelligence.`,
        cx,
        48,
        { size: 11, color: UI_COLOR_MUTED },
      ),
    );

    let y = 84;
    for (const member of occupiedMembers(this.party)) {
      if (!this.eligibleForSpells(member)) continue;
      const candidates = this.learnableSpells(member);
      this.root.addChild(
        makeText(`${member.name} — ${this.classes[member.classId]} (Int ${member.attributes[ATTR_INTELLIGENCE]})`, startX, y, {
          size: 13,
          bold: true,
        }),
      );
      y += 22;
      if (candidates.length === 0) {
        this.root.addChild(makeText('(nothing left to learn in range)', startX + 20, y, { size: 12, color: UI_COLOR_MUTED }));
        y += 22;
        continue;
      }
      for (const spell of candidates) {
        this.root.addChild(makeText(spell.name, startX + 20, y, { size: 12 }));
        const learn = makeButton({
          label: `Learn (${LEARN_SPELL_COST_PLACEHOLDER}gp)`,
          onClick: () => this.learnSpell(member, spell.index),
          width: 130,
          height: 24,
          disabled: this.party.gold < LEARN_SPELL_COST_PLACEHOLDER,
        });
        learn.position.set(startX + 320, y - 4);
        this.root.addChild(learn);
        y += 26;
      }
    }

    if (this.notice) this.root.addChild(makeText(this.notice, startX, y + 10, { size: 12, color: UI_COLOR_ACCENT }));
    const back = makeButton({ label: 'Back', onClick: () => this.backToHub(), width: 90, height: 30 });
    back.position.set(startX, y + 34);
    this.root.addChild(back);
  }

  private learnSpell(member: CharacterState, spellIndex: number): void {
    if (this.party.gold < LEARN_SPELL_COST_PLACEHOLDER) return;
    // Gold is spent unconditionally, even on a failed roll (§3.5's own
    // confirmed "the guild takes payment regardless of outcome" framing).
    removeGold(this.party, LEARN_SPELL_COST_PLACEHOLDER);
    const roll = uniformDie(20);
    if (roll > member.attributes[ATTR_INTELLIGENCE]) {
      this.notice = `${member.name} fails to learn the spell.`;
    } else {
      member.knownSpells.push(spellIndex);
      const spell = this.data.spells.find((s) => s.index === spellIndex);
      this.notice = `${member.name} learns ${spell?.name ?? `spell ${spellIndex}`}!`;
    }
    this.render();
  }

  // -- Cast Spell (spell-format.md §3-§5) — Healing and Resurrection only --

  private openCastSpell(): void {
    this.view = 'cast-spell';
    this.notice = '';
    this.castCaster = null;
    this.castSpellIndex = null;
    this.render();
  }

  private renderCastSpell(): void {
    const cx = this.viewWidth / 2;
    const startX = cx - 240;
    this.root.addChild(makeCentered('Cast Spell', cx, 20, { size: 22, bold: true, color: UI_COLOR_ACCENT }));

    let y = 56;
    if (!this.castCaster) {
      this.root.addChild(
        makeCentered('Only Healing and Resurrection are castable outside combat — every other known spell is refused here, matching the real game.', cx, 44, { size: 11, color: UI_COLOR_MUTED }),
      );
      y = 76;
      const casters = livingMembers(this.party).filter((m) => m.knownSpells.some(isCastableHere));
      if (casters.length === 0) {
        this.root.addChild(makeText('No one knows a spell castable here.', startX, y, { size: 13, color: UI_COLOR_MUTED }));
        y += 30;
      }
      for (const member of casters) {
        const btn = makeButton({
          label: `${member.name} (MP ${member.mp}/${member.maxMp})`,
          onClick: () => {
            this.castCaster = member;
            this.render();
          },
          width: 260,
          height: 30,
        });
        btn.position.set(startX, y);
        this.root.addChild(btn);
        y += 36;
      }
    } else if (this.castSpellIndex === null) {
      this.root.addChild(makeText(`${this.castCaster.name} — MP ${this.castCaster.mp}/${this.castCaster.maxMp}`, startX, y, { size: 14, bold: true }));
      y += 32;
      for (const spellIndex of this.castCaster.knownSpells.filter(isCastableHere)) {
        const spell = this.data.spells.find((s) => s.index === spellIndex);
        const cost = SPELL_MP_COST[spellIndex] ?? 0;
        const btn = makeButton({
          label: `${spell?.name ?? `Spell ${spellIndex}`} (${cost}mp)`,
          onClick: () => {
            this.castSpellIndex = spellIndex;
            this.render();
          },
          width: 260,
          height: 30,
          disabled: this.castCaster!.mp < cost,
        });
        btn.position.set(startX, y);
        this.root.addChild(btn);
        y += 36;
      }
    } else {
      const resurrection = this.castSpellIndex === SPELL_RESURRECTION;
      this.root.addChild(makeText(resurrection ? 'Choose a target to resurrect:' : 'Choose a target to heal:', startX, y, { size: 14, bold: true }));
      y += 32;
      const targets = occupiedMembers(this.party).filter((m) => (resurrection ? !m.alive : true));
      if (targets.length === 0) {
        this.root.addChild(makeText(resurrection ? 'No fallen party member to resurrect.' : 'No valid target.', startX, y, { size: 13, color: UI_COLOR_MUTED }));
        y += 30;
      }
      for (const target of targets) {
        const status = target.alive ? `HP ${target.hp}/${target.maxHp}` : 'fallen';
        const btn = makeButton({
          label: `${target.name} (${status})`,
          onClick: () => this.castOnTarget(target),
          width: 260,
          height: 30,
        });
        btn.position.set(startX, y);
        this.root.addChild(btn);
        y += 36;
      }
    }

    if (this.notice) {
      this.root.addChild(makeText(this.notice, startX, y + 10, { size: 12, color: UI_COLOR_ACCENT }));
      y += 30;
    }
    const back = makeButton({ label: 'Back', onClick: () => this.backToHub(), width: 90, height: 30 });
    back.position.set(startX, y + 20);
    this.root.addChild(back);
  }

  private castOnTarget(target: CharacterState): void {
    const caster = this.castCaster;
    const spellIndex = this.castSpellIndex;
    if (!caster || spellIndex === null) return;
    const cost = SPELL_MP_COST[spellIndex] ?? 0;
    if (caster.mp < cost) return;

    if (spellIndex === SPELL_RESURRECTION) {
      applyResurrection(target, ATTR_CONSTITUTION);
      this.notice = `${target.name} is resurrected!`;
    } else {
      const { healed } = applyHealing(target, spellIndex);
      this.notice = `${target.name} is healed for ${healed} HP.`;
    }
    caster.mp -= cost;
    this.castCaster = null;
    this.castSpellIndex = null;
    this.render();
  }

  // -- Armoury (§3.4/§6.4) --------------------------------------------------

  private renderArmoury(): void {
    const cx = this.viewWidth / 2;
    const startX = cx - 240;
    this.root.addChild(makeCentered(`Armoury — Gold: ${this.party.gold}`, cx, 20, { size: 22, bold: true, color: UI_COLOR_ACCENT }));

    const armouryIndex = this.location?.armouryIndex;
    if (armouryIndex === undefined) {
      this.root.addChild(
        makeCentered("This town's armoury records aren't available.", cx, 100, { size: 14, color: UI_COLOR_MUTED }),
      );
      const back = makeButton({ label: 'Back', onClick: () => this.backToHub(), width: 90, height: 30 });
      back.position.set(cx - 45, 140);
      this.root.addChild(back);
      return;
    }

    const markupPercent = this.data.shopMarkups.find((m) => m.armoury === armouryIndex)?.markupPercent ?? 100;
    const stock = this.data.armouryStock[armouryIndex] ?? [];
    const rows = stock
      .map((s) => ({ item: this.data.items.find((i) => i.index === s.itemIndex), qty: s.qty }))
      .filter((r): r is { item: NonNullable<typeof r.item>; qty: number } => r.item !== undefined)
      .map((r) => ({ ...r, price: Math.round(((r.item.basePrice ?? 0) * markupPercent) / 100) }));

    const pageStart = this.armouryPage * ARMOURY_PAGE_SIZE;
    const pageItems = rows.slice(pageStart, pageStart + ARMOURY_PAGE_SIZE);

    let y = 56;
    for (const { item, qty, price } of pageItems) {
      this.root.addChild(makeText(item.name, startX, y, { size: 13 }));
      this.root.addChild(makeText(`${price} gp  (x${qty})`, startX + 260, y, { size: 13, color: UI_COLOR_MUTED }));
      const buy = makeButton({
        label: 'Buy',
        onClick: () => this.buyItem(item.index, price),
        width: 60,
        height: 22,
        disabled: this.party.gold < price,
      });
      buy.position.set(startX + 400, y - 3);
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
      disabled: pageStart + ARMOURY_PAGE_SIZE >= rows.length,
    });
    next.position.set(startX + 110, navY);
    this.root.addChild(next);

    const back = makeButton({ label: 'Back', onClick: () => this.backToHub(), width: 90, height: 30 });
    back.position.set(startX + 360, navY);
    this.root.addChild(back);
  }

  private buyItem(index: number, price: number): void {
    if (this.party.gold < price) return;
    removeGold(this.party, price);
    giveItem(this.party, index);
    if (this.location) {
      savePartyLocation(this.party, { kind: 'town', x: this.location.x, y: this.location.y, name: this.location.name, armouryIndex: this.location.armouryIndex });
    }
    this.render();
  }

  private backToHub(): void {
    this.view = 'hub';
    this.armouryPage = 0;
    this.notice = '';
    this.render();
  }
}
