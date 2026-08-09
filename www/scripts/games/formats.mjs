// The cross-game shared-format reference section. See scripts/build.mjs's
// docblock for how this module is consumed.
//
// Not a game: Phantasie I, II and III share one bitplane/palette encoding
// foundation, and Phantasie I and II additionally share one byte-identical
// dungeon-grid + star/action/message scripting engine. Those get one set of
// pages rather than being re-described in each game's own section. It
// contributes a sidebar group and content pages only -- `docsOnly` tells
// build.mjs there is no extraction output to copy for it.

export const id = 'formats';
/** Last in the sidebar: this is a reference appendix the game sections link into. */
export const order = 99;
export const docsOnly = true;
export const assetFiles = [];
