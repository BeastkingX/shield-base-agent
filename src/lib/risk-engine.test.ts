import { describe, expect, it } from "vitest";
import { evaluateRisk } from "./risk-engine";
import type { EvidenceItem } from "./scan-types";

function item(
  id: string,
  status: EvidenceItem["status"],
): EvidenceItem {
  return {
    id,
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

describe("deterministic risk engine", () => {
  it("does not call a baseline wallet safe", () => {
    const result = evaluateRisk("wallet", [
      item("EVIDENCE_CHAIN_STATE", "pass"),
      item("EVIDENCE_ACTIVE_APPROVALS", "unavailable"),
    ]);
    expect(result.verdict).toBe("INSUFFICIENT DATA");
  });

  it("returns caution when a warning is present", () => {
    const result = evaluateRisk("contract", [
      item("EVIDENCE_PROXY_IMPLEMENTATION", "warning"),
    ]);
    expect(result.verdict).toBe("CAUTION");
    expect(result.rules[0]?.evidenceIds).toContain(
      "EVIDENCE_PROXY_IMPLEMENTATION",
    );
  });

  it("gives dangerous evidence priority over warnings", () => {
    const result = evaluateRisk("wallet", [
      item("EVIDENCE_ACTIVE_APPROVALS", "danger"),
      item("EVIDENCE_RECENT_ACTIVITY", "warning"),
    ]);
    expect(result.verdict).toBe("HIGH OBSERVED RISK");
  });

  it("allows low observed risk only when a deep check completed", () => {
    const result = evaluateRisk("contract", [
      item("EVIDENCE_CONTRACT_VERIFICATION", "pass"),
      item("EVIDENCE_RECENT_ACTIVITY", "pass"),
    ]);
    expect(result.verdict).toBe("LOW OBSERVED RISK");
  });
});
