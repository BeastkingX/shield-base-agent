import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const SCREENSHOT_DIR = path.resolve("./screenshots");
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const BASE_URL = "http://localhost:3000";
const INCIDENT_TARGET = "0x69620a2e27af4849bce5f70126ba1fc474c0e4a0";

async function run() {
  const browser = await chromium.launch();

  const viewports = [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ];

  for (const vp of viewports) {
    for (const theme of ["dark", "light"]) {
      console.log(`\nCapturing for Viewport: ${vp.name} (${vp.width}x${vp.height}), Theme: ${theme}`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: theme,
      });
      const page = await context.newPage();

      // Set theme in localStorage
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      await page.evaluate((th) => {
        document.documentElement.setAttribute("data-theme", th);
        localStorage.setItem("shield-theme", th);
      }, theme);
      await page.reload({ waitUntil: "networkidle" });

      // 1. Hero State
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-01-hero.png`),
      });
      console.log(`✓ ${vp.name}-${theme}-01-hero.png`);

      // 2. Scan Real Incident Target (0x69620a2e27af4849bce5f70126ba1fc474c0e4a0)
      await page.fill("#address", INCIDENT_TARGET);
      await page.click("button.cta");
      await page.waitForSelector(".verdict", { timeout: 35000 });
      await page.waitForTimeout(1000);

      // Verdict Banner
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-02-verdict-high-risk.png`),
      });
      console.log(`✓ ${vp.name}-${theme}-02-verdict-high-risk.png`);

      // 3. Evidence Trail Trophy Case (Severity Bar + Flagship Finding Card + One-line Rows)
      const evidenceEl = await page.$(".evi");
      if (evidenceEl) {
        await page.evaluate(() => {
          const el = document.querySelector(".evi");
          if (el) {
            const y = el.getBoundingClientRect().top + window.scrollY - 80;
            window.scrollTo({ top: y, behavior: "instant" });
          }
        });
        await page.waitForTimeout(500);

        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-03-evidence-trail.png`),
        });
        console.log(`✓ ${vp.name}-${theme}-03-evidence-trail.png`);

        // 3b. Evidence Trail with First Row Expanded
        const firstRow = await page.$(".evi details summary");
        if (firstRow) {
          await firstRow.click();
          await page.waitForTimeout(400);
        }
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-03b-evidence-expanded.png`),
        });
        console.log(`✓ ${vp.name}-${theme}-03b-evidence-expanded.png`);
      }

      // 4. Pop-Up Inspector
      const popupEl = await page.$("#popup-inspector");
      if (popupEl) {
        await page.evaluate(() => {
          const el = document.querySelector("#popup-inspector");
          if (el) {
            const y = el.getBoundingClientRect().top + window.scrollY - 80;
            window.scrollTo({ top: y, behavior: "instant" });
          }
        });
        await page.waitForTimeout(300);
        await page.click(".cleanDemo");
        await page.waitForSelector(".inspectionResultCard", { timeout: 10000 });
        await page.waitForTimeout(500);
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-04-popup-inspector.png`),
        });
        console.log(`✓ ${vp.name}-${theme}-04-popup-inspector.png`);
      }

      // 5. Floating Chat Dock
      await page.click(".dockbtn");
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-05-chat-dock.png`),
      });
      console.log(`✓ ${vp.name}-${theme}-05-chat-dock.png`);

      // 6. Verify Portal
      await page.goto(`${BASE_URL}/verify`, { waitUntil: "networkidle" });
      await page.evaluate((th) => {
        document.documentElement.setAttribute("data-theme", th);
      }, theme);
      await page.click(".samplePill:first-of-type");
      await page.waitForSelector(".resultMatch", { timeout: 5000 });
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-06-verify-page.png`),
      });
      console.log(`✓ ${vp.name}-${theme}-06-verify-page.png`);

      await context.close();
    }
  }

  await browser.close();
  console.log("\nAll comprehensive screenshots successfully captured!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
