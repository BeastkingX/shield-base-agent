import fs from "node:fs";
import path from "node:path";

/**
 * Live verdict log reader.
 *
 * The hourly `verdicts-log` CI workflow commits one JSON file per day to
 * `verdicts/`. This module reads those files, newest first, and never invents
 * entries: an unreadable or absent file is reported as such so the UI can say
 * the log is empty rather than showing fabricated history.
 */

export interface VerdictLogEntry {
  scannedAt: string;
  address: string;
  label: string;
  targetType: string;
  verdict: string;
  receiptId: string;
  receiptHash: string;
  blockNumber: string;
}

export interface VerdictLog {
  entries: VerdictLogEntry[];
  sourceSlug: string;
  usedYesterdayFallback: boolean;
}

/** Number of hourly entries the public log shows. */
export const VERDICT_LOG_LIMIT = 15;

const VERDICT_CLASSES: Record<string, string> = {
  "LOW OBSERVED RISK": "low-observed-risk",
  CAUTION: "caution",
  "HIGH OBSERVED RISK": "high-observed-risk",
  "INSUFFICIENT DATA": "insufficient-data",
};

/** CSS modifier for a verdict pill. Unknown verdicts get the muted style. */
export function verdictClass(verdict: string): string {
  return VERDICT_CLASSES[verdict] ?? "insufficient-data";
}

/** UTC `YYYY-MM-DD` slug, `offsetDays` back from today. */
export function daySlug(offsetDays: number, now: Date = new Date()): string {
  const day = new Date(now.getTime());
  day.setUTCDate(day.getUTCDate() - offsetDays);
  return day.toISOString().split("T")[0];
}

function isEntry(value: unknown): value is VerdictLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<VerdictLogEntry>;
  return (
    typeof candidate.scannedAt === "string" &&
    typeof candidate.verdict === "string" &&
    typeof candidate.address === "string"
  );
}

/** Reads one day's log, or null when the file is absent or unreadable. */
export function readDay(
  slug: string,
  directory: string = path.join(process.cwd(), "verdicts"),
): VerdictLogEntry[] | null {
  try {
    const file = path.join(directory, `${slug}.json`);
    if (!fs.existsSync(file)) return null;

    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return null;

    return parsed.filter(isEntry);
  } catch {
    return null;
  }
}

/**
 * Returns the latest entries, newest first, capped at `limit`. Falls back to
 * yesterday's file when today's is missing or empty.
 */
export function loadVerdictLog(
  options: {
    limit?: number;
    directory?: string;
    now?: Date;
  } = {},
): VerdictLog {
  const {
    limit = VERDICT_LOG_LIMIT,
    directory = path.join(process.cwd(), "verdicts"),
    now = new Date(),
  } = options;

  const todaySlug = daySlug(0, now);
  const yesterdaySlug = daySlug(1, now);

  const todayEntries = readDay(todaySlug, directory);
  const usedYesterdayFallback = todayEntries === null || todayEntries.length === 0;
  const entries =
    !usedYesterdayFallback && todayEntries
      ? todayEntries
      : (readDay(yesterdaySlug, directory) ?? []);

  const sorted = entries
    .slice()
    .sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt));

  return {
    entries: sorted.slice(0, limit),
    sourceSlug: usedYesterdayFallback ? yesterdaySlug : todaySlug,
    usedYesterdayFallback,
  };
}

/** `2026-08-28 11:18:30 UTC · 3h ago`. Returns the raw string if unparseable. */
export function formatLogTimestamp(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;

  const utc = new Date(time).toISOString().replace("T", " ").slice(0, 19);
  const minutesAgo = Math.max(0, Math.round((now - time) / 60_000));

  const age =
    minutesAgo < 60
      ? `${minutesAgo}m ago`
      : minutesAgo < 1440
        ? `${Math.round(minutesAgo / 60)}h ago`
        : `${Math.round(minutesAgo / 1440)}d ago`;

  return `${utc} UTC · ${age}`;
}
