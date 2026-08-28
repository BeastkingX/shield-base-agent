"use client";

import { useState } from "react";
import Link from "next/link";
import type { InspectionReceipt } from "@/lib/popup-inspector";
import Icon from "./Icon";

const DEMO_CLEAN_PERMIT = JSON.stringify(
  {
    domain: {
      name: "Permit2",
      chainId: 8453,
      verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
    primaryType: "PermitSingle",
    message: {
      details: {
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "500000000",
        expiration: "1787800000",
        nonce: "0",
      },
      spender: "0x2626664c2603336e57b271c5c0b26f421741e481",
      sigDeadline: "1787800000",
    },
  },
  null,
  2,
);

const DEMO_RIGGED_PERMIT = JSON.stringify(
  {
    domain: {
      name: "Permit2",
      chainId: 8453,
      verifyingContract: "0x9999999999999999999999999999999999999bad",
    },
    primaryType: "PermitSingle",
    message: {
      details: {
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        expiration: "0",
        nonce: "0",
      },
      spender: "0x9999999999999999999999999999999999999bad",
    },
  },
  null,
  2,
);

export default function PopupInspector() {
  const [payload, setPayload] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InspectionReceipt | null>(null);
  const [error, setError] = useState("");
  const [copiedHash, setCopiedHash] = useState(false);

  const handleInspect = async (textToInspect?: string) => {
    const text = textToInspect || payload;
    if (!text.trim() || loading) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: text.trim() }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Inspection failed.");
      setResult(data);
    } catch (err: any) {
      setError(err?.message || "Failed to inspect payload.");
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setPayload(text);
        void handleInspect(text);
      }
    } catch {}
  };

  const downloadReceipt = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.receiptId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyHash = async () => {
    if (!result?.receiptHash) return;
    await navigator.clipboard.writeText(result.receiptHash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 1600);
  };

  return (
    <section className="popupInspectorSection" aria-label="Pop-Up and Signature Inspector">
      <div className="inspectorHeader">
        <div>
          <div className="eyebrow">
            <Icon name="key" size={12} /> Pre-Signing Verification
          </div>
          <h2>Check a Pop-Up or Signature</h2>
          <p className="inspectorSubtitle">
            Is this wallet pop-up safe to sign? Paste any EIP-712 typed data, permit signature, or contract call to audit permissions before you sign.
          </p>
        </div>
        <span className="noLeakTag" role="note">
          <Icon name="key" size={13} /> Leak Guard: Never paste private keys or seed words
        </span>
      </div>

      <div className="inspectorInputCard">
        <div className="cardTopRow">
          <label htmlFor="signaturePayload">Paste EIP-712 JSON or Signature Payload</label>
          <div className="demoButtonsGroup">
            <span>Demos:</span>
            <button
              type="button"
              className="demoPill cleanDemo"
              onClick={() => {
                setPayload(DEMO_CLEAN_PERMIT);
                void handleInspect(DEMO_CLEAN_PERMIT);
              }}
            >
              <Icon name="check" size={12} /> Benign Permit2
            </button>
            <button
              type="button"
              className="demoPill dangerDemo"
              onClick={() => {
                setPayload(DEMO_RIGGED_PERMIT);
                void handleInspect(DEMO_RIGGED_PERMIT);
              }}
            >
              <Icon name="danger" size={12} /> Rigged Phishing Permit
            </button>
          </div>
        </div>

        <textarea
          id="signaturePayload"
          rows={5}
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          placeholder='Paste signature JSON (e.g. { "domain": { "name": "Permit2" }, "message": ... })'
          spellCheck={false}
        />

        <div className="inspectorActions">
          <button type="button" className="ghostbtn" onClick={handlePaste}>
            <Icon name="receipt" size={14} /> Paste from Clipboard
          </button>
          <button
            type="button"
            className="cta"
            disabled={loading || !payload.trim()}
            onClick={() => handleInspect()}
          >
            {loading ? "Inspecting Signature…" : "Inspect Pop-Up →"}
          </button>
        </div>
      </div>

      {error && <div className="errorBox" role="alert">{error}</div>}

      {/* Inspection Results Card */}
      {result && (
        <div
          className={`inspectionResultCard ${
            result.verdict === "DO NOT SIGN" || result.verdict === "SECURITY WARNING"
              ? "inspectDanger"
              : result.verdict === "CAUTION (REVIEW)"
              ? "inspectCaution"
              : "inspectSafe"
          }`}
        >
          <div className="resultHeadRow">
            <div className="verdictBadgeLarge">
              {result.verdict === "DO NOT SIGN" || result.verdict === "SECURITY WARNING" ? (
                <Icon name="danger" size={20} />
              ) : result.verdict === "CAUTION (REVIEW)" ? (
                <Icon name="alert" size={20} />
              ) : (
                <Icon name="check" size={20} />
              )}
              <strong>{result.verdict}</strong>
            </div>
            <div className="inspectionActionsGroup" style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="ghostbtn" onClick={downloadReceipt}>
                Download Receipt ↧
              </button>
              <Link
                href={`/verify?receipt=${encodeURIComponent(JSON.stringify(result))}`}
                className="ghostbtn"
              >
                Verify Hash ↗
              </Link>
            </div>
          </div>

          <h3 className="inspectTitle">{result.title}</h3>
          <p className="inspectSummary">{result.summary}</p>
          {result.details && <p className="inspectDetails">{result.details}</p>}

          {/* Evidence Checklist */}
          {result.evidence.length > 0 && (
            <div className="inspectEvidenceList">
              <strong>Signature Checks Evaluated:</strong>
              {result.evidence.map((item) => (
                <div key={item.id} className={`checkCardRow status-${item.status}`}>
                  <div className="checkHeaderLine">
                    <Icon
                      name={item.status === "pass" ? "check" : item.status === "danger" ? "danger" : "info"}
                      size={14}
                      className="checkIconBadge"
                    />
                    <strong className="checkItemLabel">{item.label}</strong>
                  </div>
                  <p className="checkItemClaim">{item.claim}</p>
                </div>
              ))}
            </div>
          )}

          <div className="hashReceiptFooter">
            <div className="hashLeft" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span>Receipt Hash: <code>{result.receiptHash}</code></span>
              <button
                type="button"
                className="ghostbtn"
                style={{ minHeight: "28px", padding: "2px 8px", fontSize: "11px" }}
                onClick={handleCopyHash}
                aria-label="Copy receipt hash"
              >
                {copiedHash ? "Copied" : "Copy"}
              </button>
            </div>
            <span>ID: <code>{result.receiptId}</code></span>
          </div>
        </div>
      )}
    </section>
  );
}
