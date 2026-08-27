import { NextRequest, NextResponse } from "next/server";
import type { ScanReceipt } from "@/lib/scan-types";

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

    // 1. Live Ultra-Fast LLM Generation via Groq (Qwen / GPT-OSS)
    if (DEFAULT_GROQ_KEY) {
      try {
        const isGroq = DEFAULT_GROQ_KEY.startsWith("gsk_");
        const endpoint = isGroq
          ? "https://api.groq.com/openai/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";
        const model = isGroq ? "qwen/qwen3.8-27b" : "gpt-4o-mini";

        const systemPrompt = `You are Shield AI Guardian, an ultra-smart, conversational, expert Web3 and Base Mainnet security detective. 
You are deeply knowledgeable in EVM mechanics, EIP-7702 Account Abstraction, smart contract proxies (FiatTokenProxy), mempool Sweeper Bots (<8s deposit drains), the $23.75M Ostium oracle forwarder hack, and Permit2 phishing signatures.

Instructions for your personality & replies:
1. Be direct, intelligent, conversational, and genuinely helpful. If the user asks a conversational question (e.g. "what's this template?", "who are you?", "explain like I'm 5", or "why is this safe?"), answer their specific question naturally and flexibly rather than outputting a generic boilerplate template.
2. When analyzing an address or security risk, format with clean markdown: bold **highlights**, bullet points •, and clear numbered action steps.
3. Use the on-chain context below as your factual ground truth. Never invent balances or fake block numbers.

Current On-Chain Context on Base Mainnet:
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
    : "No address currently scanned. Provide general expert Web3/Base security intelligence."
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
            temperature: 0.35,
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

    // 2. Autonomous Fallback
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
    return `🤖 **HOW SWEEPER BOTS WORK & HOW TO PROTECT YOURSELF:**\n\nWhen a wallet's private key is leaked, hackers install an automated **Sweeper Bot** that monitors the mempool 24/7.\n\n• **The Attack Mechanism:** The moment you send gas, the bot detects the pending deposit and sweeps it within the same or next block (<8 seconds).\n• **How Shield Protects You:** Shield tracks deposit-to-sweep velocity and fires **🚨 CRITICAL DANGER: Active Sweeper Bot** to block you before you send.\n• **Safety Rule:** Never send rescue gas to a compromised wallet via normal transfers.`;
  }

  // Ostium Hack
  if (prompt.includes("ostium") || prompt.includes("oracle") || prompt.includes("forwarder")) {
    return `🔍 **CASE STUDY: THE $23.75M OSTIUM HACK:**\n\nOn July 15, on-chain perpetuals exchange Ostium lost **$23.75M USDC** from its liquidity vault without any smart contract code bug!\n\n• **What Happened:** An off-chain price oracle signer key was compromised, feeding fabricated Bitcoin prices ($5k entry, $60k exit inside 1 transaction) to drain the vault.\n• **How Shield Protects You:** Shield evaluates 2-hop money trails, rapid sweep velocity anomalies, and proxy implementation changes.`;
  }

  // EIP-7702
  if (prompt.includes("7702") || prompt.includes("delegat") || prompt.includes("account abstraction")) {
    return `⚡ **EIP-7702 NATIVE ACCOUNT ABSTRACTION EXPLAINER:**\n\nEIP-7702 is Ethereum and Base's standard allowing standard EOA wallets to execute smart contract code without deploying a separate proxy contract.\n\n• **How it works:** A 23-byte designator (\`0xef0100...\` + 20-byte delegate address) is stored in the account code.\n• **Key Benefits:** 1-Click Batched Transactions (Approve + Swap simultaneously), Session Keys, and Gas Sponsorship via ERC-4337 Paymasters.`;
  }

  // Conversational response
  if (prompt.includes("template") || prompt.includes("who are you") || prompt.includes("what is this")) {
    return `👋 **I am Shield AI Copilot:**\n\nI am your live cybersecurity detective on Base Mainnet. I analyze the on-chain evidence matrix (bytecode, 2-hop money trails, token approvals, and sweeper bot velocity) to tell you if an address is safe or dangerous before you transact. Ask me anything!`;
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

  return `🛡️ **SHIELD AI AGENT READY:**\n\nI am actively monitoring Base Mainnet. Ask me any question about wallet safety, approvals, or transaction verification!`;
}
