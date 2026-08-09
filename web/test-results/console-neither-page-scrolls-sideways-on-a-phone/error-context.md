# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: console.spec.ts >> neither page scrolls sideways on a phone
- Location: tests\console.spec.ts:113:1

# Error details

```
Error: "Register" overflows by 36px

expect(received).toBeLessThanOrEqual(expected)

Expected: <= 0
Received:    36
```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - generic [ref=f1e2]:
    - banner [ref=f1e3]:
      - generic [ref=f1e4]:
        - img "Saksi" [ref=f1e5]
        - generic [ref=f1e10]:
          - heading "Saksi" [level=1] [ref=f1e11]
          - generic [ref=f1e12]: Every position witnessed. Disclosure only when asked.
      - generic [ref=f1e13]:
        - generic [ref=f1e14]: Monad testnet
        - generic [ref=f1e16]: Reading chain…
    - tablist "Consoles" [ref=f1e19]:
      - tab "Evidence" [ref=f1e20] [cursor=pointer]
      - tab "Am I eligible?" [ref=f1e21] [cursor=pointer]
      - tab "Register" [active] [selected] [ref=f1e22] [cursor=pointer]
      - tab "Two gates" [ref=f1e23] [cursor=pointer]
      - tab "Issuer" [ref=f1e24] [cursor=pointer]
      - tab "Regulator" [ref=f1e25] [cursor=pointer]
    - main [ref=f1e26]:
      - tabpanel "Register" [ref=f1e27]:
        - generic [ref=f1e28]:
          - generic [ref=f1e29]:
            - heading "Why a register needs to be confidential" [level=2] [ref=f1e30]
            - paragraph [ref=f1e31]: "A census, not a sample: every balance of every verified asset on monad, read against all 562 credentialed wallets — the complete set of parties a verified asset is permitted to move to."
            - generic [ref=f1e32]:
              - generic [ref=f1e33]:
                - heading "Median holders per asset" [level=3] [ref=f1e34]
                - paragraph [ref=f1e35]: "3"
              - generic [ref=f1e36]:
                - heading "Fewer than five holders" [level=3] [ref=f1e37]
                - paragraph [ref=f1e38]:
                  - text: "35"
                  - generic [ref=f1e39]: / 45
                - paragraph [ref=f1e40]: 78% of assets measured
              - generic [ref=f1e41]:
                - heading "One wallet over 90% of supply" [level=3] [ref=f1e42]
                - paragraph [ref=f1e43]: "16"
            - paragraph [ref=f1e44]:
              - text: "An anonymity set of 3 is not anonymity. Knowing the asset and watching one transfer identifies the position and its size. This is not a quiet-testnet artefact — it is the mechanism:"
              - strong [ref=f1e45]: the tighter an asset's holder rule, the smaller the crowd its holders hide in.
              - text: Eligibility restricts the population by design, so compliance and confidentiality pull against each other structurally.
            - paragraph [ref=f1e46]:
              - text: "Measured 2026-08-09 08:36 UTC. the census can only miss holders, never invent them, so every count is a floor: the true anonymity set is at least this large and the real picture at most this exposed — the error can only run one way, so these are upper bounds on privacy. Reproduce with"
              - code [ref=f1e47]: node ops/measure-register.mjs
              - text: .
          - generic [ref=f1e48]:
            - generic [ref=f1e49]:
              - heading "Commitments inserted" [level=2] [ref=f1e50]
              - paragraph [ref=f1e51]
              - paragraph [ref=f1e53]: "The tree only grows: spending a note nullifies it but leaves its leaf in place, so this figure counts every commitment the register has ever held."
            - generic [ref=f1e54]:
              - heading "Asset under register" [level=2] [ref=f1e55]
              - paragraph [ref=f1e56]
              - paragraph [ref=f1e58]: SAKSIAZEV — the total is public, its distribution is not.
            - generic [ref=f1e59]:
              - heading "Register state" [level=2] [ref=f1e60]
              - paragraph [ref=f1e61]
              - paragraph [ref=f1e63]: "An unregistered pool fails closed: Cleanverse's validator reverts rather than answering, so entry stops."
          - generic [ref=f1e64]:
            - heading "Anchors" [level=2] [ref=f1e65]
            - paragraph [ref=f1e66]: The register publishes two roots. The association-set root says which credentials may enter; the note root is the tree the shielded transfers spend against.
            - generic [ref=f1e67]:
              - term [ref=f1e68]: Association set
              - definition [ref=f1e69]
              - term [ref=f1e71]: Note tree
              - definition [ref=f1e72]
              - term [ref=f1e74]: Pool
              - definition [ref=f1e75]:
                - link "0xeBBA114d…A09AF1CA" [ref=f1e77] [cursor=pointer]:
                  - /url: https://testnet.monadexplorer.com/address/0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA
              - term [ref=f1e78]: Asset
              - definition [ref=f1e79]:
                - link "0xb9c53B57…1C5f4d6B" [ref=f1e81] [cursor=pointer]:
                  - /url: https://testnet.monadexplorer.com/address/0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B
                - text: · Saksi Series A Note
              - term [ref=f1e82]: Validator
              - definition [ref=f1e83]:
                - link "0xaC7e5179…4F161792" [ref=f1e85] [cursor=pointer]:
                  - /url: https://testnet.monadexplorer.com/address/0xaC7e5179C2C7f03f209136886c172eb34F161792
          - generic [ref=f1e86]:
            - heading "The register" [level=2] [ref=f1e87]
            - paragraph [ref=f1e88]:
              - text: Every row is a live position this contract is holding, and they did not all arrive the same way. A
              - strong [ref=f1e89]: deposit
              - text: "row was admitted under the association-set root named beside it, and its entry is public by construction: the transaction in the last column carries a visible sender and a visible ERC-20 amount, so that figure is reconstructible from the chain. A"
              - strong [ref=f1e90]: transfer
              - text: row was created inside the register by a JoinSplit — it carries no association-set proof and no entry transaction, because it never entered; it moved.
            - table [ref=f1e92]:
              - caption [ref=f1e93]: Shielded positions in the register
              - rowgroup [ref=f1e94]:
                - row [ref=f1e95]:
                  - columnheader "Commitment" [ref=f1e96]
                  - columnheader "Amount held" [ref=f1e97]
                  - columnheader "Current holder" [ref=f1e98]
                  - columnheader "Admitted under root" [ref=f1e99]
                  - columnheader "Created" [ref=f1e100]
                  - columnheader "Transaction" [ref=f1e101]
              - rowgroup [ref=f1e102]:
                - row [ref=f1e103]:
                  - cell "0x2be2c897…d390b33f" [ref=f1e104]
                  - cell "•••••• not shown" [ref=f1e105]:
                    - generic "held by the register; not shown here" [ref=f1e106]:
                      - text: ••••••
                      - generic [ref=f1e107]: not shown
                  - cell "••••• not shown" [ref=f1e108]:
                    - generic "held by the register; not shown here" [ref=f1e109]:
                      - text: •••••
                      - generic [ref=f1e110]: not shown
                  - cell "20523674…604905" [ref=f1e111]
                  - cell "2026-08-09 10:15" [ref=f1e112]
                  - cell [ref=f1e113]:
                    - link "0x4afa31…010f3c" [ref=f1e115] [cursor=pointer]:
                      - /url: https://testnet.monadexplorer.com/tx/0x4afa31f0598d02b460611cb98ed90b1015acda4474dc66493917ab3216010f3c
                - row [ref=f1e116]:
                  - cell "0x09f112a4…793bd163" [ref=f1e117]
                  - cell "•••••• not shown" [ref=f1e118]:
                    - generic "held by the register; not shown here" [ref=f1e119]:
                      - text: ••••••
                      - generic [ref=f1e120]: not shown
                  - cell "••••• not shown" [ref=f1e121]:
                    - generic "held by the register; not shown here" [ref=f1e122]:
                      - text: •••••
                      - generic [ref=f1e123]: not shown
                  - cell "20523674…604905" [ref=f1e124]
                  - cell "2026-08-09 10:15" [ref=f1e125]
                  - cell [ref=f1e126]:
                    - link "0xd553d9…8df3ae" [ref=f1e128] [cursor=pointer]:
                      - /url: https://testnet.monadexplorer.com/tx/0xd553d9792d096cd5aaae1b4f5d40e3c1d07281088793fd4ac96c6563fa8df3ae
                - row [ref=f1e129]:
                  - cell "0x052004a1…bbdf15b8 created by transfer" [ref=f1e130]:
                    - text: 0x052004a1…bbdf15b8
                    - generic [ref=f1e131]: created by transfer
                  - cell "•••••• not shown" [ref=f1e132]:
                    - generic "held by the register; not shown here" [ref=f1e133]:
                      - text: ••••••
                      - generic [ref=f1e134]: not shown
                  - cell "••••• not shown" [ref=f1e135]:
                    - generic "held by the register; not shown here" [ref=f1e136]:
                      - text: •••••
                      - generic [ref=f1e137]: not shown
                  - cell "not admitted — never entered" [ref=f1e138]
                  - cell "2026-08-09 13:14" [ref=f1e139]
                  - cell [ref=f1e140]:
                    - link "transfer tx" [ref=f1e142] [cursor=pointer]:
                      - /url: https://testnet.monadexplorer.com/tx/0x78168fda9282e1d7933c942c102ab2d53b4049a98cda272b0eb7f23167f1291c
            - paragraph [ref=f1e143]: A conventional RWA platform publishes this table with real names and real numbers in the last two columns. That is the disclosure institutions will not accept — and the reason tokenized private credit stays on permissioned ledgers.
            - paragraph [ref=f1e144]:
              - strong [ref=f1e145]: Where the shielding starts, precisely.
              - text: "Entry is public by construction: a deposit transaction has a visible sender and moves a visible ERC-20 amount, so the chain already links a deposited commitment to the wallet that opened it. What the register conceals is the book"
              - emphasis [ref=f1e146]: after
              - text: positions move — a JoinSplit spends notes and creates new ones without publishing an amount or an owner, so who holds what stops tracking who deposited what. We do not publish the entry mapping in this bundle either, but that is courtesy rather than a guarantee, and it would be dishonest to present it as one.
            - paragraph [ref=f1e147]:
              - strong [ref=f1e148]: And one limit on the notes actually on this chain.
              - text: The circuit publishes no amount, but the splitter that produced these particular transfers used a fixed 37/63 ratio. Anyone who knows the input can therefore recompute both outputs, so a reviewer should assume the current figures are readable. That is a property of this demo run, not of the construction — but the construction is not what is deployed here, and the difference is the reviewer's to check, not ours to gloss.
    - contentinfo [ref=f1e149]:
      - paragraph [ref=f1e150]: Saksi is a hackathon build on Cleanverse infrastructure. It is not affiliated with Cleanverse International Pte Ltd, and nothing here is a security offering. All addresses are Monad testnet.
      - paragraph [ref=f1e151]: Zero-knowledge core ported from an earlier public Stellar build; the Cleanverse integration, the pool, and these consoles were built during the window.
  - alert [ref=f1e152]
```

# Test source

```ts
  30  |   await page.getByRole("tab", { name: "Am I eligible?" }).click();
  31  |   await page.locator("#holder-address").fill(address);
  32  |   await page.getByRole("button", { name: "Check", exact: true }).click();
  33  |   await expect(page.getByText(/This wallet (can|cannot) enter/)).toBeVisible();
  34  | }
  35  | 
  36  | test("every tab renders, and none of them throws", async ({ page }) => {
  37  |   const problems = strict(page);
  38  |   await page.goto("/console");
  39  | 
  40  |   for (const name of TABS) {
  41  |     await page.getByRole("tab", { name }).click();
  42  |     await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
  43  |     // Each panel's first card heading, whatever it is, must have rendered.
  44  |     await expect(page.locator("main .card h2").first()).toBeVisible();
  45  |   }
  46  |   expect(problems, problems.join("\n")).toEqual([]);
  47  | });
  48  | 
  49  | test("the tablist is operable from the keyboard", async ({ page }) => {
  50  |   await page.goto("/console");
  51  |   await page.getByRole("tab", { name: "Evidence" }).focus();
  52  |   await page.keyboard.press("ArrowRight");
  53  |   await expect(page.getByRole("tab", { name: "Am I eligible?" })).toBeFocused();
  54  |   await page.keyboard.press("End");
  55  |   await expect(page.getByRole("tab", { name: "Regulator" })).toBeFocused();
  56  |   await page.keyboard.press("Home");
  57  |   await expect(page.getByRole("tab", { name: "Evidence" })).toBeFocused();
  58  |   // The tabpanel must not swallow the main landmark.
  59  |   await expect(page.getByRole("main")).toBeVisible();
  60  | });
  61  | 
  62  | test("the holder flow agrees with the chain", async ({ page }) => {
  63  |   await page.goto("/console");
  64  | 
  65  |   // A credentialed wallet in the anchored set and off the deny list.
  66  |   await check(page, ISSUER);
  67  |   await expect(page.getByText("This wallet can enter")).toBeVisible();
  68  | 
  69  |   // Whitespace and case must not change the answer — the same address, three ways.
  70  |   await check(page, `  ${ISSUER.toLowerCase()}  `);
  71  |   await expect(page.getByText("This wallet can enter")).toBeVisible();
  72  | 
  73  |   // The burn address passes both gates and is still refused, because deposit() also
  74  |   // enforces the deny list. This is the assertion that catches the console and the pool
  75  |   // drifting apart: it held a "yes" on the Two gates tab while saying "refused" here.
  76  |   await check(page, BURN);
  77  |   await expect(page.getByText("This wallet cannot enter")).toBeVisible();
  78  |   await expect(page.getByRole("row", { name: /sanctions list/ }).getByText("listed")).toBeVisible();
  79  | 
  80  |   // No credential: refused by Cleanverse's validator and absent from the set.
  81  |   await check(page, NO_CREDENTIAL);
  82  |   await expect(page.getByText("This wallet cannot enter")).toBeVisible();
  83  |   await expect(page.getByText("no witness")).toBeVisible();
  84  | 
  85  |   // Anything that is not a 20-byte address cannot be submitted at all.
  86  |   for (const bad of ["", "0x1234", "not-an-address"]) {
  87  |     await page.locator("#holder-address").fill(bad);
  88  |     await expect(page.getByRole("button", { name: "Check", exact: true })).toBeDisabled();
  89  |   }
  90  | });
  91  | 
  92  | test("the two gates tab never contradicts the deny list", async ({ page }) => {
  93  |   await page.goto("/console");
  94  |   await page.getByRole("tab", { name: "Two gates" }).click();
  95  |   const burnRow = page.getByRole("row", { name: /0x00000000/ });
  96  |   await expect(burnRow).toBeVisible();
  97  |   await expect(burnRow.getByText("deny-listed")).toBeVisible();
  98  | });
  99  | 
  100 | test("the evidence tab shows an open request the chain confirms is open", async ({ page }) => {
  101 |   await page.goto("/console");
  102 |   await expect(page.getByRole("tab", { name: "Evidence" })).toHaveAttribute(
  103 |     "aria-selected",
  104 |     "true",
  105 |   );
  106 |   await expect(page.getByText("no proof exists — the request stays open").first()).toBeVisible();
  107 |   // Read live from auditAnswered(), so this fails if the artefact and the contract diverge.
  108 |   await expect(page.getByText("never — auditAnswered = 0").first()).toBeVisible();
  109 |   // Request must precede answer: a positive block gap on every closed row.
  110 |   await expect(page.getByText(/^\+\d+$/).first()).toBeVisible();
  111 | });
  112 | 
  113 | test("neither page scrolls sideways on a phone", async ({ page }) => {
  114 |   await page.setViewportSize({ width: 375, height: 900 });
  115 | 
  116 |   for (const route of ["/", "/console"]) {
  117 |     await page.goto(route);
  118 |     const overflow = await page.evaluate(
  119 |       () => document.scrollingElement!.scrollWidth - window.innerWidth,
  120 |     );
  121 |     expect(overflow, `${route} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  122 |   }
  123 | 
  124 |   for (const name of TABS) {
  125 |     await page.getByRole("tab", { name }).click();
  126 |     await expect(page.locator("main .card h2").first()).toBeVisible();
  127 |     const overflow = await page.evaluate(
  128 |       () => document.scrollingElement!.scrollWidth - window.innerWidth,
  129 |     );
> 130 |     expect(overflow, `"${name}" overflows by ${overflow}px`).toBeLessThanOrEqual(0);
      |                                                              ^ Error: "Register" overflows by 36px
  131 |   }
  132 | });
  133 | 
```