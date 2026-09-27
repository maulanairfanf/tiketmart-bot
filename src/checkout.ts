import type { Locator, Page } from "playwright";
import type { Config } from "./config.js";
import { log } from "./logger.js";
import { escapeRegex, safeFill, takeErrorScreenshot, UI_TIMEOUT, waitAndClick } from "./utils.js";

export interface PurchaserVerification {
  fullName: string;
  email: string;
  phone: string;
}

async function fillFirst(candidates: Locator[], value: string, description: string): Promise<Locator> {
  for (const candidate of candidates) {
    if (await safeFill(candidate, value, description)) return candidate;
  }
  throw new Error(`Could not find purchaser field: ${description}`);
}

export async function fillPurchaserInformation(page: Page, config: Config): Promise<PurchaserVerification> {
  log("Filling purchaser details");
  const fullName = await fillFirst([page.getByLabel(/nama lengkap|full name|name/i).first(), page.getByPlaceholder(/nama lengkap|full name/i).first(), page.locator('input[name*="name" i], input[autocomplete="name"]').first()], config.fullName, "Filled full name");
  const email = await fillFirst([page.getByLabel(/email/i).first(), page.getByPlaceholder(/email/i).first(), page.locator('input[type="email"], input[name*="email" i]').first()], config.email, "Filled email");
  const phone = await fillFirst([page.getByLabel(/nomor ponsel|phone|mobile|whatsapp/i).first(), page.getByPlaceholder(/nomor ponsel|phone|mobile/i).first(), page.locator('input[type="tel"], input[name*="phone" i], input[name*="mobile" i]').first()], config.phone, "Filled phone");
  for (const [label, value] of Object.entries(config.extraFields)) {
    await fillFirst([page.getByLabel(new RegExp(escapeRegex(label), "i")).first()], value, `Filled ${label}`);
  }
  if (config.gender) {
    const genderText = config.gender === "male" ? /laki\s*-?\s*laki/i : /perempuan/i;
    const gender = page.getByRole("radio", { name: genderText }).first();
    if (await gender.isVisible().catch(() => false)) await gender.check().catch(async () => waitAndClick(gender, "Selecting gender"));
    else await waitAndClick(page.getByText(genderText).first(), "Selecting gender");
  }
  if ((await fullName.inputValue()).trim() !== config.fullName || (await phone.inputValue()).trim() !== config.phone || (await email.inputValue()).trim() !== config.email) {
    throw new Error("Purchaser field validation failed after filling the checkout form.");
  }

  const missing = await page.locator('input[required], select[required], textarea[required]').evaluateAll(fields =>
    fields.filter(field => !(field as HTMLInputElement).value && !(field as HTMLInputElement).checked)
      .map(field => field.getAttribute("name") || field.getAttribute("aria-label") || field.id || field.tagName)
  );
  if (missing.length > 0) {
    throw new Error(`Additional required purchaser fields need manual completion: ${missing.join(", ")}`);
  }
  return { fullName: config.fullName, email: config.email, phone: config.phone };
}

export async function acceptTerms(page: Page): Promise<void> {
  const form = page.locator("form").filter({ has: page.getByRole("checkbox") }).first();
  const scope = (await form.isVisible().catch(() => false)) ? form : page.locator("body");
  for (let pass = 0; pass < 10; pass += 1) {
    // Re-query after every interaction because the event agreement opens a modal over the form.
    const checkboxes = scope.getByRole("checkbox");
    const count = await checkboxes.count();
    if (count === 0) throw new Error("No required agreement checkboxes were found.");
    let uncheckedFound = false;

    for (let index = 0; index < count; index += 1) {
      const checkbox = checkboxes.nth(index);
      if (await checkbox.isChecked().catch(() => false)) continue;
      uncheckedFound = true;
      const agreementText = await checkbox.evaluate(element =>
        element.closest("label")?.innerText || element.parentElement?.innerText || ""
      ).catch(() => "");
      // The event agreement opens a portal modal immediately. check() waits for the
      // underlying control's final state and times out after that modal hides it.
      await checkbox.click({ timeout: UI_TIMEOUT });
      log(`Accepting agreement ${index + 1}`);
      const isEventAgreement = /syarat.*ketentuan.*event/i.test(agreementText) || index === count - 1;
      await confirmEventTermsIfRequested(page, isEventAgreement);
      const refreshedCheckbox = scope.getByRole("checkbox").nth(index);
      if (!(await refreshedCheckbox.isChecked().catch(() => false))) {
        throw new Error(`Agreement checkbox ${index + 1} could not be checked.`);
      }
      break;
    }

    if (!uncheckedFound) return;
  }
  throw new Error("Could not finish accepting all required agreements.");
}

export async function confirmEventTermsIfRequested(page: Page, waitForEventTerms = false): Promise<void> {
  // TiketMart portals this modal directly under document.body, outside the checkout form.
  const body = page.locator("body");
  const dialogs = body.locator('[role="dialog"]:visible, [data-state="open"]:visible')
    .filter({ hasText: /syarat\s+dan\s+ketentuan\s+event/i });
  const dialog = dialogs.last();
  const pageButtons = body.locator("button:visible").filter({ hasText: /^saya setuju$/i });
  const dialogButtons = dialog.locator("button:visible").filter({ hasText: /^saya setuju$/i });
  let candidates = (await dialog.isVisible().catch(() => false)) ? dialogButtons : pageButtons;

  if (waitForEventTerms) {
    await pageButtons.first().waitFor({ state: "visible", timeout: UI_TIMEOUT });
    candidates = (await dialog.isVisible().catch(() => false)) ? dialogButtons : pageButtons;
  } else if (await candidates.count() === 0) {
    return;
  }
  const count = await candidates.count();
  log(`Visible Saya setuju buttons: ${count}`);
  if (count !== 1) throw new Error(`Expected exactly one visible Saya setuju button, found ${count}.`);
  const agree = candidates.first();
  if (!(await agree.isEnabled())) throw new Error("Saya setuju is visible but disabled.");
  const modal = await dialog.isVisible().catch(() => false) ? dialog : body;
  const text = await modal.innerText();
  if (!/syarat.*ketentuan|setuju/i.test(text)) throw new Error("An unexpected dialog appeared after accepting checkout agreements.");
  await agree.scrollIntoViewIfNeeded();
  log("Confirming event terms with Saya setuju");
  await waitAndClick(agree, "Confirming event terms");
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.waitFor({ state: "hidden", timeout: UI_TIMEOUT });
  }
}

export async function selectPaymentStep(page: Page): Promise<void> {
  const control = page.getByRole("button", { name: /pilih metode pembayaran|select payment method/i }).first();
  await waitAndClick(control, "Opening payment methods");
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

export async function confirmEmailIfRequested(page: Page, email: string): Promise<void> {
  const dialog = page.getByRole("dialog").first();
  const dialogVisible = await dialog.isVisible().catch(() => false);
  const scope = dialogVisible ? dialog : page;
  const confirm = scope.getByRole("button", { name: /email saya sudah benar|my email is correct|lanjutkan|konfirmasi/i }).first();
  if (!(await confirm.isVisible().catch(() => false))) return;
  const pageText = await (dialogVisible ? dialog : page.locator("body")).innerText();
  if (!pageText.toLowerCase().includes(email.toLowerCase())) {
    await takeErrorScreenshot(page, "email-mismatch");
    throw new Error(`EMAIL CONFIRMATION MISMATCH\nExpected: ${email}\nDisplayed: ${pageText}`);
  }
  await waitAndClick(confirm, "Confirming email address", UI_TIMEOUT);
}
