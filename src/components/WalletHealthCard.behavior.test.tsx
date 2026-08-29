// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { useState } from "react";
import WalletHealthCard from "./WalletHealthCard";
import type { ScanReceipt, EvidenceItem } from "@/lib/scan-types";

const ADDRESS = "0xa37bA80bA292F3EFA1387468A676660C6e6a5f96";

function evidence(
  id: string,
  status: EvidenceItem["status"],
  category: EvidenceItem["category"] = "history",
): EvidenceItem {
  return {
    id,
    category,
    label: id,
    status,
    claim: `${id} claim`,
    source: "test",
    method: "test",
    blockNumber: "12345",
    observedAt: "2026-08-29T00:00:00.000Z",
    rawValue: null,
    explorerUrl: "https://basescan.org",
    limitations: [],
  };
}

function makeReceipt(overrides: Partial<ScanReceipt> = {}): ScanReceipt {
  return {
    receiptId: "rcpt-test",
    receiptHash:
      "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    receiptVersion: "0.1",
    riskEngineVersion: "0.3",
    network: "Base Mainnet",
    chainId: 8453,
    address: ADDRESS,
    targetType: "wallet",
    blockNumber: "12345",
    blockTimestamp: "2026-08-29T00:00:00.000Z",
    scannedAt: "2026-08-29T00:00:00.000Z",
    verdict: "LOW OBSERVED RISK",
    summary: "No adverse signals.",
    coverage: { completed: 8, unavailable: 0, total: 8 },
    evidence: [
      evidence("EVIDENCE_CHAIN_STATE", "pass", "chain"),
      evidence("EVIDENCE_MONEY_TRAIL", "pass", "history"),
      evidence("EVIDENCE_ACTIVE_APPROVALS", "warning", "exposure"),
    ],
    firedRules: [],
    limitations: [],
    clusterAnalysis: {
      targetAddress: ADDRESS,
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
        target: ADDRESS,
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
      recentDeltas: [42, 96, 7],
    },
    approvalsSummary: {
      approvals: [],
      totalCount: 2,
      unlimitedCount: 1,
      highRiskCount: 0,
      uniqueTokensCount: 2,
      uniqueSpendersCount: 2,
    },
    ...overrides,
  };
}

/**
 * Controlled harness: owns the open/closed state exactly like page.tsx does,
 * so clicking the toggle exercises the real show/hide behavior.
 */
function Harness({ receipt }: { receipt: ScanReceipt }) {
  const [open, setOpen] = useState(false);
  return (
    <WalletHealthCard
      receipt={receipt}
      onOpenSendModal={() => {}}
      onToggleTechnicalEvidence={() => setOpen((v) => !v)}
      showTechnicalEvidence={open}
    />
  );
}

describe("WalletHealthCard raw evidence toggle (behavioral)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({}) }),
    );
  });

  it("panel is absent when closed", () => {
    render(<Harness receipt={makeReceipt()} />);
    expect(screen.queryByTestId("raw-evidence-panel")).toBeNull();
    expect(screen.getByText("Inspect Raw Evidence ▼")).toBeTruthy();
  });

  it("panel appears when open and shows the expected public facts", () => {
    render(<Harness receipt={makeReceipt()} />);
    fireEvent.click(screen.getByText("Inspect Raw Evidence ▼"));

    expect(screen.getByTestId("raw-evidence-panel")).toBeTruthy();
    expect(screen.getByText("Hide Raw Evidence ▲")).toBeTruthy();

    const panel = within(screen.getByTestId("raw-evidence-panel"));

    // Public technical facts are rendered
    expect(panel.getByText("Raw scan evidence")).toBeTruthy();
    expect(panel.getByText("Receipt hash")).toBeTruthy();
    expect(panel.getByText("Coverage")).toBeTruthy();
    expect(panel.getByText("Scanned block")).toBeTruthy();
    expect(panel.getByText("Cluster-analysis status")).toBeTruthy();
    expect(panel.getByText("Recent deltas")).toBeTruthy();
    expect(panel.getByText("Evidence IDs & statuses")).toBeTruthy();
    expect(panel.getByText("Approvals summary")).toBeTruthy();

    // Evidence IDs and statuses are listed
    expect(panel.getByText("EVIDENCE_CHAIN_STATE")).toBeTruthy();
    expect(panel.getByText("EVIDENCE_MONEY_TRAIL")).toBeTruthy();
    expect(panel.getByText("EVIDENCE_ACTIVE_APPROVALS")).toBeTruthy();

    // Recent deltas joined visibly
    expect(panel.getByText("42, 96, 7")).toBeTruthy();
  });

  it("clicking the control changes the visible content (toggle open -> close)", () => {
    render(<Harness receipt={makeReceipt()} />);

    // open
    fireEvent.click(screen.getByText("Inspect Raw Evidence ▼"));
    expect(screen.getByTestId("raw-evidence-panel")).toBeTruthy();
    expect(screen.getByText("Hide Raw Evidence ▲")).toBeTruthy();

    // close
    fireEvent.click(screen.getByText("Hide Raw Evidence ▲"));
    expect(screen.queryByTestId("raw-evidence-panel")).toBeNull();
    expect(screen.getByText("Inspect Raw Evidence ▼")).toBeTruthy();
  });

  it("does not render any credential material", () => {
    render(<Harness receipt={makeReceipt()} />);
    fireEvent.click(screen.getByText("Inspect Raw Evidence ▼"));

    const panel = screen.getByTestId("raw-evidence-panel");
    const text = panel.textContent ?? "";
    // The disclaimer mentions these words; ensure no secret VALUES are emitted.
    expect(text).not.toMatch(/0x[0-9a-fA-F]{64,}/i);
    expect(text).not.toMatch(/seed\s+phrase\s*[:=]/i);
    expect(text).not.toMatch(/private\s+key\s*[:=]/i);
    expect(text).not.toMatch(/api[_-]?key\s*[:=]/i);
  });
});
