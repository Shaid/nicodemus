/**
 * Stage 2 sub-step: expose Phantasie III's two music streams, `D/M0` and
 * `D/M1`, as browser-fetchable assets.
 *
 * See docs/phantasie/dungeon-format.md §9.0.2-§9.0.2.6 for the format, and
 * `src/assets/formats/music.ts` for the decoder. The **raw bytes** are what
 * ships: the decoder is pure, runs happily in the browser, and the whole
 * corpus is 1.6 kB, so there is nothing to gain from baking a decoded form
 * into JSON and plenty to lose (the viewer's player wants the byte offsets
 * anyway, and a re-decode is the cheapest possible regression check that
 * the shipped bytes are the ones the tests cover).
 *
 * A small sidecar `<name>.json` carries the decode summary so the manifest
 * and the asset list can describe a song without fetching and parsing it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeJson } from '@seer-project/pipeline';
import {
  P3_MUSIC_READ_LENGTHS,
  decodeMusic,
  renderMusicTimeline,
  MUSIC_WAVEFORM_NAMES,
} from '../../src/assets/formats/music.ts';
import type { ManifestEntry } from './build-assets.ts';

/** Filenames under `<dataDir>/D`, lowercase as they ship on the Amiga disk. */
const MUSIC_FILES = ['m0', 'm1'] as const;

export interface MusicAssetSummary {
  name: string;
  /** The byte count `PlayMusic()` reads; everything past it is `0x3E` padding. */
  readLength: number;
  /** Raw file size, padding included. */
  fileSize: number;
  /** Byte length of each of the three tracks, terminating `0xFF` included. */
  trackLengths: number[];
  /** Note events (rests included) per track. */
  noteCounts: number[];
  /** Playback length of one pass, in seconds at the driver's 60 Hz tick. */
  seconds: number;
  /** Instrument each track's header selects, by name. */
  waveforms: string[];
}

/**
 * Copy `D/m0` and `D/m1` into `<outDir>/music/` and write their decode
 * summaries. Returns the manifest entries for the songs that were found.
 */
export function buildMusicAssets(dataDir: string, outDir: string): ManifestEntry[] {
  const musicDir = resolve(dataDir, 'D');
  const musicOut = resolve(outDir, 'music');
  const entries: ManifestEntry[] = [];

  for (const name of MUSIC_FILES) {
    const path = resolve(musicDir, name);
    if (!existsSync(path)) continue;

    const data = new Uint8Array(readFileSync(path));
    const song = decodeMusic(data, name);
    const timeline = renderMusicTimeline(song);

    const summary: MusicAssetSummary = {
      name,
      readLength: P3_MUSIC_READ_LENGTHS[name],
      fileSize: data.length,
      trackLengths: song.tracks.map((t) => t.bytes.length),
      noteCounts: song.tracks.map((t) => t.events.filter((e) => e.kind === 'note').length),
      seconds: Number(timeline.seconds.toFixed(3)),
      waveforms: timeline.tracks.map(
        (t) => MUSIC_WAVEFORM_NAMES[t.notes[0]?.waveform ?? 0] ?? 'unknown',
      ),
    };

    mkdirSync(musicOut, { recursive: true });
    writeFileSync(resolve(musicOut, `${name}.bin`), data);
    writeJson(resolve(musicOut, `${name}.json`), summary);

    entries.push({ name, type: 'music', sprites: 0, hasPalette: false, png: '' });
  }

  return entries;
}
