/**
 * Phantasie III dungeon-script host — the live-game replacement for the
 * viewer's no-op `makeInspectorHost` (tools/viewer/dungeon-viewer.ts).
 * Runs the real `executeStar`/`executeStarChain` interpreter
 * (src/assets/formats/star-action.ts) against a live `PartyState`,
 * applying every opcode's effect per scripting-engine.md §5, and queueing
 * scene-level side effects (encounter / teleport / set-cell / win) for the
 * dungeon scene to act on once the chain completes.
 *
 * Phantasie III only for now (Phase A of docs/implementation.md). The
 * opcode table is P3's; Phases B/C will add P1/P2's own tables and the
 * per-game branches catalogued in that doc's §1.1 (opcode 0x12/0x13 shape,
 * -Gold's 250-vs-256 multiplier) — those are NOT silently assumed here.
 */

import {
  executeStarChain,
  type ActionEffect,
  type ActionOutcome,
  type DecodedAction,
  type DecodedStar,
  type ExecuteStarHost,
  type StarExecutionResult,
} from '../assets/formats/star-action.ts';
import { P3_OPCODES, p3RemapStatIndex } from '../assets/formats/opcodes.ts';
import type { GameId } from '../game-id.ts';
import {
  getStat,
  setStat,
  P3_RACE_DWARVEN,
  P3_RACE_GNOME,
  P3_SPELL_DIVINE_AID,
} from '../state/CharacterState.ts';
import { applyBit, hasBit } from '../state/GameFlags.ts';
import {
  addGold,
  removeGold,
  giveItem,
  hasItem,
  livingMembers,
  type PartyState,
} from '../state/PartyState.ts';

/** A side effect the dungeon scene must act on after a star chain finishes. */
export type DungeonHostEvent =
  | { type: 'encounter'; monsterIndex: number; surprise: boolean }
  | { type: 'teleport'; x: number; y: number }
  | { type: 'setCell'; x: number; y: number; cell: number }
  | { type: 'win' };

/** UI seam — the scene supplies the real message/choice widgets (Phase A1). */
export interface DungeonHostPresenter {
  /** `messageIndex` into the dungeon's message list; `fullscreen` distinguishes opcode 0x0B from a star's own windowed message. */
  showMessage(messageIndex: number, fullscreen: boolean): void;
  promptChoice(min: number, max: number): number;
}

export interface DungeonHostOptions {
  gameId: GameId;
  party: PartyState;
  stars: ReadonlyMap<number, DecodedStar>;
  actions: ReadonlyMap<number, DecodedAction>;
  presenter?: DungeonHostPresenter;
  /** Uniform `[0,1)` source for opcode 0x15's chance roll and trap damage; injectable for deterministic tests. */
  random?: () => number;
}

export class DungeonHost implements ExecuteStarHost {
  private readonly party: PartyState;
  private readonly stars: ReadonlyMap<number, DecodedStar>;
  private readonly actions: ReadonlyMap<number, DecodedAction>;
  private readonly presenter: DungeonHostPresenter | undefined;
  private readonly random: () => number;
  readonly events: DungeonHostEvent[] = [];

  constructor(opts: DungeonHostOptions) {
    if (opts.gameId !== 'phantasieiii') {
      throw new Error(`DungeonHost currently implements Phantasie III only (got "${opts.gameId}")`);
    }
    this.party = opts.party;
    this.stars = opts.stars;
    this.actions = opts.actions;
    this.presenter = opts.presenter;
    this.random = opts.random ?? Math.random;
  }

  /** Run one star's message + choice + action chain against the live party. */
  triggerStar(starIndex: number, choiceOverride?: number): StarExecutionResult[] {
    return executeStarChain(this.stars, this.actions, P3_OPCODES, starIndex, this, choiceOverride);
  }

  showMessage(messageIndex: number): void {
    this.presenter?.showMessage(messageIndex, false);
  }

  promptChoice(min: number, max: number): number {
    return this.presenter?.promptChoice(min, max) ?? min;
  }

  applyEffect(effect: ActionEffect): ActionOutcome | void {
    const v = effect.values;
    switch (effect.kind) {
      case 'stop':
        return;

      // 0x01-0x04, 0x10 — trap damage `[1, Param1]`, applied to every living
      // member. The exact target set is not independently confirmed.
      case 'trap':
        this.damageParty(1 + Math.floor(this.random() * v.maxDamage));
        return;

      case 'encounter':
        this.events.push({ type: 'encounter', monsterIndex: v.monsterIndex, surprise: effect.opcode === 0x11 });
        return;

      case 'giveItem':
        giveItem(this.party, v.itemIndex);
        return;

      case 'addGold':
        addGold(this.party, v.amount256 * 256);
        return;

      // P3 multiplies by 256 (P1/P2 use 250 — a documented engine difference).
      case 'removeGold':
        removeGold(this.party, v.amountRaw * 256);
        return;

      case 'showMessage':
        this.presenter?.showMessage(v.messageIndexPlus1 - 1, true);
        return;

      case 'teleport':
        this.events.push({ type: 'teleport', x: v.x, y: v.y });
        return;

      case 'setCell':
        this.events.push({ type: 'setCell', x: v.x, y: v.y, cell: v.newCell });
        return;

      case 'gotoAction':
      case 'gotoStar':
        return; // resolved statically by star-action.ts

      // 0x15 — Param1 = % chance to NOT jump; jump iff roll >= chance.
      case 'gotoActionChance':
        if (Math.floor(this.random() * 100) >= v.percentChanceNotToJump) {
          return { nextActionIndex: v.actionIndex };
        }
        return;

      case 'win':
        this.events.push({ type: 'win' });
        return;

      case 'itemGate':
        if (hasItem(this.party, v.itemIndex)) return { nextActionIndex: v.actionIndex };
        return;

      // 0x12 (P3): unconditional SetStat on every occupied slot — no alive
      // filter, no GetStat compare (scripting-engine.md §5, disassembly-confirmed).
      case 'setStat': {
        const idx = p3RemapStatIndex(v.statIndex);
        for (const member of this.party.members) if (member) setStat(member, idx, v.value);
        return;
      }

      // 0x13 (P3): "goto Action Param3" iff ZERO members meet-or-exceed the
      // threshold (inverted polarity vs P1, §5).
      case 'statGate': {
        const idx = p3RemapStatIndex(v.statIndex);
        const anyMeets = this.party.members.some((m) => m !== null && getStat(m, idx) >= v.value);
        if (!anyMeets) return { nextActionIndex: v.param3 };
        return;
      }

      case 'bitmaskSet': {
        const idx = p3RemapStatIndex(v.statIndex);
        for (const member of this.party.members) {
          if (member) setStat(member, idx, applyBit(getStat(member, idx), v.bitNumber, v.setNotClear !== 0));
        }
        return;
      }

      case 'bitmaskGate': {
        // Special case: raw stat-index 0x75 means "any member knows Divine
        // Aid" — jump unconditionally on a match (§5).
        if (v.statIndex === 0x75) {
          if (this.party.members.some((m) => m !== null && m.knownSpells.includes(P3_SPELL_DIVINE_AID))) {
            return { nextActionIndex: v.actionIndex };
          }
          return;
        }
        const idx = p3RemapStatIndex(v.statIndex);
        if (this.party.members.some((m) => m !== null && hasBit(getStat(m, idx), v.bitNumber))) {
          return { nextActionIndex: v.actionIndex };
        }
        return;
      }

      // 0x1A — party contains a Dwarf (Dwarven) or Gnome.
      case 'raceGate':
        if (
          this.party.members.some(
            (m) => m !== null && (m.race === P3_RACE_DWARVEN || m.race === P3_RACE_GNOME),
          )
        ) {
          return { nextActionIndex: v.actionIndex };
        }
        return;

      // 0x1B — "increment a stat for every living member (capped at 30)".
      // The target stat index is NOT independently confirmed (§5 gives no
      // index); no-op rather than guess. TODO(scripting-p3-0x1b-stat-index).
      case 'statIncrementAll':
        return;

      default:
        return;
    }
  }

  onDeactivate(kind: 'star' | 'action', index: number): void {
    // In-memory one-use deactivation: the real game writes the inactive
    // sentinel to byte 0 of the record; the decoded-flag equivalent is
    // clearing `isActive` so a re-trigger sees an empty/inactive slot.
    if (kind === 'star') {
      const star = this.stars.get(index);
      if (star) star.isActive = false;
    } else {
      const action = this.actions.get(index);
      if (action) action.isActive = false;
    }
  }

  private damageParty(amount: number): void {
    for (const member of livingMembers(this.party)) {
      member.hp = Math.max(0, member.hp - amount);
    }
  }
}
