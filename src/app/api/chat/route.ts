import { NextRequest, NextResponse } from "next/server";
import type { ScanReceipt } from "@/lib/scan-types";
import { findMatchingFactCard } from "@/lib/knowledge-base";

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
  try {
    const body: ChatRequest = await request.json();
    const { message, receipt } = body;

    if (!message) {
      return NextResponse.json(
        { error: "Message text is required." },
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
CRITICAL INSTRUCTION: Base your answer strictly on the fact card above. Do not hallucinate or invent mechanics (e.g. do not claim oracle addresses were changed if the attack was an off-chain signer key compromise).\n`
          : "";

        const systemPrompt = `You are Shield AI Guardian, an elite Web3 and Base Mainnet security detective. 
Your goal is to provide accurate, honest, and verifiable on-chain security analysis.

Output guidelines:
1. Always format responses in clean markdown (bold **highlights**, bullet points •, and numbered steps). Do not use excessive raw asterisks.
2. If asked about an address, base your response strictly on the on-chain context below. Never invent balances or block numbers.
3. If asked an educational or case study question, explain the real-world mechanics clearly.
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
              ...(body.history || []).map((h) => ({
                role: h.role === "agent" ? "assistant" : "user",
                content: h.text,
              })),
              { role: "user", content: message },
            ],
            temperature: 0.2,
            max_tokens: 750,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const llmData = await res.json();
          const reply = llmData.choices?.[0]?.message?.content;
          if (reply) {
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

  // Conversational response
  if (prompt.includes("template") || prompt.includes("who are you") || prompt.includes("what is this")) {
    return `👋 **I am Shield AI Copilot:**\n\nI am your live cybersecurity detective on Base Mainnet. I analyze on-chain bytecode, 2-hop money trails, token approvals, and sweeper bot velocity to protect you before you transact. Ask me anything about wallet safety or on-chain risks!`;
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
