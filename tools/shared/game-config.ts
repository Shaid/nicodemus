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
import { exportGameData as exportPhantasieGameData } from '../phantasie/export-game-data.ts';
import { buildAssets as buildPhantasieAssets } from '../phantasie/build-assets.ts';
import { exportGameData as exportPhantasieIIGameData } from '../phantasieii/export-game-data.ts';
import { buildAssets as buildPhantasieIIAssets } from '../phantasieii/build-assets.ts';
import { exportGameData as exportPhantasieIIIGameData } from '../phantasieiii/export-game-data.ts';
import { buildAssets as buildPhantasieIIIAssets } from '../phantasieiii/build-assets.ts';

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
      // Phase 4 (graphics + data tables) is implemented: .pic pictures,
      // .pat sprite banks, and the confirmed monster/race/palette tables.
      // Dungeon/scripting (Phase 3) and world/town data (Phase 5) are not
      // — see docs/phantasie/implementation-plan.md.
      supported: true,
      assetDir: 'phantasie',
      features: {},
      exportGameData: exportPhantasieGameData,
      buildAssets: buildPhantasieAssets,
    }],
  },
  {
    id: 'phantasieii',
    displayName: 'Phantasie II',
    platforms: [{
      platform: 'atarist',
      // Disk 1 is the canonical source (implementation-plan.md Phase 7):
      // it holds PHANT.PRG plus MSTR1.PAT/PARTY1.PAT/PARTY2.PAT with
      // pristine 1986 timestamps. Disk 2 (about half of it confirmed live
      // save-game state — stx-extraction.md §6) is only consulted by
      // build-assets.ts for the one asset file that isn't on disk 1
      // (MSTR2.PAT, itself an untainted 1986-dated file).
      dataDirs: ['phantasieii/atarist/extracted/disk1'],
      // PHANT.PRG is the loadseg()-able Atari ST executable holding the
      // monster/race/palette tables (see docs/phantasie/data-tables.md §2).
      executable: 'PHANT.PRG',
      expectedFiles: ['PHANT.PRG', 'MSTR1.PAT', 'PARTY1.PAT', 'PARTY2.PAT'],
      // Phase 7 (graphics + data tables) is implemented: .PAT sprite banks
      // (ST word-Interleaved layout) and the confirmed monster/race/palette
      // tables. Dungeon/scripting (Phase 3) and .PIC full-screen pictures
      // (format never independently confirmed for P2) are not.
      supported: true,
      assetDir: 'phantasieii',
      features: {},
      exportGameData: exportPhantasieIIGameData,
      buildAssets: buildPhantasieIIAssets,
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
      // Phase 1 (graphics: .cmp/.csh/.set) and Phase 2 (monster + skills
      // data tables) are implemented. Dungeon/scripting (Phase 3) and the
      // race table / inititem.dat (§4/§6 open questions) are not — see
      // docs/phantasie/implementation-plan.md.
      supported: true,
      assetDir: 'phantasieiii',
      features: {},
      exportGameData: exportPhantasieIIIGameData,
      buildAssets: buildPhantasieIIIAssets,
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
