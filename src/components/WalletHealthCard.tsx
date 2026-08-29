"use client";

import { useState, useEffect } from "react";
import type { ScanReceipt } from "@/lib/scan-types";
import { shortAddress } from "@/lib/wallet";
import {
  calculateEvidenceScore,
  formatPenaltyTotal,
  type EvidenceScoreTone,
} from "@/lib/evidence-score";
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

  const cluster = receipt.clusterAnalysis;
  const isSweeper = cluster?.isSweeperActive ?? false;
  const hasTaint = cluster?.hasTaint ?? false;
  const taintSeverity = cluster?.taintSeverity ?? "none";
  // Finding 12: a "warning" taint is NOT danger. Only "critical" taint or an
  // active sweeper may use danger styling; a recent-forwarding warning is amber.
  const isCriticalTaint = hasTaint && taintSeverity === "critical";
  const isWarningTaint = hasTaint && taintSeverity === "warning";
  const approvalsCount = receipt.approvalsSummary?.totalCount || 0;
  const unlimitedCount = receipt.approvalsSummary?.unlimitedCount || 0;

  // Derive native ETH balance
  const balanceEvidence = receipt.evidence.find((e) => e.id === "EVIDENCE_NATIVE_BALANCE");
  const rawBalanceEthStr = (balanceEvidence?.facts?.["Native balance"] as string) || "0 ETH";
  const balanceEthNum = parseFloat(rawBalanceEthStr.replace(" ETH", "")) || 0;
  const balanceUsd = (balanceEthNum * ethPrice).toFixed(2);

  // Honesty fix: check for incomplete coverage / money trail unavailable
  const hasUnavailable = receipt.coverage.unavailable > 0;
  const moneyTrailEvidence = receipt.evidence.find((e) => e.id === "EVIDENCE_MONEY_TRAIL");
  const isMoneyTrailUnavailable = moneyTrailEvidence?.status === "unavailable";
  const clusterStatus = cluster?.analysisStatus;
  const isClusterIncomplete = clusterStatus !== "completed";
  const isIncomplete = hasUnavailable || isClusterIncomplete || isMoneyTrailUnavailable;

  // Finding 13: deterministic Observed Evidence Score (pure function), no
  // hard-coded reputation numbers and no balance/tx-count bonus. The verdict
  // stays authoritative; the score is display-only.
  const scoreResult = calculateEvidenceScore(receipt);
  const { score: evidenceScore, breakdown, grade, tone, note: scoreNote } = scoreResult;

  const toneClasses: Record<EvidenceScoreTone, { score: string; grade: string }> = {
    safe: { score: "", grade: "vSafe" },
    warn: { score: "scoreWarn", grade: "vWarn" },
    danger: { score: "scoreDanger", grade: "vDanger" },
    incomplete: { score: "scoreIncomplete", grade: "vIncomplete" },
    muted: { score: "scoreUnrated", grade: "vMuted" },
  };

  const securityHealth = (() => {
    if (isSweeper) {
      return {
        text: "Active Sweeper Bot Detected (Inflows drained in <8s)",
        tone: "vDanger",
      };
    }
    if (isCriticalTaint) {
      return {
        text: `Drainer Cluster Taint (${cluster?.clusterTaintName || "Phishing Network"})`,
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
    if (isWarningTaint) {
      return {
        text: "Review required (recent rapid forwarding)",
        tone: "vWarn",
      };
    }
    if (receipt.verdict === "CAUTION") {
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

        {/* Observed Evidence Score — scan-level summary, not a reputation/trust rating */}
        <div className="scoreArea">
          <div className="reputationScoreBox">
            <div className="scoreNumber">
              <span className={`scoreValue ${toneClasses[tone].score}`}>
                {evidenceScore === null ? "—" : evidenceScore}
              </span>
              <span className="scoreMax">/ 1,000</span>
            </div>
            <div className="scoreMeta">
              <strong>Observed Evidence Score</strong>
              <span className={toneClasses[tone].grade}>{grade}</span>
              <small className="scoreSubNote">{scoreNote}</small>
            </div>
          </div>

          {/* Finding 13: visible calculation disclosure — readable label/value rows */}
          <details className="scoreDisclosure">
            <summary>How this score was calculated</summary>
            <div className="scoreBreakdown">
              <div className="scoreBreakdownHeader">Score method</div>

              <div className="scoreRow">
                <span className="scoreRowLabel">Starting score</span>
                <span className="scoreRowValue">{breakdown.startingScore.toLocaleString()}</span>
              </div>

              <div className="scoreRow">
                <span className="scoreRowLabel">Warning checks</span>
                <span className="scoreRowValue">
                  -{breakdown.warningPenaltyPer} × {breakdown.warningCount} = {formatPenaltyTotal(breakdown.warningPenaltyTotal)}
                </span>
              </div>

              <div className="scoreRow">
                <span className="scoreRowLabel">Danger checks</span>
                <span className="scoreRowValue">
                  -{breakdown.dangerPenaltyPer} × {breakdown.dangerCount} = {formatPenaltyTotal(breakdown.dangerPenaltyTotal)}
                </span>
              </div>

              <div className="scoreRow">
                <span className="scoreRowLabel">Coverage</span>
                <span className="scoreRowValue">
                  {breakdown.coverageCompleted}/{breakdown.coverageTotal}
                </span>
              </div>

              {breakdown.verdictCeiling !== null && (
                <div className="scoreRow">
                  <span className="scoreRowLabel">Verdict ceiling</span>
                  <span className="scoreRowValue">
                    {receipt.verdict} ≤ {breakdown.verdictCeiling}
                  </span>
                </div>
              )}

              <div className="scoreRow scoreRowFinal">
                <span className="scoreRowLabel">Final evidence score</span>
                <span className="scoreRowValue">
                  {evidenceScore === null ? "—" : `${evidenceScore} / 1,000`}
                </span>
              </div>
            </div>
            <p className="scoreDisclosureNote">
              This is a scan-level summary of observed evidence. It is not a guarantee,
              identity rating, or permanent reputation.
            </p>
          </details>
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
