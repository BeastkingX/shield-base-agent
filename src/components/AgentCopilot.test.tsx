import { describe, it, expect } from "vitest";
import fs from "node:fs";

describe("Finding 3: Duplicate Ask Shield launcher", () => {
  it("AgentCopilot.tsx does not render floatingDockLauncher (duplicate naked button)", () => {
    const content = fs.readFileSync("src/components/AgentCopilot.tsx", "utf8");
    expect(content).not.toContain("floatingDockLauncher");
    expect(content).not.toContain("launcherActive");
    expect(content).not.toContain("dockLabel");
    // Should mention single launcher lives in page.tsx
    expect(content.toLowerCase()).toContain("single launcher");
  });

  it("page.tsx renders only one Ask Shield launcher in .dock", () => {
    const content = fs.readFileSync("src/app/page.tsx", "utf8");
    // Count dockbtn occurrences in the dock div - should be exactly one button with Ask Shield
    const dockMatches = content.match(/className="dockbtn"/g) || [];
    expect(dockMatches.length).toBe(1);
    // Should not contain floatingDockLauncher
    expect(content).not.toContain("floatingDockLauncher");
    // Should contain docknote conditional
    expect(content).toContain("isChatDockOpen &&");
    expect(content).toContain("docknote");
  });

  it("globals.css defines only .dockbtn, not unstyled floatingDockLauncher", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".dockbtn");
    // floatingDockLauncher should not be styled (it was the naked button), but we ensure it's not present
    // If present, it should be hidden; but we already removed from component, so this checks no stray styles that would re-introduce duplicate
    const hasFloatingLauncherStyle = /\.floatingDockLauncher\s*\{/.test(css);
    expect(hasFloatingLauncherStyle).toBe(false);
  });
});
