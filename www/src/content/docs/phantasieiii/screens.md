---
title: Extracted Screens
description: Phantasie III's full-canvas art — the title screen, the world-map picture, and the small UI icon sheets — all real decoded output, not illustrations.
---

Assets are served from `/assets/phantasieiii/amiga/` — one PNG per source
`Graphics/*.cmp`/`*.csh`/`.set` file, each decoded by this project's own
RLE and bitplane decoders (see [Graphics
Formats](/phantasieiii/graphics/)). These 7 images are full 320×200
pictures (0 sprite frames each) rather than sprite-bank grids — see [Sprite
Galleries](/phantasieiii/sprites/) for the monster/race banks.

## Title screen

![Phantasie III title screen](/assets/phantasieiii/amiga/title.png)

`title.cmp`, RLE type 2 (vertical interleave). Decodes to the actual title
screen: "PHANTASIE III / THE WRATH OF NIKADEMUS / BY WINSTON DOUGLAS WOOD /
AMIGA VERSION BY WESTWOOD / © 1987 SSI", fully legible on a decorative
border, with an archer illustration.

## World map

![Phantasie III world map picture](/assets/phantasieiii/amiga/phantasy.png)

`phantasy.set`'s picture region (35,840-byte file, uncompressed —
[Graphics Formats](/phantasieiii/graphics/) has the full header layout).
This is the terrain-art strip the game's overworld-map cell values index
into, not a conventional single scenic view — left to right it's water,
a city/castle skyline, mountains, hills, forest, and more water. Getting
this to render correctly required fixing a real column-block byte-order
bug — see Graphics Formats for the story.

## UI and icon sheets

Four small `.CSH` sheets, each using only a corner of the fixed 320×200
canvas — consistent with their role as UI icon sheets rather than full
pictures:

## Dialog buttons

![Phantasie III dialog buttons](/assets/phantasieiii/amiga/dlgbttns.png)

`dlgbttns.cmp` — the one file in the corpus using RLE type 1 (horizontal
interleave) rather than type 2.

## Anatomy sheets

![Phantasie III anatomy sheet 1](/assets/phantasieiii/amiga/anatomy1.png)

![Phantasie III anatomy sheet 2](/assets/phantasieiii/amiga/anatomy2.png)

`anatomy1.csh`/`anatomy2.csh` — small icon sprites scattered near the
top-left of the canvas.

## Dungeon/terrain UI

![Phantasie III dungeon UI sheet](/assets/phantasieiii/amiga/dng.png)

`dng.csh`.

## Scroll UI

![Phantasie III scroll UI graphic](/assets/phantasieiii/amiga/scroll.png)

`scroll.csh`.

---

See [Sprite Galleries](/phantasieiii/sprites/) for the 7 monster/race
sprite banks, and [Graphics Formats](/phantasieiii/graphics/) for exactly
how each of these decodes from its source file.
