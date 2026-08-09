// Build helper for the Phantasie docs site (three games, one site).
//
// Three jobs:
//   1. For every game module under scripts/games/*.mjs, copy that game's
//      curated slice of the repo's extracted assets (public/assets/<id>)
//      into this site's own public/, so the site is self-contained.
//   2. Generate public/favicon.png from a sprite atlas frame (see README.md
//      "Pointing the favicon at a real sprite") -- until configured, the
//      placeholder favicon.png this scaffold ships with is used as-is.
//   3. Generate the Starlight sidebar (generated/sidebar.mjs) by concatenating
//      every game's own src/content/docs/<id>/_sidebar.json into one array of
//      top-level groups.
//
// Adding a new game touches exactly one new file (scripts/games/<id>.mjs) plus
// that game's own src/content/docs/<id>/ directory -- never this file. See
// scripts/games/phantasie.mjs for the module shape (id/assetFiles/favicon).
//
// Locally, extracted assets are copied from the repo's public/assets
// directory. In CI, the committed www/public build assets are reused instead
// — CI never has the original copyrighted game files. Run with:
//   node scripts/build.mjs

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');
const gamesDir = join(root, 'scripts', 'games');

// --- 0. Load every game module ----------------------------------------------

const gameFiles = readdirSync(gamesDir)
	.filter((f) => f.endsWith('.mjs'))
	.sort();
const games = await Promise.all(gameFiles.map((f) => import(pathToFileURL(join(gamesDir, f)).href)));
if (games.length === 0) throw new Error(`No game modules found under ${gamesDir}`);

// Sidebar/display order is each module's own `order` (release order: I, II,
// III, then the shared-formats appendix last) -- modules without one sort
// after those that have it, alphabetically by id, so a new game module still
// gets a sane deterministic position without every other module needing an
// edit.
games.sort((a, b) => {
	if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
	if (a.order !== undefined) return -1;
	if (b.order !== undefined) return 1;
	return a.id.localeCompare(b.id);
});

// --- 1. Copy each game's curated assets -------------------------------------

mkdirSync(join(root, 'public', 'assets'), { recursive: true });
for (const game of games) {
	// A docs-only module (the shared-formats section) contributes a sidebar
	// group and content pages but has no extraction output of its own. That is
	// not the same as a game whose extraction failed, which is what the throw
	// at the bottom of this block is there to catch -- so skip the asset step
	// for these rather than teaching that check an exception.
	if (game.docsOnly) {
		console.log(`[${game.id}] Docs-only section -- no assets to copy.`);
		continue;
	}

	const assetSrc = join(repo, 'public', 'assets', game.id);
	const assetDst = join(root, 'public', 'assets', game.id);
	const assetFiles = game.extend ? game.extend([...game.assetFiles], assetSrc) : game.assetFiles;

	if (existsSync(assetSrc)) {
		rmSync(assetDst, { recursive: true, force: true });
		if (!assetFiles || assetFiles.length === 0) {
			cpSync(assetSrc, assetDst, { recursive: true });
			console.log(`[${game.id}] Copied assets: ${assetSrc} -> ${assetDst}`);
		} else {
			for (const rel of assetFiles) {
				const from = join(assetSrc, rel);
				const to = join(assetDst, rel);
				mkdirSync(dirname(to), { recursive: true });
				cpSync(from, to, { recursive: true });
			}
			console.log(`[${game.id}] Copied ${assetFiles.length} curated asset path(s) from ${assetSrc} -> ${assetDst}`);
		}
	} else if (existsSync(assetDst)) {
		console.log(`[${game.id}] Using committed site assets in ${assetDst}`);
	} else {
		throw new Error(`[${game.id}] Missing extracted assets and committed site assets: ${assetSrc}`);
	}
}

// --- 2. Generate favicon (optional until a game sets FAVICON_FRAME) ---------
//
// One favicon for the whole site (not per-game) -- the first game module (in
// sidebar order) that exports a `favicon` config wins. Add/change `favicon`
// in a game's own scripts/games/<id>.mjs to point the site's favicon at a
// different sprite.

const faviconGame = games.find((g) => g.favicon?.frame);
const faviconPath = join(root, 'public', 'favicon.png');
if (faviconGame) {
	const { frame, atlasDir, manifest } = faviconGame.favicon;
	const faviconAtlasDir = join(root, 'public', 'assets', faviconGame.id, atlasDir);
	const faviconManifestPath = join(faviconAtlasDir, manifest);
	if (existsSync(faviconManifestPath)) {
		const faviconResult = spawnSync(
			'node',
			[join(root, 'scripts', 'generate_favicon.mjs'), faviconAtlasDir, manifest, frame, faviconPath],
			{ stdio: 'inherit' },
		);
		if (faviconResult.status !== 0) throw new Error('Could not generate the favicon');
	} else if (existsSync(faviconPath)) {
		console.log(`Using existing favicon: ${faviconPath}`);
	} else {
		console.warn(`No ${faviconManifestPath} found and no public/favicon.png present — using the placeholder.`);
	}
} else if (existsSync(faviconPath)) {
	console.log(`Using existing favicon: ${faviconPath}`);
} else {
	console.warn(
		'No game module configures a favicon and no public/favicon.png present — see README.md "Pointing the favicon at a real sprite".',
	);
}

// --- 3. Generate the combined sidebar ----------------------------------------

const toSidebar = (entry) => {
	if (entry.items) {
		return {
			label: entry.label,
			items: entry.items.map(toSidebar),
		};
	}
	return { label: entry.label, slug: entry.slug };
};

const sidebarGroups = [];
for (const game of games) {
	const manifestPath = join(root, 'src', 'content', 'docs', game.id, '_sidebar.json');
	if (!existsSync(manifestPath)) {
		console.warn(`[${game.id}] No ${manifestPath} -- skipping this game's sidebar group.`);
		continue;
	}
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	sidebarGroups.push(...manifest.map(toSidebar));
}

const outDir = join(root, 'generated');
const outSidebar = join(outDir, 'sidebar.mjs');
mkdirSync(outDir, { recursive: true });
writeFileSync(
	outSidebar,
	`// Generated by scripts/build.mjs — do not edit by hand.\n` +
		`// Source: one src/content/docs/<game>/_sidebar.json per game module in scripts/games/.\n` +
		`export const sidebar = ${JSON.stringify(sidebarGroups, null, 2)};\n`,
);
console.log(`[sidebar] wrote ${outSidebar} (${sidebarGroups.length} top-level groups across ${games.length} game(s))`);
