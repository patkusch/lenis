import { useEffect, useRef, useState, useCallback } from "react";
import { SwayEngine } from "./bls";

type Phase = "welcome" | "setup" | "session" | "close" | "distress";

interface CheckIn {
  ts: number;
  before: number | null;
  after: number | null;
  durationSec: number;
}

const DURATIONS = [
  { label: "30s", sec: 30 },
  { label: "1 min", sec: 60 },
  { label: "2 min", sec: 120 },
];

const HISTORY_KEY = "sway.history.v1";

function loadHistory(): CheckIn[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(h: CheckIn[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-50)));
  } catch {
    /* private mode / quota — fine, we just don't persist */
  }
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("welcome");

  // session config
  const [durationSec, setDurationSec] = useState(60);
  const [secondsPerPass, setSecondsPerPass] = useState(0.9);
  const [audio, setAudio] = useState(true);
  const [haptics, setHaptics] = useState(true);

  // check-in
  const [before, setBefore] = useState<number | null>(null);
  const [after, setAfter] = useState<number | null>(null);

  return (
    <div className="app">
      {phase === "welcome" && <Welcome onContinue={() => setPhase("setup")} />}

      {phase === "setup" && (
        <Setup
          durationSec={durationSec}
          setDurationSec={setDurationSec}
          secondsPerPass={secondsPerPass}
          setSecondsPerPass={setSecondsPerPass}
          audio={audio}
          setAudio={setAudio}
          haptics={haptics}
          setHaptics={setHaptics}
          before={before}
          setBefore={setBefore}
          onStart={() => setPhase("session")}
        />
      )}

      {phase === "session" && (
        <Session
          durationSec={durationSec}
          secondsPerPass={secondsPerPass}
          audio={audio}
          haptics={haptics}
          onDone={() => setPhase("close")}
          onDistress={() => setPhase("distress")}
        />
      )}

      {phase === "close" && (
        <Close
          before={before}
          after={after}
          setAfter={setAfter}
          durationSec={durationSec}
          onAgain={() => {
            setAfter(null);
            setPhase("setup");
          }}
        />
      )}

      {phase === "distress" && <Distress onBack={() => setPhase("welcome")} />}

      <CrisisFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Welcome / safety gate                                              */
/* ------------------------------------------------------------------ */

function Welcome({ onContinue }: { onContinue: () => void }) {
  const [ack, setAck] = useState(false);
  return (
    <main className="screen center">
      <div className="mark">Sway</div>
      <h1>A place to steady yourself.</h1>
      <p className="lede">
        Sway guides gentle <strong>bilateral stimulation</strong> — a slow,
        side-to-side rhythm for your eyes, ears, or hands. People use it to calm
        down, settle a racing mind, and feel more present.
      </p>

      <div className="card safety">
        <h2>Before we begin</h2>
        <ul>
          <li>
            This is a <strong>self-help calming tool</strong>, not therapy and
            not a medical device.
          </li>
          <li>
            It is <strong>not</strong> guided trauma processing. Full EMDR should
            only be done with a licensed therapist.
          </li>
          <li>
            If you start to feel overwhelmed, <strong>stop</strong> — a button is
            always on screen.
          </li>
          <li>
            Everything stays <strong>on your device</strong>. No account, no
            upload, no tracking.
          </li>
        </ul>
        <label className="ack">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          <span>I understand this is a grounding aid, not a substitute for professional care.</span>
        </label>
      </div>

      <button className="primary" disabled={!ack} onClick={onContinue}>
        Continue
      </button>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

function Setup(props: {
  durationSec: number;
  setDurationSec: (n: number) => void;
  secondsPerPass: number;
  setSecondsPerPass: (n: number) => void;
  audio: boolean;
  setAudio: (b: boolean) => void;
  haptics: boolean;
  setHaptics: (b: boolean) => void;
  before: number | null;
  setBefore: (n: number) => void;
  onStart: () => void;
}) {
  return (
    <main className="screen">
      <h1 className="tight">Set your pace</h1>
      <p className="lede">Softer and slower is usually better. You can change it anytime.</p>

      <div className="card">
        <div className="field">
          <label>Length</label>
          <div className="segmented">
            {DURATIONS.map((d) => (
              <button
                key={d.sec}
                className={props.durationSec === d.sec ? "seg on" : "seg"}
                onClick={() => props.setDurationSec(d.sec)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>
            Speed <span className="muted">{props.secondsPerPass.toFixed(2)}s per pass</span>
          </label>
          <input
            type="range"
            min={0.5}
            max={1.6}
            step={0.05}
            value={1.6 + 0.5 - props.secondsPerPass}
            onChange={(e) =>
              props.setSecondsPerPass(1.6 + 0.5 - parseFloat(e.target.value))
            }
          />
          <div className="range-ends">
            <span>slower</span>
            <span>faster</span>
          </div>
        </div>

        <div className="field row">
          <Toggle label="Sound" on={props.audio} onChange={props.setAudio} />
          <Toggle label="Vibration" on={props.haptics} onChange={props.setHaptics} />
        </div>
      </div>

      <div className="card">
        <label className="field-label">How anxious do you feel right now?</label>
        <Suds value={props.before} onChange={props.setBefore} />
        <p className="muted small">Optional — we'll check again afterward so you can see any shift.</p>
      </div>

      <button className="primary" onClick={props.onStart}>
        Begin
      </button>
    </main>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <button
      className={on ? "toggle on" : "toggle"}
      onClick={() => onChange(!on)}
      aria-pressed={on}
    >
      <span className="dot" />
      {label}
    </button>
  );
}

const SUDS_FACES = ["😌", "🙂", "😐", "😕", "😟", "😧", "😨", "😰", "😥", "😱", "😭"];

function Suds({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <div className="suds">
        {SUDS_FACES.map((face, i) => (
          <button
            key={i}
            className={value === i ? "suds-btn on" : "suds-btn"}
            onClick={() => onChange(i)}
            aria-label={`${i} out of 10`}
          >
            <span className="suds-face">{face}</span>
            <span className="suds-num">{i}</span>
          </button>
        ))}
      </div>
      <div className="range-ends">
        <span>calm</span>
        <span>very anxious</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Session                                                            */
/* ------------------------------------------------------------------ */

function Session({
  durationSec,
  secondsPerPass,
  audio,
  haptics,
  onDone,
  onDistress,
}: {
  durationSec: number;
  secondsPerPass: number;
  audio: boolean;
  haptics: boolean;
  onDone: () => void;
  onDistress: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SwayEngine | null>(null);
  const [remaining, setRemaining] = useState(durationSec);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const engine = new SwayEngine(canvas, {
      secondsPerPass,
      audio,
      haptics,
      color: "#8ec5ff",
      sizeFraction: 0.045,
    });
    engineRef.current = engine;
    engine.start();

    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);

    const startedAt = Date.now();
    const tick = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const left = Math.max(0, durationSec - elapsed);
      setRemaining(left);
      if (left <= 0) {
        window.clearInterval(tick);
        engine.stop();
        onDone();
      }
    }, 250);

    return () => {
      window.clearInterval(tick);
      window.removeEventListener("resize", onResize);
      engine.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep live controls responsive without restarting the session
  useEffect(() => {
    engineRef.current?.setOptions({ secondsPerPass, audio, haptics });
  }, [secondsPerPass, audio, haptics]);

  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);

  return (
    <div className="session">
      <canvas ref={canvasRef} className="canvas" />
      <div className="session-overlay">
        <p className="follow">Let your eyes follow the light.</p>
        <div className="timer">
          {mins}:{secs.toString().padStart(2, "0")}
        </div>
        <div className="session-actions">
          <button className="ghost" onClick={onDone}>
            Finish early
          </button>
          <button className="stop" onClick={onDistress}>
            Stop — I need help
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Close / re-check                                                   */
/* ------------------------------------------------------------------ */

function Close({
  before,
  after,
  setAfter,
  durationSec,
  onAgain,
}: {
  before: number | null;
  after: number | null;
  setAfter: (n: number) => void;
  durationSec: number;
  onAgain: () => void;
}) {
  const saved = useRef(false);
  useEffect(() => {
    if (after !== null && !saved.current) {
      saved.current = true;
      const h = loadHistory();
      h.push({ ts: Date.now(), before, after, durationSec });
      saveHistory(h);
    }
  }, [after, before, durationSec]);

  const delta = before !== null && after !== null ? before - after : null;

  return (
    <main className="screen center">
      <div className="mark small">Sway</div>
      <h1>Take a slow breath.</h1>
      <p className="lede">Notice your feet on the floor and the room around you.</p>

      <div className="card">
        <label className="field-label">How anxious do you feel now?</label>
        <Suds value={after} onChange={setAfter} />
        {delta !== null && (
          <p className={delta > 0 ? "delta good" : "delta"}>
            {delta > 0
              ? `That's ${delta} point${delta === 1 ? "" : "s"} calmer than when you started.`
              : delta === 0
                ? "About the same — that's okay. Steadiness counts too."
                : "A little higher — be gentle with yourself, and reach out if you need to."}
          </p>
        )}
      </div>

      <button className="primary" onClick={onAgain}>
        Another round
      </button>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Distress                                                           */
/* ------------------------------------------------------------------ */

function Distress({ onBack }: { onBack: () => void }) {
  return (
    <main className="screen center">
      <h1>Let's slow right down.</h1>
      <p className="lede">
        You did the right thing stopping. If this feels like more than a hard
        moment, please reach a real person now — you deserve support.
      </p>
      <div className="card resources">
        <a className="resource" href="tel:988">
          <strong>Call or text 988</strong>
          <span>Suicide &amp; Crisis Lifeline (US) — 24/7</span>
        </a>
        <a className="resource" href="sms:741741&body=HOME">
          <strong>Text HOME to 741741</strong>
          <span>Crisis Text Line (US) — 24/7</span>
        </a>
        <div className="resource static">
          <strong>Outside the US?</strong>
          <span>findahelpline.com lists free lines in your country.</span>
        </div>
      </div>
      <p className="grounding-tip">
        While you wait: name <strong>5 things you can see</strong>, 4 you can
        hear, 3 you can touch. Slow the out-breath.
      </p>
      <button className="ghost wide" onClick={onBack}>
        I'm okay — back to start
      </button>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Always-present crisis footer                                       */
/* ------------------------------------------------------------------ */

function CrisisFooter() {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return (
    <footer className="crisis-footer">
      <button className="crisis-toggle" onClick={toggle}>
        In crisis? Get help now
      </button>
      {open && (
        <div className="crisis-pop">
          <a href="tel:988">Call/Text 988 (US)</a>
          <a href="sms:741741&body=HOME">Text HOME to 741741</a>
          <a href="https://findahelpline.com" target="_blank" rel="noreferrer">
            Find a line worldwide
          </a>
        </div>
      )}
    </footer>
  );
}
