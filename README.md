# TiketMart Ticket Checkout Bot

Browser-based, single-session Playwright automation for the normal TiketMart purchase flow. It uses a local persistent Chromium profile so normal cookies and session state survive between runs.

It does not bypass CAPTCHA, queues, OTP, anti-bot checks, authentication, rate limits, or private APIs. Any such page causes the automation to stop with the browser open. Payment is not submitted unless `AUTO_PAY=true` is explicitly configured.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Fill these required values in `.env`:

```dotenv
TICKET_NAME=REGULAR (PRESALE 2) - BEREMPAT
QUANTITY_MODE=max
QUANTITY=1
FULL_NAME=
PHONE=
EMAIL=
# Optional: male or female when the checkout requires it
GENDER=
EXTRA_FIELDS_JSON={}
PAYMENT_METHOD=QRIS
AUTO_PAY=false
```

Use `QUANTITY_MODE=max` to detect the selected card's live maximum. Use `QUANTITY_MODE=fixed` and an explicit positive `QUANTITY` for a fixed amount.

## Commands

Save a manual login in the persistent browser profile. No password is stored by the project:

```bash
npm run login
```

Inspect the reference event's event and category DOM. This never clicks `Pesan` or `Bayar`:

```bash
npm run inspect
```

Run a safe UI inspection of the configured event. This never clicks `Pesan` or `Bayar`:

```bash
npm run dry-run
```

Run the normal checkout flow:

```bash
npm run dev
```

Wait for ticket availability with one browser session and randomized 2.5-5 second polling:

```bash
npm run war
```

The default flow stops after choosing the configured payment method and prints `READY TO PAY`. Complete final payment yourself in the open browser.

## Notes

- Chromium is headful by default and its profile lives in `./browser-profile`.
- Errors save timestamped screenshots in `./screenshots` and include the current page URL in the console.
- TiketMart may change its interface. The selector fallbacks prioritize roles, labels, text, and semantic attributes; revalidate them with `npm run dry-run` when the site changes.
- If the category name matches more than one visible ticket container, the bot refuses to continue.
- Live validation found the requested Presale 2 card but it currently has no purchasable control. Quantity controls, purchaser fields, and payment controls must be revalidated when sales open; dry-run will report the card state without creating a reservation.
