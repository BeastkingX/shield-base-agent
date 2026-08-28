import { describe, expect, it } from "vitest";
import { inspectSignaturePayload } from "./popup-inspector";

describe("Pop-Up Signature Inspector", () => {
  it("triggers leak guard when private key or seed phrase is pasted", async () => {
    // 64-hex private key
    const privKey = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";
    const result1 = await inspectSignaturePayload(privKey);
    expect(result1.verdict).toBe("SECURITY WARNING");
    expect(result1.title).toContain("private key or seed phrase");

    // BIP-39 mnemonic seed words
    const seedPhrase = "abandon ability able about above absent absorb abstract absurd abuse access accident";
    const result2 = await inspectSignaturePayload(seedPhrase);
    expect(result2.verdict).toBe("SECURITY WARNING");
  });

  it("evaluates a clean bounded Permit2 signature payload without red flags", async () => {
    const cleanPermit = JSON.stringify({
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
    });

    const result = await inspectSignaturePayload(cleanPermit);
    expect(result.verdict).toBe("NO RED FLAGS FOUND");
    expect(result.receiptHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("flags DO NOT SIGN when a phishing permit spoofs the Permit2 verifying contract", async () => {
    const spoofedPermit = JSON.stringify({
      domain: {
        name: "Permit2",
        chainId: 8453,
        verifyingContract: "0x9999999999999999999999999999999999999bad", // Spoofed contract!
      },
      primaryType: "PermitSingle",
      message: {
        details: {
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        },
        spender: "0x9999999999999999999999999999999999999bad",
      },
    });

    const result = await inspectSignaturePayload(spoofedPermit);
    expect(result.verdict).toBe("DO NOT SIGN");
    expect(result.evidence.some((e) => e.id === "EVIDENCE_PERMIT2_LOOKALIKE" && e.status === "danger")).toBe(true);
  });

  it("flags caution when chainId does not match Base Mainnet (8453)", async () => {
    const mismatchedChain = JSON.stringify({
      domain: {
        name: "Uniswap",
        chainId: 1, // Ethereum Mainnet, not Base
        verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      },
      message: {
        amount: "5000",
      },
    });

    const result = await inspectSignaturePayload(mismatchedChain);
    expect(result.verdict).toBe("CAUTION (REVIEW)");
    expect(result.evidence.some((e) => e.id === "EVIDENCE_CHAIN_MISMATCH" && e.status === "warning")).toBe(true);
  });

  it("flags blind raw hash signatures as DO NOT SIGN", async () => {
    const rawHash = "0x" + "a".repeat(130);
    const result = await inspectSignaturePayload(rawHash);
    expect(result.verdict).toBe("DO NOT SIGN");
    expect(result.title).toContain("Blind Signature");
  });

  it("handles malformed garbage JSON input gracefully", async () => {
    const garbage = "This is not json { [ malformed";
    const result = await inspectSignaturePayload(garbage);
    expect(result.verdict).toBe("INCOMPLETE CHECKS");
    expect(result.title).toBe("Unrecognized Payload Format");
  });
});
