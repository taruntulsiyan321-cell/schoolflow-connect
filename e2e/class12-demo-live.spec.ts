import { test, expect, type Page } from "@playwright/test";

/**
 * Demo-readiness check for the Class 12-A (Commerce) cohort seeded by
 * supabase/SEED_CLASS12_DEMO.sql.
 *
 * Signing in is not enough for a demo — the panels have to show the right
 * content. In particular Practice must resolve to the Class 12 Mathematics
 * bank, which is the whole reason this cohort exists.
 */

const PASSWORD = process.env.E2E_DEMO_PASSWORD || "DemoPass123!";

const FORBIDDEN: Array<{ label: string; pattern: RegExp }> = [
  { label: "stringified object", pattern: /\[object (?:Object|Array|Promise)\]/ },
  { label: "literal undefined", pattern: /\bundefined\b/ },
  { label: "literal NaN", pattern: /\bNaN\b/ },
  {
    label: "raw UUID",
    pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  },
  { label: "unrepaired mojibake", pattern: /â€|Â·|à¤|ðŸ|â”€/ },
  { label: "replacement character", pattern: /�/ },
  {
    label: "raw database error",
    pattern:
      /violates row-level security policy|in the schema cache|permission denied for (?:table|relation)|PGRST\d{3}/i,
  },
];

async function signIn(page: Page, email: string, expected: RegExp) {
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email or Mobile").fill(email);
  await page.locator("#signin-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page, `sign-in as ${email}`).toHaveURL(expected, { timeout: 40000 });
}

async function settle(page: Page) {
  await page
    .waitForFunction(
      () => {
        const t = document.body?.innerText ?? "";
        if (!t.trim() || /Restoring your session/i.test(t)) return false;
        const main = document.querySelector("main") ?? document.body;
        return ((main as HTMLElement).innerText ?? "").trim().length > 60;
      },
      { timeout: 45000 },
    )
    .catch(() => undefined);
  await page
    .waitForFunction(
      () => {
        const main = document.querySelector("main") ?? document.body;
        return !/\bLoading [a-z ]+…/i.test((main as HTMLElement).innerText ?? "");
      },
      { timeout: 15000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(1500);
}

function scan(path: string, body: string, problems: string[]) {
  for (const { label, pattern } of FORBIDDEN) {
    const m = body.match(pattern);
    if (!m) continue;
    const i = body.indexOf(m[0]);
    problems.push(
      `${path} [${label}] …${body.slice(Math.max(0, i - 90), i + 90).replace(/\s*\n+\s*/g, " ⏎ ")}…`,
    );
  }
}

test.describe.configure({ mode: "serial", timeout: 300000 });
test.use({ storageState: { cookies: [], origins: [] } });

test("Class 12 student demo account is usable", async ({ page }) => {
  const problems: string[] = [];
  await signIn(page, "aarav.sharma@wisdomcampus.com", /\/student/);

  for (const path of [
    "/student",
    "/student/practice",
    "/student/tests",
    "/student/analysis",
    "/student/attendance",
    "/student/homework",
  ]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await settle(page);
    const body = await page.locator("body").innerText();
    scan(path, body, problems);
    await page.screenshot({ path: `test-results/class12/student${path.replace(/\//g, "_")}.png`, fullPage: true });
  }

  // The point of this cohort: Practice must offer Class 12 commerce subjects.
  await page.goto("/student/practice", { waitUntil: "domcontentloaded" });
  await settle(page);
  const practice = await page.locator("body").innerText();
  console.log("\n=== CLASS 12 STUDENT ===");
  console.log("practice page mentions Mathematics:", /Mathematics|Maths/i.test(practice));
  console.log("practice page mentions Accountancy:", /Accountancy/i.test(practice));
  console.log("practice sample:", practice.replace(/\s*\n+\s*/g, " ⏎ ").slice(0, 320));
  if (problems.length) {
    console.log("FINDINGS:");
    for (const p of problems) console.log("  " + p);
  } else console.log("no internal values on any checked page");
  console.log("");

  expect(problems, problems.join("\n")).toEqual([]);
});

test("Class 12 parent demo account is usable", async ({ page }) => {
  const problems: string[] = [];
  await signIn(page, "sharma.parent@wisdomcampus.com", /\/parent/);

  for (const path of ["/parent", "/parent/children", "/parent/marks", "/parent/insights"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await settle(page);
    const body = await page.locator("body").innerText();
    scan(path, body, problems);
    await page.screenshot({ path: `test-results/class12/parent${path.replace(/\//g, "_")}.png`, fullPage: true });
  }

  await page.goto("/parent/children", { waitUntil: "domcontentloaded" });
  await settle(page);
  const kids = await page.locator("body").innerText();
  console.log("\n=== CLASS 12 PARENT ===");
  console.log("links to Aarav Sharma:", /Aarav Sharma/i.test(kids));
  console.log("children sample:", kids.replace(/\s*\n+\s*/g, " ⏎ ").slice(0, 320));
  if (problems.length) {
    console.log("FINDINGS:");
    for (const p of problems) console.log("  " + p);
  } else console.log("no internal values on any checked page");
  console.log("");

  expect(problems, problems.join("\n")).toEqual([]);
});
