/**
 * Web Audio playback of Phantasie III's `D/M0` and `D/M1`, plus a piano-roll
 * view of the decoded timeline.
 *
 * The format is fully solved (docs/phantasie/dungeon-format.md §9.0.2 —
 * §9.0.2.6) and `src/assets/formats/music.ts` decodes it; this component is
 * only the sound and the pixels. It fetches the raw bytes the pipeline
 * copied to `<assetBase>/music/<name>.bin`, decodes them in the browser,
 * replays the driver's vertical-blank tick into a timeline, and hands that
 * to the `AudioContext` clock in one pass — no per-frame JS scheduling.
 *
 * ## Graph
 *
 * One source node **per waveform run per track**, not one per note: both
 * songs select their instrument once in the track header and never change
 * it, so this is three nodes for a fifty-second song. Pitch is
 * `frequency.setValueAtTime()` (or `playbackRate` for the noise buffer) at
 * each note's onset; the ADSR is `linearRampToValueAtTime()` between the
 * envelope breakpoints the decoder emits, which is exact — the driver's
 * accumulator moves by a constant amount per frame inside a phase.
 *
 * ```
 *   source (osc | noise buffer)  ->  envelope gain  ->  mute gain  ->  master  ->  out
 * ```
 *
 * ## Where this approximates
 *
 * - **Waveforms.** W1 is a literal square (`7F 7F 7F 7F 81 81 81 81`) and
 *   uses `type: 'square'`. W0 and W2 become a `PeriodicWave` built from the
 *   real DFT of their own 8-byte primitive, so their harmonic content is
 *   the stored cycle's — but `PeriodicWave` is band-limited, whereas Paula
 *   plays a stepped 8-sample buffer and aliases. Timbre is right, the grit
 *   is not. W3 is the genuine article: an `AudioBuffer` seeded from the
 *   game's own LCG, byte-for-byte what `InitWaveforms` generates.
 * - **Vibrato** is a 15 Hz LFO on `detune` rather than a per-frame period
 *   rewrite. The driver's wobble is `period >> 7` on a 0-3 frame phase
 *   (a 15 Hz staircase); this is the same rate and depth, smoothed.
 */
import { setHidden } from './shared.ts';
import {
  AMIGA_NTSC_CLOCK,
  AMIGA_PAL_CLOCK,
  MUSIC_MAX_VOLUME,
  MUSIC_SAMPLES_PER_CYCLE,
  MUSIC_TICK_HZ,
  MUSIC_TICK_HZ_PAL,
  MUSIC_VIBRATO_PHASES,
  MUSIC_WAVEFORM_NAMES,
  MUSIC_WAVEFORM_PRIMITIVES,
  MusicWaveform,
  decodeMusic,
  generateNoiseWaveform,
  musicNoteName,
  renderMusicTimeline,
  vibratoPeriodDepth,
  type MusicScheduledNote,
  type MusicTimeline,
} from '../../src/assets/formats/music.ts';

type MusicRegion = 'ntsc' | 'pal';

/** Real tick rate and Paula clock per region — see `AMIGA_PAL_CLOCK`'s doc comment in music.ts. */
const REGION_HZ: Record<MusicRegion, number> = { ntsc: MUSIC_TICK_HZ, pal: MUSIC_TICK_HZ_PAL };
const REGION_CLOCK: Record<MusicRegion, number> = { ntsc: AMIGA_NTSC_CLOCK, pal: AMIGA_PAL_CLOCK };

/** Per-track colour, matching the piano roll and the mute buttons. */
const TRACK_COLORS = ['#6cf', '#f9a', '#9e8'] as const;
const TRACK_ROLES = ['melody', 'bass', 'harmony'] as const;

/** Three tracks at full sustain would clip; leave headroom. */
const MASTER_GAIN = 0.22;

/**
 * Cents of detune equivalent to the driver's `period >> 7` swing. The
 * period ratio is `1 - 1/128`, and frequency is inversely proportional to
 * period, so the swing is `1200 * log2(128/127)` ~= 13.6 cents.
 */
const VIBRATO_CENTS = 1200 * Math.log2(128 / 127);

interface TrackNodes {
  envelope: GainNode;
  mute: GainNode;
  sources: AudioScheduledSourceNode[];
}

export class MusicPlayer {
  private container: HTMLElement;
  private detach: (() => void)[] = [];
  private resizeObserver: ResizeObserver | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;

  private strip: HTMLElement;
  private playBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private loopEl: HTMLInputElement;
  private regionEl: HTMLSelectElement;
  private timeEl: HTMLElement;
  private trackToggleEl: HTMLElement;
  private detailEl: HTMLElement;

  private name = '';
  private timeline: MusicTimeline | null = null;
  private region: MusicRegion = 'ntsc';

  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private vibrato: { osc: OscillatorNode; depth: GainNode } | null = null;
  private tracks: TrackNodes[] = [];
  private noiseBuffer: AudioBuffer | null = null;

  /** `audio.currentTime` the current pass started at. */
  private startedAt = 0;
  /** Seconds into the song the current pass started from (always 0 today). */
  private startOffset = 0;
  private playing = false;
  private raf = 0;

  private muted = [false, false, false];

  constructor(container: HTMLElement) {
    this.container = container;
    this.strip = document.getElementById('music-strip')!;
    this.playBtn = document.getElementById('music-play') as HTMLButtonElement;
    this.stopBtn = document.getElementById('music-stop') as HTMLButtonElement;
    this.loopEl = document.getElementById('music-loop') as HTMLInputElement;
    this.regionEl = document.getElementById('music-region') as HTMLSelectElement;
    this.timeEl = document.getElementById('music-time')!;
    this.trackToggleEl = document.getElementById('music-tracks')!;
    this.detailEl = document.getElementById('music-detail')!;
  }

  // ─── Public API ────────────────────────────────────────────────────────

  /** Load and display `<assetBase>/music/<name>.bin`. */
  async show(assetBase: string, name: string): Promise<void> {
    this.teardown();
    this.container.innerHTML = '';
    this.container.classList.add('music-mode');
    setHidden(this.strip, false);
    this.name = name;

    let data: Uint8Array;
    try {
      const res = await fetch(`${assetBase}/music/${name}.bin`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      this.container.innerHTML =
        '<div class="state-panel state-error"><span class="state-icon">⚠</span>' +
        '<span class="state-title">Failed to load the music stream</span>' +
        '<span class="state-detail">Run <code>npm run build-assets</code> first.</span></div>';
      console.warn('music load failed:', err);
      return;
    }

    try {
      this.timeline = renderMusicTimeline(decodeMusic(data, name));
    } catch (err) {
      this.container.innerHTML =
        '<div class="state-panel state-error"><span class="state-icon">⚠</span>' +
        '<span class="state-title">Failed to decode the music stream</span>' +
        `<span class="state-detail">${String(err)}</span></div>`;
      return;
    }

    this.muted = [false, false, false];
    this.region = 'ntsc';
    this.regionEl.value = 'ntsc';
    this.buildCanvas();
    this.buildTrackToggles();
    this.bindStrip();
    this.updateTransport();
    this.draw();
  }

  hide(): void {
    this.teardown();
    this.container.classList.remove('music-mode');
    setHidden(this.strip, true);
    this.timeline = null;
  }

  /** Human-readable summary for the viewer toolbar. */
  get summary(): string {
    if (!this.timeline) return '';
    const notes = this.timeline.tracks.reduce((n, t) => n + t.notes.length, 0);
    return `3 tracks, ${notes} notes, ${this.timeline.seconds.toFixed(1)}s at ${this.timeline.tickHz} Hz`;
  }

  /** Seconds per tick under the selected playback region — see `REGION_HZ`. */
  private get frameSeconds(): number {
    return 1 / REGION_HZ[this.region];
  }

  /** `frequency * pitchScale` turns an NTSC-derived pitch into the selected region's. */
  private get pitchScale(): number {
    return REGION_CLOCK[this.region] / AMIGA_NTSC_CLOCK;
  }

  /** Total playback length under the selected region (the decoded timeline itself is NTSC-baked). */
  private get totalSeconds(): number {
    return (this.timeline?.frames ?? 0) * this.frameSeconds;
  }

  // ─── Setup ─────────────────────────────────────────────────────────────

  private teardown(): void {
    this.stop();
    for (const off of this.detach) off();
    this.detach = [];
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas?.remove();
    this.canvas = null;
    this.ctx2d = null;
  }

  private on(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.detach.push(() => target.removeEventListener(type, fn));
  }

  private buildCanvas(): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'music-canvas';
    this.container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');

    this.resizeObserver = new ResizeObserver(() => {
      this.sizeCanvas();
      this.draw();
    });
    this.resizeObserver.observe(this.container);
    this.sizeCanvas();
  }

  private sizeCanvas(): void {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }

  private buildTrackToggles(): void {
    this.trackToggleEl.innerHTML = '';
    this.timeline?.tracks.forEach((track, i) => {
      const label = document.createElement('label');
      label.className = 'music-track-toggle';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.id = `music-track-${i}`;
      box.addEventListener('change', () => {
        this.muted[i] = !box.checked;
        this.applyMutes();
        this.draw();
      });
      const swatch = document.createElement('span');
      swatch.className = 'music-track-swatch';
      swatch.style.background = TRACK_COLORS[i];
      const text = document.createElement('span');
      const wave = MUSIC_WAVEFORM_NAMES[track.notes[0]?.waveform ?? MusicWaveform.Sine];
      text.textContent = `${i} ${TRACK_ROLES[i]} · ${track.notes.length}n · ${wave}`;
      label.append(box, swatch, text);
      this.trackToggleEl.appendChild(label);
    });
  }

  private bindStrip(): void {
    this.on(this.playBtn, 'click', () => void this.togglePlay());
    this.on(this.stopBtn, 'click', () => {
      this.stop();
      this.updateTransport();
      this.draw();
    });
    this.on(this.canvas!, 'click', (e) => this.onCanvasClick(e as MouseEvent));
    // Changing region mid-playback would need re-deriving the current offset
    // under the new rate; simplest and least surprising is to stop instead.
    this.on(this.regionEl, 'change', () => {
      this.region = this.regionEl.value === 'pal' ? 'pal' : 'ntsc';
      this.stop();
      this.updateTransport();
      this.draw();
    });
  }

  // ─── Transport ─────────────────────────────────────────────────────────

  private async togglePlay(): Promise<void> {
    if (!this.timeline) return;
    if (this.playing) {
      await this.audio?.suspend();
      this.playing = false;
      cancelAnimationFrame(this.raf);
      this.updateTransport();
      return;
    }
    if (this.audio && this.audio.state === 'suspended' && this.tracks.length > 0) {
      await this.audio.resume();
      this.playing = true;
      this.tick();
      this.updateTransport();
      return;
    }
    await this.start();
  }

  private async start(): Promise<void> {
    if (!this.timeline) return;
    this.stop();

    // Created on the click, so the browser's autoplay policy is satisfied.
    const audio = new AudioContext();
    this.audio = audio;
    await audio.resume();

    const master = audio.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(audio.destination);
    this.master = master;

    // One shared vibrato LFO — the driver's wobble is global-phase, so all
    // three tracks swing together (hunk-1 `$281A`, addr 0x227C). The phase
    // counter advances at the tick rate, so its rate scales with region too.
    const lfo = audio.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = REGION_HZ[this.region] / MUSIC_VIBRATO_PHASES;
    const depth = audio.createGain();
    depth.gain.value = VIBRATO_CENTS;
    lfo.connect(depth);
    this.vibrato = { osc: lfo, depth };

    const t0 = audio.currentTime + 0.08; // a beat of scheduling headroom
    this.startedAt = t0;
    this.startOffset = 0;

    this.tracks = this.timeline.tracks.map((track, i) => {
      const envelope = audio.createGain();
      const mute = audio.createGain();
      envelope.connect(mute);
      mute.connect(master);
      mute.gain.value = this.muted[i] ? 0 : 1;

      this.scheduleEnvelope(envelope, track.envelope, t0);
      const sources = this.scheduleSources(audio, envelope, depth, track.notes, t0);
      return { envelope, mute, sources };
    });

    lfo.start(t0);
    this.playing = true;
    this.tick();
    this.updateTransport();
  }

  private scheduleEnvelope(
    gain: GainNode,
    points: readonly { frame: number; value: number }[],
    t0: number,
  ): void {
    gain.gain.cancelScheduledValues(0);
    gain.gain.setValueAtTime(0, t0);
    for (const p of points) {
      const at = t0 + p.frame * this.frameSeconds;
      gain.gain.linearRampToValueAtTime(p.value / MUSIC_MAX_VOLUME, at);
    }
  }

  /**
   * One source node per run of consecutive same-waveform notes. Rests keep
   * the run alive — the driver never stops the DMA for a rest, it only
   * releases the envelope, which the gain automation already does.
   */
  private scheduleSources(
    audio: AudioContext,
    envelope: GainNode,
    vibratoDepth: GainNode,
    notes: readonly MusicScheduledNote[],
    t0: number,
  ): AudioScheduledSourceNode[] {
    const sources: AudioScheduledSourceNode[] = [];
    let runStart = 0;
    while (runStart < notes.length) {
      let runEnd = runStart + 1;
      while (runEnd < notes.length && notes[runEnd].waveform === notes[runStart].waveform) runEnd++;

      const run = notes.slice(runStart, runEnd);
      const startTime = t0 + run[0].startFrame * this.frameSeconds;
      const last = run[run.length - 1];
      const stopTime = t0 + (last.startFrame + last.frames) * this.frameSeconds;

      const source =
        run[0].waveform === MusicWaveform.Noise
          ? this.buildNoiseSource(audio, run, t0)
          : this.buildOscillator(audio, run, t0, vibratoDepth);
      source.connect(envelope);
      source.start(startTime);
      source.stop(stopTime);
      sources.push(source);
      runStart = runEnd;
    }
    return sources;
  }

  private buildOscillator(
    audio: AudioContext,
    run: readonly MusicScheduledNote[],
    t0: number,
    vibratoDepth: GainNode,
  ): OscillatorNode {
    const osc = audio.createOscillator();
    if (run[0].waveform === MusicWaveform.Square) {
      osc.type = 'square';
    } else {
      osc.setPeriodicWave(this.periodicWaveFor(audio, run[0].waveform));
    }

    let lastFrequency = 0;
    for (const note of run) {
      const at = t0 + note.startFrame * this.frameSeconds;
      // A rest holds the previous pitch: the driver leaves AUDxPER alone
      // and only forces the release phase (addr 0x22FE).
      const frequency = note.frequency || lastFrequency;
      if (frequency > 0 && frequency !== lastFrequency) {
        osc.frequency.setValueAtTime(frequency * this.pitchScale, at);
        lastFrequency = frequency;
      }
    }
    if (lastFrequency === 0) osc.frequency.setValueAtTime(1, t0);
    if (run.some((n) => n.vibrato)) vibratoDepth.connect(osc.detune);
    return osc;
  }

  private buildNoiseSource(
    audio: AudioContext,
    run: readonly MusicScheduledNote[],
    t0: number,
  ): AudioBufferSourceNode {
    const source = audio.createBufferSource();
    source.buffer = this.getNoiseBuffer(audio);
    source.loop = true;
    // Paula consumes one sample per `period` clock ticks, i.e. at
    // `clock / period` = `frequency * 8` samples a second. The buffer is
    // created at the context's own rate, so that ratio is the playback rate.
    for (const note of run) {
      if (!note.period) continue;
      const paulaRate = note.frequency * this.pitchScale * MUSIC_SAMPLES_PER_CYCLE;
      source.playbackRate.setValueAtTime(
        Math.max(0.02, paulaRate / audio.sampleRate),
        t0 + note.startFrame * this.frameSeconds,
      );
    }
    return source;
  }

  private getNoiseBuffer(audio: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const samples = generateNoiseWaveform();
    const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 128;
    this.noiseBuffer = buffer;
    return buffer;
  }

  /**
   * A `PeriodicWave` whose harmonics are the real DFT of the stored 8-byte
   * cycle. Eight samples give a DC term plus four harmonics; `PeriodicWave`
   * synthesises them band-limited, so this keeps W0's and W2's timbres
   * distinct without reproducing Paula's stepped aliasing.
   */
  private periodicWaveFor(audio: AudioContext, waveform: MusicWaveform): PeriodicWave {
    const cycle = MUSIC_WAVEFORM_PRIMITIVES[waveform];
    const n = cycle.length;
    const harmonics = n / 2 + 1;
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);
    for (let k = 0; k < harmonics; k++) {
      let re = 0;
      let im = 0;
      for (let t = 0; t < n; t++) {
        const angle = (-2 * Math.PI * k * t) / n;
        re += (cycle[t] / 128) * Math.cos(angle);
        im += (cycle[t] / 128) * Math.sin(angle);
      }
      // WebAudio's convention is sum(real*cos - imag*sin), hence the flip.
      real[k] = (2 * re) / n;
      imag[k] = (-2 * im) / n;
    }
    real[0] = 0; // no DC offset
    imag[0] = 0;
    return audio.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  private applyMutes(): void {
    this.tracks.forEach((t, i) => {
      t.mute.gain.value = this.muted[i] ? 0 : 1;
    });
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.playing = false;
    for (const track of this.tracks) {
      for (const source of track.sources) {
        try {
          source.stop();
        } catch {
          // Already stopped, or never started — nothing to undo.
        }
        source.disconnect();
      }
      track.envelope.disconnect();
      track.mute.disconnect();
    }
    this.tracks = [];
    try {
      this.vibrato?.osc.stop();
    } catch {
      // Same.
    }
    this.vibrato?.osc.disconnect();
    this.vibrato?.depth.disconnect();
    this.vibrato = null;
    this.master?.disconnect();
    this.master = null;
    void this.audio?.close();
    this.audio = null;
    this.startedAt = 0;
    this.startOffset = 0;
  }

  /** Seconds into the song, clamped to its length. */
  private get position(): number {
    if (!this.timeline || !this.audio || this.startedAt === 0) return 0;
    const t = this.startOffset + (this.audio.currentTime - this.startedAt);
    return Math.max(0, Math.min(this.totalSeconds, t));
  }

  private tick = (): void => {
    if (!this.playing || !this.timeline) return;
    const done = this.audio!.currentTime - this.startedAt >= this.totalSeconds;
    if (done) {
      if (this.loopEl.checked) {
        void this.start();
        return;
      }
      this.stop();
      this.updateTransport();
      this.draw();
      return;
    }
    this.updateTransport();
    this.draw();
    this.raf = requestAnimationFrame(this.tick);
  };

  private updateTransport(): void {
    this.playBtn.textContent = this.playing ? '⏸ Pause' : '▶ Play';
    this.playBtn.dataset.state = this.playing ? 'playing' : 'stopped';
    this.stopBtn.disabled = !this.audio;
    this.timeEl.textContent = `${formatTime(this.position)} / ${formatTime(this.totalSeconds)}`;
    this.strip.dataset.state = this.playing ? 'playing' : this.audio ? 'paused' : 'stopped';
  }

  // ─── Piano roll ────────────────────────────────────────────────────────

  private onCanvasClick(e: MouseEvent): void {
    if (!this.timeline || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const frame = ((e.clientX - rect.left) / rect.width) * this.timeline.frames;
    const parts: string[] = [];
    this.timeline.tracks.forEach((track, i) => {
      const note = track.notes.find((n) => frame >= n.startFrame && frame < n.startFrame + n.frames);
      if (!note) return;
      parts.push(
        `T${i} ${musicNoteName(note.note)}` +
          (note.note ? ` period ${note.period} (${note.frequency.toFixed(1)} Hz)` : '') +
          ` · ${note.frames}f · @${note.offset}` +
          (note.vibrato ? ` · vib ±${vibratoPeriodDepth(note.period)}` : ''),
      );
    });
    this.detailEl.textContent = parts.join('   |   ') || `frame ${Math.round(frame)}`;
  }

  private draw(): void {
    const ctx = this.ctx2d;
    const canvas = this.canvas;
    if (!ctx || !canvas || !this.timeline) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, w, h);

    const pad = 10 * dpr;
    const plotW = w - pad * 2;
    const plotH = h - pad * 2;

    let lo = Infinity;
    let hi = -Infinity;
    for (const track of this.timeline.tracks) {
      for (const note of track.notes) {
        if (!note.note) continue;
        lo = Math.min(lo, note.note);
        hi = Math.max(hi, note.note);
      }
    }
    if (!Number.isFinite(lo)) return;
    lo -= 1;
    hi += 2;

    const xOf = (frame: number) => pad + (frame / this.timeline!.frames) * plotW;
    const yOf = (note: number) => pad + plotH - ((note - lo) / (hi - lo)) * plotH;
    const rowH = Math.max(2 * dpr, plotH / (hi - lo));

    // Octave gridlines.
    ctx.strokeStyle = '#1e1e28';
    ctx.lineWidth = dpr;
    for (let n = Math.ceil(lo / 12) * 12; n <= hi; n += 12) {
      ctx.beginPath();
      ctx.moveTo(pad, Math.round(yOf(n)) + 0.5);
      ctx.lineTo(w - pad, Math.round(yOf(n)) + 0.5);
      ctx.stroke();
    }

    this.timeline.tracks.forEach((track, i) => {
      ctx.fillStyle = TRACK_COLORS[i];
      ctx.globalAlpha = this.muted[i] ? 0.18 : 0.9;
      for (const note of track.notes) {
        if (!note.note) continue;
        const x = xOf(note.startFrame);
        const width = Math.max(1.5 * dpr, xOf(note.startFrame + note.frames) - x - dpr);
        ctx.fillRect(x, yOf(note.note) - rowH / 2, width, rowH);
      }
    });
    ctx.globalAlpha = 1;

    if (this.audio) {
      const x = Math.round(xOf(this.position / this.frameSeconds)) + 0.5;
      ctx.strokeStyle = this.playing ? '#ffd24a' : '#8a8a8a';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, h - pad);
      ctx.stroke();
    }

    ctx.fillStyle = '#7a7a88';
    ctx.font = `${11 * dpr}px monospace`;
    ctx.fillText(
      `${this.name} — ${musicNoteName(lo + 1)} … ${musicNoteName(hi - 2)} · ${this.timeline.frames} frames @ ${REGION_HZ[this.region]} Hz${this.region === 'pal' ? ' (PAL sim)' : ''}`,
      pad,
      pad + 11 * dpr,
    );
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
