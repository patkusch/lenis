import { useEffect, useRef, useState, useCallback } from "react";
import { SwayEngine, type Pattern } from "./bls";
import { VoiceAnalyzer, sampleReading, type VoiceReading } from "./voice";
import { guideWithRules, type Guidance } from "./coach";
import { Transcriber } from "./transcribe";

const PATTERNS: { key: Pattern; label: string; glyph: string; note: string }[] = [
  { key: "horizontal", label: "Side to side", glyph: "↔", note: "the classic" },
  { key: "vertical", label: "Up & down", glyph: "↕", note: "gentler if dizzy" },
];

type Phase =
  | "welcome"
  | "evidence"
  | "setup"
  | "session"
  | "checkin"
  | "close"
  | "distress";

function paceWord(base: number, next: number): string {
  if (next > base + 0.04) return "slower";
  if (next < base - 0.04) return "a touch quicker";
  return "steady";
}

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
  const [secondsPerPass, setSecondsPerPass] = useState(1.1); // baseline from setup
  const [audio, setAudio] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [pattern, setPattern] = useState<Pattern>("horizontal");

  // adaptive-set state
  const [pace, setPace] = useState(1.1); // active pace for the current set
  const [setNum, setSetNum] = useState(1);
  const [lastReading, setLastReading] = useState<VoiceReading | null>(null);

  // self-report check-in
  const [before, setBefore] = useState<number | null>(null);
  const [after, setAfter] = useState<number | null>(null);

  const startFirstSet = () => {
    setPace(secondsPerPass);
    setSetNum(1);
    setLastReading(null);
    setPhase("session");
  };

  const continueFromReading = (r: VoiceReading, g: Guidance) => {
    setPace(g.nextPace);
    setLastReading(r);
    setSetNum((n) => n + 1);
    setPhase("session");
  };

  return (
    <div className="app">
      {phase === "welcome" && (
        <Welcome
          onContinue={() => setPhase("setup")}
          onEvidence={() => setPhase("evidence")}
        />
      )}

      {phase === "evidence" && <Evidence onBack={() => setPhase("welcome")} />}

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
          pattern={pattern}
          setPattern={setPattern}
          before={before}
          setBefore={setBefore}
          onStart={startFirstSet}
        />
      )}

      {phase === "session" && (
        <Session
          durationSec={durationSec}
          secondsPerPass={pace}
          pattern={pattern}
          audio={audio}
          haptics={haptics}
          banner={
            setNum > 1
              ? `Set ${setNum} · ${paceWord(secondsPerPass, pace)}`
              : undefined
          }
          onDone={() => setPhase("checkin")}
          onDistress={() => setPhase("distress")}
        />
      )}

      {phase === "checkin" && (
        <CheckIn
          baselinePace={secondsPerPass}
          onContinue={continueFromReading}
          onFinish={() => setPhase("close")}
          onDistress={() => setPhase("distress")}
        />
      )}

      {phase === "close" && (
        <Close
          before={before}
          after={after}
          setAfter={setAfter}
          durationSec={durationSec}
          lastReading={lastReading}
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

function Welcome({
  onContinue,
  onEvidence,
}: {
  onContinue: () => void;
  onEvidence: () => void;
}) {
  const [ack, setAck] = useState(false);
  return (
    <main className="screen center">
      <div className="mark">Lenis</div>
      <h1>A place to steady yourself.</h1>
      <p className="lede">
        Lenis guides gentle <strong>bilateral stimulation</strong> — a slow,
        side-to-side rhythm for your eyes, ears, or hands — and quietly adapts
        the pace to the sound of your voice. People use it to calm down, settle
        a racing mind, and feel more present.
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
            If eye movement feels dizzying, <strong>close your eyes</strong> and
            follow the sound or taps instead.
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
      <button className="linkish" onClick={onEvidence}>
        About the evidence &amp; limits
      </button>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence & limits (Responsible-AI disclosure)                      */
/* ------------------------------------------------------------------ */

function Evidence({ onBack }: { onBack: () => void }) {
  return (
    <main className="screen">
      <div className="mark small">About the evidence</div>
      <h1 className="tight">What's backed, and what isn't.</h1>
      <p className="lede">
        We'd rather tell you the limits up front than dress this up as more than
        it is.
      </p>

      <div className="card evidence">
        <div className="ev-row">
          <span className="ev-dot green" />
          <div>
            <strong>EMDR for PTSD — well supported.</strong>
            <p>
              Recommended for PTSD by the WHO, APA, and NICE. Evidence is weaker
              for phobias and panic, and thin for everyday anxiety.
            </p>
          </div>
        </div>
        <div className="ev-row">
          <span className="ev-dot amber" />
          <div>
            <strong>Do the eye movements themselves help? — debated.</strong>
            <p>
              Studies disagree on whether the bilateral movement adds much beyond
              the recall itself. The leading idea is that tracking a moving target
              loads working memory, making a memory feel less vivid. Plausible,
              not settled.
            </p>
          </div>
        </div>
        <div className="ev-row">
          <span className="ev-dot amber" />
          <div>
            <strong>Side-to-side vs. up-and-down — limited.</strong>
            <p>
              Side-to-side is the standard protocol. Up-and-down has some lab
              support and is often used when horizontal movement causes nausea.
              We offer only these two; we didn't invent "prettier" paths and
              pretend they're therapeutic.
            </p>
          </div>
        </div>
        <div className="ev-row">
          <span className="ev-dot red" />
          <div>
            <strong>The voice read — a proof-of-concept, not clinical.</strong>
            <p>
              We estimate arousal from the <em>sound</em> of your voice (pitch,
              pace, energy). It's a rough proxy to guide pacing — not a diagnosis
              or a validated measure.
            </p>
          </div>
        </div>
      </div>

      <p className="muted small">
        Bottom line: a self-guided calming aid that borrows an EMDR technique —
        best used alongside a licensed therapist, not instead of one. Self-guided
        memory work on serious trauma carries real risk without a clinician
        present.
      </p>

      <button className="primary" onClick={onBack}>
        Back
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
  pattern: Pattern;
  setPattern: (p: Pattern) => void;
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

        <div className="field">
          <label>Movement</label>
          <div className="segmented">
            {PATTERNS.map((p) => (
              <button
                key={p.key}
                className={props.pattern === p.key ? "seg on col" : "seg col"}
                onClick={() => props.setPattern(p.key)}
              >
                <span className="seg-glyph">{p.glyph}</span>
                <span>{p.label}</span>
                <span className="seg-note">{p.note}</span>
              </button>
            ))}
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
  pattern,
  audio,
  haptics,
  banner,
  onDone,
  onDistress,
}: {
  durationSec: number;
  secondsPerPass: number;
  pattern: Pattern;
  audio: boolean;
  haptics: boolean;
  banner?: string;
  onDone: () => void;
  onDistress: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SwayEngine | null>(null);
  const [remaining, setRemaining] = useState(durationSec);
  // live, in-session nudge on top of the adaptive pace (for comfort / dizziness)
  const [nudge, setNudge] = useState(0);
  const effectivePace = Math.max(0.5, Math.min(1.8, secondsPerPass + nudge));

  useEffect(() => {
    const canvas = canvasRef.current!;
    const engine = new SwayEngine(canvas, {
      secondsPerPass: effectivePace,
      audio,
      haptics,
      pattern,
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
    engineRef.current?.setOptions({ secondsPerPass: effectivePace, audio, haptics });
  }, [effectivePace, audio, haptics]);

  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);

  return (
    <div className="session">
      <canvas ref={canvasRef} className="canvas" />
      <div className="session-overlay">
        <div className="session-top">
          {banner && <div className="set-banner">{banner}</div>}
          <p className="follow">Let your eyes follow the fluffball.</p>
          <p className="follow-tip">
            Keep your head still — move only your eyes. Dizzy? Close them and
            follow the sound instead.
          </p>
        </div>

        <div className="timer">
          {mins}:{secs.toString().padStart(2, "0")}
        </div>

        <div className="session-controls">
          <div className="speed-stepper">
            <button
              className="step"
              onClick={() => setNudge((n) => Math.min(0.7, n + 0.15))}
              aria-label="Slow the fluffball down"
            >
              − slower
            </button>
            <span className="speed-read">{effectivePace.toFixed(2)}s</span>
            <button
              className="step"
              onClick={() => setNudge((n) => Math.max(-0.4, n - 0.15))}
              aria-label="Speed the fluffball up"
            >
              faster +
            </button>
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vocal check-in (Pillar 1: vocal-adaptive pacing)                   */
/* ------------------------------------------------------------------ */

const MAX_RECORD_SEC = 12;

function CheckIn({
  baselinePace,
  onContinue,
  onFinish,
  onDistress,
}: {
  baselinePace: number;
  onContinue: (r: VoiceReading, g: Guidance) => void;
  onFinish: () => void;
  onDistress: () => void;
}) {
  type Stage = "intro" | "recording" | "done" | "error";
  const [stage, setStage] = useState<Stage>("intro");
  const [level, setLevel] = useState(0);
  const [liveText, setLiveText] = useState("");
  const [reading, setReading] = useState<VoiceReading | null>(null);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [remaining, setRemaining] = useState(MAX_RECORD_SEC);
  const analyzerRef = useRef<VoiceAnalyzer | null>(null);
  const transcriberRef = useRef<Transcriber | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const settle = useCallback(
    (r: VoiceReading, transcript: string) => {
      const g = guideWithRules(r, baselinePace, transcript);
      setReading(r);
      setGuidance(g);
      if (g.crisis) {
        onDistress();
        return;
      }
      setStage("done");
    },
    [baselinePace, onDistress],
  );

  const finish = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
    const az = analyzerRef.current;
    if (!az) return;
    analyzerRef.current = null;
    const r = az.stop();
    const transcript = transcriberRef.current?.stop() ?? "";
    transcriberRef.current = null;
    setLevel(0);
    settle(r, transcript);
  }, [settle]);

  const showSample = useCallback(
    (arousal: number) => {
      settle(sampleReading(arousal), "");
    },
    [settle],
  );

  // Skip the mic this round: continue at a neutral, unchanged pace.
  const continueNeutral = useCallback(() => {
    const r = sampleReading(0.5);
    onContinue(r, guideWithRules(r, baselinePace, ""));
  }, [onContinue, baselinePace]);

  const begin = useCallback(async () => {
    const az = new VoiceAnalyzer();
    az.onLevel = (l) => setLevel(l);
    analyzerRef.current = az;
    try {
      await az.start();
    } catch {
      analyzerRef.current = null;
      setStage("error");
      return;
    }
    // Free, on-device transcription (Chrome/Edge). No-op elsewhere.
    const tr = new Transcriber();
    tr.onText = (t) => setLiveText(t);
    tr.start();
    transcriberRef.current = tr;

    setLiveText("");
    setStage("recording");
    setRemaining(MAX_RECORD_SEC);
    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => {
      const left = MAX_RECORD_SEC - (Date.now() - startedAt) / 1000;
      setRemaining(Math.max(0, left));
      if (left <= 0) finish();
    }, 150);
  }, [finish]);

  // clean up mic if the user leaves mid-recording
  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      analyzerRef.current?.stop();
      analyzerRef.current = null;
      transcriberRef.current?.stop();
      transcriberRef.current = null;
    },
    [],
  );

  const disclaimer = (
    <p className="muted small privacy-note">
      🔒 A proof-of-concept read from your voice — <em>not</em> a clinical
      measure. Audio is analyzed on your device and never leaves it.
    </p>
  );

  if (stage === "intro") {
    return (
      <main className="screen center">
        <div className="mark small">Check in</div>
        <h1>What's coming up for you?</h1>
        <p className="lede">
          When you're ready, speak a sentence or two out loud — whatever you're
          noticing. I'll listen to the <em>sound</em> of your voice to set a
          gentle pace for the next set.
        </p>
        <button className="primary" onClick={begin}>
          🎤 Start speaking
        </button>
        <button className="linkish" onClick={continueNeutral}>
          No mic? Continue without it
        </button>
        <button className="linkish" onClick={onFinish}>
          Finish the session
        </button>
        {disclaimer}
      </main>
    );
  }

  if (stage === "recording") {
    return (
      <main className="screen center">
        <div className="mark small">Listening…</div>
        <h1>I'm listening.</h1>
        <div className="mic-wrap">
          <div
            className="mic-ring"
            style={{ transform: `scale(${1 + level * 0.6})`, opacity: 0.4 + level * 0.6 }}
          />
          <div className="mic-core">🎤</div>
        </div>
        <p className="lede">Say a little about how you're feeling right now.</p>
        {liveText && <p className="transcript">"{liveText}"</p>}
        <p className="muted">{Math.ceil(remaining)}s</p>
        <button className="primary" onClick={finish}>
          Done
        </button>
        {disclaimer}
      </main>
    );
  }

  if (stage === "error") {
    return (
      <main className="screen center">
        <h1>I couldn't reach your mic.</h1>
        <p className="lede">
          Check the browser's microphone permission for this page, or carry on
          without it — the session still works, it just won't adapt to your
          voice this round.
        </p>
        <button className="primary" onClick={begin}>
          Try the mic again
        </button>
        <button className="linkish" onClick={() => showSample(0.68)}>
          Preview a sample read (no mic)
        </button>
        <button className="linkish" onClick={continueNeutral}>
          Continue without the mic
        </button>
        <button className="linkish" onClick={onFinish}>
          Finish the session
        </button>
      </main>
    );
  }

  // stage === "done"
  const r = reading!;
  const g = guidance!;
  return (
    <main className="screen center">
      <div className="mark small">Your voice read as</div>
      <h1 className="band-title">{bandLabel(r.band)}</h1>

      <div className="card">
        <div className="meter-row">
          <span>calm</span>
          <div className="meter">
            <div className="meter-fill" style={{ width: `${Math.round(r.arousal * 100)}%` }} />
          </div>
          <span>elevated</span>
        </div>
        <div className="signal-grid">
          <Signal label="pitch movement" v={r.pitchVariability} />
          <Signal label="speech pace" v={r.speechRate} />
          <Signal label="energy" v={r.energy} />
        </div>
        {!r.ok && (
          <p className="muted small">
            (Not much voice picked up — treat this read loosely.)
          </p>
        )}
      </div>

      <div className="card coach-card">
        <p className="coach-message">{g.message}</p>
        <div className="pace-preview">
          <span className="pace-word">Next set: {g.direction}</span>
          <span className="muted small">{g.nextPace.toFixed(2)}s per pass</span>
        </div>
        <p className="coach-source">guidance from an on-device model · no data left your device</p>
      </div>

      <button className="primary" onClick={() => onContinue(r, g)}>
        Another set
      </button>
      <button className="linkish" onClick={onFinish}>
        Finish here
      </button>
      {disclaimer}
    </main>
  );
}

function Signal({ label, v }: { label: string; v: number }) {
  return (
    <div className="signal">
      <div className="signal-bar">
        <div className="signal-fill" style={{ height: `${Math.round(v * 100)}%` }} />
      </div>
      <span className="signal-label">{label}</span>
    </div>
  );
}

function bandLabel(band: VoiceReading["band"]): string {
  switch (band) {
    case "calm":
      return "calm 🌿";
    case "settling":
      return "settling 🍃";
    case "neutral":
      return "steady";
    case "elevated":
      return "a bit elevated";
    case "high":
      return "quite activated";
  }
}

/* ------------------------------------------------------------------ */
/* Close / re-check                                                   */
/* ------------------------------------------------------------------ */

function Close({
  before,
  after,
  setAfter,
  durationSec,
  lastReading,
  onAgain,
}: {
  before: number | null;
  after: number | null;
  setAfter: (n: number) => void;
  durationSec: number;
  lastReading: VoiceReading | null;
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
      <div className="mark small">Lenis</div>
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

      {lastReading && after !== null && (
        <div className="card compare">
          <label className="field-label">Your number vs. your voice</label>
          <div className="compare-rows">
            <div className="compare-row">
              <span>you said</span>
              <div className="meter">
                <div className="meter-fill you" style={{ width: `${after * 10}%` }} />
              </div>
              <span className="compare-val">{after}/10</span>
            </div>
            <div className="compare-row">
              <span>voice read</span>
              <div className="meter">
                <div
                  className="meter-fill voice"
                  style={{ width: `${Math.round(lastReading.arousal * 100)}%` }}
                />
              </div>
              <span className="compare-val">{Math.round(lastReading.arousal * 10)}/10</span>
            </div>
          </div>
          <p className="muted small">
            {Math.abs(after - lastReading.arousal * 10) >= 2
              ? "These disagree — and that gap is the interesting part. The body doesn't always match the number we report."
              : "Close agreement this time — your words and your voice lined up."}
          </p>
        </div>
      )}

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
