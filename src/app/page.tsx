"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  EvidenceCategory,
  EvidenceFactValue,
  EvidenceItem,
  ScanReceipt,
} from "@/lib/scan-types";
import { shortAddress, getInjectedWallet } from "@/lib/wallet";
import WalletPanel from "@/components/WalletPanel";
import AgentCopilot from "@/components/AgentCopilot";
import WalletHealthCard from "@/components/WalletHealthCard";
import ProtectedSendModal from "@/components/ProtectedSendModal";
import ReportWalletModal from "@/components/ReportWalletModal";
import ShieldLogo from "@/components/ShieldLogo";
import AiEducationCarousel from "@/components/AiEducationCarousel";
import PopupInspector from "@/components/PopupInspector";

const DEMO_CONTRACT = "0x4200000000000000000000000000000000000006";
const DEMO_VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const DEMO_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEMO_SWEEPER_CAUGHT = "0x69620a2e27af4849bce5f70126ba1fc474c0e4a0";

const FILTERS: Array<{ id: "all" | EvidenceCategory; label: string }> = [
  { id: "all", label: "All evidence" },
  { id: "identity", label: "Identity" },
  { id: "history", label: "History" },
  { id: "chain", label: "Chain state" },
  { id: "exposure", label: "Exposure" },
];

interface Health {
  ok: boolean;
  blockNumber?: string;
  latencyMs?: number;
  services?: {
    baseRpc?: string;
    sourceMetadata?: string;
    indexedHistory?: string;
    indexedExplorer?: string;
  };
}

function statusLabel(status: EvidenceItem["status"]): string {
  if (status === "pass") return "Completed";
  if (status === "warning") return "Review";
  if (status === "danger") return "High risk";
  if (status === "info") return "Observed";
  return "Unavailable";
}

function categoryLabel(category: EvidenceCategory): string {
  return FILTERS.find((filter) => filter.id === category)?.label || category;
}

function displayFact(value: EvidenceFactValue): string {
  if (value === null || value === "") return "Not available";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function verdictClass(verdict: ScanReceipt["verdict"]): string {
  return verdict.toLowerCase().replaceAll(" ", "-");
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanStage, setScanStage] = useState(0);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ScanReceipt | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [filter, setFilter] = useState<"all" | EvidenceCategory>("all");
  const [copied, setCopied] = useState<"address" | "receipt" | "hash" | "">("");
  const [connectedAccount, setConnectedAccount] = useState<string | null>(null);
  const [showSelfTechnicalEvidence, setShowSelfTechnicalEvidence] = useState(false);
  const [showProtectedSend, setShowProtectedSend] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTargetAddress, setReportTargetAddress] = useState("");
  const [selectedQuestion, setSelectedQuestion] = useState("");
  const [isChatDockOpen, setIsChatDockOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [srAnnouncement, setSrAnnouncement] = useState("");

  const resultsRef = useRef<HTMLElement>(null);

  // Sync theme state with DOM on mount
  useEffect(() => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    setTheme(isDark ? "dark" : "light");

    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setHealth(data))
      .catch(() => setHealth({ ok: false }));
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    localStorage.setItem("shield-theme", nextTheme);
  };

  const filteredEvidence = useMemo(() => {
    if (!receipt || filter === "all") return receipt?.evidence || [];
    return receipt.evidence.filter((item) => item.category === filter);
  }, [receipt, filter]);

  const runScan = useCallback(async (target: string) => {
    setScanStage(0);
    setLoading(true);
    setError("");
    setFilter("all");
    setSrAnnouncement(`Scanning target ${target} on Base Mainnet...`);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: target }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The scan failed.");
      setReceipt(data);
      const warnCount = data.evidence?.filter((e: EvidenceItem) => e.status === "warning" || e.status === "danger").length || 0;
      setSrAnnouncement(`Result: ${data.verdict}. ${warnCount} warnings. ${data.coverage.completed} of ${data.coverage.total} checks completed.`);
      window.setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : "The scan failed.";
      setError(msg);
      setSrAnnouncement(`Scan error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectEducationQuestion = useCallback((q: string) => {
    setSelectedQuestion(q);
    setIsChatDockOpen(true);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runScan(address);
  }

  const handleWalletAddress = useCallback(
    (account: string) => {
      setAddress(account);
      setConnectedAccount(account);
      void runScan(account);
    },
    [runScan],
  );

  const handleWalletDisconnect = useCallback(() => {
    setConnectedAccount(null);
  }, []);

  async function copyText(value: string, type: "address" | "receipt" | "hash") {
    await navigator.clipboard.writeText(value);
    setCopied(type);
    window.setTimeout(() => setCopied(""), 1800);
  }

  function downloadReceipt() {
    if (!receipt) return;
    const blob = new Blob([JSON.stringify(receipt, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${receipt.receiptId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const scanStages = [
    "Validate target",
    "Read Base block",
    "Collect indexed evidence",
    "Apply deterministic rules",
  ];

  const warningCount =
    receipt?.evidence.filter((e) => e.status === "warning" || e.status === "danger").length || 0;
  const unavailableCount = receipt?.coverage.unavailable || 0;
  const sweepVelocity = receipt?.clusterAnalysis?.sweepVelocitySeconds
    ? `${receipt.clusterAnalysis.sweepVelocitySeconds}s`
    : receipt?.clusterAnalysis?.isSweeperActive
    ? "<8s (Sweeper)"
    : "Clean (No sweep)";

  return (
    <div className="appContainer">
      {/* Screen Reader Live Region */}
      <div className="srOnly" role="status" aria-live="polite">
        {srAnnouncement}
      </div>

      {/* Primary Navigation */}
      <header role="banner">
        <nav className="nav shell" aria-label="Primary navigation">
          <a className="brand" href="#top" aria-label="Shield home">
            <ShieldLogo size={34} />
            <span className="brandTitle">SHIELD</span>
          </a>

          <div className="navCenter desktopOnly">
            <a href="#popup-inspector" className="navLink">
              Check Pop-Up
            </a>
            <a href="#method" className="navLink">
              Method
            </a>
            <Link href="/verify" className="navLink">
              Verify Receipt
            </Link>
          </div>

          <div className="navRight">
            <button
              type="button"
              className="reportHeaderActionBtn"
              onClick={() => {
                setReportTargetAddress(address || receipt?.address || "");
                setShowReportModal(true);
              }}
              aria-label="Report a malicious scam address"
            >
              🚩 Report
            </button>

            <div className="networkPill desktopOnly" role="status" aria-label="Base network status">
              <span className={`networkDot ${health?.ok ? "online" : ""}`} aria-hidden="true" />
              <span>
                {health === null
                  ? "Checking Base"
                  : health.ok
                  ? `Base · #${Number(health.blockNumber).toLocaleString()}`
                  : "Base unavailable"}
              </span>
            </div>

            <button
              type="button"
              className="themeToggleBtn"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>

            {/* Mobile Hamburger Toggle */}
            <button
              type="button"
              className="mobileMenuBtn mobileOnly"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle mobile menu"
            >
              {mobileMenuOpen ? "✕" : "☰"}
            </button>
          </div>
        </nav>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="mobileNavDrawer" role="navigation" aria-label="Mobile navigation">
            <a
              href="#popup-inspector"
              className="mobileNavLink"
              onClick={() => setMobileMenuOpen(false)}
            >
              Check Pop-Up
            </a>
            <a
              href="#method"
              className="mobileNavLink"
              onClick={() => setMobileMenuOpen(false)}
            >
              Method
            </a>
            <Link
              href="/verify"
              className="mobileNavLink"
              onClick={() => setMobileMenuOpen(false)}
            >
              Verify Receipt
            </Link>
            <div className="mobileNetworkRow">
              <span className={`networkDot ${health?.ok ? "online" : ""}`} aria-hidden="true" />
              <span>
                {health?.ok
                  ? `Base #${Number(health.blockNumber).toLocaleString()}`
                  : "Base RPC Connected"}
              </span>
            </div>
          </div>
        )}
      </header>

      {/* Main Content Landmark */}
      <main id="main-content">
        {/* Hero Section */}
        <section className={`hero shell ${receipt ? "heroCompact" : ""}`} id="top" aria-label="Address Scanner Hero">
          <div className="eyebrow" role="note">
            <span aria-hidden="true" /> Evidence-first security on Base
          </div>
          <h1>
            Inspect the address.<br />
            <em>See the evidence.</em>
          </h1>
          <p className="heroCopy">
            Enter any Base wallet or contract. Shield reads live chain data,
            checks indexed history, and explains a deterministic verdict.
            Connect your wallet to scan it automatically before you act.
          </p>

          {/* Main Scan Console Card */}
          <form className="scanPanel" onSubmit={handleSubmit} aria-label="Base Address Scanner">
            <div className="scanLabelRow">
              <label htmlFor="address">Wallet or contract address</label>
              <span className="chainTag">Base Mainnet · Chain ID 8453</span>
            </div>

            <div className="inputRow">
              <span className="inputGlyph" aria-hidden="true">0x</span>
              <input
                id="address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Enter a 0x address or name"
                autoComplete="off"
                spellCheck={false}
                required
                aria-label="EVM Address on Base Mainnet"
                aria-describedby={error ? "scan-error" : undefined}
              />
              <button
                disabled={loading || !address.trim()}
                type="submit"
                className="primaryBtn heroScanBtn"
              >
                {loading ? (
                  <>
                    <span className="spinner dark" aria-hidden="true" />
                    <span>Scanning…</span>
                  </>
                ) : (
                  <span>Scan →</span>
                )}
              </button>
            </div>

            {/* Slim Connect Wallet Row */}
            <WalletPanel
              onAddress={handleWalletAddress}
              onDisconnect={handleWalletDisconnect}
              scanning={loading}
              onOpenSendModal={() => setShowProtectedSend(true)}
            />

            {/* Demo Chips Row */}
            <div className="formMeta" aria-label="Demo preset addresses">
              <span className="metaLabel">Demos:</span>
              <button
                className="chipBtn"
                type="button"
                onClick={() => {
                  setAddress(DEMO_CONTRACT);
                  runScan(DEMO_CONTRACT);
                }}
              >
                Try WETH on Base <span>→</span>
              </button>
              <button
                className="chipBtn"
                type="button"
                onClick={() => {
                  setAddress(DEMO_VITALIK);
                  runScan(DEMO_VITALIK);
                }}
              >
                Try vitalik.eth (EIP-7702) <span>→</span>
              </button>
              <button
                className="chipBtn"
                type="button"
                onClick={() => {
                  setAddress(DEMO_USDC);
                  runScan(DEMO_USDC);
                }}
              >
                Try USDC (Proxy) <span>→</span>
              </button>
              <button
                className="chipBtn chipBtnDanger"
                type="button"
                onClick={() => {
                  setAddress(DEMO_SWEEPER_CAUGHT);
                  runScan(DEMO_SWEEPER_CAUGHT);
                }}
              >
                🚨 Caught Live: Sweeper <span>→</span>
              </button>
              <span className="readOnlyHint">· Read-only · Never signs</span>
            </div>

            {loading && (
              <div className="scanProgress" role="status" aria-live="polite">
                <div className="progressTrack">
                  <span style={{ width: `${(scanStage + 1) * 25}%` }} />
                </div>
                <div className="progressStages">
                  {scanStages.map((stage, index) => (
                    <span className={index <= scanStage ? "active" : ""} key={stage}>
                      {index < scanStage ? "✓" : index + 1} {stage}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="errorBox" id="scan-error" role="alert">
                <div className="errorContent">
                  <strong>Scan could not complete</strong>
                  <span>{error}</span>
                </div>
                <button type="submit" className="ghostBtn retryBtn">
                  Try again
                </button>
              </div>
            )}
          </form>

          {/* Interactive Topic Questions Carousel */}
          <AiEducationCarousel onSelectQuestion={handleSelectEducationQuestion} />

          {!receipt && (
            <div className="trustRow" aria-label="Shield safety principles">
              <span>Live Base evidence</span>
              <span>Versioned rules</span>
              <span>Exportable receipts</span>
              <span>No signatures, ever</span>
            </div>
          )}
        </section>

        {/* Scan Results Section */}
        {receipt && (
          <section className="results shell" ref={resultsRef} aria-label="Scan Results">
            {connectedAccount?.toLowerCase() === receipt.address.toLowerCase() && (
              <WalletHealthCard
                receipt={receipt}
                onOpenSendModal={() => setShowProtectedSend(true)}
                onToggleTechnicalEvidence={() =>
                  setShowSelfTechnicalEvidence(!showSelfTechnicalEvidence)
                }
                showTechnicalEvidence={showSelfTechnicalEvidence}
              />
            )}

            {(connectedAccount?.toLowerCase() !== receipt.address.toLowerCase() ||
              showSelfTechnicalEvidence) && (
              <>
                {/* Result Top Action Bar */}
                <div className="resultTopline">
                  <div>
                    <span className="sectionLabel">Analysis complete</span>
                    <div className="addressLine">
                      <h2>{shortAddress(receipt.address)}</h2>
                      {connectedAccount?.toLowerCase() === receipt.address.toLowerCase() && (
                        <span className="connectedChip">Connected wallet</span>
                      )}
                      <button
                        className="ghostIconBtn"
                        type="button"
                        onClick={() => copyText(receipt.address, "address")}
                        aria-label="Copy full target address"
                      >
                        {copied === "address" ? "Copied ✓" : "Copy"}
                      </button>
                    </div>
                    <p className="receiptIdMeta">Receipt ID: {receipt.receiptId}</p>
                  </div>

                  <div className="resultActions">
                    <button
                      type="button"
                      className="ghostBtn dangerGhostBtn"
                      onClick={() => {
                        setReportTargetAddress(receipt.address);
                        setShowReportModal(true);
                      }}
                    >
                      🚩 Report Address
                    </button>
                    <a
                      href={`https://basescan.org/address/${receipt.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ghostBtn"
                    >
                      BaseScan ↗
                    </a>
                    <button
                      type="button"
                      className="ghostBtn"
                      onClick={() =>
                        copyText(JSON.stringify(receipt, null, 2), "receipt")
                      }
                    >
                      {copied === "receipt" ? "Copied JSON ✓" : "Copy JSON"}
                    </button>
                    <button
                      className="ghostBtn"
                      type="button"
                      onClick={downloadReceipt}
                    >
                      Download JSON ↧
                    </button>
                    <button
                      type="button"
                      className="ghostBtn themeToggleInlineBtn"
                      onClick={toggleTheme}
                      aria-label="Toggle dark/light theme"
                    >
                      {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
                    </button>
                  </div>
                </div>

                {/* Verdict Banner — THE PHOTOGRAPHABLE ARTIFACT */}
                <div className={`verdictCard verdict-${verdictClass(receipt.verdict)}`}>
                  <div className="verdictTopRow">
                    <div className="verdictBadgeLarge">
                      <span className="verdictDotSignal" aria-hidden="true" />
                      <h3>{receipt.verdict}</h3>
                    </div>
                    <span className="verdictBlockTag">
                      Base Mainnet · Block #{Number(receipt.blockNumber).toLocaleString()}
                    </span>
                  </div>

                  <p className="verdictSummaryText">{receipt.summary}</p>

                  {/* Big 4-Stat Photographic Grid */}
                  <div className="verdictStatsRow">
                    <div className="verdictStatBox">
                      <span className="statBoxLabel">Evidence Coverage</span>
                      <strong className="statBoxValue">
                        {receipt.coverage.completed}/{receipt.coverage.total} (
                        {Math.round(
                          (receipt.coverage.completed / receipt.coverage.total) * 100
                        )}
                        %)
                      </strong>
                    </div>

                    <div className="verdictStatBox">
                      <span className="statBoxLabel">Forwarding Velocity</span>
                      <strong className="statBoxValue">{sweepVelocity}</strong>
                    </div>

                    <div className="verdictStatBox">
                      <span className="statBoxLabel">Warning Signals</span>
                      <strong className="statBoxValue">
                        {warningCount === 0 ? "0 Warnings" : `${warningCount} Warning${warningCount > 1 ? "s" : ""}`}
                      </strong>
                    </div>

                    <div className="verdictStatBox">
                      <span className="statBoxLabel">Unavailable Gaps</span>
                      <strong className="statBoxValue">
                        {unavailableCount === 0 ? "0 Gaps (100% Verified)" : `${unavailableCount} Unavailable`}
                      </strong>
                    </div>
                  </div>

                  {/* Rule Chips */}
                  <div className="firedRulesRow">
                    <span className="firedRulesLabel">Fired rules:</span>
                    <div className="firedChipsList">
                      {receipt.firedRules.map((rule) => (
                        <code key={rule.id} className="ruleChip">
                          {rule.id}
                        </code>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Cryptographic Verification Strip under Verdict */}
                <div className="verifyStripCard">
                  <div className="verifyStripLeft">
                    <span className="verifyLockIcon" aria-hidden="true">🔒</span>
                    <div className="verifyStripText">
                      <strong>Cryptographic Receipt Hash:</strong>
                      <code>{receipt.receiptHash ? `${receipt.receiptHash.slice(0, 16)}...${receipt.receiptHash.slice(-8)}` : "Computing..."}</code>
                      <span className="verifyTip">recompute & compare in browser</span>
                    </div>
                  </div>

                  <div className="verifyStripActions">
                    {receipt.receiptHash && (
                      <button
                        type="button"
                        className="ghostBtn verifyCopyBtn"
                        onClick={() => copyText(receipt.receiptHash || "", "hash")}
                      >
                        {copied === "hash" ? "Copied ✓" : "Copy Hash 📋"}
                      </button>
                    )}
                    <Link
                      href={`/verify?receipt=${encodeURIComponent(JSON.stringify(receipt))}`}
                      className="primaryBtn verifyLinkBtn"
                    >
                      Verify on /verify ↗
                    </Link>
                  </div>
                </div>

                {/* Overview Stat Grid */}
                <div className="overviewGrid" aria-label="Scan overview metrics">
                  <article className="overviewItem">
                    <span className="overviewLabel">Identity</span>
                    <strong className="overviewVal">
                      {receipt.evidence.find((e) => e.id === "EVIDENCE_TARGET_TYPE")
                        ?.facts?.["Classification"] ||
                        (receipt.targetType === "contract"
                          ? "Smart contract"
                          : "Standard EOA wallet")}
                    </strong>
                    <small>Classified from live Base bytecode</small>
                  </article>

                  <article className="overviewItem">
                    <span className="overviewLabel">Money Trail</span>
                    <strong
                      className="overviewVal"
                      style={{
                        color: receipt.clusterAnalysis?.isSweeperActive
                          ? "var(--red)"
                          : receipt.clusterAnalysis?.hasTaint
                          ? "var(--amber)"
                          : "var(--green)",
                      }}
                    >
                      {receipt.clusterAnalysis?.isSweeperActive
                        ? "🚨 Active Sweeper Bot"
                        : receipt.clusterAnalysis?.hasTaint
                        ? `⚠️ ${receipt.clusterAnalysis.clusterTaintName || "Drainer Cluster"}`
                        : "Clean 1-Hop Funding"}
                    </strong>
                    <small>
                      {receipt.clusterAnalysis?.isSweeperActive
                        ? "Inflows drained in <8s"
                        : "No sweeper bot or cluster taint"}
                    </small>
                  </article>

                  <article className="overviewItem">
                    <span className="overviewLabel">Token Exposure</span>
                    <strong className="overviewVal">
                      {receipt.approvalsSummary?.totalCount
                        ? `${receipt.approvalsSummary.totalCount} Active Approvals`
                        : "0 Open Allowances (Clean)"}
                    </strong>
                    <small>
                      {receipt.approvalsSummary?.unlimitedCount
                        ? `${receipt.approvalsSummary.unlimitedCount} unlimited allowances`
                        : "No unrevoked token approvals"}
                    </small>
                  </article>

                  <article className="overviewItem">
                    <span className="overviewLabel">Base Chain State</span>
                    <strong className="overviewVal">Block #{Number(receipt.blockNumber).toLocaleString()}</strong>
                    <small>
                      {new Date(receipt.blockTimestamp).toLocaleTimeString()} · {new Date(receipt.blockTimestamp).toLocaleDateString()}
                    </small>
                  </article>
                </div>

                {/* Expandable Evidence Trail */}
                <div className="evidenceSection">
                  <div className="evidenceHeading">
                    <div>
                      <span className="sectionLabel">Evidence trail</span>
                      <h3>Every conclusion, inspectable</h3>
                      <p>
                        Unavailable checks remain visible and never count as safe.
                      </p>
                    </div>
                    <span className="evidenceCount">
                      {receipt.evidence.length} checks evaluated
                    </span>
                  </div>

                  {/* Filter Tabs */}
                  <div
                    className="filterBar"
                    role="tablist"
                    aria-label="Filter evidence category"
                  >
                    {FILTERS.map((item) => {
                      const count =
                        item.id === "all"
                          ? receipt.evidence.length
                          : receipt.evidence.filter(
                              (evidenceItem) => evidenceItem.category === item.id
                            ).length;
                      if (item.id !== "all" && count === 0) return null;
                      return (
                        <button
                          key={item.id}
                          className={filter === item.id ? "active" : ""}
                          type="button"
                          role="tab"
                          aria-selected={filter === item.id}
                          onClick={() => setFilter(item.id)}
                        >
                          {item.label}
                          <span className="tabBadge">{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Evidence Cards */}
                  <div className="evidenceGrid">
                    {filteredEvidence.map((item, index) => (
                      <details
                        className={`evidenceCard status-${item.status}`}
                        key={item.id}
                        open={index === 0}
                      >
                        <summary>
                          <span className="statusIcon" aria-hidden="true" />
                          <span className="evidenceTitle">
                            <span className="categoryName">
                              {categoryLabel(item.category)}
                            </span>
                            <strong>{item.label}</strong>
                            <small>{item.claim}</small>
                          </span>
                          <span className="statusBadge">
                            {statusLabel(item.status)}
                          </span>
                          <span className="chevron" aria-hidden="true">⌄</span>
                        </summary>

                        <div className="evidenceBody">
                          {item.facts && Object.keys(item.facts).length > 0 && (
                            <div className="factsGrid">
                              {Object.entries(item.facts).map(
                                ([label, value]) => (
                                  <div key={label} className="factItem">
                                    <span className="factLabel">{label}</span>
                                    <strong className="factValue">{displayFact(value)}</strong>
                                  </div>
                                )
                              )}
                            </div>
                          )}

                          <div className="technicalRow">
                            <div>
                              <span>Source method</span>
                              <code>
                                {item.source} · {item.method}
                              </code>
                            </div>
                            <div>
                              <span>Evidence ID</span>
                              <code>{item.id}</code>
                            </div>
                            <div>
                              <span>Observed at block</span>
                              <code>
                                #{Number(item.blockNumber).toLocaleString()}
                              </code>
                            </div>
                            <a
                              href={item.referenceUrl || item.explorerUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inspectSourceLink"
                            >
                              Inspect source ↗
                            </a>
                          </div>

                          {item.limitations.length > 0 && (
                            <div className="limitations">
                              <strong>What this evidence does not prove</strong>
                              <ul>
                                {item.limitations.map((text) => (
                                  <li key={text}>{text}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Receipt Footer */}
            <div className="receiptFooter">
              <div className="footerNoteGroup">
                <span className="footerAlertIcon" aria-hidden="true">
                  🛡️
                </span>
                <p>
                  <strong>Decision support, not a guarantee.</strong>{" "}
                  {receipt.limitations.join(" ")}
                </p>
              </div>
              <button
                type="button"
                className="ghostBtn startNewScanBtn"
                onClick={() => {
                  setReceipt(null);
                  setAddress("");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                Scan another address ↑
              </button>
            </div>
          </section>
        )}

        {/* Pop-Up & Signature Inspector Section */}
        <section id="popup-inspector" className="shell">
          <PopupInspector />
        </section>

        {/* Methodology Section */}
        <section className="method shell" id="method" aria-label="Shield Methodology">
          <div className="methodIntro">
            <div className="eyebrow">
              <span /> Verifiable Architecture
            </div>
            <h2>Not a black-box risk score.</h2>
            <p>
              Shield separates observed on-chain facts, deterministic rules, and known limitations so you can audit how every verdict was produced.
            </p>
          </div>

          <div className="steps">
            <article className="stepCard">
              <span className="stepNum">01</span>
              <div className="stepIcon" aria-hidden="true">⌁</div>
              <h3>Classify</h3>
              <p>Detect a wallet or contract from bytecode at a specific Base block.</p>
            </article>

            <article className="stepCard">
              <span className="stepNum">02</span>
              <div className="stepIcon" aria-hidden="true">◫</div>
              <h3>Collect</h3>
              <p>Read RPC state, verified source metadata, deployment, and recent activity.</p>
            </article>

            <article className="stepCard">
              <span className="stepNum">03</span>
              <div className="stepIcon" aria-hidden="true">◇</div>
              <h3>Evaluate</h3>
              <p>Apply public, versioned rules. Missing data blocks a low-risk conclusion.</p>
            </article>

            <article className="stepCard">
              <span className="stepNum">04</span>
              <div className="stepIcon" aria-hidden="true">↧</div>
              <h3>Prove</h3>
              <p>Export a receipt with source methods, blocks, facts, and limitations.</p>
            </article>
          </div>

          <div className="providerStrip" aria-label="Provider health and indexing status">
            <div>
              <span className={`providerDot ${health?.ok ? "online" : ""}`} aria-hidden="true" />
              <p>
                <strong>Base JSON-RPC</strong>
                <small>{health?.ok ? `${health.latencyMs} ms · connected` : "Checking connection"}</small>
              </p>
            </div>
            <div>
              <span
                className={`providerDot ${
                  health?.services?.sourceMetadata === "configured" && health?.services?.indexedHistory === "configured"
                    ? "online"
                    : "waiting"
                }`}
                aria-hidden="true"
              />
              <p>
                <strong>Indexed Evidence</strong>
                <small>
                  {health?.services?.sourceMetadata === "configured" && health?.services?.indexedHistory === "configured"
                    ? "Etherscan source + Blockscout history"
                    : health?.services?.sourceMetadata === "configured"
                    ? "Source ready · Blockscout history ready"
                    : "Open indexers active"}
                </small>
              </p>
            </div>
            <p className="providerNotice">Provider failures become explicit unavailable evidence — never passed checks.</p>
          </div>
        </section>
      </main>

      {/* Floating Chat Dock (Slide-over drawer + Bottom-Right Launcher Button) */}
      <AgentCopilot
        receipt={receipt ?? undefined}
        isOpen={isChatDockOpen}
        onOpen={() => setIsChatDockOpen(true)}
        onClose={() => setIsChatDockOpen(false)}
        initialQuestion={selectedQuestion}
        onClearInitialQuestion={() => setSelectedQuestion("")}
      />

      {/* Footer */}
      <footer className="shell footerSection" role="contentinfo">
        <div className="footerTopRow">
          <div className="brand">
            <ShieldLogo size={28} />
            <span>SHIELD</span>
          </div>
          <p className="footerMotto">Open evidence for safer decisions on Base Mainnet.</p>
        </div>

        <div className="footerBottomRow">
          <div className="footerSocialLinks">
            <a
              href="https://github.com/BeastkingX/shield-base-agent"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub Repository"
              className="socialLink"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              <span>GitHub</span>
            </a>
            <a
              href="https://x.com/ShieldBaseAgent"
              target="_blank"
              rel="noreferrer"
              aria-label="X Profile"
              className="socialLink"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span>X (Twitter)</span>
            </a>
            <a
              href="https://t.me/shieldbaseagent"
              target="_blank"
              rel="noreferrer"
              aria-label="Telegram Community"
              className="socialLink"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.121l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.832.942z" />
              </svg>
              <span>Telegram</span>
            </a>
            <Link href="/verify" className="socialLink">
              <span>Verifier Portal</span>
            </Link>
          </div>
          <span className="versionTag">v0.3.0</span>
        </div>
      </footer>

      {/* Protected Send Modal */}
      {showProtectedSend && (
        <ProtectedSendModal
          isOpen={showProtectedSend}
          onClose={() => setShowProtectedSend(false)}
          senderAddress={connectedAccount || ""}
          provider={getInjectedWallet()?.provider ?? null}
        />
      )}

      {/* Scam Reporting Modal */}
      {showReportModal && (
        <ReportWalletModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          initialAddress={reportTargetAddress}
          reporterAddress={connectedAccount}
        />
      )}
    </div>
  );
}
