import type { Page } from "playwright";
import { log } from "./logger.js";
import { randomPollingDelay } from "./utils.js";

const LOGIN_URL = "https://tiketmart.com/id/auth/login";

export function loginIsRequired(page: Page): boolean {
  return /\/auth\/(login|sign-in)/i.test(page.url());
}

export async function waitForManualLoginIfRequired(page: Page): Promise<boolean> {
  if (!loginIsRequired(page)) return false;
  console.log("\n========================================");
  console.log("LOGIN REQUIRED");
  console.log("Please log in manually in this browser.");
  console.log("Automation is paused.");
  console.log("========================================\n");
  while (loginIsRequired(page)) await page.waitForTimeout(randomPollingDelay(500, 900));
  log("LOGIN SESSION SAVED");
  return true;
}

export async function runLogin(page: Page): Promise<never> {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await waitForManualLoginIfRequired(page);
  console.log("\nLOGIN SESSION SAVED\nYou can now close the browser and run npm run war\n");
  return new Promise<never>(() => undefined);
}
