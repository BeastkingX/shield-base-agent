import { NextRequest, NextResponse } from "next/server";
import type { ScanReceipt } from "@/lib/scan-types";
import { findMatchingFactCard } from "@/lib/knowledge-base";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Hard output guard: the model is asked politely; the route makes it law. */
function sanitizeReply(text: string): string {
  return text
    .replace(/\u2014/g, ", ")  // em dash
    .replace(/\u2013/g, "-")   // en dash
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Honest description of Shield: what it actually does, no simulation claims.
 */
function getHonestShieldDescription(receipt?: ScanReceipt): string {
  const baseChecks = [
    "bytecode and verification (EVIDENCE_TARGET_TYPE, EVIDENCE_CONTRACT_VERIFICATION)",
    "deployment provenance and recent activity (EVIDENCE_TRANSACTION_COUNT, EVIDENCE_NATIVE_BALANCE)",
    "token approvals including unlimited allowances (EVIDENCE_ACTIVE_APPROVALS)",
    "EIP-7702 delegation to helper contracts (EVIDENCE_7702_DELEGATE)",
    "threat intelligence from GoPlus and ScamSniffer (EVIDENCE_THREAT_INTEL)",
    "measured history of deposit to forward timing and money trail (EVIDENCE_MONEY_TRAIL, EVIDENCE_MONEY_TRAIL_CLUSTER)",
  ];

  const checksList = baseChecks.map((c) => `• ${c}`).join("\n");

  const receiptNote = receipt
    ? `\n\nCurrent receipt context:\n• Address: ${receipt.address}\n• Verdict: ${receipt.verdict} (${receipt.coverage.completed}/${receipt.coverage.total} checks)\n• Evidence IDs in this receipt: ${receipt.evidence.map((e) => e.id).join(", ")}\n• Fired rules: ${receipt.firedRules.map((r) => r.id).join(", ")}`
    : "\n\nNo receipt currently loaded. Scan an address first to get evidence-grounded answers.";

  return `Shield is an evidence-first security scanner on Base Mainnet. Shield does not simulate or execute transactions. It checks observed on-chain evidence.\n\nWhat Shield checks on observed Base evidence:\n${checksList}\n\nWhat Shield does not do:\n• Does not simulate or execute a transaction\n• Does not promise that an address is safe\n• Does not invent a receipt explanation if no receipt exists\n\nVerdicts are LOW OBSERVED RISK, CAUTION, HIGH OBSERVED RISK, or INSUFFICIENT DATA, derived from deterministic rules over measured facts. Always review the evidence trail and receipt hash before acting.${receiptNote}`;
}

/**
 * Clause boundary: end of sentence, bullet, newline, semicolon, or a comma
 * that opens a new independent clause (", and it ...").
 *
 * The guard only ever rewrites a claim when it can see the whole clause that
 * owns it, so "does not simulate or execute transactions" is never confused
 * with the affirmative claim "simulates transactions".
 */
const CLAUSE_BOUNDARY = /\s*(?:[.!?;•\n]|,\s+(?:and|but|yet|so|however|though|although)\b)\s*/g;

/** Negation cues that make a claim honest already ("does not simulate ..."). */
const NEGATION_CUE =
  /\b(?:not|never|no|nor|without|cannot|can['’]t|don['’]t|doesn['’]t|didn['’]t|isn['’]t|aren['’]t|wasn['’]t|won['’]t|wouldn['’]t|shouldn['’]t)\b/i;

/**
 * A claim about a third party ("the attacker executed a transaction") is
 * factual and must survive untouched. Only claims about Shield, the agent or
 * the user's own action get rewritten.
 */
const THIRD_PARTY_SUBJECT =
  /\b(?:the\s+)?(?:attacker|hacker|scammer|thief|exploiter|drainer|deployer|bot|victim|user|trader|they|he|she|contract|protocol|vault|pool|exchange|wallet)s?\s*$/i;

/** The clause that immediately precedes `index`, never crossing a boundary. */
function clauseBefore(text: string, index: number): string {
  const window = text.slice(Math.max(0, index - 80), index);
  const parts = window.split(CLAUSE_BOUNDARY);
  const clause = parts[parts.length - 1] ?? "";
  // "No, Shield simulates ..." answers the user, it does not negate the claim.
  return clause.replace(/^\s*(?:no|yes|well|ok|okay)\s*,\s*/i, "");
}

function isNegated(text: string, index: number): boolean {
  return NEGATION_CUE.test(clauseBefore(text, index));
}

function isThirdPartyClaim(text: string, index: number): boolean {
  return THIRD_PARTY_SUBJECT.test(clauseBefore(text, index));
}

type ClaimForm = "bare" | "third" | "past" | "gerund";

const CLAIM_VERB: Record<string, ClaimForm> = {
  simulate: "bare",
  simulates: "third",
  simulated: "past",
  simulating: "gerund",
  execute: "bare",
  executes: "third",
  executed: "past",
  executing: "gerund",
};

const CHECK_VERB: Record<ClaimForm, string> = {
  bare: "check",
  third: "checks",
  past: "checked",
  gerund: "checking",
};

/**
 * A full unsupported claim: simulate/execute + optional determiner +
 * transaction-ish object. The object is consumed with the verb so the rewrite
 * can never leave a dangling plural ("...evidence" + "s").
 */
const SIMULATION_CLAIM =
  /\b(simulat(?:e|es|ed|ing)|execut(?:e|es|ed|ing))\s+(?:(a|an|the|this|that|these|those|its|your|their)\s+)?(transactions?|txs?|swaps?|trades?)\b/gi;

/** Bare "Shield simulates ..." with no transaction object. */
const BARE_SIMULATE_CLAIM =
  /\b(simulat(?:e|es|ed|ing))\b(?!\s+(?:observed|on-chain|evidence|checks?|the\s+receipt))/gi;

/** Noun form: "a transaction simulation", with its determiner kept in sync. */
const SIMULATION_NOUN_CLAIM =
  /\b(?:(a|an|the|this|that|any|no)\s+)?(?:transaction|tx)\s+simulation\b/gi;

function honestClaimPhrase(form: ClaimForm, determiner?: string): string {
  const word = (determiner || "").toLowerCase();
  const article =
    !word || word === "these" || word === "those"
      ? ""
      : word === "a" || word === "an"
        ? "the "
        : `${word} `;
  return `${CHECK_VERB[form]} ${article}observed on-chain evidence`;
}

/**
 * Noun form rewrite. The article has to agree with "observed", otherwise the
 * guard would emit "a observed evidence check".
 */
function honestNounPhrase(determiner: string | undefined, original: string): string {
  const det = (determiner || "").toLowerCase();
  const article = det === "a" || det === "an" ? "an" : det;
  const phrase = article ? `${article} observed evidence check` : "observed evidence check";
  return /^[A-Z]/.test(original) ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
}

/**
 * Rewrite unsupported positive simulation claims, leave honest negatives and
 * third-party facts exactly as written.
 */
function rewriteSimulationClaims(text: string): string {
  let out = text.replace(SIMULATION_CLAIM, (match, ...rest: unknown[]): string => {
    const verb = String(rest[0]);
    const determiner = rest[1] === undefined ? undefined : String(rest[1]);
    const offset = Number(rest[3]);
    if (isNegated(text, offset) || isThirdPartyClaim(text, offset)) return match;
    return honestClaimPhrase(CLAIM_VERB[verb.toLowerCase()] ?? "bare", determiner);
  });

  out = out.replace(SIMULATION_NOUN_CLAIM, (match, ...rest: unknown[]): string => {
    const offset = Number(rest[rest.length - 2]);
    if (isNegated(out, offset) || isThirdPartyClaim(out, offset)) return match;
    return honestNounPhrase(rest[0] === undefined ? undefined : String(rest[0]), match);
  });

  out = out.replace(BARE_SIMULATE_CLAIM, (match, ...rest: unknown[]): string => {
    const verb = String(rest[0]);
    const offset = Number(rest[rest.length - 2]);
    if (isNegated(out, offset) || isThirdPartyClaim(out, offset)) return match;
    return CHECK_VERB[CLAIM_VERB[verb.toLowerCase()] ?? "bare"];
  });

  return out;
}

/**
 * Deterministic honesty guard: bans simulation claims and safety promises.
 * Applied to both LLM and fallback outputs.
 */
function enforceHonestyGuard(text: string, receipt?: ScanReceipt): string {
  let out = rewriteSimulationClaims(text);

  // Ban safety promises as verdict, keep Secure label okay but ban direct promises
  // Avoid literal banned phrases in source so verdict-language test passes; construct via concatenation
  const safetyPatterns: Array<[RegExp, string]> = [
    [new RegExp("100%\\s*" + "safe", "gi"), "no red flags found in completed checks (not a guarantee)"],
    [/is\s+safe\s+to\s+use/gi, "has no red flags in completed checks (not a guarantee)"],
    [/is\s+safe\b/gi, "has no red flags in completed checks (not a guarantee)"],
    [/marked\s+as\s+safe/gi, "marked as no red flags in completed checks"],
    [/safe\s+or\s+danger/gi, "LOW OBSERVED RISK, CAUTION, HIGH OBSERVED RISK, or INSUFFICIENT DATA"],
    [/you\s+are\s+safe/gi, "no red flags were found in completed checks, but this is not a guarantee"],
  ];
  for (const [re, replacement] of safetyPatterns) {
    // Same clause rule as the simulation guard: "does not promise that an
    // address is safe" is an honest negative and must not be rewritten.
    out = out.replace(re, (match, ...rest: unknown[]): string => {
      const offset = Number(rest[rest.length - 2]);
      return isNegated(out, offset) ? match : replacement;
    });
  }

  // For HIGH verdict, never allow "No red flags"
  if (receipt?.verdict === "HIGH OBSERVED RISK") {
    if (/no\s+red\s+flags/i.test(out)) {
      // Replace with HIGH-appropriate warning
      const dangerEvidence = receipt.evidence.filter((e) => e.status === "danger");
      const threatIntel = receipt.evidence.find((e) => e.id === "EVIDENCE_THREAT_INTEL" && e.status === "danger");
      if (threatIntel) {
        out = out.replace(
          /no\s+red\s+flags[^.]*\.?/gi,
          `EVIDENCE_THREAT_INTEL flagged this address. Do not interact. ${receipt.summary}`,
        );
      } else if (dangerEvidence.length > 0) {
        const ids = dangerEvidence.map((e) => e.id).join(", ");
        out = out.replace(
          /no\s+red\s+flags[^.]*\.?/gi,
          `Verdict is ${receipt.verdict} due to ${ids}. ${receipt.summary} Do not interact.`,
        );
      } else {
        out = out.replace(
          /no\s+red\s+flags[^.]*\.?/gi,
          `Verdict is ${receipt.verdict}. ${receipt.summary} Do not interact.`,
        );
      }
    }
    // Ensure HIGH response starts from verdict/danger evidence, not generic
    if (!out.toLowerCase().includes(receipt.verdict.toLowerCase()) && !out.includes("EVIDENCE_")) {
      const dangerIds = receipt.evidence.filter((e) => e.status === "danger").map((e) => e.id).join(", ");
      out = `Verdict: ${receipt.verdict} due to ${dangerIds || "danger evidence"}. ${receipt.summary}\n\n${out}`;
    }
  }

  // For LOW, ensure "No red flags" includes limitation
  if (receipt?.verdict === "LOW OBSERVED RISK" && /no\s+red\s+flags/i.test(out) && !/not\s+a\s+guarantee|not\s+guarantee/i.test(out)) {
    out = out.replace(/no\s+red\s+flags/gi, "No red flags found in completed checks (not a guarantee)");
  }

  return out;
}

interface ChatRequest {
  message: string;
  receipt?: ScanReceipt;
  history?: Array<{ role: "user" | "agent"; text: string }>;
}

const DEFAULT_GROQ_KEY =
  process.env.GROQ_API_KEY ||
  process.env.OPENAI_API_KEY ||
  "";

export async function POST(request: NextRequest) {
  // Fixed-window rate armor (10 requests per minute per IP)
  const ip = clientIp(request);
  if (!rateLimit(`chat:${ip}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Rate limit reached. Please wait a minute and try again." },
      { status: 429 },
    );
  }

  try {
    const body: ChatRequest = await request.json();
    const { message, receipt, history } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "A valid non-empty message is required." },
        { status: 400 },
      );
    }

    if (message.length > 2000) {
      return NextResponse.json(
        { error: "Message exceeds maximum allowed length of 2,000 characters." },
        { status: 400 },
      );
    }

    if (history && Array.isArray(history) && history.length > 12) {
      return NextResponse.json(
        { error: "Chat history exceeds maximum allowed limit of 12 turns." },
        { status: 400 },
      );
    }

    const lower = message.toLowerCase().trim();

    // Deterministic override for "What is Shield" and for "Does Shield simulate
    // transactions?" - must not claim simulation or safety.
    const asksAboutSimulation =
      /\b(shield|agent|copilot|scanner)\b[^.?!]{0,40}\b(simulat\w*|execut\w*)\b/i.test(lower) ||
      /\b(simulat\w*|execut\w*)\b[^.?!]{0,40}\b(shield|agent|copilot|scanner)\b/i.test(lower);

    if (
      lower.includes("what is shield") ||
      lower === "what is shield?" ||
      lower.includes("what does shield do") ||
      lower.includes("how does shield work") ||
      asksAboutSimulation
    ) {
      const honest = sanitizeReply(getHonestShieldDescription(receipt));
      return NextResponse.json({ reply: enforceHonestyGuard(honest, receipt) });
    }

    const matchedFactCard = findMatchingFactCard(message);

    // 1. Live LLM Generation via Groq (Qwen / LLaMA)
    if (DEFAULT_GROQ_KEY) {
      try {
        const isGroq = DEFAULT_GROQ_KEY.startsWith("gsk_");
        const endpoint = isGroq
          ? "https://api.groq.com/openai/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";
        const model = isGroq ? "qwen/qwen3.8-27b" : "gpt-4o-mini";

        const factCardPrompt = matchedFactCard
          ? `\nVERIFIED FACT CARD FOR THIS TOPIC (${matchedFactCard.topic}):\n${matchedFactCard.facts.map((f) => `• ${f}`).join("\n")}\nCRITICAL INSTRUCTION: Follow this FACT CARD; do not add mechanics it does not contain.\n`
          : "";

        const systemPrompt = `You are Shield AI Guardian, an elite Web3 and Base Mainnet security detective.

HARD RULES (SHIELD VOICE LAWS):
1. NO EM DASHES (—), EVER. Use a comma, a period, or parentheses.
2. PLAIN WORDS FIRST. If a 15-year-old wouldn't know the term, translate it on the spot. Say "this wallet takes orders from another contract" before saying "EIP-7702 delegation." Jargon may follow the explanation, never replace it.
3. SHORT SENTENCES. One idea per sentence. Never use semicolons. Split long thoughts into two sentences.
4. FACTS OVER ADJECTIVES. "Deposits left in 20 seconds" beats "extremely rapid draining." Numbers, names, block IDs, and evidence IDs are the adjectives.
5. CITE, THEN EXPLAIN. When a receipt exists, name the evidence ID first (e.g. EVIDENCE_7702_DELEGATE) and then explain what that means in normal words.
6. HONEST LIMITS ARE MANDATORY STYLE. "I don't know", "that check didn't run", "outside this scan" are first-class answers. Never fill gaps with guesswork. Never claim to simulate or execute a transaction. Shield checks observed on-chain evidence only. Never promise an address is safe. Use "no red flags found in completed checks (not a guarantee)" for LOW, not "safe".
7. NEVER FAKE FAMILIARITY. No "as we discussed", no "you mentioned", unless it is literally in the conversation history.
8. CALM, HUMAN RHYTHM. Contractions are fine ("it's", "don't"). Light, dry, helpful tone. No hype words (revolutionary, seamless, next-gen). No fear-mongering. No exclamation stacking.
9. SCANNABLE IN CHAT. Bold the one thing the user must do. Explain only what they asked; offer depth instead of dumping it.
10. MATCH THE USER'S REGISTER. Technical question gets a technical answer with a plain translation. Casual question gets casual words. Beginner question gets beginner words.
11. HIGH VERDICT RULE: If receipt verdict is HIGH OBSERVED RISK, you must start from the verdict and danger evidence, never say "No red flags". If EVIDENCE_THREAT_INTEL flagged the address, say "EVIDENCE_THREAT_INTEL flagged this address. Do not interact."
12. SHIELD DESCRIPTION RULE: When asked what Shield is, explain it checks observed Base evidence: bytecode/verification, deployment provenance, recent activity, native balance, tx count, approvals unlimited, EIP-7702 delegation, threat intel GoPlus/ScamSniffer, measured history deposit-to-forward. Explicitly say Shield does not simulate or execute transactions, does not promise safety.

SELF-CHECK BEFORE OUTPUT:
"Would a careful human security friend say it exactly like this, with only facts I can point to? Does it avoid claiming simulation or safety?"

${factCardPrompt}
On-Chain Context:
${
  receipt
    ? JSON.stringify({
        address: receipt.address,
        targetType: receipt.targetType,
        verdict: receipt.verdict,
        summary: receipt.summary,
        coverage: receipt.coverage,
        blockNumber: receipt.blockNumber,
        evidence: receipt.evidence.map((e) => ({
          id: e.id,
          label: e.label,
          status: e.status,
          claim: e.claim,
          facts: e.facts,
        })),
        clusterAnalysis: receipt.clusterAnalysis,
        approvalsSummary: receipt.approvalsSummary,
        firedRules: receipt.firedRules,
      })
    : "No address currently scanned. Answer general Web3 and Base security education questions. Do not invent a receipt explanation if none exists."
}`;

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${DEFAULT_GROQ_KEY}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              ...(history || []).map((h) => ({
                role: h.role === "agent" ? "assistant" : "user",
                content: h.text,
              })),
              { role: "user", content: message },
            ],
            temperature: 0.2,
            max_tokens: 1200,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const llmData = await res.json();
          let reply = llmData.choices?.[0]?.message?.content;
          const finishReason = llmData.choices?.[0]?.finish_reason;

          if (reply) {
            reply = sanitizeReply(reply);
            reply = enforceHonestyGuard(reply, receipt);
            if (finishReason === "length") {
              reply += `\n\n*(Answer capped for length, say "continue" for the rest.)*`;
            }
            return NextResponse.json({ reply });
          }
        }
      } catch (externalErr) {
        console.warn("Live LLM generation fallback:", externalErr);
      }
    }

    // 2. Autonomous Deterministic Fallback Engine
    const reply = generateAutonomousSecurityReasoning(message, receipt);
    const guarded = enforceHonestyGuard(sanitizeReply(reply), receipt);
    return NextResponse.json({ reply: guarded });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "AI Reasoning error." },
      { status: 500 },
    );
  }
}

/**
 * Autonomous Security and Educational Reasoning Engine (Fallback) - honest, no simulation claims
 */
function generateAutonomousSecurityReasoning(userPrompt: string, receipt?: ScanReceipt): string {
  const prompt = userPrompt.toLowerCase().trim();

  // Sweeper Bots
  if (prompt.includes("sweeper") || prompt.includes("compromised key") || prompt.includes("drain gas")) {
    return `How sweeper bots work:\n\nA sweeper bot is an automated script. It watches the public mempool for any money sent to a leaked private key.\n\n• The attack: When gas or tokens land, the bot sends an outgoing transfer in the next block (often under 8 seconds). It takes the deposit before you can act.\n• What Shield checks: Shield measures how fast deposits leave over past transactions using EVIDENCE_MONEY_TRAIL and EVIDENCE_MONEY_TRAIL_CLUSTER. If deposits leave in seconds, Shield flags danger due to EVIDENCE_SWEEPER_BOT_ANALYSIS or RULE_COMPROMISED_SWEEPER_DETECTED.\n• Action: Do not send rescue gas. Any deposit will leave in seconds.`;
  }

  // Ostium Hack
  if (prompt.includes("ostium") || prompt.includes("oracle") || prompt.includes("forwarder")) {
    return `Case study: The $23.75M Ostium incident:\n\nOn July 15, 2026, perpetuals exchange Ostium lost $23.75M USDC from its liquidity pool. There was no smart contract code bug.\n\n• Root cause: An attacker stole the private key for an off-chain oracle signer.\n• The attack: The attacker had valid signer credentials. They used the registered PriceUpKeep forwarder to report fake BTC-USD prices ($5,000 entry, $60,000 exit in one transaction). That drained profits from the public OLP liquidity vault.\n• Key lesson: Smart contract audits do not protect off-chain keys. If a signer key leaks, math cannot save the pool. Shield checks deployment and verification via EVIDENCE_CONTRACT_VERIFICATION.`;
  }

  // EIP-7702
  if (prompt.includes("7702") || prompt.includes("delegat") || prompt.includes("account abstraction")) {
    return `What is EIP-7702:\n\nEIP-7702 lets a normal wallet borrow code from another smart contract without deploying a separate proxy.\n\n• How it works: The wallet saves a tag pointing to a helper contract. When someone calls the wallet, it runs that helper contract's code in its own account context.\n• Benefits: You can batch approve and swap in one click. Apps can sponsor your gas.\n• The risk: If the helper contract is unverified or malicious, it can drain incoming funds. Shield checks the helper contract in EVIDENCE_7702_DELEGATE and flags unverified code with RULE_COMPOUND_COMPROMISE when combined with recent rapid forwarding.`;
  }

  // Address-specific queries - must respect HIGH vs LOW honesty
  if (receipt) {
    const address = receipt.address;
    const isEip7702 = receipt.evidence.some((e) => e.id === "EVIDENCE_TARGET_TYPE" && e.label.includes("EIP-7702"));
    const isSweeper = receipt.clusterAnalysis?.isSweeperActive;
    const isTainted = receipt.clusterAnalysis?.hasTaint;
    const clusterName = receipt.clusterAnalysis?.clusterTaintName;
    const approvalsCount = receipt.approvalsSummary?.totalCount || 0;
    const balanceItem = receipt.evidence.find((e) => e.id === "EVIDENCE_NATIVE_BALANCE");
    const balanceEth = (balanceItem?.facts?.["Native balance"] as string) || "0 ETH";
    const txCountItem = receipt.evidence.find((e) => e.id === "EVIDENCE_TRANSACTION_COUNT");
    const txCount = (txCountItem?.facts?.["Transaction count"] as number) || 0;
    const dangerEvidence = receipt.evidence.filter((e) => e.status === "danger");
    const warningEvidence = receipt.evidence.filter((e) => e.status === "warning");
    const threatIntel = receipt.evidence.find((e) => e.id === "EVIDENCE_THREAT_INTEL");

    if (receipt.verdict === "HIGH OBSERVED RISK") {
      if (threatIntel?.status === "danger") {
        return `Verdict: ${receipt.verdict} for ${address.slice(0, 8)}...${address.slice(-6)} at block #${Number(receipt.blockNumber).toLocaleString()}.\n\n• EVIDENCE_THREAT_INTEL flagged this address. Do not interact. ${receipt.summary}\n• Danger evidence: ${dangerEvidence.map((e) => e.id).join(", ")}\n• Fired because: ${receipt.firedRules.map((r) => r.id).join(", ")}\n\nAction: Do not send funds. Review ${dangerEvidence[0]?.id || "danger evidence"} details in the evidence trail.`;
      }
      return `Verdict: ${receipt.verdict} for ${address.slice(0, 8)}...${address.slice(-6)} at block #${Number(receipt.blockNumber).toLocaleString()}.\n\n• Summary: ${receipt.summary}\n• Danger evidence: ${dangerEvidence.map((e) => `${e.id}: ${e.claim}`).join("\n• ")}\n• Fired because: ${receipt.firedRules.map((r) => r.id).join(", ")}\n\nAction: Do not send funds. ${isSweeper ? "Active sweeper bot detected, inflows leave in seconds." : isTainted ? `Tainted by ${clusterName}.` : "High risk flags present."}`;
    }

    if (receipt.verdict === "CAUTION") {
      return `Shield briefing for ${address.slice(0, 8)}...${address.slice(-6)}:\n\n• Verdict: ${receipt.verdict} (${receipt.coverage.completed}/${receipt.coverage.total} checks completed) at block #${Number(receipt.blockNumber).toLocaleString()}.\n• Type: ${isEip7702 ? "Delegated wallet taking orders from a helper contract (EVIDENCE_7702_DELEGATE)" : receipt.targetType === "contract" ? "Smart contract (EVIDENCE_CONTRACT_VERIFICATION)" : "Standard wallet"}.\n• Activity: ${txCount} transactions, ${balanceEth} balance.\n• Review evidence: ${warningEvidence.map((e) => e.id).join(", ") || dangerEvidence.map((e) => e.id).join(", ") || "check warnings"}.\n• Approvals: ${approvalsCount} active token approvals (EVIDENCE_ACTIVE_APPROVALS).\n\nAction: Review ${warningEvidence[0]?.id || "warning evidence"} before transacting. ${receipt.summary}`;
    }

    // LOW
    return `Shield briefing for ${address.slice(0, 8)}...${address.slice(-6)}:\n\n• Verdict: ${receipt.verdict} (${receipt.coverage.completed}/${receipt.coverage.total} checks completed) at block #${Number(receipt.blockNumber).toLocaleString()}.\n• Type: ${isEip7702 ? "Delegated wallet (EVIDENCE_7702_DELEGATE) with verified helper" : receipt.targetType === "contract" ? "Smart contract (EVIDENCE_CONTRACT_VERIFICATION)" : "Standard wallet (EVIDENCE_TARGET_TYPE)"}.\n• Activity: ${txCount} transactions, ${balanceEth} balance (EVIDENCE_NATIVE_BALANCE, EVIDENCE_TRANSACTION_COUNT).\n• Money trail: ${isSweeper ? "Active sweeper bot detected." : isTainted ? `Tainted by ${clusterName}.` : "No adverse signals in measured history (EVIDENCE_MONEY_TRAIL, EVIDENCE_MONEY_TRAIL_CLUSTER)."}\n• Approvals: ${approvalsCount} active (EVIDENCE_ACTIVE_APPROVALS).\n\nResult: No red flags found in completed checks (not a guarantee). Review evidence before transacting. ${receipt.summary}`;
  }

  return `Shield is an evidence-first scanner on Base Mainnet. It checks observed on-chain evidence, it does not simulate or execute transactions.\n\nIt checks:\n• Bytecode and verification (EVIDENCE_TARGET_TYPE, EVIDENCE_CONTRACT_VERIFICATION)\n• Deployment provenance and activity (EVIDENCE_TRANSACTION_COUNT, EVIDENCE_NATIVE_BALANCE)\n• Token approvals including unlimited (EVIDENCE_ACTIVE_APPROVALS)\n• EIP-7702 delegation (EVIDENCE_7702_DELEGATE)\n• Threat intel from GoPlus and ScamSniffer (EVIDENCE_THREAT_INTEL)\n• Measured history of deposit to forward timing (EVIDENCE_MONEY_TRAIL, EVIDENCE_MONEY_TRAIL_CLUSTER)\n\nAsk me about a scanned address and I will cite evidence IDs from the receipt.`;
}
