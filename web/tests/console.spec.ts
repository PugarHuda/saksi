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
/** The one credential this run revoked: complianceVerify() answers false and the rebuilt set
 *  dropped its leaf, so it is the only subject that is refused by BOTH gates for a live
 *  reason rather than for never having existed. */
const FROZEN = "0x2e2ba14f6784b72fe9874b41811193b5b0bdd0ca";

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

  // A revoked credential: refused live, and its leaf was dropped by the last rebuild. Both
  // gates say no, and neither of the two stale-window callouts may appear — those claim the
  // gates disagree, and here they do not.
  await check(page, FROZEN);
  await expect(page.getByText("This wallet cannot enter")).toBeVisible();
  await expect(page.getByText("no witness")).toBeVisible();
  await expect(page.getByText(/This is the window the two gates exist for/)).toHaveCount(0);
  await expect(page.getByText(/Credentialed after the last rebuild/)).toHaveCount(0);

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

/** An unreachable chain must never be rendered as an answer from the chain.
 *
 *  Each evidence read is caught to null individually so one failure does not blank the tab.
 *  That left a throttled RPC with every `answered` at null, none equal to 0, and a count of
 *  zero open requests — against a bundle listing two. The tab opened with a red alert saying
 *  the contract reports 0 still open and to trust the contract, above rows each admitting
 *  they could not read the contract. On chain the count is exactly 2 and always has been, so
 *  that banner had no true-positive path: every appearance was a failed read wearing a
 *  verdict's clothes, on the one tab whose entire job is to show two questions have gone
 *  unanswered. */
test("a dead RPC is reported as a dead RPC, not as a verdict", async ({ page }) => {
  await page.route("**/testnet-rpc.monad.xyz/**", (r) => r.abort());
  await page.goto("/console");
  await expect(page.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");
  // The accusation must be absent — not merely different, absent.
  await expect(page.getByText(/the contract reports \d+ still open/)).toHaveCount(0);
  await expect(page.getByText(/Trust the contract/)).toHaveCount(0);
  // And the tab still says the two requests are open, which is what the bundle claims and
  // what the chain would confirm if it could be reached.
  await expect(page.getByText("no proof exists — the request stays open").first()).toBeVisible();
});

/** A credential lookup that FAILED must not be rendered as a credential that is ABSENT.
 *
 *  The route can answer with a gateway's HTML. `r.json()` threw on it, the whole Promise.all
 *  rejected, and the card — which reads a null lookup as "not found" — printed the badge
 *  "No credential on this chain" about a wallet whose credential had never been checked. On
 *  the tab an issuer would use to decide whether someone may hold the asset. */
test("a failed credential lookup is not rendered as a missing credential", async ({ page }) => {
  await page.route("**/api/apass*", (r) =>
    r.fulfill({ status: 504, contentType: "text/html", body: "<html>gateway timeout</html>" }),
  );
  await page.goto("/console");
  await page.getByRole("tab", { name: "Issuer" }).click();
  await page.getByRole("button", { name: "Use the issuer wallet" }).click();
  await expect(page.getByText(/credential lookup failed \(HTTP 504\)/)).toBeVisible({ timeout: 40000 });
  await expect(page.getByText("No credential on this chain")).toHaveCount(0);
});

/** One missing field in a credential answer used to unmount the entire console.
 *
 *  `new Date(undefined).toISOString()` throws RangeError, React has no boundary on this tree,
 *  and every tab went to "This page couldn't load" — from an expiry date. */
test("a credential answer missing its fields does not take the console down", async ({ page }) => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.route("**/api/apass*", (r) => r.fulfill({ json: { found: true, countries: [] } }));
  await page.goto("/console");
  await page.getByRole("tab", { name: "Issuer" }).click();
  await page.getByRole("button", { name: "Use the issuer wallet" }).click();
  await expect(page.getByRole("tab", { name: "Issuer" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
  expect(errs).toEqual([]);
});

/** Phone, tablet, laptop. Every sideways-scroll defect this project has had came from one
 *  child's min-content width — a hash, a cast command, a badge label — escaping its grid
 *  track, and each was invisible at the width above it. */
for (const width of [375, 768, 1280]) {
  test(`no page scrolls sideways at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const overflow = () =>
      page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);

    for (const route of ["/", "/console"]) {
      await page.goto(route);
      expect(await overflow(), `${route} at ${width}`).toBeLessThanOrEqual(0);
    }

    for (const name of TABS) {
      await page.getByRole("tab", { name }).click();
      await expect(page.locator("main .card h2").first()).toBeVisible();
      expect(await overflow(), `"${name}" at ${width}`).toBeLessThanOrEqual(0);
    }
  });
}

test("a transfer output is not rendered as a deposit", async ({ page }) => {
  const problems = strict(page);
  await page.goto("/console");
  await page.getByRole("tab", { name: "Register" }).click();

  // Both JoinSplit outputs — the sender's change and the recipient's note. Rendering either
  // as a deposit claims an admission under a root that never happened, and the recipient's
  // row carries a null root, which threw inside short() and took the whole tab down.
  const moved = page.getByRole("row").filter({ hasText: "created by transfer" });
  await expect(moved).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await expect(moved.nth(i).getByText("not admitted — never entered")).toBeVisible();
    await expect(moved.nth(i).getByRole("link", { name: "transfer tx" })).toBeVisible();
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

test("a corrected answer never appears without its correction", async ({ page }) => {
  await page.goto("/console");

  // The row is the aggregate proved over three of four live positions. The proof is on chain
  // and cannot be retracted, so both surfaces that show the answer must show what it is an
  // answer to — an uncorrected wrong answer on screen is worse than the original mistake.
  for (const tab of ["Regulator", "Evidence"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(
      page.getByText(/all 3 registered positions/).first(),
      `"${tab}" shows the corrected answer`,
    ).toBeVisible();
    await expect(
      page.getByText(/is NOT a statement about the register/).first(),
      `"${tab}" shows the correction beside it`,
    ).toBeVisible();
  }
});
