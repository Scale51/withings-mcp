/**
 * APEX Coach — Core Logic Functions
 *
 * These pure functions implement the algorithmic rules defined in the APEX Coach
 * system prompt. They are extracted here for independent unit testing.
 */

// ─────────────────────────────────────────────────────────────────────────────
// HRV AUTOREGULATION
// ─────────────────────────────────────────────────────────────────────────────

export type HrvTier = "GO" | "NORMAL" | "CAUTION" | "RECOVERY";

/**
 * Determines HRV autoregulation tier per APEX Coach rules.
 * OVERRIDE: wellbeing ≤ 4 → RECOVERY regardless of HRV.
 */
export function computeHrvTier(
  hrv_today: number,
  hrv_7d_avg: number,
  wellbeing?: number
): HrvTier {
  if (wellbeing !== undefined && wellbeing <= 4) return "RECOVERY";

  const deviation_pct = ((hrv_today - hrv_7d_avg) / hrv_7d_avg) * 100;

  if (hrv_today >= hrv_7d_avg * 1.05) return "GO";
  if (deviation_pct > -5) return "NORMAL";
  if (deviation_pct >= -15) return "CAUTION";
  return "RECOVERY";
}

// ─────────────────────────────────────────────────────────────────────────────
// AEROBIC DECOUPLING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates aerobic decoupling (AeDec) from pace-based splits.
 * Formula: (avg_speed_1st_half / avg_speed_2nd_half - 1) × 100
 * A positive value = pace declined in 2nd half (fatigue/drift).
 *
 * NOTE: Prompt uses speed ratio, which means FASTER 1st half → positive AeDec.
 */
export function computeAeDecPace(
  avg_speed_1st_half_ms: number,
  avg_speed_2nd_half_ms: number
): number {
  return (avg_speed_1st_half_ms / avg_speed_2nd_half_ms - 1) * 100;
}

/**
 * Classifies AeDec value per APEX Coach thresholds.
 */
export function classifyAeDec(aedec_pct: number): "good" | "acceptable" | "flag" {
  if (aedec_pct < 5) return "good";
  if (aedec_pct <= 8) return "acceptable";
  return "flag";
}

// ─────────────────────────────────────────────────────────────────────────────
// RIEGEL PREDICTION FORMULA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Riegel endurance prediction formula: T2 = T1 × (D2 / D1)^1.06
 * Returns predicted time in the same unit as t1.
 */
export function riegelPredict(t1: number, d1: number, d2: number): number {
  return t1 * Math.pow(d2 / d1, 1.06);
}

// ─────────────────────────────────────────────────────────────────────────────
// CYCLING CTL FACTOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts cycling TSS to effective run-CTL contribution (×0.75).
 */
export function cyclingTssToCtlContribution(cycling_tss: number): number {
  return cycling_tss * 0.75;
}

/**
 * Calculates required cycling duration to match a target run CTL contribution.
 * bike_tss_per_min: default 0.85 (Z2 cycling)
 * Effective CTL = bike_duration × bike_tss_per_min × 0.75 ≥ target_run_tss
 */
export function requiredCyclingDuration(
  target_run_tss: number,
  bike_tss_per_min: number = 0.85
): number {
  return target_run_tss / (bike_tss_per_min * 0.75);
}

// ─────────────────────────────────────────────────────────────────────────────
// ALI MODIFIER
// ─────────────────────────────────────────────────────────────────────────────

export type AliModification = {
  tss_reduction_pct: number;
  quality_sessions_allowed: boolean;
  injury_threshold_lowered: boolean;
  description: string;
};

/**
 * Applies ALI (life stress) modifier to weekly TSS.
 * ALI 1-5: no change | 6-7: -10% TSS | ≥8: -40% TSS + no quality
 */
export function applyAliModifier(weekly_tss: number, ali_score: number): {
  modified_tss: number;
  modification: AliModification;
} {
  let mod: AliModification;

  if (ali_score <= 5) {
    mod = {
      tss_reduction_pct: 0,
      quality_sessions_allowed: true,
      injury_threshold_lowered: false,
      description: "Plan unchanged",
    };
  } else if (ali_score <= 7) {
    mod = {
      tss_reduction_pct: 10,
      quality_sessions_allowed: true,
      injury_threshold_lowered: true,
      description: "TSS -10%, injury threshold lowered to 4+/10",
    };
  } else {
    mod = {
      tss_reduction_pct: 40,
      quality_sessions_allowed: false,
      injury_threshold_lowered: true,
      description: "Recovery week: TSS -40%, quality → Z2/GA1, injury threshold 4+/10",
    };
  }

  const modified_tss = weekly_tss * (1 - mod.tss_reduction_pct / 100);
  return { modified_tss, modification: mod };
}

// ─────────────────────────────────────────────────────────────────────────────
// sRPE INTERNAL LOAD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Foster (2001) sRPE = RPE (CR-10) × duration in minutes.
 */
export function computeSrpe(rpe: number, duration_min: number): number {
  return rpe * duration_min;
}

/**
 * Training monotony = weekly_mean / weekly_sd
 * Low monotony = varied load (good). High monotony (>2.0) = warning.
 */
export function computeMonotony(daily_srpe_loads: number[]): number {
  if (daily_srpe_loads.length === 0) return 0;
  const mean = daily_srpe_loads.reduce((a, b) => a + b, 0) / daily_srpe_loads.length;
  const variance =
    daily_srpe_loads.reduce((sum, x) => sum + (x - mean) ** 2, 0) /
    daily_srpe_loads.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return mean / sd;
}

/**
 * Training strain = weekly total sRPE load × monotony.
 */
export function computeStrain(
  weekly_srpe_total: number,
  monotony: number
): number {
  return weekly_srpe_total * monotony;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRAIN-LOW ELIGIBILITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Train-Low is blocked when TSB < -20 OR within 10 days of a race.
 */
export function isTrainLowEligible(tsb: number, days_to_race: number): boolean {
  if (tsb < -20) return false;
  if (days_to_race <= 10) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// READINESS SCORING
// ─────────────────────────────────────────────────────────────────────────────

export type LifeMode = "normal" | "newborn";

/**
 * Weighted readiness score (0–100) following APEX Coach weight tables.
 *
 * life_mode=normal  (with subjective):  Sleep30|Load25|HRV20|Subj15|Ill10
 * life_mode=normal  (no subjective):    Sleep35|Load29|HRV24|Ill12
 * life_mode=newborn (with subjective):  Sleep10|Load35|HRV15|Subj30|Ill10
 * life_mode=newborn (no subjective):    Sleep14|Load50|HRV22|Ill14
 */
export function computeReadinessScore(params: {
  sleep_score: number;
  load_score: number;
  hrv_score: number;
  illness_score: number;
  subjective_score?: number;
  life_mode: LifeMode;
}): number {
  const { sleep_score, load_score, hrv_score, illness_score, subjective_score, life_mode } = params;
  const has_subj = subjective_score !== undefined;

  let weights: Record<string, number>;

  if (life_mode === "normal") {
    weights = has_subj
      ? { sleep: 30, load: 25, hrv: 20, subj: 15, ill: 10 }
      : { sleep: 35, load: 29, hrv: 24, subj: 0, ill: 12 };
  } else {
    weights = has_subj
      ? { sleep: 10, load: 35, hrv: 15, subj: 30, ill: 10 }
      : { sleep: 14, load: 50, hrv: 22, subj: 0, ill: 14 };
  }

  const total_weight = Object.values(weights).reduce((a, b) => a + b, 0);

  const score =
    (sleep_score * weights.sleep +
      load_score * weights.load +
      hrv_score * weights.hrv +
      (has_subj ? (subjective_score ?? 0) * weights.subj : 0) +
      illness_score * weights.ill) /
    total_weight;

  return Math.round(score * 10) / 10;
}

/**
 * Maps readiness score to band.
 */
export function readinessBand(score: number): "green" | "amber" | "red" {
  if (score >= 70) return "green";
  if (score >= 45) return "amber";
  return "red";
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN-TO-BIKE SUBSTITUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates required bike duration to match run CTL contribution.
 * bike_tss_per_min: Z2 cycling ≈ 0.85 TSS/min
 * CTL factor: ×0.75 for cycling
 *
 * Returns bike duration in minutes (always ×1.33 longer than run for equivalent aerobic stimulus).
 */
export function runToBikeDuration(
  run_duration_min: number,
  run_tss_per_min: number,
  bike_tss_per_min: number = 0.85
): number {
  const target_ctl_contribution = run_duration_min * run_tss_per_min;
  const required_bike_tss = target_ctl_contribution / 0.75;
  return required_bike_tss / bike_tss_per_min;
}

// ─────────────────────────────────────────────────────────────────────────────
// PACE DEVIATION DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if pace deviation exceeds the 8 sec/km flag threshold.
 * Both paces in sec/km.
 */
export function isPaceDeviationFlagged(
  actual_sec_per_km: number,
  planned_sec_per_km: number
): boolean {
  return Math.abs(actual_sec_per_km - planned_sec_per_km) > 8;
}

// ─────────────────────────────────────────────────────────────────────────────
// TAPER VOLUME
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies evidence-based taper volume reduction (Bosquet 2007: 41-60% exponential).
 * Returns adjusted volume percentage to use.
 */
export function taperVolumeReduction(
  days_to_race: number,
  taper_duration_days: number = 14
): number {
  if (days_to_race > taper_duration_days) return 1.0;
  const progress = 1 - days_to_race / taper_duration_days;
  // Exponential decay: at day 0 = 59% reduction, at day 14 = 0% reduction
  return 1 - 0.59 * progress;
}

// ─────────────────────────────────────────────────────────────────────────────
// NUTRITION: INTRA-SESSION CARBS
// ─────────────────────────────────────────────────────────────────────────────

export type CarbTier = {
  carbs_per_hour_g: number;
  strategy: string;
};

/**
 * Returns recommended intra-session carb intake based on duration and intensity.
 */
export function intraCarbTarget(
  duration_min: number,
  avg_hr: number,
  ias_bpm: number = 167
): CarbTier {
  const is_race_pace = avg_hr >= ias_bpm * 0.92;

  if (is_race_pace) {
    return { carbs_per_hour_g: 90, strategy: "Marathon race: 2 sources, glucose+fructose 2:1" };
  }
  if (duration_min < 60) {
    return { carbs_per_hour_g: 0, strategy: "No carbs, water only" };
  }
  if (duration_min < 90) {
    return { carbs_per_hour_g: 30, strategy: "1 gel or 500ml isotonic" };
  }
  if (duration_min < 120) {
    return { carbs_per_hour_g: 45, strategy: "1 gel every 30 min" };
  }
  return { carbs_per_hour_g: 60, strategy: "Mixed source glucose+fructose 2:1, every 20-25 min" };
}
