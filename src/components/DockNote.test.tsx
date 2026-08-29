import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

/**
 * Minimal reproduction of the dock logic from src/app/page.tsx
 * Bug: "grounded in the receipt (never guesses)" appeared while chat closed.
 * Fix: {isChatDockOpen && <span className="docknote">...}
 */

function Dock({ isChatDockOpen }: { isChatDockOpen: boolean }) {
  return (
    <div className="dock">
      {isChatDockOpen && (
        <span className="docknote">grounded in the receipt (never guesses)</span>
      )}
      <button className="dockbtn">Ask Shield</button>
    </div>
  );
}

function render(isOpen: boolean): string {
  return renderToStaticMarkup(<Dock isChatDockOpen={isOpen} />);
}

describe("Dock note visibility (UI bug fix)", () => {
  it("hides the dock note completely while chat is closed", () => {
    const htmlClosed = render(false);
    expect(htmlClosed).not.toContain("grounded in the receipt");
    expect(htmlClosed).not.toContain("docknote");
    // Button must still be visible
    expect(htmlClosed).toContain("Ask Shield");
  });

  it("shows the dock note when chat is open", () => {
    const htmlOpen = render(true);
    expect(htmlOpen).toContain("grounded in the receipt (never guesses)");
    expect(htmlOpen).toContain("docknote");
  });

  it("source file page.tsx uses conditional rendering", async () => {
    const fs = await import("node:fs");
    const content = fs.readFileSync("src/app/page.tsx", "utf8");
    // Must contain the fix pattern
    expect(content).toContain("isChatDockOpen &&");
    expect(content).toMatch(/\{isChatDockOpen && \([\s\S]*?docknote/);
    // Must NOT contain unconditional docknote span without condition in the dock div
    // The old bug was <div className="dock"> <span className="docknote">
    const dockSection = content.match(/<div className="dock">[\s\S]*?<\/div>/)?.[0] || "";
    // In fixed version, docknote is inside conditional
    expect(dockSection).toContain("isChatDockOpen");
  });
});
