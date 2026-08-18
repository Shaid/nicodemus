/**
 * Browser-side loader for the preprocessed data-table assets produced by
 * `tools/phantasieiii/build-data-tables.ts` (races / skills / items /
 * spells / monsters / shop markups). These are plain JSON fetches from
 * `/assets/<game>/<platform>/` — the runtime never touches the original
 * game binaries (architecture-overview.md §1).
 */

import type { MonsterRecord } from '../assets/formats/monster-data.ts';
import type { GameId, PlatformId } from '../game-id.ts';

export interface RaceData {
  index: number;
  name: string;
  bankFile: string;
  cellIndex: number;
}

export interface SkillRow {
  skill: string;
  class: string;
  levels: number[];
}

export interface ItemData {
  index: number;
  name: string;
  pointValue: number;
  attributesRequired: number;
  basePrice: number;
}

export interface SpellData {
  index: number;
  name: string;
}

export interface ShopMarkupRow {
  armoury: number;
  markupPercent: number;
}

export interface GameData {
  races: RaceData[];
  skills: SkillRow[];
  items: ItemData[];
  spells: SpellData[];
  monsters: MonsterRecord[];
  shopMarkups: ShopMarkupRow[];
}

/** The six P3 classes, in the skill-table order (`P3_SKILL_CLASS_ORDER`). */
export function classNames(data: GameData): string[] {
  return [...new Set(data.skills.map((s) => s.class))];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function loadGameData(game: GameId, platform: PlatformId): Promise<GameData> {
  const base = `/assets/${game}/${platform}`;
  const [races, skills, items, spells, monsters, shopMarkups] = await Promise.all([
    fetchJson<RaceData[]>(`${base}/races.json`),
    fetchJson<SkillRow[]>(`${base}/skills.json`),
    fetchJson<ItemData[]>(`${base}/items.json`),
    fetchJson<SpellData[]>(`${base}/spells.json`),
    fetchJson<MonsterRecord[]>(`${base}/monsters.json`),
    fetchJson<ShopMarkupRow[]>(`${base}/shop-markups.json`),
  ]);
  return { races, skills, items, spells, monsters, shopMarkups };
}
