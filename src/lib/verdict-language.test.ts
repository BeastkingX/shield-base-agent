import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateRisk } from "./risk-engine";
import { inspectSignaturePayload } from "./popup-inspector";
import type { EvidenceItem, Verdict } from "./scan-types";

/**
 * Verdict-language policy.
 *
 * Shield is decision support, not a guarantee. No code path may tell a user an
 * address or signature is "safe". These tests pin the exact vocabulary each
 * engine is allowed to emit and scan the production source for banned claims,
 * so the wording cannot quietly come back.
 */

const BANNED_PHRASES = [
  "SAFE TO SIGN",
  "GUARANTEED SAFE",
  "100% SAFE",
  "100% SECURE",
  "RISK-FREE",
  "RISK FREE",
  "COMPLETELY SAFE",
  "FULLY SAFE",
] as const;

const SCAN_VERDICTS: readonly Verdict[] = [
  "LOW OBSERVED RISK",
  "CAUTION",
  "HIGH OBSERVED RISK",
  "INSUFFICIENT DATA",
];

const INSPECT_VERDICTS = [
  "DO NOT SIGN",
  "CAUTION (REVIEW)",
  "NO RED FLAGS FOUND",
  "INCOMPLETE CHECKS",
  "SECURITY WARNING",
] as const;

function item(id: string, status: EvidenceItem["status"]): EvidenceItem {
  return {
    id,
    category: "identity",
    label: id,
    status,
    claim: "Test claim",
    source: "test",
    method: "test",
    blockNumber: "1",
    observedAt: "2026-08-28T00:00:00.000Z",
    rawValue: null,
    explorerUrl: "https://basescan.org",
    limitations: [],
  };
}

/** Every evidence combination that can change the scan verdict. */
const SCAN_CASES: Array<{ name: string; target: "wallet" | "contract"; evidence: EvidenceItem[] }> = [
  {
    name: "clean wallet",
    target: "wallet",
    evidence: [
      item("EVIDENCE_RECENT_ACTIVITY", "info"),
      item("EVIDENCE_ACTIVE_APPROVALS", "pass"),
    ],
  },
  {
    name: "wallet with a warning",
    target: "wallet",
    evidence: [
      item("EVIDENCE_RECENT_ACTIVITY", "warning"),
      item("EVIDENCE_ACTIVE_APPROVALS", "pass"),
    ],
  },
  {
    name: "wallet with danger evidence",
    target: "wallet",
    evidence: [
      item("EVIDENCE_RECENT_ACTIVITY", "info"),
      item("EVIDENCE_ACTIVE_APPROVALS", "danger"),
    ],
  },
  {
    name: "wallet missing required evidence",
    target: "wallet",
    evidence: [item("EVIDENCE_ACTIVE_APPROVALS", "unavailable")],
  },
  {
    name: "active sweeper",
    target: "wallet",
    evidence: [
      item("EVIDENCE_RECENT_ACTIVITY", "info"),
      item("EVIDENCE_ACTIVE_APPROVALS", "pass"),
      item("EVIDENCE_SWEEPER_BOT_ANALYSIS", "danger"),
    ],
  },
  {
    name: "drainer cluster",
    target: "wallet",
    evidence: [
      item("EVIDENCE_RECENT_ACTIVITY", "info"),
      item("EVIDENCE_ACTIVE_APPROVALS", "pass"),
      item("EVIDENCE_MONEY_TRAIL_CLUSTER", "danger"),
    ],
  },
  {
    name: "compound compromise",
    target: "wallet",
    evidence: [
      item("EVIDENCE_RECENT_ACTIVITY", "info"),
      item("EVIDENCE_ACTIVE_APPROVALS", "pass"),
      item("EVIDENCE_7702_DELEGATE", "warning"),
      item("EVIDENCE_MONEY_TRAIL_CLUSTER", "warning"),
    ],
  },
  {
    name: "clean contract",
    target: "contract",
    evidence: [
      item("EVIDENCE_CONTRACT_VERIFICATION", "pass"),
      item("EVIDENCE_CONTRACT_CREATION", "pass"),
      item("EVIDENCE_RECENT_ACTIVITY", "info"),
    ],
  },
  {
    name: "unverified contract",
    target: "contract",
    evidence: [
      item("EVIDENCE_CONTRACT_VERIFICATION", "warning"),
      item("EVIDENCE_CONTRACT_CREATION", "pass"),
      item("EVIDENCE_RECENT_ACTIVITY", "info"),
    ],
  },
  {
    name: "contract missing provenance",
    target: "contract",
    evidence: [
      item("EVIDENCE_CONTRACT_VERIFICATION", "pass"),
      item("EVIDENCE_CONTRACT_CREATION", "unavailable"),
      item("EVIDENCE_RECENT_ACTIVITY", "info"),
    ],
  },
];

const INSPECT_PAYLOADS: Array<{ name: string; payload: string }> = [
  {
    name: "private key paste",
    payload: "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d",
  },
  {
    name: "seed phrase paste",
    payload:
      "abandon ability able about above absent absorb abstract absurd abuse access accident",
  },
  {
    name: "clean bounded Permit2 permit",
    payload: JSON.stringify({
      domain: {
        name: "Permit2",
        chainId: 8453,
        verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      },
      primaryType: "PermitSingle",
      message: {
        details: {
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "100000000",
          expiration: "1787800000",
          nonce: "0",
        },
        spender: "0x2626664c2603336e57b271c5c0b26f421741e481",
        sigDeadline: "1787800000",
      },
    }),
  },
  {
    name: "spoofed Permit2 verifying contract",
    payload: JSON.stringify({
      domain: {
        name: "Permit2",
        chainId: 8453,
        verifyingContract: "0x9999999999999999999999999999999999999bad",
      },
      primaryType: "PermitSingle",
      message: {
        details: {
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount:
            "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        },
        spender: "0x9999999999999999999999999999999999999bad",
      },
    }),
  },
  {
    name: "wrong chainId",
    payload: JSON.stringify({
      domain: {
        name: "Uniswap",
        chainId: 1,
        verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      },
      message: { amount: "5000" },
    }),
  },
  { name: "blind raw hash", payload: `0x${"a".repeat(130)}` },
  { name: "malformed input", payload: "This is not json { [ malformed" },
];

describe("scan engine verdict vocabulary", () => {
  it.each(SCAN_CASES)(
    "emits only an allowed verdict for: $name",
    ({ target, evidence }) => {
      const result = evaluateRisk(target, evidence);

      expect(SCAN_VERDICTS).toContain(result.verdict);
      for (const banned of BANNED_PHRASES) {
        expect(result.verdict.toUpperCase()).not.toContain(banned);
        expect(result.summary.toUpperCase()).not.toContain(banned);
      }
    },
  );

  it("never emits an empty or free-text verdict", () => {
    for (const scenario of SCAN_CASES) {
      const { verdict } = evaluateRisk(scenario.target, scenario.evidence);
      expect(verdict.trim().length).toBeGreaterThan(0);
      expect(SCAN_VERDICTS).toContain(verdict);
    }
  });
});

describe("signature inspector verdict vocabulary", () => {
  it.each(INSPECT_PAYLOADS)(
    "emits only an allowed verdict for: $name",
    async ({ payload }) => {
      const receipt = await inspectSignaturePayload(payload);

      expect(INSPECT_VERDICTS).toContain(receipt.verdict);
      for (const banned of BANNED_PHRASES) {
        expect(receipt.verdict.toUpperCase()).not.toContain(banned);
        expect(receipt.summary.toUpperCase()).not.toContain(banned);
      }
    },
  );
});

describe("production source contains no misleading safety claims", () => {
  function walk(directory: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  const files = walk(path.join(process.cwd(), "src"));

  it("actually scanned production files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("contains none of the banned phrases", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8").toUpperCase();
      for (const banned of BANNED_PHRASES) {
        if (content.includes(banned)) {
          offenders.push(`${path.relative(process.cwd(), file)}: ${banned}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
