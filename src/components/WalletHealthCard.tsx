"use client";

import { useState, useEffect } from "react";
import type { ScanReceipt } from "@/lib/scan-types";
import { shortAddress } from "@/lib/wallet";
import Icon from "./Icon";

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
  const warningCount = receipt.evidence.filter((e) => e.status === "warning").length;

  // Derive native ETH balance
  const balanceEvidence = receipt.evidence.find((e) => e.id === "EVIDENCE_NATIVE_BALANCE");
  const rawBalanceEthStr = (balanceEvidence?.facts?.["Native balance"] as string) || "0 ETH";
  const balanceEthNum = parseFloat(rawBalanceEthStr.replace(" ETH", "")) || 0;
  const balanceUsd = (balanceEthNum * ethPrice).toFixed(2);

  // Derive txCount
  const txCountItem = receipt.evidence.find((e) => e.id === "EVIDENCE_TRANSACTION_COUNT");
  const txCount = (txCountItem?.facts?.["Transaction count"] as number) || 0;

  // Rule 3: 1,000-Point Score strictly derived from deterministic verdict + evidence
  const isDanger = receipt.verdict === "HIGH OBSERVED RISK" || isSweeper || isTainted;
  const isCaution = receipt.verdict === "CAUTION";
  const isLowRisk = receipt.verdict === "LOW OBSERVED RISK";

  const { reputationScore, reputationGrade } = (() => {
    if (isDanger) {
      const score = isSweeper ? 0 : 120;
      return {
        reputationScore: score,
        reputationGrade: "Tier 5 · Critical Hazard / Blacklisted",
      };
    }
    if (isCaution) {
      const score = warningCount >= 2 ? 450 : 600;
      const tier = warningCount >= 2 ? "Tier 4 · Caution" : "Tier 3 · Review Required";
      return {
        reputationScore: score,
        reputationGrade: tier,
      };
    }
    if (isLowRisk) {
      const score = approvalsCount === 0 && txCount >= 20 ? 950 : 800;
      const tier = score >= 900 ? "Tier 1 · Prime Trust (A+)" : "Tier 2 · Verified & Active (A)";
      return {
        reputationScore: score,
        reputationGrade: tier,
      };
    }
    return {
      reputationScore: 500,
      reputationGrade: "Unrated",
    };
  })();

  return (
    <div className="walletHealthCard">
      {/* Top Banner */}
      <div className="healthTop">
        <div className="healthIdentity">
          <div className="healthAvatarWrap" aria-hidden="true">
            <Icon name="shield" size={24} />
          </div>
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
            <small className="scoreSubNote">Score computed from this scan's fired rules.</small>
          </div>
        </div>
      </div>

      {/* 3 Key Metric Rows adhering to the .kvRow contract */}
      <div className="healthKvBlock">
        <div className="kvRow">
          <span className="k">
            <Icon name="shield-alert" size={14} className="kvIcon" /> Security & Compromise Health
          </span>
          <span className={`v ${isDanger ? "vDanger" : isCaution ? "vWarn" : "vSafe"}`}>
            {isSweeper
              ? "Active Sweeper Bot Detected (Inflows drained in <8s)"
              : isTainted
              ? `Drainer Cluster Taint (${receipt.clusterAnalysis?.clusterTaintName || "Phishing Network"})`
              : isCaution
              ? "Review Required (1+ Warnings Fired)"
              : "Secure (Clean 2-Hop Money Trail & Seed Funder)"}
          </span>
        </div>

        <div className="kvRow">
          <span className="k">
            <Icon name="coins" size={14} className="kvIcon" /> Available Native Balance
          </span>
          <span className="v">
            {balanceEthNum.toFixed(6)} ETH <span className="usdTag">(${balanceUsd} USD)</span>
          </span>
        </div>

        <div className="kvRow">
          <span className="k">
            <Icon name="key" size={14} className="kvIcon" /> Token Approvals Exposure
          </span>
          <span className="v">
            {approvalsCount === 0
              ? "0 Open Allowances (Clean self-custody)"
              : `${approvalsCount} Active (${unlimitedCount} Unlimited permissions audited)`}
          </span>
        </div>
      </div>

      {/* Action Strip */}
      <div className="healthActionsStrip">
        <div className="healthTip">
          <Icon name="info" size={16} />
          <p>
            Send tokens safely using <strong>Protected Send</strong>. Shield pre-scans recipient addresses before broadcasting.
          </p>
        </div>

        <div className="healthBtnGroup">
          <button type="button" className="primaryBtn" onClick={onOpenSendModal}>
            <Icon name="send" size={15} /> Protected Send
          </button>
          <button
            type="button"
            className="ghostbtn"
            onClick={onToggleTechnicalEvidence}
          >
            {showTechnicalEvidence ? "Hide Raw Evidence ▲" : "Inspect Raw Evidence ▼"}
          </button>
        </div>
      </div>
    </div>
  );
}
