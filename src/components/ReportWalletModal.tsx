"use client";

import { useState } from "react";
import { isAddress } from "viem";

interface ReportWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialAddress?: string;
  reporterAddress?: string | null;
}

const REPORT_TEMPLATES = [
  {
    id: "phishing",
    icon: "🚨",
    label: "Phishing Drainer / Fake Airdrop",
    category: "Phishing / Drainer",
    defaultTitle: "Phishing permit drainer signature detected",
    defaultDesc: "This wallet or contract requested unlimited Permit2 or ERC-20 approvals on a phishing website to drain user assets.",
  },
  {
    id: "sweeper",
    icon: "🤖",
    label: "Active Sweeper Bot (Compromised Key)",
    category: "Sweeper Bot Trap",
    defaultTitle: "Automated sweeper bot stealing incoming deposits",
    defaultDesc: "Incoming ETH or tokens sent to this wallet are automatically drained within seconds to a consolidation vault.",
  },
  {
    id: "honeypot",
    icon: "🍯",
    label: "Honeypot / Malicious Contract",
    category: "Honeypot Token",
    defaultTitle: "Token contract prevents selling or charges 100% tax",
    defaultDesc: "Contract contains hidden transfer restrictions or blacklist functions preventing token sales.",
  },
  {
    id: "impersonation",
    icon: "🎭",
    label: "Impersonation / Social Engineering",
    category: "Fake Team / Impersonator",
    defaultTitle: "Impersonating official Base team or protocol developer",
    defaultDesc: "Address was used in Discord/Telegram/X DM scams posing as an official support agent or foundation member.",
  },
  {
    id: "exploit",
    icon: "⚠️",
    label: "Stolen Funds / Exploit Destination",
    category: "Exploit Cashout Hub",
    defaultTitle: "Recipient of hacked protocol liquidity or exploit funds",
    defaultDesc: "On-chain inflows trace directly to a recent smart contract exploit or stolen vault assets.",
  },
  {
    id: "custom",
    icon: "✍️",
    label: "Custom Report",
    category: "Community Report",
    defaultTitle: "Suspicious activity report",
    defaultDesc: "",
  },
];

export default function ReportWalletModal({
  isOpen,
  onClose,
  initialAddress = "",
  reporterAddress,
}: ReportWalletModalProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState("phishing");
  const [targetAddress, setTargetAddress] = useState(initialAddress);
  const [title, setTitle] = useState(REPORT_TEMPLATES[0].defaultTitle);
  const [description, setDescription] = useState(REPORT_TEMPLATES[0].defaultDesc);
  const [txHash, setTxHash] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const t = REPORT_TEMPLATES.find((item) => item.id === templateId);
    if (t) {
      setTitle(t.defaultTitle);
      setDescription(t.defaultDesc);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAddress || !isAddress(targetAddress.trim())) {
      setError("Please enter a valid Base address to report.");
      return;
    }

    if (!title.trim() || !description.trim()) {
      setError("Please provide a title and description for your report.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccessMessage("");

    try {
      const selectedTemplate = REPORT_TEMPLATES.find((t) => t.id === selectedTemplateId);
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAddress: targetAddress.trim(),
          reporterAddress: reporterAddress || undefined,
          category: selectedTemplate?.category || "Community Report",
          title: title.trim(),
          description: description.trim(),
          txHash: txHash.trim() || undefined,
          evidenceType: selectedTemplateId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed.");

      setSuccessMessage(data.message || "Report recorded successfully!");
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      setError(err?.message || "Failed to submit report.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sendModalBackdrop" onClick={onClose}>
      <div className="reportModalCard" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sendModalHeader">
          <div className="sendModalTitle">
            <span className="sendShieldIcon">🚩</span>
            <div>
              <h3>Report Suspicious Address</h3>
              <p>Submit on-chain evidence to alert the Shield AI network</p>
            </div>
          </div>
          <button type="button" className="closeBtn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {successMessage ? (
          <div className="reportSuccessCard">
            <span className="successIcon">✅</span>
            <h4>Report Submitted</h4>
            <p>{successMessage}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="reportForm">
            {/* Template Selector Grid */}
            <div className="formGroup">
              <label>Select Scam Category / Template</label>
              <div className="templatesGrid">
                {REPORT_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className={`templatePill ${selectedTemplateId === tpl.id ? "templateActive" : ""}`}
                    onClick={() => handleTemplateSelect(tpl.id)}
                  >
                    <span className="tplIcon">{tpl.icon}</span>
                    <span className="tplLabel">{tpl.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Target Address */}
            <div className="formGroup">
              <label>Target Address to Report (Base)</label>
              <input
                type="text"
                value={targetAddress}
                onChange={(e) => setTargetAddress(e.target.value)}
                placeholder="0x..."
                required
              />
            </div>

            {/* Report Title */}
            <div className="formGroup">
              <label>Report Headline</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Brief summary of the incident..."
                required
              />
            </div>

            {/* Detailed Description */}
            <div className="formGroup">
              <label>Detailed Evidence & Incident Description</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Explain what happened (e.g. website URL, drainer mechanism, or sweeper behavior)..."
                required
              />
            </div>

            {/* Optional Tx Hash */}
            <div className="formGroup">
              <label>Transaction Hash Proof (Optional)</label>
              <input
                type="text"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="0x... (Incident transaction on Base)"
              />
            </div>

            {error && <div className="sendErrorBox">{error}</div>}

            {/* Actions */}
            <div className="modalActions">
              <button type="button" className="cancelBtn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !targetAddress.trim()}
                className="reportSubmitBtn"
              >
                {submitting ? "Submitting Report..." : "🚩 Submit Report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
