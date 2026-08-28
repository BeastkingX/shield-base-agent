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
  // Fixed-window rate armor (per-instance serverless)
  const ip = clientIp(request);
  if (!rateLimit(`chat:${ip}`, 20, 60_000)) {
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
CRITICAL INSTRUCTION: Follow this FACT CARD; do not add mechanics it does not contain.\n`
          : "";

        const systemPrompt = `You are Shield AI Guardian, an elite Web3 and Base Mainnet security detective.

HARD RULES:
- Never claim the user "said", "asked" or "discussed" anything not present in the provided conversation history.
- Never correct or reference figures the user did not state.
- When a scan receipt is attached, cite evidence by ID (e.g., EVIDENCE_7702_DELEGATE, EVIDENCE_MONEY_TRAIL) BEFORE explaining it.
- If a question is not covered by the receipt or a FACT CARD, say exactly that and stop. No speculation presented as fact.
- Keep answers under 220 words unless the user explicitly asks for a deep dive. Use bullets.
- If output is cut off by length, the route appends a visible continuation note — never end mid-sentence silently.
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
    : "No address currently scanned. Answer general Web3/Base security education questions."
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
            reply = reply.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
            if (finishReason === "length") {
              reply += `\n\n*(Answer capped for length — say "continue" for the rest.)*`;
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
    return NextResponse.json({ reply });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "AI Reasoning error." },
      { status: 500 },
    );
  }
}

/**
 * Autonomous Security & Educational Reasoning Engine (Fallback)
 */
function generateAutonomousSecurityReasoning(userPrompt: string, receipt?: ScanReceipt): string {
  const prompt = userPrompt.toLowerCase().trim();

  // Sweeper Bots
  if (prompt.includes("sweeper") || prompt.includes("compromised key") || prompt.includes("drain gas")) {
    return `🤖 **HOW SWEEPER BOTS WORK & HOW TO PROTECT YOURSELF:**\n\nWhen a wallet's private key is leaked (e.g. via phishing or malware), attackers install an automated **Sweeper Bot** that monitors the mempool 24/7.\n\n• **The Attack:** The instant gas or tokens arrive, the bot detects the pending deposit and broadcasts an outgoing transfer in the same or next block (<8 seconds), stealing the funds immediately.\n• **How Shield Protects You:** Shield measures inter-block deposit-to-forward delta velocity over indexed history. If an address exhibits automated instant forwarding, Shield flags **🚨 CRITICAL DANGER: Active Sweeper Bot** and blocks the send flow.\n• **Safety Rule:** Never send rescue gas to a compromised wallet via standard transfers.`;
  }

  // Ostium Hack
  if (prompt.includes("ostium") || prompt.includes("oracle") || prompt.includes("forwarder")) {
    return `🔍 **CASE STUDY: THE $23.75M OSTIUM HACK:**\n\nOn July 15, 2026, perpetuals DEX Ostium lost **$23.75M USDC** from its liquidity vault without any smart-contract code bug!\n\n• **Root Cause:** A compromised off-chain **oracle signer private key** (not a Solidity vulnerability).\n• **The Exploit:** The attacker held a valid signer credential and used the registered \`PriceUpKeep\` forwarder to submit fabricated BTC-USD price reports ($5,000 entry, $60,000 exit in one transaction loop), draining profits from the public OLP liquidity vault.\n• **Why Simulators Failed:** The smart contracts executed valid math based on the signed prices; trader collateral in isolated contracts was untouched.\n• **Key Takeaway:** Protocol security extends beyond Solidity audits to off-chain key management and signer hygiene.`;
  }

  // EIP-7702
  if (prompt.includes("7702") || prompt.includes("delegat") || prompt.includes("account abstraction")) {
    return `⚡ **EIP-7702 NATIVE ACCOUNT ABSTRACTION EXPLAINER:**\n\nEIP-7702 allows standard EOA wallets to execute smart contract code without deploying a separate proxy contract.\n\n• **How it works:** A 23-byte designator (\`0xef0100...\` + 20-byte delegate address) is stored in the account code.\n• **Key Benefits:** 1-Click Batched Transactions (Approve + Swap simultaneously), Session Keys, and Gas Sponsorship via ERC-4337 Paymasters.\n• **Shield's Innovation:** Shield identifies EIP-7702 delegation designators and verifies delegate reputation rather than misclassifying the wallet as a smart contract.`;
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

    return `🛡️ **SHIELD DETECTIVE BRIEFING FOR \`${address}\`:**\n\n• **Verdict:** **${receipt.verdict}** (${receipt.coverage.completed}/${receipt.coverage.total} checks completed)\n• **Classification:** ${isEip7702 ? "EIP-7702 Delegated Wallet" : receipt.targetType === "contract" ? "Smart Contract" : "Standard EOA"}\n• **Activity:** ${txCount} transactions, ${balanceEth} balance\n• **Security Health:** ${isSweeper ? "🚨 Sweeper Bot Compromise" : isTainted ? `⚠️ ${clusterName}` : "✅ Clean 2-Hop Money Trail"}\n\nAsk me any question about this address or transaction intent!`;
  }

  return `🛡️ **SHIELD AI AGENT READY:**\n\nI am actively monitoring Base Mainnet. Ask me any question about wallet safety, approvals, sweeper bots, or transaction verification!`;
}
