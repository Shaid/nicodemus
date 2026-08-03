# Upstream seer sync — outstanding items

Tracks capability added to the shared `~/Development/seer` packages/scaffold
that this project has not yet adopted. Not urgent, but worth knowing about
before independently re-solving a problem seer has already solved generically.

## `create-seer` scaffold viewer generalization (not yet adopted)

The `tools/viewer/` template this project was scaffolded from has since
gained, upstream: data-driven game/platform selectors (from a build-emitted
`games.json`, not hardcoded HTML), asset-type filter tabs derived from the
manifest rather than a fixed union, animation autoplay, and a generic
indexed-texture + palette WebGL2 shader with a live palette editor and
color-cycling control (built on a new `cyclePalette()` utility in
`@seer/core`). See `seer/docs/viewer.md` for the full writeup.

This project's own `tools/viewer/` predates that work and has diverged from
the scaffold in its own direction — it already has a real game/platform
selector (`#game-select`/`#platform-select`, populated from `GAME_IDS`/
`GAME_DISPLAY_NAMES`/`GAME_PLATFORMS`), but those are hardcoded constants
rather than derived from a build-emitted `games.json`, and it has no
palette-cycling or animation-autoplay equivalent yet. Adopting the new
pattern (or not) is an open decision, not started.

## `AtlasMeta` consolidation (done, this session)

Was previously redeclared locally in both `src/data/GameData.ts` and
`tools/viewer/shared.ts`, and the former had a stale, incompatible
uniform-grid shape that nothing in this project actually used. Both files
now import the canonical `AtlasMeta`/`AtlasFrame` from `@seer/core` instead.
See `@seer/core`'s `packages/core/src/atlas.ts`.
