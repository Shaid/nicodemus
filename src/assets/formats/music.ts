/**
 * Phantasie III three-track music decoder: `D/M0` and `D/M1`.
 *
 * See docs/phantasie/dungeon-format.md §9.0.2-§9.0.2.6, which specifies the
 * whole subsystem byte-exactly. Every constant and every rule below is
 * code-confirmed against the Amiga `PhantasieIII` executable; the hunk-0
 * addresses in the comments are the ones that doc section cites (file
 * offset = addr + `0x28`), and the hunk-1 table offsets are absolute-long
 * operands as the disassembly shows them.
 *
 * ## The file
 *
 * `PlayMusic()` (addr `0x1FA5C`) reads a fixed byte count — 830 for `M0`,
 * 659 for `M1` — and splits it at `0xFF` bytes into **exactly three
 * tracks**, the third `0xFF` landing on the final byte of the read. Bytes
 * past the declared read length are `0x3E` disk-block padding and are never
 * touched.
 *
 * ## The driver
 *
 * An AmigaOS vertical-blank interrupt server (`"VertB-Timer"`, installed at
 * addr `0x0D4A`) calls a tick (addr `0x2192`) once per video frame, so one
 * tick is **1/60 s** — the period table is NTSC-tuned and SSI was a US
 * publisher. The tick advances track 0, then 1, then 2, then bumps a global
 * 0-3 vibrato phase counter. Each track is a byte stream of note pairs and
 * commands; four of the commands (`0xC7`, `0xE2`, `0xE8`, `0xE9`) write
 * **global** state shared by all three tracks, which is why
 * {@link renderMusicTimeline} simulates all three in lockstep rather than
 * one at a time.
 *
 * Nothing here touches the DOM or Web Audio — this module is a pure decoder.
 * `tools/viewer/music-player.ts` turns its output into sound.
 */

// ---------------------------------------------------------------------------
// File layout
// ---------------------------------------------------------------------------

/** `0xFF` ends a track (`movea.l #0,a6; rts` at addr `0x24D8`). */
export const MUSIC_TRACK_SEPARATOR = 0xff;

export const MUSIC_TRACK_COUNT = 3;

/**
 * The byte count `PlayMusic()` is called with, per file. `"D/M0"` is loaded
 * with `#$33E` at addr `0x7426`, `"D/M1"` with `#$293` at addr `0x1EFE4`.
 * Everything past it is `0x3E` padding to a 128-byte disk block.
 */
export const P3_MUSIC_READ_LENGTHS: Readonly<Record<string, number>> = {
  m0: 830,
  m1: 659,
};

/** One tick per video frame; NTSC (dungeon-format.md §9.0.2.1). */
export const MUSIC_TICK_HZ = 60;
export const MUSIC_FRAME_SECONDS = 1 / MUSIC_TICK_HZ;

/** Paula's NTSC colour clock, the divisor base for the period table. */
export const AMIGA_NTSC_CLOCK = 3579545;

/**
 * Each waveform buffer is eight repeats of an 8-byte primitive, so one
 * DMA-fetched "cycle" is 8 samples and the sounding frequency is
 * `clock / (period * 8)` — an octave above the period table's ProTracker
 * nominal (§9.0.2.2, §9.0.2.5).
 */
export const MUSIC_SAMPLES_PER_CYCLE = 8;

// ---------------------------------------------------------------------------
// Stored tables — hunk 1, verbatim (dungeon-format.md §9.0.2.2)
// ---------------------------------------------------------------------------

/**
 * Hunk-1 `0x0640` (file `0x27F08`), 87 words, `period = table[note - 9]`.
 * This is the classic Amiga/ProTracker finetune-0 table, byte-identical:
 * notes 60-71 are `856 … 453`, note 72 is `428`, note 48 is `1712`. The last
 * two entries clamp at `124`, Paula's hardware minimum.
 */
export const MUSIC_PERIOD_TABLE: readonly number[] = [
  16256, 15360, 14496, 13792, 12928, 12192, 11520, 10848, 10240, 9664, 9120, 8608, 8128, 7680,
  7248, 6896, 6464, 6096, 5760, 5424, 5120, 4832, 4560, 4304, 4064, 3840, 3624, 3448, 3232, 3048,
  2880, 2712, 2560, 2416, 2280, 2152, 2032, 1920, 1812, 1712, 1616, 1524, 1440, 1356, 1280, 1208,
  1140, 1076, 1016, 960, 906, 856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453, 428,
  404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226, 214, 202, 190, 180, 170, 160, 151, 143,
  135, 127, 124, 124,
];

/** `sub.w #$9,d0` at addr `0x22E0`, then clamp-to-0 — note 9 is index 0. */
export const MUSIC_PERIOD_TABLE_FIRST_NOTE = 9;

/**
 * ADSR **attack**-rate table, hunk-1 `0x0220` (file `0x27AE8`), 16 rows of
 * 16 words indexed `masterLevel * 16 + attackNibble` (addr `0x2466`:
 * `asl.w #5` on the master level gives the row's *byte* offset).
 */
export const MUSIC_ATTACK_RATE_TABLE: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 1075, 1075, 472, 320, 264, 224, 179, 72, 36, 22, 18, 6, 4, 2,
  0, 0, 2150, 2150, 943, 640, 527, 448, 358, 143, 72, 45, 36, 12, 7, 4,
  0, 0, 3226, 3226, 1415, 960, 791, 672, 538, 215, 108, 67, 54, 18, 11, 7,
  0, 0, 4301, 4301, 1886, 1280, 1054, 896, 717, 287, 143, 90, 72, 24, 14, 9,
  0, 0, 5376, 5376, 2358, 1600, 1318, 1120, 896, 358, 179, 112, 90, 30, 18, 11,
  0, 0, 6451, 6451, 2829, 1920, 1581, 1344, 1075, 430, 215, 134, 108, 36, 22, 13,
  0, 0, 7526, 7526, 3301, 2240, 1845, 1568, 1254, 502, 251, 157, 125, 42, 25, 16,
  0, 0, 8602, 8602, 3773, 2560, 2108, 1792, 1434, 573, 287, 179, 143, 48, 29, 18,
  0, 0, 9676, 9676, 4244, 2880, 2372, 2016, 1613, 645, 323, 202, 161, 54, 32, 20,
  0, 0, 10752, 10752, 4716, 3200, 2635, 2240, 1792, 717, 358, 224, 179, 60, 36, 22,
  0, 0, 11827, 11827, 5187, 3520, 2899, 2464, 1971, 788, 394, 246, 197, 66, 39, 25,
  0, 0, 12902, 12902, 5659, 3840, 3162, 2688, 2150, 860, 430, 269, 215, 72, 43, 27,
  0, 0, 13978, 13978, 6131, 4160, 3426, 2912, 2330, 932, 466, 291, 233, 78, 47, 29,
  0, 0, 15053, 15053, 6602, 4480, 3689, 3136, 2509, 1004, 502, 314, 251, 84, 50, 31,
  0, 0, 16128, 16128, 7074, 4800, 3953, 3360, 2688, 1075, 538, 336, 269, 90, 54, 34,
];

/**
 * ADSR **decay/release**-rate table, hunk-1 `0x0420` (file `0x27CE8`), same
 * `masterLevel * 16 + nibble` indexing. It serves both phases: `0xC4` reads
 * it once with the decay nibble (addr `0x24A2`) and once with the release
 * nibble (addr `0x24BA`).
 */
export const MUSIC_DECAY_RATE_TABLE: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 747, 373, 249, 157, 107, 88, 75, 60, 24, 12, 7, 6, 2, 1, 0,
  0, 1493, 747, 498, 314, 213, 176, 149, 119, 48, 24, 15, 12, 4, 2, 1,
  0, 2240, 1120, 747, 472, 320, 264, 224, 179, 72, 36, 22, 18, 6, 4, 2,
  0, 2987, 1493, 995, 629, 427, 351, 299, 239, 95, 48, 30, 24, 8, 5, 3,
  0, 3733, 1867, 1244, 786, 533, 439, 373, 299, 119, 60, 37, 30, 10, 6, 4,
  0, 4480, 2240, 1493, 943, 640, 527, 448, 358, 143, 72, 45, 36, 12, 7, 4,
  0, 5227, 2613, 1742, 1100, 747, 615, 523, 418, 167, 84, 52, 42, 14, 8, 5,
  0, 5973, 2987, 1991, 1258, 853, 703, 597, 478, 191, 95, 60, 48, 16, 9, 6,
  0, 6720, 3360, 2240, 1415, 960, 791, 672, 538, 215, 108, 67, 54, 18, 11, 7,
  0, 7467, 3733, 2489, 1572, 1067, 878, 747, 597, 239, 119, 75, 60, 20, 12, 7,
  0, 8213, 4107, 2738, 1729, 1173, 966, 821, 657, 263, 131, 82, 66, 22, 13, 8,
  0, 8960, 4480, 2987, 1886, 1280, 1054, 896, 717, 287, 143, 90, 72, 24, 14, 9,
  0, 9706, 4853, 3236, 2044, 1387, 1142, 970, 777, 311, 155, 97, 78, 26, 16, 9,
  0, 10453, 5227, 3484, 2201, 1493, 1230, 1045, 836, 335, 167, 105, 84, 28, 17, 10,
  0, 11200, 5600, 3733, 2358, 1600, 1318, 1120, 896, 358, 179, 112, 90, 30, 18, 11,
];

/**
 * Volume levels, hunk-1 `0x0620` (file `0x27EE8`), 16 words — a linear ramp
 * from 0 to `0x3F00`. Used twice: `0xC7` sets the global master volume from
 * it, and `0xC4` sets the per-track **sustain level** from it (addr
 * `0x24CE` — indexed by the sustain nibble alone, *not* scaled by the
 * master level).
 */
export const MUSIC_VOLUME_TABLE: readonly number[] = [
  0, 1075, 2150, 3226, 4301, 5376, 6451, 7526, 8602, 9676, 10752, 11827, 12902, 13978, 15053,
  16128,
];

/**
 * The envelope accumulator is 16-bit fixed point and `AUDxVOL` gets its top
 * byte (`asr.w #8` at addr `0x2454`), so `0x3F00 >> 8` = 63, the Amiga
 * maximum. Divide an accumulator value by this for a 0..1 gain.
 */
export const MUSIC_MAX_VOLUME = 0x3f00; // 16128

// ---------------------------------------------------------------------------
// Instruments — dungeon-format.md §9.0.2.5
// ---------------------------------------------------------------------------

export const MUSIC_WAVEFORM_COUNT = 4;

/**
 * Indices into the driver's four-pointer instrument array (`0`, `4`, `8`,
 * `0xC` as byte offsets at hunk-1 `$2AA6`). A plain object rather than a TS
 * `enum` — this project compiles with `erasableSyntaxOnly`.
 */
export const MusicWaveform = {
  /** Rough sine. Selected by `0xC2 10` and by `0xE1`. */
  Sine: 0,
  /** Literal square. Selected by `0xC2 40`. */
  Square: 1,
  /** Triangle. Selected by `0xC2 20`. */
  Triangle: 2,
  /** 4,000 bytes of LCG noise. Selected by `0xE5` and by `0xC2 <anything else>`. */
  Noise: 3,
} as const;

export type MusicWaveform = (typeof MusicWaveform)[keyof typeof MusicWaveform];

/** Display names, in {@link MusicWaveform} order. */
export const MUSIC_WAVEFORM_NAMES: readonly string[] = ['sine', 'square', 'triangle', 'noise'];

/**
 * The three stored 8-byte signed primitives at hunk-1 `0x06FE`, `0x06EE`
 * and `0x06F6` (file `0x27FC6`, `0x27FB6`, `0x27FBE`), in
 * {@link MusicWaveform} order. `InitWaveforms` (addr `0x1E6C`) fills a
 * 64-byte buffer with eight repeats of each.
 */
export const MUSIC_WAVEFORM_PRIMITIVES: readonly (readonly number[])[] = [
  [0x00, 0x35, 0x7f, 0x49, 0x00, -0x35, -0x7f, -0x49], // 00 35 7F 49 00 CB 81 B7 — rough sine
  [0x7f, 0x7f, 0x7f, 0x7f, -0x7f, -0x7f, -0x7f, -0x7f], // 7F 7F 7F 7F 81 81 81 81 — square
  [0x00, 0x2a, 0x55, 0x7f, -0x7f, -0x55, -0x2a, 0x00], // 00 2A 55 7F 81 AB D6 00 — triangle
];

/** `AUDxLEN` in words for the three 64-byte buffers (addr `0x25B6`). */
export const MUSIC_WAVEFORM_LEN_WORDS = 0x20;
/** `AUDxLEN` in words for the 4,000-byte noise buffer (addr `0x25F4`). */
export const MUSIC_NOISE_LEN_WORDS = 0x7d0;
/** `0x3E7 + 1` iterations x one longword each (addr `0x1F2E`). */
export const MUSIC_NOISE_LENGTH = 4000;

/** `seed = (seed * 0x6255 + 0x3619) mod 0x10000` — addr `0x1C24`. */
export const P3_LCG_MULTIPLIER = 25173; // 0x6255
export const P3_LCG_INCREMENT = 13849; // 0x3619
export const P3_LCG_MODULUS = 65536; // 0x10000

/**
 * The Phantasie III RNG: the "quick and dirty" LCG the scripting engine
 * uses too (scripting-engine.md §7.5 — same routine, same global seed word
 * at hunk-1 `0x291C`, reached from opposite ends of the binary). Returns
 * the next seed, which is also the generated value.
 */
export function p3NextRandom(seed: number): number {
  return (seed * P3_LCG_MULTIPLIER + P3_LCG_INCREMENT) % P3_LCG_MODULUS;
}

/**
 * Regenerate the 4,000-byte noise instrument exactly as `InitWaveforms`
 * does: 1,000 iterations of the LCG, each storing its 16-bit result as a
 * **longword** (`move.l`, so the value is sign-extended into the top half —
 * every draw is a positive 16-bit number, so the top two bytes are always
 * zero) in big-endian order.
 *
 * The seed at that moment is the BSS global at hunk-1 `0x291C`, which is
 * zero on a cold boot and is not re-seeded before `InitWaveforms` runs —
 * hence the default. It only picks which noise you get, not whether it is
 * noise.
 */
export function generateNoiseWaveform(seed = 0): Int8Array {
  const out = new Int8Array(MUSIC_NOISE_LENGTH);
  let s = seed;
  for (let i = 0; i < MUSIC_NOISE_LENGTH / 4; i++) {
    s = p3NextRandom(s);
    const at = i * 4;
    // move.l of a zero-extended 16-bit draw: high word always 0.
    out[at] = 0;
    out[at + 1] = 0;
    out[at + 2] = (s >> 8) << 24 >> 24;
    out[at + 3] = (s & 0xff) << 24 >> 24;
  }
  return out;
}

/**
 * The 64-byte buffer the driver actually points Paula at for waveforms 0-2:
 * eight repeats of the primitive (nested `0..7` x `0..7` loops at addr
 * `0x1EB6`). {@link MusicWaveform.Noise} has no primitive — use
 * {@link generateNoiseWaveform}.
 */
export function waveformBuffer(waveform: MusicWaveform): Int8Array {
  if (waveform === MusicWaveform.Noise) return generateNoiseWaveform();
  const primitive = MUSIC_WAVEFORM_PRIMITIVES[waveform];
  if (!primitive) throw new RangeError(`unknown music waveform ${waveform}`);
  const out = new Int8Array(primitive.length * 8);
  for (let rep = 0; rep < 8; rep++) out.set(primitive, rep * primitive.length);
  return out;
}

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** `"A4"` for note 57. `note mod 12 == 0` is C; MIDI number is `note + 12`. */
export function musicNoteName(note: number): string {
  if (note === 0) return 'rest';
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12)}`;
}

/** Paula period for a note byte, or 0 for a rest. Notes below 9 clamp to index 0. */
export function periodForNote(note: number): number {
  if (note === 0) return 0;
  const index = Math.max(0, note - MUSIC_PERIOD_TABLE_FIRST_NOTE);
  return MUSIC_PERIOD_TABLE[Math.min(index, MUSIC_PERIOD_TABLE.length - 1)];
}

/** `clock / (period * 8)` — note 57 lands on 440.4 Hz (§9.0.2.2). */
export function frequencyForPeriod(period: number): number {
  if (period <= 0) return 0;
  return AMIGA_NTSC_CLOCK / (period * MUSIC_SAMPLES_PER_CYCLE);
}

export function frequencyForNote(note: number): number {
  return frequencyForPeriod(periodForNote(note));
}

/**
 * Vibrato swings the period by `period >> 7` — about 0.78%, i.e. roughly
 * 13.5 cents — on the global 0-3 frame phase, so its cycle is 15 Hz
 * (addr `0x2272`).
 */
export function vibratoPeriodDepth(period: number): number {
  return period >> 7;
}

/** The global vibrato phase counter runs 0-3 at the tick rate (addr `0x21F8`). */
export const MUSIC_VIBRATO_PHASES = 4;
export const MUSIC_VIBRATO_HZ = MUSIC_TICK_HZ / MUSIC_VIBRATO_PHASES;

// ---------------------------------------------------------------------------
// Stream grammar — dungeon-format.md §9.0.2.3
// ---------------------------------------------------------------------------

export interface MusicCommandSpec {
  code: number;
  /** Argument bytes consumed after the command byte. */
  args: number;
  /** Stable identifier used by the timeline interpreter and by tests. */
  name: string;
  /** Hunk-0 address of the handler. */
  addr: number;
}

/**
 * Every command byte the dispatcher at addr `0x2436` recognises, with the
 * argument count it consumes. The six "ignored" ones still have to consume
 * their arguments or the stream desynchronises — `0xC3` skips two bytes,
 * `0xE6` skips one, the rest take none.
 */
export const MUSIC_COMMANDS: readonly MusicCommandSpec[] = [
  { code: 0xc2, args: 1, name: 'setWaveform', addr: 0x257c },
  { code: 0xc3, args: 2, name: 'ignored2', addr: 0x2626 },
  { code: 0xc4, args: 2, name: 'setAdsr', addr: 0x2438 },
  { code: 0xc7, args: 1, name: 'setMasterLevel', addr: 0x24b6 },
  { code: 0xca, args: 0, name: 'ignored0a', addr: 0x26d2 },
  { code: 0xcc, args: 0, name: 'ignored0b', addr: 0x26c8 },
  { code: 0xcd, args: 1, name: 'loop1Begin', addr: 0x2510 },
  { code: 0xce, args: 2, name: 'loop1End', addr: 0x24e6 },
  { code: 0xd1, args: 1, name: 'loop2Begin', addr: 0x254a },
  { code: 0xd2, args: 2, name: 'loop2End', addr: 0x2526 },
  { code: 0xd3, args: 0, name: 'vibratoOn', addr: 0x2668 },
  { code: 0xd4, args: 0, name: 'vibratoOn', addr: 0x267e },
  { code: 0xdb, args: 2, name: 'vibratoOnSkip2', addr: 0x25d6 },
  { code: 0xdc, args: 0, name: 'vibratoOff', addr: 0x25ee },
  { code: 0xe1, args: 0, name: 'selectSine', addr: 0x2604 },
  { code: 0xe2, args: 1, name: 'setMultiplier', addr: 0x2560 },
  { code: 0xe3, args: 0, name: 'ignored0c', addr: 0x265e },
  { code: 0xe4, args: 0, name: 'ignored0d', addr: 0x2630 },
  { code: 0xe5, args: 1, name: 'selectNoise', addr: 0x263a },
  { code: 0xe6, args: 1, name: 'ignored1', addr: 0x2694 },
  { code: 0xe7, args: 0, name: 'songRestart', addr: 0x26a0 },
  { code: 0xe8, args: 1, name: 'multiplierSub', addr: 0x26dc },
  { code: 0xe9, args: 1, name: 'multiplierAdd', addr: 0x26f8 },
  { code: 0xff, args: 0, name: 'endOfTrack', addr: 0x24d8 },
];

const COMMANDS_BY_CODE = new Map(MUSIC_COMMANDS.map((c) => [c.code, c]));

export function musicCommandSpec(code: number): MusicCommandSpec | undefined {
  return COMMANDS_BY_CODE.get(code);
}

export interface MusicNoteEvent {
  kind: 'note';
  /** Byte offset of the event's first byte within its track. */
  offset: number;
  /** 0 is a rest (special-cased at addr `0x22D0`, before the period lookup). */
  note: number;
  /** `byte1 & 0x7F` — duration in units of the current global multiplier. */
  durationUnits: number;
  /** `byte1 & 0x80` — suppresses the automatic note-off into release. */
  tie: boolean;
}

export interface MusicCommandEvent {
  kind: 'command';
  offset: number;
  code: number;
  name: string;
  args: number[];
}

/**
 * A byte `>= 0x80` the dispatcher does not know. The fallback at addr
 * `0x2714` clicks audio channel 3 and keeps parsing, consuming no
 * arguments. Neither shipped file contains one (§9.0.2.6).
 */
export interface MusicUnknownEvent {
  kind: 'unknown';
  offset: number;
  code: number;
}

export type MusicEvent = MusicNoteEvent | MusicCommandEvent | MusicUnknownEvent;

export interface MusicTrack {
  /** The track's own bytes, including its terminating `0xFF`. */
  bytes: Uint8Array;
  events: MusicEvent[];
  /** Bytes the scan consumed; equals `bytes.length` for a well-formed track. */
  bytesConsumed: number;
  /** Count of `kind === 'unknown'` events — 0 for both shipped files. */
  unknownCommands: number;
}

export interface MusicSong {
  /** Asset key, e.g. `"m0"`. */
  name: string;
  /** The declared `PlayMusic()` read length these tracks were split from. */
  readLength: number;
  tracks: MusicTrack[];
}

/**
 * Split a music file into its three tracks at the `0xFF` separators, over
 * the declared read length only. Each returned slice **includes** its
 * terminating `0xFF`, so the three lengths sum to `readLength`.
 */
export function splitMusicTracks(data: Uint8Array, readLength: number): Uint8Array[] {
  if (readLength > data.length) {
    throw new RangeError(`music read length ${readLength} exceeds the ${data.length}-byte file`);
  }
  const tracks: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < readLength; i++) {
    if (data[i] !== MUSIC_TRACK_SEPARATOR) continue;
    tracks.push(data.slice(start, i + 1));
    start = i + 1;
  }
  if (tracks.length !== MUSIC_TRACK_COUNT) {
    throw new Error(
      `expected ${MUSIC_TRACK_COUNT} music tracks in the first ${readLength} bytes, found ${tracks.length}`,
    );
  }
  if (start !== readLength) {
    throw new Error(`music track separator does not land on byte ${readLength - 1}`);
  }
  return tracks;
}

/** Linear scan of one track's byte stream. Loops are *not* followed here — see {@link renderMusicTimeline}. */
export function decodeMusicTrack(bytes: Uint8Array): MusicTrack {
  const events: MusicEvent[] = [];
  let unknownCommands = 0;
  let p = 0;
  while (p < bytes.length) {
    const offset = p;
    const byte0 = bytes[p++];
    if (byte0 < 0x80) {
      if (p >= bytes.length) {
        throw new Error(`music note at ${offset} is missing its duration byte`);
      }
      const byte1 = bytes[p++];
      events.push({
        kind: 'note',
        offset,
        note: byte0,
        durationUnits: byte1 & 0x7f,
        tie: (byte1 & 0x80) !== 0,
      });
      continue;
    }
    const spec = COMMANDS_BY_CODE.get(byte0);
    if (!spec) {
      unknownCommands++;
      events.push({ kind: 'unknown', offset, code: byte0 });
      continue;
    }
    if (p + spec.args > bytes.length) {
      throw new Error(`music command 0x${byte0.toString(16)} at ${offset} runs past the track`);
    }
    const args: number[] = [];
    for (let i = 0; i < spec.args; i++) args.push(bytes[p++]);
    events.push({ kind: 'command', offset, code: byte0, name: spec.name, args });
  }
  return { bytes, events, bytesConsumed: p, unknownCommands };
}

/**
 * Decode a whole `D/M0`-style file. `readLength` defaults to the declared
 * length for `name` if it is one of the two shipped songs.
 */
export function decodeMusic(data: Uint8Array, name: string, readLength?: number): MusicSong {
  const length = readLength ?? P3_MUSIC_READ_LENGTHS[name.toLowerCase()];
  if (length === undefined) {
    throw new Error(`no declared read length for music file "${name}" — pass one explicitly`);
  }
  return {
    name,
    readLength: length,
    tracks: splitMusicTracks(data, length).map(decodeMusicTrack),
  };
}

// ---------------------------------------------------------------------------
// Timeline — a faithful replay of the vertical-blank tick
// ---------------------------------------------------------------------------

export interface MusicScheduledNote {
  /** Frame the note event was fetched on. */
  startFrame: number;
  /** `((durationUnits + 1) * multiplier)` frames until the next fetch. */
  frames: number;
  /** 0 for a rest. */
  note: number;
  period: number;
  /** Hz, 0 for a rest. */
  frequency: number;
  tie: boolean;
  waveform: MusicWaveform;
  vibrato: boolean;
  /** Byte offset of the note event within its track — for UI cross-reference. */
  offset: number;
}

/** A vertex of the piecewise-linear envelope, in raw 16-bit accumulator units. */
export interface MusicEnvelopePoint {
  frame: number;
  /** 0..{@link MUSIC_MAX_VOLUME}. Divide by that for a 0..1 gain. */
  value: number;
}

export interface MusicTimelineTrack {
  notes: MusicScheduledNote[];
  /**
   * Envelope breakpoints. The accumulator moves by a constant amount per
   * frame within a phase, so linear interpolation between consecutive
   * points reproduces the driver's staircase exactly.
   */
  envelope: MusicEnvelopePoint[];
  /** Frame the track's `0xFF` was reached on. */
  endFrame: number;
}

export interface MusicTimeline {
  tracks: MusicTimelineTrack[];
  /** Total frames simulated. */
  frames: number;
  seconds: number;
  tickHz: number;
  /** True if the simulation stopped because a `0xE7` restart was reached. */
  endedOnRestart: boolean;
  /** True if `maxFrames` cut the simulation short. */
  truncated: boolean;
}

export interface MusicTimelineOptions {
  /**
   * How many times a `0xE7` song restart is honoured before the simulation
   * stops. Default 0 — the timeline ends at the first restart, and a UI
   * player loops by replaying the timeline rather than by unrolling it.
   */
  restarts?: number;
  /** Safety stop. Default 10 minutes of frames. */
  maxFrames?: number;
}

interface TrackState {
  bytes: Uint8Array;
  /** -1 once `0xFF` has run (`movea.l #0,a6`). */
  pointer: number;
  /** Frames remaining, pre-decrement (hunk-1 `0x2992`). */
  counter: number;
  /** 0 attack, 1 decay, 2 sustain, 3 release, 4 silent (hunk-1 `0x2998`). */
  phase: number;
  /** 16-bit envelope accumulator (hunk-1 `0x29B6`). */
  volume: number;
  attackRate: number;
  decayRate: number;
  sustainLevel: number;
  releaseRate: number;
  tie: boolean;
  vibrato: boolean;
  waveform: MusicWaveform;
  period: number;
  loop1: number;
  loop2: number;
  ended: boolean;
  endFrame: number;
  levels: number[];
  notes: MusicScheduledNote[];
}

/** `0xC2`'s argument -> waveform (addr `0x25BC`); anything unlisted is noise. */
function waveformForSelectArg(arg: number): MusicWaveform {
  if (arg === 0x10) return MusicWaveform.Sine;
  if (arg === 0x20) return MusicWaveform.Triangle;
  if (arg === 0x40) return MusicWaveform.Square;
  return MusicWaveform.Noise;
}

/** Drop points that lie exactly on the straight line between their neighbours. */
function compressEnvelope(levels: readonly number[]): MusicEnvelopePoint[] {
  const out: MusicEnvelopePoint[] = [];
  for (let i = 0; i < levels.length; i++) {
    if (i > 0 && i + 1 < levels.length && levels[i] - levels[i - 1] === levels[i + 1] - levels[i]) {
      continue;
    }
    out.push({ frame: i, value: levels[i] });
  }
  return out;
}

/**
 * Replay the driver's tick over a decoded song and produce a schedulable
 * timeline: one note list and one envelope per track.
 *
 * This is a lockstep simulation of all three tracks — in the real driver
 * `0xC7`, `0xE2`, `0xE8` and `0xE9` write **global** state, and the tick
 * services track 0, then 1, then 2, so a multiplier change in one track
 * takes effect for the others from that very frame. Track-at-a-time
 * decoding would get both songs' tempo wrong (`m0` changes its multiplier
 * mid-song from track 0 while tracks 1 and 2 carry none).
 *
 * Envelope, note-off and rest semantics follow the disassembly exactly:
 * a note event resets the accumulator to 0 and the phase to attack (addr
 * `0x22EC`/`0x2338`); a rest only forces the release phase (addr `0x22FE`);
 * the automatic note-off fires on the frame the counter reaches 0, one
 * frame before the next fetch, unless the tie bit was set (addr `0x2236`).
 */
export function renderMusicTimeline(
  song: MusicSong,
  options: MusicTimelineOptions = {},
): MusicTimeline {
  const maxRestarts = options.restarts ?? 0;
  const maxFrames = options.maxFrames ?? MUSIC_TICK_HZ * 600;

  const makeState = (bytes: Uint8Array): TrackState => ({
    bytes,
    pointer: 0,
    counter: 0,
    phase: 0,
    volume: 0,
    attackRate: 0,
    decayRate: 0,
    sustainLevel: 0,
    releaseRate: 0,
    tie: false,
    vibrato: false,
    // MusicStart seeds every track with waveform offset 8 = W2 (addr 0x2012).
    waveform: MusicWaveform.Triangle,
    period: 0,
    loop1: 0,
    loop2: 0,
    ended: false,
    endFrame: 0,
    levels: [],
    notes: [],
  });

  const states = song.tracks.map((t) => makeState(t.bytes));
  // Globals. All three live in BSS and MusicStart does not touch the master
  // level, so a cold boot starts at 0 — both songs set it from a 0xC7 in
  // their first frame's header run, so it is visible for at most one frame.
  let multiplier = 1;
  let masterLevel = 0;
  let masterVolume = MUSIC_VOLUME_TABLE[0];
  let restartsUsed = 0;
  let endedOnRestart = false;
  let truncated = false;

  const setMasterLevel = (level: number) => {
    masterLevel = level & 0x0f;
    masterVolume = MUSIC_VOLUME_TABLE[masterLevel];
  };
  const setMultiplierAll = (value: number) => {
    // move.w to all three slots — a single global, kept as one variable.
    multiplier = value & 0xffff;
  };

  /** The envelope step at addr `0x2360`, one frame for one track. */
  const stepEnvelope = (s: TrackState) => {
    if (s.phase === 0) {
      if (s.attackRate === 0) {
        s.volume = masterVolume;
        s.phase = 1;
      } else {
        s.volume += s.attackRate;
        if (masterVolume <= s.volume) {
          s.volume = masterVolume;
          s.phase = 1;
        }
      }
    } else if (s.phase === 1) {
      if (s.decayRate === 0) {
        s.phase = 2;
      } else {
        s.volume -= s.decayRate;
        if (s.sustainLevel >= s.volume) {
          s.volume = s.sustainLevel;
          s.phase = 2;
        }
      }
    } else if (s.phase === 2) {
      s.volume = s.sustainLevel;
    } else if (s.phase === 3) {
      if (s.releaseRate === 0) {
        s.volume = 0;
      } else {
        s.volume -= s.releaseRate;
        if (s.volume <= 0) {
          s.volume = 0;
          s.phase = 4;
        }
      }
    }
  };

  /**
   * The fetch loop at addr `0x22A8`: consume commands until a note event,
   * the end of the track, or a song restart. Returns `'note'`, `'end'` or
   * `'restart'`.
   */
  const fetch = (s: TrackState, frame: number): 'note' | 'end' | 'restart' => {
    for (;;) {
      if (s.pointer < 0 || s.pointer >= s.bytes.length) return 'end';
      const offset = s.pointer;
      const byte0 = s.bytes[s.pointer++];

      if (byte0 < 0x80) {
        const byte1 = s.bytes[s.pointer++];
        s.tie = (byte1 & 0x80) !== 0;
        const units = byte1 & 0x7f;
        const frames = (units + 1) * multiplier;
        s.counter = frames - 1;
        s.phase = 0;
        if (byte0 === 0) {
          // Rest: phase 3 and straight into the envelope. The stored period
          // is left alone and Paula is not retriggered (addr `0x22FE`).
          s.phase = 3;
        } else {
          s.period = periodForNote(byte0);
          s.volume = 0;
        }
        s.notes.push({
          startFrame: frame,
          frames,
          note: byte0,
          period: byte0 === 0 ? 0 : s.period,
          frequency: byte0 === 0 ? 0 : frequencyForPeriod(s.period),
          tie: s.tie,
          waveform: s.waveform,
          vibrato: s.vibrato,
          offset,
        });
        return 'note';
      }

      const spec = COMMANDS_BY_CODE.get(byte0);
      if (!spec) continue; // fallback click, no arguments, keep parsing
      const args: number[] = [];
      for (let i = 0; i < spec.args; i++) args.push(s.bytes[s.pointer + i]);

      switch (byte0) {
        case 0xc2:
          s.pointer += 1;
          s.waveform = waveformForSelectArg(args[0]);
          break;
        case 0xc4: {
          s.pointer += 2;
          const row = masterLevel * 16;
          s.attackRate = MUSIC_ATTACK_RATE_TABLE[row + (args[0] >> 4)];
          s.decayRate = MUSIC_DECAY_RATE_TABLE[row + (args[0] & 0x0f)];
          s.releaseRate = MUSIC_DECAY_RATE_TABLE[row + (args[1] & 0x0f)];
          s.sustainLevel = MUSIC_VOLUME_TABLE[args[1] >> 4];
          break;
        }
        case 0xc7:
          s.pointer += 1;
          setMasterLevel(args[0]);
          break;
        case 0xcd:
          s.pointer += 1;
          s.loop1 = args[0];
          break;
        case 0xce:
          // a6 points at the first argument byte when the jump is taken
          // (addr 0x252C: `suba.w d1,a6`), so the base is `offset + 1`.
          s.loop1 = (s.loop1 - 1) & 0xffff;
          if (s.loop1 !== 0) s.pointer = offset + 1 - ((args[0] << 8) | args[1]);
          else s.pointer += 2;
          break;
        case 0xd1:
          s.pointer += 1;
          s.loop2 = args[0];
          break;
        case 0xd2:
          s.loop2 = (s.loop2 - 1) & 0xffff;
          if (s.loop2 !== 0) s.pointer = offset + 1 - ((args[0] << 8) | args[1]);
          else s.pointer += 2;
          break;
        case 0xd3:
        case 0xd4:
          s.vibrato = true;
          break;
        case 0xdb:
          s.pointer += 2;
          s.vibrato = true;
          break;
        case 0xdc:
          s.vibrato = false;
          break;
        case 0xe1:
          s.waveform = MusicWaveform.Sine;
          break;
        case 0xe2:
          s.pointer += 1;
          setMultiplierAll(args[0]);
          break;
        case 0xe5:
          s.pointer += 1;
          s.waveform = MusicWaveform.Noise;
          break;
        case 0xe7:
          return 'restart';
        case 0xe8:
          s.pointer += 1;
          setMultiplierAll(multiplier - args[0]);
          break;
        case 0xe9:
          s.pointer += 1;
          setMultiplierAll(multiplier + args[0]);
          break;
        case 0xff:
          s.pointer = -1;
          return 'end';
        default:
          // Ignored commands: consume the arguments, change nothing.
          s.pointer += spec.args;
          break;
      }
    }
  };

  const restartAll = () => {
    for (const s of states) {
      s.pointer = 0;
      s.counter = 0;
      s.ended = false;
    }
  };

  let frame = 0;
  outer: for (; frame < maxFrames; frame++) {
    if (states.every((s) => s.ended)) break;

    for (const s of states) {
      if (s.ended) {
        s.levels.push(0);
        continue;
      }

      if (s.counter === 0) {
        const result = fetch(s, frame);
        if (result === 'restart') {
          if (restartsUsed < maxRestarts) {
            restartsUsed++;
            restartAll();
            // 0xE7 leaves the tick entirely — the remaining tracks do not
            // step this frame (addr 0x26EA pops the return address).
            for (const t of states) if (t.levels.length <= frame) t.levels.push(t.volume);
            continue outer;
          }
          endedOnRestart = true;
          for (const t of states) {
            if (!t.ended) {
              t.ended = true;
              t.endFrame = frame;
            }
            if (t.levels.length <= frame) t.levels.push(t.volume);
          }
          frame++;
          break outer;
        }
        if (result === 'end') {
          s.ended = true;
          s.endFrame = frame;
          s.levels.push(0);
          continue;
        }
      } else {
        s.counter -= 1;
        if (s.counter === 0 && !s.tie) s.phase = 3;
      }

      stepEnvelope(s);
      s.levels.push(s.volume);
    }
  }
  if (frame >= maxFrames) truncated = true;

  const tracks: MusicTimelineTrack[] = states.map((s) => ({
    notes: s.notes,
    envelope: compressEnvelope(s.levels),
    endFrame: s.ended ? s.endFrame : frame,
  }));

  return {
    tracks,
    frames: frame,
    seconds: frame * MUSIC_FRAME_SECONDS,
    tickHz: MUSIC_TICK_HZ,
    endedOnRestart,
    truncated,
  };
}
