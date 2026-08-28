import { describe, expect, it } from "vitest";
import { verifyReceipt, canonicalizeReceiptPayload } from "./verify-receipt";
import { createHash } from "node:crypto";

describe("verifyReceipt (cryptographic receipt verification engine)", () => {
  it("successfully verifies an authentic scan receipt", () => {
    const rawReceiptPayload = {
      receiptVersion: "0.1" as const,
      riskEngineVersion: "0.3.0",
      network: "Base Mainnet" as const,
      chainId: 8453 as const,
      address: "0xa37bA80bA292F3EFA1387468A676660C6e6a5f96",
      targetType: "wallet" as const,
      blockNumber: "28450123",
      blockTimestamp: "2026-08-28T02:00:00.000Z",
      scannedAt: "2026-08-28T02:00:01.000Z",
      verdict: "LOW OBSERVED RISK" as const,
      summary: "Standard EOA wallet with clean 1-hop upstream gas funding.",
      coverage: { completed: 6, unavailable: 0, total: 6 },
      evidence: [],
      firedRules: [{ id: "RULE_NO_BYTECODE_EOA", description: "Standard EOA wallet", level: "info" as const }],
      limitations: ["Shield is a decision-support tool."],
      clusterAnalysis: { isSweeperActive: false },
      approvalsSummary: { totalCount: 0 },
    };

    const hash = `0x${createHash("sha256").update(JSON.stringify(rawReceiptPayload)).digest("hex")}`;
    const fullReceipt = {
      receiptId: "shield_9f8e7d6c5b4a3f2e1d0c",
      receiptHash: hash,
      ...rawReceiptPayload,
    };

    const result = verifyReceipt(fullReceipt);
    expect(result.valid).toBe(true);
    expect(result.type).toBe("scan");
    expect(result.expectedHash.toLowerCase()).toBe(hash.toLowerCase());
    expect(result.computedHash.toLowerCase()).toBe(hash.toLowerCase());
    expect(result.target).toBe("0xa37bA80bA292F3EFA1387468A676660C6e6a5f96");
    expect(result.verdict).toBe("LOW OBSERVED RISK");
  });

  it("detects a tampered receipt when content is altered", () => {
    const rawReceiptPayload = {
      receiptVersion: "0.1" as const,
      riskEngineVersion: "0.3.0",
      network: "Base Mainnet" as const,
      chainId: 8453 as const,
      address: "0xa37bA80bA292F3EFA1387468A676660C6e6a5f96",
      targetType: "wallet" as const,
      blockNumber: "28450123",
      blockTimestamp: "2026-08-28T02:00:00.000Z",
      scannedAt: "2026-08-28T02:00:01.000Z",
      verdict: "LOW OBSERVED RISK" as const,
      summary: "Clean wallet",
      coverage: { completed: 6, unavailable: 0, total: 6 },
      evidence: [],
      firedRules: [],
      limitations: [],
      clusterAnalysis: { isSweeperActive: false },
      approvalsSummary: { totalCount: 0 },
    };

    const authenticHash = `0x${createHash("sha256").update(JSON.stringify(rawReceiptPayload)).digest("hex")}`;
    
    // Attacker modifies verdict to disguise a high risk target
    const tamperedReceipt = {
      receiptId: "shield_fake",
      receiptHash: authenticHash,
      ...rawReceiptPayload,
      summary: "TAMPERED SUMMARY ATTACK",
    };

    const result = verifyReceipt(tamperedReceipt);
    expect(result.valid).toBe(false);
    expect(result.computedHash.toLowerCase()).not.toBe(authenticHash.toLowerCase());
  });

  it("verifies a Pop-Up / Signature inspection receipt", () => {
    const inspectPayload = {
      title: "Clean Permit2 Signature Inspection",
      verdict: "SAFE TO SIGN",
      summary: "Verified Uniswap Permit2 transaction on Base.",
      details: "No lookalike contract spoofing.",
      signatureType: "Permit2 Single",
      parsedData: { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
      evidence: [],
      threatScore: 0,
      inspectedAt: "2026-08-28T02:10:00.000Z",
    };

    const hash = `0x${createHash("sha256").update(JSON.stringify(inspectPayload)).digest("hex")}`;
    const fullInspection = {
      receiptId: "inspect_12345678",
      receiptHash: hash,
      ...inspectPayload,
    };

    const result = verifyReceipt(fullInspection);
    expect(result.valid).toBe(true);
    expect(result.type).toBe("inspect");
    expect(result.verdict).toBe("SAFE TO SIGN");
  });
});
