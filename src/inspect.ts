import type { Page } from "playwright";

export async function inspectPage(page: Page): Promise<void> {
  const describe = await page.locator("button, input, select, textarea, [role=checkbox], [role=radio]").evaluateAll(elements =>
    elements.map((element, index) => ({
      index,
      tag: element.tagName,
      text: (element as HTMLElement).innerText?.trim() || "",
      label: element.getAttribute("aria-label") || element.getAttribute("name") || element.getAttribute("placeholder") || "",
      role: element.getAttribute("role") || "",
      type: element.getAttribute("type") || "",
      disabled: (element as HTMLButtonElement).disabled || false
    }))
  );
  console.log(`URL: ${page.url()}`);
  console.log("CONTROLS:");
  for (const item of describe) console.log(`[${item.index}] ${item.tag} ${item.text || item.label || item.type}${item.disabled ? " (disabled)" : ""}`);
  console.log("TICKETS:");
  for (const ticket of await page.locator("h3").allInnerTexts()) console.log(ticket.trim());
}
