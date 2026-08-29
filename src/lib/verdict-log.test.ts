import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VERDICT_LOG_LIMIT,
  daySlug,
  formatLogTimestamp,
  loadVerdictLog,
  readDay,
  verdictClass,
} from "./verdict-log";

const NOW = new Date("2026-08-28T12:00:00.000Z");

function entry(overrides: Record<string, unknown> = {}) {
  return {
    scannedAt: "2026-08-28T11:18:30.337Z",
    address: "0x4200000000000000000000000000000000000006",
    label: "Base WETH9 Predeploy",
    targetType: "contract",
    verdict: "LOW OBSERVED RISK",
    receiptId: "shield_test",
    receiptHash: "0xabc123",
    blockNumber: "50563283",
    ...overrides,
  };
}

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shield-verdicts-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeDay(slug: string, rows: unknown[]) {
  fs.writeFileSync(path.join(tempDir, `${slug}.json`), JSON.stringify(rows), "utf8");
}

describe("daySlug", () => {
  it("produces UTC day slugs and steps back by offset", () => {
    expect(daySlug(0, NOW)).toBe("2026-08-28");
    expect(daySlug(1, NOW)).toBe("2026-08-27");
  });
});

describe("readDay", () => {
  it("returns null for a missing file instead of inventing entries", () => {
    expect(readDay("1999-01-01", tempDir)).toBeNull();
  });

  it("returns null for a malformed file", () => {
    fs.writeFileSync(path.join(tempDir, "2026-08-28.json"), "{not json", "utf8");
    expect(readDay("2026-08-28", tempDir)).toBeNull();
  });

  it("drops entries that are missing required fields", () => {
    writeDay("2026-08-28", [entry(), { verdict: "CAUTION" }, null, "junk"]);
    expect(readDay("2026-08-28", tempDir)).toHaveLength(1);
  });
});

describe("loadVerdictLog", () => {
  it("uses today's file, newest first, capped at the limit", () => {
    const rows = Array.from({ length: VERDICT_LOG_LIMIT + 5 }, (_, index) =>
      entry({
        scannedAt: `2026-08-28T${String(index).padStart(2, "0")}:00:00.000Z`,
        receiptId: `shield_${index}`,
      }),
    );
    writeDay(daySlug(0, NOW), rows);

    const log = loadVerdictLog({ directory: tempDir, now: NOW });

    expect(log.usedYesterdayFallback).toBe(false);
    expect(log.sourceSlug).toBe("2026-08-28");
    expect(log.entries).toHaveLength(VERDICT_LOG_LIMIT);
    // Newest first: 20 rows were written with hours 00..19, so hour 19 is newest.
    expect(log.entries[0]?.scannedAt).toBe("2026-08-28T19:00:00.000Z");
    expect(
      Date.parse(log.entries[0]!.scannedAt),
    ).toBeGreaterThan(Date.parse(log.entries[1]!.scannedAt));
  });

  it("falls back to yesterday when today's file is missing", () => {
    writeDay(daySlug(1, NOW), [entry({ scannedAt: "2026-08-27T09:13:00.000Z" })]);

    const log = loadVerdictLog({ directory: tempDir, now: NOW });

    expect(log.usedYesterdayFallback).toBe(true);
    expect(log.sourceSlug).toBe("2026-08-27");
    expect(log.entries).toHaveLength(1);
  });

  it("falls back to yesterday when today's file is empty", () => {
    writeDay(daySlug(0, NOW), []);
    writeDay(daySlug(1, NOW), [entry()]);

    const log = loadVerdictLog({ directory: tempDir, now: NOW });

    expect(log.usedYesterdayFallback).toBe(true);
    expect(log.sourceSlug).toBe("2026-08-27");
    expect(log.entries).toHaveLength(1);
  });

  it("reports an empty log rather than fabricating history", () => {
    const log = loadVerdictLog({ directory: tempDir, now: NOW });

    expect(log.entries).toEqual([]);
    expect(log.sourceSlug).toBe(daySlug(1, NOW));
    expect(log.usedYesterdayFallback).toBe(true);
  });
});

describe("verdictClass", () => {
  it("maps every published verdict to a colour modifier", () => {
    expect(verdictClass("LOW OBSERVED RISK")).toBe("low-observed-risk");
    expect(verdictClass("CAUTION")).toBe("caution");
    expect(verdictClass("HIGH OBSERVED RISK")).toBe("high-observed-risk");
    expect(verdictClass("INSUFFICIENT DATA")).toBe("insufficient-data");
  });

  it("falls back to the muted style for an unrecognised verdict", () => {
    expect(verdictClass("SOMETHING NEW")).toBe("insufficient-data");
  });
});

describe("formatLogTimestamp", () => {
  it("renders UTC time plus a human age", () => {
    // Exactly 42 minutes apart, so the rounding is not ambiguous.
    expect(
      formatLogTimestamp("2026-08-28T11:18:00.000Z", Date.parse("2026-08-28T12:00:00.000Z")),
    ).toBe("2026-08-28 11:18:00 UTC · 42m ago");
  });

  it("passes an unparseable value through instead of guessing", () => {
    expect(formatLogTimestamp("not-a-date")).toBe("not-a-date");
  });
});

describe("the committed verdicts directory", () => {
  it("reads the real log files the CI workflow publishes", () => {
    const directory = path.join(process.cwd(), "verdicts");
    const files = fs
      .readdirSync(directory)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort();

    expect(files.length).toBeGreaterThan(0);

    const newestSlug = files[files.length - 1]!.replace(".json", "");
    const rows = readDay(newestSlug, directory);

    expect(rows).not.toBeNull();
    expect(rows!.length).toBeGreaterThan(0);
    for (const row of rows!) {
      expect(row.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(["contract", "wallet"]).toContain(row.targetType);
      expect(verdictClass(row.verdict)).not.toBe("");
    }
  });
});
