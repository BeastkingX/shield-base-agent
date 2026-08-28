"use client";

import { useState, useEffect } from "react";
import { isAddress } from "viem";

interface ReportWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialAddress?: string;
  reporterAddress?: string | null;
}

const SCAM_TEMPLATES = [
  {
    id: "drainer",
    icon: "🚨",
    label: "Permit / Sweeper Drainer",
    desc: "Malicious contract draining tokens or ETH immediately upon deposit.",
  },
  {
    id: "phishing",
    icon: "🎣",
    label: "Phishing dApp / Impersonator",
    desc: "Fake website or social account impersonating an official protocol.",
  },
  {
    id: "honeypot",
    icon: "🍯",
    label: "Honeypot / Fake Token",
    desc: "Token that cannot be sold (100% tax or transfer disabled).",
  },
  {
    id: "airdrop_scam",
    icon: "🎁",
    label: "Fake Airdrop / Claim Voucher",
    desc: "Spam token prompting victims to sign malicious approvals.",
  },
  {
    id: "rugpull",
    icon: "📉",
    label: "Rug Pull / Liquidity Drain",
    desc: "Creator drained liquidity pool or minted unbacked tokens.",
  },
  {
    id: "compromised_key",
    icon: "🔑",
    label: "Compromised Private Key",
    desc: "Account key was leaked and is actively abused by sweeper bots.",
  },
];

export default function ReportWalletModal({
  isOpen,
  onClose,
  initialAddress = "",
  reporterAddress,
}: ReportWalletModalProps) {
  const [targetAddress, setTargetAddress] = useState(initialAddress);
  const [selectedTemplate, setSelectedTemplate] = useState(SCAM_TEMPLATES[0].id);
  const [description, setDescription] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTargetAddress(initialAddress);
  }, [initialAddress]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAddress || !isAddress(targetAddress)) {
      setError("Please enter a valid EVM address on Base.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAddress,
          scamType: selectedTemplate,
          description,
          proofUrl,
          reporterAddress: reporterAddress || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit report.");
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || "Failed to submit report.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modalBackdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Report Malicious Address">
      <div className="modalCard reportModalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalTitleGroup">
            <span className="modalEmblem dangerEmblem" aria-hidden="true">🚩</span>
            <div>
              <h3>Report Suspicious Address</h3>
              <p className="modalSubtitle">
                Submit an on-chain threat report to Shield community intelligence.
              </p>
            </div>
          </div>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {success ? (
          <div className="reportSuccessCard" role="status">
            <span className="successIcon" aria-hidden="true">✅</span>
            <h4>Report Recorded</h4>
            <p>
              Thank you for keeping Base secure. Shield has registered this threat submission into the review watchlist.
            </p>
            <button
              type="button"
              className="primaryBtn"
              onClick={() => {
                setSuccess(false);
                onClose();
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="reportForm">
            <div className="formGroup">
              <label htmlFor="reportedAddress">Target Address to Report (0x...)</label>
              <input
                id="reportedAddress"
                type="text"
                value={targetAddress}
                onChange={(e) => setTargetAddress(e.target.value)}
                placeholder="0x..."
                required
              />
            </div>

            <div className="formGroup">
              <label>Threat Category</label>
              <div className="templatesGrid">
                {SCAM_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className={`templatePill ${selectedTemplate === tpl.id ? "templateActive" : ""}`}
                    onClick={() => setSelectedTemplate(tpl.id)}
                  >
                    <span className="tplIcon" aria-hidden="true">{tpl.icon}</span>
                    <span className="tplLabel">{tpl.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="formGroup">
              <label htmlFor="scamDescription">Incident Description</label>
              <textarea
                id="scamDescription"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Explain what happened (e.g. 'Phishing site drained tokens when signing permit...')"
              />
            </div>

            <div className="formGroup">
              <label htmlFor="proofUrl">Evidence / Proof URL (Optional)</label>
              <input
                id="proofUrl"
                type="url"
                value={proofUrl}
                onChange={(e) => setProofUrl(e.target.value)}
                placeholder="https://basescan.org/tx/... or tweet/link"
              />
            </div>

            {error && <div className="errorBox" role="alert">{error}</div>}

            <div className="modalActions">
              <button type="button" className="ghostBtn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !targetAddress.trim()}
                className="reportSubmitBtn"
              >
                {submitting ? "Submitting…" : "Submit Threat Report 🚩"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
