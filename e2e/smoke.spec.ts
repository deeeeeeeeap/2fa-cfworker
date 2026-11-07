import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

// RFC 6238 SHA-1 test key ("12345678901234567890") in Base32.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const RFC_KEY = Buffer.from("12345678901234567890");
// 10 s into a 30 s window, so the code cannot roll over mid-test.
const FIXED_TIME = new Date("2026-01-01T00:00:10Z");

function rfcTotp(unixSeconds: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(unixSeconds / 30)));
  const mac = createHmac("sha1", RFC_KEY).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, "0");
}

async function openPage(page: Page, at: Date = FIXED_TIME): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(String(error)));
  page.on("console", (message) => message.type() === "error" && problems.push(message.text()));
  // CSP violations are not always reported as console errors.
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.clock.setFixedTime(at);
  await page.goto("/");
  return problems;
}

test("shows the RFC 6238 code for a typed secret and copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const problems = await openPage(page);
  await expect(page.locator("#copyCode")).toHaveAttribute("aria-disabled", "true");

  await page.fill("#secret", SECRET);
  const expected = rfcTotp(FIXED_TIME.getTime() / 1000);
  await expect(page.locator("#token")).toHaveAttribute("data-value", expected);

  await page.click("#copyCode");
  await expect(page.locator("#toast")).toHaveClass(/show/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  expect(problems).toEqual([]);
});

test("previews the next code in the final seconds of a period", async ({ page }) => {
  const nearRollover = new Date(FIXED_TIME.getTime() + 16_000);
  const problems = await openPage(page, nearRollover);
  await page.fill("#secret", SECRET);
  const next = rfcTotp(nearRollover.getTime() / 1000 + 30);
  await expect(page.locator("#next")).toContainText(`${next.slice(0, 3)} ${next.slice(3)}`);
  expect(problems).toEqual([]);
});

test("imports an otpauth link with its parameters and clears the plaintext field", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const problems = await openPage(page);
  await page.evaluate((secret) => navigator.clipboard.writeText(`otpauth://totp/Example:alice?secret=${secret}&issuer=Example&digits=8`), SECRET);
  await page.click("#otpauth");
  await page.keyboard.press("ControlOrMeta+V");

  await expect(page.locator("#token")).toHaveAttribute("data-value", rfcTotp(FIXED_TIME.getTime() / 1000, 8));
  await expect(page.locator("#otpauth")).toHaveValue("");
  await expect(page.locator("#otpauth-meta")).toContainText("Example · alice");
  expect(problems).toEqual([]);
});

test("masks the /tok/ preview until the secret is shown", async ({ page }) => {
  const problems = await openPage(page);
  await page.fill("#secret", SECRET);
  await page.click("#compat summary");
  await expect(page.locator("#endpoint")).toHaveValue(/\/tok\/•{8}$/);
  await expect(page.locator("#request")).toHaveValue(/"secret":"YOUR_SECRET"/);

  await page.click("#toggleSecret");
  await expect(page.locator("#endpoint")).toHaveValue(new RegExp(`/tok/${SECRET}$`));
  expect(problems).toEqual([]);
});

test("switches language and theme", async ({ page }) => {
  const problems = await openPage(page);
  await page.click('[data-lang="en"]');
  await expect(page.locator('[data-i18n="secretLabel"]')).toHaveText("TOTP secret");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const before = await page.locator("html").getAttribute("data-theme");
  await page.click("#themeToggle");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", before ?? "");
  expect(problems).toEqual([]);
});

test.describe("English browser without JavaScript", () => {
  test.use({ locale: "en-US", javaScriptEnabled: false });

  test("gets the page rendered in English by the server", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle("2FA Worker - Generate TOTP codes");
    await expect(page.locator('[data-i18n="secretLabel"]')).toHaveText("TOTP secret");
  });
});
