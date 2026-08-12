/**
 * Phantasie dungeon-script action opcode tables — pure data, no control
 * flow. See docs/phantasie/scripting-engine.md §5 for the full prose
 * description of every opcode's effect; `star-action.ts` is the module
 * that actually dispatches on `kind` to run/describe an action.
 *
 * Three tables are exported: `P1_OPCODES` (0x00-0x13, no extension —
 * Phantasie I throws on anything higher), `P2_OPCODES` (0x00-0x13 plus the
 * P2-exclusive 0x14-0x17), and `P3_OPCODES` (0x00-0x13 plus P3's own,
 * differently-numbered 0x14-0x1B). The 0x00-0x13 core is byte-for-byte
 * identical in meaning across all three games (with the 0x12/0x13 caveat
 * documented on those two entries below).
 */

export type OpcodeKind =
  | 'stop'
  | 'trap'
  | 'encounter'
  | 'giveItem'
  | 'addGold'
  | 'removeGold'
  | 'showMessage'
  | 'teleport'
  | 'setCell'
  | 'setStat'
  | 'statGate'
  | 'gotoAction'
  | 'gotoActionChance'
  | 'gotoStar'
  | 'win'
  | 'itemGate'
  | 'bitmaskSet'
  | 'bitmaskGate'
  | 'raceGate'
  | 'statIncrementAll';

export interface OpcodeDef {
  opcode: number;
  name: string;
  kind: OpcodeKind;
  /** Human-readable name for each param byte this opcode reads (length matches the record's real param count). */
  params: readonly string[];
  /**
   * True if this opcode's effect always ends the action chain regardless
   * of byte 0's chain-continuation bit (0x00, 0x10, 0x11, and P2's 0x17
   * win marker) — scripting-engine.md §5's "Chain behavior" column.
   */
  forcesStop: boolean;
  description: string;
  /**
   * Set only on opcodes whose real interpreter code path is NOT
   * disassembly-confirmed for this specific game — currently just
   * 0x12/0x13 for P2 and P3 (scripting-engine.md §5's "Correction (this
   * pass)" block and §6.3(b)). P1's 0x12/0x13 ARE disassembly-confirmed
   * and carry no such flag. Absent (undefined) means "confirmed or not
   * applicable."
   */
  unverifiedFor?: readonly ('p2' | 'p3')[];
}

/**
 * The double-sized (4-byte) opcode set — byte-for-byte identical between
 * the P1/P2 engine and the P3 engine (scripting-engine.md §2), keyed by
 * raw opcode *number* regardless of which game or which extension range
 * defines that number's meaning.
 *
 * Two entries in this set (0x15, 0x17) look inconsistent with the small
 * per-opcode "Size" column in scripting-engine.md §5's P2-exclusive
 * table, which lists both as "1" (single 2-byte record). That column is
 * not reliable for wire-format sizing: P2's own 0x15 needs two params
 * (percent chance + goto-action target) and physically cannot fit them in
 * a 2-byte record, so this set — described in §2 as the authoritative,
 * explicitly-enumerated double-size list — is what `actionRecordSizeBytes`
 * uses to determine slot advancement while walking the action table.
 */
export const ACTION_DOUBLE_SIZED_OPCODES: ReadonlySet<number> = new Set([
  0x0c, 0x0d, 0x0e, 0x0f, 0x12, 0x13, 0x15, 0x17, 0x18, 0x19,
]);

/** 4 bytes (2 params beyond Param1) if `opcode` is in the double-sized set, else 2 bytes (Param1 only). */
export function actionRecordSizeBytes(opcode: number): 2 | 4 {
  return ACTION_DOUBLE_SIZED_OPCODES.has(opcode) ? 4 : 2;
}

/** 0x00-0x13 — identical meaning in all three games (scripting-engine.md §5's shared table). */
const CORE_OPCODES: OpcodeDef[] = [
  { opcode: 0x00, name: 'Stop', kind: 'stop', params: [], forcesStop: true, description: 'No-op terminator.' },
  {
    opcode: 0x01,
    name: 'Trap (shock)',
    kind: 'trap',
    params: ['maxDamage'],
    forcesStop: false,
    description: 'Trap (shock-type flavor); damage = [1, Param1].',
  },
  {
    opcode: 0x02,
    name: 'Trap (shock)',
    kind: 'trap',
    params: ['maxDamage'],
    forcesStop: false,
    description: 'Trap (shock-type flavor); damage = [1, Param1].',
  },
  {
    opcode: 0x03,
    name: 'Trap (shock)',
    kind: 'trap',
    params: ['maxDamage'],
    forcesStop: false,
    description: 'Trap (shock-type flavor); damage = [1, Param1].',
  },
  {
    opcode: 0x04,
    name: 'Trap (shock)',
    kind: 'trap',
    params: ['maxDamage'],
    forcesStop: false,
    description: 'Trap (shock-type flavor); damage = [1, Param1].',
  },
  {
    opcode: 0x05,
    name: 'Encounter',
    kind: 'encounter',
    params: ['monsterIndex'],
    forcesStop: false,
    description: 'Encounter, no surprise; Param1 = monster index.',
  },
  {
    opcode: 0x06,
    name: '+Item',
    kind: 'giveItem',
    params: ['itemIndex'],
    forcesStop: false,
    description: 'Give item; Param1 = item index.',
  },
  {
    opcode: 0x07,
    name: '+Gold (windowed)',
    kind: 'addGold',
    params: ['amount256'],
    forcesStop: false,
    description: 'Add gold (shown in a window); amount = Param1 * 256.',
  },
  {
    opcode: 0x08,
    name: '+Gold (silent)',
    kind: 'addGold',
    params: ['amount256'],
    forcesStop: false,
    description: 'Add gold (silent); amount = Param1 * 256.',
  },
  {
    opcode: 0x09,
    name: '-Gold (windowed)',
    kind: 'removeGold',
    params: ['amountRaw'],
    forcesStop: false,
    description:
      'Remove gold (windowed); amount = Param1 * 250 (P1/P2) or Param1 * 256 (P3) — a confirmed engine difference.',
  },
  {
    opcode: 0x0a,
    name: '-Gold (silent)',
    kind: 'removeGold',
    params: ['amountRaw'],
    forcesStop: false,
    description: 'Remove gold (silent); same multiplier discrepancy as 0x09.',
  },
  {
    opcode: 0x0b,
    name: 'Fullscreen message',
    kind: 'showMessage',
    params: ['messageIndexPlus1'],
    forcesStop: false,
    description: 'Show a fullscreen message; messageIndex = Param1 - 1.',
  },
  {
    opcode: 0x0c,
    name: 'Teleport (windowed)',
    kind: 'teleport',
    params: ['x', 'y'],
    forcesStop: false,
    description: 'Teleport party (windowed); Param1 = x, Param2 = y.',
  },
  {
    opcode: 0x0d,
    name: 'Teleport (silent)',
    kind: 'teleport',
    params: ['x', 'y'],
    forcesStop: false,
    description: 'Teleport party (silent); same params as 0x0C.',
  },
  {
    opcode: 0x0e,
    name: 'Set cell (windowed)',
    kind: 'setCell',
    params: ['x', 'y', 'newCell'],
    forcesStop: false,
    description: 'Set dungeon cell (windowed); Param1 = x, Param2 = y, Param3 = new cell value.',
  },
  {
    opcode: 0x0f,
    name: 'Set cell (silent)',
    kind: 'setCell',
    params: ['x', 'y', 'newCell'],
    forcesStop: false,
    description: 'Set dungeon cell (silent); same params as 0x0E.',
  },
  {
    opcode: 0x10,
    name: 'Trap (normal)',
    kind: 'trap',
    params: ['maxDamage'],
    forcesStop: true,
    description: 'Trap (normal-type); damage = [1, Param1]. Forces stop regardless of flag bits.',
  },
  {
    opcode: 0x11,
    name: 'Encounter (surprise)',
    kind: 'encounter',
    params: ['monsterIndex'],
    forcesStop: true,
    description: 'Encounter, party surprised; Param1 = monster index. Forces stop.',
  },
  {
    opcode: 0x12,
    name: 'Set character stat',
    kind: 'setStat',
    params: ['statIndex', 'value'],
    forcesStop: false,
    description:
      'Party-wide "raise stat to at least value" floor: for every living member, ' +
      'if GetStat(char,statIndex) < value then SetStat(char,statIndex,value). ' +
      'Disassembly-confirmed for P1 (scripting-engine.md §6.3(b)); P2/P3 declared ' +
      'behavior only, not traced.',
    unverifiedFor: ['p2', 'p3'],
  },
  {
    opcode: 0x13,
    name: 'Conditional (stat gate)',
    kind: 'statGate',
    params: ['statIndex', 'value', 'param3'],
    forcesStop: false,
    description:
      'Party-wide qualification gate: proceeds (ShowMessage(Param3-1)) only if zero living ' +
      'members have GetStat(char,statIndex) < value. Disassembly-confirmed for P1 ' +
      '(scripting-engine.md §6.3(b)); P2\'s declared behavior ("goto Action Param3" per its ' +
      'display string) is unresolved against real interpreter code, and P3 was never traced.',
    unverifiedFor: ['p2', 'p3'],
  },
];

/** Phantasie I stops at 0x13 — the reference parser throws on anything higher. */
export const P1_OPCODES: ReadonlyMap<number, OpcodeDef> = new Map(CORE_OPCODES.map((d) => [d.opcode, d]));

/** Phantasie II's own 0x14-0x17 extension (scripting-engine.md §5). */
const P2_EXTENSION_OPCODES: OpcodeDef[] = [
  {
    opcode: 0x14,
    name: 'Goto action',
    kind: 'gotoAction',
    params: ['actionIndex'],
    forcesStop: false,
    description: 'Unconditional "goto Action Param1". Sets next action index directly.',
  },
  {
    opcode: 0x15,
    name: 'Goto action (chance)',
    kind: 'gotoActionChance',
    params: ['percentChanceNotToJump', 'actionIndex'],
    forcesStop: false,
    description:
      'Param1 = percent chance to NOT jump; on success (roll >= chance), "goto Action Param2".',
  },
  {
    opcode: 0x16,
    name: 'Goto star',
    kind: 'gotoStar',
    params: ['starIndexPlus1'],
    forcesStop: false,
    description: '"goto Star Param1 - 1". Ends the action chain and redirects to a different star.',
  },
  {
    opcode: 0x17,
    name: 'Game won',
    kind: 'win',
    params: [],
    forcesStop: true,
    description: '"!! GAME WON !!" — win-condition marker.',
  },
];

export const P2_OPCODES: ReadonlyMap<number, OpcodeDef> = new Map(
  [...CORE_OPCODES, ...P2_EXTENSION_OPCODES].map((d) => [d.opcode, d]),
);

/**
 * Phantasie III's own 0x14-0x1B extension — a disjoint, differently
 * numbered set from P2's (scripting-engine.md §5: "do not conflate").
 */
const P3_EXTENSION_OPCODES: OpcodeDef[] = [
  {
    opcode: 0x14,
    name: 'Goto action',
    kind: 'gotoAction',
    params: ['actionIndex'],
    forcesStop: false,
    description: 'Unconditional "goto Action Param1".',
  },
  {
    opcode: 0x15,
    name: 'Goto action (chance)',
    kind: 'gotoActionChance',
    params: ['percentChanceNotToJump', 'actionIndex'],
    forcesStop: false,
    description:
      'Param1 = percent chance to NOT jump; on success, "goto Action Param2".',
  },
  {
    opcode: 0x16,
    name: 'Goto star',
    kind: 'gotoStar',
    params: ['starIndexPlus1'],
    forcesStop: false,
    description: '"goto Star Param1 - 1".',
  },
  {
    opcode: 0x17,
    name: 'Item gate',
    kind: 'itemGate',
    params: ['itemIndex', 'actionIndex'],
    forcesStop: false,
    description: 'Conditional: if the party owns item Param1, "goto Action Param2".',
  },
  {
    opcode: 0x18,
    name: 'Set stat bitmask',
    kind: 'bitmaskSet',
    params: ['bitNumber', 'statIndex', 'setNotClear'],
    forcesStop: false,
    description:
      'value = 1 << (Param1 - 1); if Param3 != 0, OR it into stat Param2, else AND it out.',
  },
  {
    opcode: 0x19,
    name: 'Bitmask gate',
    kind: 'bitmaskGate',
    params: ['bitNumber', 'statIndex', 'actionIndex'],
    forcesStop: false,
    description:
      'Conditional: if stat Param2 has bit (1 << (Param1-1)) set, "goto Action Param3". ' +
      'Special case: raw stat-index value 0x75 instead means "does any party member know ' +
      'Divine Aid", jumping unconditionally to Param3 on a match.',
  },
  {
    opcode: 0x1a,
    name: 'Race gate',
    kind: 'raceGate',
    params: ['actionIndex'],
    forcesStop: false,
    description: 'Conditional: if the party contains a Dwarf or Gnome, "goto Action Param1".',
  },
  {
    opcode: 0x1b,
    name: 'Stat increment (all)',
    kind: 'statIncrementAll',
    params: [],
    forcesStop: false,
    description: 'Increment a stat for every living party member (capped at 30).',
  },
];

export const P3_OPCODES: ReadonlyMap<number, OpcodeDef> = new Map(
  [...CORE_OPCODES, ...P3_EXTENSION_OPCODES].map((d) => [d.opcode, d]),
);

/**
 * For opcodes 0x12, 0x13, 0x18, 0x19 in Phantasie III only: a raw
 * stat-index Param value >= 0x3D is remapped by subtracting 0x3D before
 * use as a stat-table index (scripting-engine.md §5, end of section). No
 * equivalent exists in the P1/P2 opcode set.
 */
export const P3_STAT_INDEX_REMAP_THRESHOLD = 0x3d;

export function p3RemapStatIndex(rawStatIndex: number): number {
  return rawStatIndex >= P3_STAT_INDEX_REMAP_THRESHOLD ? rawStatIndex - P3_STAT_INDEX_REMAP_THRESHOLD : rawStatIndex;
}
