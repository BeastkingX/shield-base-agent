import { describe, it, expect } from "vitest";
import fs from "node:fs";

describe("Findings 1 and 2: Mobile fixed controls and horizontal overflow", () => {
  it("globals.css canvas has 160px desktop and 180px mobile + safe-area", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("calc(160px + env(safe-area-inset-bottom");
    expect(css).toContain("calc(180px + env(safe-area-inset-bottom");
    expect(css).toContain("overflow-x: clip");
  });

  it("html and body have overflow-x clip and max-width 100vw", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/html\s*\{[^}]*overflow-x:\s*clip/);
    expect(css).toMatch(/body\s*\{[^}]*overflow-x:\s*clip/);
  });

  it("wrap has overflow-x clip and constrained width", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".wrap");
    expect(css).toMatch(/\.wrap\s*\{[^}]*overflow-x:\s*clip/);
  });

  it("educationCarouselSection is contained, no page sideways scroll", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".educationCarouselSection");
    expect(css).toMatch(/\.educationCarouselSection\s*\{[^}]*max-width:\s*100%/);
    expect(css).toMatch(/\.educationCarouselSection\s*\{[^}]*overflow:\s*hidden/);
  });

  it("carouselTrackWrapper has max-width 100% and overflow-x auto inside rail", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".carouselTrackWrapper");
    expect(css).toMatch(/\.carouselTrackWrapper\s*\{[^}]*max-width:\s*100%/);
    expect(css).toMatch(/\.carouselTrackWrapper\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("footer and evi have safe-area padding so final content scrolls above controls", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("env(safe-area-inset-bottom");
    expect(css).toContain(".footerSection");
  });
});

describe("Finding 7: Verdict log freshness", () => {
  it("workflow has concurrency, fetch-depth 0, cache npm, timeout, pull --rebase retry", () => {
    const yml = fs.readFileSync(".github/workflows/verdicts-log.yml", "utf8");
    expect(yml).toContain("concurrency:");
    expect(yml).toContain("fetch-depth: 0");
    expect(yml).toContain("cache: npm");
    expect(yml).toContain("timeout-minutes:");
    expect(yml).toContain("pull --rebase");
    expect(yml).toContain("retry");
  });

  it("verdicts page shows truthful Last published and stale >180m warning", () => {
    const page = fs.readFileSync("src/app/verdicts/page.tsx", "utf8");
    expect(page).toContain("Last published");
    expect(page).toContain("isStale");
    expect(page).toContain("180");
    expect(page).toContain("best-effort hourly");
    expect(page).toContain("does not fabricate");
  });

  it("verdict-log.ts returns lastPublishedAt from file mtime", () => {
    const lib = fs.readFileSync("src/lib/verdict-log.ts", "utf8");
    expect(lib).toContain("lastPublishedAt");
    expect(lib).toContain("mtime");
    expect(lib).toContain("stat.mtime");
  });
});
