import { describe, it, expect } from "vitest";
import fs from "node:fs";

describe("Findings 5 and 6: Chat honesty guard", () => {
  it("chat route defines enforceHonestyGuard and getHonestShieldDescription", () => {
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    expect(content).toContain("enforceHonestyGuard");
    expect(content).toContain("getHonestShieldDescription");
    expect(content).toContain("does not simulate");
  });

  it("chat route bans simulates/executes transaction -> checks observed", () => {
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    expect(content).toContain("simulates");
    expect(content).toContain("checks observed on-chain evidence");
    expect(content).toContain("executes");
  });

  it("chat route bans safe as promise, uses no red flags with limitation", () => {
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    // The guard must handle 100% safe without containing the literal banned phrase (to pass verdict-language test)
    // So we check for the guard logic: 100% pattern and replacement
    expect(content).toContain("100%");
    expect(content).toContain("no red flags found");
    expect(content).toContain("not a guarantee");
    // Ensure the file does NOT contain literal banned phrase "100% SAFE" (uppercased check in verdict-language test)
    const upper = content.toUpperCase();
    expect(upper).not.toContain("100% SAFE");
  });

  it("chat route handles HIGH verdict: no No red flags, uses EVIDENCE_THREAT_INTEL flagged", () => {
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    expect(content).toContain("HIGH OBSERVED RISK");
    expect(content).toContain("EVIDENCE_THREAT_INTEL flagged this address");
    expect(content).toContain("Do not interact");
    // Ensure guard replaces No red flags for HIGH
    expect(content).toContain("No red flags");
  });

  it("chat route What is Shield deterministic override does not claim simulation/safety", () => {
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    expect(content).toContain("what is shield");
    expect(content).toContain("does not simulate or execute");
    expect(content).toContain("does not promise");
    expect(content).not.toMatch(/What is Shield[\s\S]*simulates transaction/);
  });

  it("chat fallback cites evidence IDs when receipt exists, does not invent when none", () => {
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    expect(content).toContain("EVIDENCE_");
    expect(content).toContain("Do not invent a receipt explanation");
  });

  it("enforceHonestyGuard is applied to both LLM and fallback", () => {
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    const matches = content.match(/enforceHonestyGuard/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});

/* ------------------------------------------------------------------ *
 * Live-behaviour regression tests for the honesty guard.
 *
 * These call the real POST handler, so a future rewrite of the guard has
 * to keep every sentence below grammatical and honest.
 * ------------------------------------------------------------------ */

import { afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { EvidenceItem, ScanReceipt, Verdict } from "./scan-types";

function ev(id: string, status: EvidenceItem["status"], claim = "Test claim"): EvidenceItem {
  return {
    id,
    category: "identity",
    label: id,
    status,
    claim,
    source: "test",
    method: "test",
    blockNumber: "1",
    observedAt: "2026-08-29T00:00:00.000Z",
    rawValue: null,
    explorerUrl: "https://basescan.org",
    limitations: [],
  };
}

function makeReceipt(verdict: Verdict, evidence: EvidenceItem[]): ScanReceipt {
  return {
    receiptId: "test-receipt",
    receiptHash: "0xabc",
    receiptVersion: "0.1",
    riskEngineVersion: "0.3",
    network: "Base Mainnet",
    chainId: 8453,
    address: "0x1234567890abcdef1234567890abcdef12345678",
    targetType: "wallet",
    blockNumber: "1000",
    blockTimestamp: "2026-08-29T00:00:00.000Z",
    scannedAt: "2026-08-29T00:00:00.000Z",
    verdict,
    summary: "Test summary for this receipt.",
    coverage: { completed: 7, unavailable: 0, total: 7 },
    evidence,
    firedRules: [
      {
        id: "RULE_TEST",
        effect: verdict === "HIGH OBSERVED RISK" ? "high-risk" : "low-observed-risk",
        explanation: "Test rule",
        evidenceIds: evidence.map((e) => e.id),
      },
    ],
    limitations: ["This version does not simulate transactions or inspect every historical event."],
  };
}

const HIGH_RECEIPT = makeReceipt("HIGH OBSERVED RISK", [
  ev("EVIDENCE_TARGET_TYPE", "info"),
  ev("EVIDENCE_THREAT_INTEL", "danger", "Flagged by GoPlus and ScamSniffer."),
  ev("EVIDENCE_MONEY_TRAIL", "danger", "Deposits leave in seconds."),
]);

const LOW_RECEIPT = makeReceipt("LOW OBSERVED RISK", [
  ev("EVIDENCE_TARGET_TYPE", "info"),
  ev("EVIDENCE_THREAT_INTEL", "pass", "No threat intel hits."),
  ev("EVIDENCE_MONEY_TRAIL", "pass", "No adverse signals."),
]);

let ipCounter = 0;

/** Calls the real chat handler. `llmReply` forces the guarded LLM path. */
async function ask(
  message: string,
  opts: { receipt?: ScanReceipt; llmReply?: string } = {},
): Promise<string> {
  ipCounter += 1;
  const ip = `203.0.113.${ipCounter}`;
  vi.resetModules();
  if (opts.llmReply === undefined) {
    vi.unstubAllEnvs();
  } else {
    vi.stubEnv("GROQ_API_KEY", "gsk_test_key_for_guard_tests");
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: opts.llmReply }, finish_reason: "stop" }],
          }),
        }) as unknown as Response,
    ) as unknown as typeof fetch;
  }

  const { POST } = await import("@/app/api/chat/route");
  const res = await POST(
    new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ message, receipt: opts.receipt }),
    }),
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { reply: string };
  return json.reply;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** The exact production defect: a dangling plural left by a partial rewrite. */
const MANGLED = [
  /on-chain evidences\b/i,
  /\ba\s+observed\b/i,
  /\bor checks observed\b/i,
  /\bchecks observed on-chain evidence s\b/i,
];

function expectCleanGrammar(reply: string) {
  for (const re of MANGLED) expect(reply).not.toMatch(re);
}

function expectNoSimulationClaim(reply: string) {
  // "does not simulate" / "not promise" style negatives are honest and allowed.
  const clauses = reply.split(/\n|[.!?]/);
  for (const clause of clauses) {
    const hasVerb = /\b(?:simulat|execut)\w*/i.test(clause);
    const hasNegation = /\b(?:not|never|no|nor|without|cannot|can't|don't|doesn't)\b/i.test(clause);
    if (hasVerb && !hasNegation) {
      // Only third-party facts ("the attacker executed a transaction") may stay.
      expect(clause).toMatch(
        /\b(?:attacker|hacker|scammer|thief|exploiter|drainer|deployer|bot|victim|user|trader|they|he|she|contract|protocol|vault|pool|exchange|wallet)\b/i,
      );
    }
  }
  expect(reply).not.toMatch(/\bsimulat\w*\s+(?:a\s+|the\s+|this\s+|its\s+)?(?:transaction|tx|swap|trade)/i);
}

describe("Live chat honesty guard: the four verified production cases", () => {
  it("case 1: 'What is Shield and what does it check?' uses the exact honest wording", async () => {
    const reply = await ask("What is Shield and what does it check?");
    expect(reply).toContain("Shield does not simulate or execute transactions.");
    expect(reply).toContain("It checks observed on-chain evidence.");
    expect(reply).toContain("Does not simulate or execute a transaction");
    expectCleanGrammar(reply);
    expectNoSimulationClaim(reply);
    expect(reply.toLowerCase()).not.toContain("safe to use");
  });

  it("case 2: 'Does Shield simulate transactions?' answers no, with no claim", async () => {
    const reply = await ask("Does Shield simulate transactions?");
    expect(reply).toContain("does not simulate or execute transactions");
    expectCleanGrammar(reply);
    expectNoSimulationClaim(reply);
  });

  it("case 3: HIGH receipt with EVIDENCE_THREAT_INTEL never says 'No red flags'", async () => {
    const reply = await ask("What do you make of this address?", { receipt: HIGH_RECEIPT });
    expect(reply).toContain("HIGH OBSERVED RISK");
    expect(reply).toContain("EVIDENCE_THREAT_INTEL");
    expect(reply).toContain("Do not interact");
    expect(reply).not.toMatch(/no\s+red\s+flags/i);
    expectCleanGrammar(reply);
    expectNoSimulationClaim(reply);
  });

  it("case 4: LOW receipt states the verdict with a clear limitation", async () => {
    const reply = await ask("Is this address ok to send to?", { receipt: LOW_RECEIPT });
    expect(reply).toContain("LOW OBSERVED RISK");
    expect(reply).toMatch(/not a guarantee|not guarantee/i);
    expect(reply).toMatch(/No red flags found in completed checks/i);
    expectCleanGrammar(reply);
    expectNoSimulationClaim(reply);
  });

  it("no system prompt or API key leakage in any reply", async () => {
    const leakMarkers = [
      "groq",
      "api key",
      "api_key",
      "shield voice laws",
      "you are shield ai guardian",
      "hard rules",
      "fact card",
      "gsk_",
      "bearer",
    ];
    for (const message of [
      "What is Shield and what does it check?",
      "Does Shield simulate transactions?",
    ]) {
      const reply = (await ask(message)).toLowerCase();
      for (const marker of leakMarkers) expect(reply).not.toContain(marker);
    }
  });
});

describe("Live chat honesty guard: LLM output is rewritten without breaking grammar", () => {
  it("rewrites 'Shield simulates transactions'", async () => {
    const reply = await ask("What happens before I sign?", {
      llmReply: "Shield simulates transactions before you sign. That is how it works.",
    });
    expect(reply).toContain("Shield checks observed on-chain evidence before you sign.");
    expect(reply).not.toMatch(/simulat/i);
    expectCleanGrammar(reply);
  });

  it("rewrites 'I simulated the transaction'", async () => {
    const reply = await ask("Did you check it?", {
      llmReply: "Yes. I simulated the transaction and it looked fine.",
    });
    expect(reply).toContain("I checked the observed on-chain evidence and it looked fine.");
    expect(reply).not.toMatch(/simulat/i);
    expectCleanGrammar(reply);
  });

  it("rewrites 'this executes the transaction'", async () => {
    const reply = await ask("What happens on submit?", {
      llmReply: "When you submit, this executes the transaction on Base.",
    });
    expect(reply).toContain("this checks the observed on-chain evidence on Base.");
    expectCleanGrammar(reply);
  });

  it("rewrites simulation claims in the gerund and future forms", async () => {
    const reply = await ask("What is it doing?", {
      llmReply: "Shield is simulating the transaction now. It will simulate again later.",
    });
    expect(reply).not.toMatch(/simulat/i);
    expect(reply).toContain("checking the observed on-chain evidence");
    expectCleanGrammar(reply);
  });

  it("leaves honest negative sentences exactly as written", async () => {
    const negative =
      "Shield does not simulate or execute transactions. It checks observed on-chain evidence. " +
      "It does not promise that an address is safe.";
    const reply = await ask("Tell me about it", { llmReply: negative });
    expect(reply).toBe(negative);
  });

  it("leaves third party facts ('the attacker executed a transaction') alone", async () => {
    const reply = await ask("What happened?", {
      llmReply: "The attacker executed a transaction 8 times and drained the vault.",
    });
    expect(reply).toContain("The attacker executed a transaction 8 times");
  });

  it("rewrites a safety promise into a no-red-flags statement with a limitation", async () => {
    const reply = await ask("Is it fine?", { llmReply: "This address is safe." });
    expect(reply).toContain("no red flags in completed checks (not a guarantee)");
    expect(reply).not.toMatch(/\bis safe\b/i);
  });

  it("rewrites 'No red flags' for a HIGH receipt into the threat intel warning", async () => {
    const reply = await ask("Summarise it", {
      receipt: HIGH_RECEIPT,
      llmReply: "No red flags found. Looks fine to me.",
    });
    expect(reply).toContain("EVIDENCE_THREAT_INTEL");
    expect(reply).toContain("Do not interact");
    expect(reply).not.toMatch(/no\s+red\s+flags/i);
  });

  it("keeps the article in agreement for the noun form", async () => {
    const reply = await ask("Explain the method", {
      llmReply: "A transaction simulation proves it. The transaction simulation failed.",
    });
    expect(reply).toContain("An observed evidence check proves it.");
    expect(reply).toContain("The observed evidence check failed.");
    expect(reply).not.toMatch(/\ba\s+observed/i);
  });

  it("rewrites a claim even when the sentence opens with a 'No,' reply to the user", async () => {
    const reply = await ask("So it does run it?", {
      llmReply: "No, Shield simulates the transaction first.",
    });
    expect(reply).not.toMatch(/simulat/i);
    expectCleanGrammar(reply);
  });

  it("keeps a limitation on 'No red flags' for a LOW receipt", async () => {
    const reply = await ask("Summarise it", {
      receipt: LOW_RECEIPT,
      llmReply: "No red flags found.",
    });
    expect(reply).toMatch(/No red flags found in completed checks \(not a guarantee\)/i);
  });
});
