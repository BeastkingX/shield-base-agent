"use client";

import { useState, useEffect } from "react";
import { parseEther, isAddress, getAddress, type Address } from "viem";
import type { Eip1193Provider } from "@/lib/wallet";
import type { ScanReceipt } from "@/lib/scan-types";

interface ProtectedSendModalProps {
  isOpen: boolean;
  onClose: () => void;
  senderAddress: string;
  provider: Eip1193Provider | null;
}

export default function ProtectedSendModal({
  isOpen,
  onClose,
  senderAddress,
  provider,
}: ProtectedSendModalProps) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<"ETH" | "USDC">("ETH");
  const [scanningRecipient, setScanningRecipient] = useState(false);
  const [recipientScan, setRecipientScan] = useState<ScanReceipt | null>(null);
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [overrideWarning, setOverrideWarning] = useState(false);

  // Debounced auto-scan of recipient address
  useEffect(() => {
    if (!recipient.trim() || !isAddress(recipient.trim())) {
      setRecipientScan(null);
      setError("");
      return;
    }

    const timer = setTimeout(async () => {
      setScanningRecipient(true);
      setError("");
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: recipient.trim() }),
        });

        if (response.ok) {
          const data = await response.json();
          setRecipientScan(data);
        }
      } catch (err) {
        console.warn("Recipient pre-scan error:", err);
      } finally {
        setScanningRecipient(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [recipient]);

  if (!isOpen) return null;

  const isBlocked =
    recipientScan?.verdict === "HIGH OBSERVED RISK" ||
    recipientScan?.clusterAnalysis?.isSweeperActive ||
    recipientScan?.clusterAnalysis?.hasTaint;

  const isSweeper = recipientScan?.clusterAnalysis?.isSweeperActive;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provider || !isAddress(recipient) || !amount || Number(amount) <= 0) {
      setError("Please provide a valid recipient address and amount.");
      return;
    }

    if (isBlocked && !overrideWarning) {
      setError("Transaction blocked by Shield Security Agent. Recipient has active high-risk flags.");
      return;
    }

    setSending(true);
    setError("");
    setTxHash(null);

    try {
      const from = getAddress(senderAddress);
      const to = getAddress(recipient);

      if (asset === "ETH") {
        const valueHex = `0x${parseEther(amount).toString(16)}`;
        const hash = (await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from,
              to,
              value: valueHex,
            },
          ],
        })) as string;

        setTxHash(hash);
      } else {
        // USDC native transfer ERC-20
        const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
        const cleanTo = to.toLowerCase().replace(/^0x/, "").padStart(64, "0");
        const amountBigInt = BigInt(Math.floor(Number(amount) * 1e6));
        const cleanAmount = amountBigInt.toString(16).padStart(64, "0");
        const data = `0xa9059cbb${cleanTo}${cleanAmount}`;

        const hash = (await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from,
              to: usdcAddress,
              data,
            },
          ],
        })) as string;

        setTxHash(hash);
      }
    } catch (err: any) {
      setError(err?.message || "Transaction was declined or failed in your wallet.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sendModalBackdrop" onClick={onClose}>
      <div className="sendModalCard" onClick={(e) => e.stopPropagation()}>
        <div className="sendModalHeader">
          <div className="sendModalTitle">
            <span className="sendShieldIcon">🛡️</span>
            <div>
              <h3>Protected Send</h3>
              <p>Shield scans the recipient on-chain before you broadcast</p>
            </div>
          </div>
          <button type="button" className="closeBtn" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSend} className="sendForm">
          {/* Asset & Amount */}
          <div className="formGroup">
            <label>Asset & Amount</label>
            <div className="amountInputGroup">
              <input
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                required
              />
              <select
                value={asset}
                onChange={(e) => setAsset(e.target.value as "ETH" | "USDC")}
              >
                <option value="ETH">ETH</option>
                <option value="USDC">USDC</option>
              </select>
            </div>
          </div>

          {/* Recipient Address */}
          <div className="formGroup">
            <div className="labelRow">
              <label>Recipient Address (Base)</label>
              {scanningRecipient && (
                <span className="preScanningText">
                  <span className="miniSpinner" /> Checking on-chain...
                </span>
              )}
            </div>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              className={isBlocked ? "inputBlocked" : recipientScan ? "inputSafe" : ""}
              required
            />
          </div>

          {/* Quick preset test recipients */}
          <div className="quickTestRow">
            <span>Quick test:</span>
            <button
              type="button"
              onClick={() => setRecipient("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")}
            >
              vitalik.eth (Safe)
            </button>
            <button
              type="button"
              className="dangerPreset"
              onClick={() => setRecipient("0x7777777777777777777777777777777777777bad")}
            >
              Sweeper Trap (Risk)
            </button>
          </div>

          {/* Real-Time Pre-Flight Security Verdict */}
          {recipientScan && (
            <div
              className={`preFlightBox ${
                isBlocked
                  ? "preFlightDanger"
                  : recipientScan.verdict === "CAUTION"
                  ? "preFlightCaution"
                  : "preFlightPass"
              }`}
            >
              <div className="preFlightTop">
                <span className="preFlightBadge">
                  {isSweeper
                    ? "🚨 SWEEPER BOT BLOCKED"
                    : isBlocked
                    ? "🛑 HIGH RISK BLOCKED"
                    : "✅ RECIPIENT VERIFIED"}
                </span>
                <span className="preFlightType">{recipientScan.targetType === "contract" ? "Contract" : "EOA Wallet"}</span>
              </div>
              <p className="preFlightSummary">{recipientScan.summary}</p>
              {isSweeper && (
                <p className="sweeperWarning">
                  <strong>Warning:</strong> Inflows to this wallet are automatically drained in &lt;8 seconds. Do NOT send gas.
                </p>
              )}
            </div>
          )}

          {/* Override Checkbox if Blocked */}
          {isBlocked && (
            <div className="overrideBox">
              <label>
                <input
                  type="checkbox"
                  checked={overrideWarning}
                  onChange={(e) => setOverrideWarning(e.target.checked)}
                />
                <span>I understand the security risk and wish to override Shield</span>
              </label>
            </div>
          )}

          {error && <div className="sendErrorBox">{error}</div>}

          {txHash && (
            <div className="txSuccessBox">
              <strong>Transaction Broadcast!</strong>
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View on BaseScan ↗ ({txHash.slice(0, 10)}...{txHash.slice(-6)})
              </a>
            </div>
          )}

          {/* Submit Action */}
          <div className="modalActions">
            <button type="button" className="cancelBtn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                sending ||
                !amount ||
                Number(amount) <= 0 ||
                !isAddress(recipient) ||
                (isBlocked && !overrideWarning)
              }
              className={`sendConfirmBtn ${isBlocked && !overrideWarning ? "btnDisabled" : ""}`}
            >
              {sending ? (
                <>
                  <span className="miniSpinner" /> Broadcasting...
                </>
              ) : isBlocked ? (
                overrideWarning ? "Override & Send" : "Blocked by Shield"
              ) : (
                "Protected Send"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
