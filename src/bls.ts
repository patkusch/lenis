// Sway — bilateral stimulation engine.
// Drives a canvas target that eases side to side (decelerating at the edges,
// the way a therapist's hand does), with optional stereo-panned audio pings
// and haptic taps synced to each edge. All local; nothing leaves the device.

export interface SwayOptions {
  /** Seconds for one left→right pass. Lower = faster. ~0.9s is a common pace. */
  secondsPerPass: number;
  audio: boolean;
  haptics: boolean;
  /** CSS color for the orb. */
  color: string;
  /** Orb radius as a fraction of the smaller viewport dimension (0–1). */
  sizeFraction: number;
}

const DEFAULTS: SwayOptions = {
  secondsPerPass: 0.9,
  audio: true,
  haptics: true,
  color: "#8ec5ff",
  sizeFraction: 0.05,
};

export class SwayEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: SwayOptions;
  private raf = 0;
  private startTs = 0;
  private lastVel = 0;
  private running = false;
  private dpr = 1;

  // audio
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Pre-generated fluff so the fur doesn't flicker frame to frame.
  private fur: { angle: number; len: number; width: number }[] = [];
  private tuft: { angle: number; len: number; width: number }[] = [];

  /** Called on each edge with the side just reached (-1 left, +1 right). */
  onEdge?: (side: -1 | 1) => void;

  constructor(canvas: HTMLCanvasElement, opts: Partial<SwayOptions> = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.opts = { ...DEFAULTS, ...opts };
    this.generateFur();
    this.resize();
  }

  private generateFur() {
    const N = 140;
    this.fur = [];
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.06;
      this.fur.push({
        angle,
        len: 0.9 + Math.random() * 0.55,
        width: 0.5 + Math.random() * 0.85,
      });
    }
    // a few wispy hairs sticking up off the top
    this.tuft = [];
    for (let i = 0; i < 5; i++) {
      this.tuft.push({
        angle: -Math.PI / 2 + (Math.random() - 0.5) * 0.8,
        len: 1.55 + Math.random() * 0.8,
        width: 0.4 + Math.random() * 0.5,
      });
    }
  }

  setOptions(opts: Partial<SwayOptions>) {
    this.opts = { ...this.opts, ...opts };
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth, clientHeight } = this.canvas;
    this.canvas.width = Math.round(clientWidth * this.dpr);
    this.canvas.height = Math.round(clientHeight * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Paint a clean background so trails start from a solid frame.
    this.ctx.fillStyle = "#0b0d1a";
    this.ctx.fillRect(0, 0, clientWidth, clientHeight);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startTs = performance.now();
    this.lastVel = 0;
    if (this.opts.audio) this.initAudio();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.masterGain && this.audioCtx) {
      // fade out gently to avoid a click
      const now = this.audioCtx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(0, now, 0.05);
    }
  }

  destroy() {
    this.stop();
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }

  private initAudio() {
    if (this.audioCtx) {
      this.audioCtx.resume().catch(() => {});
      return;
    }
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.audioCtx = new Ctor();
    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.value = 0.9;
    this.masterGain.connect(this.audioCtx.destination);
  }

  /** A short, soft, stereo-panned tone — the classic BLS "tock". */
  private ping(side: -1 | 1) {
    if (!this.audioCtx || !this.masterGain) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    // Slightly different pitch per side helps the brain register the crossover.
    osc.frequency.value = side < 0 ? 196 : 246.94; // G3 / B3

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    const panner = ctx.createStereoPanner();
    panner.pan.value = side * 0.85;

    osc.connect(gain).connect(panner).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  private tap() {
    if (this.opts.haptics && "vibrate" in navigator) {
      navigator.vibrate?.(18);
    }
  }

  private frame = () => {
    if (!this.running) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const t = (performance.now() - this.startTs) / 1000;

    // One full cycle (left→right→left) = 2 passes.
    const omega = Math.PI / this.opts.secondsPerPass; // rad/s
    const phase = omega * t;
    const xNorm = Math.sin(phase); // -1..1, eased at edges
    const vel = Math.cos(phase); // sign of motion

    // Edge crossing: velocity changed sign since last frame → hit an extreme.
    if (this.lastVel !== 0 && Math.sign(vel) !== Math.sign(this.lastVel)) {
      const side: -1 | 1 = xNorm >= 0 ? 1 : -1;
      if (this.opts.audio) this.ping(side);
      this.tap();
      this.onEdge?.(side);
    }
    this.lastVel = vel;

    const margin = Math.min(w, h) * (this.opts.sizeFraction + 0.04);
    const cx = w / 2 + (xNorm * (w / 2 - margin));
    const cy = h / 2;
    const r = Math.min(w, h) * this.opts.sizeFraction;

    // Fade the previous frame slightly instead of clearing → soft motion trail.
    // Kept light so the furry detail stays crisp rather than smearing.
    this.ctx.fillStyle = "rgba(11, 13, 26, 0.55)";
    this.ctx.fillRect(0, 0, w, h);

    // Glow
    const grad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2);
    grad.addColorStop(0, this.opts.color);
    grad.addColorStop(0.35, hexWithAlpha(this.opts.color, 0.55));
    grad.addColorStop(1, hexWithAlpha(this.opts.color, 0));
    this.ctx.fillStyle = grad;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r * 3.2, 0, Math.PI * 2);
    this.ctx.fill();

    // Friendly fluff creature — the light your eyes follow.
    this.drawFluff(cx, cy, r * 1.3, Math.sign(vel) || 1);

    this.raf = requestAnimationFrame(this.frame);
  };

  /** Draws a chubby, fluffy creature centred at (cx, cy). `glance` (-1|1) tips
   *  the eyes toward the direction of travel to give it a little life. */
  private drawFluff(cx: number, cy: number, R: number, glance: number) {
    const ctx = this.ctx;
    const rx = R * 1.22; // chubby: a touch wider than tall
    const ry = R * 1.05;

    ctx.lineCap = "round";

    // --- Fur, drawn behind the body so the edge reads as fluff ---
    ctx.strokeStyle = "rgba(238, 242, 255, 0.85)";
    for (const f of this.fur) {
      const hang = Math.sin(f.angle) > 0 ? 1.12 : 1.0; // longer strands underneath
      const inner = 0.8;
      const x1 = cx + Math.cos(f.angle) * rx * inner;
      const y1 = cy + Math.sin(f.angle) * ry * inner;
      const out = (1.0 + 0.24 * f.len) * hang;
      const x2 = cx + Math.cos(f.angle) * rx * out;
      const y2 = cy + Math.sin(f.angle) * ry * out;
      ctx.lineWidth = Math.max(1, R * 0.05 * f.width);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    // wispy hairs sticking up off the top
    ctx.strokeStyle = "rgba(240, 243, 255, 0.9)";
    for (const t of this.tuft) {
      const x1 = cx + Math.cos(t.angle) * rx * 0.7;
      const y1 = cy + Math.sin(t.angle) * ry * 0.85;
      const x2 = cx + Math.cos(t.angle) * rx * t.len;
      const y2 = cy + Math.sin(t.angle) * ry * t.len;
      ctx.lineWidth = Math.max(1, R * 0.045 * t.width);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(x1 + R * 0.12, (y1 + y2) / 2, x2, y2);
      ctx.stroke();
    }

    // --- Body ---
    ctx.fillStyle = "#f7f9ff";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // soft shading for a round, plush feel
    const shade = ctx.createRadialGradient(
      cx - rx * 0.3,
      cy - ry * 0.4,
      R * 0.1,
      cx,
      cy,
      rx * 1.15,
    );
    shade.addColorStop(0, "rgba(255, 255, 255, 0.9)");
    shade.addColorStop(1, "rgba(205, 216, 255, 0.22)");
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- Face: chubby → eyes sit low and wide, big and glossy ---
    const eyeDX = rx * 0.34;
    const eyeY = cy + ry * 0.06;
    const eyeR = R * 0.19;

    // blush
    ctx.fillStyle = "rgba(255, 158, 173, 0.4)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * rx * 0.56, eyeY + R * 0.26, R * 0.16, R * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // eyes with catch-lights
    for (const s of [-1, 1]) {
      const ex = cx + s * eyeDX + glance * R * 0.05;
      ctx.fillStyle = "#1b1e34";
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeR, eyeR * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.beginPath();
      ctx.arc(ex - eyeR * 0.3, eyeY - eyeR * 0.4, eyeR * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + eyeR * 0.28, eyeY + eyeR * 0.18, eyeR * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }

    // little smile
    ctx.strokeStyle = "#1b1e34";
    ctx.lineWidth = Math.max(1.5, R * 0.05);
    ctx.beginPath();
    ctx.arc(cx, eyeY + R * 0.26, R * 0.17, 0.15 * Math.PI, 0.85 * Math.PI, false);
    ctx.stroke();
  }
}

/** Accepts #rrggbb and returns rgba() with the given alpha. */
function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
