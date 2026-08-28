"use client";

import { useState, useEffect } from "react";
import type { ScanReceipt } from "@/lib/scan-types";
import { shortAddress } from "@/lib/wallet";

interface WalletHealthCardProps {
  receipt: ScanReceipt;
  onOpenSendModal: () => void;
  onToggleTechnicalEvidence: () => void;
  showTechnicalEvidence: boolean;
}

export default function WalletHealthCard({
  receipt,
  onOpenSendModal,
  onToggleTechnicalEvidence,
  showTechnicalEvidence,
}: WalletHealthCardProps) {
  const [ethPrice, setEthPrice] = useState(2500);

  useEffect(() => {
    fetch("/api/prices?token=ETH")
      .then((res) => res.json())
      .then((data) => {
        if (data.price) setEthPrice(data.price);
      })
      .catch(() => {});
  }, []);

  const isSweeper = receipt.clusterAnalysis?.isSweeperActive;
  const isTainted = receipt.clusterAnalysis?.hasTaint;
  const approvalsCount = receipt.approvalsSummary?.totalCount || 0;
  const unlimitedCount = receipt.approvalsSummary?.unlimitedCount || 0;

  // Derive native ETH balance
  const balanceEvidence = receipt.evidence.find((e) => e.id === "EVIDENCE_NATIVE_BALANCE");
  const rawBalanceEthStr = (balanceEvidence?.facts?.["Native balance"] as string) || "0 ETH";
  const balanceEthNum = parseFloat(rawBalanceEthStr.replace(" ETH", "")) || 0;
  const balanceUsd = (balanceEthNum * ethPrice).toFixed(2);

  // Derive txCount
  const txCountItem = receipt.evidence.find((e) => e.id === "EVIDENCE_TRANSACTION_COUNT");
  const txCount = (txCountItem?.facts?.["Transaction count"] as number) || 0;

  // 1,000-Point Multi-Vector Reputation Formula
  const reputationScore = (() => {
    if (isSweeper) return 0;
    if (isTainted) return 120;

    let score = 500; // Base baseline

    // 1. Transaction History & Activity (Max +250)
    if (txCount >= 400) score += 250;
    else if (txCount >= 100) score += 200;
    else if (txCount >= 20) score += 150;
    else if (txCount > 0) score += 80;

    // 2. Money-Trail & Seed Funder Health (Max +150)
    if (!isTainted && !isSweeper) score += 150;

    // 3. Approval Exposure Hygiene (Max +100)
    if (approvalsCount === 0) {
      score += 100; // Clean self-custody
    } else if (unlimitedCount === 0) {
      score += 80;
    } else if (unlimitedCount <= 5) {
      score += 50;
    }

    return Math.min(1000, Math.max(0, score));
  })();

  const reputationGrade =
    reputationScore >= 900
      ? "Tier 1 · Prime Trust (A+)"
      : reputationScore >= 750
      ? "Tier 2 · Verified & Active (A)"
      : reputationScore >= 500
      ? "Tier 3 · Standard / Moderate"
      : reputationScore >= 250
      ? "Tier 4 · Caution"
      : "Tier 5 · Critical Hazard / Blacklisted";

  return (
    <div className="walletHealthCard">
      {/* Top Banner */}
      <div className="healthTop">
        <div className="healthIdentity">
          <span className="healthAvatar" aria-hidden="true">🛡️</span>
          <div>
            <div className="healthLabelRow">
              <span className="healthBadge">Connected Wallet Profile</span>
              <span className="healthBlock">Base Block #{Number(receipt.blockNumber).toLocaleString()}</span>
            </div>
            <h3>{shortAddress(receipt.address)}</h3>
          </div>
        </div>

        {/* 1,000-Point Institutional Reputation Score Meter */}
        <div className="reputationScoreBox">
          <div className="scoreNumber">
            <span className="scoreValue">{reputationScore}</span>
            <span className="scoreMax">/ 1,000</span>
          </div>
          <div className="scoreMeta">
            <strong>Reputation Score</strong>
            <span>{reputationGrade}</span>
          </div>
        </div>
      </div>

      {/* 3 Metric Pillars */}
      <div className="healthMetricsGrid">
        {/* Security Health */}
        <div className={`metricCol ${isSweeper ? "metricDanger" : "metricSafe"}`}>
          <span className="metricIcon" aria-hidden="true">{isSweeper ? "🚨" : "✅"}</span>
          <div>
            <span className="metricTitle">Security & Compromise Health</span>
            <strong>
              {isSweeper
                ? "Active Sweeper Bot Detected"
                : isTainted
                ? "Drainer Cluster Taint"
                : "Secure · No Compromise Detected"}
            </strong>
            <small>
              {isSweeper
                ? "Inflows drained in <8s"
                : "Clean 2-hop money trail & seed funder"}
            </small>
          </div>
        </div>

        {/* Balances */}
        <div className="metricCol">
          <span className="metricIcon" aria-hidden="true">💰</span>
          <div>
            <span className="metricTitle">Available Balance</span>
            <strong>
              {balanceEthNum.toFixed(6)} ETH{" "}
              <span className="usdTag">(${balanceUsd} USD)</span>
            </strong>
            <small>Native Base Mainnet Balance</small>
          </div>
        </div>

        {/* Approvals Exposure */}
        <div className="metricCol">
          <span className="metricIcon" aria-hidden="true">🔒</span>
          <div>
            <span className="metricTitle">Token Approvals Exposure</span>
            <strong>
              {approvalsCount === 0
                ? "0 Open Allowances (Clean)"
                : `${approvalsCount} Active Token Approvals`}
            </strong>
            <small>
              {approvalsCount === 0
                ? "Zero exposure to external contracts"
                : `${unlimitedCount} unlimited permissions audited`}
            </small>
          </div>
        </div>
      </div>

      {/* Action Strip */}
      <div className="healthActionsStrip">
        <div className="healthTip">
          <span aria-hidden="true">💡</span>
          <p>
            Send tokens safely using <strong>Protected Send</strong>. Shield scans any recipient address and verifies network before broadcasting.
          </p>
        </div>

        <div className="healthBtnGroup">
          <button type="button" className="primaryBtn" onClick={onOpenSendModal}>
            🛡️ Protected Send
          </button>
          <button
            type="button"
            className="ghostBtn"
            onClick={onToggleTechnicalEvidence}
          >
            {showTechnicalEvidence ? "Hide Raw Evidence ▲" : "Inspect Raw Evidence ▼"}
          </button>
        </div>
      </div>
    </div>
  );
}
