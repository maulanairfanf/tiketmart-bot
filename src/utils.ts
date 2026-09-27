import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Locator, Page } from "playwright";
import { error, log } from "./logger.js";

export const UI_TIMEOUT = 12_000;

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function randomPollingDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

export async function takeErrorScreenshot(page: Page, label: string): Promise<void> {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "");
  const filePath = path.join(process.cwd(), "screenshots", `${timestamp}-${safeLabel}.png`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await page.screenshot({ path: filePath, fullPage: true }).catch(() => undefined);
  error(`${label}. Current URL: ${page.url()}. Screenshot: ${filePath}`);
}

export async function waitAndClick(locator: Locator, description: string, timeout = UI_TIMEOUT): Promise<void> {
  await locator.waitFor({ state: "visible", timeout });
  await locator.click({ timeout });
  log(description);
}

export async function safeFill(locator: Locator, value: string, description: string): Promise<boolean> {
  if (!(await locator.isVisible().catch(() => false))) return false;
  await locator.fill(value, { timeout: UI_TIMEOUT });
  log(description);
  return true;
}

export async function pauseForManualAction(page: Page, reason: string): Promise<never> {
  await takeErrorScreenshot(page, "manual-action-required");
  console.log("\n========================================");
  console.log("MANUAL ACTION REQUIRED");
  console.log(reason);
  console.log("Complete the step in the open browser, then stop this process with Ctrl+C.");
  console.log("========================================\n");
  return new Promise<never>(() => undefined);
}

export async function detectManualChallenge(page: Page): Promise<string | undefined> {
  if (/\/auth\/(login|sign-in)/i.test(page.url())) return "Sign-in is required";
  const challenge = page.getByText(/captcha|human verification|verify you are human|one-time password|\botp\b|waiting room|queue/i).first();
  if (await challenge.isVisible().catch(() => false)) {
    return (await challenge.innerText().catch(() => "Verification or queue detected")).trim();
  }
  const captchaFrame = page.locator('iframe[title*="captcha" i], iframe[src*="captcha" i], [data-sitekey]').first();
  if (await captchaFrame.isVisible().catch(() => false)) return "CAPTCHA detected";
  return undefined;
}

export async function assertNoManualChallenge(page: Page): Promise<void> {
  const challenge = await detectManualChallenge(page);
  if (challenge) await pauseForManualAction(page, challenge);
}
