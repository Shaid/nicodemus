// Per-game asset curation for Phantasie II, Atari ST. See scripts/build.mjs's
// docblock for how this module is consumed (one of these per game under
// scripts/games/, each independently editable with no shared-state races).
//
// Phantasie II never shipped on the Amiga -- its data was extracted from two
// Pasti (.stx) Atari ST floppy images, desectorized by this project's own
// tools/stx-extract/stx2st.py. See the Extraction page for the method.

export const id = 'phantasieii';
export const order = 2;

// See phantasie.mjs's comment -- same whole-tree-copy rationale applies here.
export const assetFiles = [];

// No favicon export here: build.mjs uses the first (by `order`) game module
// that configures one, which is phantasie.mjs (order 1) -- see its comment.
