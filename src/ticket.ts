import type { Locator, Page } from "playwright";
import type { Config } from "./config.js";
import { log } from "./logger.js";
import { escapeRegex, pauseForManualAction, UI_TIMEOUT, waitAndClick } from "./utils.js";

export interface TicketMatch {
  name: string;
  card: Locator;
  available: boolean;
}

function ticketCardsForLabel(label: Locator): Locator[] {
  return [
    // Observed on the reference event: h3, ticket controls, and price share this card.
    label.locator("xpath=ancestor::div[.//h3 and .//button][1]"),
    label.locator("xpath=ancestor::div[.//h3][2]"),
    label.locator("xpath=ancestor-or-self::article[1]"),
    label.locator("xpath=ancestor-or-self::*[@role='listitem' or @role='group'][1]"),
    label.locator("xpath=ancestor::section[1]"),
    label.locator("xpath=ancestor::div[.//button or .//input][1]")
  ];
}

async function ticketCanBeSelected(card: Locator): Promise<boolean> {
  const quantityInput = card.locator('input[type="number"], input[aria-label*="quantity" i]').first();
  if (await quantityInput.isVisible().catch(() => false)) return true;
  const control = card.getByRole("button", { name: /pilih tiket|select ticket|select|add|increase|plus|\+/i }).first();
  return (await control.isVisible().catch(() => false)) && await control.isEnabled().catch(() => false);
}

export async function findTicketByName(page: Page, ticketName: string, allowUnavailable = false): Promise<TicketMatch | undefined> {
  const text = new RegExp(escapeRegex(ticketName), "i");
  // TiketMart renders ticket category names as h3 elements. Restricting this prevents
  // the event title in the order summary from being mistaken for a ticket category.
  const labels = page.locator("h3").filter({ hasText: text }).filter({ visible: true });
  const count = await labels.count();
  const matches: TicketMatch[] = [];

  for (let index = 0; index < count; index += 1) {
    const label = labels.nth(index);
    const name = (await label.innerText().catch(() => "")).trim();
    if (!name || !text.test(name)) continue;
    for (const card of ticketCardsForLabel(label)) {
      if (await card.isVisible().catch(() => false)) {
        const available = await ticketCanBeSelected(card);
        if (available || allowUnavailable) matches.push({ name, card, available });
        break;
      }
    }
  }

  if (matches.length > 1) {
    await pauseForManualAction(page, `Ticket name "${ticketName}" matched ${matches.length} visible ticket containers. Refusing to choose one.`);
  }
  return matches[0];
}

function quantityControl(card: Locator): Locator {
  return card.locator("div:has(> button + p + button)").first();
}

async function readQuantity(control: Locator): Promise<number> {
  const value = Number((await control.locator(":scope > p").innerText()).trim());
  if (!Number.isInteger(value) || value < 0) throw new Error("Ticket quantity display is invalid.");
  return value;
}

async function waitForQuantityChange(control: Locator, previous: number): Promise<number> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const current = await readQuantity(control);
    if (current !== previous) return current;
    await control.page().waitForTimeout(100);
  }
  return previous;
}

export async function setTicketQuantity(ticket: TicketMatch, config: Config): Promise<number> {
  if (!ticket.available) throw new Error(`Ticket "${ticket.name}" is currently unavailable.`);
  const cardText = (await ticket.card.innerText()).replace(/\s+/g, " ");
  if (!new RegExp(escapeRegex(ticket.name), "i").test(cardText)) {
    throw new Error("Ticket container verification failed; refusing to change quantity.");
  }

  const quantity = config.quantity;
  let numberInput = ticket.card.locator('input[type="number"], input[aria-label*="quantity" i]').first();
  if (await numberInput.isVisible().catch(() => false)) {
    await numberInput.fill(String(quantity));
    log(`Selecting quantity: ${quantity}`);
    return quantity;
  }

  const select = ticket.card.getByRole("button", { name: /pilih tiket|select ticket/i }).first();
  if (await select.isVisible().catch(() => false)) {
    await waitAndClick(select, "Selecting ticket category");
    numberInput = ticket.card.locator('input[type="number"], input[aria-label*="quantity" i]').first();
    if (await numberInput.isVisible().catch(() => false)) {
      await numberInput.fill(String(quantity));
      log(`Selecting quantity: ${quantity}`);
      return quantity;
    }
  }

  const control = quantityControl(ticket.card);
  try {
    await control.waitFor({ state: "visible", timeout: UI_TIMEOUT });
  } catch {
    throw new Error("Could not locate a quantity input or increase button in the matched ticket container.");
  }
  const increase = control.locator(":scope > button").nth(1);
  let current = await readQuantity(control);
  const target = config.quantityMode === "fixed" ? quantity : 20;
  for (let index = 0; index < target; index += 1) {
    if (config.quantityMode === "fixed" && current >= quantity) break;
    if (await increase.isDisabled()) break;
    await increase.click({ timeout: UI_TIMEOUT });
    const next = await waitForQuantityChange(control, current);
    if (next <= current) break;
    current = next;
  }
  if (config.quantityMode === "fixed" && current !== quantity) throw new Error(`Requested quantity ${quantity} could not be selected; current quantity is ${current}.`);
  if (config.quantityMode === "max") console.log(`\n========================================\nMAXIMUM TICKET QUANTITY DETECTED\nTicket: ${ticket.name}\nQuantity: ${current}\n========================================`);
  log(`Selecting quantity: ${current}`);
  return current;
}

export async function openCheckout(page: Page, config: Config, ticket: TicketMatch, quantity: number): Promise<void> {
  console.log(`Ticket: ${ticket.name}\nQuantity: ${quantity}`);
  if (config.dryRun) {
    log("DRY RUN: would click Order; no reservation will be created");
    return;
  }
  const order = page.getByRole("button", { name: /^(pesan|order)$/i }).first();
  if (!(await order.isVisible().catch(() => false))) {
    throw new Error("Order button was not found after selecting the requested ticket.");
  }
  await waitAndClick(order, "Opening checkout");
  try {
    await page.waitForURL(/\/category\/checkout(?:\?|$)/, { timeout: 30_000 });
  } catch {
    throw new Error("Pesan was clicked, but TiketMart did not navigate to checkout. The action will not be retried.");
  }
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}
