import "dotenv/config";
import path from "node:path";

export type PaymentMethod = "QRIS" | "VIRTUAL ACCOUNT";
export type QuantityMode = "max" | "fixed";
export type Gender = "male" | "female";

export interface BrowserOptions {
  browserProfile: string;
  headless: boolean;
}

export interface Config extends BrowserOptions {
  eventUrl: string;
  ticketName: string;
  quantity: number;
  quantityMode: QuantityMode;
  fullName: string;
  email: string;
  phone: string;
  gender?: Gender;
  extraFields: Record<string, string>;
  paymentMethod: PaymentMethod;
  autoPay: boolean;
  dryRun: boolean;
  pollMinMs: number;
  pollMaxMs: number;
}

function booleanValue(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

function positiveInteger(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (!raw && fallback !== undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

function extraFields(): Record<string, string> {
  const raw = process.env.EXTRA_FIELDS_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => {
      if (typeof value !== "string") throw new Error();
      return [key, value];
    }));
  } catch {
    throw new Error("EXTRA_FIELDS_JSON must be a JSON object with field labels and string values.");
  }
}

export function loadBrowserOptions(): BrowserOptions {
  return {
    browserProfile: path.resolve(process.cwd(), process.env.BROWSER_PROFILE?.trim() || "./browser-profile"),
    headless: booleanValue("HEADLESS", false)
  };
}

export function loadConfig(): Config {
  const pollMinMs = positiveInteger("POLL_INTERVAL_MIN_MS", 2500);
  const pollMaxMs = positiveInteger("POLL_INTERVAL_MAX_MS", 5000);
  if (pollMinMs > pollMaxMs) {
    throw new Error("POLL_INTERVAL_MIN_MS cannot be greater than POLL_INTERVAL_MAX_MS.");
  }

  const normalizedPayment = required("PAYMENT_METHOD").replace(/\s+/g, " ").toUpperCase();
  if (normalizedPayment !== "QRIS" && normalizedPayment !== "VIRTUAL ACCOUNT") {
    throw new Error("PAYMENT_METHOD must be QRIS or Virtual Account.");
  }
  const quantityMode = (process.env.QUANTITY_MODE?.trim().toLowerCase() || "fixed");
  if (quantityMode !== "max" && quantityMode !== "fixed") throw new Error("QUANTITY_MODE must be max or fixed.");
  const gender = process.env.GENDER?.trim().toLowerCase() || undefined;
  if (gender && gender !== "male" && gender !== "female") throw new Error("GENDER must be male or female when configured.");

  return {
    eventUrl: process.env.EVENT_URL?.trim() || "https://tiketmart.com/en/event/cmudlol9h0hygt51bjiaptqsx",
    ticketName: required("TICKET_NAME"),
    quantity: positiveInteger("QUANTITY", 1),
    quantityMode,
    fullName: required("FULL_NAME"),
    email: required("EMAIL"),
    phone: required("PHONE"),
    gender: gender as Gender | undefined,
    extraFields: extraFields(),
    paymentMethod: normalizedPayment,
    autoPay: booleanValue("AUTO_PAY", false),
    dryRun: booleanValue("DRY_RUN", false),
    pollMinMs,
    pollMaxMs,
    ...loadBrowserOptions()
  };
}
