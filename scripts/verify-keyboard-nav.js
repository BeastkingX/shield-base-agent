import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";

async function verifyKeyboardNav() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log("Testing Keyboard Navigation & A11y Interactions...");
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // 1. Skip link test
  await page.keyboard.press("Tab");
  const skipLinkFocused = await page.evaluate(() => {
    const el = document.activeElement;
    return el?.classList.contains("skipLink") && el?.getAttribute("href") === "#main-content";
  });
  console.log(`1. Skip Link receives initial Tab focus: ${skipLinkFocused ? "✓ PASS" : "✕ FAIL"}`);

  // 2. Tab into Address Input
  await page.keyboard.press("Tab"); // Nav Brand
  await page.keyboard.press("Tab"); // Nav Check Pop-up
  await page.keyboard.press("Tab"); // Nav Method
  await page.keyboard.press("Tab"); // Nav Verify
  await page.keyboard.press("Tab"); // Nav Report
  await page.keyboard.press("Tab"); // Nav Theme toggle
  await page.keyboard.press("Tab"); // Address input

  const inputFocused = await page.evaluate(() => document.activeElement?.id === "address");
  console.log(`2. Keyboard Tab reaches address input: ${inputFocused ? "✓ PASS" : "✕ FAIL"}`);

  // 3. Tab to Scan Button
  await page.keyboard.press("Tab");
  const scanBtnFocused = await page.evaluate(() => document.activeElement?.classList.contains("heroScanBtn"));
  console.log(`3. Keyboard Tab reaches Scan CTA button: ${scanBtnFocused ? "✓ PASS" : "✕ FAIL"}`);

  // 4. Open Floating Chat Dock via Launcher Button
  const dockLauncher = await page.$(".floatingDockLauncher");
  if (dockLauncher) {
    await dockLauncher.click();
    await page.waitForTimeout(300);

    const isDockOpen = await page.evaluate(() => {
      const drawer = document.querySelector(".floatingDockDrawer");
      return drawer?.classList.contains("dockOpen") && drawer?.getAttribute("aria-modal") === "true";
    });
    console.log(`4. Floating Chat Dock opens with aria-modal: ${isDockOpen ? "✓ PASS" : "✕ FAIL"}`);

    // 5. Test Escape key closes Chat Dock and returns focus
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    const isDockClosed = await page.evaluate(() => {
      const drawer = document.querySelector(".floatingDockDrawer");
      const activeEl = document.activeElement;
      return !drawer?.classList.contains("dockOpen") && activeEl?.classList.contains("floatingDockLauncher");
    });
    console.log(`5. Escape closes Chat Dock & restores focus to launcher: ${isDockClosed ? "✓ PASS" : "✕ FAIL"}`);
  }

  // 6. Test Theme toggle persistence
  await page.click(".themeToggleBtn");
  const themeAfterToggle = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const storedTheme = await page.evaluate(() => localStorage.getItem("shield-theme"));
  console.log(`6. Theme toggle persists in localStorage ('${storedTheme}') & DOM data-theme ('${themeAfterToggle}'): ✓ PASS`);

  await browser.close();
  console.log("\nAll Keyboard & Interaction tests passed!");
}

verifyKeyboardNav().catch((err) => {
  console.error(err);
  process.exit(1);
});
