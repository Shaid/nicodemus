# Phantasie
A Seer project for reverse-engineering the Phantasie RPG series into a
browser-playable implementation: Phantasie (Amiga), Phantasie II (Atari ST —
it never got an Amiga release), and Phantasie III (Amiga).

See [docs/phantasie/implementation-plan.md](docs/phantasie/implementation-plan.md)
for the current state of the reverse-engineering effort and the build-out plan.

## Documentation site

`www/` is an Astro + Starlight field guide covering all three games — a
curated, human-readable companion to the exhaustive research notes in
`docs/phantasie/`, with searchable sprite galleries built from the real
pipeline output. Run it locally:

```bash
cd www
npm install
npm run dev
```

It deploys itself via `.github/workflows/deploy.yml` (GitHub Pages) whenever
`main` is pushed. See `www/README.md` for how it's wired.

## Getting started

```bash
npm install
```

Place your original game files under `data/phantasie/amiga/`,
`data/phantasieii/atarist/`, and `data/phantasieiii/amiga/` as available
(these directories are gitignored — never commit original game data). Then:

```bash
npm run extract-data          # run the offline pipeline
npm run dev                   # start the dev server
```

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | TypeScript + Vite production build |
| `npm test` | Vitest test suite |
| `npm run lint` | ESLint |
| `npm run format` | Prettier auto-format |
| `npm run extract-data` | Full offline pipeline (export + build-assets) |
| `npm run build-assets` | Asset-build stage only |
| `npm run viewer` | Dev server opened straight at the asset viewer (`tools/viewer/`) — pick game/platform from the dropdowns, selection is shareable via URL (`?game=&platform=&asset=`). Phantasie I also lists a `world-map` entry: the assembled 77×126 overworld, pan/zoom, with point-of-interest markers |

## Project structure

```
src/                 Browser-side code
  main.ts            Entry point
  game-id.ts         Game/platform identifiers
  data/              Asset types and loader
tools/               Offline pipeline scripts
  shared/            Shared pipeline config
  phantasieiii/              Per-game export and build scripts
data/                Original game data (gitignored)
public/assets/       Built web assets (gitignored)
seer.config.ts       Pipeline configuration
```

## Learn more

- [Architecture overview](docs/architecture-overview.md) — how the project is structured
- [Boilerplate guide](docs/boilerplate-guide.md) — what's template vs. what you build

