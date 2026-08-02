import {
  defineGameConfig,
  flattenConfigs,
  resolveDataDir,
  findFileCI,
  resType,
  getGameConfig as _getGameConfig,
  getSupportedPlatforms as _getSupportedPlatforms,
  type GameConfig as BaseGameConfig,
  type PlatformConfig as BasePlatformConfig,
} from '@seer/pipeline';
import {
  GAME_IDS,
  PLATFORM_IDS,
  DEFAULT_GAME,
  DEFAULT_PLATFORM,
  type GameId,
  type PlatformId,
} from '../../src/game-id.ts';

export { GAME_IDS, PLATFORM_IDS, DEFAULT_GAME, DEFAULT_PLATFORM, flattenConfigs, resolveDataDir, findFileCI, resType };
export type { GameId, PlatformId };

export interface PlatformConfig extends Omit<BasePlatformConfig, "platform"> {
  platform: PlatformId;
}

export interface GameConfig extends Omit<BaseGameConfig, "id" | "platforms"> {
  id: GameId;
  platforms: PlatformConfig[];
}

export const GAME_CONFIGS: GameConfig[] = defineGameConfig([
  {
    id: 'phantasie',
    displayName: 'Phantasie',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['phantasie/amiga'],
      // 'game' is the loadseg()-able HUNK executable holding the monster/
      // race/palette tables (see docs/phantasie/data-tables.md §1).
      executable: 'game',
      expectedFiles: ['game', 'run', 'mstr1.pat', 'party1.pat'],
      // No exportGameData/buildAssets yet — formats are documented
      // (docs/phantasie/graphics-formats.md, data-tables.md,
      // dungeon-format.md, scripting-engine.md) but not implemented.
      supported: false,
      assetDir: 'phantasie',
      features: {},
    }],
  },
  {
    id: 'phantasieii',
    displayName: 'Phantasie II',
    platforms: [{
      platform: 'atarist',
      dataDirs: ['phantasieii/atarist'],
      // No individual game files yet: data/ only has raw Pasti .STX floppy
      // images, not extracted. See docs/phantasie/implementation-plan.md
      // "Phantasie II blocker" before wiring up discovery here.
      executable: undefined,
      expectedFiles: [],
      supported: false,
      assetDir: 'phantasieii',
      features: {},
    }],
  },
  {
    id: 'phantasieiii',
    displayName: 'Phantasie III',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['phantasieiii/amiga'],
      executable: 'PhantasieIII',
      expectedFiles: ['PhantasieIII', 'monsinfo.dat', 'inititem.dat'],
      supported: false,
      assetDir: 'phantasieiii',
      features: {},
    }],
  },
]);

export const GAME_PLATFORMS = flattenConfigs(GAME_CONFIGS);

export function getGameConfig(game: GameId, platform: PlatformId): PlatformConfig | undefined {
  return _getGameConfig(GAME_PLATFORMS, game, platform) as PlatformConfig | undefined;
}

export function getSupportedPlatforms(game: GameId): PlatformId[] {
  return _getSupportedPlatforms(GAME_PLATFORMS, game) as PlatformId[];
}
