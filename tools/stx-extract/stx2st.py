#!/usr/bin/env python3
"""
Minimal Pasti .STX -> raw .ST (sequential FAT12 floppy image) converter.

One-time archaeology tool for unblocking Phantasie II (Atari ST) — see
docs/phantasie/stx-extraction.md for the full writeup. Not part of the
TypeScript pipeline (tools/ elsewhere in this repo); deliberately kept
narrow ("desectorize an STX into a standard image mtools can read"), not a
general STX/Pasti library.

Implements the byte-level structure from "Pasti File Documentation"
(Jean Louis-Guerin / DrCoolZic, v0.5 Jan 2014):
  http://info-coach.fr/atari/documents/_mydoc/Pasti-documentation.pdf
(an open emulator/preservation file-format spec, not game content).

Usage:
    python3 stx2st.py input.stx output.st

Then read output.st with mtools, e.g.:
    MTOOLS_SKIP_CHECK=1 mdir -i output.st -/ ::
    MTOOLS_SKIP_CHECK=1 mcopy -i output.st -m -n "::*" destdir/

(MTOOLS_SKIP_CHECK is needed because mtools double-checks the BPB media
byte against the first FAT byte and is fussy about non-MS-DOS-branded
media descriptors on an otherwise perfectly standard Atari ST FAT12 image;
this project's disks decode to a self-consistent BPB, see the doc.)

Scope/limitations:
- Assumes a single sector size per disk and a uniform sector count per
  track (true for these two commercial, non-cracked disks; a heavily
  copy-protected disk with per-track sector-count variation would need
  more care).
- Does not implement the fuzzy-bit randomization formula (Sec 2.2.3 of the
  spec) — a flagged fuzzy sector's stored bytes are used as-is. Only
  relevant to sectors used as copy-protection checks, not real file data;
  see the doc for the one fuzzy sector found in this project's two disks
  and why it doesn't affect any extracted file.
- Sector descriptors with the RNF (record not found / no data) flag are
  zero-filled and reported; none were seen in these two disks.
"""
import struct
import sys


def parse_stx(data: bytes):
    magic, version, tool, reserved1, track_count, revision, reserved2 = \
        struct.unpack_from('<4sHHHBBI', data, 0)
    assert magic == b'RSY\x00', f'bad magic {magic!r}'
    print(f'version={version} tool={tool:#x} trackCount={track_count} revision={revision}')

    tracks = {}  # (side, track_num) -> dict(sectors={number: bytes}, ...)
    off = 16
    for _ in range(track_count):
        rec_start = off
        recordSize, fuzzyCount, sectorCount, trackFlags, trackLength, trackNumber, trackType = \
            struct.unpack_from('<IIHHHBB', data, off)
        p = off + 16
        side = (trackNumber >> 7) & 1
        tnum = trackNumber & 0x7F

        sector_descs = []
        if trackFlags & 0x01:  # TRK_SECT: sector descriptors present
            for _s in range(sectorCount):
                dataOffset, bitPosition, readTime = struct.unpack_from('<IHH', data, p)
                trk, head, number, size, crc = struct.unpack_from('<BBBBH', data, p + 8)
                fdcFlags, _resv = struct.unpack_from('<BB', data, p + 14)
                sector_descs.append(dict(dataOffset=dataOffset, number=number,
                                          size=size, fdcFlags=fdcFlags))
                p += 16

        p += fuzzyCount  # fuzzy mask record (not applied, see module docstring)
        track_data_start = p  # sector dataOffsets are relative to here

        sectors = {}
        fuzzy_flag_count = 0
        rnf_count = 0
        for sd in sector_descs:
            sec_size = 128 << (sd['size'] & 3)
            file_off = track_data_start + sd['dataOffset']
            if sd['fdcFlags'] & 0x10:  # RNF - no data block
                rnf_count += 1
                continue
            if sd['fdcFlags'] & 0x80:
                fuzzy_flag_count += 1
            sec_bytes = data[file_off:file_off + sec_size]
            if len(sec_bytes) != sec_size:
                raise ValueError(f'truncated sector read at track {tnum} side {side} '
                                  f'sector {sd["number"]}: got {len(sec_bytes)} want {sec_size}')
            sectors[sd['number']] = sec_bytes

        tracks[(side, tnum)] = dict(sectors=sectors, sectorCount=sectorCount,
                                     rnf_count=rnf_count, fuzzy_flag_count=fuzzy_flag_count,
                                     has_image=bool(trackFlags & 0x40))
        off = rec_start + recordSize

    return tracks, off


def build_raw_image(tracks):
    # Drop trailing stub track records (sectorCount==0: imaging tool probed
    # past the formatted area, e.g. tracks 80/81 on an 80-track SS disk).
    real = {k: v for k, v in tracks.items() if v['sectorCount'] > 0}
    empty = sorted(k for k, v in tracks.items() if v['sectorCount'] == 0)
    if empty:
        print(f'ignoring {len(empty)} empty/unformatted stub track record(s): {empty}')

    max_track = max(t for (_h, t) in real.keys())
    heads = sorted(set(h for (h, _t) in real.keys()))
    sector_sizes = {len(sb) for v in real.values() for sb in v['sectors'].values()}
    if len(sector_sizes) > 1:
        print(f'WARNING: mixed sector sizes seen: {sector_sizes}', file=sys.stderr)
    sec_size = sorted(sector_sizes)[0] if sector_sizes else 512
    n_sectors = max(v['sectorCount'] for v in real.values())
    print(f'max_track={max_track} heads={heads} sectorSize={sec_size} '
          f'sectorsPerTrack(max)={n_sectors}')

    out = bytearray()
    missing = []
    for t in range(max_track + 1):
        for h in heads:
            v = real.get((h, t))
            if v is None:
                missing.append((t, h, 'no track record'))
                out += bytes(sec_size * n_sectors)
                continue
            for s in range(1, n_sectors + 1):
                b = v['sectors'].get(s)
                if b is None:
                    missing.append((t, h, f'sector {s} missing'))
                    b = bytes(sec_size)
                out += b
    return bytes(out), missing


def main():
    if len(sys.argv) != 3:
        print(f'usage: {sys.argv[0]} in.stx out.st', file=sys.stderr)
        sys.exit(1)
    in_path, out_path = sys.argv[1], sys.argv[2]
    data = open(in_path, 'rb').read()
    tracks, end_off = parse_stx(data)
    print(f'parsed {len(tracks)} track records, consumed {end_off}/{len(data)} bytes '
          f'({len(data) - end_off} trailing bytes)')

    total_rnf = sum(v['rnf_count'] for v in tracks.values())
    total_fuzzy = sum(v['fuzzy_flag_count'] for v in tracks.values())
    total_img = sum(1 for v in tracks.values() if v['has_image'])
    print(f'RNF (missing) sectors: {total_rnf}; fuzzy-flagged sectors: {total_fuzzy}; '
          f'tracks with embedded track-image: {total_img}/{len(tracks)}')

    raw, missing = build_raw_image(tracks)
    if missing:
        print(f'WARNING: {len(missing)} missing sector(s), zero-filled:', file=sys.stderr)
        for m in missing[:20]:
            print(f'  {m}', file=sys.stderr)
    with open(out_path, 'wb') as f:
        f.write(raw)
    print(f'wrote {out_path}: {len(raw)} bytes')


if __name__ == '__main__':
    main()
