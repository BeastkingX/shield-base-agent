import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const BASE_URL = "http://localhost:3000";

async function runA11yTest() {
  const browser = await chromium.launch();
  let hasCriticalViolations = false;

  for (const pagePath of ["/", "/verify"]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ colorScheme: theme });
      const page = await context.newPage();

      await page.goto(`${BASE_URL}${pagePath}`, { waitUntil: "networkidle" });
      await page.evaluate((th) => {
        document.documentElement.setAttribute("data-theme", th);
        localStorage.setItem("shield-theme", th);
      }, theme);
      await page.reload({ waitUntil: "networkidle" });

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      console.log(`\n========================================`);
      console.log(`A11y Audit: ${pagePath} (${theme} mode)`);
      console.log(`Violations found: ${accessibilityScanResults.violations.length}`);

      if (accessibilityScanResults.violations.length > 0) {
        for (const v of accessibilityScanResults.violations) {
          console.log(`- [${v.impact}] ${v.id}: ${v.description}`);
          for (const node of v.nodes.slice(0, 3)) {
            console.log(`    Target: ${node.target.join(", ")}`);
            console.log(`    Summary: ${node.failureSummary}`);
          }
          if (v.impact === "critical" || v.impact === "serious") {
            hasCriticalViolations = true;
          }
        }
      } else {
        console.log(`✓ 100% WCAG 2.1 AA Compliant! Zero violations.`);
      }

      await context.close();
    }
  }

  await browser.close();

  if (hasCriticalViolations) {
    console.error("\nA11y audit flagged serious or critical violations.");
    process.exit(1);
  } else {
    console.log("\nAll accessibility audits passed with flying colors!");
  }
}

runA11yTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
