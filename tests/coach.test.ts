// The on-device coach, tested from the outside: crisis language routes to
// help, words nudge the vocal read but never override it, and the pace moves
// the way the README says it does.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { guideWithRules } from "../src/coach";
import { sampleReading } from "../src/voice";

const BASE = 0.9;

describe("crisis language", () => {
  const phrases = [
    "I think I want to die",
    "honestly I might KILL MYSELF",
    "I could end my life tonight",
    "I just want to end it all",
    "thinking about suicide again",
    "I want to hurt myself",
    "I don't want to be here anymore",
    "there's no reason to live",
  ];
  for (const phrase of phrases) {
    test(`flags: "${phrase}"`, () => {
      const g = guideWithRules(sampleReading(0.5), BASE, phrase);
      assert.equal(g.crisis, true);
      assert.match(g.message, /someone who can help right now/);
      assert.ok(Number.isFinite(g.nextPace), "the set can still continue while help is shown");
    });
  }

  test("ordinary distress is not crisis", () => {
    for (const t of ["I feel panicky and my chest is tight", "a bit better than before", ""]) {
      assert.equal(guideWithRules(sampleReading(0.5), BASE, t).crisis, false, t);
    }
  });
});

describe("words nudge the voice read, bounded", () => {
  test("worried words raise it, calm words lower it", () => {
    const voice = sampleReading(0.5);
    const up = guideWithRules(voice, BASE, "I'm overwhelmed and shaking").effectiveArousal;
    const down = guideWithRules(voice, BASE, "feeling calmer and more settled").effectiveArousal;
    const none = guideWithRules(voice, BASE).effectiveArousal;
    assert.ok(up > none && none > down, `${down} < ${none} < ${up}`);
  });

  test("text never overrides the voice: the offset is capped at a quarter", () => {
    const allTheWorry = "panic can't breathe racing terrified scared overwhelmed freaking can't stop worse spiraling shaking tight chest on edge dread";
    const allTheCalm = "calmer better settled relaxed easier lighter steadier okay now peaceful grounded";
    assert.ok(guideWithRules(sampleReading(0.1), BASE, allTheWorry).effectiveArousal <= 0.35 + 1e-9);
    assert.ok(guideWithRules(sampleReading(0.9), BASE, allTheCalm).effectiveArousal >= 0.65 - 1e-9);
  });

  test("effective arousal stays in 0..1", () => {
    assert.equal(guideWithRules(sampleReading(1), BASE, "panic panic dread").effectiveArousal, 1);
    assert.equal(guideWithRules(sampleReading(0), BASE, "calmer better peaceful").effectiveArousal, 0);
  });
});

describe("pace", () => {
  test("neutral voice and no words holds the baseline", () => {
    const g = guideWithRules(sampleReading(0.5), BASE);
    assert.equal(g.nextPace, BASE);
    assert.equal(g.direction, "steady");
  });

  test("keyed-up slows the target down; calm quickens it", () => {
    const high = guideWithRules(sampleReading(0.9), BASE);
    const low = guideWithRules(sampleReading(0.1), BASE);
    assert.equal(high.direction, "slower");
    assert.ok(high.nextPace > BASE);
    assert.equal(low.direction, "quicker");
    assert.ok(low.nextPace < BASE);
  });

  test("the pace is clamped to the engine's safe range whatever the baseline", () => {
    assert.equal(guideWithRules(sampleReading(1), 1.6).nextPace, 1.6);
    assert.equal(guideWithRules(sampleReading(0), 0.5).nextPace, 0.5);
    for (const a of [0, 0.3, 0.5, 0.7, 1]) {
      const p = guideWithRules(sampleReading(a), 3).nextPace;
      assert.ok(p >= 0.5 && p <= 1.6, `${p}`);
    }
  });

  test("the spoken prompt follows the read, and acknowledges words when there were any", () => {
    assert.match(guideWithRules(sampleReading(0.9), BASE).message, /tightly wound/);
    assert.match(guideWithRules(sampleReading(0.1), BASE).message, /calm and grounded/);
    assert.match(guideWithRules(sampleReading(0.5), BASE, "fine I suppose").message, /Thanks for saying that/);
    assert.doesNotMatch(guideWithRules(sampleReading(0.5), BASE).message, /Thanks for saying that/);
  });

  test("guidance says how it was produced", () => {
    assert.equal(guideWithRules(sampleReading(0.5), BASE).source, "on-device rules");
  });
});
