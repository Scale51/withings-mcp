/**
 * APEX Coach — Unit Tests
 *
 * Tests the core algorithmic logic extracted from the system prompt.
 * Run with: node --loader ts-node/esm tests/apex-coach/logic.test.ts
 * Or after compiling: node --test tests/apex-coach/logic.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeHrvTier,
  computeAeDecPace,
  classifyAeDec,
  riegelPredict,
  cyclingTssToCtlContribution,
  requiredCyclingDuration,
  applyAliModifier,
  computeSrpe,
  computeMonotony,
  computeStrain,
  isTrainLowEligible,
  computeReadinessScore,
  readinessBand,
  runToBikeDuration,
  isPaceDeviationFlagged,
  intraCarbTarget,
} from "./logic.js";

// ─────────────────────────────────────────────────────────────────────────────
// HRV AUTOREGULATION
// ─────────────────────────────────────────────────────────────────────────────

describe("computeHrvTier", () => {
  it("returns GO when HRV ≥5% above 7d average", () => {
    assert.equal(computeHrvTier(52, 49), "GO");   // +6.1%
    assert.equal(computeHrvTier(51.5, 49), "GO"); // +5.1%
  });

  it("returns NORMAL when HRV within ±5% of average", () => {
    assert.equal(computeHrvTier(49, 49), "NORMAL");   // 0%
    assert.equal(computeHrvTier(47, 49), "NORMAL");   // -4.1%
    assert.equal(computeHrvTier(51, 49), "NORMAL");   // +4.1%
  });

  it("returns CAUTION when HRV is 5-15% below average", () => {
    assert.equal(computeHrvTier(44, 49), "CAUTION");   // -10.2%
    assert.equal(computeHrvTier(46.4, 49), "CAUTION"); // -5.3% (just past -5% threshold)
    assert.equal(computeHrvTier(41.7, 49), "CAUTION"); // -14.9% (just above -15%)
  });

  it("returns RECOVERY when HRV >15% below average", () => {
    assert.equal(computeHrvTier(41, 49), "RECOVERY"); // -16.3%
    assert.equal(computeHrvTier(30, 49), "RECOVERY");
  });

  it("overrides to RECOVERY when wellbeing ≤4 regardless of HRV", () => {
    assert.equal(computeHrvTier(55, 49, 4), "RECOVERY"); // HRV would be GO
    assert.equal(computeHrvTier(55, 49, 3), "RECOVERY");
    assert.equal(computeHrvTier(55, 49, 1), "RECOVERY");
  });

  it("does NOT override when wellbeing is 5 (above threshold)", () => {
    assert.equal(computeHrvTier(55, 49, 5), "GO");
    assert.equal(computeHrvTier(49, 49, 5), "NORMAL");
  });

  it("works without wellbeing argument", () => {
    assert.equal(computeHrvTier(55, 49), "GO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AEROBIC DECOUPLING
// ─────────────────────────────────────────────────────────────────────────────

describe("computeAeDecPace", () => {
  it("returns 0% when both halves are equal speed", () => {
    assert.equal(computeAeDecPace(3.5, 3.5), 0);
  });

  it("returns positive when 1st half is faster than 2nd (drift)", () => {
    const result = computeAeDecPace(3.5, 3.3);
    assert.ok(result > 0, `Expected positive, got ${result}`);
    assert.ok(Math.abs(result - 6.06) < 0.1, `Expected ~6.1%, got ${result}`);
  });

  it("returns negative when 2nd half is faster (negative split)", () => {
    const result = computeAeDecPace(3.3, 3.5);
    assert.ok(result < 0);
  });
});

describe("classifyAeDec", () => {
  it("classifies <5% as good", () => {
    assert.equal(classifyAeDec(0), "good");
    assert.equal(classifyAeDec(4.9), "good");
  });

  it("classifies 5-8% as acceptable", () => {
    assert.equal(classifyAeDec(5), "acceptable");
    assert.equal(classifyAeDec(8), "acceptable");
  });

  it("classifies >8% as flag", () => {
    assert.equal(classifyAeDec(8.1), "flag");
    assert.equal(classifyAeDec(15), "flag");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RIEGEL FORMULA
// ─────────────────────────────────────────────────────────────────────────────

describe("riegelPredict", () => {
  it("HM → Marathon: multiplier ≈ 2.09", () => {
    const t1 = 100; // 100 min HM
    const predicted = riegelPredict(t1, 21.0975, 42.195);
    assert.ok(Math.abs(predicted / t1 - 2.09) < 0.01, `Multiplier ${predicted / t1} should be ~2.09`);
  });

  it("returns exact same time for same distance", () => {
    assert.equal(riegelPredict(50, 10, 10), 50);
  });

  it("predicts a faster time for shorter distance", () => {
    const predicted = riegelPredict(100, 10, 5);
    assert.ok(predicted < 100, `Expected <100, got ${predicted}`);
  });

  it("sub-3:30 Kassel requires ~1:40 HM", () => {
    // Marathon target: 210 min. What HM time does that imply?
    const hm_implied = riegelPredict(210, 42.195, 21.0975);
    assert.ok(Math.abs(hm_implied - 100) < 2, `Expected ~100 min HM, got ${hm_implied.toFixed(1)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CYCLING CTL FACTOR
// ─────────────────────────────────────────────────────────────────────────────

describe("cyclingTssToCtlContribution", () => {
  it("applies ×0.75 factor", () => {
    assert.equal(cyclingTssToCtlContribution(100), 75);
    assert.equal(cyclingTssToCtlContribution(0), 0);
    assert.equal(cyclingTssToCtlContribution(80), 60);
  });
});

describe("requiredCyclingDuration", () => {
  it("requires ×1.33 longer duration at default Z2 rate", () => {
    // 60 min run at 0.85 TSS/min = 51 run_tss
    // To match: 51 / (0.85 × 0.75) = 80 min bike
    const result = requiredCyclingDuration(60 * 0.85);
    assert.ok(Math.abs(result - 80) < 0.5, `Expected ~80 min, got ${result.toFixed(1)}`);
  });

  it("ratio between run and bike is ≈1.33", () => {
    const run_min = 60;
    const run_tss = run_min * 0.85;
    const bike_min = requiredCyclingDuration(run_tss);
    const ratio = bike_min / run_min;
    assert.ok(Math.abs(ratio - 1.333) < 0.01, `Ratio ${ratio.toFixed(3)} should be ~1.333`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ALI MODIFIER
// ─────────────────────────────────────────────────────────────────────────────

describe("applyAliModifier", () => {
  it("ALI 1-5: no TSS reduction, quality allowed", () => {
    const { modified_tss, modification } = applyAliModifier(300, 1);
    assert.equal(modified_tss, 300);
    assert.equal(modification.tss_reduction_pct, 0);
    assert.equal(modification.quality_sessions_allowed, true);
    assert.equal(modification.injury_threshold_lowered, false);
  });

  it("ALI 5: still no change (boundary)", () => {
    const { modified_tss } = applyAliModifier(300, 5);
    assert.equal(modified_tss, 300);
  });

  it("ALI 6: -10% TSS, quality allowed, threshold lowered", () => {
    const { modified_tss, modification } = applyAliModifier(300, 6);
    assert.equal(modified_tss, 270);
    assert.equal(modification.quality_sessions_allowed, true);
    assert.equal(modification.injury_threshold_lowered, true);
  });

  it("ALI 7: -10% TSS (boundary)", () => {
    const { modified_tss } = applyAliModifier(300, 7);
    assert.equal(modified_tss, 270);
  });

  it("ALI 8: -40% TSS, no quality sessions", () => {
    const { modified_tss, modification } = applyAliModifier(300, 8);
    assert.equal(modified_tss, 180);
    assert.equal(modification.quality_sessions_allowed, false);
    assert.equal(modification.injury_threshold_lowered, true);
  });

  it("ALI 10: -40% TSS (max)", () => {
    const { modified_tss } = applyAliModifier(300, 10);
    assert.equal(modified_tss, 180);
  });

  it("works with zero base TSS", () => {
    const { modified_tss } = applyAliModifier(0, 9);
    assert.equal(modified_tss, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sRPE INTERNAL LOAD
// ─────────────────────────────────────────────────────────────────────────────

describe("computeSrpe", () => {
  it("sRPE = RPE × duration", () => {
    assert.equal(computeSrpe(7, 60), 420);
    assert.equal(computeSrpe(0, 60), 0);
    assert.equal(computeSrpe(10, 0), 0);
  });
});

describe("computeMonotony", () => {
  it("returns 0 for empty input", () => {
    assert.equal(computeMonotony([]), 0);
  });

  it("returns 0 when all values are zero (sd=0)", () => {
    assert.equal(computeMonotony([0, 0, 0]), 0);
  });

  it("detects high monotony for near-uniform daily load", () => {
    // Nearly uniform (small variation) → very high monotony (mean/sd >> 1)
    const result = computeMonotony([400, 410, 395, 405, 398, 402, 400]);
    assert.ok(result > 50, `Expected high monotony (>50), got ${result}`);
  });

  it("detects low monotony for varied daily load (hard/easy alternating)", () => {
    const result = computeMonotony([600, 100, 600, 100, 600, 100, 0]);
    assert.ok(result < 2, `Expected low monotony (<2), got ${result.toFixed(2)}`);
  });

  it("flags monotony >2 as warning territory", () => {
    // Monotony exactly 2.0 is the threshold; above is warning
    const result = computeMonotony([300, 310, 290, 305, 295, 300, 300]);
    // These are all very similar → monotony will be high
    assert.ok(result > 2.0, `Expected >2.0, got ${result.toFixed(2)}`);
  });
});

describe("computeStrain", () => {
  it("strain = weekly_load × monotony", () => {
    assert.equal(computeStrain(2100, 2.5), 5250);
    assert.equal(computeStrain(0, 3), 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRAIN-LOW ELIGIBILITY
// ─────────────────────────────────────────────────────────────────────────────

describe("isTrainLowEligible", () => {
  it("eligible when TSB ≥ -20 and race far away", () => {
    assert.equal(isTrainLowEligible(-19, 30), true);
    assert.equal(isTrainLowEligible(0, 30), true);
    assert.equal(isTrainLowEligible(10, 30), true);
  });

  it("ineligible when TSB < -20", () => {
    assert.equal(isTrainLowEligible(-21, 30), false);
    assert.equal(isTrainLowEligible(-50, 30), false);
  });

  it("ineligible within 10 days of race", () => {
    assert.equal(isTrainLowEligible(0, 10), false);
    assert.equal(isTrainLowEligible(0, 9), false);
    assert.equal(isTrainLowEligible(0, 1), false);
  });

  it("eligible at exactly 11 days from race", () => {
    assert.equal(isTrainLowEligible(0, 11), true);
  });

  it("ineligible when both conditions are violated", () => {
    assert.equal(isTrainLowEligible(-25, 5), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// READINESS SCORING
// ─────────────────────────────────────────────────────────────────────────────

describe("computeReadinessScore", () => {
  const perfect = { sleep_score: 100, load_score: 100, hrv_score: 100, illness_score: 100 };

  it("perfect scores → 100 in normal mode with subjective", () => {
    const score = computeReadinessScore({
      ...perfect,
      subjective_score: 100,
      life_mode: "normal",
    });
    assert.equal(score, 100);
  });

  it("perfect scores → 100 in normal mode without subjective", () => {
    const score = computeReadinessScore({ ...perfect, life_mode: "normal" });
    assert.equal(score, 100);
  });

  it("perfect scores → 100 in newborn mode with subjective", () => {
    const score = computeReadinessScore({
      ...perfect,
      subjective_score: 100,
      life_mode: "newborn",
    });
    assert.equal(score, 100);
  });

  it("weights sum to 100 in each mode", () => {
    // Normal + subj: 30+25+20+15+10 = 100
    // Normal no subj: 35+29+24+0+12 = 100
    // Newborn + subj: 10+35+15+30+10 = 100
    // Newborn no subj: 14+50+22+0+14 = 100
    const checks = [
      { ...perfect, subjective_score: 50, life_mode: "normal" as const },
      { ...perfect, life_mode: "normal" as const },
      { ...perfect, subjective_score: 50, life_mode: "newborn" as const },
      { ...perfect, life_mode: "newborn" as const },
    ];
    for (const params of checks) {
      const score = computeReadinessScore(params);
      assert.ok(score >= 0 && score <= 100, `Score ${score} out of range`);
    }
  });

  it("low sleep dominates in normal mode (without subjective)", () => {
    const low_sleep = computeReadinessScore({
      sleep_score: 20,
      load_score: 100,
      hrv_score: 100,
      illness_score: 100,
      life_mode: "normal",
    });
    const high_sleep = computeReadinessScore({
      sleep_score: 100,
      load_score: 100,
      hrv_score: 100,
      illness_score: 100,
      life_mode: "normal",
    });
    assert.ok(low_sleep < high_sleep);
  });

  it("in newborn mode, load is dominant signal (without subjective weight=50)", () => {
    const low_load = computeReadinessScore({
      sleep_score: 100,
      load_score: 20,
      hrv_score: 100,
      illness_score: 100,
      life_mode: "newborn",
    });
    const high_load = computeReadinessScore({
      sleep_score: 100,
      load_score: 100,
      hrv_score: 100,
      illness_score: 100,
      life_mode: "newborn",
    });
    assert.ok(low_load < high_load);
  });

  it("in newborn mode WITH subjective, subjective score has highest single weight (30)", () => {
    const low_subj = computeReadinessScore({
      sleep_score: 100,
      load_score: 100,
      hrv_score: 100,
      illness_score: 100,
      subjective_score: 0,
      life_mode: "newborn",
    });
    const high_subj = computeReadinessScore({
      sleep_score: 100,
      load_score: 100,
      hrv_score: 100,
      illness_score: 100,
      subjective_score: 100,
      life_mode: "newborn",
    });
    // Difference should be 30 points (0.30 × 100 weight impact)
    assert.ok(high_subj - low_subj > 25, `Expected >25 point diff, got ${high_subj - low_subj}`);
  });
});

describe("readinessBand", () => {
  it("green for ≥70", () => {
    assert.equal(readinessBand(70), "green");
    assert.equal(readinessBand(100), "green");
  });

  it("amber for 45-69", () => {
    assert.equal(readinessBand(69.9), "amber");
    assert.equal(readinessBand(45), "amber");
  });

  it("red for <45", () => {
    assert.equal(readinessBand(44.9), "red");
    assert.equal(readinessBand(0), "red");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RUN-TO-BIKE SUBSTITUTION
// ─────────────────────────────────────────────────────────────────────────────

describe("runToBikeDuration", () => {
  it("bike duration is longer than run for same aerobic stimulus", () => {
    const bike = runToBikeDuration(60, 0.85);
    assert.ok(bike > 60, `Expected >60 min, got ${bike}`);
  });

  it("ratio is ≈1.33 for identical TSS rates", () => {
    const run_min = 60;
    const bike_min = runToBikeDuration(run_min, 0.85, 0.85);
    const ratio = bike_min / run_min;
    // Bike duration = run_tss / (0.85 × 0.75) / 0.85 = run × 1/0.75 = 1.333
    assert.ok(Math.abs(ratio - 1.333) < 0.01, `Ratio ${ratio} should be ~1.333`);
  });

  it("returns correct value for Z2 cycling (0.85 TSS/min default)", () => {
    // 45 min run @ 0.85 TSS/min = 38.25 run_tss
    // required bike_tss = 38.25 / 0.75 = 51
    // bike duration = 51 / 0.85 = 60 min
    const bike = runToBikeDuration(45, 0.85);
    assert.ok(Math.abs(bike - 60) < 0.5, `Expected ~60 min, got ${bike.toFixed(1)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PACE DEVIATION DETECTION
// ─────────────────────────────────────────────────────────────────────────────

describe("isPaceDeviationFlagged", () => {
  it("no flag within 8 sec/km", () => {
    assert.equal(isPaceDeviationFlagged(345, 345), false); // 0 sec diff
    assert.equal(isPaceDeviationFlagged(345, 353), false); // 8 sec/km exactly
    assert.equal(isPaceDeviationFlagged(353, 345), false); // 8 sec/km exactly
  });

  it("flags when deviation exceeds 8 sec/km", () => {
    assert.equal(isPaceDeviationFlagged(345, 354), true); // 9 sec/km
    assert.equal(isPaceDeviationFlagged(354, 345), true); // 9 sec/km (slower actual)
    assert.equal(isPaceDeviationFlagged(300, 340), true); // 40 sec/km
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTRA-SESSION CARB TARGETS
// ─────────────────────────────────────────────────────────────────────────────

describe("intraCarbTarget", () => {
  it("no carbs for runs <60 min at sub-IAS HR", () => {
    const { carbs_per_hour_g } = intraCarbTarget(45, 140);
    assert.equal(carbs_per_hour_g, 0);
  });

  it("30g/h for 60-90 min Z2 run", () => {
    const { carbs_per_hour_g } = intraCarbTarget(75, 140);
    assert.equal(carbs_per_hour_g, 30);
  });

  it("45g/h for 90-120 min run", () => {
    const { carbs_per_hour_g } = intraCarbTarget(100, 140);
    assert.equal(carbs_per_hour_g, 45);
  });

  it("60g/h for >120 min long run at sub-IAS HR", () => {
    const { carbs_per_hour_g } = intraCarbTarget(150, 140);
    assert.equal(carbs_per_hour_g, 60);
  });

  it("90g/h at race pace (≥92% of IAS BPM)", () => {
    // IAS = 167 bpm. 92% = 153.6 → round up to 154
    const { carbs_per_hour_g } = intraCarbTarget(150, 155);
    assert.equal(carbs_per_hour_g, 90);
  });

  it("race pace threshold overrides duration", () => {
    // Short duration but high HR → still 90g/h
    const { carbs_per_hour_g } = intraCarbTarget(30, 160);
    assert.equal(carbs_per_hour_g, 90);
  });
});
