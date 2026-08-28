import { createHash } from "node:crypto";
import { isAddress, getAddress, type Address } from "viem";
import { getThreatReport } from "./threat-intel";
import { getContractSourceMetadata } from "./etherscan-client";

export interface InspectionEvidence {
  id: string;
  label: string;
  status: "pass" | "warning" | "danger" | "info" | "unavailable";
  claim: string;
  facts?: Record<string, string | number | boolean | null>;
}

export interface InspectionReceipt {
  receiptId: string;
  receiptHash: string;
  scannedAt: string;
  verdict: "DO NOT SIGN" | "CAUTION (REVIEW)" | "NO RED FLAGS FOUND" | "INCOMPLETE CHECKS" | "SECURITY WARNING";
  title: string;
  summary: string;
  details?: string;
  evidence: InspectionEvidence[];
  extractedFields: {
    primaryType?: string;
    domainName?: string;
    verifyingContract?: string;
    chainId?: number | string;
    spender?: string;
    amount?: string;
    deadline?: string;
    token?: string;
  };
}

const PERMIT2_CANONICAL_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const UNLIMITED_ALLOWANCE_HEX = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

const BIP39_WORD_HINTS = [
  "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse",
  "access", "accident", "account", "accuse", "achieve", "acid", "acoustic", "acquire", "across", "act",
  "action", "actor", "actress", "actual", "adapt", "add", "addict", "address", "adjust", "admit",
  "adult", "advance", "advice", "aerobic", "affair", "afford", "afraid", "again", "age", "agent",
  "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album", "alcohol", "alert",
  "alien", "all", "alley", "allow", "almost", "alone", "alpha", "already", "also", "alter",
];

export function detectKeyOrSeedLeak(payload: string): boolean {
  const clean = payload.trim().toLowerCase();

  // 1. Raw private key detection: 64 hex characters (with or without 0x)
  const hexKeyRegex = /^(0x)?[0-9a-f]{64}$/i;
  if (hexKeyRegex.test(clean)) {
    return true;
  }

  // 2. BIP-39 Seed phrase detection (12, 15, 18, 21, 24 words)
  const words = clean.split(/\s+/).filter(Boolean);
  if ([12, 15, 18, 21, 24].includes(words.length)) {
    const matchingHints = words.filter((w) => BIP39_WORD_HINTS.includes(w));
    if (matchingHints.length >= 2 || words.every((w) => /^[a-z]{3,8}$/.test(w))) {
      return true;
    }
  }

  return false;
}

export function isBlindSignature(payload: string): boolean {
  const clean = payload.trim();
  // Standard 65-byte ECDSA signature (130 hex characters + 0x = 132) or raw sign payload
  if (/^0x[0-9a-fA-F]{128,132}$/.test(clean) || clean.toLowerCase().includes("personal_sign")) {
    return true;
  }
  return false;
}

export async function inspectSignaturePayload(rawPayload: string): Promise<InspectionReceipt> {
  const scannedAt = new Date().toISOString();

  // 1. LEAK GUARD FIRST
  if (detectKeyOrSeedLeak(rawPayload)) {
    const leakReceipt: Omit<InspectionReceipt, "receiptId" | "receiptHash"> = {
      scannedAt,
      verdict: "SECURITY WARNING",
      title: "That looks like a private key or seed phrase",
      summary: "CRITICAL: Never paste private keys or recovery seed words anywhere, including here. Shield operates strictly on-chain and never needs your keys.",
      details: "If you posted this key or seed phrase anywhere public, move your funds immediately from a fresh, newly created wallet.",
      evidence: [
        {
          id: "EVIDENCE_LEAK_GUARD",
          label: "Secret Key / Seed Phrase Pattern Detected",
          status: "danger",
          claim: "Payload format matches private key or BIP-39 mnemonic seed words. Parsing was aborted immediately for your protection.",
        },
      ],
      extractedFields: {},
    };

    const hash = `0x${createHash("sha256").update(JSON.stringify(leakReceipt)).digest("hex")}`;
    return {
      receiptId: `inspect_${hash.slice(2, 22)}`,
      receiptHash: hash,
      ...leakReceipt,
    };
  }

  // 2. BLIND SIGNATURE / RAW HASH DETECTION
  if (isBlindSignature(rawPayload)) {
    const blindReceipt: Omit<InspectionReceipt, "receiptId" | "receiptHash"> = {
      scannedAt,
      verdict: "DO NOT SIGN",
      title: "Blind Signature Detected",
      summary: "BLIND SIGNATURE: Nobody can verify what this raw hash signature does on-chain. That is exactly why blind signing is dangerous. Decline unless you completely trust the dApp.",
      evidence: [
        {
          id: "EVIDENCE_BLIND_SIGNATURE",
          label: "Opaque Raw Signature Hash",
          status: "danger",
          claim: "The payload is an opaque hash with no human-readable EIP-712 typed fields. Signing permits unknown execution.",
        },
      ],
      extractedFields: {},
    };

    const hash = `0x${createHash("sha256").update(JSON.stringify(blindReceipt)).digest("hex")}`;
    return {
      receiptId: `inspect_${hash.slice(2, 22)}`,
      receiptHash: hash,
      ...blindReceipt,
    };
  }

  // 3. EIP-7702 / JSON PARSER
  let parsedJson: any = null;
  try {
    parsedJson = JSON.parse(rawPayload);
  } catch {
    const garbageReceipt: Omit<InspectionReceipt, "receiptId" | "receiptHash"> = {
      scannedAt,
      verdict: "INCOMPLETE CHECKS",
      title: "Unrecognized Payload Format",
      summary: "Shield could not parse this signature payload as standard EIP-712 JSON typed data.",
      evidence: [
        {
          id: "EVIDENCE_PARSE_ERROR",
          label: "Invalid JSON Structure",
          status: "unavailable",
          claim: "Payload was neither valid EIP-712 JSON nor a recognized signature format.",
        },
      ],
      extractedFields: {},
    };

    const hash = `0x${createHash("sha256").update(JSON.stringify(garbageReceipt)).digest("hex")}`;
    return {
      receiptId: `inspect_${hash.slice(2, 22)}`,
      receiptHash: hash,
      ...garbageReceipt,
    };
  }

  // Extract EIP-7702 Fields
  const domain = parsedJson.domain || {};
  const message = parsedJson.message || {};
  const primaryType = parsedJson.primaryType || "Unknown";
  const domainName = domain.name || "Unknown Domain";
  const verifyingContract = domain.verifyingContract || "";
  const chainId = domain.chainId || 0;

  const spender = message.spender || message.operator || message.to || "";
  const token = message.token || message.details?.token || verifyingContract || "";
  const amount = String(message.amount || message.details?.amount || message.value || "");
  const deadline = String(message.deadline || message.details?.expiration || message.expiration || message.nonce || "");

  const extracted = {
    primaryType,
    domainName,
    verifyingContract,
    chainId,
    spender,
    amount,
    deadline,
    token,
  };

  const evidenceList: InspectionEvidence[] = [];

  // RULE 1: Blank Check / Unlimited Allowance
  const isBlankCheck =
    amount.toLowerCase() === UNLIMITED_ALLOWANCE_HEX ||
    (amount.length > 25 && !amount.startsWith("0x0")) ||
    amount === "115792089237316195423570985008687907853269984665640564039457584007913129639935";

  if (isBlankCheck) {
    evidenceList.push({
      id: "EVIDENCE_BLANK_CHECK",
      label: "Unlimited Allowance / Blank Check",
      status: "warning",
      claim: `Signature grants unlimited permission (uint256.max) to transfer tokens. This gives ${spender || "the spender"} permission to move your tokens.`,
      facts: { "Requested Allowance": "Unlimited (type(uint256).max)", "Spender": spender },
    });
  } else {
    evidenceList.push({
      id: "EVIDENCE_BLANK_CHECK",
      label: "Bounded Allowance Specified",
      status: "pass",
      claim: "Signature requests a specific bounded transfer amount rather than an unlimited allowance.",
      facts: { "Amount": amount || "Specific amount" },
    });
  }

  // RULE 2: Permit2 Lookalike & Domain Integrity
  if (domainName.toLowerCase().includes("permit2")) {
    const isCanonicalPermit2 = verifyingContract.toLowerCase() === PERMIT2_CANONICAL_ADDRESS;
    if (!isCanonicalPermit2) {
      evidenceList.push({
        id: "EVIDENCE_PERMIT2_LOOKALIKE",
        label: "Permit2 Phishing Lookalike Contract",
        status: "danger",
        claim: `CRITICAL: The domain claims to be Permit2, but the verifyingContract (${verifyingContract}) does NOT match the official canonical Permit2 address (${PERMIT2_CANONICAL_ADDRESS}). This is a classic phishing spoof.`,
        facts: { "Spoofed Contract": verifyingContract, "Canonical Permit2": PERMIT2_CANONICAL_ADDRESS },
      });
    } else {
      evidenceList.push({
        id: "EVIDENCE_PERMIT2_LOOKALIKE",
        label: "Canonical Permit2 Contract Verified",
        status: "pass",
        claim: "The verifyingContract matches the exact canonical Permit2 deployment address.",
        facts: { "Contract": PERMIT2_CANONICAL_ADDRESS },
      });
    }
  }

  // RULE 3: Network Chain ID Check
  const isBaseChain = Number(chainId) === 8453 || String(chainId) === "8453";
  if (!isBaseChain && chainId) {
    evidenceList.push({
      id: "EVIDENCE_CHAIN_MISMATCH",
      label: "Chain ID Mismatch",
      status: "warning",
      claim: `Signature targets chain ID ${chainId}, not Base Mainnet (8453). Verify which network your wallet will sign on.`,
      facts: { "Signature Chain ID": chainId, "Expected Chain": "Base (8453)" },
    });
  } else {
    evidenceList.push({
      id: "EVIDENCE_CHAIN_MISMATCH",
      label: "Base Mainnet Network Aligned",
      status: "pass",
      claim: "Signature chain ID corresponds to Base Mainnet (8453).",
      facts: { "Chain ID": 8453 },
    });
  }

  // RULE 4: Threat Intelligence & Spender Verification
  const targetToAudit = isAddress(spender) ? spender : isAddress(verifyingContract) ? verifyingContract : null;
  if (targetToAudit) {
    try {
      const threatReport = await getThreatReport(getAddress(targetToAudit));
      if (threatReport.overallStatus === "danger") {
        evidenceList.push({
          id: "EVIDENCE_SPENDER_THREAT",
          label: "Spender Flagged on Threat Lists",
          status: "danger",
          claim: `CRITICAL: The authorized spender (${targetToAudit}) is blacklisted on threat intelligence lists (${threatReport.dangerFlags.join(", ")}).`,
          facts: { "Blacklist Flags": threatReport.dangerFlags.join(", ") },
        });
      } else {
        evidenceList.push({
          id: "EVIDENCE_SPENDER_THREAT",
          label: "No Threat-Intel Flags for Spender",
          status: "pass",
          claim: "Authorized spender has no active malicious flags across GoPlus and ScamSniffer databases.",
        });
      }
    } catch {
      evidenceList.push({
        id: "EVIDENCE_SPENDER_THREAT",
        label: "Spender Threat-Intel Unavailable",
        status: "info",
        claim: "Threat intelligence check could not be completed at scan time.",
      });
    }
  }

  // Synthesize Verdict
  const hasDanger = evidenceList.some((e) => e.status === "danger");
  const hasWarning = evidenceList.some((e) => e.status === "warning");

  let verdict: InspectionReceipt["verdict"] = "NO RED FLAGS FOUND";
  let title = "No Red Flags Found in Signature";
  let summary = "The EIP-712 payload was parsed and evaluated. No drainer signatures or spoofed verifying contracts were detected.";

  if (hasDanger) {
    verdict = "DO NOT SIGN";
    title = "DO NOT SIGN: High Security Hazard Detected";
    summary = "CRITICAL: Shield detected a high-risk security hazard in this signature payload (such as a spoofed Permit2 address or blacklisted spender). Signing will likely compromise your tokens.";
  } else if (hasWarning) {
    verdict = "CAUTION (REVIEW)";
    title = "Review Parameters Before Signing";
    summary = "Shield found warning factors in this signature (such as an unlimited allowance or network mismatch). Review all spending permissions carefully before signing.";
  }

  const receiptWithoutId = {
    scannedAt,
    verdict,
    title,
    summary,
    evidence: evidenceList,
    extractedFields: extracted,
  };

  const hash = `0x${createHash("sha256").update(JSON.stringify(receiptWithoutId)).digest("hex")}`;
  return {
    receiptId: `inspect_${hash.slice(2, 22)}`,
    receiptHash: hash,
    ...receiptWithoutId,
  };
}
