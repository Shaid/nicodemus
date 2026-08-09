// Per-game asset curation for Phantasie (I), Amiga. See scripts/build.mjs's
// docblock for how this module is consumed (one of these per game under
// scripts/games/, each independently editable with no shared-state races).

export const id = 'phantasie';
/** Series order: Phantasie (1985), Phantasie II (1986), Phantasie III (1987). */
export const order = 1;

// The full public/assets/phantasie tree is already curated pipeline output
// (rendered PNGs + their JSON manifests, no raw per-file dumps) rather than
// a much larger raw extraction, so a whole-tree copy is appropriate here --
// unlike a project with megabytes of unused per-level debug dumps, nothing
// under this tree wasn't deliberately produced for display.
export const assetFiles = [];

// One favicon for the whole site: the first game module (by `order`) that
// configures one wins -- see scripts/build.mjs. Phantasie is order 1, so
// this is the one actually used.
export const favicon = {
	frame: '0-SKELETON',
	atlasDir: 'amiga',
	manifest: 'mstr1.json',
};
