import type { Page } from "playwright";
import type { Config } from "./config.js";
import { assertNoManualChallenge, UI_TIMEOUT, waitAndClick } from "./utils.js";
import { log } from "./logger.js";
import { waitForManualLoginIfRequired } from "./session.js";

export async function openEvent(page: Page, config: Config): Promise<void> {
  log("Opening event");
  await page.goto(config.eventUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (await waitForManualLoginIfRequired(page)) {
    // Return to the event through normal UI navigation after the user signs in.
    await page.goto(config.eventUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  // TiketMart keeps background connections open, so networkidle often burns its full timeout.
  await Promise.any(selectTicketsControls(page).map(control => control.waitFor({ state: "visible", timeout: UI_TIMEOUT })));
  await assertNoManualChallenge(page);
}

export function selectTicketsControls(page: Page) {
  return [
    page.getByRole("button", { name: /select tickets|pilih tiket/i }).first(),
    page.getByRole("link", { name: /select tickets|pilih tiket/i }).first(),
    page.locator("button, a").filter({ hasText: /select tickets|pilih tiket/i }).first()
  ];
}

export async function openTicketSelection(page: Page): Promise<boolean> {
  for (const control of selectTicketsControls(page)) {
    if (!(await control.isVisible().catch(() => false))) continue;
    if (!(await control.isEnabled().catch(() => false))) continue;
    await waitAndClick(control, "Opening ticket selection", UI_TIMEOUT);
    try {
      // TiketMart creates the order session before client-side category navigation.
      // This can take longer than ordinary UI interactions during busy sales periods.
      await page.waitForURL(/\/category(?:\?|$)/, { timeout: 30_000 });
    } catch {
      await assertNoManualChallenge(page);
      return false;
    }
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await assertNoManualChallenge(page);
    return true;
  }
  return false;
}
