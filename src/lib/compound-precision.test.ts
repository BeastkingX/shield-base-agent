import { describe, it, expect } from "vitest";
import { evaluateRisk } from "./risk-engine";
import type { EvidenceItem } from "./scan-types";

function item(id: string, status: EvidenceItem["status"]): EvidenceItem {
  return {
    id,
    category: "history",
    label: id,
    status,
    claim: "Test claim",
    source: "test",
    method: "test",
    blockNumber: "1",
    observedAt: "2026-08-23T00:00:00.000Z",
    rawValue: null,
    explorerUrl: "https://basescan.org",
    limitations: [],
  };
}

describe("compound-compromise precision fix", () => {
  it("recent-only compound case contains recent rapid forwarding", () => {
    // delegate warning + money-trail warning, no sweeper danger
    const result = evaluateRisk("wallet", [
      item("EVIDENCE_7702_DELEGATE", "warning"),
      item("EVIDENCE_MONEY_TRAIL_CLUSTER", "warning"),
      item("EVIDENCE_RECENT_ACTIVITY", "info"),
      item("EVIDENCE_ACTIVE_APPROVALS", "pass"),
    ]);

    expect(result.verdict).toBe("HIGH OBSERVED RISK");
    expect(result.rules[0]?.id).toBe("RULE_COMPOUND_COMPROMISE");
    expect(result.summary).toContain("recent rapid forwarding");
    expect(result.rules[0]?.explanation).toContain("recent rapid forwarding");
  });

  it("recent-only compound case does not contain rapid automated forwarding", () => {
    const result = evaluateRisk("wallet", [
      item("EVIDENCE_7702_DELEGATE", "warning"),
      item("EVIDENCE_MONEY_TRAIL_CLUSTER", "warning"),
      item("EVIDENCE_RECENT_ACTIVITY", "info"),
      item("EVIDENCE_ACTIVE_APPROVALS", "pass"),
    ]);

    expect(result.summary).not.toContain("rapid automated forwarding");
    expect(result.rules[0]?.explanation).not.toContain("rapid automated forwarding");
  });

  it("true sweeper evidence can still use automated wording", () => {
    // When EVIDENCE_SWEEPER_BOT_ANALYSIS danger is present, it takes priority
    // and its own summary uses automated wording. Compound case with sweeper danger
    // should still be allowed to use automated wording if reached.
    const sweeperResult = evaluateRisk("wallet", [
      item("EVIDENCE_SWEEPER_BOT_ANALYSIS", "danger"),
      item("EVIDENCE_RECENT_ACTIVITY", "info"),
      item("EVIDENCE_ACTIVE_APPROVALS", "pass"),
    ]);

    expect(sweeperResult.verdict).toBe("HIGH OBSERVED RISK");
    expect(sweeperResult.rules[0]?.id).toBe("RULE_COMPROMISED_SWEEPER_DETECTED");
    // sweeper branch wording retains automated
    expect(sweeperResult.summary.toLowerCase()).toContain("automated");
    expect(sweeperResult.rules[0]?.explanation.toLowerCase()).toContain("automated sweeper");
  });

  it("compound with sweeper danger present still uses automated wording in summary if not short-circuited (edge)", () => {
    // Edge: if someone bypasses early sweeper return, compound logic should still allow automated when sweeper danger exists
    // We simulate by checking the conditional directly via evaluateRisk with both signals + sweeper
    // Since sweeper check returns early, this test documents that early return preserves automated wording
    const result = evaluateRisk("wallet", [
      item("EVIDENCE_7702_DELEGATE", "warning"),
      item("EVIDENCE_MONEY_TRAIL_CLUSTER", "warning"),
      item("EVIDENCE_SWEEPER_BOT_ANALYSIS", "danger"),
    ]);

    // Early return means sweeper rule wins, not compound – still automated wording preserved
    expect(result.summary.toLowerCase()).toContain("automated");
  });
});
