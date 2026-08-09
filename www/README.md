# Phantasie — Data Formats Site

An Astro + [Starlight](https://starlight.astro.build) docs site covering all
three games in the Phantasie reverse-engineering project (Phantasie,
Phantasie II, Phantasie III). Each game gets its own section: curated,
human-readable pages alongside searchable galleries of that game's extracted
sprite atlases, self-contained enough to deploy on its own (see
`.github/workflows/deploy.yml`).

## Getting started

```bash
npm install
npm run dev
```

`npm run dev`/`npm run build`/`npm run start` all run `node scripts/build.mjs`
first, which does three things for every game (see the comment at the top of
that file):

1. copies each game's curated slice of `<repo-root>/public/assets/<game>`
   into this site's own `public/assets/<game>`;
2. regenerates `public/favicon.png` from whichever game module configures one
   (see "Pointing the favicon at a real sprite" below);
3. regenerates `generated/sidebar.mjs` by concatenating every game's own
   `src/content/docs/<game>/_sidebar.json` into one array of top-level groups.

## One module per game — the whole point of this structure

`scripts/build.mjs` doesn't hardcode a game list. It discovers every module
under `scripts/games/*.mjs` at build time (see `scripts/games/phantasie.mjs`
for the shape: `id`, `order`, `assetFiles`, an optional
`extend(files, assetSrc)` for data-driven additions, an optional `favicon`).
**Adding or editing a game touches exactly that one file, plus that game's
own `src/content/docs/<id>/` directory — never `scripts/build.mjs` itself.**
This is deliberate: it lets each game's section be built out independently
with zero merge conflicts on shared infrastructure. If you find yourself
editing `build.mjs`'s loop logic to special-case one game, that logic
probably belongs in that game's own module instead.

## The asset-copy-and-fallback convention

For each game, `scripts/build.mjs` prefers the repo's live
`public/assets/<game>` (the output of the extraction pipeline) when it
exists, and falls back to whatever is already committed under this site's own
`public/assets/<game>` when it doesn't. **Commit the site's copy of
`public/assets/<game>` even though the raw extraction output usually isn't
committed at the repo root** — CI checks out this repo alone, never the
original copyrighted game files, so it has no way to regenerate the assets
from scratch. Committing the site's mirror is what lets CI build and deploy
without ever touching the original data.

When a game's repo-root extracted assets change (re-run
`npx tsx tools/extract-game-data.ts --game all --platform all` at the repo
root first), re-run `npm run dev` or `npm run build` here to refresh its
mirror, then commit whatever changed under that game's `public/assets/<game>`.

By default every game module's `assetFiles` is `[]`, which mirrors that
game's *entire* `public/assets/<game>` tree — appropriate here since this
project's extracted output is already curated pipeline output (rendered
PNGs and their manifests), not a much larger raw dump. If a game's
extraction ever grows debug-only output no page renders, list explicit
relative paths in that module's `assetFiles` instead (files or whole
subdirectories) so the site's asset mirror doesn't balloon with content
nobody asked to publish.

## Adding a new game

1. Create `scripts/games/<id>.mjs` (copy `phantasie.mjs`'s shape) with that
   game's `order` and `assetFiles`.
2. Create `src/content/docs/<id>/` with at least a home page (`index.mdx`,
   slug `<id>`, not `<id>/index`) and a `_sidebar.json` (see any existing
   game's for the shape — a top-level `{ "label", "items": [...] }` group).
3. Re-run the dev server or build — assets get copied and the sidebar
   regenerated automatically; never hand-edit `generated/sidebar.mjs`.

### Docs-only sections

A module can also declare a section that has **no extraction output of its
own** by exporting `docsOnly = true` — `scripts/build.mjs` then skips the
asset-copy step for it entirely. `scripts/games/formats.mjs` is the one that
exists here: the cross-game shared-format reference (bitplanes/palette, and
the dungeon/scripting engine Phantasie I and II share byte-for-byte), whose
pages describe formats more than one game has in common rather than any one
game's own assets.

This is deliberately not the same thing as an empty `assetFiles` list. The
build *throws* when a game has neither live extraction output nor a
committed mirror, because that means the extraction failed — `docsOnly` says
there was never anything to copy, so that check doesn't apply.

## Adding a new curated page to an existing game

1. Add a `.md` or `.mdx` file under `src/content/docs/<id>/`.
2. Add a matching sidebar entry to `src/content/docs/<id>/_sidebar.json` —
   either a top-level `{ "label", "slug" }` entry, or nested inside a group's
   `"items"` array. Slugs are content file paths under `src/content/docs/`.
3. Re-run the dev server or build.

That covers the wiring. For **what a page should actually contain** — the page
types and their skeletons, how claims should be evidenced, gallery patterns, and
the pre-publish checklist — see [`WRITING-GUIDE.md`](./WRITING-GUIDE.md).

## `SpriteGallery`

`src/components/SpriteGallery.astro` renders a searchable grid from a
packed-frames sprite atlas — the same `{ frames: [{ name, x, y, w, h }],
width, height }` shape this project's own pipeline already writes (e.g.
`public/assets/phantasie/amiga/mstr1.json`). Given `manifest="mstr1"` and
`assetPath="phantasie/amiga"`, it reads
`public/assets/phantasie/amiga/mstr1.json` and `.png` — `assetPath` is the
*complete* directory containing them, so if a game's atlases live in a
subfolder, include that in `assetPath` too. This component has no opinion
on any one game's layout convention.

```mdx
import SpriteGallery from '../../../components/SpriteGallery.astro';

<SpriteGallery
  manifest="mstr1"
  assetPath="phantasie/amiga"
  label="monster"
  labels={new Map([['0-SKELETON', { visible: 'Skeleton' }]])}
/>
```

- `hoverPairs` — frame name → frame name. Cards for the first frame swap to
  the second on hover (e.g. a dim/activated icon pair). Omit entirely if the
  manifest has none.
- `clickChains` — frame name → ordered list of frame names. The card starts
  on the first frame and advances one step per click (mouse or
  Enter/Space), latching on the last frame. Omit for no click behavior.
- `labels` — a `Map<frameName, { visible, hover? }>` built by the *calling
  page*, however it wants (a game's `entities.json`/`races.json`, whatever
  the game's own name data actually looks like). The component has no
  built-in knowledge of any name-lookup file format — it only ever calls
  `labels.get(frame.name)` and falls back to the raw frame name.

`SpriteGallery`'s plain and hover-swap cards already carry the `data-lightbox`
attribute `Lightbox` (below) looks for — add `<Lightbox />` once to any page
using `SpriteGallery` and cards become click-to-enlarge automatically, no
further wiring needed.

## `Lightbox`

`src/components/Lightbox.astro` is a click-to-enlarge modal. Drop it once per
page (not once per gallery — it renders a single modal with a fixed id):

```mdx
import Lightbox from '../../../components/Lightbox.astro';

<Lightbox />
```

Any element anywhere on that page with a `data-lightbox` attribute becomes
clickable — opens a full-screen modal with an enlarged view, closes on
Escape, the close button, or a click outside the image. Two trigger shapes
are auto-detected (see `src/scripts/lightbox.js`'s docblock):

- `<img data-lightbox>` — enlarges that image's own `src`.
- Any other element with `data-lightbox` and an inline CSS
  `background-image`/`background-position`/`background-size` (the exact
  pattern `SpriteGallery` uses to crop one frame from a shared atlas) —
  enlarges that specific crop, scaled up, rather than the whole atlas.

Add an optional `data-lightbox-label="..."` for a caption. Because it uses
event delegation on `document`, it works for elements added, or shown/hidden
by a search filter, after the page loads — no re-init needed when a
gallery's own content changes.

## `GameCardGrid`

`src/components/GameCardGrid.astro` is the root splash page's "pick a game"
grid — one full-bleed hero-image card per game, linking to that game's home
page. Used once, on `src/content/docs/index.mdx`; game sections don't need
it.

## Pointing the favicon at a real sprite

`scripts/build.mjs` uses the first game module (by `order`) that exports a
`favicon` config — `{ frame, atlasDir, manifest }`, a frame name from a
packed-frames manifest (e.g. `atlasDir: 'amiga'`, `manifest: 'mstr1.json'`).
Currently that's `scripts/games/phantasie.mjs`, using its `0-SKELETON`
monster-bank frame as the site favicon. Point a different game's module at
its own atlas (and give it a lower `order`, or remove `phantasie.mjs`'s
`favicon` export) to change it.

## Known gotchas (multi-agent build sessions)

- **MDX parser bug: a standalone comment line directly before an
  object/array-literal `export const` breaks the build.** `export const A =
  {x: 1};\n\n// comment\nexport const B = {y: 2};` fails to parse
  (`Could not parse expression with acorn`) — only when the second export's
  value is an object or array-of-objects literal. Fix: move the comment
  inline on the opening-bracket line, or fold it into surrounding Markdown
  prose. Astro build errors from this only report `line:col`, not the
  file, and the position drifts as sibling content files change — bisect
  with `@mdx-js/mdx`'s `compile()` directly against one file at a time if a
  build error has no filename.
- **A port collision between concurrent `astro dev`/`preview` processes
  looks exactly like a broken-asset bug.** If another process already holds
  the default port, yours silently binds the next one up — check
  `ps aux | grep astro` and your own command's actual startup log before
  debugging "my images/pages don't load".

## Deploying

`.github/workflows/deploy.yml` (at the repo root) builds and deploys this
site with [withastro/action](https://github.com/withastro/action) whenever
`main` is pushed. It's already wired to this site's directory — no changes
needed beyond enabling GitHub Pages for the repo.
