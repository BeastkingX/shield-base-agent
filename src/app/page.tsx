"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const DEMO_CONTRACT = "0x4200000000000000000000000000000000000006";
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
  const [copied, setCopied] = useState<"address" | "receipt" | "">("");
  const [connectedAccount, setConnectedAccount] = useState<string | null>(null);
  const [showSelfTechnicalEvidence, setShowSelfTechnicalEvidence] = useState(false);
  const [showProtectedSend, setShowProtectedSend] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTargetAddress, setReportTargetAddress] = useState("");
  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  useEffect(() => {
    if (!loading) return;
    const timers = [
      window.setTimeout(() => setScanStage(1), 700),
      window.setTimeout(() => setScanStage(2), 1800),
      window.setTimeout(() => setScanStage(3), 3400),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [loading]);

  const filteredEvidence = useMemo(() => {
    if (!receipt || filter === "all") return receipt?.evidence || [];
    return receipt.evidence.filter((item) => item.category === filter);
  }, [receipt, filter]);

  const runScan = useCallback(async (target: string) => {
    setScanStage(0);
    setLoading(true);
    setError("");
    setFilter("all");

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: target }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The scan failed.");
      setReceipt(data);
      // Auto-scroll directly to results smoothly
      window.setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The scan failed.");
    } finally {
      setLoading(false);
    }
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

  async function copyText(value: string, type: "address" | "receipt") {
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

  return (
    <main>
      <nav className="nav shell" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Shield home">
          <ShieldLogo size={34} />
          <span>SHIELD</span>
        </a>
        <div className="navRight">
          <button
            type="button"
            className="reportHeaderActionBtn"
            onClick={() => {
              setReportTargetAddress(address || receipt?.address || "");
              setShowReportModal(true);
            }}
          >
            🚩 Report Scam
          </button>
          <a href="#method">Method</a>
          <a href="https://github.com/BeastkingX/shield-base-agent" target="_blank" rel="noreferrer">GitHub</a>
          <div className="networkPill">
            <span className={`networkDot ${health?.ok ? "online" : ""}`} />
            {health === null
              ? "Checking Base"
              : health.ok
                ? `Base · ${Number(health.blockNumber).toLocaleString()}`
                : "Base unavailable"}
          </div>
        </div>
      </nav>

      <section className={`hero shell ${receipt ? "heroCompact" : ""}`} id="top">
        <div className="eyebrow"><span /> Evidence-first security on Base</div>
        <h1>Inspect the address.<br /><em>See the evidence.</em></h1>
        <p className="heroCopy">
          Enter any Base wallet or contract. Shield reads live chain data,
          checks indexed history, and explains a deterministic verdict.
          Connect your wallet to scan it automatically before you act.
        </p>

        <form className="scanPanel" onSubmit={handleSubmit}>
          <div className="scanLabelRow">
            <label htmlFor="address">Wallet or contract address</label>
            <span>Base Mainnet · Chain 8453</span>
          </div>
          <div className="inputRow">
            <span className="inputGlyph" aria-hidden="true">0x</span>
            <input
              id="address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Enter a 0x address"
              autoComplete="off"
              spellCheck={false}
              required
              aria-describedby={error ? "scan-error" : undefined}
            />
            <button disabled={loading || !address.trim()} type="submit">
              {loading ? <><span className="spinner" />Scanning</> : "Scan address"}
            </button>
          </div>

          <WalletPanel
            onAddress={handleWalletAddress}
            onDisconnect={handleWalletDisconnect}
            scanning={loading}
            onOpenSendModal={() => setShowProtectedSend(true)}
          />

          <div className="formMeta">
            <button
              className="textButton"
              type="button"
              onClick={() => {
                setAddress(DEMO_CONTRACT);
                runScan(DEMO_CONTRACT);
              }}
            >
              Try WETH on Base <span>→</span>
            </button>
            <span>·</span>
            <button
              className="textButton"
              type="button"
              onClick={() => {
                const addr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
                setAddress(addr);
                runScan(addr);
              }}
            >
              Try vitalik.eth (EIP-7702) <span>→</span>
            </button>
            <span>·</span>
            <button
              className="textButton"
              type="button"
              onClick={() => {
                const addr = "0x7777777777777777777777777777777777777bad";
                setAddress(addr);
                runScan(addr);
              }}
            >
              Try Sweeper Bot Trap <span>→</span>
            </button>
            <span>·</span>
            <span>Read-only · Never signs or sends</span>
          </div>
          {loading && (
            <div className="scanProgress" role="status" aria-live="polite">
              <div className="progressTrack"><span style={{ width: `${(scanStage + 1) * 25}%` }} /></div>
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
              <div><strong>Scan could not complete</strong><span>{error}</span></div>
              <button type="submit">Try again</button>
            </div>
          )}
        </form>

        {!receipt && (
          <div className="trustRow" aria-label="Shield safety principles">
            <span>Live Base evidence</span>
            <span>Versioned rules</span>
            <span>Exportable receipts</span>
            <span>No signatures, ever</span>
          </div>
        )}
      </section>

      {receipt ? (
        <section className="results shell" ref={resultsRef} aria-live="polite">
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
              <div className="resultTopline">
                <div>
                  <span className="sectionLabel">Analysis complete</span>
                  <div className="addressLine">
                    <h2>{shortAddress(receipt.address)}</h2>
                    {connectedAccount?.toLowerCase() === receipt.address.toLowerCase() && (
                      <span className="connectedChip">Connected wallet</span>
                    )}
                    <button
                      className="iconButton"
                      type="button"
                      onClick={() => copyText(receipt.address, "address")}
                      aria-label="Copy full address"
                    >
                      {copied === "address" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p>Receipt {receipt.receiptId}</p>
                </div>
                <div className="resultActions">
                  <button
                    type="button"
                    style={{ color: "#e11d48" }}
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
                  >
                    BaseScan ↗
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(JSON.stringify(receipt, null, 2), "receipt")
                    }
                  >
                    {copied === "receipt" ? "Copied JSON" : "Copy receipt"}
                  </button>
                  <button
                    className="primaryAction"
                    type="button"
                    onClick={downloadReceipt}
                  >
                    Download JSON
                  </button>
                </div>
              </div>

              <div className={`verdictCard verdict-${verdictClass(receipt.verdict)}`}>
                <div className="verdictSignal" aria-hidden="true">
                  <span />
                </div>
                <div className="verdictCopy">
                  <span className="sectionLabel">Deterministic verdict</span>
                  <h3>{receipt.verdict}</h3>
                  <p>{receipt.summary}</p>
                  <div className="ruleLine">
                    Rule engine v{receipt.riskEngineVersion} ·{" "}
                    {receipt.firedRules.map((rule) => rule.id).join(", ")}
                  </div>
                </div>
                <div className="coverageBox">
                  <strong>
                    {Math.round(
                      (receipt.coverage.completed / receipt.coverage.total) * 100
                    )}
                    %
                  </strong>
                  <span>evidence coverage</span>
                  <div>
                    <i
                      style={{
                        width: `${
                          (receipt.coverage.completed / receipt.coverage.total) *
                          100
                        }%`,
                      }}
                    />
                  </div>
                  <small>
                    {receipt.coverage.completed} completed ·{" "}
                    {receipt.coverage.unavailable} unavailable
                  </small>
                </div>
              </div>

              <div className="overviewGrid" aria-label="Scan overview">
                <article>
                  <span>Identity</span>
                  <strong>
                    {receipt.evidence.find((e) => e.id === "EVIDENCE_TARGET_TYPE")
                      ?.facts?.["Classification"] ||
                      (receipt.targetType === "contract"
                        ? "Smart contract"
                        : "Standard EOA wallet")}
                  </strong>
                  <small>Classified from live Base bytecode</small>
                </article>
                <article>
                  <span>Money Trail</span>
                  <strong
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
                <article>
                  <span>Token Exposure</span>
                  <strong>
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
                <article>
                  <span>Base Chain State</span>
                  <strong>Block #{Number(receipt.blockNumber).toLocaleString()}</strong>
                  <small>
                    {new Date(receipt.blockTimestamp).toLocaleTimeString()} · {new Date(receipt.blockTimestamp).toLocaleDateString()}
                  </small>
                </article>
              </div>

              <AgentCopilot receipt={receipt} />

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
                    {receipt.evidence.length} checks
                  </span>
                </div>

                <div
                  className="filterBar"
                  role="tablist"
                  aria-label="Filter evidence"
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
                        <span>{count}</span>
                      </button>
                    );
                  })}
                </div>

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
                        <span className="chevron">⌄</span>
                      </summary>
                      <div className="evidenceBody">
                        {item.facts && Object.keys(item.facts).length > 0 && (
                          <div className="factsGrid">
                            {Object.entries(item.facts).map(
                              ([label, value]) => (
                                <div key={label}>
                                  <span>{label}</span>
                                  <strong>{displayFact(value)}</strong>
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
                              {Number(item.blockNumber).toLocaleString()}
                            </code>
                          </div>
                          <a
                            href={item.referenceUrl || item.explorerUrl}
                            target="_blank"
                            rel="noreferrer"
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

          <div className="receiptFooter">
            <div>
              <span aria-hidden="true">!</span>
              <p>
                <strong>Decision support, not a guarantee.</strong>{" "}
                {receipt.limitations.join(" ")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setReceipt(null);
                setAddress("");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Start a new scan
            </button>
          </div>
        </section>
      ) : (
        <section className="method shell" id="method">
          <div className="methodIntro">
            <span className="sectionLabel">Built for verifiability</span>
            <h2>Not a black-box risk score.</h2>
            <p>Shield separates observed facts, deterministic rules, and known limitations so you can audit how a verdict was produced.</p>
          </div>
          <div className="steps">
            <article><span>01</span><div className="stepIcon">⌁</div><h3>Classify</h3><p>Detect a wallet or contract from bytecode at a specific Base block.</p></article>
            <article><span>02</span><div className="stepIcon">◫</div><h3>Collect</h3><p>Read RPC state, verified source metadata, deployment, and recent activity.</p></article>
            <article><span>03</span><div className="stepIcon">◇</div><h3>Evaluate</h3><p>Apply public, versioned rules. Missing data blocks a low-risk conclusion.</p></article>
            <article><span>04</span><div className="stepIcon">↧</div><h3>Prove</h3><p>Export a receipt with source methods, blocks, facts, and limitations.</p></article>
          </div>
          <div className="providerStrip">
            <div><span className={`providerDot ${health?.ok ? "online" : ""}`} /><p><strong>Base RPC</strong><small>{health?.ok ? `${health.latencyMs} ms · connected` : "Checking connection"}</small></p></div>
            <div><span className={`providerDot ${health?.services?.sourceMetadata === "configured" && health?.services?.indexedHistory === "configured" ? "online" : "waiting"}`} /><p><strong>Indexed evidence</strong><small>{health?.services?.sourceMetadata === "configured" && health?.services?.indexedHistory === "configured" ? "Etherscan source + Blockscout history" : health?.services?.sourceMetadata === "configured" ? "Source ready · add Blockscout for history" : "Requires server API keys"}</small></p></div>
            <p>Provider failures become explicit unavailable evidence—not passed checks.</p>
          </div>
        </section>
      )}

      <footer className="shell">
        <div className="brand">
          <ShieldLogo size={28} />
          <span>SHIELD</span>
        </div>
        <p>Open evidence for safer decisions on Base.</p>
        <div>
          <a href="https://github.com/BeastkingX/shield-base-agent" target="_blank" rel="noreferrer">GitHub ↗</a>
          <span>v0.3.0</span>
        </div>
      </footer>

      {showProtectedSend && (
        <ProtectedSendModal
          isOpen={showProtectedSend}
          onClose={() => setShowProtectedSend(false)}
          senderAddress={connectedAccount || ""}
          provider={getInjectedWallet()?.provider ?? null}
        />
      )}

      {showReportModal && (
        <ReportWalletModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          initialAddress={reportTargetAddress}
          reporterAddress={connectedAccount}
        />
      )}
    </main>
  );
}
