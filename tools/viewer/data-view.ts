/**
 * "Data" tab: a lightweight, read-only browser for the decoded JSON tables
 * each game's `build-data-tables.ts` writes to
 * `public/assets/<game>/<platform>/` (monster/race/item/spell/skill
 * tables — everything the pipeline decodes that isn't an image atlas, so it
 * doesn't appear in `manifest.json` at all). Pick a table on the left, see a
 * searchable table on the right. No editing, no sorting — just enough to
 * make decoded content actually inspectable.
 *
 * Unlike the upstream template this was ported from, these tables sit at
 * the platform root rather than a `data/` subdirectory — `buildAssets()`'s
 * `mkdirSync(resolve(outDir, 'data'))` in `tools/phantasieiii/build-assets.ts`
 * creates that subdirectory, but no build step actually writes into it, so
 * `assetBase` here points at the platform root instead.
 *
 * Ported from the `@seer-project/create-seer-app` scaffold's
 * `data-view.ts.eta` template (`docs/viewer.md` in the `seer` repo) — that
 * template itself is the promoted, generalized form of a pattern this
 * project's sibling `ceres` (Final Fantasy VI) built first and `valkyrie`
 * (Valkyrie Profile) independently rebuilt second; nicodemus is the third
 * real consumer, adopting the already-canonical version rather than
 * hand-porting either sibling's copy. `DATA_SOURCES_BY_GAME` is the only
 * project-specific part — everything else is generic.
 */
import { setHidden } from './shared.ts';

type RowKind = 'records' | 'strings';

interface DataSource {
  key: string;
  label: string;
  file: string;
  kind: RowKind;
}

const DATA_SOURCES_BY_GAME: Record<string, DataSource[]> = {
  phantasie: [
    { key: 'monsters', label: 'Monsters', file: 'monsters.json', kind: 'records' },
    { key: 'races', label: 'Races', file: 'races.json', kind: 'records' },
    { key: 'items', label: 'Items', file: 'items.json', kind: 'records' },
  ],
  phantasieii: [
    { key: 'monsters', label: 'Monsters', file: 'monsters.json', kind: 'records' },
    { key: 'races', label: 'Races', file: 'races.json', kind: 'records' },
    { key: 'items', label: 'Items', file: 'items.json', kind: 'records' },
  ],
  phantasieiii: [
    { key: 'monsters', label: 'Monsters', file: 'monsters.json', kind: 'records' },
    { key: 'races', label: 'Races', file: 'races.json', kind: 'records' },
    { key: 'items', label: 'Items', file: 'items.json', kind: 'records' },
    { key: 'shop-markups', label: 'Shop Markups', file: 'shop-markups.json', kind: 'records' },
    { key: 'spells', label: 'Spells', file: 'spells.json', kind: 'records' },
    { key: 'skills', label: 'Skills', file: 'skills.json', kind: 'records' },
  ],
};

/** One renderable table: column headers + string-formatted rows (row[i] aligns with columns[i]). */
interface TableData {
  columns: string[];
  rows: string[][];
}

const listEl = document.getElementById('data-list')!;
const listMetaEl = document.getElementById('data-list-meta')!;
const searchEl = document.getElementById('data-search') as HTMLInputElement;
const dataView = document.getElementById('data-view')!;
const dataTitleEl = document.getElementById('data-title')!;
const dataMetaEl = document.getElementById('data-meta')!;
const dataRowSearchEl = document.getElementById('data-row-search') as HTMLInputElement;
const dataTableWrap = document.getElementById('data-table-wrap')!;

let active = false;
let assetBase = '';
let sources: DataSource[] = [];
let selected: DataSource | null = null;
let currentTable: TableData | null = null;
const jsonCache = new Map<string, unknown>();

async function loadJSON(file: string): Promise<unknown | null> {
  const key = `${assetBase}/${file}`;
  if (jsonCache.has(key)) return jsonCache.get(key)!;
  try {
    const res = await fetch(key);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    jsonCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function toTable(source: DataSource, data: unknown): TableData | null {
  if (data === null || data === undefined) return null;

  if (source.kind === 'records') {
    const records = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
    if (records.length === 0) return { columns: [], rows: [] };
    const columns = ['#', ...Object.keys(records[0] ?? {})];
    const rows = records.map((rec, i) => [String(i), ...Object.keys(records[0] ?? {}).map((k) => fmt(rec[k]))]);
    return { columns, rows };
  }

  if (source.kind === 'strings' && Array.isArray(data)) {
    const items = data as unknown[];
    return { columns: ['#', 'Value'], rows: items.map((v, i) => [String(i), fmt(v)]) };
  }

  return null;
}

function renderSourceList(): void {
  const q = searchEl.value.trim().toLowerCase();
  const filtered = q ? sources.filter((s) => s.label.toLowerCase().includes(q) || s.key.includes(q)) : sources;

  listMetaEl.textContent = `${filtered.length} of ${sources.length} tables`;
  listEl.innerHTML = '';
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'no-results';
    empty.textContent = sources.length === 0 ? 'No decoded data tables for this game yet.' : 'No matching tables.';
    listEl.appendChild(empty);
    return;
  }

  for (const s of filtered) {
    const item = document.createElement('div');
    item.className = 'item';
    if (selected === s) item.classList.add('selected');
    item.innerHTML = `<span class="item-label">${s.label}</span>`;
    item.addEventListener('click', () => void selectSource(s));
    listEl.appendChild(item);
  }
}

async function selectSource(source: DataSource): Promise<void> {
  selected = source;
  renderSourceList();
  dataTitleEl.textContent = source.label;
  dataMetaEl.textContent = 'Loading…';
  dataTableWrap.innerHTML = '';

  const data = await loadJSON(source.file);
  currentTable = toTable(source, data);
  renderTable();
}

function renderTable(): void {
  if (!currentTable) {
    dataMetaEl.textContent = '';
    dataTableWrap.innerHTML =
      '<div class="state-panel"><span class="state-icon">⚠</span><span class="state-title">Failed to load table</span></div>';
    return;
  }

  const q = dataRowSearchEl.value.trim().toLowerCase();
  const rows = q ? currentTable.rows.filter((r) => r.some((cell) => cell.toLowerCase().includes(q))) : currentTable.rows;

  dataMetaEl.textContent = q ? `${rows.length} of ${currentTable.rows.length} rows` : `${currentTable.rows.length} rows`;

  const table = document.createElement('table');
  table.className = 'data-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of currentTable.columns) {
    const th = document.createElement('th');
    th.textContent = col;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  dataTableWrap.innerHTML = '';
  dataTableWrap.appendChild(table);
}

searchEl.addEventListener('input', renderSourceList);
dataRowSearchEl.addEventListener('input', renderTable);

export function isDataTabActive(): boolean {
  return active;
}

export function setDataTabActive(next: boolean): void {
  active = next;
  setHidden(dataView, !active);
  if (active) renderSourceList();
}

export function renderDataList(): void {
  renderSourceList();
}

/** Called whenever the main viewer's game/platform selection changes -- resets the table list to whatever this game has, and clears any stale loaded table. */
export function setDataAssetBase(base: string, game: string): void {
  assetBase = base;
  sources = DATA_SOURCES_BY_GAME[game] ?? [];
  selected = null;
  currentTable = null;
  dataTitleEl.textContent = 'No table selected';
  dataMetaEl.textContent = '';
  dataTableWrap.innerHTML = '';
  if (active) renderSourceList();
}
