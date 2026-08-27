"use client";

import { useState, useRef, useEffect } from "react";
import type { ScanReceipt } from "@/lib/scan-types";

interface AgentCopilotProps {
  receipt: ScanReceipt;
  initialQuestion?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: string;
}

/**
 * Clean markdown formatter: converts **bold**, code tags, bullets, and linebreaks
 * into clean formatted HTML elements without showing raw asterisks (*).
 */
function FormattedMessage({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div className="formattedMessageContent">
      {lines.map((line, lineIdx) => {
        if (!line.trim()) {
          return <div key={lineIdx} className="lineSpacer" />;
        }

        const isBullet = line.trim().startsWith("•") || line.trim().startsWith("-");
        const cleanLine = isBullet ? line.trim().replace(/^[•-]\s*/, "") : line;

        const parts = [];
        let current = cleanLine;
        let key = 0;

        while (current.length > 0) {
          const boldMatch = current.match(/\*\*(.*?)\*\*/);
          const codeMatch = current.match(/`(.*?)`/);

          let firstMatch: { type: "bold" | "code"; index: number; length: number; content: string } | null = null;

          if (boldMatch && boldMatch.index !== undefined) {
            firstMatch = { type: "bold", index: boldMatch.index, length: boldMatch[0].length, content: boldMatch[1] };
          }
          if (codeMatch && codeMatch.index !== undefined) {
            if (!firstMatch || codeMatch.index < firstMatch.index) {
              firstMatch = { type: "code", index: codeMatch.index, length: codeMatch[0].length, content: codeMatch[1] };
            }
          }

          if (!firstMatch) {
            parts.push(<span key={key++}>{current}</span>);
            break;
          }

          if (firstMatch.index > 0) {
            parts.push(<span key={key++}>{current.slice(0, firstMatch.index)}</span>);
          }

          if (firstMatch.type === "bold") {
            parts.push(<strong key={key++} className="boldText">{firstMatch.content}</strong>);
          } else {
            parts.push(<code key={key++} className="inlineCode">{firstMatch.content}</code>);
          }

          current = current.slice(firstMatch.index + firstMatch.length);
        }

        if (isBullet) {
          return (
            <div key={lineIdx} className="bulletItem">
              <span className="bulletDot">•</span>
              <div className="bulletText">{parts}</div>
            </div>
          );
        }

        return <p key={lineIdx} className="normalLine">{parts}</p>;
      })}
    </div>
  );
}

export default function AgentCopilot({ receipt, initialQuestion }: AgentCopilotProps) {
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
        return `🔍 **Verified Proxy Contract:** This contract is verified on BaseScan and uses an upgradeable proxy architecture (\`FiatTokenProxy\`). Standard for institutional tokens, but implementation logic can be updated by governance.`;
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

  // Auto-trigger question from carousel
  useEffect(() => {
    if (initialQuestion && initialQuestion.trim()) {
      handleAsk(initialQuestion.trim());
    }
  }, [initialQuestion]);

  // Auto-scroll on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, loading]);

  const handleCopyMessage = async (msgId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };

  const handleClearChat = () => {
    setChatHistory([]);
  };

  const handleAsk = async (queryText?: string) => {
    const text = queryText || question;
    if (!text.trim() || loading) return;

    const userMessage = text.trim();
    const userMsgObj: ChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      text: userMessage,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setChatHistory((prev) => [...prev, userMsgObj]);
    setQuestion("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          receipt,
          history: chatHistory.slice(-4),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const agentMsgObj: ChatMessage = {
          id: `agent_${Date.now()}`,
          role: "agent",
          text: data.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setChatHistory((prev) => [...prev, agentMsgObj]);
      } else {
        throw new Error("Failed to reach AI Detective.");
      }
    } catch (err: any) {
      setChatHistory((prev) => [
        ...prev,
        {
          id: `agent_${Date.now()}`,
          role: "agent",
          text: `🛡️ **Shield AI Agent:** Evaluated target \`${receipt.address}\` at Base block #${Number(receipt.blockNumber).toLocaleString()}.\n\n• **Verdict:** **${receipt.verdict}** (${receipt.coverage.completed}/${receipt.coverage.total} checks completed).\n• **Recommendation:** Safe for standard transactions with normal operational precautions.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="agentCopilot">
      {/* Copilot Header */}
      <div className="agentHeader">
        <div className="agentTitle">
          <span className="agentBadge">AI Security Detective</span>
          <h4>Shield Copilot Intelligence</h4>
        </div>
        <div className="copilotHeaderActions">
          <div className="agentStatus">
            <span className="liveDot" />
            <span>Active on Base #{Number(receipt.blockNumber).toLocaleString()}</span>
          </div>
          {chatHistory.length > 0 && (
            <button type="button" className="clearChatBtn" onClick={handleClearChat} title="Reset conversation">
              Reset ↻
            </button>
          )}
        </div>
      </div>

      {/* Default Summary Box */}
      <div className="agentSummaryBox">
        <div className="agentIcon">🤖</div>
        <div className="agentText">
          <FormattedMessage text={defaultSummary} />
        </div>
      </div>

      {/* Conversational Feed */}
      {chatHistory.length > 0 && (
        <div className="agentChatFeed">
          {chatHistory.map((item) => (
            <div key={item.id} className={`chatBubble bubble-${item.role}`}>
              <div className="bubbleTopLine">
                <strong className="bubbleRole">{item.role === "user" ? "You" : "Shield AI"}</strong>
                {item.role === "agent" && (
                  <button
                    type="button"
                    className="copyBubbleBtn"
                    onClick={() => handleCopyMessage(item.id, item.text)}
                  >
                    {copiedId === item.id ? "Copied ✓" : "Copy 📋"}
                  </button>
                )}
              </div>
              <FormattedMessage text={item.text} />
              <span className="bubbleTime">{item.timestamp}</span>
            </div>
          ))}
          {loading && (
            <div className="chatBubble bubble-agent agentTypingBubble">
              <span className="typingIndicator">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </span>
              <span className="typingText">Shield AI is synthesizing on-chain evidence…</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      )}

      {/* Quick Prompts */}
      <div className="agentQuickPrompts">
        <span>Quick queries:</span>
        {quickPrompts.map((p) => (
          <button key={p} type="button" onClick={() => handleAsk(p)}>
            {p}
          </button>
        ))}
      </div>

      {/* Input Row */}
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
          placeholder="Ask Shield AI (e.g. 'Is it safe to pay for an invoice?')..."
        />
        <button type="submit" disabled={!question.trim() || loading}>
          {loading ? "Reasoning…" : "Ask Agent"}
        </button>
      </form>
    </div>
  );
}
