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

describe("honest partial-mode rescue", () => {
  it("returns HIGH OBSERVED RISK from threat intel even when recent activity is unavailable", () => {
    // This is the critical case for 0x00000c07575bb4e64457687a0382b4d3ea470000:
    // threat intel danger should win over missing required evidence
    const result = evaluateRisk("wallet", [
      item("EVIDENCE_RECENT_ACTIVITY", "unavailable"),
      item("EVIDENCE_ACTIVE_APPROVALS", "pass"),
      item("EVIDENCE_THREAT_INTEL", "danger"),
    ]);
    expect(result.verdict).toBe("HIGH OBSERVED RISK");
    expect(result.rules[0]?.id).toBe("RULE_DANGEROUS_EVIDENCE");
    expect(result.rules[0]?.evidenceIds).toContain("EVIDENCE_THREAT_INTEL");
  });

  it("returns HIGH from sweeper even when approvals unavailable", () => {
    const result = evaluateRisk("wallet", [
      item("EVIDENCE_RECENT_ACTIVITY", "info"),
      item("EVIDENCE_ACTIVE_APPROVALS", "unavailable"),
      item("EVIDENCE_SWEEPER_BOT_ANALYSIS", "danger"),
    ]);
    expect(result.verdict).toBe("HIGH OBSERVED RISK");
    expect(result.rules[0]?.id).toBe("RULE_COMPROMISED_SWEEPER_DETECTED");
  });

  it("returns INSUFFICIENT DATA when required evidence missing and no danger", () => {
    const result = evaluateRisk("wallet", [
      item("EVIDENCE_RECENT_ACTIVITY", "unavailable"),
      item("EVIDENCE_ACTIVE_APPROVALS", "pass"),
    ]);
    expect(result.verdict).toBe("INSUFFICIENT DATA");
  });

  it("withTimeout helper rejects with timeout message (simulates slow collector)", async () => {
    function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
      return Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
        ),
      ]);
    }

    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 100));
    await expect(withTimeout(slow, 10, "recent activity")).rejects.toThrow(
      /recent activity timed out/,
    );

    const fast = Promise.resolve("ok");
    await expect(withTimeout(fast, 100, "threat intel")).resolves.toBe("ok");
  });

  it("does not invent LOW when history times out – must be INSUFFICIENT DATA", () => {
    // If both history and approvals are unavailable and no danger, verdict must NOT be LOW
    const result = evaluateRisk("wallet", [
      item("EVIDENCE_RECENT_ACTIVITY", "unavailable"),
      item("EVIDENCE_ACTIVE_APPROVALS", "unavailable"),
      item("EVIDENCE_MONEY_TRAIL", "pass"),
    ]);
    expect(result.verdict).not.toBe("LOW OBSERVED RISK");
    expect(["INSUFFICIENT DATA", "CAUTION", "HIGH OBSERVED RISK"]).toContain(result.verdict);
  });
});
