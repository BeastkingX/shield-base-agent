import { describe, it, expect } from "vitest";
import {
  calculateEvidenceScore,
  SCORE_MAX,
  WARNING_PENALTY,
  DANGER_PENALTY,
  CAUTION_SCORE_CAP,
  HIGH_SCORE_CAP,
} from "./evidence-score";
import type { ScanReceipt, EvidenceItem } from "./scan-types";
import type { ClusterAnalysis } from "./cluster-detector";

function item(
  id: string,
  status: EvidenceItem["status"],
  facts?: Record<string, string | number | boolean | null>,
): EvidenceItem {
  return {
    id,
    category: "identity",
    label: id,
    status,
    claim: "Test claim",
    source: "test",
    method: "test",
    blockNumber: "1",
    observedAt: "2026-08-23T00:00:00.000Z",
    rawValue: null,
    facts,
    explorerUrl: "https://basescan.org",
    limitations: [],
  };
}

function makeCluster(overrides: Partial<ClusterAnalysis> = {}): ClusterAnalysis {
  return {
    targetAddress: "0x0000000000000000000000000000000000000000",
    hasTaint: false,
    taintSeverity: "none",
    clusterTaintName: null,
    seedFunder: "None observed",
    sweepDestination: "None observed",
    isSweeperActive: false,
    sweepVelocitySeconds: null,
    forensicTraceNotes: [],
    moneyTrailGraph: {
      upstreamFunder: "None observed",
      funderType: "Clean / Normal Funder",
      target: "0x0000000000000000000000000000000000000000",
      downstreamHub: "None observed",
      hubType: "No outbound forwarding observed",
    },
    analysisStatus: "completed",
    velocitySamples: 0,
    retainedRatio: null,
    funderProfile: "No dispenser pattern measured",
    hubProfile: "No aggregator pattern measured",
    hop2Funder: null,
    sampledTransactions: 0,
    recentRapidForwarding: false,
    recentDeltas: [],
    ...overrides,
  };
}

function makeReceipt(overrides: Partial<ScanReceipt> = {}): ScanReceipt {
  return {
    receiptId: "test-receipt",
    receiptVersion: "0.1",
    riskEngineVersion: "0.3",
    network: "Base Mainnet",
    chainId: 8453,
    address: "0x0000000000000000000000000000000000000000",
    targetType: "wallet",
    blockNumber: "1",
    blockTimestamp: "2026-08-23T00:00:00.000Z",
    scannedAt: "2026-08-23T00:00:00.000Z",
    verdict: "LOW OBSERVED RISK",
    summary: "",
    coverage: { completed: 9, unavailable: 0, total: 9 },
    evidence: [],
    firedRules: [],
    limitations: [],
    clusterAnalysis: makeCluster(),
    ...overrides,
  };
}

describe("calculateEvidenceScore (Finding 13)", () => {
  it("complete LOW evidence with no warnings scores the full 1000", () => {
    const result = calculateEvidenceScore(
      makeReceipt({
        verdict: "LOW OBSERVED RISK",
        evidence: [
          item("EVIDENCE_CHAIN_STATE", "pass"),
          item("EVIDENCE_MONEY_TRAIL", "pass"),
          item("EVIDENCE_ACTIVE_APPROVALS", "pass"),
        ],
      }),
    );
    expect(result.score).toBe(SCORE_MAX);
    expect(result.tone).toBe("safe");
    expect(result.breakdown.warningCount).toBe(0);
    expect(result.breakdown.dangerCount).toBe(0);
  });

  it("complete CAUTION with one warning is capped at the CAUTION ceiling", () => {
    const result = calculateEvidenceScore(
      makeReceipt({
        verdict: "CAUTION",
        evidence: [
          item("EVIDENCE_ACTIVE_APPROVALS", "warning"),
          item("EVIDENCE_MONEY_TRAIL", "pass"),
        ],
      }),
    );
    // raw = 1000 - 180 = 820, capped to 800
    expect(result.breakdown.warningCount).toBe(1);
    expect(result.breakdown.warningPenaltyTotal).toBe(WARNING_PENALTY);
    expect(result.breakdown.rawScore).toBe(820);
    expect(result.breakdown.capped).toBe(true);
    expect(result.score).toBe(CAUTION_SCORE_CAP);
    expect(result.tone).toBe("warn");
  });

  it("HIGH with danger evidence scores low and is capped below 200", () => {
    const result = calculateEvidenceScore(
      makeReceipt({
        verdict: "HIGH OBSERVED RISK",
        evidence: [
          item("EVIDENCE_THREAT_INTEL", "danger"),
          item("EVIDENCE_MONEY_TRAIL", "pass"),
        ],
      }),
    );
    // raw = 1000 - 600 = 400, capped to 200
    expect(result.breakdown.dangerCount).toBe(1);
    expect(result.breakdown.dangerPenaltyTotal).toBe(DANGER_PENALTY);
    expect(result.breakdown.rawScore).toBe(400);
    expect(result.score).toBe(HIGH_SCORE_CAP);
    expect(result.tone).toBe("danger");
  });

  it("incomplete evidence returns a null score (—), never 950 or Prime Trust", () => {
    const result = calculateEvidenceScore(
      makeReceipt({
        verdict: "LOW OBSERVED RISK",
        coverage: { completed: 8, unavailable: 1, total: 9 },
        evidence: [item("EVIDENCE_MONEY_TRAIL", "unavailable")],
      }),
    );
    expect(result.score).toBeNull();
    expect(result.tone).toBe("incomplete");
    expect(result.grade).toBe("Score unavailable");
  });

  it("cluster analysis not completed also returns a null score", () => {
    const result = calculateEvidenceScore(
      makeReceipt({
        verdict: "CAUTION",
        clusterAnalysis: makeCluster({ analysisStatus: "unavailable" }),
        evidence: [item("EVIDENCE_MONEY_TRAIL", "warning")],
      }),
    );
    expect(result.score).toBeNull();
    expect(result.tone).toBe("incomplete");
  });

  it("does not award points for balance or transaction count", () => {
    const lowActivity = calculateEvidenceScore(
      makeReceipt({
        verdict: "LOW OBSERVED RISK",
        evidence: [
          item("EVIDENCE_NATIVE_BALANCE", "pass", { "Native balance": "0 ETH" }),
          item("EVIDENCE_TRANSACTION_COUNT", "pass", { "Transaction count": 0 }),
        ],
      }),
    );
    const highActivity = calculateEvidenceScore(
      makeReceipt({
        verdict: "LOW OBSERVED RISK",
        evidence: [
          item("EVIDENCE_NATIVE_BALANCE", "pass", { "Native balance": "1000000 ETH" }),
          item("EVIDENCE_TRANSACTION_COUNT", "pass", { "Transaction count": 99999 }),
        ],
      }),
    );
    // Balance / tx count are facts, not trust points — identical score.
    expect(lowActivity.score).toBe(highActivity.score);
    expect(lowActivity.score).toBe(SCORE_MAX);
  });

  it("breakdown arithmetic matches the final score (displayed math is honest)", () => {
    const result = calculateEvidenceScore(
      makeReceipt({
        verdict: "CAUTION",
        evidence: [
          item("EVIDENCE_ACTIVE_APPROVALS", "warning"),
          item("EVIDENCE_RECENT_ACTIVITY", "warning"),
        ],
      }),
    );
    const b = result.breakdown;
    const computedRaw = Math.max(
      0,
      Math.min(
        SCORE_MAX,
        b.startingScore - b.warningPenaltyTotal - b.dangerPenaltyTotal,
      ),
    );
    const computed = b.verdictCeiling !== null ? Math.min(computedRaw, b.verdictCeiling) : computedRaw;
    expect(b.rawScore).toBe(computedRaw);
    expect(result.score).toBe(computed);
    // 2 warnings: 1000 - 360 = 640, under the 800 ceiling
    expect(result.score).toBe(640);
  });

  it("never overrides the verdict: CAUTION stays CAUTION with a numeric score", () => {
    const receipt = makeReceipt({
      verdict: "CAUTION",
      evidence: [item("EVIDENCE_ACTIVE_APPROVALS", "warning")],
    });
    const before = receipt.verdict;
    const result = calculateEvidenceScore(receipt);
    expect(receipt.verdict).toBe(before);
    expect(result.score).not.toBeNull();
  });
});

describe("Finding 12: warning must never be styled as danger", () => {
  it("a recent-forwarding warning shows amber review, not Critical Hazard/Blacklisted/Drainer/120", () => {
    const result = calculateEvidenceScore(
      makeReceipt({
        verdict: "CAUTION",
        evidence: [
          item("EVIDENCE_MONEY_TRAIL_CLUSTER", "warning"),
          item("EVIDENCE_MONEY_TRAIL", "pass"),
        ],
        clusterAnalysis: makeCluster({
          hasTaint: true,
          taintSeverity: "warning",
          clusterTaintName: "Recent rapid-forwarding state change",
          recentRapidForwarding: true,
          isSweeperActive: false,
          analysisStatus: "completed",
        }),
      }),
    );
    expect(result.tone).toBe("warn");
    expect(result.grade).not.toContain("Critical Hazard");
    expect(result.grade).not.toContain("Blacklisted");
    expect(result.grade).not.toContain("Drainer");
    expect(result.score).not.toBe(120);
  });

  it("critical drainer taint may use danger styling", () => {
    const result = calculateEvidenceScore(
      makeReceipt({
        verdict: "HIGH OBSERVED RISK",
        evidence: [item("EVIDENCE_THREAT_INTEL", "danger")],
        clusterAnalysis: makeCluster({
          hasTaint: true,
          taintSeverity: "critical",
          clusterTaintName: "Phishing Network",
          isSweeperActive: false,
          analysisStatus: "completed",
        }),
      }),
    );
    expect(result.tone).toBe("danger");
    expect(result.score).toBeLessThan(HIGH_SCORE_CAP + 1);
  });
});
