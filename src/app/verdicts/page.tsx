import Link from "next/link";
import type { Metadata } from "next";
import ShieldLogo from "@/components/ShieldLogo";
import Icon from "@/components/Icon";
import {
  formatLogTimestamp,
  loadVerdictLog,
  verdictClass,
} from "@/lib/verdict-log";

/**
 * Live verdict log.
 *
 * Renders the same daily JSON files that the hourly `verdicts-log` CI workflow
 * commits to `verdicts/`. Publishing Shield's own scan history means a stopped
 * or silent log is visible here instead of hidden.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shield — Live verdict log",
  description:
    "Hourly automated re-scans of the Shield watchlist on Base Mainnet, with receipt digests you can verify yourself.",
};

export default function VerdictsPage() {
  const { entries, sourceSlug, usedYesterdayFallback } = loadVerdictLog();
  const newest = entries[0]?.scannedAt ?? null;

  return (
    <div className="canvas">
      <div className="wrap">
        <nav aria-label="Primary navigation">
          <Link className="brand" href="/" aria-label="Shield home">
            <ShieldLogo size={32} />
            <span>SHIELD</span>
          </Link>
          <div className="navlinks">
            <Link href="/" className="navbtn">
              Scan
            </Link>
            <Link href="/verify" className="navbtn">
              Verify
            </Link>
          </div>
        </nav>

        <section className="verdictLogSection" aria-label="Live verdict log">
          <span className="eyebrow">
            <Icon name="receipt" size={12} /> Published scan history
          </span>
          <h1>Live verdict log</h1>
          <p className="sub">
            An automated workflow re-scans the Shield watchlist on Base Mainnet
            every hour and commits the verdicts here. Showing the latest{" "}
            {entries.length} entries from <span className="mono">{sourceSlug}</span>
            {usedYesterdayFallback && (
              <>
                {" "}
                (today&rsquo;s file is not present yet, so yesterday&rsquo;s log is
                shown)
              </>
            )}
            .
          </p>

          <p className="verdictLogNote">
            &ldquo;We publish our own scan history hourly. A silent log would
            itself be reported as an incident.&rdquo;
          </p>

          {entries.length === 0 ? (
            <p className="errorBox" role="status">
              No verdict entries could be read from the log. Shield does not
              publish a fabricated history: check again after the next hourly run,
              or inspect the <span className="mono">verdicts/</span> directory in
              the repository.
            </p>
          ) : (
            <>
              <ul className="verdictLogList">
                {entries.map((entry) => (
                  <li
                    className="verdictLogRow"
                    key={`${entry.receiptId}-${entry.scannedAt}`}
                  >
                    <span className="verdictLogTime">
                      {formatLogTimestamp(entry.scannedAt)}
                    </span>

                    <span className="verdictLogTarget">
                      {entry.label}
                      <small>
                        {entry.address} · block #
                        {Number(entry.blockNumber).toLocaleString()} ·{" "}
                        {entry.targetType}
                      </small>
                    </span>

                    <span className="verdictPillWrap">
                      <span className={`verdictPill ${verdictClass(entry.verdict)}`}>
                        {entry.verdict}
                      </span>
                      {entry.receiptHash && entry.receiptHash !== "n/a" && (
                        <Link
                          className="verdictLogMeta"
                          href={`/verify?hash=${encodeURIComponent(entry.receiptHash)}`}
                        >
                          {entry.receiptHash.slice(0, 10)}…
                          {entry.receiptHash.slice(-6)}
                        </Link>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="verdictLogMeta">
                Newest entry: {newest ? formatLogTimestamp(newest) : "unknown"}.
                Digests link to the verifier, where you can recompute a digest from
                a receipt you hold and compare.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
