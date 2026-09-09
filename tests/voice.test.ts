// The vocal arousal proxy, exercised offline through the same pitch/energy
// pipeline as the mic path. A proof-of-concept proxy, not a clinical measure —
// so the tests check ordering and bounds, not absolute numbers.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { analyzeSamples, reduceReading, sampleReading, synthClip } from "../src/voice";

describe("analyzeSamples on synthetic clips", () => {
  const calm = analyzeSamples(synthClip("calm"), 44100);
  const agitated = analyzeSamples(synthClip("agitated"), 44100);

  test("both clips carry enough voiced signal to be trusted", () => {
    assert.equal(calm.ok, true);
    assert.equal(agitated.ok, true);
  });

  test("the agitated clip reads as more aroused than the calm one, on every feature the proxy blends", () => {
    assert.ok(agitated.arousal > calm.arousal, `${agitated.arousal} > ${calm.arousal}`);
    assert.ok(agitated.pitchVariability > calm.pitchVariability);
    assert.ok(agitated.speechRate > calm.speechRate);
    assert.ok(agitated.energy > calm.energy);
    assert.ok(agitated.meanPitchHz > calm.meanPitchHz);
  });

  test("the calm clip lands in a calm band and the agitated one in an elevated band", () => {
    assert.ok(["calm", "settling"].includes(calm.band), calm.band);
    assert.ok(["elevated", "high"].includes(agitated.band), agitated.band);
  });

  test("the calm clip's gated pauses are heard as pauses", () => {
    // A third of the calm clip is silence by construction (0.4s on, 0.2s off).
    assert.ok(calm.pauseRatio > 0.2 && calm.pauseRatio < 0.6, `${calm.pauseRatio}`);
  });

  test("analysis is deterministic", () => {
    assert.deepEqual(analyzeSamples(synthClip("calm"), 44100), calm);
  });
});

describe("reduceReading", () => {
  test("no signal is not calm: it is not ok, and reads as zero", () => {
    const r = reduceReading([], [], [], 0, 0);
    assert.equal(r.ok, false);
    assert.equal(r.arousal, 0);
    assert.equal(r.speechRate, 0);
  });

  test("too few voiced frames is not ok even when the frames are loud", () => {
    const r = reduceReading([200, 210, 190], [0.9, 0.9, 0.9], Array(30).fill(0.2), 3, 30);
    assert.equal(r.ok, false);
  });

  test("the proxy is bounded in 0..1 under extreme input", () => {
    const r = reduceReading(Array(50).fill(0).map((_, i) => (i % 2 ? 80 : 480)), Array(50).fill(1), Array(50).fill(5), 50, 50);
    assert.ok(r.arousal >= 0 && r.arousal <= 1);
    assert.equal(r.energy, 1);
    assert.equal(r.pitchVariability, 1);
  });
});

describe("bands", () => {
  test("band boundaries match the coach's thresholds", () => {
    assert.equal(sampleReading(0.24).band, "calm");
    assert.equal(sampleReading(0.25).band, "settling");
    assert.equal(sampleReading(0.42).band, "neutral");
    assert.equal(sampleReading(0.58).band, "elevated");
    assert.equal(sampleReading(0.75).band, "high");
  });
});
