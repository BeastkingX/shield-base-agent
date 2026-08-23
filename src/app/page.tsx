"use client";

import { FormEvent, useEffect, useState } from "react";
import type { EvidenceItem, ScanReceipt } from "@/lib/scan-types";

const DEMO_CONTRACT = "0x4200000000000000000000000000000000000006";

type Health = {
  ok: boolean;
  blockNumber?: string;
  latencyMs?: number;
};

function shortAddress(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function statusLabel(status: EvidenceItem["status"]): string {
  if (status === "pass") return "Passed";
  if (status === "warning") return "Review";
  if (status === "danger") return "High risk";
  if (status === "info") return "Observed";
  return "Unavailable";
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ScanReceipt | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setReceipt(null);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The scan failed.");
      setReceipt(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The scan failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <nav className="nav shell" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Shield home">
          <span className="brandMark" aria-hidden="true">S</span>
          <span>SHIELD</span>
        </a>
        <div className="networkPill">
          <span className={`networkDot ${health?.ok ? "online" : ""}`} />
          {health === null
            ? "Checking Base"
            : health.ok
              ? `Base live · block ${Number(health.blockNumber).toLocaleString()}`
              : "Base unavailable"}
        </div>
      </nav>

      <section className="hero shell" id="top">
        <div className="eyebrow"><span /> Evidence-first safety agent for Base</div>
        <h1>Know what the chain says<br />before you interact.</h1>
        <p className="heroCopy">
          Shield classifies any Base address, selects relevant checks, and creates
          a block-referenced receipt. The verdict comes from rules—not model opinion.
        </p>

        <form className="scanPanel" onSubmit={handleSubmit}>
          <label htmlFor="address">Base wallet or contract address</label>
          <div className="inputRow">
            <input
              id="address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              required
            />
            <button disabled={loading || !address.trim()} type="submit">
              {loading ? <><span className="spinner" />Scanning Base</> : "Run Shield scan"}
            </button>
          </div>
          <div className="formMeta">
            <button
              className="textButton"
              type="button"
              onClick={() => setAddress(DEMO_CONTRACT)}
            >
              Use WETH contract example
            </button>
            <span>No wallet connection required</span>
          </div>
          {error && <div className="errorBox" role="alert">{error}</div>}
        </form>

        <div className="trustRow" aria-label="Shield safety principles">
          <span>Live Base RPC</span>
          <span>Deterministic rules</span>
          <span>Inspect every finding</span>
          <span>No private keys</span>
        </div>
      </section>

      {receipt ? (
        <section className="results shell" aria-live="polite">
          <div className="resultHeader">
            <div>
              <div className="sectionLabel">Scan receipt</div>
              <h2>{shortAddress(receipt.address)}</h2>
              <div className="receiptMeta">
                <span>{receipt.targetType === "contract" ? "Smart contract" : "Wallet"}</span>
                <span>Block {Number(receipt.blockNumber).toLocaleString()}</span>
                <span>{receipt.receiptId}</span>
              </div>
            </div>
            <a
              className="explorerLink"
              href={`https://basescan.org/address/${receipt.address}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in BaseScan ↗
            </a>
          </div>

          <div className={`verdictCard verdict-${receipt.verdict.toLowerCase().replaceAll(" ", "-")}`}>
            <div>
              <div className="sectionLabel">Shield verdict</div>
              <h3>{receipt.verdict}</h3>
              <p>{receipt.summary}</p>
            </div>
            <div className="coverageRing" aria-label={`${receipt.coverage.completed} of ${receipt.coverage.total} checks completed`}>
              <strong>{receipt.coverage.completed}/{receipt.coverage.total}</strong>
              <span>checks</span>
            </div>
          </div>

          <div className="evidenceHeading">
            <div>
              <div className="sectionLabel">Evidence trail</div>
              <h3>What Shield observed</h3>
            </div>
            <p>Captured {new Date(receipt.scannedAt).toLocaleString()}</p>
          </div>

          <div className="evidenceGrid">
            {receipt.evidence.map((item, index) => (
              <details className={`evidenceCard status-${item.status}`} key={item.id} open={index < 2}>
                <summary>
                  <span className="statusIcon" aria-hidden="true" />
                  <span className="evidenceTitle">
                    <strong>{item.label}</strong>
                    <small>{item.method}</small>
                  </span>
                  <span className="statusBadge">{statusLabel(item.status)}</span>
                  <span className="chevron">⌄</span>
                </summary>
                <div className="evidenceBody">
                  <p>{item.claim}</p>
                  <dl>
                    <div><dt>Evidence ID</dt><dd>{item.id}</dd></div>
                    <div><dt>Source</dt><dd>{item.source}</dd></div>
                    <div><dt>Block</dt><dd>{Number(item.blockNumber).toLocaleString()}</dd></div>
                    <div><dt>Raw value</dt><dd>{String(item.rawValue ?? "Not available")}</dd></div>
                  </dl>
                  {item.limitations.length > 0 && (
                    <div className="limitations">
                      <strong>Limits of this check</strong>
                      <ul>{item.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>

          <div className="disclaimer">
            <strong>Read this before acting</strong>
            <p>{receipt.limitations.join(" ")}</p>
          </div>
        </section>
      ) : (
        <section className="how shell">
          <div className="sectionLabel">How one scan works</div>
          <div className="steps">
            <article><span>01</span><h2>Observe</h2><p>Capture the Base block and validate the target.</p></article>
            <article><span>02</span><h2>Plan</h2><p>Choose wallet or contract checks from live bytecode.</p></article>
            <article><span>03</span><h2>Verify</h2><p>Attach every claim to a method, value, and block.</p></article>
            <article><span>04</span><h2>Explain</h2><p>Apply versioned rules and expose every limitation.</p></article>
          </div>
        </section>
      )}

      <footer className="shell">
        <div className="brand"><span className="brandMark">S</span><span>SHIELD</span></div>
        <p>Decision support, not a safety guarantee. Built for Base.</p>
      </footer>
    </main>
  );
}
