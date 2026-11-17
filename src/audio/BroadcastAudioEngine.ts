import { YouTubeBgmPlayer } from "./YouTubeBgmPlayer";

const MARK_SIX_BGM_YOUTUBE_ID = "3oA9HL20tDo";

/**
 * Broadcast sound engine for the Halogen III simulator.
 * Drives hidden YouTube IFrame BGM (Shocking Blue - Inkpot, videoId lAwiWIBOz24) with
 * automatic fallback to procedural Web Audio groove + stereo polymer clacks and chimes.
 */
export class BroadcastAudioEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private pinkLoopBuffer: AudioBuffer | null = null;
  private bgmGain: GainNode | null = null;
  private bgmTimer: number | null = null;
  private bgmNextNoteTime = 0;
  private bgmStep = 0;
  private readonly ytBgm: YouTubeBgmPlayer;
  enabled = true;

  constructor() {
    this.ytBgm = new YouTubeBgmPlayer(MARK_SIX_BGM_YOUTUBE_ID, () => {
      this.startFallbackSynthBgm();
    });
  }

  unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.noiseBuffer = this.createNoiseBuffer(this.ctx, 0.08);
      this.pinkLoopBuffer = this.createPinkNoiseBuffer(this.ctx, 2.2);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.24;
      this.bgmGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume().then(() => {
        if (this.enabled) this.startBgm();
      });
    } else if (this.ctx.state === "running") {
      this.startBgm();
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) {
      this.unlock();
      if (this.bgmGain && this.ctx) {
        this.bgmGain.gain.setTargetAtTime(0.24, this.ctx.currentTime, 0.05);
      }
      this.startBgm();
    } else {
      this.stopBgm();
    }
  }

  setMotorLevel(_speedNorm: number): void {
    // Continuous background noise loop intentionally omitted to avoid static hiss
  }

  private startBgm(): void {
    if (!this.enabled) return;
    if (this.ytBgm.isUnavailable) {
      this.startFallbackSynthBgm();
      return;
    }
    this.stopFallbackSynthBgm();
    this.ytBgm.play();
  }

  private startFallbackSynthBgm(): void {
    if (!this.enabled || !this.ctx || !this.bgmGain || this.bgmTimer !== null) return;
    this.bgmGain.gain.setTargetAtTime(0.24, this.ctx.currentTime, 0.06);
    this.bgmNextNoteTime = this.ctx.currentTime + 0.04;
    const stepDuration = 60 / 116 / 4;
    this.bgmTimer = window.setInterval(() => {
      if (!this.ctx || !this.enabled || this.ctx.state !== "running") return;
      while (this.bgmNextNoteTime < this.ctx.currentTime + 0.14) {
        this.scheduleBgmStep(this.bgmStep, this.bgmNextNoteTime, stepDuration);
        this.bgmNextNoteTime += stepDuration;
        this.bgmStep = (this.bgmStep + 1) % 64;
      }
    }, 35);
  }

  private stopFallbackSynthBgm(): void {
    if (this.bgmTimer !== null) {
      window.clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    if (this.bgmGain && this.ctx) {
      this.bgmGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.04);
    }
  }

  private stopBgm(): void {
    this.ytBgm.pause();
    this.stopFallbackSynthBgm();
  }

  private duckBgm(durationSec = 0.65): void {
    if (!this.enabled) return;
    if (this.ytBgm.isAvailableAndReady) {
      this.ytBgm.duck(durationSec);
      return;
    }
    if (!this.bgmGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.bgmGain.gain.cancelScheduledValues(now);
    this.bgmGain.gain.setTargetAtTime(0.11, now, 0.04);
    this.bgmGain.gain.setTargetAtTime(0.24, now + durationSec, 0.25);
  }

  private scheduleBgmStep(step: number, t: number, stepDur: number): void {
    if (!this.ctx || !this.bgmGain) return;
    const bar = Math.floor(step / 16);
    const s = step % 16;

    // 4-bar 70s TV-studio Em7 - A9 - Gmaj7 - B7#9 groove bassline (Hz)
    const bassBars: readonly (readonly (number | 0)[])[] = [
      // Bar 1: E2 -> G2 -> A2 -> B2 syncopated bounce
      [82.41, 0, 82.41, 0, 0, 98.0, 110.0, 0, 123.47, 0, 110.0, 0, 98.0, 0, 73.42, 82.41],
      // Bar 2: A2 funk octave walk
      [110.0, 0, 110.0, 0, 0, 130.81, 146.83, 0, 164.81, 0, 146.83, 0, 130.81, 0, 98.0, 110.0],
      // Bar 3: G2 upbeat walkdown
      [98.0, 0, 98.0, 0, 0, 123.47, 146.83, 0, 164.81, 0, 146.83, 0, 123.47, 0, 110.0, 98.0],
      // Bar 4: B1 -> D2 -> E2 -> F#2 turnaround
      [61.74, 0, 61.74, 0, 0, 73.42, 82.41, 0, 92.5, 0, 98.0, 0, 110.0, 0, 123.47, 0],
    ];
    const bassFreq = bassBars[bar][s];
    if (bassFreq > 0) {
      const osc = this.ctx.createOscillator();
      const sub = this.ctx.createOscillator();
      const lp = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      osc.type = "sawtooth";
      sub.type = "triangle";
      osc.frequency.setValueAtTime(bassFreq, t);
      sub.frequency.setValueAtTime(bassFreq, t);

      lp.type = "lowpass";
      lp.frequency.setValueAtTime(520, t);
      lp.frequency.exponentialRampToValueAtTime(190, t + stepDur * 1.4);
      lp.Q.value = 2.2;

      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.24, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 1.55);

      osc.connect(lp);
      sub.connect(lp);
      lp.connect(g);
      g.connect(this.bgmGain);
      osc.start(t);
      sub.start(t);
      osc.stop(t + stepDur * 1.6);
      sub.stop(t + stepDur * 1.6);
    }

    // Warm Rhodes / retro electric organ stabs on syncopated funk backbeats
    const chordHits = s === 4 || s === 7 || s === 12 || (bar === 3 && s === 14);
    if (chordHits) {
      const chordVoicings: readonly (readonly number[])[] = [
        [329.63, 392.0, 493.88, 587.33], // Em7
        [277.18, 392.0, 493.88, 554.37], // A9
        [293.66, 392.0, 493.88, 587.33], // G6/9
        [311.13, 440.0, 493.88, 587.33], // B7sus/9
      ];
      const dur = s === 7 ? stepDur * 2.4 : stepDur * 1.1;
      for (const f of chordVoicings[bar]) {
        const osc = this.ctx.createOscillator();
        const lp = this.ctx.createBiquadFilter();
        const g = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, t);
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(1450, t);
        g.gain.setValueAtTime(0.0008, t);
        g.gain.linearRampToValueAtTime(0.048, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
        osc.connect(lp);
        lp.connect(g);
        g.connect(this.bgmGain);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      }
    }

    // Subtle brushed kick on 1 & 3 + soft crisp closed hi-hat groove (very quiet, non-harsh)
    if (s === 0 || s === 8 || (bar % 2 === 1 && s === 10)) {
      const kick = this.ctx.createOscillator();
      const kg = this.ctx.createGain();
      kick.type = "sine";
      kick.frequency.setValueAtTime(112, t);
      kick.frequency.exponentialRampToValueAtTime(48, t + 0.09);
      kg.gain.setValueAtTime(0.22, t);
      kg.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      kick.connect(kg);
      kg.connect(this.bgmGain);
      kick.start(t);
      kick.stop(t + 0.12);
    }

    if (this.noiseBuffer && s % 2 === 0) {
      const hat = this.ctx.createBufferSource();
      hat.buffer = this.noiseBuffer;
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 6800;
      const hg = this.ctx.createGain();
      const accent = s % 4 === 2 ? 0.028 : 0.014;
      hg.gain.setValueAtTime(accent, t);
      hg.gain.exponentialRampToValueAtTime(0.0004, t + 0.032);
      hat.connect(hp);
      hp.connect(hg);
      hg.connect(this.bgmGain);
      hat.start(t);
      hat.stop(t + 0.038);
    }
  }

  playClack(strength: number, panX = 0): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    const s = Math.max(0.05, Math.min(1, strength));
    const amp = 0.028 + s * 0.095;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, panX));
    panner.connect(this.ctx.destination);

    // 1. Crisp polycarbonate contact transient (short bandpass noise impulse, no pitch sweep)
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1850 + Math.random() * 1450;
      bp.Q.value = 2.6;

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.0005, now);
      nGain.gain.linearRampToValueAtTime(amp * 1.15, now + 0.0012);
      nGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.016);

      noise.connect(bp);
      bp.connect(nGain);
      nGain.connect(panner);
      noise.start(now);
      noise.stop(now + 0.022);
    }

    // 2. Dual micro modal polymer shell ping (fixed modal frequencies — crisp, non-laser)
    const f1 = 1520 + Math.random() * 780;
    const f2 = f1 * (1.43 + Math.random() * 0.14);
    for (const [freq, ratio, decay] of [
      [f1, 0.34, 0.015],
      [f2, 0.22, 0.011],
    ] as const) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(amp * ratio, now);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + decay);

      osc.connect(gain);
      gain.connect(panner);
      osc.start(now);
      osc.stop(now + decay + 0.004);
    }

    // 3. Subtle acrylic bowl thump on firm impacts
    if (s > 0.42) {
      const thud = this.ctx.createOscillator();
      const tGain = this.ctx.createGain();
      thud.type = "sine";
      thud.frequency.setValueAtTime(215 + Math.random() * 65, now);
      tGain.gain.setValueAtTime(amp * 0.32, now);
      tGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.026);
      thud.connect(tGain);
      tGain.connect(panner);
      thud.start(now);
      thud.stop(now + 0.03);
    }
  }

  playCapture(isSpecial: boolean): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;

    // 1. Crisp mechanical pocket latch click + low pneumatic cushion thump
    this.playClack(0.55, 0);

    const thump = this.ctx.createOscillator();
    const thumpGain = this.ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(isSpecial ? 148 : 126, now);
    thump.frequency.exponentialRampToValueAtTime(68, now + 0.085);
    thumpGain.gain.setValueAtTime(0.08, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.095);
    thump.connect(thumpGain);
    thumpGain.connect(this.ctx.destination);
    thump.start(now);
    thump.stop(now + 0.10);

    // 2. Soft rising air-lift tube whoosh
    if (this.pinkLoopBuffer) {
      const air = this.ctx.createBufferSource();
      air.buffer = this.pinkLoopBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.6;
      bp.frequency.setValueAtTime(260, now);
      bp.frequency.exponentialRampToValueAtTime(isSpecial ? 840 : 680, now + 0.48);

      const aGain = this.ctx.createGain();
      aGain.gain.setValueAtTime(0.001, now);
      aGain.gain.linearRampToValueAtTime(0.042, now + 0.08);
      aGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.52);

      air.connect(bp);
      bp.connect(aGain);
      aGain.connect(this.ctx.destination);
      air.start(now);
      air.stop(now + 0.55);
    }
  }

  playTrackSettle(isSpecial: boolean): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    this.duckBgm(0.55);

    // Tactile track ball kiss + subtle double rebound
    this.playClack(0.75, isSpecial ? 0.55 : -0.55);

    // Warm studio vibraphone-like broadcast chime (soft attack + natural harmonic)
    const freqs = isSpecial ? [587.33, 880.0, 1174.66] : [523.25, 783.99];
    freqs.forEach((f, idx) => {
      if (!this.ctx) return;
      const start = now + 0.04 + idx * 0.085;
      this.playSoftStudioChimeNote(f, start, isSpecial ? 0.09 : 0.068, isSpecial ? 0.72 : 0.50);
    });
  }

  playDrawFanfare(): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    this.duckBgm(0.9);
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.playSoftStudioChimeNote(f, now + i * 0.10, 0.075, 0.68);
    });
  }

  /** Plays tiered celebration fanfare; Tier 1 (Jackpot) plays an extended grand golden arpeggio chord. */
  playWinFanfare(tier: number): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    this.duckBgm(tier === 1 ? 1.8 : 1.2);

    if (tier === 1) {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0];
      notes.forEach((f, i) => {
        this.playSoftStudioChimeNote(f, now + i * 0.09, 0.10, i === notes.length - 1 ? 1.6 : 0.85);
      });
      // Grand shimmering sustain chord hit at resolution
      [1046.5, 1318.51, 1567.98, 2093.0].forEach((f) => {
        this.playSoftStudioChimeNote(f, now + 0.68, 0.065, 1.85);
      });
      return;
    }

    const notes =
      tier <= 3
        ? [523.25, 659.25, 783.99, 1046.5, 1318.51]
        : [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.playSoftStudioChimeNote(
        f,
        now + i * 0.095,
        0.09,
        i === notes.length - 1 ? 1.05 : 0.65,
      );
    });
  }

  private playSoftStudioChimeNote(
    freq: number,
    startTime: number,
    peakGain: number,
    decaySec: number,
  ): void {
    if (!this.ctx) return;
    const fund = this.ctx.createOscillator();
    const overtone = this.ctx.createOscillator();
    const fGain = this.ctx.createGain();
    const oGain = this.ctx.createGain();

    fund.type = "sine";
    fund.frequency.setValueAtTime(freq, startTime);
    overtone.type = "sine";
    overtone.frequency.setValueAtTime(freq * 2.0, startTime);

    fGain.gain.setValueAtTime(0.0005, startTime);
    fGain.gain.linearRampToValueAtTime(peakGain, startTime + 0.016);
    fGain.gain.exponentialRampToValueAtTime(0.0005, startTime + decaySec);

    oGain.gain.setValueAtTime(0.0005, startTime);
    oGain.gain.linearRampToValueAtTime(peakGain * 0.16, startTime + 0.008);
    oGain.gain.exponentialRampToValueAtTime(0.0005, startTime + decaySec * 0.45);

    fund.connect(fGain);
    overtone.connect(oGain);
    fGain.connect(this.ctx.destination);
    oGain.connect(this.ctx.destination);

    fund.start(startTime);
    overtone.start(startTime);
    fund.stop(startTime + decaySec + 0.02);
    overtone.stop(startTime + decaySec * 0.5 + 0.02);
  }

  private createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private createPinkNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Paul Kellet's refined pink-noise filter for warm natural airflow rumble
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return buffer;
  }
}
