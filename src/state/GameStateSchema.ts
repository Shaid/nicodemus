/**
 * The serializable shape of a saved game (docs/implementation.md §A6).
 * Everything here is plain JSON: the party is already pure data
 * (`CharacterState`/`PartyState` hold arrays/numbers/strings, no functions
 * or Sets), and the location is a tagged union the boot/resume path
 * reconstructs into a scene.
 *
 * One-use star/action deactivation is persisted per dungeon so a reloaded
 * dungeon doesn't re-fire its one-shot events.
 */

import type { PartyState } from './PartyState.ts';

export const SAVE_VERSION = 1;

export type SaveLocation =
  | { kind: 'overworld'; x: number; y: number }
  | { kind: 'town'; x: number; y: number; name: string }
  | { kind: 'dungeon'; dungeonName: string; x: number; y: number; returnTo: { x: number; y: number } };

export interface SaveState {
  version: number;
  gameId: string;
  platformId: string;
  party: PartyState;
  location: SaveLocation;
  /** Deactivated one-use star slot indices, keyed by dungeon asset name. */
  deactivatedStars: Record<string, number[]>;
  /** Deactivated one-use action slot indices, keyed by dungeon asset name. */
  deactivatedActions: Record<string, number[]>;
}

export function isSaveState(value: unknown): value is SaveState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== SAVE_VERSION) return false;
  if (typeof v.gameId !== 'string' || typeof v.platformId !== 'string') return false;
  const party = v.party as Record<string, unknown> | undefined;
  if (!party || !Array.isArray(party.members) || typeof party.gold !== 'number' || !Array.isArray(party.items)) {
    return false;
  }
  const loc = v.location as Record<string, unknown> | undefined;
  if (!loc || typeof loc.kind !== 'string') return false;
  return true;
}
