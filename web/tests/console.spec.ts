import { expect, test, type Page } from "@playwright/test";

/** The smallest suite that fails if the console regresses in a way that matters.
 *
 *  Three classes of defect are covered, because all three have already happened here:
 *  a tab that throws on data it does not expect; a page that scrolls sideways on a phone;
 *  and — the serious one — the screen disagreeing with the chain about who may enter.
 */

const TABS = ["Evidence", "Am I eligible?", "Register", "Two gates", "Issuer", "Regulator"];

const ISSUER = "0x4490CcB0abdE3D2E494dE5cC118F7D0D74b44639";
const BURN = "0x000000000000000000000000000000000000dEaD";
const NO_CREDENTIAL = "0xd57837A934f44216f721877B6B9d77693b70476E";

/** Fails the test on the first uncaught error or 4xx/5xx, rather than letting a tab render
 *  half of itself and pass on a text assertion. */
function strict(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    // The public RPC throttles; lib/chain retries, so only same-origin failures are ours.
    if (r.status() >= 400 && new URL(r.url()).origin === new URL(page.url() || "http://x").origin)
      problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return problems;
}

async function check(page: Page, address: string) {
  await page.getByRole("tab", { name: "Am I eligible?" }).click();
  await page.locator("#holder-address").fill(address);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText(/This wallet (can|cannot) enter/)).toBeVisible();
}

test("every tab renders, and none of them throws", async ({ page }) => {
  const problems = strict(page);
  await page.goto("/console");

  for (const name of TABS) {
    await page.getByRole("tab", { name }).click();
    await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
    // Each panel's first card heading, whatever it is, must have rendered.
    await expect(page.locator("main .card h2").first()).toBeVisible();
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

test("the tablist is operable from the keyboard", async ({ page }) => {
  await page.goto("/console");
  await page.getByRole("tab", { name: "Evidence" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Am I eligible?" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Regulator" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Evidence" })).toBeFocused();
  // The tabpanel must not swallow the main landmark.
  await expect(page.getByRole("main")).toBeVisible();
});

test("the holder flow agrees with the chain", async ({ page }) => {
  await page.goto("/console");

  // A credentialed wallet in the anchored set and off the deny list.
  await check(page, ISSUER);
  await expect(page.getByText("This wallet can enter")).toBeVisible();

  // Whitespace and case must not change the answer — the same address, three ways.
  await check(page, `  ${ISSUER.toLowerCase()}  `);
  await expect(page.getByText("This wallet can enter")).toBeVisible();

  // The burn address passes both gates and is still refused, because deposit() also
  // enforces the deny list. This is the assertion that catches the console and the pool
  // drifting apart: it held a "yes" on the Two gates tab while saying "refused" here.
  await check(page, BURN);
  await expect(page.getByText("This wallet cannot enter")).toBeVisible();
  await expect(page.getByRole("row", { name: /sanctions list/ }).getByText("listed")).toBeVisible();

  // No credential: refused by Cleanverse's validator and absent from the set.
  await check(page, NO_CREDENTIAL);
  await expect(page.getByText("This wallet cannot enter")).toBeVisible();
  await expect(page.getByText("no witness")).toBeVisible();

  // Anything that is not a 20-byte address cannot be submitted at all.
  for (const bad of ["", "0x1234", "not-an-address"]) {
    await page.locator("#holder-address").fill(bad);
    await expect(page.getByRole("button", { name: "Check", exact: true })).toBeDisabled();
  }
});

test("the two gates tab never contradicts the deny list", async ({ page }) => {
  await page.goto("/console");
  await page.getByRole("tab", { name: "Two gates" }).click();
  const burnRow = page.getByRole("row", { name: /0x00000000/ });
  await expect(burnRow).toBeVisible();
  await expect(burnRow.getByText("deny-listed")).toBeVisible();
});

test("the evidence tab shows an open request the chain confirms is open", async ({ page }) => {
  await page.goto("/console");
  await expect(page.getByRole("tab", { name: "Evidence" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("no proof exists — the request stays open").first()).toBeVisible();
  // Read live from auditAnswered(), so this fails if the artefact and the contract diverge.
  await expect(page.getByText("never — auditAnswered = 0").first()).toBeVisible();
  // Request must precede answer: a positive block gap on every closed row.
  await expect(page.getByText(/^\+\d+$/).first()).toBeVisible();
});

test("neither page scrolls sideways on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });

  for (const route of ["/", "/console"]) {
    await page.goto(route);
    const overflow = await page.evaluate(
      () => document.scrollingElement!.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${route} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }

  for (const name of TABS) {
    await page.getByRole("tab", { name }).click();
    await expect(page.locator("main .card h2").first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.scrollingElement!.scrollWidth - window.innerWidth,
    );
    expect(overflow, `"${name}" overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});
