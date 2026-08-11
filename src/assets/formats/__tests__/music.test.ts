import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  AMIGA_NTSC_CLOCK,
  MUSIC_ATTACK_RATE_TABLE,
  MUSIC_DECAY_RATE_TABLE,
  MUSIC_MAX_VOLUME,
  MUSIC_PERIOD_TABLE,
  MUSIC_VOLUME_TABLE,
  MUSIC_WAVEFORM_PRIMITIVES,
  MUSIC_NOISE_LENGTH,
  MusicWaveform,
  P3_MUSIC_READ_LENGTHS,
  decodeMusic,
  decodeMusicTrack,
  frequencyForNote,
  generateNoiseWaveform,
  musicCommandSpec,
  musicNoteName,
  p3NextRandom,
  periodForNote,
  renderMusicTimeline,
  splitMusicTracks,
  waveformBuffer,
  type MusicNoteEvent,
} from '../music.ts';

const DATA_DIR = resolve('data/phantasieiii/amiga');
const EXE_PATH = resolve(DATA_DIR, 'PhantasieIII');

function readMusic(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(DATA_DIR, 'D', name)));
}

function exeWords(offset: number, count: number): number[] {
  const exe = new Uint8Array(readFileSync(EXE_PATH));
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  return Array.from({ length: count }, (_, i) => view.getUint16(offset + i * 2, false));
}

describe('stored tables — byte-identical to the shipped executable (dungeon-format.md §9.0.2.2)', () => {
  it('period table matches hunk-1 0x0640 (file 0x27F08), 87 words', () => {
    expect(MUSIC_PERIOD_TABLE).toEqual(exeWords(0x27f08, 87));
  });

  it('is the verbatim ProTracker finetune-0 table', () => {
    // Notes 60-71 are ProTracker's C-3..B-3 octave, and its exact neighbours.
    expect(MUSIC_PERIOD_TABLE.slice(60 - 9, 72 - 9)).toEqual([
      856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
    ]);
    expect(periodForNote(72)).toBe(428);
    expect(periodForNote(48)).toBe(1712);
    // Paula's hardware minimum, clamped in the last two entries.
    expect(MUSIC_PERIOD_TABLE.slice(-2)).toEqual([124, 124]);
  });

  it('attack and decay rate tables match hunk-1 0x0220 / 0x0420', () => {
    expect(MUSIC_ATTACK_RATE_TABLE).toEqual(exeWords(0x27ae8, 256));
    expect(MUSIC_DECAY_RATE_TABLE).toEqual(exeWords(0x27ce8, 256));
  });

  it('volume table matches hunk-1 0x0620 and tops out at Paula 63', () => {
    expect(MUSIC_VOLUME_TABLE).toEqual(exeWords(0x27ee8, 16));
    expect(MUSIC_VOLUME_TABLE[0]).toBe(0);
    expect(MUSIC_VOLUME_TABLE[15]).toBe(MUSIC_MAX_VOLUME);
    expect(MUSIC_MAX_VOLUME >> 8).toBe(63);
  });

  it('waveform primitives match the three 8-byte cycles at hunk-1 0x06EE/0x06F6/0x06FE', () => {
    const exe = new Uint8Array(readFileSync(EXE_PATH));
    const signed = (at: number) => Array.from(new Int8Array(exe.slice(at, at + 8).buffer));
    expect(MUSIC_WAVEFORM_PRIMITIVES[MusicWaveform.Sine]).toEqual(signed(0x27fc6));
    expect(MUSIC_WAVEFORM_PRIMITIVES[MusicWaveform.Square]).toEqual(signed(0x27fb6));
    expect(MUSIC_WAVEFORM_PRIMITIVES[MusicWaveform.Triangle]).toEqual(signed(0x27fbe));
  });
});

describe('pitch mapping (dungeon-format.md §9.0.2.2)', () => {
  it('puts note 57 on A4 at 440 Hz with eight samples per cycle', () => {
    expect(periodForNote(57)).toBe(1016);
    expect(frequencyForNote(57)).toBeCloseTo(AMIGA_NTSC_CLOCK / (1016 * 8), 6);
    expect(frequencyForNote(57)).toBeCloseTo(440.4, 1);
    expect(frequencyForNote(45)).toBeCloseTo(220.2, 1);
    expect(frequencyForNote(69)).toBeCloseTo(880.8, 1);
  });

  it('names notes twelve to the octave with note mod 12 == 0 as C', () => {
    expect(musicNoteName(57)).toBe('A4');
    expect(musicNoteName(60)).toBe('C5');
    expect(musicNoteName(0)).toBe('rest');
  });

  it('treats note 0 as a rest with no period', () => {
    expect(periodForNote(0)).toBe(0);
    expect(frequencyForNote(0)).toBe(0);
  });
});

describe('instruments (dungeon-format.md §9.0.2.5)', () => {
  it('builds the 64-byte buffers as eight repeats of the primitive', () => {
    const buf = waveformBuffer(MusicWaveform.Square);
    expect(buf).toHaveLength(64);
    expect(Array.from(buf.slice(0, 8))).toEqual(MUSIC_WAVEFORM_PRIMITIVES[MusicWaveform.Square]);
    expect(Array.from(buf.slice(56, 64))).toEqual(MUSIC_WAVEFORM_PRIMITIVES[MusicWaveform.Square]);
  });

  it('runs the confirmed P3 LCG for the noise buffer', () => {
    // seed = seed * 25173 + 13849 mod 65536, the same generator as
    // scripting-engine.md §7.5.
    expect(p3NextRandom(0)).toBe(13849);
    expect(p3NextRandom(13849)).toBe((13849 * 25173 + 13849) % 65536);

    const noise = generateNoiseWaveform(0);
    expect(noise).toHaveLength(MUSIC_NOISE_LENGTH);
    // Each longword is a zero-extended 16-bit draw: top two bytes are 0.
    expect(noise[0]).toBe(0);
    expect(noise[1]).toBe(0);
    const first = 13849;
    expect(noise[2] & 0xff).toBe(first >> 8);
    expect(noise[3] & 0xff).toBe(first & 0xff);
    // Not a degenerate buffer.
    expect(new Set(Array.from(noise)).size).toBeGreaterThan(64);
  });
});

describe('command table (dungeon-format.md §9.0.2.3)', () => {
  it('gives every documented command its exact argument count', () => {
    const expected: Record<number, number> = {
      0xc2: 1, 0xc3: 2, 0xc4: 2, 0xc7: 1, 0xca: 0, 0xcc: 0, 0xcd: 1, 0xce: 2,
      0xd1: 1, 0xd2: 2, 0xd3: 0, 0xd4: 0, 0xdb: 2, 0xdc: 0, 0xe1: 0, 0xe2: 1,
      0xe3: 0, 0xe4: 0, 0xe5: 1, 0xe6: 1, 0xe7: 0, 0xe8: 1, 0xe9: 1, 0xff: 0,
    };
    for (const [code, args] of Object.entries(expected)) {
      expect(musicCommandSpec(Number(code))?.args, `command 0x${Number(code).toString(16)}`).toBe(
        args,
      );
    }
    // The six "ignored" commands still consume their arguments.
    expect(musicCommandSpec(0xc3)?.args).toBe(2);
    expect(musicCommandSpec(0xe6)?.args).toBe(1);
  });
});

describe('decodeMusic — real m0/m1 bytes (dungeon-format.md §9.0.2.6)', () => {
  const cases = [
    { name: 'm0', fileSize: 896, trackLengths: [299, 325, 206], noteCounts: [141, 155, 98] },
    { name: 'm1', fileSize: 768, trackLengths: [253, 202, 204], noteCounts: [118, 96, 97] },
  ];

  for (const c of cases) {
    describe(c.name, () => {
      const data = readMusic(c.name);

      it('splits into exactly three tracks at the declared read length', () => {
        expect(data).toHaveLength(c.fileSize);
        const readLength = P3_MUSIC_READ_LENGTHS[c.name];
        expect(readLength).toBe(c.trackLengths.reduce((a, b) => a + b, 0));

        const tracks = splitMusicTracks(data, readLength);
        expect(tracks.map((t) => t.length)).toEqual(c.trackLengths);
        // Every track ends on its 0xFF, the last on the final byte read.
        for (const t of tracks) expect(t[t.length - 1]).toBe(0xff);
      });

      it('consumes every byte with zero residue and zero unknown commands', () => {
        const song = decodeMusic(data, c.name);
        for (let i = 0; i < song.tracks.length; i++) {
          const track = song.tracks[i];
          expect(track.bytesConsumed, `track ${i} residue`).toBe(c.trackLengths[i]);
          expect(track.unknownCommands, `track ${i} unknown commands`).toBe(0);
          // The scan must land exactly on the terminating 0xFF.
          const last = track.events[track.events.length - 1];
          expect(last.kind).toBe('command');
          expect((last as { code: number }).code).toBe(0xff);
        }
      });

      it('finds the documented note counts', () => {
        const song = decodeMusic(data, c.name);
        expect(song.tracks.map((t) => t.events.filter((e) => e.kind === 'note').length)).toEqual(
          c.noteCounts,
        );
      });

      it('has only odd (or zero) duration bytes — the composer-durations check', () => {
        // dur + 1 is then a power of two or a dotted (x1.5) one — the
        // durations a human composer writes, and only true under the
        // (dur + 1) x multiplier reading.
        const song = decodeMusic(data, c.name);
        for (const track of song.tracks) {
          for (const e of track.events) {
            if (e.kind !== 'note') continue;
            expect([1, 2, 4, 6, 8, 10, 12, 16], `duration ${e.durationUnits}`).toContain(
              e.durationUnits + 1,
            );
          }
        }
      });
    });
  }

  it('totals 705 notes over the whole corpus with 8 distinct duration values', () => {
    let notes = 0;
    const durations = new Set<number>();
    for (const name of ['m0', 'm1']) {
      for (const track of decodeMusic(readMusic(name), name).tracks) {
        for (const e of track.events) {
          if (e.kind !== 'note') continue;
          notes++;
          durations.add(e.durationUnits);
        }
      }
    }
    expect(notes).toBe(705);
    expect([...durations].sort((a, b) => a - b)).toEqual([0, 1, 3, 5, 7, 9, 11, 15]);
  });

  it('reads m0 track 0 s opening bytes as the documented command run', () => {
    const song = decodeMusic(readMusic('m0'), 'm0');
    // E2 07 | E1 | C2 20 | C4 00 B4 | DB 0C 06 | 3C 01 ...
    expect(song.tracks[0].events.slice(0, 6)).toEqual([
      { kind: 'command', offset: 0, code: 0xe2, name: 'setMultiplier', args: [7] },
      { kind: 'command', offset: 2, code: 0xe1, name: 'selectSine', args: [] },
      { kind: 'command', offset: 3, code: 0xc2, name: 'setWaveform', args: [0x20] },
      { kind: 'command', offset: 5, code: 0xc4, name: 'setAdsr', args: [0x00, 0xb4] },
      { kind: 'command', offset: 8, code: 0xdb, name: 'vibratoOnSkip2', args: [0x0c, 0x06] },
      { kind: 'note', offset: 11, note: 0x3c, durationUnits: 1, tie: false },
    ]);
  });

  it('reads m1 track 0 s opening bytes as the documented command run', () => {
    const song = decodeMusic(readMusic('m1'), 'm1');
    // E2 06 | C7 0E | E1 | C2 20 | C4 00 C3 | DB 0C 06
    expect(song.tracks[0].events.slice(0, 6).map((e) => e.kind === 'command' && e.name)).toEqual([
      'setMultiplier',
      'setMasterLevel',
      'selectSine',
      'setWaveform',
      'setAdsr',
      'vibratoOnSkip2',
    ]);
    // m1 tracks 1 and 2 carry no global commands — they start straight at E1.
    for (const t of [1, 2]) {
      expect(song.tracks[t].events[0]).toMatchObject({ code: 0xe1 });
    }
  });

  it('splits the three tracks into melody / bass / harmony roles', () => {
    const song = decodeMusic(readMusic('m0'), 'm0');
    const range = (i: number) => {
      const notes = song.tracks[i].events
        .filter((e): e is MusicNoteEvent => e.kind === 'note')
        .map((e) => e.note)
        .filter((n) => n !== 0);
      return [Math.min(...notes), Math.max(...notes)];
    };
    const rests = (i: number) =>
      song.tracks[i].events.filter((e) => e.kind === 'note' && e.note === 0).length;

    expect(range(0)).toEqual([52, 69]); // melody
    expect(range(1)).toEqual([23, 45]); // bass, two octaves down
    expect(range(2)).toEqual([36, 69]); // harmony
    expect(rests(0)).toBe(0);
    expect(rests(1)).toBe(0);
    expect(rests(2)).toBe(8);
  });

  it('rejects a file whose separators do not land where PlayMusic expects', () => {
    const broken = readMusic('m0').slice();
    broken[298] = 0x40;
    expect(() => splitMusicTracks(broken, 830)).toThrow(/tracks/);
  });

  it('rejects a truncated note pair', () => {
    expect(() => decodeMusicTrack(new Uint8Array([0x3c]))).toThrow(/duration byte/);
  });
});

describe('renderMusicTimeline — lockstep replay of the vertical-blank tick', () => {
  it('m0 runs at 7 frames per duration unit, m1 at 6', () => {
    for (const [name, mult] of [
      ['m0', 7],
      ['m1', 6],
    ] as const) {
      const song = decodeMusic(readMusic(name), name);
      const timeline = renderMusicTimeline(song);
      const first = timeline.tracks[0].notes[0];
      const firstEvent = song.tracks[0].events.find((e) => e.kind === 'note') as MusicNoteEvent;
      expect(first.frames).toBe((firstEvent.durationUnits + 1) * mult);
    }
  });

  it('schedules every decoded note, in order, with contiguous frame spans', () => {
    const song = decodeMusic(readMusic('m0'), 'm0');
    const timeline = renderMusicTimeline(song);
    for (let t = 0; t < 3; t++) {
      const decoded = song.tracks[t].events.filter((e) => e.kind === 'note');
      expect(timeline.tracks[t].notes).toHaveLength(decoded.length);
      let frame = 0;
      for (let i = 0; i < decoded.length; i++) {
        const scheduled = timeline.tracks[t].notes[i];
        expect(scheduled.offset).toBe(decoded[i].offset);
        expect(scheduled.note).toBe(decoded[i].note);
        expect(scheduled.startFrame).toBe(frame);
        frame += scheduled.frames;
      }
      // The track ends on the frame after its last note's span.
      expect(timeline.tracks[t].endFrame).toBe(frame);
    }
  });

  it('propagates the global multiplier change from m0 track 0 to all three tracks', () => {
    const song = decodeMusic(readMusic('m0'), 'm0');
    // m0 track 0 carries two 0xE2s; tracks 1 and 2 carry none.
    const multipliers = song.tracks.map(
      (t) => t.events.filter((e) => e.kind === 'command' && e.code === 0xe2).length,
    );
    expect(multipliers).toEqual([2, 0, 0]);

    const timeline = renderMusicTimeline(song);
    // All three tracks nonetheless span very nearly the same wall time —
    // only a lockstep replay of the shared multiplier can produce that.
    const ends = timeline.tracks.map((t) => t.endFrame);
    expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(0.1 * Math.max(...ends));
  });

  it('produces a plausible song length and a bounded, non-silent envelope', () => {
    for (const name of ['m0', 'm1']) {
      const timeline = renderMusicTimeline(decodeMusic(readMusic(name), name));
      expect(timeline.truncated).toBe(false);
      expect(timeline.endedOnRestart).toBe(false);
      expect(timeline.seconds).toBeGreaterThan(10);
      expect(timeline.seconds).toBeLessThan(120);
      for (const track of timeline.tracks) {
        expect(track.envelope.length).toBeGreaterThan(0);
        const values = track.envelope.map((p) => p.value);
        expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...values)).toBeLessThanOrEqual(MUSIC_MAX_VOLUME);
        expect(Math.max(...values)).toBeGreaterThan(MUSIC_MAX_VOLUME / 4);
      }
    }
  });

  it('picks the waveform each track s header selects (C2 20 = triangle)', () => {
    const timeline = renderMusicTimeline(decodeMusic(readMusic('m0'), 'm0'));
    for (const track of timeline.tracks) {
      expect(track.notes[0].waveform).toBe(MusicWaveform.Triangle);
      expect(track.notes[0].vibrato).toBe(true);
    }
  });
});
