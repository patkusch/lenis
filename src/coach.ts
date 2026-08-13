// Wavelength — the reasoning layer, on-device and key-free.
//
// The spec calls for a model that reads the check-in (voice signal + words) and
// returns a pacing adjustment plus a short spoken prompt. Rather than depend on
// a cloud API key, this runs entirely in the browser: a rule engine over the
// vocal arousal proxy and a free, client-side transcript (Web Speech API).
//
// It's intentionally written behind a small interface (`Guidance`) so a Claude
// call can be dropped in later without touching the UI — see `guideWithRules`.

import type { VoiceReading } from "./voice";

export interface Guidance {
  /** A short, warm, spoken-style prompt for the next set. */
  message: string;
  /** Seconds-per-pass for the next set. */
  nextPace: number;
  /** How the pace moved relative to the user's baseline. */
  direction: "slower" | "steady" | "quicker";
  /** Arousal after folding in the words, 0..1. */
  effectiveArousal: number;
  /** Set when the words suggest the user may be in crisis. */
  crisis: boolean;
  /** How the guidance was produced — for the "how it works" story. */
  source: "on-device rules";
}

const CRISIS = [
  "kill myself",
  "want to die",
  "end my life",
  "end it all",
  "suicide",
  "hurt myself",
  "don't want to be here",
  "no reason to live",
];

const ELEVATED = [
  "panic",
  "can't breathe",
  "cant breathe",
  "racing",
  "terrified",
  "scared",
  "overwhelmed",
  "freaking",
  "can't stop",
  "worse",
  "spiraling",
  "shaking",
  "tight chest",
  "on edge",
  "dread",
];

const CALMING = [
  "calmer",
  "better",
  "settled",
  "settling",
  "relaxed",
  "easier",
  "lighter",
  "steadier",
  "okay now",
  "peaceful",
  "grounded",
];

function countHits(text: string, phrases: string[]): number {
  const t = text.toLowerCase();
  return phrases.reduce((n, p) => (t.includes(p) ? n + 1 : n), 0);
}

/** Same mapping the app uses: elevated arousal → slower, calm → quicker. */
function paceFor(base: number, arousal: number): number {
  const delta = (arousal - 0.5) * 0.7;
  return Math.max(0.5, Math.min(1.6, base + delta));
}

/** The on-device reasoning. `transcript` may be empty (no mic words / unsupported
 *  browser) — then guidance rests on the vocal signal alone. */
export function guideWithRules(
  reading: VoiceReading,
  baselinePace: number,
  transcript = "",
): Guidance {
  const crisis = countHits(transcript, CRISIS) > 0;

  // Fold the words into the vocal arousal: worried words nudge it up, calmer
  // words nudge it down. Bounded so text never fully overrides the voice.
  const elevatedHits = countHits(transcript, ELEVATED);
  const calmingHits = countHits(transcript, CALMING);
  const textOffset = clamp(0.12 * elevatedHits - 0.1 * calmingHits, -0.25, 0.25);
  const effectiveArousal = clamp(reading.arousal + textOffset, 0, 1);

  const nextPace = paceFor(baselinePace, effectiveArousal);
  const direction: Guidance["direction"] =
    nextPace > baselinePace + 0.04
      ? "slower"
      : nextPace < baselinePace - 0.04
        ? "quicker"
        : "steady";

  return {
    message: crisis
      ? "I'm really glad you said that out loud. This is bigger than a breathing exercise — let's get you to someone who can help right now."
      : pickMessage(effectiveArousal, transcript.trim().length > 0),
    nextPace,
    direction,
    effectiveArousal,
    crisis,
    source: "on-device rules",
  };
}

function pickMessage(arousal: number, hadWords: boolean): string {
  if (arousal >= 0.75) {
    return "Your voice sounds tightly wound, and that's okay — nothing's wrong with you. We'll slow the fluffball right down and just ride the rhythm together for a bit.";
  }
  if (arousal >= 0.58) {
    return "I can hear a bit of an edge there. Let's ease the pace and let your shoulders drop on the next set — no need to do anything but follow along.";
  }
  if (arousal >= 0.42) {
    return hadWords
      ? "Thanks for saying that. You sound fairly level — we'll hold a steady, comfortable rhythm and let it keep doing its quiet work."
      : "You sound fairly level — we'll hold a steady, comfortable rhythm for the next set.";
  }
  if (arousal >= 0.25) {
    return "You're sounding settled. We'll keep an easy, unhurried pace — you don't have to push toward anything.";
  }
  return "You sound calm and grounded. Let's stay gentle and just enjoy the steadiness for one more set.";
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
