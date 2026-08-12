/**
 * Star (trigger) and action (script) record decoding, plus the
 * `ExecuteStar` interpreter algorithm, parameterized by an opcode table
 * from `opcodes.ts`.
 *
 * See docs/phantasie/scripting-engine.md §1 (star record), §2 (action
 * record), §4 (interpreter algorithm), §5 (opcode table). Byte-exact
 * confirmed against `data/phantasie/amiga/dng1`: star slot 0 decodes from
 * `5B 02 4B 00 00` to `messageIndex=90, nbChoices=2, actionsIndex=[0x4B,0]`;
 * action slot 5 (address `0x5AA + 5*2`) decodes from `C6 33` to
 * `opcode=0x06 ("+Item"), isLastAction=false, isOneUse=true, param1=0x33`.
 */

import { STAR_TABLE_SLOT_COUNT, STAR_TABLE_SLOT_SIZE, ACTION_TABLE_MAX_SLOTS } from './dungeon.ts';
import { actionRecordSizeBytes, type OpcodeDef, type OpcodeKind } from './opcodes.ts';

// ---------------------------------------------------------------------------
// Star records — scripting-engine.md §1.
// ---------------------------------------------------------------------------

export interface DecodedStar {
  /** Table slot index this record starts at (5-byte units). */
  slotIndex: number;
  /** File offset of byte 0. */
  offset: number;
  /** `true` when this slot's byte 0 is `0x00` — no record here at all (distinct from an inactive-but-present star, byte0 `0xFF`). */
  empty: boolean;
  /** `false` only when byte 0 `=== 0xFF` (the dedicated inactive sentinel, full-byte equality — §1). Always `false` when `empty`. */
  isActive: boolean;
  isOneUse: boolean;
  /** `(byte0 & 0x7F) - 1`. Meaningless when `empty` or `!isActive`. */
  messageIndex: number;
  /** Byte 1, verbatim. */
  nbChoices: number;
  /** One action-table index per choice (at least 1, even when `nbChoices <= 1`). */
  actionsIndex: number[];
  /** Record size in 5-byte slot units: `((nbChoices+1)/5)+1` (integer division). 1 for `empty` slots. */
  sizeSlots: number;
}

const STAR_INACTIVE_BYTE = 0xff;
const STAR_EMPTY_BYTE = 0x00;

/** Decode one star record at `offset` (does not check for the empty-slot sentinel — see `decodeStarTable`). */
export function decodeStarRecord(data: Uint8Array, offset: number, slotIndex: number): DecodedStar {
  const b0 = data[offset];
  const nbChoices = data[offset + 1];
  const numIndices = Math.max(nbChoices, 1);
  const actionsIndex: number[] = [];
  for (let i = 0; i < numIndices; i++) actionsIndex.push(data[offset + 2 + i]);
  return {
    slotIndex,
    offset,
    empty: false,
    isActive: b0 !== STAR_INACTIVE_BYTE,
    isOneUse: ((b0 >> 7) & 1) === 1,
    messageIndex: (b0 & 0x7f) - 1,
    nbChoices,
    actionsIndex,
    sizeSlots: Math.floor((nbChoices + 1) / 5) + 1,
  };
}

/**
 * Scan the packed, variable-stride 35-slot star table starting at
 * `baseOffset` (scripting-engine.md §1's "Table layout"). A slot whose
 * byte 0 is `0x00` is empty and advances the scan by exactly 1 index;
 * otherwise a record is decoded there and the scan advances by its
 * `sizeSlots`.
 */
export function decodeStarTable(
  data: Uint8Array,
  baseOffset: number,
  slotCount: number = STAR_TABLE_SLOT_COUNT,
): DecodedStar[] {
  const slots: DecodedStar[] = [];
  let i = 0;
  while (i < slotCount) {
    const offset = baseOffset + i * STAR_TABLE_SLOT_SIZE;
    if (data[offset] === STAR_EMPTY_BYTE) {
      slots.push({
        slotIndex: i,
        offset,
        empty: true,
        isActive: false,
        isOneUse: false,
        messageIndex: -1,
        nbChoices: 0,
        actionsIndex: [],
        sizeSlots: 1,
      });
      i += 1;
      continue;
    }
    const star = decodeStarRecord(data, offset, i);
    slots.push(star);
    i += star.sizeSlots;
  }
  return slots;
}

/** Index non-empty star records by their starting slot index, for `executeStar`'s `LoadStar(starIndex)`. */
export function starTableToMap(stars: readonly DecodedStar[]): Map<number, DecodedStar> {
  const map = new Map<number, DecodedStar>();
  for (const s of stars) if (!s.empty) map.set(s.slotIndex, s);
  return map;
}

// ---------------------------------------------------------------------------
// Action records — scripting-engine.md §2.
// ---------------------------------------------------------------------------

export interface DecodedAction {
  /** Table slot index this record starts at (2-byte units). */
  slotIndex: number;
  offset: number;
  /** `byte0 & 0x3F`. */
  opcode: number;
  /** `byte0 === 0x00` (opcode 0 with no flags — overlaps with opcode 0's own "Stop" meaning). */
  isActive: boolean;
  /** `(byte0 >> 7) & 1 === 0` — chain ends after this action unless the opcode itself sets a jump. */
  isLastAction: boolean;
  /** `(byte0 >> 6) & 1 === 1`. Inactive sentinel for actions is `0x00` (not `0xFF` like stars). */
  isOneUse: boolean;
  /** Param1..Param3, only as many as this opcode's wire size actually carries (1 or 3 entries). */
  params: number[];
  sizeBytes: 2 | 4;
  /** `sizeBytes / 2` — the unit `decodeActionTable` advances the scan by. */
  sizeSlots: 1 | 2;
}

export function decodeActionRecord(data: Uint8Array, offset: number, slotIndex: number): DecodedAction {
  const b0 = data[offset];
  const opcode = b0 & 0x3f;
  const sizeBytes = actionRecordSizeBytes(opcode);
  const params = [data[offset + 1]];
  if (sizeBytes === 4) params.push(data[offset + 2], data[offset + 3]);
  return {
    slotIndex,
    offset,
    opcode,
    isActive: b0 !== 0x00,
    isLastAction: ((b0 >> 7) & 1) === 0,
    isOneUse: ((b0 >> 6) & 1) === 1,
    params,
    sizeBytes,
    sizeSlots: (sizeBytes / 2) as 1 | 2,
  };
}

export interface ActionTableOptions {
  /** P1/P2: stop the scan at the first 2-byte-aligned `0x0D 0x0D` pair (dungeon-format.md §3.1). */
  terminator?: boolean;
  /** P3: fixed capacity, no terminator (dungeon-format.md §5.1). */
  slotCount?: number;
  /** Safety bound against a corrupt/foreign file with no terminator — real files always stop well before this. */
  maxSlots?: number;
}

/**
 * Walk the 2-byte-aligned, variable-stride action table starting at
 * `baseOffset`, decoding one record per iteration and advancing by its
 * `sizeSlots` (scripting-engine.md §2's "Table layout").
 */
export function decodeActionTable(
  data: Uint8Array,
  baseOffset: number,
  options: ActionTableOptions = {},
): DecodedAction[] {
  const { terminator = false, slotCount, maxSlots = ACTION_TABLE_MAX_SLOTS } = options;
  const limit = slotCount ?? maxSlots;
  const actions: DecodedAction[] = [];
  let i = 0;
  while (i < limit) {
    const offset = baseOffset + i * 2;
    if (offset + 1 >= data.length) break;
    if (terminator && data[offset] === 0x0d && data[offset + 1] === 0x0d) break;
    const action = decodeActionRecord(data, offset, i);
    actions.push(action);
    i += action.sizeSlots;
  }
  return actions;
}

/** Index action records by their starting slot index, for `executeStar`'s `LoadAction(actionIndex)`. */
export function actionTableToMap(actions: readonly DecodedAction[]): Map<number, DecodedAction> {
  const map = new Map<number, DecodedAction>();
  for (const a of actions) map.set(a.slotIndex, a);
  return map;
}

// ---------------------------------------------------------------------------
// Action effect description — turns a decoded record + its opcode
// definition into a human/JSON-friendly structure. Pure data transform,
// useful standalone (e.g. for the dungeon JSON export) even without
// running the interpreter.
// ---------------------------------------------------------------------------

export interface ActionEffect {
  opcode: number;
  name: string;
  kind: OpcodeKind;
  description: string;
  /** Named param values, keyed by `OpcodeDef.params`. */
  values: Record<string, number>;
  unverifiedFor?: readonly ('p2' | 'p3')[];
}

export function buildActionEffect(action: DecodedAction, opcodeTable: ReadonlyMap<number, OpcodeDef>): ActionEffect {
  const def = opcodeTable.get(action.opcode);
  if (!def) {
    throw new Error(`unknown opcode 0x${action.opcode.toString(16).padStart(2, '0')} at slot ${action.slotIndex}`);
  }
  const values: Record<string, number> = {};
  def.params.forEach((name, i) => {
    values[name] = action.params[i];
  });
  return {
    opcode: action.opcode,
    name: def.name,
    kind: def.kind,
    description: def.description,
    values,
    ...(def.unverifiedFor ? { unverifiedFor: def.unverifiedFor } : {}),
  };
}

// ---------------------------------------------------------------------------
// ExecuteStar interpreter — scripting-engine.md §4. Structural control flow
// (chain advancement, one-use timing, forced stops, the two statically
// resolvable jump opcodes) is handled here directly since it's fully
// confirmed and game-state-independent. Dynamic/conditional opcodes
// (0x13, 0x15, 0x17-P3, 0x19, 0x1A) delegate to a caller-supplied `host`,
// since resolving them needs live party state this module has no access
// to (no live game exists yet — Phase 6 in implementation-plan.md).
// ---------------------------------------------------------------------------

export interface ActionOutcome {
  /** Override the next action index (or `null` to end the chain). `undefined` = let the default chain-advance rule decide. */
  nextActionIndex?: number | null;
  /** Redirect `ExecuteStar`'s outer loop to a different star once this action chain ends. */
  nextStarIndex?: number | null;
}

export interface ExecuteStarHost {
  /** `ShowMessage(star.MessageIndex)` — windowed message display. */
  showMessage(messageIndex: number): void;
  /** `PromptPlayerForNumber(1..star.NbChoices)`, only called when `nbChoices > 1`. */
  promptChoice(min: number, max: number): number;
  /**
   * Apply one action's effect. Called for every executed action, including
   * the ones this module resolves on its own control-flow-wise (`stop`,
   * `gotoAction`, `gotoStar`, and anything with `forcesStop`) — the
   * returned outcome is ignored for those; return `undefined`/nothing for
   * every opcode the host doesn't need to override.
   */
  applyEffect(effect: ActionEffect): ActionOutcome | void;
  /** Informational only — this module never mutates the decoded arrays (scripting-engine.md §1/§2: in-memory-only in the reference tool). */
  onDeactivate?(kind: 'star' | 'action', index: number): void;
}

export interface StarExecutionStep {
  actionIndex: number;
  effect: ActionEffect;
}

export interface StarExecutionResult {
  starIndex: number;
  messageIndex: number;
  /** 1-based; always `1` when `nbChoices <= 1`. */
  choice: number;
  steps: StarExecutionStep[];
  /** Set by a `gotoStar`-kind opcode (`0x16` in both extensions) or a host override; `null` otherwise. */
  nextStarIndex: number | null;
}

/**
 * Run one star's message + choice + action chain (the two inner loops of
 * scripting-engine.md §4's pseudocode). Returns `null` if the star is
 * empty/inactive (`ReadCell` "simply stops"). `choiceOverride` lets a
 * caller force a specific choice instead of asking `host.promptChoice`.
 */
export function executeStar(
  stars: ReadonlyMap<number, DecodedStar>,
  actions: ReadonlyMap<number, DecodedAction>,
  opcodeTable: ReadonlyMap<number, OpcodeDef>,
  starIndex: number,
  host: ExecuteStarHost,
  choiceOverride?: number,
): StarExecutionResult | null {
  const star = stars.get(starIndex);
  if (!star || !star.isActive) return null;

  host.showMessage(star.messageIndex);
  const choice = star.nbChoices > 1 ? (choiceOverride ?? host.promptChoice(1, star.nbChoices)) : 1;
  let actionIndex: number | null = star.actionsIndex[choice - 1] ?? null;

  const steps: StarExecutionStep[] = [];
  let nextStarIndex: number | null = null;
  const visited = new Set<number>(); // defensive cycle guard, not part of the documented algorithm

  while (actionIndex !== null) {
    if (visited.has(actionIndex)) break;
    visited.add(actionIndex);

    const action = actions.get(actionIndex);
    if (!action || !action.isActive) break;

    const def = opcodeTable.get(action.opcode);
    if (!def) break;

    const effect = buildActionEffect(action, opcodeTable);
    steps.push({ actionIndex, effect });

    let next: number | null = action.isLastAction ? null : actionIndex + action.sizeSlots;
    let starRedirect: number | null = null;

    // Statically resolvable jumps — game-state-independent, so this
    // module resolves them itself regardless of what the host returns.
    if (def.kind === 'gotoAction') {
      next = action.params[0];
    } else if (def.kind === 'gotoStar') {
      starRedirect = action.params[0] - 1;
      next = null;
    }

    const outcome = host.applyEffect(effect) ?? undefined;
    if (def.forcesStop) {
      next = null;
    } else if (outcome) {
      if (outcome.nextActionIndex !== undefined) next = outcome.nextActionIndex;
      if (outcome.nextStarIndex !== undefined) starRedirect = outcome.nextStarIndex;
    }

    // "One-use deactivation happens after the opcode executes" (§4).
    if (action.isOneUse) host.onDeactivate?.('action', actionIndex);

    if (starRedirect !== null) {
      nextStarIndex = starRedirect;
      break;
    }
    actionIndex = next;
  }

  if (star.isOneUse) host.onDeactivate?.('star', starIndex);

  return { starIndex, messageIndex: star.messageIndex, choice, steps, nextStarIndex };
}

/**
 * Follow `executeStar`'s outer "goto star" loop (§4's top-level `loop:`)
 * until a star fails to redirect further, a cycle is detected, or
 * `maxHops` is reached (defensive — real content doesn't loop).
 */
export function executeStarChain(
  stars: ReadonlyMap<number, DecodedStar>,
  actions: ReadonlyMap<number, DecodedAction>,
  opcodeTable: ReadonlyMap<number, OpcodeDef>,
  starIndex: number,
  host: ExecuteStarHost,
  choiceOverride?: number,
  maxHops = 64,
): StarExecutionResult[] {
  const results: StarExecutionResult[] = [];
  let current: number | null = starIndex;
  let hops = 0;
  const visited = new Set<number>();
  while (current !== null && hops < maxHops && !visited.has(current)) {
    visited.add(current);
    const result = executeStar(stars, actions, opcodeTable, current, host, hops === 0 ? choiceOverride : undefined);
    if (!result) break;
    results.push(result);
    current = result.nextStarIndex;
    hops++;
  }
  return results;
}
