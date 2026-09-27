import type { Page } from "playwright";
import type { Config } from "./config.js";
import { log } from "./logger.js";
import type { PurchaserVerification } from "./checkout.js";
import { escapeRegex, UI_TIMEOUT, waitAndClick } from "./utils.js";

export async function selectPaymentMethod(page: Page, config: Config): Promise<void> {
  const name = config.paymentMethod === "QRIS" ? /qris/i : /virtual account|\bva\b/i;
  const controls = [
    page.getByRole("button", { name }).first(),
    page.getByRole("radio", { name }).first(),
    page.getByText(name).first()
  ];
  for (const control of controls) {
    if (await control.isVisible().catch(() => false)) {
      await waitAndClick(control, `Selecting ${config.paymentMethod}`);
      const pay = page.getByRole("button", { name: /^(bayar|pay)$/i });
      if (await pay.count() !== 1) throw new Error("Expected exactly one Bayar button after selecting QRIS.");
      let enabled = false;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        if (await pay.isEnabled()) {
          enabled = true;
          break;
        }
        await page.waitForTimeout(100);
      }
      if (!enabled) {
        throw new Error("QRIS was clicked but Bayar did not become enabled.");
      }
      log("PAYMENT METHOD SELECTED: QRIS");
      return;
    }
  }
  throw new Error(`Payment method "${config.paymentMethod}" is unavailable.`);
}

export async function finishAtPayment(page: Page, config: Config, ticketName: string, quantity: number, purchaser: PurchaserVerification): Promise<never | void> {
  if (config.autoPay) {
    const body = await page.locator("body").innerText();
    const ticketSummary = new RegExp(`${escapeRegex(ticketName)}\\s*\\(x${quantity}\\)`, "i");
    if (quantity < 1 || purchaser.email !== config.email || purchaser.fullName !== config.fullName || purchaser.phone !== config.phone || !ticketSummary.test(body)) {
      throw new Error("Final validation failed: ticket, quantity, or previously verified purchaser details do not match configuration.");
    }
    const pay = page.getByRole("button", { name: /^(bayar|pay)$/i }).filter({ visible: true });
    if (await pay.count() !== 1) throw new Error("Final validation failed: expected exactly one Bayar button.");
    if (!(await pay.isEnabled())) throw new Error("Final validation failed: Bayar is not enabled after QRIS selection.");
    console.log("\n========================================\nFINAL VALIDATION PASSED\nSubmitting payment...\n========================================");
    await waitAndClick(pay, "Submitting final payment");
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
    return;
  }
  console.log("\n========================================");
  console.log("READY TO PAY");
  console.log(`Ticket: ${ticketName}`);
  console.log(`Quantity: ${quantity}`);
  console.log(`Email: ${config.email}`);
  console.log(`Payment: ${config.paymentMethod}`);
  console.log("AUTO_PAY=false");
  console.log("Please inspect the browser and click Bayar manually.");
  console.log("========================================\n");
  log("CHECKOUT READY");
  return new Promise<never>(() => undefined);
}
