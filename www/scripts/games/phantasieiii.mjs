// Per-game asset curation for Phantasie III: The Wrath of Nikademus, Amiga.
// See scripts/build.mjs's docblock for how this module is consumed (one of
// these per game under scripts/games/, each independently editable with no
// shared-state races).

export const id = 'phantasieiii';
export const order = 3;

// See phantasie.mjs's comment -- same whole-tree-copy rationale applies here.
export const assetFiles = [];

// No favicon export here: build.mjs uses the first (by `order`) game module
// that configures one, which is phantasie.mjs (order 1) -- see its comment.
