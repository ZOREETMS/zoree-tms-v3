const { chromium } = require("playwright");

async function run() {
  const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // In dev, bypass auth overlay for UI smoke tests when credentials are not available.
    await page.evaluate(() => {
      const ov = document.getElementById("login-overlay");
      if (ov) ov.remove();
      window._isLoggedIn = true;
      document.body.style.overflow = "";
    });

    await page.evaluate(() => {
      if (typeof navigate === "function") navigate("orders");
      if (!Array.isArray(window.orders)) window.orders = [];

      const hasUnplanned = window.orders.some((o) => o && o.status === "Unplanned");
      const hasNonUnplanned = window.orders.some((o) => o && o.status !== "Unplanned");

      if (!hasUnplanned) {
        window.orders.unshift({
          id: "ORD-SMOKE-UNPLANNED",
          customer: "Smoke Test Co",
          origin: "Chicago, IL",
          dest: "Dallas, TX",
          weight: "12000",
          pieces: "8",
          commodity: "Test Goods",
          ready: "2026-03-24",
          due: "2026-03-27",
          status: "Unplanned",
          shipmentId: null,
        });
      }

      if (!hasNonUnplanned) {
        window.orders.unshift({
          id: "ORD-SMOKE-PLANNED",
          customer: "Smoke Test Co",
          origin: "Atlanta, GA",
          dest: "Phoenix, AZ",
          weight: "9000",
          pieces: "6",
          commodity: "Test Goods",
          ready: "2026-03-24",
          due: "2026-03-26",
          status: "Planned",
          shipmentId: "SHP-SMOKE-1",
        });
      }

      if (typeof renderOrders === "function") renderOrders();
    });

    await page.waitForSelector("#ord-tbody", { timeout: 15000 });

    const rows = page.locator("#ord-tbody tr");
    const rowCount = await rows.count();
    if (!rowCount) throw new Error("No order rows found.");

    const unplannedRow = rows.filter({ hasText: "Unplanned" }).first();
    if (!(await unplannedRow.count())) {
      throw new Error("No Unplanned order found for smoke test.");
    }

    const cancelBtn = unplannedRow.locator('button[title="Cancel order"]').first();
    if (!(await cancelBtn.count())) {
      throw new Error("Cancel button is missing on an Unplanned order.");
    }

    const nonUnplannedRow = rows
      .filter({
        hasNotText: "Unplanned",
      })
      .first();

    if (await nonUnplannedRow.count()) {
      const nonUnplannedCancelCount = await nonUnplannedRow
        .locator('button[title="Cancel order"]')
        .count();
      if (nonUnplannedCancelCount > 0) {
        throw new Error("Cancel button should not appear on non-Unplanned orders.");
      }
    }

    const rowText = await unplannedRow.innerText();
    const idMatch = rowText.match(/\bORD-[A-Za-z0-9-]+\b/);
    const orderId = idMatch ? idMatch[0] : "(unknown)";

    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await cancelBtn.click();

    const targetRow = page.locator("#ord-tbody tr", { hasText: orderId }).first();
    if (orderId !== "(unknown)" && (await targetRow.count())) {
      await targetRow.waitFor({ state: "visible", timeout: 10000 });
      const updatedText = await targetRow.innerText();
      if (!updatedText.includes("Cancelled")) {
        throw new Error(`Order ${orderId} did not move to Cancelled status.`);
      }
      const stillHasCancel = await targetRow.locator('button[title="Cancel order"]').count();
      if (stillHasCancel > 0) {
        throw new Error(`Order ${orderId} still shows Cancel button after cancellation.`);
      }
    } else {
      // Row can move due to sorting/filtering; fallback global check.
      await page.waitForTimeout(1500);
      const cancelledCount = await rows.filter({ hasText: "Cancelled" }).count();
      if (cancelledCount < 1) {
        throw new Error("Did not find any Cancelled order after cancelling.");
      }
    }

    console.log(`PASS: cancel-order smoke test succeeded. Tested order: ${orderId}`);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
