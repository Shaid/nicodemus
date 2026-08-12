/**
 * Dungeon view for the asset viewer: a flat-coloured top-down grid render
 * of a decoded `dungeon-*.json` asset (each game's `build-dungeons.ts`), using
 * `dungeon-format.md` §4's cell-ID table (`classifyCell` from
 * `src/assets/formats/dungeon.ts`) for colour, plus a click-to-inspect
 * panel for star cells that replays the real `executeStar` interpreter
 * (`src/assets/formats/star-action.ts`) against the decoded star/action
 * tables — the same code path the pipeline and its tests exercise, not a
 * re-implementation.
 *
 * No pan/zoom (unlike `map-viewer.ts`'s world map) — dungeon grids are
 * small (33x38 P1/P2, 24x30 P3) and render at a legible cell size in one
 * screen.
 */
import { setHidden } from './shared.ts';
import { classifyCell, type CellClass } from '../../src/assets/formats/dungeon.ts';
import {
  starTableToMap,
  actionTableToMap,
  executeStar,
  type DecodedStar,
  type DecodedAction,
  type ExecuteStarHost,
  type StarExecutionResult,
} from '../../src/assets/formats/star-action.ts';
import { sliceChoiceText } from '../../src/assets/formats/messages.ts';
import { P1_OPCODES, P2_OPCODES, P3_OPCODES, type OpcodeDef } from '../../src/assets/formats/opcodes.ts';
import type { GameId } from '../../src/game-id.ts';

/** P1/P2's per-line-slot message shape; P3 ships plain `string | null`. */
interface P1P2MessageJson {
  index: number;
  empty: boolean;
  text?: string;
  embeddedChoiceCountHint?: number;
  choiceLineText?: string;
}
type DungeonMessage = P1P2MessageJson | string | null;

export interface DungeonData {
  name: string;
  level: number;
  width: number;
  height: number;
  cells: number[];
  fixedEncounterTable: number[];
  stars: DecodedStar[];
  actions: DecodedAction[];
  messages: DungeonMessage[];
}

const OPCODE_TABLE_BY_GAME: Record<GameId, ReadonlyMap<number, OpcodeDef>> = {
  phantasie: P1_OPCODES,
  phantasieii: P2_OPCODES,
  phantasieiii: P3_OPCODES,
};

const CELL_SIZE = 16;

const KIND_COLORS: Record<CellClass['kind'], string> = {
  wall: '#26262b',
  secretWall: '#3a3a42',
  trap: '#d9822b',
  triggeredTrap: '#8a5a1e',
  randomEncounter: '#c23b3b',
  specialMessage: '#3b6ea5',
  fixedEncounter: '#8b1e1e',
  unassigned: '#ff00ff',
  bottomMessage: '#7fb3d9',
  door: '#c9a06a',
  stairsExit: '#2e8b57',
  stairsInter: '#2e8b8b',
  star: '#d4af37',
};

function doorColor(state: string): string {
  switch (state) {
    case 'locked':
      return '#7a4a20';
    case 'unlockable':
      return '#5a3510';
    case 'encounter':
      return '#b5895a';
    default:
      return '#c9a06a'; // open
  }
}

function colorFor(cls: CellClass): string {
  if (cls.kind === 'door') return doorColor(cls.state);
  return KIND_COLORS[cls.kind];
}

function describeCell(cls: CellClass): string {
  switch (cls.kind) {
    case 'wall':
      return 'Wall';
    case 'secretWall':
      return 'Secret wall';
    case 'trap':
      return `Trap (raw cell 0x${cls.trapValue.toString(16)})`;
    case 'triggeredTrap':
      return 'Triggered trap (already sprung)';
    case 'randomEncounter':
      return `Random encounter (roster from monster ${cls.monsterIndex0})`;
    case 'specialMessage':
      return 'Special message';
    case 'fixedEncounter':
      return `Fixed encounter (header table index ${cls.fixedEncounterIndex})`;
    case 'unassigned':
      return 'Unassigned (never observed in real data)';
    case 'bottomMessage':
      return 'Bottom message';
    case 'door':
      return `Door (${cls.orientation}, ${cls.state})${cls.monsterIndex0 !== undefined ? ` — monster ${cls.monsterIndex0}` : ''}`;
    case 'stairsExit':
      return 'Stairs (exit dungeon)';
    case 'stairsInter':
      return `Stairs (from level ${cls.fromLevel})`;
    case 'star':
      return `Star trigger #${cls.starIndex}`;
  }
}

function messageText(messages: DungeonMessage[], index: number): string {
  const m = messages[index];
  if (m === undefined || m === null) return '(no message)';
  if (typeof m === 'string') return m.trim() || '(empty)';
  if (m.empty) return '(empty)';
  return (m.text ?? '').trim() || '(empty)';
}

/** A no-op recording host — this is a static inspector, not a live game; conditional opcodes just stop the trace at that action. */
function makeInspectorHost(fixedChoice?: number): ExecuteStarHost {
  return {
    showMessage() {},
    promptChoice: () => fixedChoice ?? 1,
    applyEffect() {},
  };
}

export class DungeonViewer {
  private container: HTMLElement;
  private strip: HTMLElement;
  private detach: (() => void)[] = [];
  private data: DungeonData | null = null;
  private starsMap: Map<number, DecodedStar> = new Map();
  private actionsMap: Map<number, DecodedAction> = new Map();
  private opcodeTable: ReadonlyMap<number, OpcodeDef> = P1_OPCODES;
  private detailEl: HTMLElement;
  private legendEl: HTMLElement;
  summaryText = '';

  constructor(container: HTMLElement) {
    this.container = container;
    this.strip = document.getElementById('dungeon-strip')!;
    this.detailEl = document.getElementById('dungeon-detail')!;
    this.legendEl = document.getElementById('dungeon-legend')!;
  }

  get summary(): string {
    return this.summaryText;
  }

  async show(assetBase: string, name: string, game: GameId): Promise<void> {
    this.opcodeTable = OPCODE_TABLE_BY_GAME[game] ?? P1_OPCODES;
    this.container.innerHTML = '<div class="state-panel"><span class="state-icon">🗺</span><span class="state-title">Loading dungeon…</span></div>';

    let data: DungeonData;
    try {
      const res = await fetch(`${assetBase}/${name}.json`);
      if (!res.ok) throw new Error('not found');
      data = (await res.json()) as DungeonData;
    } catch {
      this.container.innerHTML =
        '<div class="state-panel state-error"><span class="state-icon">⚠</span><span class="state-title">Failed to load dungeon</span></div>';
      return;
    }

    setHidden(this.strip, false);
    this.data = data;
    this.starsMap = starTableToMap(data.stars);
    this.actionsMap = actionTableToMap(data.actions);
    this.summaryText = `${data.width}×${data.height} cells · level ${data.level} · ${data.stars.length} stars · ${data.actions.length} actions`;

    this.renderGrid();
    this.renderLegend();
    this.showTileDetail(null);
  }

  hide(): void {
    for (const fn of this.detach) fn();
    this.detach = [];
    this.data = null;
    setHidden(this.strip, true);
  }

  private renderGrid(): void {
    const data = this.data!;
    this.container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = data.width * CELL_SIZE;
    canvas.height = data.height * CELL_SIZE;
    canvas.style.cursor = 'pointer';
    this.container.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;

    for (let y = 0; y < data.height; y++) {
      for (let x = 0; x < data.width; x++) {
        const code = data.cells[y * data.width + x];
        const cls = classifyCell(code, data.level);
        ctx.fillStyle = colorFor(cls);
        ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= data.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL_SIZE + 0.5, 0);
      ctx.lineTo(x * CELL_SIZE + 0.5, data.height * CELL_SIZE);
      ctx.stroke();
    }
    for (let y = 0; y <= data.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL_SIZE + 0.5);
      ctx.lineTo(data.width * CELL_SIZE, y * CELL_SIZE + 0.5);
      ctx.stroke();
    }

    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.floor(((e.clientX - rect.left) * scaleX) / CELL_SIZE);
      const y = Math.floor(((e.clientY - rect.top) * scaleY) / CELL_SIZE);
      if (x < 0 || x >= data.width || y < 0 || y >= data.height) return;
      this.showTileDetail({ x, y });
    };
    canvas.addEventListener('click', onClick);
    this.detach.push(() => canvas.removeEventListener('click', onClick));
  }

  private renderLegend(): void {
    this.legendEl.innerHTML = '';
    const entries: [string, string][] = [
      ['wall', KIND_COLORS.wall],
      ['secret wall', KIND_COLORS.secretWall],
      ['trap', KIND_COLORS.trap],
      ['triggered trap', KIND_COLORS.triggeredTrap],
      ['random encounter', KIND_COLORS.randomEncounter],
      ['special message', KIND_COLORS.specialMessage],
      ['fixed encounter', KIND_COLORS.fixedEncounter],
      ['bottom message', KIND_COLORS.bottomMessage],
      ['door', KIND_COLORS.door],
      ['stairs (exit)', KIND_COLORS.stairsExit],
      ['stairs (inter-level)', KIND_COLORS.stairsInter],
      ['star', KIND_COLORS.star],
    ];
    for (const [label, color] of entries) {
      const chip = document.createElement('span');
      chip.className = 'map-legend-item';
      chip.innerHTML = `<span class="map-legend-swatch" style="background:${color}"></span>${label}`;
      this.legendEl.appendChild(chip);
    }
  }

  private showTileDetail(cell: { x: number; y: number } | null): void {
    const data = this.data;
    if (!data || !cell) {
      this.detailEl.innerHTML = '<p class="dungeon-hint">Click a cell to inspect it. Star cells (gold) show their message, choices, and action chain.</p>';
      return;
    }
    const code = data.cells[cell.y * data.width + cell.x];
    const cls = classifyCell(code, data.level);

    let html = `<div class="dungeon-detail-head">(${cell.x}, ${cell.y}) — cell 0x${code.toString(16).padStart(2, '0')} — ${describeCell(cls)}</div>`;

    if (cls.kind === 'star') {
      html += this.renderStarDetail(cls.starIndex);
    }

    this.detailEl.innerHTML = html;

    const select = this.detailEl.querySelector<HTMLSelectElement>('.dungeon-choice-select');
    if (select) {
      select.addEventListener('change', () => {
        const starIndex = Number(select.dataset.starIndex);
        const choice = Number(select.value);
        const html2 =
          `<div class="dungeon-detail-head">(${cell.x}, ${cell.y}) — cell 0x${code.toString(16).padStart(2, '0')} — ${describeCell(cls)}</div>` +
          this.renderStarDetail(starIndex, choice);
        this.detailEl.innerHTML = html2;
        const select2 = this.detailEl.querySelector<HTMLSelectElement>('.dungeon-choice-select');
        select2?.addEventListener('change', () => this.showTileDetail(cell));
      });
    }
  }

  private renderStarDetail(starIndex: number, choice?: number): string {
    const data = this.data!;
    const star = this.starsMap.get(starIndex);
    if (!star) return '<p class="dungeon-hint">No decoded star record at this index (packed table — see dungeon-format.md §1).</p>';
    if (!star.isActive) return '<p class="dungeon-hint">Star is inactive (deactivated sentinel, byte0 = 0xFF).</p>';

    const host = makeInspectorHost(choice);
    const result: StarExecutionResult | null = executeStar(
      this.starsMap,
      this.actionsMap,
      this.opcodeTable,
      starIndex,
      host,
      choice,
    );
    if (!result) return '<p class="dungeon-hint">Star did not execute.</p>';

    let html = `<div class="dungeon-message">${escapeHtml(messageText(data.messages, result.messageIndex))}</div>`;

    if (star.nbChoices > 1) {
      const msg = data.messages[result.messageIndex];
      let choiceLabels: string[] = [];
      if (msg && typeof msg === 'object' && msg.choiceLineText) {
        choiceLabels = sliceChoiceText(msg.choiceLineText, star.nbChoices);
      }
      const options = star.actionsIndex
        .map((_, i) => {
          const label = choiceLabels[i] || `Choice ${i + 1}`;
          return `<option value="${i + 1}"${result.choice === i + 1 ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        })
        .join('');
      html += `<div class="dungeon-choices">Choice: <select class="dungeon-choice-select" data-star-index="${starIndex}">${options}</select></div>`;
    }

    html += '<div class="dungeon-actions"><strong>Action chain:</strong><ol>';
    if (result.steps.length === 0) {
      html += '<li>(no active action — chain is inert)</li>';
    }
    for (const step of result.steps) {
      const paramText = Object.entries(step.effect.values)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      const flag = step.effect.unverifiedFor ? ' <span class="dungeon-unverified" title="Not disassembly-confirmed for this game — see scripting-engine.md §5/§6.3">⚠ unverified</span>' : '';
      html += `<li>#${step.actionIndex}: <strong>${escapeHtml(step.effect.name)}</strong>${paramText ? ` (${escapeHtml(paramText)})` : ''}${flag}</li>`;
    }
    if (result.nextStarIndex !== null) {
      html += `<li>→ goto star #${result.nextStarIndex}</li>`;
    }
    html += '</ol></div>';

    return html;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
