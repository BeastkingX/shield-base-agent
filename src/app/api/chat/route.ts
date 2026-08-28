import { NextRequest, NextResponse } from "next/server";
import type { ScanReceipt } from "@/lib/scan-types";
import { findMatchingFactCard } from "@/lib/knowledge-base";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

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
          ? `\nVERIFIED FACT CARD FOR THIS TOPIC (${matchedFactCard.topic}):
${matchedFactCard.facts.map((f) => `• ${f}`).join("\n")}
CRITICAL INSTRUCTION: Follow this FACT CARD. Do not invent mechanics it does not contain.\n`
          : "";

        const systemPrompt = `You are Shield AI, a Web3 safety assistant on Base Mainnet.
Your job: watch the evidence, explain verdicts, teach users how drains and scams work.
You write like a calm, sharp friend who happens to be a security engineer. You never write like a marketing page or a research paper.

THE 10 VOICE LAWS (MANDATORY):
1. NO EM DASHES (—), EVER. Use a comma, a period, or parentheses.
2. PLAIN WORDS FIRST. If a 15-year-old wouldn't know the term, translate it on the spot. Say "this wallet takes orders from another contract" before saying "EIP-7702 delegation." Jargon may follow the explanation, never replace it.
3. SHORT SENTENCES. One idea per sentence. Never use semicolons. Split long thoughts into two sentences.
4. FACTS OVER ADJECTIVES. "Deposits left in 20 seconds" beats "extremely rapid draining." Numbers, names, block IDs, and evidence IDs are the adjectives.
5. CITE, THEN EXPLAIN. When a receipt exists, name the evidence ID first (for example, "EVIDENCE_7702_DELEGATE says the delegate is unverified") and then say what that means in normal words.
6. HONEST LIMITS ARE MANDATORY STYLE. "I don't know", "that check didn't run", "outside this scan" are first-class answers. Never fill gaps with guesswork. Never soften a red flag into comfort or inflate a clean result into a guarantee. THE WORD "SAFE" IS BANNED. Use "no red flags found" or "clean."
7. NEVER FAKE FAMILIARITY. No "as we discussed", no "you mentioned", unless it is literally in the conversation history.
8. CALM, HUMAN RHYTHM. Contractions are fine ("it's", "don't"). Light, dry, helpful tone. No hype words (revolutionary, seamless, next-gen). No fear-mongering. No exclamation stacking.
9. SCANNABLE IN CHAT. Bold the one thing the user must do. Explain only what they asked. Offer depth instead of dumping it.
10. MATCH THE USER'S REGISTER. Technical question gets a technical answer with a plain translation. Casual question gets casual words. Beginner question gets beginner words.

SELF-CHECK BEFORE OUTPUT:
Would a careful human security friend say it exactly like this, with only facts I can point to?

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
      })
    : "No address currently scanned. Answer general Web3 and Base security education questions."
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
            // Strip any accidental em dashes or entities
            reply = reply
              .replace(/—/g, ", ")
              .replace(/–/g, ", ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">");
            if (finishReason === "length") {
              reply += `\n\n*(Answer capped for length. Say "continue" for the rest.)*`;
            }
            return NextResponse.json({ reply });
          }
        }
      } catch (externalErr) {
        console.warn("Live LLM generation fallback:", externalErr);
      }
    }

    // 2. Autonomous Deterministic Fallback Engine (Strict Shield Voice Rules)
    const reply = generateAutonomousSecurityReasoning(message, receipt);
    return NextResponse.json({ reply });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "AI Reasoning error." },
      { status: 500 },
    );
  }
}

/**
 * Autonomous Security and Educational Reasoning Engine (Strict Shield Voice)
 */
function generateAutonomousSecurityReasoning(userPrompt: string, receipt?: ScanReceipt): string {
  const prompt = userPrompt.toLowerCase().trim();

  // Sweeper Bots
  if (prompt.includes("sweeper") || prompt.includes("compromised key") || prompt.includes("drain gas")) {
    return `🤖 **How sweeper bots work:**\n\nA sweeper bot is an automated script. It watches the public mempool day and night for any money sent to a leaked private key.\n\n• **The attack:** When gas or tokens land, the bot sends an outgoing transfer in the next block (<8 seconds). It steals the deposit before you can click a button.\n• **What Shield checks:** Shield measures how fast deposits leave over past transactions. If deposits leave in seconds, Shield flags **CRITICAL DANGER: Active Sweeper Bot**.\n• **Action:** **Do not send rescue gas.** Any deposit will leave in seconds.`;
  }

  // Ostium Hack
  if (prompt.includes("ostium") || prompt.includes("oracle") || prompt.includes("forwarder")) {
    return `🔍 **Case study: The $23.75M Ostium incident:**\n\nOn July 15, 2026, perpetuals exchange Ostium lost $23.75M USDC from its liquidity pool. There was no smart contract code bug.\n\n• **Root cause:** An attacker stole the private key for an off-chain oracle signer.\n• **The attack:** The attacker had valid signer credentials. They used the registered \`PriceUpKeep\` forwarder to report fake BTC-USD prices ($5,000 entry, $60,000 exit in one transaction). That drained profits from the public OLP liquidity vault.\n• **Key lesson:** Smart contract audits do not protect off-chain keys. If a signer key leaks, math cannot save the pool.`;
  }

  // EIP-7702
  if (prompt.includes("7702") || prompt.includes("delegat") || prompt.includes("account abstraction")) {
    return `⚡ **What is EIP-7702:**\n\nEIP-7702 lets a normal wallet borrow code from another smart contract without deploying a separate proxy.\n\n• **How it works:** The wallet saves a 23-byte tag pointing to a helper contract. When someone calls the wallet, it runs that helper contract's code in its own account context.\n• **Benefits:** You can batch approve and swap in one click. Apps can sponsor your gas.\n• **The risk:** If the helper contract is unverified or malicious, it can drain incoming funds. Shield checks the helper contract in \`EVIDENCE_7702_DELEGATE\`.`;
  }

  // Address-specific queries
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

    return `🛡️ **Shield briefing for \`${address.slice(0, 8)}...${address.slice(-6)}\`:**\n\n• **Verdict:** **${receipt.verdict}** (${receipt.coverage.completed}/${receipt.coverage.total} checks completed).\n• **Type:** ${isEip7702 ? "Delegated wallet taking orders from a helper contract" : receipt.targetType === "contract" ? "Smart contract" : "Standard wallet"}.\n• **Activity:** ${txCount} transactions, ${balanceEth} balance at block #${Number(receipt.blockNumber).toLocaleString()}.\n• **Money trail:** ${isSweeper ? "Active sweeper bot detected. Deposits leave in seconds." : isTainted ? `Tainted by ${clusterName}.` : "Clean funding history."}\n• **Approvals:** ${approvalsCount} active token approvals.\n\n**Action:** ${isSweeper || isTainted ? "**Do not send funds.**" : "No red flags found in completed checks. Review evidence before transacting."}`;
  }

  return `🛡️ **Shield AI Security Detective:**\n\nI watch on-chain evidence on Base Mainnet. Ask me about wallet safety, approvals, sweeper bots, or how any scan verdict was calculated.`;
}
