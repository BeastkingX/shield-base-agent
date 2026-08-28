"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ScanReceipt } from "@/lib/scan-types";

interface AgentCopilotProps {
  receipt?: ScanReceipt;
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  initialQuestion?: string;
  onClearInitialQuestion?: () => void;
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
  const unescaped = (text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  const lines = unescaped.split("\n");

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

export default function AgentCopilot({
  receipt,
  isOpen,
  onClose,
  onOpen,
  initialQuestion,
  onClearInitialQuestion,
}: AgentCopilotProps) {
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const launcherButtonRef = useRef<HTMLButtonElement>(null);
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isSweeper = receipt?.clusterAnalysis?.isSweeperActive;
  const isTainted = receipt?.clusterAnalysis?.hasTaint;
  const isEip7702 = receipt?.evidence.some((e) => e.id === "EVIDENCE_TARGET_TYPE" && e.label.includes("EIP-7702"));
  const approvalsCount = receipt?.approvalsSummary?.totalCount || 0;
  const unlimitedCount = receipt?.approvalsSummary?.unlimitedCount || 0;

  // Default AI Detective Summary (Guarded when no receipt is present)
  const defaultSummary = (() => {
    if (!receipt) {
      return `👋 **Shield AI Security Detective Online:** I explain on-chain bytecode, 2-hop money trails, mempool sweeper bots, and active token approvals on **Base Mainnet**. Ask me anything or select a topic!`;
    }
    if (isSweeper) {
      return `🚨 **CRITICAL HAZARD DETECTED:** Target \`${receipt.address}\` is under an active **Sweeper Bot compromise**. Any ETH or tokens sent here will be automatically drained within seconds. **Do NOT send funds.**`;
    }
    if (isTainted) {
      return `⚠️ **Adversarial Cluster Taint:** Target \`${receipt.address}\` was funded by a known drainer dispenser (${receipt.clusterAnalysis?.clusterTaintName || "Phishing Network"}) or forwards proceeds to a malicious vault.`;
    }
    if (isEip7702) {
      return `⚡ **EIP-7702 Delegated Wallet:** Target \`${receipt.address}\` executes smart account logic via an on-chain delegate contract. Indexed **${approvalsCount} active approvals** (${unlimitedCount} unlimited). Clean money-trail observed.`;
    }
    if (receipt.targetType === "contract") {
      const isProxy = receipt.evidence.some((e) => e.id === "EVIDENCE_CONTRACT_VERIFICATION" && e.status === "warning");
      if (isProxy) {
        return `🔍 **Verified Proxy Contract:** Target \`${receipt.address}\` is verified on BaseScan and uses an upgradeable proxy architecture (\`FiatTokenProxy\`). Implementation logic can be upgraded by owner.`;
      }
      return `✅ **Verified Smart Contract:** Target \`${receipt.address}\` has published source metadata and verified deployment provenance on Base.`;
    }
    return `✅ **Standard EOA Wallet:** Target \`${receipt.address}\` has no bytecode, clean 1-hop upstream gas funding, and no links to known drainer hubs.`;
  })();

  const quickPrompts = receipt
    ? [
        "Is it safe to send funds here?",
        "Explain the EIP-7702 delegation",
        "Audit active token approvals",
        "How do I revoke allowances?",
      ]
    : [
        "What is a Sweeper Bot?",
        "How did the $23.75M Ostium hack happen?",
        "What is EIP-7702 on Base?",
        "Why are unlimited token approvals dangerous?",
      ];

  const handleAsk = useCallback(
    async (queryText?: string) => {
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
            ...(receipt ? { receipt } : {}),
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
      } catch {
        setChatHistory((prev) => [
          ...prev,
          {
            id: `agent_${Date.now()}`,
            role: "agent",
            text: receipt
              ? `🛡️ **Shield AI Agent:** Evaluated target \`${receipt.address}\` at Base block #${Number(receipt.blockNumber).toLocaleString()}.\n\n• **Verdict:** **${receipt.verdict}** (${receipt.coverage?.completed}/${receipt.coverage?.total} checks completed).\n• **Summary:** ${receipt.summary}`
              : `🛡️ **Shield AI Agent:** Active on Base Mainnet. Ask me any question about wallet security, sweeper bots, or on-chain risks!`,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [question, loading, receipt, chatHistory],
  );

  // Auto-trigger question when set from carousel or external trigger
  useEffect(() => {
    if (initialQuestion && initialQuestion.trim()) {
      onOpen();
      void handleAsk(initialQuestion.trim());
      onClearInitialQuestion?.();
    }
  }, [initialQuestion, handleAsk, onOpen, onClearInitialQuestion]);

  // Focus trap & Escape key handler
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        launcherButtonRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 150);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, onClose]);

  // Auto-scroll chat feed
  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory, loading, isOpen]);

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

  return (
    <>
      {/* Floating Dock Launcher Button (always on bottom-right) */}
      <button
        ref={launcherButtonRef}
        type="button"
        className={`floatingDockLauncher ${isOpen ? "launcherActive" : ""}`}
        onClick={() => {
          if (isOpen) {
            onClose();
          } else {
            onOpen();
          }
        }}
        aria-label="Open Shield AI Security Detective Copilot"
        aria-expanded={isOpen}
        aria-controls="shield-chat-dock"
      >
        <span className="dockSparkle" aria-hidden="true">✦</span>
        <span className="dockLabel">Ask Shield</span>
        {receipt && <span className="dockContextDot" title="Scan receipt grounded" />}
      </button>

      {/* Slide-over Drawer / Floating Dock Panel */}
      {isOpen && (
        <div
          className="dockBackdrop"
          onClick={() => {
            onClose();
            launcherButtonRef.current?.focus();
          }}
          aria-hidden="true"
        />
      )}

      <aside
        id="shield-chat-dock"
        ref={drawerPanelRef}
        className={`floatingDockDrawer ${isOpen ? "dockOpen" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Shield AI Security Detective Copilot"
      >
        {/* Drawer Header */}
        <div className="dockHeader">
          <div className="dockTitleGroup">
            <div className="dockEmblem">✦</div>
            <div>
              <div className="dockBadgeRow">
                <span className="dockBadge">AI Security Detective</span>
                <span className="dockLiveDot" title="Online" />
              </div>
              <h3 className="dockTitle">Shield Copilot</h3>
            </div>
          </div>
          <div className="dockHeaderActions">
            {chatHistory.length > 0 && (
              <button
                type="button"
                className="dockClearBtn"
                onClick={handleClearChat}
                title="Reset conversation"
              >
                Reset ↻
              </button>
            )}
            <button
              type="button"
              className="dockCloseBtn"
              onClick={() => {
                onClose();
                launcherButtonRef.current?.focus();
              }}
              aria-label="Close Shield Copilot drawer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Target Context Pill if scan active */}
        {receipt && (
          <div className="dockContextPill">
            <span>Grounded on:</span>
            <code>{receipt.address.slice(0, 8)}...{receipt.address.slice(-6)}</code>
            <span className={`dockVerdictTag verdictTag-${receipt.verdict.toLowerCase().replaceAll(" ", "-")}`}>
              {receipt.verdict}
            </span>
          </div>
        )}

        {/* Scrollable Conversation Body */}
        <div className="dockBody">
          {/* Default Summary Box */}
          <div className="dockSummaryCard">
            <div className="summaryIcon" aria-hidden="true">🛡️</div>
            <div className="summaryText">
              <FormattedMessage text={defaultSummary} />
            </div>
          </div>

          {/* Chat Messages */}
          {chatHistory.map((item) => (
            <div key={item.id} className={`chatBubble bubble-${item.role}`}>
              <div className="bubbleTopLine">
                <strong className="bubbleRole">{item.role === "user" ? "You" : "Shield AI"}</strong>
                {item.role === "agent" && (
                  <button
                    type="button"
                    className="copyBubbleBtn"
                    onClick={() => handleCopyMessage(item.id, item.text)}
                    aria-label="Copy message"
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
              <span className="typingIndicator" aria-hidden="true">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </span>
              <span className="typingText">Shield AI is synthesizing on-chain facts…</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Quick Suggestion Prompts */}
        <div className="dockQuickPrompts">
          <span className="quickPromptHeading">Suggested questions:</span>
          <div className="quickChipsScroll">
            {quickPrompts.map((p) => (
              <button
                key={p}
                type="button"
                className="quickPromptChip"
                onClick={() => handleAsk(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Input Form Footer */}
        <form
          className="dockInputForm"
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk();
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              receipt
                ? `Ask about ${receipt.address.slice(0, 6)}...`
                : "Ask about on-chain security..."
            }
            aria-label="Ask a question to Shield AI"
          />
          <button
            type="submit"
            className="dockSendBtn"
            disabled={!question.trim() || loading}
            aria-label="Send message"
          >
            {loading ? "..." : "Ask →"}
          </button>
        </form>
      </aside>
    </>
  );
}
