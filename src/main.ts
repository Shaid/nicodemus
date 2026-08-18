/**
 * Entry point — boot the Phantasie runtime (docs/implementation.md §0/§A5):
 * load the preprocessed data tables, then hand a `PhantasieApp` the title
 * screen (Continue / New Game).
 */

import { loadGameData } from './data/GameDataLoader.ts';
import { PhantasieApp } from './app/PhantasieApp.ts';
import { TitleScene } from './app/TitleScene.ts';
import { DEFAULT_GAME, DEFAULT_PLATFORM } from './game-id.ts';

async function boot(): Promise<void> {
  const container = document.getElementById('game-container');
  if (!container) throw new Error('Missing #game-container element in index.html');

  const data = await loadGameData(DEFAULT_GAME, DEFAULT_PLATFORM);
  await PhantasieApp.create(container, new TitleScene(data));
}

boot().catch((e: unknown) => {
  console.error(e);
  const container = document.getElementById('game-container');
  if (container) container.textContent = `Failed to boot: ${String(e)}`;
});
