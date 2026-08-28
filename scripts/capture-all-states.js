import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const SCREENSHOT_DIR = path.resolve("./screenshots");
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const BASE_URL = "http://localhost:3000";

async function run() {
  const browser = await chromium.launch();

  const viewports = [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ];

  for (const vp of viewports) {
    for (const theme of ["dark", "light"]) {
      console.log(`\nCapturing for Viewport: ${vp.name}, Theme: ${theme}`);
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

      // 2. Scan Clean EOA (LOW OBSERVED RISK verdict)
      await page.fill("#address", "0xa37bA80bA292F3EFA1387468A676660C6e6a5f96");
      await page.click(".cta");
      await page.waitForSelector(".verdict-low-observed-risk", { timeout: 20000 });
      await page.waitForTimeout(600);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-02-verdict-clean.png`),
      });

      // 3. Scan Vitalik (CAUTION verdict)
      await page.fill("#address", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      await page.click(".cta");
      await page.waitForSelector(".verdict-caution", { timeout: 20000 });
      await page.waitForTimeout(600);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-03-verdict-caution.png`),
      });

      // 4. Evidence section
      const evidenceEl = await page.$(".evi");
      if (evidenceEl) {
        await evidenceEl.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-04-evidence.png`),
        });
      }

      // 5. Pop-Up Inspector
      const popupEl = await page.$("#popup-inspector");
      if (popupEl) {
        await popupEl.scrollIntoViewIfNeeded();
        await page.click(".cleanDemo");
        await page.waitForSelector(".inspectionResultCard", { timeout: 10000 });
        await page.waitForTimeout(500);
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-05-popup-inspector.png`),
        });
      }

      // 6. Floating Chat Dock
      await page.click(".dockbtn");
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-06-chat-dock.png`),
      });

      // 7. Verify Portal (Green Authentic Match)
      await page.goto(`${BASE_URL}/verify`, { waitUntil: "networkidle" });
      await page.evaluate((th) => {
        document.documentElement.setAttribute("data-theme", th);
      }, theme);
      await page.click(".samplePill:first-of-type");
      await page.waitForSelector(".resultMatch", { timeout: 5000 });
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${vp.name}-${theme}-07-verify-page.png`),
      });

      await context.close();
    }
  }

  await browser.close();
  console.log("\nAll comprehensive screenshots captured!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
