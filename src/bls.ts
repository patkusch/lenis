// Sway — bilateral stimulation engine.
// Drives a canvas target that eases side to side (decelerating at the edges,
// the way a therapist's hand does), with optional stereo-panned audio pings
// and haptic taps synced to each edge. All local; nothing leaves the device.

export type Pattern = "horizontal" | "vertical" | "saccade";

export interface SwayOptions {
  /** Seconds for one left→right pass. Lower = faster. ~0.9s is a common pace. */
  secondsPerPass: number;
  audio: boolean;
  haptics: boolean;
  /** Movement path the target traces. */
  pattern: Pattern;
  /** CSS color for the orb. */
  color: string;
  /** Orb radius as a fraction of the smaller viewport dimension (0–1). */
  sizeFraction: number;
}

const DEFAULTS: SwayOptions = {
  secondsPerPass: 0.9,
  audio: true,
  haptics: true,
  pattern: "horizontal",
  color: "#8ec5ff",
  sizeFraction: 0.05,
};

/** Normalised position (px,py in −1..1) and its per-phase velocity (vx,vy)
 *  for each movement pattern, at the given phase. */
function pathAt(pattern: Pattern, p: number) {
  const sin = Math.sin(p);
  const cos = Math.cos(p);
  if (pattern === "vertical") {
    return { px: 0, py: sin, vx: 0, vy: cos };
  }
  if (pattern === "saccade") {
    // Hold near an edge, then jump quickly to the other — trains saccades
    // rather than smooth pursuit.
    return { px: Math.max(-1, Math.min(1, sin * 3)), py: 0, vx: cos, vy: 0 };
  }
  // horizontal (default)
  return { px: sin, py: 0, vx: cos, vy: 0 };
}

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
  private backFur: Strand[] = [];
  private frontFur: Strand[] = [];
  private tuft: Strand[] = [];
  private stars: { x: number; y: number; r: number; a: number; ph: number; spd: number }[] = [];

  /** Called on each edge with the side just reached (-1 left, +1 right). */
  onEdge?: (side: -1 | 1) => void;

  constructor(canvas: HTMLCanvasElement, opts: Partial<SwayOptions> = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.opts = { ...DEFAULTS, ...opts };
    this.generateFur();
    this.generateStars();
    this.resize();
  }

  private generateStars() {
    this.stars = Array.from({ length: 72 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * 1.4,
      a: 0.25 + Math.random() * 0.55,
      ph: Math.random() * Math.PI * 2,
      spd: 0.5 + Math.random() * 1.2,
    }));
  }

  private generateFur() {
    const mk = (back: boolean): Strand => ({
      angle: Math.random() * Math.PI * 2,
      len: 0.85 + Math.random() * (back ? 0.7 : 0.45),
      width: 0.6 + Math.random() * 0.9,
      curl: (Math.random() - 0.5) * 0.5,
      r0: back ? 0.68 + Math.random() * 0.1 : 0.86 + Math.random() * 0.1,
    });
    // dark, longer underfur (a soft halo) + bright, shorter overfur on the rim
    this.backFur = Array.from({ length: 120 }, () => mk(true));
    this.frontFur = Array.from({ length: 160 }, () => mk(false));
    // wispy hairs sticking up off the top…
    const topWisps = Array.from({ length: 9 }, () => ({
      angle: -Math.PI / 2 + (Math.random() - 0.5) * 1.1,
      len: 1.5 + Math.random() * 1.05,
      width: 0.32 + Math.random() * 0.42,
      curl: (Math.random() - 0.5) * 0.55,
      r0: 0.8,
    }));
    // …plus a few long, thin strays poking out anywhere for a tousled look
    const strays = Array.from({ length: 7 }, () => ({
      angle: Math.random() * Math.PI * 2,
      len: 1.7 + Math.random() * 1.2,
      width: 0.26 + Math.random() * 0.32,
      curl: (Math.random() - 0.5) * 0.75,
      r0: 0.82,
    }));
    this.tuft = [...topWisps, ...strays];
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

  /** A short, soft, stereo-panned tone — the classic BLS "tock".
   *  `pan` is −1 (hard left) … 0 (centre) … 1 (hard right). */
  private ping(pan: number) {
    if (!this.audioCtx || !this.masterGain) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    // Slightly different pitch per side helps the brain register the crossover.
    osc.frequency.value = pan < 0 ? 196 : 246.94; // G3 / B3

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan * 0.85;

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
    const { px, py, vx, vy } = pathAt(this.opts.pattern, phase);

    // Beat on each turnaround of the primary axis (vertical uses the y-axis).
    const primaryVel = this.opts.pattern === "vertical" ? vy : vx;
    if (this.lastVel !== 0 && Math.sign(primaryVel) !== Math.sign(this.lastVel)) {
      const side: -1 | 1 = px >= 0 ? 1 : -1;
      const pan = this.opts.pattern === "vertical" ? 0 : side;
      if (this.opts.audio) this.ping(pan);
      this.tap();
      this.onEdge?.(side);
    }
    this.lastVel = primaryVel;

    const margin = Math.min(w, h) * (this.opts.sizeFraction + 0.04);
    // Cap the travel. Wide, fast arcs are the main cause of dizziness, so keep
    // it to a comfortable visual angle even on large screens.
    const ampX = Math.min(w / 2 - margin, w * 0.3);
    const ampY = Math.min(h / 2 - margin, h * 0.22);
    const cx = w / 2 + px * ampX;
    const cy = h / 2 + py * ampY;
    const r = Math.min(w, h) * this.opts.sizeFraction;

    // Fade the previous frame slightly instead of clearing → soft motion trail.
    // Kept light so the furry detail stays crisp rather than smearing.
    this.ctx.fillStyle = "rgba(11, 13, 26, 0.55)";
    this.ctx.fillRect(0, 0, w, h);

    // Twinkling starfield behind everything.
    for (const s of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * 1.5 * s.spd + s.ph);
      this.ctx.globalAlpha = s.a * tw;
      this.ctx.fillStyle = "#dfe7ff";
      this.ctx.beginPath();
      this.ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1;

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
    // Subtle "breathing" scale gives it life without distracting the eye.
    const breath = 1 + 0.02 * Math.sin(t * 1.1);
    this.drawFluff(cx, cy, r * 1.3 * breath, Math.sign(vx) || 1);

    this.raf = requestAnimationFrame(this.frame);
  };

  /** Draws a single tapered fur strand, shaded by a top-left light. */
  private strand(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    R: number,
    s: Strand,
    lx: number,
    ly: number,
    dim: number,
  ) {
    const ctx = this.ctx;
    const c = Math.cos(s.angle);
    const sn = Math.sin(s.angle);
    const baseX = cx + c * rx * s.r0;
    const baseY = cy + sn * ry * s.r0;
    const out = s.r0 + s.len * 0.42;
    const tipX = cx + c * rx * out - sn * s.curl * R;
    const tipY = cy + sn * ry * out + c * s.curl * R;

    let dx = tipX - baseX;
    let dy = tipY - baseY;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const nx = -dy;
    const ny = dx;
    const w = R * 0.05 * s.width;

    // brightness: fur facing the light is whiter, fur facing away is cooler/darker
    let b = 0.5 + 0.5 * (c * lx + sn * ly);
    b = Math.max(0, Math.min(1, b)) * dim;
    const rr = Math.round(150 + (255 - 150) * b);
    const gg = Math.round(165 + (255 - 165) * b);
    const bb = Math.round(205 + (255 - 205) * b);
    ctx.fillStyle = `rgb(${rr}, ${gg}, ${bb})`;

    ctx.beginPath();
    ctx.moveTo(baseX + nx * w, baseY + ny * w);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(baseX - nx * w, baseY - ny * w);
    ctx.closePath();
    ctx.fill();
  }

  /** Draws a chubby, fluffy creature centred at (cx, cy). `glance` (-1|1) tips
   *  the eyes toward the direction of travel to give it a little life. */
  private drawFluff(cx: number, cy: number, R: number, glance: number) {
    const ctx = this.ctx;
    const rx = R * 1.2;
    const ry = R * 1.05;
    // light comes from the top-left (canvas y grows downward)
    const lx = Math.cos(-2.2);
    const ly = Math.sin(-2.2);

    // --- Soft contact shadow, so it feels like it has volume ---
    const sh = ctx.createRadialGradient(
      cx, cy + ry * 1.25, R * 0.1,
      cx, cy + ry * 1.25, rx * 1.1,
    );
    sh.addColorStop(0, "rgba(0, 0, 0, 0.28)");
    sh.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 1.25, rx * 0.85, ry * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- Dark, longer underfur → a soft halo that reads as depth ---
    for (const s of this.backFur) this.strand(cx, cy, rx, ry, R, s, lx, ly, 0.72);

    // --- Shaded body: a lit sphere, bright top-left → cool bottom-right ---
    const g = ctx.createRadialGradient(
      cx - rx * 0.34, cy - ry * 0.42, R * 0.12,
      cx, cy, rx * 1.12,
    );
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.55, "#eef2ff");
    g.addColorStop(1, "#bfcae6");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // ambient occlusion crescent along the bottom edge
    const ao = ctx.createRadialGradient(
      cx, cy + ry * 0.55, R * 0.2,
      cx, cy + ry * 0.55, ry * 1.1,
    );
    ao.addColorStop(0, "rgba(120, 132, 170, 0)");
    ao.addColorStop(1, "rgba(120, 132, 170, 0.35)");
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = ao;
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    ctx.restore();

    // --- Bright overfur on the rim + wispy top hairs ---
    for (const s of this.frontFur) this.strand(cx, cy, rx, ry, R, s, lx, ly, 1.0);
    for (const t of this.tuft) this.strand(cx, cy, rx, ry, R, t, lx, ly, 1.0);

    // --- Specular sheen, upper-left ---
    const hl = ctx.createRadialGradient(
      cx - rx * 0.32, cy - ry * 0.38, R * 0.04,
      cx - rx * 0.32, cy - ry * 0.38, R * 0.62,
    );
    hl.addColorStop(0, "rgba(255, 255, 255, 0.55)");
    hl.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.3, cy - ry * 0.34, R * 0.52, R * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- Face: chubby → eyes sit low and wide, big and glossy ---
    const eyeDX = rx * 0.34;
    const eyeY = cy + ry * 0.08;
    const eyeR = R * 0.2;

    // blush
    ctx.fillStyle = "rgba(255, 158, 173, 0.45)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * rx * 0.55, eyeY + R * 0.26, R * 0.16, R * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // glossy eyes with a radial sheen + catch-lights
    for (const s of [-1, 1]) {
      const ex = cx + s * eyeDX + glance * R * 0.05;
      const eg = ctx.createRadialGradient(
        ex - eyeR * 0.3, eyeY - eyeR * 0.4, eyeR * 0.1,
        ex, eyeY, eyeR * 1.2,
      );
      eg.addColorStop(0, "#3b4066");
      eg.addColorStop(0.45, "#191c30");
      eg.addColorStop(1, "#0a0c18");
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeR, eyeR * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
      // big catch-light + tiny sparkle
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.beginPath();
      ctx.arc(ex - eyeR * 0.32, eyeY - eyeR * 0.42, eyeR * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + eyeR * 0.28, eyeY + eyeR * 0.2, eyeR * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }

    // little smile
    ctx.strokeStyle = "#191c30";
    ctx.lineWidth = Math.max(1.5, R * 0.05);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, eyeY + R * 0.28, R * 0.17, 0.15 * Math.PI, 0.85 * Math.PI, false);
    ctx.stroke();
  }
}

interface Strand {
  angle: number;
  len: number;
  width: number;
  curl: number;
  r0: number;
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
