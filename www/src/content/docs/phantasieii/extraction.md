---
title: .stx Extraction — Pasti Disk-Image Desectorizing
description: How this project turned two Pasti .stx Atari ST floppy images into 59 individual Phantasie II files, and which of them are pristine vs. save-mutated.
---

Phantasie II's entire dataset started as two **Pasti (`.stx`) container
images** — `Phantasie II (Disk 1 of 2).stx` (883,088 bytes) and
`Phantasie II (Disk 2 of 2).stx` (883,970 bytes) — a low-level floppy-image
format built for the Pasti/Steem SSE Atari ST emulator project, preserving
track/sector layout well enough to reproduce copy-protected disks. No
`.stx`/Pasti reader was available in this project's environment (`mtools`
was present but FAT12-only; `hxcfe`, `hatari`, `steem`, and every Python
STX/Pasti package checked were absent), so this project wrote its own.

> **Both source disks turned out to be standard, non-cracked commercial
> floppies.** The `.stx` container exists to preserve copy protection, but
> these two carry only one incidental weak-bit check that lands outside any
> file's actual data — confirmed below, not assumed going in.

## Container structure

The byte layout came from the public Pasti specification ("Pasti File
Documentation", Jean Louis-Guérin/DrCoolZic, v0.5) and was implemented from
scratch in `tools/stx-extract/stx2st.py` (~150 lines).

**File Descriptor (16 bytes, offset 0):**

```
+0x00  4  pastiFileId    "RSY\0" on both disks
+0x04  2  version        3
+0x06  2  tool           0x0001 (Atari imaging tool)
+0x0A  1  trackCount     82
+0x0B  1  revision       2
```

Followed by 82 Track records (a 16-byte descriptor, then — since every
real track sets the `TRK_SECT` flag — one 16-byte Sector Descriptor per
sector, then a Track Data record carrying the actual bytes).

Confirmed against both disks:

- **80 of the 82 track records carry real data**; tracks 80-81 are stub
  probes (`sectorCount = 0`) past the end of a standard 80-track disk, and
  are dropped.
- **Every real track is single-sided** (`trackNumber` bit 7 always clear) —
  80 tracks × 9 sectors × 512 bytes = 368,640 bytes per disk, a standard
  Atari ST SS/DD GEMDOS floppy. This is also why a two-disk release was
  needed rather than one double-sided disk.
- **Zero RNF (missing-sector) flags** on either disk.
- **Exactly one fuzzy-bit-flagged sector**, Disk 2 only: track 76, sector 4.
  Its bytes are a classic weak-bit protection pattern (long `0xFF`/`0x00`
  runs). A byte-level search confirmed this 32-byte window does **not**
  appear inside any of the 47 files extracted from Disk 2 — it falls in an
  unallocated FAT12 cluster used purely as a protection check, not inside
  real file data.

## Method

1. `stx2st.py` parses the container, reconstructs a flat 80×9×512-byte raw
   `.ST` image, and reports RNF/fuzzy/track-image counts (zero-filling
   anything genuinely missing — nothing was, on either disk).
2. System `mtools` (`mdir`/`mcopy`, `MTOOLS_SKIP_CHECK=1` to bypass a media-
   descriptor-byte check mtools applies to non-DOS-branded images) reads the
   resulting `.ST` image directly as FAT12 and copies every file out.

```
python3 tools/stx-extract/stx2st.py "Phantasie II (Disk 1 of 2).stx" disk1.st
MTOOLS_SKIP_CHECK=1 mcopy -i disk1.st -m -n "::*" extracted/disk1/
```

## Verification

Structural self-consistency, an independent cross-check, and an external
byte-exact oracle — not just "mtools didn't error":

- The reconstructed boot sector's BPB is internally self-consistent (512
  bytes/sector, 720 total sectors = exactly 80×9, 1 head) — and that
  **1 head** independently matches the single-sidedness already derived
  from the `.stx` track records themselves, two unrelated sources agreeing.
- `mdir`'s reported byte totals match `mcopy`'s extracted totals exactly:
  Disk 1 — **12 files, 348,477 bytes**; Disk 2 — **47 files, 332,507
  bytes**.
- `PHANT.PRG` (present on both disks) starts with bytes `60 1A` — the
  canonical GEMDOS `.PRG` header magic, an external invariant with no
  dependency on the desectorization being "close enough."

## File inventory

### Disk 1 (12 files, 348,477 bytes)

| File | Size | GEMDOS date |
|------|-----:|-------------|
| `COVER1.PIC` | 32,000 | 1985-11-20 |
| `START.PRG` | 2,567 | 1986-11-28 |
| `PHANT.PRG` | 155,785 | 1985-11-20 |
| `MSTR1.PAT` | 76,832 | 1986-11-28 |
| `PARTY1.PAT` | 8,192 | 1986-11-28 |
| `PARTY2.PAT` | 8,192 | 1986-11-28 |
| `UTILIT2.PRG` | 16,327 | 1985-11-20 |
| `COVER2.PIC` | 21,600 | 1986-12-11 |
| `DESKTOP.INF` | 478 | 1985-11-20 |
| `MAPS.INT` | 8,840 | 1986-11-28 |
| `TWNS.INT` | 13,900 | 1986-11-28 |
| `BACKUP.RSC` | 3,764 | 1986-11-28 |

### Disk 2 (47 files, 332,507 bytes)

The dungeon/message pairs and graphics carry the pristine **1986-12-11**
date. The 24 files marked *(1995 save)* below carry a much later
**1995-10-06** timestamp — see [the save-vs-pristine finding](#disk-2-carries-in-progress-save-data-not-a-pristine-template)
below.

| File | Size | Note |
|------|-----:|------|
| `SCROLLS.DTX` | 16,384 | pristine, 1986 |
| `PHANT.RSC` | 16,008 | pristine, 1986 |
| `OUT.RSC` | 19,652 | pristine, 1986 |
| `DNG1`-`DNG8` | 2,048 each | pristine, 1986 |
| `MESS1`-`MESS8` | 2,176-3,898 | pristine, 1986 |
| `MSTR2.PAT` | 76,832 | pristine, 1986 |
| `CROWD.PIC`, `DECOR.PIC`, `FINAL2.PIC`, `PELNOR.PIC` | 11,160 / 24,800 / 25,600 / 32,000 | pristine, 1986 |
| `OUT1`/`2`/`3`/`5`/`6`/`7`/`8`/`11`/`12`/`17`/`18`/`22`/`26`/`27`/`28`/`30`/`31`.DAT | 3,000 each (17 files) | *(1995 save)* |
| `TWNS.DAT` | 3,504 | *(1995 save)* |
| `GUILD.DAT` | 7,950 | *(1995 save)* |
| `SACK.DAT` | 120 | *(1995 save)* |
| `DNG.SAV` | 1,024 | *(1995 save)* |
| `DNGX.SAV` | 2,500 | *(1995 save)* |
| `PHANT2.BAC` | 1,024 | 1987-04-22 (intermediate) |

## Disk 2 carries in-progress save data, not a pristine template

24 of Disk 2's 47 files carry a **1995-10-06** GEMDOS timestamp, sharply
later than every other file's **1986-11/12** date. This is the signature of
a played, in-place-saved game disk — Phantasie II appears to persist world
state by overwriting same-named files rather than using separate save
slots. Confirmed with direct byte-level evidence, strongest first:

- **`DNG.SAV`/`DNGX.SAV` are near-byte-identical copies of `DNG1`** — only
  10 of `DNGX.SAV`'s first 2,048 bytes differ (6 of `DNG.SAV`'s first
  1,024), and every differing byte matches a change the documented
  interpreter algorithm would produce during play: five grid cells changed
  from a fixed-encounter value to `0x8A` (the cell-ID range table's
  "unassigned, never observed" value — this find gives it a real runtime
  meaning: a resolved-encounter marker no pristine-file scan would ever
  see), one door cell flipped locked→unlockable, and one action byte
  matches the documented one-use-action deactivation convention exactly
  (`0x47`→`0x00`).
- **`OUT1.DAT` embeds a literal leaked file cache.** Past its shared
  boilerplate region, `OUT1.DAT` contains six 32-byte, GEMDOS-directory-
  entry-shaped records naming `DNG4`, `DNG5`, `DNG6`, `DNG7`, `DNG8`, and
  `OUT18.DAX` — real filenames from this exact disk. There is no reading of
  a pristine template under which it would legitimately embed a readable
  list of other game files' names.
- **10 of the 17 `OUT*.DAT` files share byte-identical, thematically
  unrelated leftover text** (`"ENDING SEQUENCE"`, `"...GE BUBBLING
  POOL"`) at the same file offset — the signature of a reused, uncleared
  save-routine buffer, not professionally mastered template content. The
  sparse numbering itself (17 files scattered across 1-31, vs. Phantasie
  I's near-complete contiguous 18-of-19) is a structural tell before any
  byte-level analysis: only outposts a specific playthrough actually
  visited got written.
- **`GUILD.DAT` contains player-chosen character names** (`PGLADE`,
  `PYOSHI`, `PKLEPTO`) — cannot be pristine content by definition.
- **`SACK.DAT` is entirely zero bytes** — an empty save-time inventory, not
  a real item catalogue.
- **`TWNS.DAT` is a genuinely different, smaller structure from `TWNS.INT`**
  (not an overwritten copy of it) — both share the identical 12-town name
  list, but `TWNS.INT` is ~4× larger, consistent with holding full per-town
  shop records while `TWNS.DAT` is a compact save-state snapshot.
  **`TWNS.INT` remains the trustworthy pristine template.**

**Resolved verdict: every 1995-dated file on Disk 2 is confirmed save-
mutated, not a second pristine template set.** For any future extraction
work, treat `TWNS.INT` (Disk 1) as the pristine per-town template, and
`OUT*.DAT` as the best *available* Phantasie II outpost data — but not
proven pristine, since which outposts appear depends on the playthrough
that produced this specific disk.

## Cross-reference against Phantasie I

A file-size-only comparison against Phantasie I's already-verified files —
useful context, not a decode:

| File | P1 (Amiga) | P2 (Atari ST) | Match? |
|---|---:|---:|---|
| `mstr1.pat`/`MSTR1.PAT` | 68,016 B | 76,832 B | No — P2 ~13% larger |
| `party1.pat`/`PARTY1.PAT` | 8,192 B | 8,192 B | Yes, byte-exact |
| Dungeon file count | 10 (`dng1`-`dng10`) | 8 (`DNG1`-`DNG8`) | P2 has fewer levels |
| Dungeon file size | 1,922-1,984 B (variable) | 2,048 B (uniform) | P2 is fixed-size and larger |

The `PARTY*.PAT` size match turned out to be a coincidence, not a layout
signal — see [.PAT Sprite Banks](../../phantasieii/graphics/) for why.

## The open bits

`MAPS.INT`/`TWNS.INT`'s full record structure and the `.RSC` GEM resource
files remain unexplored. The six `.PIC` full-screen pictures are now
decoded — see [Screens](../../phantasieii/screens/) — and [Status & Open
Work](../../phantasieii/status/) for everything still open.
