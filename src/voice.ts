// Wavelength — client-side vocal signal analysis.
//
// Captures a short mic clip during a check-in and derives a *rough* arousal
// proxy from the voice: pitch variability (Pitchy), speech continuity / pauses,
// and energy (Meyda RMS). Everything runs on-device; audio is never uploaded
// and nothing is persisted.
//
// IMPORTANT FRAMING: this is a proof-of-concept proxy signal, NOT a clinical
// biomarker. Treat the number as a soft nudge, not a measurement.

import { PitchDetector } from "pitchy";
import Meyda from "meyda";

export interface VoiceReading {
  /** 0..1 arousal proxy. ~0.5 is neutral. */
  arousal: number;
  band: "calm" | "settling" | "neutral" | "elevated" | "high";
  meanPitchHz: number;
  pitchVariability: number; // 0..1 (coefficient of variation, normalized)
  speechRate: number; // 0..1 (fraction of frames voiced)
  pauseRatio: number; // 0..1
  energy: number; // 0..1 (normalized RMS)
  clarity: number; // 0..1 mean pitch confidence
  frames: number;
  /** true when there was enough voiced signal to be worth trusting */
  ok: boolean;
}

export class VoiceAnalyzer {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private detector: PitchDetector<Float32Array<ArrayBuffer>> | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private raf = 0;
  private running = false;

  private pitches: number[] = [];
  private clarities: number[] = [];
  private rmss: number[] = [];
  private voicedFrames = 0;

  /** live input level 0..1, for a mic meter */
  onLevel?: (level: number) => void;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    source.connect(this.analyser);

    this.detector = PitchDetector.forFloat32Array(this.analyser.fftSize);
    this.buf = new Float32Array(this.detector.inputLength);

    Meyda.bufferSize = this.analyser.fftSize;
    Meyda.sampleRate = this.ctx.sampleRate;

    this.pitches = [];
    this.clarities = [];
    this.rmss = [];
    this.voicedFrames = 0;
    this.running = true;
    this.loop();
  }

  private loop = () => {
    if (!this.running || !this.analyser || !this.detector || !this.buf || !this.ctx) return;
    this.analyser.getFloatTimeDomainData(this.buf);

    const [pitch, clarity] = this.detector.findPitch(this.buf, this.ctx.sampleRate);

    let rms = rootMeanSquare(this.buf);
    try {
      const f = Meyda.extract("rms", this.buf) as number | null;
      if (typeof f === "number" && !Number.isNaN(f)) rms = f;
    } catch {
      /* fall back to manual RMS above */
    }

    const isVoiced = rms > 0.012 && clarity > 0.6 && pitch > 60 && pitch < 500;
    this.rmss.push(rms);
    if (isVoiced) {
      this.voicedFrames++;
      this.pitches.push(pitch);
      this.clarities.push(clarity);
    }

    this.onLevel?.(Math.min(1, rms * 6));
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Stops capture, releases the mic, and returns the reading. */
  stop(): VoiceReading {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    const reading = this.compute();
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.detector = null;
    return reading;
  }

  private compute(): VoiceReading {
    const frames = this.rmss.length;
    const speechRate = frames ? this.voicedFrames / frames : 0;
    const pauseRatio = 1 - speechRate;
    const meanPitch = mean(this.pitches);
    const pitchStd = std(this.pitches);
    // coefficient of variation, normalized so ~0.25 CV maps to 1.0
    const pitchVariability = meanPitch ? clamp01(pitchStd / meanPitch / 0.25) : 0;
    const energy = clamp01(mean(this.rmss) / 0.12);
    const clarity = mean(this.clarities);

    // Arousal proxy: elevated pitch variability, more continuous speech, and
    // higher energy read as higher arousal. Weighted blend in 0..1.
    const arousal = clamp01(
      0.45 * pitchVariability + 0.3 * speechRate + 0.25 * energy,
    );

    const ok = this.pitches.length >= 8 && frames >= 20;

    return {
      arousal,
      band: bandFor(arousal),
      meanPitchHz: meanPitch,
      pitchVariability,
      speechRate,
      pauseRatio,
      energy,
      clarity,
      frames,
      ok,
    };
  }
}

function bandFor(a: number): VoiceReading["band"] {
  if (a < 0.25) return "calm";
  if (a < 0.42) return "settling";
  if (a < 0.58) return "neutral";
  if (a < 0.75) return "elevated";
  return "high";
}

/** A clearly-labelled fallback reading for when the mic is unavailable
 *  (or for demoing the adaptive step). Not derived from real audio. */
export function sampleReading(arousal: number): VoiceReading {
  return {
    arousal,
    band: bandFor(arousal),
    meanPitchHz: 165,
    pitchVariability: arousal,
    speechRate: 0.4 + arousal * 0.3,
    pauseRatio: 1 - (0.4 + arousal * 0.3),
    energy: 0.4 + arousal * 0.3,
    clarity: 0.9,
    frames: 120,
    ok: true,
  };
}

/* ---- small stats helpers ---- */

function rootMeanSquare(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / a.length);
}

function mean(a: number[]): number {
  if (!a.length) return 0;
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  const v = a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length;
  return Math.sqrt(v);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
