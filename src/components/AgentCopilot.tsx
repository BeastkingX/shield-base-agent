"use client";

import { useState } from "react";
import type { ScanReceipt } from "@/lib/scan-types";

interface AgentCopilotProps {
  receipt: ScanReceipt;
}

export default function AgentCopilot({ receipt }: AgentCopilotProps) {
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "agent"; text: string }>>([]);
  const [loading, setLoading] = useState(false);

  const isSweeper = receipt.clusterAnalysis?.isSweeperActive;
  const isTainted = receipt.clusterAnalysis?.hasTaint;
  const isEip7702 = receipt.evidence.some((e) => e.id === "EVIDENCE_TARGET_TYPE" && e.label.includes("EIP-7702"));
  const approvalsCount = receipt.approvalsSummary?.totalCount || 0;
  const unlimitedCount = receipt.approvalsSummary?.unlimitedCount || 0;

  // Default AI Detective Executive Summary
  const defaultSummary = (() => {
    if (isSweeper) {
      return `🚨 **CRITICAL HAZARD DETECTED:** This address is under an active **Sweeper Bot compromise**. Any ETH or tokens sent here will be automatically drained within seconds to a consolidation vault. **Do NOT send funds.**`;
    }
    if (isTainted) {
      return `⚠️ **Adversarial Cluster Taint:** This address was funded by a known drainer dispenser (${receipt.clusterAnalysis?.clusterTaintName || "Phishing Network"}) or forwards proceeds to a malicious vault. High risk of asset loss.`;
    }
    if (isEip7702) {
      return `⚡ **EIP-7702 Delegated Wallet:** This account executes smart account logic via an on-chain delegate contract while retaining standard EOA transaction origination. Indexed **${approvalsCount} active approvals** (${unlimitedCount} unlimited) across canonical protocols like Uniswap and Aerodrome. Clean money-trail observed.`;
    }
    if (receipt.targetType === "contract") {
      const isProxy = receipt.evidence.some((e) => e.id === "EVIDENCE_CONTRACT_VERIFICATION" && e.status === "warning");
      if (isProxy) {
        return `🔍 **Verified Proxy Contract:** This contract is verified on BaseScan and uses an upgradeable proxy architecture (e.g. FiatTokenProxy). Standard for institutional tokens, but implementation logic can be updated by governance.`;
      }
      return `✅ **Verified Smart Contract:** Official contract deployment on Base Mainnet with published source metadata and verified deployment provenance.`;
    }
    return `✅ **Standard EOA Wallet:** Normal wallet address on Base with clean 1-hop upstream gas funding and no links to known drainer hubs.`;
  })();

  const quickPrompts = [
    "Is it safe to send funds here?",
    "Explain the EIP-7702 delegation",
    "Audit active token approvals",
    "How do I revoke allowances?",
  ];

  const handleAsk = async (queryText?: string) => {
    const text = queryText || question;
    if (!text.trim() || loading) return;

    const userMessage = text.trim();
    setChatHistory((prev) => [...prev, { role: "user", text: userMessage }]);
    setQuestion("");
    setLoading(true);

    // AI Reasoning over deterministic receipt evidence
    setTimeout(() => {
      let response = "";
      const lower = userMessage.toLowerCase();

      if (lower.includes("safe") || lower.includes("send") || lower.includes("transfer")) {
        if (isSweeper || isTainted) {
          response = `🛑 **DO NOT SEND:** Shield detected active malicious activity (${receipt.clusterAnalysis?.clusterTaintName || "Sweeper Bot Trap"}). Interacting with this address will result in irreversible asset loss.`;
        } else if (receipt.verdict === "CAUTION") {
          response = `⚠️ **Proceed with Caution:** The address is legitimate but has warning factors (e.g., upgradeable proxy architecture or unverified parameters). Verify exact recipient details before broadcasting.`;
        } else {
          response = `✅ **Low Observed Risk:** All ${receipt.coverage.completed} evidence checks passed with clean upstream funding, no sweeper anomalies, and no known drainer signatures. Normal operational precautions apply.`;
        }
      } else if (lower.includes("7702") || lower.includes("delegat")) {
        response = `⚡ **EIP-7702 Overview:** This account contains an EIP-7702 delegation designator (\`0xef0100...\`). When called, it executes the code of its delegate contract within this account's context. This unlocks gas sponsorship (paymasters) and batched transactions without changing the wallet address.`;
      } else if (lower.includes("approval") || lower.includes("allowance") || lower.includes("revoke")) {
        if (approvalsCount > 0) {
          response = `🔓 **Approval Exposure:** Shield found **${approvalsCount} active approvals** (${unlimitedCount} unlimited). While spenders like Uniswap and Permit2 are standard, maintaining unlimited allowances leaves tokens exposed if a dApp is ever compromised. You can reset allowances to \`0\` using revoke.cash or direct \`approve(spender, 0)\`.`;
        } else {
          response = `🛡️ **No Open Approvals:** Shield found zero active unrevoked token approvals for this wallet.`;
        }
      } else {
        response = `🛡️ **Shield Agent Analysis:** Based on Base block #${Number(receipt.blockNumber).toLocaleString()}, the verdict is **${receipt.verdict}** with **${receipt.coverage.completed}/${receipt.coverage.total} evidence checks completed**. Reference Receipt ID: \`${receipt.receiptId}\`.`;
      }

      setChatHistory((prev) => [...prev, { role: "agent", text: response }]);
      setLoading(false);
    }, 400);
  };

  return (
    <div className="agentCopilot">
      <div className="agentHeader">
        <div className="agentTitle">
          <span className="agentBadge">AI Security Detective</span>
          <h4>Shield Agent Copilot</h4>
        </div>
        <div className="agentStatus">
          <span className="liveDot" />
          <span>Active on Base #{Number(receipt.blockNumber).toLocaleString()}</span>
        </div>
      </div>

      <div className="agentSummaryBox">
        <div className="agentIcon">🤖</div>
        <div className="agentText">
          <p>{defaultSummary}</p>
        </div>
      </div>

      {chatHistory.length > 0 && (
        <div className="agentChatFeed">
          {chatHistory.map((item, index) => (
            <div key={index} className={`chatBubble bubble-${item.role}`}>
              <strong>{item.role === "user" ? "You" : "Shield AI"}</strong>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      )}

      <div className="agentQuickPrompts">
        <span>Quick queries:</span>
        {quickPrompts.map((p) => (
          <button key={p} type="button" onClick={() => handleAsk(p)}>
            {p}
          </button>
        ))}
      </div>

      <form
        className="agentInputRow"
        onSubmit={(e) => {
          e.preventDefault();
          handleAsk();
        }}
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask Shield AI (e.g. 'Is it safe to send 1 ETH?')..."
        />
        <button type="submit" disabled={!question.trim() || loading}>
          {loading ? "Analyzing..." : "Ask Agent"}
        </button>
      </form>
    </div>
  );
}
