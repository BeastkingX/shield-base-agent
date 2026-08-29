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

  // Honesty fix: check for incomplete coverage / money trail unavailable
  const hasUnavailable = receipt.coverage.unavailable > 0;
  const moneyTrailEvidence = receipt.evidence.find((e) => e.id === "EVIDENCE_MONEY_TRAIL");
  const isMoneyTrailUnavailable = moneyTrailEvidence?.status === "unavailable";
  const clusterStatus = receipt.clusterAnalysis?.analysisStatus;
  const isClusterIncomplete = clusterStatus !== "completed";
  const isIncomplete = hasUnavailable || isClusterIncomplete || isMoneyTrailUnavailable;

  // Rule 3: 1,000-Point Score strictly derived from deterministic verdict + evidence
  // Finding 9: when coverage.unavailable>0 or clusterAnalysis not completed, never show 950/Prime Trust/Secure Clean 2-Hop
  const isDanger = receipt.verdict === "HIGH OBSERVED RISK" || isSweeper || isTainted;
  const isCaution = receipt.verdict === "CAUTION";
  const isLowRisk = receipt.verdict === "LOW OBSERVED RISK";

  const { reputationScore, reputationGrade, scoreTone } = (() => {
    if (isDanger) {
      const score = isSweeper ? 0 : 120;
      return {
        reputationScore: String(score),
        reputationGrade: "Tier 5 · Critical Hazard / Blacklisted",
        scoreTone: "danger",
      };
    }
    // Incomplete checks: never claim Prime Trust / 950 / Secure Clean 2-Hop
    if (isIncomplete) {
      if (isMoneyTrailUnavailable) {
        return {
          reputationScore: "—",
          reputationGrade: "Incomplete checks (Money trail unavailable)",
          scoreTone: "incomplete",
        };
      }
      return {
        reputationScore: "—",
        reputationGrade: hasUnavailable
          ? `Incomplete checks (${receipt.coverage.unavailable} unavailable)`
          : "Unrated · Score unavailable",
        scoreTone: "incomplete",
      };
    }
    if (isCaution) {
      const score = warningCount >= 2 ? 450 : 600;
      const tier = warningCount >= 2 ? "Tier 4 · Caution" : "Tier 3 · Review Required";
      return {
        reputationScore: String(score),
        reputationGrade: tier,
        scoreTone: "warn",
      };
    }
    if (isLowRisk) {
      const score = approvalsCount === 0 && txCount >= 20 ? 950 : 800;
      const tier = score >= 900 ? "Tier 1 · Prime Trust (A+)" : "Tier 2 · Verified & Active (A)";
      return {
        reputationScore: String(score),
        reputationGrade: tier,
        scoreTone: "safe",
      };
    }
    return {
      reputationScore: "—",
      reputationGrade: "Unrated",
      scoreTone: "muted",
    };
  })();

  const securityHealth = (() => {
    if (isSweeper) {
      return {
        text: "Active Sweeper Bot Detected (Inflows drained in <8s)",
        tone: "vDanger",
      };
    }
    if (isTainted) {
      return {
        text: `Drainer Cluster Taint (${receipt.clusterAnalysis?.clusterTaintName || "Phishing Network"})`,
        tone: "vDanger",
      };
    }
    if (isIncomplete) {
      if (isMoneyTrailUnavailable) {
        return {
          text: "Incomplete checks (Money trail unavailable)",
          tone: "vIncomplete",
        };
      }
      return {
        text: hasUnavailable
          ? `Incomplete checks (${receipt.coverage.unavailable} unavailable) · Review required`
          : "Unrated · Score unavailable · Review required",
        tone: "vIncomplete",
      };
    }
    if (isCaution) {
      return {
        text: "Review Required (1+ Warnings Fired)",
        tone: "vWarn",
      };
    }
    return {
      text: "Secure (Clean 2-Hop Money Trail & Seed Funder)",
      tone: "vSafe",
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
            <span className={`scoreValue ${scoreTone === "incomplete" ? "scoreIncomplete" : scoreTone === "muted" ? "scoreUnrated" : ""}`}>{reputationScore}</span>
            <span className="scoreMax">/ 1,000</span>
          </div>
          <div className="scoreMeta">
            <strong>Reputation Score</strong>
            <span>{reputationGrade}</span>
            <small className="scoreSubNote">
              {isIncomplete
                ? "Score unavailable due to incomplete checks, not rated as secure."
                : "Score computed from this scan's fired rules."}
            </small>
          </div>
        </div>
      </div>

      {/* 3 Key Metric Rows adhering to the .kvRow contract */}
      <div className="healthKvBlock">
        <div className="kvRow">
          <span className="k">
            <Icon name="shield-alert" size={14} className="kvIcon" /> Security & Compromise Health
          </span>
          <span className={`v ${securityHealth.tone}`}>
            {securityHealth.text}
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
