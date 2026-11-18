# Phantasie II (Atari ST) — `.stx` disk-image extraction

This document covers **Phase 0** of `implementation-plan.md`: turning the two
raw Pasti `.STX` floppy-disk images under
`data/phantasieii/atarist/phantasie_ii_ssi/` into individual files. It is
archaeology, not format reverse-engineering — nothing about the *internal*
Phantasie II file formats (dungeon grids, `.PAT` sprite layout, executable
tables) is decoded here. See `graphics-formats.md` §9, `data-tables.md` §2,
and `dungeon-format.md` §7 for the format hypotheses this work unblocks.

## 1. Source files

| File | Size |
|------|------|
| `Phantasie II (Disk 1 of 2).stx` | 883,088 bytes |
| `Phantasie II (Disk 2 of 2).stx` | 883,970 bytes |

Both are Pasti `.STX` container images (magic `"RSY\0"`), the format used by
the Pasti/Steem SSE Atari ST emulator project to preserve floppy disks
including their low-level track/sector layout (useful for copy-protected
disks; **confirmed not needed here** — see §3).

## 2. `.STX` container structure — confirmed against these two disks

No ready-made `.STX` reader was available in this environment (checked:
`mtools`/`mdir`/`mcopy` — present, but FAT12-only, no `.STX` support;
`hxcfe`, `hatari`, `steem`, any Python STX/Pasti package — none installed;
`pip` had nothing usable). `mtools` **was** available for the FAT12 half of
the problem, so the approach was: write a narrow `.STX` → raw `.ST`
desectorizer (Method §2 of the parent instructions'
preferred-order-of-approaches), then hand the result to `mtools`.

The container byte layout was taken from the primary Pasti specification
("Pasti File Documentation", Jean Louis-Guérin/DrCoolZic, v0.5 Jan 2014,
`http://info-coach.fr/atari/documents/_mydoc/Pasti-documentation.pdf` — an
open emulator/preservation file-format spec, not game content) and
implemented in `tools/stx-extract/stx2st.py`. Summary of the structures used:

**File Descriptor (16 bytes, offset 0):**

| Offset | Size | Field | Disk 1 value | Disk 2 value |
|--------|------|-------|---------------|---------------|
| 0x00 | 4 | `pastiFileId` | `"RSY\0"` | `"RSY\0"` |
| 0x04 | 2 | `version` | 3 | 3 |
| 0x06 | 2 | `tool` | 0x0001 (Atari imaging tool) | 0x0001 |
| 0x08 | 2 | `reserved_1` | 0 | 0 |
| 0x0A | 1 | `trackCount` | 82 | 82 |
| 0x0B | 1 | `revision` | 2 | 2 |
| 0x0C | 4 | `reserved_2` | 0 | 0 |

Followed by `trackCount` Track records, each: a 16-byte Track Descriptor
(`recordSize`, `fuzzyCount`, `sectorCount`, `trackFlags`, `trackLength`,
`trackNumber` [bit 7 = side, bits 6-0 = track], `trackType`), then — since
`trackFlags` has bit 0 (`TRK_SECT`) set on every non-stub track on both
disks — `sectorCount` 16-byte Sector Descriptors (`dataOffset`, `bitPosition`,
`readTime`, a 6-byte copy of the sector's address-block `id` [track, head,
number, size, crc], `fdcFlags`, reserved), then an optional fuzzy-mask
record (`fuzzyCount` bytes), then the Track Data record (a Track Image
header+content when `trackFlags` bit 6 is set, plus any Sector Images for
sectors whose data didn't match the Track Image verbatim).

**Confirmed for both disks:**

- 82 track records each, but **only 80 carry real data** (tracks 0-79);
  tracks 80 and 81 are stub records (`sectorCount = 0`, `trackFlags = 0x21`,
  16-byte record, no sector/track-data payload) — the imaging tool always
  probes past the end of a standard 80-track disk. These are correctly
  excluded from the reconstructed image (`stx2st.py` drops any
  `sectorCount == 0` track and derives the image geometry from the
  remainder).
- **Every real track has `trackNumber` bit 7 clear** — i.e. both disks are
  **single-sided** (`heads = [0]` only), 80 tracks × 9 sectors × 512 bytes =
  368,640 bytes each. This matches a standard Atari ST SS/DD GEMDOS floppy
  exactly, and explains why a 2-disk P2 release needed two disks rather than
  one double-sided one.
- `trackFlags = 0x61` on every real track (`TRK_SECT | TRK_PROT | TRK_IMAGE`)
  — every track carries an embedded Track Image in addition to its Sector
  Descriptors (80/82 tracks report `has_image` in the parser's summary
  output; the two stub tracks don't).
- **Zero RNF (record-not-found / missing sector) flags** on either disk —
  every sector descriptor resolved to real data.
- **Exactly one fuzzy-bit-flagged sector**, on Disk 2 only: track 76,
  sector 4 (`fdcFlags = 0x88`). Its stored bytes are a classic weak-bit
  copy-protection pattern (`ff ff 00 0f 00 00 00 0f ff ff ff ff 00 00 ff
  ff...` — long runs of `0xFF`/`0x00`). A byte-level search confirmed this
  32-byte window does **not** appear inside any of the 47 files extracted
  from Disk 2, meaning it falls in an unallocated/free FAT12 cluster used
  purely as a protection check, not inside any real file's data. **No
  extracted file is affected by the fuzzy sector.**
- No revision-0-only Macrodos/Speedlock intra-sector timing quirks were
  triggered (no `fdcFlags` bit 0 set on any sector); no Timing records
  present.

**Conclusion: these are standard, non-cracked commercial floppies with a
single incidental weak-bit protection check outside the filesystem's used
area** — exactly the "likely does NOT use exotic copy-protection" case the
task anticipated, confirmed rather than assumed.

## 3. Method

1. `tools/stx-extract/stx2st.py <in.stx> <out.st>` — parses the container per
   §2, reconstructs a flat, standard track-major/sector-minor single-sided
   raw image (`80 × 9 × 512` = 368,640 bytes), reporting RNF/fuzzy/track-image
   counts and zero-filling (with a warning) anything actually missing (none
   were, on either disk).
2. `mdir`/`mcopy` (system `mtools`, `MTOOLS_SKIP_CHECK=1` — mtools is picky
   about the `0xF8` "fixed disk" media-descriptor byte on a non-MS-DOS-branded
   image even though it's a completely standard value for double-density
   floppies) read the resulting `.ST` image directly as FAT12 and copy every
   file out.

```
python3 tools/stx-extract/stx2st.py \
  "data/phantasieii/atarist/phantasie_ii_ssi/Phantasie II (Disk 1 of 2).stx" \
  data/phantasieii/atarist/raw/disk1.st
MTOOLS_SKIP_CHECK=1 mcopy -i data/phantasieii/atarist/raw/disk1.st -m -n "::*" \
  data/phantasieii/atarist/extracted/disk1/
```
(and the same for disk 2). Intermediate raw `.ST` images are kept at
`data/phantasieii/atarist/raw/` (gitignored, like all of `data/`) for
reproducibility/debugging; the individually extracted files are the actual
deliverable, at `data/phantasieii/atarist/extracted/disk{1,2}/`.

## 4. Verification (ground truth, not just "mtools didn't error")

- **Boot sector BPB is internally self-consistent** on both reconstructed
  images: bytes/sector 512, sectors/cluster 2, reserved sectors 1, 2 FATs,
  112 root-dir entries, **720 total sectors** (= 80×9, matching the 368,640-byte
  image exactly), media descriptor `0xF8`, 5 sectors/FAT, 9 sectors/track,
  **1 head** (matches the single-sided reconstruction independently derived
  from the STX track records in §2 — two unrelated sources agreeing).
- **`mdir`'s reported byte totals match `mcopy`'s extracted-file totals
  exactly**: Disk 1 — 12 files, 348,477 bytes (both `mdir` and `du -sb` on
  the extracted directory agree); Disk 2 — 47 files, 332,507 bytes (same
  agreement).
- **FAT-walk and relocation checks (added 2026-11-13; the two checks above are
  weak — "`mdir` total = `du` total" is circular, and `60 1A` tests two bytes):**
  FAT1 equals FAT2 on both disks (re-walked this session from `raw/disk{1,2}.st`);
  all 59 files have exact `ceil(size/1024)` chain lengths ending `0xFFF`, with
  one exception — the `DNG.SAV`/`DNGX.SAV` cross-link (§6 correction); every
  extracted file is byte-identical to the walk (auditor's check); `PHANT.PRG`'s
  relocation table has 6,485 entries all pointing into text+data+bss and ends
  exactly at EOF (0 trailing bytes), likewise `START.PRG` and `UTILIT2.PRG`
  (auditor's check, not re-run here); the weak-bit sector (track 76 sector 4,
  LBA 687, cluster 336) has FAT entry 0 (free).
- **`PHANT.PRG` (only disk 1 carries a `.PRG`; the earlier "both disks list an executable" was wrong — disk 2 has none, 2026-11-13) starts with bytes `60 1A`**
  — the canonical GEMDOS `.PRG` header magic (a `bra.s` opcode used as the
  TOS program-header signature). This is an external, format-specific
  invariant with no dependency on the STX or FAT12 parsing being "close
  enough" — it's byte-exact confirmation that the desectorization and
  cluster-chain reconstruction recovered the executable's first bytes
  correctly.
- Every file in both directory listings has a plausible 1980s-era GEMDOS
  timestamp (see §6 for a caveat on a subset with much later timestamps).

This clears the verification bar: structural self-consistency (BPB) +
independent cross-check (STX side-count vs. BPB head-count) + an
external byte-exact magic-number oracle (`0x601A`), not just "no read
errors."

## 5. Full extracted file listing

### Disk 1 — `data/phantasieii/atarist/extracted/disk1/` (12 files, 348,477 bytes)

| File | Size (bytes) | GEMDOS date |
|------|--------------|-------------|
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

### Disk 2 — `data/phantasieii/atarist/extracted/disk2/` (47 files, 332,507 bytes)

| File | Size (bytes) | GEMDOS date |
|------|--------------|-------------|
| `SCROLLS.DTX` | 16,384 | 1986-12-11 |
| `PHANT.RSC` | 16,008 | 1986-12-11 |
| `OUT.RSC` | 19,652 | 1986-12-11 |
| `DNG1` | 2,048 | 1986-12-11 |
| `DNG2` | 2,048 | 1986-12-11 |
| `DNG3` | 2,048 | 1986-12-11 |
| `DNG4` | 2,048 | 1986-12-11 |
| `DNG5` | 2,048 | 1986-12-11 |
| `DNG6` | 2,048 | 1986-12-11 |
| `DNG7` | 2,048 | 1986-12-11 |
| `DNG8` | 2,048 | 1986-12-11 |
| `MESS1` | 3,816 | 1986-12-11 |
| `MESS2` | 2,176 | 1986-12-11 |
| `MESS3` | 2,422 | 1986-12-11 |
| `MESS4` | 3,584 | 1986-12-11 |
| `MESS5` | 3,078 | 1986-12-11 |
| `MESS6` | 3,816 | 1986-12-11 |
| `MESS7` | 3,775 | 1986-12-11 |
| `MESS8` | 3,898 | 1986-12-11 |
| `MSTR2.PAT` | 76,832 | 1986-12-11 |
| `CROWD.PIC` | 11,160 | 1986-12-11 |
| `DECOR.PIC` | 24,800 | 1986-12-11 |
| `FINAL2.PIC` | 25,600 | 1986-12-11 |
| `PELNOR.PIC` | 32,000 | 1986-12-11 |
| `OUT1.DAT` | 3,000 | 1995-10-06 |
| `OUT2.DAT` | 3,000 | 1995-10-06 |
| `OUT3.DAT` | 3,000 | 1995-10-06 |
| `OUT5.DAT` | 3,000 | 1995-10-06 |
| `OUT6.DAT` | 3,000 | 1995-10-06 |
| `OUT7.DAT` | 3,000 | 1995-10-06 |
| `OUT8.DAT` | 3,000 | 1995-10-06 |
| `OUT11.DAT` | 3,000 | 1995-10-06 |
| `OUT12.DAT` | 3,000 | 1995-10-06 |
| `OUT17.DAT` | 3,000 | 1995-10-06 |
| `OUT18.DAT` | 3,000 | 1995-10-06 |
| `OUT22.DAT` | 3,000 | 1995-10-06 |
| `OUT26.DAT` | 3,000 | 1995-10-06 |
| `OUT27.DAT` | 3,000 | 1995-10-06 |
| `OUT28.DAT` | 3,000 | 1995-10-06 |
| `OUT30.DAT` | 3,000 | 1995-10-06 |
| `OUT31.DAT` | 3,000 | 1995-10-06 |
| `TWNS.DAT` | 3,504 | 1995-10-06 |
| `GUILD.DAT` | 7,950 | 1995-10-06 |
| `SACK.DAT` | 120 | 1995-10-06 |
| `DNG.SAV` | 1,024 | 1995-10-06 |
| `DNGX.SAV` | 2,500 | 1995-10-06 |
| `PHANT2.BAC` | 1,024 | 1987-04-22 |

## 6. Caveat: this disk 2 carries in-progress save data, not a pristine template

24 of Disk 2's 47 files (`OUT1.DAT`...`OUT31.DAT`, `TWNS.DAT`, `GUILD.DAT`,
`SACK.DAT`, `DNG.SAV`, `DNGX.SAV`) carry a **1995-10-06** GEMDOS timestamp,
sharply later than the **1986-11/12** dates on every other file on both
disks (`PHANT2.BAC` is a third, intermediate date — 1987-04-22). This is the
signature of a **played, in-place-saved game disk**, not an as-shipped
master: Phantasie II appears to persist per-location/world state by
overwriting same-named files rather than using separate save slots (`OUT1.DAT`
etc. line up with P1's `out*.dat` per-outpost files, `TWNS.DAT` with P1's
`twns.int`, and `DNG.SAV`/`DNGX.SAV`/`PHANT2.BAC` are unambiguous
save/backup files by name). Per the pitfalls library's
`save-file-not-asset.md`: **when later work decodes these formats, treat
the numbered `OUT*.DAT`/`TWNS.DAT`/`GUILD.DAT`/`SACK.DAT` files as live
player save state, not guaranteed-pristine shipped template data** — their
content may reflect a specific playthrough rather than the game's original
world data. `OUT.RSC` (1986-12-11, disk2) and `TWNS.INT` (1986-11-28, disk1)
by contrast carry the original 1986 dates and are more likely to be the
pristine shipped data/resource equivalents, if such a split exists in P2's
file layout the way it seems to for P1.

> **Correction — confirmed, not just suspected, with byte-level evidence.**
> A follow-up pass (per `TODO.md`'s `p2-save-vs-template`) directly compared
> the 1995-dated files against the shared P1/P2 dungeon-format decode
> (`dungeon-format.md` §3/§7) and against disk 1's 1986-dated equivalents.
> Findings, from strongest to weakest evidence:
>
> - > **Correction (2026-11-13, independent FAT12 walk, re-verified this session):
>   `DNG.SAV` and `DNGX.SAV` are a FAT cross-link, not two corroborating
>   copies.** Both directory entries start at cluster **333**, chain
>   `[333, 334, 335]` (end `0xFFF`). `DNG.SAV` is 1,024 B but owns a 3-cluster
>   chain, and its 1,024 bytes are exactly `DNGX.SAV[0:1024]` (checked
>   `a == b[:1024]`). So the pair is **one** piece of evidence, not two, and
>   `DNG.SAV`'s original content is lost. The "differ in 6 / differ in 10"
>   comparison below therefore compares one buffer against `DNG1` twice. The
>   same walk: FAT1 == FAT2 on both disks; every other file's chain length
>   matches `ceil(size/1024)` with a `0xFFF` terminator. (`DNGX.SAV` is 2,500 B
>   = `0x9C4`, matching the audit's cited P1 DNG_MAP buffer size — corroborating
>   only; the `#$9C4` literal itself is not found in `game.asm` and stays unverified.)
> - **`DNG.SAV` (1024 B) and `DNGX.SAV` (2500 B) are near-byte-identical
>   copies of `DNG1`** (the level-0 dungeon file), not independent content:
>   `DNGX.SAV`'s first 2048 bytes differ from `DNG1` in only **10 of 2048
>   bytes** (`DNG.SAV`'s first 1024 bytes differ in only 6), with the
>   remaining 452 bytes of `DNGX.SAV` being trailing zero padding
>   (`2048 + 452 = 2500`). Every differing byte is exactly the kind of
>   change the documented interpreter algorithm (`scripting-engine.md` §4)
>   would produce during play: five grid cells changed from a fixed-encounter
>   value (`0x80`/`0x81`/`0x83`) to `0x8A` — the value `dungeon-format.md`
>   §4 lists as "**Unassigned** ... never observed in real data" in the
>   *reference tool's* static analysis, which only ever examined pristine
>   template files; this find gives `0x8A` a concrete runtime meaning
>   instead — very plausibly a "fixed encounter, already resolved" marker
>   written back into the grid after the fight is won, which is exactly why
>   a parser that only reads unplayed templates would never see it. One
>   door cell changed `0xC6`→`0xC7` (locked → unlockable), and four action-
>   table bytes changed (`0xC6`×3 + `0x47` → `0x80`×3 + `0x00`) — the
>   `0x47`→`0x00` change matches the documented one-use action
>   deactivation convention byte-for-byte (`scripting-engine.md` §2: "the
>   inactive sentinel for actions is `0x00`"). **This is conclusive: these
>   two files are live in-memory dungeon state, not templates or distinct
>   game content.**
> - **`TWNS.DAT` (3,504 B, 1995) is a genuinely different, smaller
>   structure from `TWNS.INT` (13,900 B, 1986, disk 1) — not an overwritten
>   copy of it.** Both files contain the identical 12-town name list
>   (`PIPPACOTT, HASLEMERE, SAXLINGHAM, LLITHFAEN, IPSWICH, FERRON, BLACK
>   MOOR, DEATHPORT, DEMONIAC, DARK ABYSS, STARVILLE, OLYMPIA`) plus
>   `FIRE_ELEM`/`WATER_ELEM`/`EARTH_ELEM`, but `TWNS.INT` is ~4× larger,
>   consistent with holding full per-town records (shop inventories,
>   prices — the P1 `twns.int` shape, `dungeon-format.md` §8.1) while
>   `TWNS.DAT` is a compact save-state snapshot referencing the same towns
>   by name. **`TWNS.INT` remains a trustworthy pristine template**, not
>   touched or shadowed by the save file of the same content family.
> - **`GUILD.DAT` (7,950 B, 1995) contains player-chosen character names**
>   (`PGLADE`, `PYOSHI`, `PKLEPTO` — a `P`-prefixed roster, plausibly "party
>   member" slots) alongside guild/monster-family strings (`FIRE_ELEM`,
>   `WATER_ELEM`, `EARTH_ELEM`, `ORCISH`, `FATHER JO`). Player-chosen names
>   cannot be pristine shipped content by definition — **confirmed
>   playthrough-specific data.**
> - **`SACK.DAT` (120 B, 1995) is entirely zero bytes** — an empty
>   player inventory container, not a data table (a real item catalogue
>   would not be all-zero). Consistent with save-state (a near-empty
>   inventory at save time), not template data.
> - **`OUT1.DAT`/`OUT2.DAT` (1995) structurally match the P1 `out*.dat`
>   shape** documented in `dungeon-format.md` §8.2 (leading tile-code grid,
>   POI text block with legible location descriptions like `"THE
>   ALBATROSS"`, `"THERE IS A SMALL ENCLOSED TOWN HERE"`) — no obvious
>   player-specific mutation signature was found (no player names, no
>   clearly-anomalous byte values), but disk 1 has no `OUT*.INT`/`OUT*.DAT`
>   template counterpart to byte-diff against directly, so this remains
>   **inconclusive by content** — the 1995 timestamp is the only evidence
>   either way for these specific files.
>
> **Correction (2026-11-13):** the OUT*.DAT "inconclusive by content" verdict
> is now settled: the first 520 bytes of **all 17** `OUT*.DAT` equal 17
> distinct 520-byte blocks of disk 1's `MAPS.INT` (8,840 = 17 × 520) byte for
> byte, 0 differences (1-byte-shifted null control: 0/17;
> `p2-disk-integrity.test.ts`). So the outdoor terrain grids are pristine
> despite the 1995 timestamps; any save mutation lives past byte 520.
>
> **Resolved verdict**: the 1995-dated files are confirmed live save-game
> state, not a second pristine template set — `DNG.SAV`/`DNGX.SAV`/
> `GUILD.DAT`/`SACK.DAT` by direct, conclusive byte-level evidence;
> `TWNS.DAT` by the structural-size argument; `OUT*.DAT` only by timestamp
> (unresolved by content). **For any future extraction work: treat
> `TWNS.INT` (disk 1) as the pristine per-town template, not `TWNS.DAT`;
> there is no known pristine counterpart for `GUILD.DAT`/`SACK.DAT`/
> `DNG.SAV`/`DNGX.SAV` (they are inherently save-only data types); and
> treat `OUT*.DAT`'s status as still open (best available P2 outpost data,
> but not proven pristine).** Closes `p2-save-vs-template` in `TODO.md`.
>
> **Follow-up pass — `OUT*.DAT` now conclusively resolved as save-mutated
> too (`p2-out-dat-save-status`), by direct byte-level evidence matching
> the same "smoking gun" standard already used for `DNG.SAV`/`DNGX.SAV`
> above.**
>
> Disk 2 carries 17 `OUT*.DAT` files, numbered `1, 2, 3, 5, 6, 7, 8, 11,
> 12, 17, 18, 22, 26, 27, 28, 30, 31` — a **sparse subset spanning 1-31
> with 14 numbers missing** inside that range. This is already a
> structural tell before any byte-level analysis: P1's `out*.dat` set is
> `1`-`19` with only a single gap (`17` absent, 18 of 19 files present) —
> a near-complete, contiguous distributed set. P2's set has nearly as many
> gaps as files present, consistent with "only outposts a specific
> playthrough actually visited get written," not a shipped template
> covering the whole map.
>
> Byte-level evidence is decisive. Diffing a fixed byte range
> (file `0x2f8`-`0x420`, past each file's own location-specific POI text)
> across all 17 files found it **byte-for-byte identical across 10 of
> them** (`OUT6`/`7`/`8`/`11`/`12`/`22`/`26`/`27`/`28`/`30`/`31`) —
> containing the same unrelated boilerplate text (`"ENDING SEQUENCE"`,
> `"...GE BUBBLING POOL"`, `"THERE IS A SMALL CATHEDRAL HERE"`, `"...AD TO
> HEAR THAT."`) regardless of what that file's own outpost actually is.
> Ten *unrelated* locations sharing byte-identical, thematically
> unrelated leftover text at the same offset is the signature of a
> **reused, uncleared in-memory buffer** written verbatim by a save
> routine across multiple files in one sitting — a professionally
> mastered template file would not bake unrelated "ending sequence"
> filler into ten different outpost records. Two further files
> (`OUT17.DAT`, `OUT18.DAT`) show the *same* region filled with a
> different, internally-consistent residue (`0x0D` repeated) instead —
> consistent with a second, distinct leftover-buffer state from a
> different point in the same session.
>
> **`OUT1.DAT` is conclusive on its own**, independent of the
> cross-file pattern above. Its version of this same trailing region
> (file `0x3f4` onward) contains, in order: the tail of the shared
> `"ENDING SEQUENCE"` residue, then six **32-byte, directory-entry-shaped
> records** — an 11-byte `8.3`-style filename/extension field followed by
> ~21 bytes of small binary values (consistent with a classic
> GEMDOS/FAT directory entry's attribute/date/time/cluster/size fields) —
> for `DNG4`, `DNG5`, `DNG6`, `DNG7`, `DNG8`, and `OUT18   DAX` (a real
> filename *with* an unfamiliar `.DAX` extension). `DNG4`-`DNG8` and
> `OUT18` are literal, real filenames from this exact disk's own dungeon/
> outpost set. There is no reading of a pristine, shipped template file
> under which it would legitimately embed a readable list of *other*
> game files' names in a location-description text field — this is
> unambiguously a **recently-accessed-file cache or open-file table from
> the running game**, serialized into `OUT1.DAT`'s save write. (Raw bytes,
> `data/phantasieii/atarist/extracted/disk2/OUT1.DAT+0x400`: `44 4e 47 34
> 20 20 20 20 20 20 20 00 00 00 00 00 00 00 00 00 00 00 70 10 52 0b 7d 01
> cd 06 00 00` = `"DNG4       "` + 21 trailer bytes, repeating at a
> uniform 32-byte stride through `+0x4c0`.)
>
> **Resolved verdict: `OUT*.DAT` is confirmed save-mutated, not pristine
> content** — the sparse/gapped numbering, the ten-file shared-garbage
> block, and `OUT1.DAT`'s embedded real filenames are three independent
> lines of evidence, the last one every bit as conclusive as the
> `DNG.SAV` five-cell finding above. **There is no known pristine P2
> counterpart for `OUT*.DAT`** (unlike `TWNS.INT`) — P1's `out*.dat` set
> (`data/phantasie/amiga/`) is the best available reference for the
> *format*, but not for P2's actual world content, since the outposts
> visited/unvisited differ per playthrough. Closes `p2-out-dat-save-status`
> in `TODO.md`.

> **Correction (2026-08-10) — two of the three claims above are wrong; the
> byte-level residue evidence is not.** See `dungeon-format.md` §8.6.
>
> - **There *is* a pristine counterpart, and it was sitting on disk 1 the
>   whole time: `MAPS.INT`.** It is exactly `17 × 520` bytes, and block `k`
>   is byte-identical to the `k`-th `OUT*.DAT`'s leading 520-byte terrain
>   grid — **17/17, zero mismatches**. The section grids in the shipped
>   `OUT*.DAT` files are therefore pristine, and `MAPS.INT` is the master
>   the `BACKUP` utility restores from, exactly as in Phantasie I (§8.3.1).
>   This pass missed it because `MAPS.INT` was filed as an unrelated
>   `TWNS.INT`-adjacent disk-1 file rather than as `OUT*.DAT`'s sibling.
> - **The sparse `1,2,3,5,6,7,8,11,12,17,18,22,26,27,28,30,31` numbering is
>   not a playthrough artefact.** `MAPS.INT` — shipped, never written by the
>   game — holds exactly those seventeen sections and no others, so
>   seventeen *is* the complete world. The engine's own section arithmetic
>   (`newSection = section − 4·dRow − dCol`, `PHANT.PRG` addr `0x66BA`) lays
>   them out on a 4-wide mosaic, and **every section edge facing one of the
>   15 absent slots is impassable ocean** (29 of 30 edges 100% ocean class).
>   The gaps are unreachable map, not unvisited outposts.
> - **What still stands:** the shared `"ENDING SEQUENCE"` block and
>   `OUT1.DAT`'s embedded GEMDOS directory entries really are save-write
>   residue. Both live in bytes the engine never reads back — the
>   995-1500 dead gap between the text block and the display list
>   (`OUT1.DAT`'s directory entries start at `0x400` = 1,024). So
>   "`OUT*.DAT` is written by the game" is correct; "therefore its world
>   content is playthrough-specific" does not follow.
>
> General lesson: *some* of a file provably being stale save residue does
> not make the whole file save state — check whether the region the format
> actually reads was disturbed, and look for a pristine sibling before
> concluding none exists.

## 7. Cross-reference against existing P1 hypotheses (facts only, no decode)

These are the two "does the size match" checks the parent task asked this
pass to report on. No internal byte-level decoding was performed — this is
purely file-level comparison against `data/phantasie/amiga/`'s already
verified P1 files, useful evidence for whoever picks up
`graphics-formats.md` §9 / `data-tables.md` §2 / `dungeon-format.md` §7 next.

| Comparison | P1 (Amiga) | P2 (Atari ST, this extraction) | Match? |
|---|---|---|---|
| `mstr1.pat`/`MSTR1.PAT` | 68,016 B | 76,832 B | **No** — P2 is ~13% larger |
| `mstr2.pat`/`MSTR2.PAT` | 68,016 B | 76,832 B | **No**, same delta as above |
| `party1.pat`/`PARTY1.PAT` | 8,192 B | 8,192 B | **Yes**, byte-exact |
| `party2.pat`/`PARTY2.PAT` | 8,192 B | 8,192 B | **Yes**, byte-exact |
| `MSTR1.PAT` vs `MSTR2.PAT` (P2 internal) | — | 76,832 B both | **Yes**, byte-exact with each other |
| Dungeon file count | 10 (`dng1`-`dng10`) | 8 (`DNG1`-`DNG8`) | P2 has fewer dungeon levels |
| Dungeon file size | 1,922-1,984 B (variable) | 2,048 B (uniform, all 8) | P2 is fixed-size, larger, and uniform |
| Message file count | 10 (`mess1`-`mess10`) | 8 (`MESS1`-`MESS8`) | Matches dungeon count 1:1 on both games |
| Message file sizes | 1,848-3,898 B | 2,176-3,898 B | Same rough range, overlapping values |

The `PARTY*.PAT` byte-exact match is notable alongside the `MSTR*.PAT`
mismatch: it's consistent with `graphics-formats.md` §9's hypothesis that P2
uses a **different** bitplane layout for `MSTR*.PAT` than P1 (ST
word-interleaved vs. Amiga contiguous-planar) while `PARTY*.PAT` might keep
the same layout/content as P1 — but this is still only a size-level
observation, not a pixel-level decode, and doesn't confirm *which* layout
either file actually uses. The dungeon file count dropping from 10 to 8 and
becoming a fixed 2048-byte size (vs. P1's variable ~1922-1984) is new
information not previously available to `dungeon-format.md` §7 — worth a
closer look when that format is decoded, since a fixed round-number size
suggests either a larger star/action-table capacity or padding not present
in P1's files.

## 8. What's still open

The following were resolved by a follow-up pass (per `implementation-plan.md`
Phase 7 / `TODO.md`):

- ~~Verifying `data-tables.md` §2's P2 executable-table offsets~~ —
  **confirmed byte-exact**, all five offsets. See `data-tables.md` §2.
- ~~Decoding `MSTR1.PAT`/`MSTR2.PAT`/`PARTY1.PAT`/`PARTY2.PAT` to confirm or
  refute the ST word-interleaved vs. Amiga planar layout hypothesis~~ —
  **confirmed ST word-interleaved** for all four files (both `MSTR*` and
  `PARTY*`, correcting the earlier size-match-based guess). See
  `graphics-formats.md` §9.
- ~~Decoding `DNG1`-`DNG8`/`MESS1`-`MESS8` against the shared P1/P2
  dungeon/message engine~~ — **confirmed**, zero decode failures across all
  16 files. See `dungeon-format.md` §7.
- ~~Save-vs-template question for disk 2's 1995-dated files~~ — **resolved
  with direct byte-level evidence**. See §6 above.

Still genuinely unexplored (out of scope for the pass that resolved the
above — no further evidence gathered):

- `MAPS.INT` (disk1, 8,840 bytes) and `TWNS.INT` (disk1, 13,900 bytes) are
  P2's likely equivalents of P1's `maps.int`/`twns.int` — sizes differ from
  P1's (`twns.int` is 13,000 B in P1 vs. 13,900 B here), unexplored. Note:
  §6's follow-up pass did confirm `TWNS.INT`'s town-name list content
  (byte-exact match with `TWNS.DAT`'s list) but not its full record
  structure.
- ~~`COVER1.PIC`/`COVER2.PIC`/`CROWD.PIC`/`DECOR.PIC`/`FINAL2.PIC`/`PELNOR.PIC`~~
  — **resolved (2026-08-09)**: confirmed as the ST word-Interleaved-by-2
  layout (like `.PAT`, not P1's contiguous-`Planar` `.pic`), each with a
  disassembly-traced palette source. See `graphics-formats.md` §10.
- `PHANT.RSC`/`OUT.RSC`/`BACKUP.RSC` — GEM resource files (dialog/menu
  definitions in the standard Atari ST `.RSC` format), not previously seen
  in this project; likely low-value for gameplay decoding but potentially
  useful for UI text strings.
- ~~`OUT*.DAT`'s save-vs-template status~~ — **resolved**, confirmed
  save-mutated (see §6's follow-up-pass bullet: sparse/gapped numbering,
  a ten-file shared-garbage block, and `OUT1.DAT`'s embedded real
  filenames from a runtime file cache).
