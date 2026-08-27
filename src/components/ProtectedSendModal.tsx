"use client";

import { useState, useEffect } from "react";
import { parseEther, isAddress, getAddress, type Address, type Hex } from "viem";
import { switchToBase, isBaseChain, type Eip1193Provider } from "@/lib/wallet";
import type { ScanReceipt, EvidenceItem } from "@/lib/scan-types";
import { baseClient } from "@/lib/base-client";
import TokenSelector, { SUPPORTED_BASE_TOKENS, type TokenItem } from "./TokenSelector";

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
  const [selectedToken, setSelectedToken] = useState<TokenItem>(SUPPORTED_BASE_TOKENS[0]);
  const [customTokenAddress, setCustomTokenAddress] = useState("");
  const [tokenPrice, setTokenPrice] = useState<number>(2500);
  const [userBalance, setUserBalance] = useState<number>(0);
  const [scanningRecipient, setScanningRecipient] = useState(false);
  const [recipientScan, setRecipientScan] = useState<ScanReceipt | null>(null);
  const [showFullEvidence, setShowFullEvidence] = useState(false);
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [overrideWarning, setOverrideWarning] = useState(false);
  const [activePercentage, setActivePercentage] = useState<number | null>(null);

  // Fetch live token price in USD
  useEffect(() => {
    let tokenParam = selectedToken.symbol;
    let addrParam = selectedToken.address || "";
    if (selectedToken.symbol === "CUSTOM") {
      addrParam = customTokenAddress;
    }
    fetch(`/api/prices?token=${tokenParam}&address=${addrParam}`)
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.price === "number") setTokenPrice(data.price);
      })
      .catch(() => {});
  }, [selectedToken, customTokenAddress]);

  // Read User Balance for selected asset on Base Mainnet
  useEffect(() => {
    if (!senderAddress || !isAddress(senderAddress)) return;

    const fetchBalance = async () => {
      try {
        const owner = getAddress(senderAddress);
        if (selectedToken.symbol === "ETH") {
          const bal = await baseClient.getBalance({ address: owner });
          setUserBalance(Number(bal) / 1e18);
        } else {
          let tokenAddr: Address | null = null;
          let dec = selectedToken.decimals || 18;

          if (selectedToken.symbol === "CUSTOM") {
            if (isAddress(customTokenAddress)) {
              tokenAddr = getAddress(customTokenAddress);
            }
          } else if (selectedToken.address) {
            tokenAddr = getAddress(selectedToken.address);
          }

          if (tokenAddr) {
            const cleanOwner = owner.toLowerCase().replace(/^0x/, "").padStart(64, "0");
            const res = await baseClient.call({
              to: tokenAddr,
              data: `0x70a08231${cleanOwner}` as Hex,
            });
            if (res.data) {
              const rawBal = BigInt(res.data);
              setUserBalance(Number(rawBal) / Math.pow(10, dec));
            }
          }
        }
      } catch (err) {
        console.warn("Error reading balance on Base:", err);
      }
    };

    fetchBalance();
  }, [senderAddress, selectedToken, customTokenAddress]);

  // Auto-scan recipient address on Base
  useEffect(() => {
    const clean = recipient.trim();
    if (!clean || !isAddress(clean)) {
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
          body: JSON.stringify({ address: clean }),
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
    }, 120);

    return () => clearTimeout(timer);
  }, [recipient]);

  if (!isOpen) return null;

  const isBlocked =
    recipientScan?.verdict === "HIGH OBSERVED RISK" ||
    recipientScan?.clusterAnalysis?.isSweeperActive ||
    recipientScan?.clusterAnalysis?.hasTaint;

  const isSweeper = recipientScan?.clusterAnalysis?.isSweeperActive;

  const amountNum = parseFloat(amount) || 0;
  const isInsufficientBalance = amountNum > userBalance;
  const dollarEquivalent = (amountNum * tokenPrice).toFixed(2);
  const userBalanceUsd = (userBalance * tokenPrice).toFixed(2);

  const handlePercentageSelect = (pct: number) => {
    setActivePercentage(pct);
    if (userBalance <= 0) {
      setAmount("0");
      return;
    }

    if (pct === 100) {
      const maxVal =
        selectedToken.symbol === "ETH"
          ? Math.max(0, userBalance - 0.0003) // reserve dust for gas on Base
          : userBalance;
      setAmount(maxVal.toString());
    } else {
      const calculated = (userBalance * (pct / 100)).toFixed(
        selectedToken.symbol === "USDC" ? 2 : 5,
      );
      setAmount(calculated);
    }
  };

  const handlePasteRecipient = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setRecipient(text.trim());
    } catch {}
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!provider || !isAddress(recipient) || !amount || Number(amount) <= 0) {
      setError("Please provide a valid recipient address and amount.");
      return;
    }

    if (isInsufficientBalance) {
      setError(`Insufficient balance. You have ${userBalance} ${selectedToken.symbol}, but are trying to send ${amount}.`);
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
      // STRICT BASE MAINNET NETWORK ENFORCEMENT
      const currentChainHex = await provider.request({ method: "eth_chainId" });
      const currentChainId = Number.parseInt(String(currentChainHex), 16);

      if (!isBaseChain(currentChainId)) {
        await switchToBase(provider);
      }

      const from = getAddress(senderAddress);
      const to = getAddress(recipient);

      if (selectedToken.symbol === "ETH") {
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
        let tokenContractAddr: Address;
        let decimals = selectedToken.decimals || 18;

        if (selectedToken.symbol === "CUSTOM") {
          if (!isAddress(customTokenAddress)) {
            throw new Error("Invalid custom token contract address.");
          }
          tokenContractAddr = getAddress(customTokenAddress);
        } else {
          if (!selectedToken.address) {
            throw new Error("Token configuration error.");
          }
          tokenContractAddr = getAddress(selectedToken.address);
        }

        const cleanTo = to.toLowerCase().replace(/^0x/, "").padStart(64, "0");
        const rawAmountBigInt = BigInt(Math.floor(Number(amount) * Math.pow(10, decimals)));
        const cleanAmount = rawAmountBigInt.toString(16).padStart(64, "0");
        const data = `0xa9059cbb${cleanTo}${cleanAmount}` as Hex;

        const hash = (await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from,
              to: tokenContractAddr,
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
        {/* Header */}
        <div className="sendModalHeader">
          <div className="sendModalTitle">
            <span className="sendShieldIcon">🛡️</span>
            <div>
              <div className="modalBadgeRow">
                <h3>Protected Send</h3>
                <span className="basePill">Base Mainnet (8453)</span>
              </div>
              <p>Shield scans recipient and enforces Base network before broadcasting</p>
            </div>
          </div>
          <button type="button" className="closeBtn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <form onSubmit={handleSend} className="sendForm">
          {/* Asset & Amount Selector */}
          <div className="formGroup">
            <div className="labelRow">
              <label>Asset & Amount</label>
              <div className="balanceRow">
                <span>Available: <strong>{userBalance.toFixed(selectedToken.symbol === "USDC" ? 2 : 5)} {selectedToken.symbol}</strong></span>
                <span className="balanceUsdTag">(${userBalanceUsd})</span>
              </div>
            </div>

            <div className={`amountInputGroup ${isInsufficientBalance ? "inputErrorGroup" : ""}`}>
              <input
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setActivePercentage(null);
                }}
                placeholder="0.0"
                required
              />
              <TokenSelector
                selectedToken={selectedToken}
                onSelectToken={(t) => {
                  setSelectedToken(t);
                  setActivePercentage(null);
                }}
                customAddress={customTokenAddress}
                onCustomAddressChange={setCustomTokenAddress}
              />
            </div>

            {/* Interactive Percentage Quick-Buttons (25%, 50%, 75%, MAX) */}
            <div className="interactivePercentageRow">
              <div className="pctButtonGroup">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    className={`pctBtn ${activePercentage === pct ? "pctBtnActive" : ""}`}
                    onClick={() => handlePercentageSelect(pct)}
                  >
                    {pct === 100 ? "MAX" : `${pct}%`}
                  </button>
                ))}
              </div>

              {amountNum > 0 && (
                <div className="priceEquivalentTag">
                  <span>≈ ${dollarEquivalent} USD</span>
                </div>
              )}
            </div>

            {/* Insufficient Balance Alert */}
            {isInsufficientBalance && (
              <div className="insufficientBalanceAlert">
                ⚠️ Insufficient balance: You have {userBalance.toFixed(5)} {selectedToken.symbol}, but entered {amount} {selectedToken.symbol}.
              </div>
            )}
          </div>

          {/* Custom ERC-20 Address Input */}
          {selectedToken.symbol === "CUSTOM" && (
            <div className="formGroup">
              <label>Custom ERC-20 Token Contract Address</label>
              <input
                type="text"
                value={customTokenAddress}
                onChange={(e) => setCustomTokenAddress(e.target.value)}
                placeholder="Paste Base token contract (0x...)"
                required
              />
            </div>
          )}

          {/* Recipient Address */}
          <div className="formGroup">
            <div className="labelRow">
              <label>Recipient Address (Base)</label>
              <div className="inputActionHelper">
                {recipient ? (
                  <button type="button" className="clearBtn" onClick={() => setRecipient("")}>
                    Clear ✕
                  </button>
                ) : (
                  <button type="button" className="pasteBtn" onClick={handlePasteRecipient}>
                    📋 Paste
                  </button>
                )}
              </div>
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
              className="presetBtn"
              onClick={() => setRecipient("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")}
            >
              vitalik.eth (Safe)
            </button>
            <button
              type="button"
              className="presetBtn dangerPreset"
              onClick={() => setRecipient("0x7777777777777777777777777777777777777bad")}
            >
              Sweeper Trap (Risk)
            </button>
          </div>

          {/* Real-Time Pre-Flight Security Verdict & Full Readable Evidence */}
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
                <div className="preFlightCoverageLarge">
                  <span className="coverageLargeNumber">
                    {Math.round(
                      (recipientScan.coverage.completed /
                        (recipientScan.coverage.total || 1)) *
                        100
                    )}%
                  </span>
                  <span className="coverageSmallLabel">
                    {recipientScan.coverage.completed}/{recipientScan.coverage.total} checks verified
                  </span>
                </div>
              </div>
              <p className="preFlightSummary">{recipientScan.summary}</p>

              {/* 6/6 Readable Checklist */}
              <div className="evidenceChecklist">
                <div className="checklistHeading">
                  <span>Deterministic Evidence Checks:</span>
                  <button
                    type="button"
                    className="toggleDetailsBtn"
                    onClick={() => setShowFullEvidence(!showFullEvidence)}
                  >
                    {showFullEvidence ? "Hide Details ▲" : "View Details & Facts ▼"}
                  </button>
                </div>

                <div className="checkItems">
                  {recipientScan.evidence.map((item: EvidenceItem) => (
                    <div key={item.id} className={`checkCardRow status-${item.status}`}>
                      <div className="checkHeaderLine">
                        <span className="checkIconBadge">
                          {item.status === "pass" ? "✓" : item.status === "danger" ? "✕" : "•"}
                        </span>
                        <strong className="checkItemLabel">{item.label}</strong>
                      </div>
                      <p className="checkItemClaim">{item.claim}</p>

                      {showFullEvidence && item.facts && Object.keys(item.facts).length > 0 && (
                        <div className="itemFactsTable">
                          {Object.entries(item.facts).map(([k, v]) => (
                            <div key={k} className="factRow">
                              <span>{k}:</span>
                              <strong>{String(v)}</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

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
              <strong>Transaction Broadcast to Base Mainnet!</strong>
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View on BaseScan ↗ ({txHash.slice(0, 10)}...{txHash.slice(-6)})
              </a>
            </div>
          )}

          {/* Modal Footer Actions */}
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
                isInsufficientBalance ||
                !isAddress(recipient) ||
                (isBlocked && !overrideWarning)
              }
              className={`sendConfirmBtn ${
                isBlocked && !overrideWarning || isInsufficientBalance ? "btnDisabled" : ""
              }`}
            >
              {sending ? (
                <>
                  <span className="miniSpinner" /> Broadcasting…
                </>
              ) : isInsufficientBalance ? (
                "Insufficient Balance"
              ) : isBlocked ? (
                overrideWarning ? "Override & Send" : "Blocked by Shield"
              ) : (
                "Protected Send on Base"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
