/**
 * localStorage-backed save/load for the Phantasie runtime (docs/
 * implementation.md §A6). The save is a single JSON document under a fixed
 * key; helpers below build the per-scene location documents and merge the
 * per-dungeon one-use deactivation tables.
 */

import { DEFAULT_GAME, DEFAULT_PLATFORM } from '../../game-id.ts';
import { SAVE_VERSION, isSaveState, type SaveLocation, type SaveState } from '../GameStateSchema.ts';
import type { PartyState } from '../PartyState.ts';

const SAVE_KEY = 'phantasie-save';

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function saveGame(state: SaveState): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save game', e);
  }
}

export function loadGame(): SaveState | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isSaveState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearGame(): void {
  storage()?.removeItem(SAVE_KEY);
}

/** Save the party + an overworld/town location (no per-dungeon deactivation to touch). */
export function savePartyLocation(party: PartyState, location: SaveLocation): void {
  const prev = loadGame();
  saveGame({
    version: SAVE_VERSION,
    gameId: DEFAULT_GAME,
    platformId: DEFAULT_PLATFORM,
    party,
    location,
    deactivatedStars: prev?.deactivatedStars ?? {},
    deactivatedActions: prev?.deactivatedActions ?? {},
  });
}

/** Save the party + a dungeon location, merging this dungeon's deactivation into the existing tables. */
export function saveDungeonLocation(
  party: PartyState,
  dungeonName: string,
  returnTo: { x: number; y: number },
  position: { x: number; y: number },
  deactivatedStars: number[],
  deactivatedActions: number[],
): void {
  const prev = loadGame();
  const stars = { ...(prev?.deactivatedStars ?? {}) };
  const actions = { ...(prev?.deactivatedActions ?? {}) };
  stars[dungeonName] = deactivatedStars;
  actions[dungeonName] = deactivatedActions;
  saveGame({
    version: SAVE_VERSION,
    gameId: DEFAULT_GAME,
    platformId: DEFAULT_PLATFORM,
    party,
    location: { kind: 'dungeon', dungeonName, x: position.x, y: position.y, returnTo },
    deactivatedStars: stars,
    deactivatedActions: actions,
  });
}
