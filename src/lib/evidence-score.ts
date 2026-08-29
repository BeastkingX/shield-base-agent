import type { ScanReceipt } from "./scan-types";

/**
 * "Observed Evidence Score" — a deterministic, scan-level summary of observed
 * evidence. It is NOT a reputation, trust, or identity rating, and it never
 * computes or overrides the main verdict (`receipt.verdict` stays authoritative).
 *
 * Auditable model (every weight is a named constant so the arithmetic is visible):
 *   - start at SCORE_MAX,
 *   - subtract WARNING_PENALTY for each `warning` evidence item,
 *   - subtract DANGER_PENALTY for each `danger` evidence item,
 *   - clamp to [0, SCORE_MAX],
 *   - apply a verdict ceiling: CAUTION ≤ CAUTION_SCORE_CAP, HIGH ≤ HIGH_SCORE_CAP.
 *
 * Balance and transaction count are measured facts, not trust points, and are
 * never awarded. Unavailable evidence makes the score "—" (unavailable), never
 * a high number.
 */

export const SCORE_MAX = 1000;
export const WARNING_PENALTY = 180;
export const DANGER_PENALTY = 600;
export const CAUTION_SCORE_CAP = 800;
export const HIGH_SCORE_CAP = 200;

export type EvidenceScoreTone = "safe" | "warn" | "danger" | "incomplete" | "muted";

export interface EvidenceScoreBreakdown {
  startingScore: number;
  warningCount: number;
  warningPenaltyPer: number;
  warningPenaltyTotal: number;
  dangerCount: number;
  dangerPenaltyPer: number;
  dangerPenaltyTotal: number;
  rawScore: number;
  verdictCeiling: number | null;
  capped: boolean;
  coverageCompleted: number;
  coverageUnavailable: number;
  coverageTotal: number;
  incomplete: boolean;
}

export interface EvidenceScoreResult {
  /** `null` means the score is unavailable and must be rendered as "—". */
  score: number | null;
  breakdown: EvidenceScoreBreakdown;
  grade: string;
  tone: EvidenceScoreTone;
  note: string;
}

export function calculateEvidenceScore(receipt: ScanReceipt): EvidenceScoreResult {  const coverage = receipt.coverage ?? { completed: 0, unavailable: 0, total: 0 };
  const cluster = receipt.clusterAnalysis;
  const clusterIncomplete = (cluster?.analysisStatus ?? "unavailable") !== "completed";
  const incomplete = coverage.unavailable > 0 || clusterIncomplete;

  const warningCount = receipt.evidence.filter((e) => e.status === "warning").length;
  const dangerCount = receipt.evidence.filter((e) => e.status === "danger").length;

  const warningPenaltyTotal = warningCount * WARNING_PENALTY;
  const dangerPenaltyTotal = dangerCount * DANGER_PENALTY;
  const rawScore = Math.max(
    0,
    Math.min(SCORE_MAX, SCORE_MAX - warningPenaltyTotal - dangerPenaltyTotal),
  );

  let verdictCeiling: number | null = null;
  if (receipt.verdict === "CAUTION") {
    verdictCeiling = CAUTION_SCORE_CAP;
  } else if (receipt.verdict === "HIGH OBSERVED RISK") {
    verdictCeiling = HIGH_SCORE_CAP;
  }

  const cappedScore = verdictCeiling !== null ? Math.min(rawScore, verdictCeiling) : rawScore;
  const capped = cappedScore !== rawScore;

  const breakdown: EvidenceScoreBreakdown = {
    startingScore: SCORE_MAX,
    warningCount,
    warningPenaltyPer: WARNING_PENALTY,
    warningPenaltyTotal,
    dangerCount,
    dangerPenaltyPer: DANGER_PENALTY,
    dangerPenaltyTotal,
    rawScore,
    verdictCeiling,
    capped,
    coverageCompleted: coverage.completed,
    coverageUnavailable: coverage.unavailable,
    coverageTotal: coverage.total,
    incomplete,
  };

  if (incomplete) {
    return {
      score: null,
      breakdown,
      grade: "Score unavailable",
      tone: "incomplete",
      note: "Score unavailable due to incomplete checks. Not rated as secure.",
    };
  }

  // Severity follows the verdict and measured danger evidence — a "warning"
  // (e.g. recent rapid forwarding) is never a critical hazard.
  const taintSeverity = cluster?.taintSeverity ?? "none";
  const isSweeper = cluster?.isSweeperActive ?? false;
  const critical =
    receipt.verdict === "HIGH OBSERVED RISK" || isSweeper || taintSeverity === "critical";

  if (critical) {
    return {
      score: cappedScore,
      breakdown,
      grade: "Critical hazard — danger evidence fired",
      tone: "danger",
      note: "Danger evidence is present. This is a scan-level observation, not a guarantee.",
    };
  }

  if (receipt.verdict === "CAUTION") {
    return {
      score: cappedScore,
      breakdown,
      grade: "Review required",
      tone: "warn",
      note: "Warning evidence is present. Review before interacting.",
    };
  }

  if (receipt.verdict === "LOW OBSERVED RISK") {
    return {
      score: cappedScore,
      breakdown,
      grade: "Low observed risk — complete evidence",
      tone: "safe",
      note: "No adverse signals in completed checks (not a guarantee).",
    };
  }

  // INSUFFICIENT DATA (or unknown) with complete coverage: cannot honestly score.
  return {
    score: null,
    breakdown,
    grade: "Unrated",
    tone: "muted",
    note: "Score unavailable for this verdict.",
  };
}

/**
 * Formats a penalty total for the disclosure rows: zero renders as "0"
 * (never "-0"), while a nonzero penalty renders as a negative value.
 * Presentation-only helper — does not affect scoring.
 */
export function formatPenaltyTotal(total: number): string {
  return total === 0 ? "0" : `-${total}`;
}
