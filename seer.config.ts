import { defineGameConfig } from '@seer/pipeline';

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
      supported: false,
      assetDir: 'phantasie',
      features: {},
      // Register pipeline steps here once implemented:
      // exportGameData: (cfg, dataDir) => { ... },
      // buildAssets:    (cfg, dataDir) => { ... },
    }],
  },
  {
    id: 'phantasieii',
    displayName: 'Phantasie II',
    platforms: [{
      platform: 'atarist',
      dataDirs: ['phantasieii/atarist'],
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
