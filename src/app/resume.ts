/**
 * Rebuild the scene a saved game resumes into, and hydrate a saved party
 * into a live `PartyState` (filling defaults for any field a future/older
 * save might omit — the save format is v1, but defensive hydration keeps a
 * malformed member from crashing the runtime).
 */

import type { SaveState } from '../state/GameStateSchema.ts';
import type { GameData } from '../data/GameDataLoader.ts';
import { hydrateParty } from '../state/PartyState.ts';
import { OverworldScene } from '../overworld/OverworldScene.ts';
import { TownScene } from '../town/TownScene.ts';
import { DungeonScene } from '../dungeon/DungeonScene.ts';
import type { Scene } from './Scene.ts';

export function resumeScene(save: SaveState, data: GameData): Scene {
  const party = hydrateParty(save.party);
  const loc = save.location;
  switch (loc.kind) {
    case 'overworld':
      return new OverworldScene(party, data, { x: loc.x, y: loc.y });
    case 'town':
      return new TownScene(party, data, { x: loc.x, y: loc.y, name: loc.name });
    case 'dungeon':
      return new DungeonScene(party, data, loc.dungeonName, loc.returnTo, { x: loc.x, y: loc.y });
  }
}
