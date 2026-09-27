import { chromium } from "playwright";
import { loadBrowserOptions, loadConfig } from "./config.js";
import { fillPurchaserInformation, acceptTerms, confirmEmailIfRequested, selectPaymentStep } from "./checkout.js";
import { openEvent, openTicketSelection } from "./event.js";
import { error, log } from "./logger.js";
import { selectPaymentMethod, finishAtPayment } from "./payment.js";
import { findTicketByName, openCheckout, setTicketQuantity } from "./ticket.js";
import { assertNoManualChallenge, randomPollingDelay, takeErrorScreenshot } from "./utils.js";
import { runLogin } from "./session.js";
import { inspectPage } from "./inspect.js";

async function run(): Promise<void> {
  const command = process.argv[2];
  const config = command === "login" || command === "inspect" ? undefined : loadConfig();
  const warMode = command === "war";
  const browser = config ?? loadBrowserOptions();
  const context = await chromium.launchPersistentContext(browser.browserProfile, {
    headless: browser.headless,
    viewport: { width: 1440, height: 1000 }
  });
  const page = context.pages()[0] ?? await context.newPage();

  try {
    if (command === "login") {
      await runLogin(page);
      return;
    }
    if (command === "inspect") {
      await page.goto("https://tiketmart.com/id/event/cmspi0x9z00sopg1b932ikko4", { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await inspectPage(page);
      if (await openTicketSelection(page)) await inspectPage(page);
      else log("Select Tickets is not currently available on the reference event.");
      return;
    }
    if (!config) throw new Error("Missing checkout configuration.");
    await openEvent(page, config);
    const selectAvailable = await openTicketSelection(page);
    if (!selectAvailable) {
      if (!warMode) throw new Error("Select Tickets is not currently available. Run npm run war to wait safely.");
      await waitForAvailability(page, config, true);
      return;
    }

    await continueCheckout(page, config, warMode);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    await takeErrorScreenshot(page, "checkout-error");
    error(message);
    await context.close();
    process.exitCode = 1;
  } finally {
    if (config?.dryRun || command === "inspect") await context.close().catch(() => undefined);
  }
}

async function waitForAvailability(page: import("playwright").Page, config: ReturnType<typeof loadConfig>, onEventPage: boolean): Promise<void> {
  let checksSinceReload = 0;
  while (true) {
    log("Checking ticket availability");
    await assertNoManualChallenge(page);
    if (onEventPage && await openTicketSelection(page)) {
      await continueCheckout(page, config, true);
      return;
    }
    if (!onEventPage) {
      const ticket = await findTicketByName(page, config.ticketName);
      if (ticket) {
        await continueCheckout(page, config, true);
        return;
      }
    }
    log("Waiting for ticket sales");
    await page.waitForTimeout(randomPollingDelay(config.pollMinMs, config.pollMaxMs));
    checksSinceReload += 1;
    if (checksSinceReload >= 3) {
      await page.reload({ waitUntil: "domcontentloaded" });
      checksSinceReload = 0;
    }
  }
}

async function continueCheckout(page: import("playwright").Page, config: ReturnType<typeof loadConfig>, warMode: boolean): Promise<void> {
  const ticket = await findTicketByName(page, config.ticketName, config.dryRun);
  if (!ticket) {
    if (!warMode) throw new Error(`Ticket "${config.ticketName}" was not found.`);
    await waitForAvailability(page, config, false);
    return;
  }
  if (!ticket.available) {
    log("DRY RUN: requested ticket card identified, but it is currently unavailable");
    return;
  }
  log("TARGET TICKET FOUND");
  if (config.dryRun) {
    console.log(`Ticket: ${ticket.name}\nQuantity: ${config.quantity}`);
    log("DRY RUN: ticket card identified; would select quantity and click Order");
    return;
  }
  const selectedQuantity = await setTicketQuantity(ticket, config);
  await openCheckout(page, config, ticket, selectedQuantity);
  await completePayment(page, config, ticket.name, selectedQuantity);
}

async function completePayment(page: import("playwright").Page, config: ReturnType<typeof loadConfig>, ticketName: string, quantity: number): Promise<void> {
  page.on("dialog", dialog => {
    const message = dialog.message();
    log(`Native dialog: ${message}`);
    if (/saya setuju|lanjut|continue|confirm|email/i.test(message)) void dialog.accept();
    else void dialog.dismiss();
  });
  await assertNoManualChallenge(page);
  const purchaser = await fillPurchaserInformation(page, config);
  await acceptTerms(page);
  await selectPaymentStep(page);
  await confirmEmailIfRequested(page, config.email);
  await assertNoManualChallenge(page);
  if (!/\/checkout\/payment/i.test(page.url())) {
    await page.waitForURL(/\/checkout\/payment/i, { timeout: 15_000 });
  }
  await selectPaymentMethod(page, config);
  await finishAtPayment(page, config, ticketName, quantity, purchaser);
}

void run();
