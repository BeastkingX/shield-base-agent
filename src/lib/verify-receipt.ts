import { createHash } from "node:crypto";
import type { ScanReceipt } from "./scan-types";
import type { InspectionReceipt } from "./popup-inspector";

export interface VerificationResult {
  valid: boolean;
  type: "scan" | "inspect" | "unknown";
  expectedHash: string;
  computedHash: string;
  target?: string;
  verdict?: string;
  timestamp?: string;
  blockNumber?: string;
  error?: string;
  receipt?: any;
}

/**
 * Strips receiptId and receiptHash, preserving exact canonical property order
 * for hashing consistent with scan-agent.ts and popup-inspector.ts.
 */
export function canonicalizeReceiptPayload(receipt: Record<string, any>): {
  canonicalObject: Record<string, any>;
  type: "scan" | "inspect" | "unknown";
} {
  // Check if it's a ScanReceipt
  if (receipt.network === "Base Mainnet" || "riskEngineVersion" in receipt || "targetType" in receipt) {
    const keysOrder = [
      "receiptVersion",
      "riskEngineVersion",
      "network",
      "chainId",
      "address",
      "targetType",
      "blockNumber",
      "blockTimestamp",
      "scannedAt",
      "verdict",
      "summary",
      "coverage",
      "evidence",
      "firedRules",
      "limitations",
      "clusterAnalysis",
      "approvalsSummary",
    ];

    const canonical: Record<string, any> = {};
    for (const key of keysOrder) {
      if (key in receipt) {
        canonical[key] = receipt[key];
      }
    }
    // Also attach any extra keys that might exist except receiptId and receiptHash
    for (const [key, val] of Object.entries(receipt)) {
      if (key !== "receiptId" && key !== "receiptHash" && !(key in canonical)) {
        canonical[key] = val;
      }
    }
    return { canonicalObject: canonical, type: "scan" };
  }

  // Check if it's an InspectionReceipt (Pop-Up / Signature)
  if ("signatureType" in receipt || "parsedData" in receipt || "threatScore" in receipt) {
    const keysOrder = [
      "title",
      "verdict",
      "summary",
      "details",
      "signatureType",
      "parsedData",
      "evidence",
      "threatScore",
      "inspectedAt",
    ];

    const canonical: Record<string, any> = {};
    for (const key of keysOrder) {
      if (key in receipt) {
        canonical[key] = receipt[key];
      }
    }
    for (const [key, val] of Object.entries(receipt)) {
      if (key !== "receiptId" && key !== "receiptHash" && !(key in canonical)) {
        canonical[key] = val;
      }
    }
    return { canonicalObject: canonical, type: "inspect" };
  }

  // Generic fallback: copy all keys except receiptId and receiptHash
  const fallback: Record<string, any> = {};
  for (const [k, v] of Object.entries(receipt)) {
    if (k !== "receiptId" && k !== "receiptHash") {
      fallback[k] = v;
    }
  }
  return { canonicalObject: fallback, type: "unknown" };
}

/**
 * Node.js / Server-side verification function using crypto.createHash
 */
export function verifyReceipt(rawInput: string | Record<string, any>): VerificationResult {
  try {
    const parsed: Record<string, any> =
      typeof rawInput === "string" ? JSON.parse(rawInput.trim()) : rawInput;

    const expectedHash = String(parsed.receiptHash || parsed.hash || "").toLowerCase();
    if (!expectedHash) {
      return {
        valid: false,
        type: "unknown",
        expectedHash: "",
        computedHash: "",
        error: "Missing 'receiptHash' field in receipt JSON.",
      };
    }

    const { canonicalObject, type } = canonicalizeReceiptPayload(parsed);
    const jsonStr = JSON.stringify(canonicalObject);
    const computedHash = `0x${createHash("sha256").update(jsonStr).digest("hex")}`.toLowerCase();

    const valid = computedHash === expectedHash;

    return {
      valid,
      type,
      expectedHash,
      computedHash,
      target: parsed.address || parsed.title || "Unknown target",
      verdict: parsed.verdict || "Unknown verdict",
      timestamp: parsed.scannedAt || parsed.inspectedAt || parsed.blockTimestamp,
      blockNumber: parsed.blockNumber ? String(parsed.blockNumber) : undefined,
      receipt: parsed,
    };
  } catch (err: any) {
    return {
      valid: false,
      type: "unknown",
      expectedHash: "",
      computedHash: "",
      error: err?.message || "Invalid JSON formatted receipt.",
    };
  }
}

/**
 * Browser / WebCrypto SHA-256 verification function
 */
export async function verifyReceiptBrowser(
  rawInput: string | Record<string, any>,
): Promise<VerificationResult> {
  try {
    const parsed: Record<string, any> =
      typeof rawInput === "string" ? JSON.parse(rawInput.trim()) : rawInput;

    const expectedHash = String(parsed.receiptHash || parsed.hash || "").toLowerCase();
    if (!expectedHash) {
      return {
        valid: false,
        type: "unknown",
        expectedHash: "",
        computedHash: "",
        error: "Missing 'receiptHash' field in receipt JSON.",
      };
    }

    const { canonicalObject, type } = canonicalizeReceiptPayload(parsed);
    const jsonStr = JSON.stringify(canonicalObject);

    let computedHash = "";
    if (typeof window !== "undefined" && window.crypto?.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(jsonStr);
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      computedHash = `0x${hex}`.toLowerCase();
    } else {
      computedHash = `0x${createHash("sha256").update(jsonStr).digest("hex")}`.toLowerCase();
    }

    const valid = computedHash === expectedHash;

    return {
      valid,
      type,
      expectedHash,
      computedHash,
      target: parsed.address || parsed.title || "Unknown target",
      verdict: parsed.verdict || "Unknown verdict",
      timestamp: parsed.scannedAt || parsed.inspectedAt || parsed.blockTimestamp,
      blockNumber: parsed.blockNumber ? String(parsed.blockNumber) : undefined,
      receipt: parsed,
    };
  } catch (err: any) {
    return {
      valid: false,
      type: "unknown",
      expectedHash: "",
      computedHash: "",
      error: err?.message || "Invalid JSON formatted receipt.",
    };
  }
}
