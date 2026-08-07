import { defineGameConfig } from '@seer-project/pipeline';
import { exportGameData as exportPhantasieGameData } from './tools/phantasie/export-game-data.ts';
import { buildAssets as buildPhantasieAssets } from './tools/phantasie/build-assets.ts';
import { exportGameData as exportPhantasieIIGameData } from './tools/phantasieii/export-game-data.ts';
import { buildAssets as buildPhantasieIIAssets } from './tools/phantasieii/build-assets.ts';
import { exportGameData as exportPhantasieIIIGameData } from './tools/phantasieiii/export-game-data.ts';
import { buildAssets as buildPhantasieIIIAssets } from './tools/phantasieiii/build-assets.ts';

// This file mirrors tools/shared/game-config.ts for reference — the
// pipeline actually reads the narrowed-type version in that file. Keep
// both in sync when adding a game/platform.
export default defineGameConfig([
  {
    id: 'phantasie',
    displayName: 'Phantasie',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['phantasie/amiga'],
      executable: 'game',
      expectedFiles: ['game', 'run', 'mstr1.pat', 'party1.pat'],
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
      dataDirs: ['phantasieii/atarist/extracted/disk1'],
      executable: 'PHANT.PRG',
      expectedFiles: ['PHANT.PRG', 'MSTR1.PAT', 'PARTY1.PAT', 'PARTY2.PAT'],
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
      supported: true,
      assetDir: 'phantasieiii',
      features: {},
      exportGameData: exportPhantasieIIIGameData,
      buildAssets: buildPhantasieIIIAssets,
    }],
  },
]);
