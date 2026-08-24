import { test, expect, type Page } from "@playwright/test";

/**
 * Runtime check that no internal value reaches the screen on the routes that
 * do not need a session. It complements the jsdom component tests: those pin
 * the boundary's behaviour, this one watches a real browser render the real
 * bundle.
 *
 * Authenticated panels are NOT covered here — this project's saved session is
 * captured by hand (`npm run test:e2e:auth`, non-headless, real credentials)
 * and no spec is allowed to submit a password. Run that first, then the
 * authenticated suite, to extend this coverage inward.
 */

/** Strings that are always a bug when a user can see them. */
const FORBIDDEN_TEXT: Array<{ label: string; pattern: RegExp }> = [
  { label: "stringified object", pattern: /\[object (?:Object|Array|Promise)\]/ },
  { label: "literal undefined", pattern: /\bundefined\b/ },
  { label: "literal null", pattern: /(?:^|\s)null(?:\s|$)/ },
  { label: "NaN", pattern: /\bNaN\b/ },
  { label: "raw UUID", pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i },
  { label: "unrepaired mojibake", pattern: /Ã.|â€|à¤|Ï€/ },
  { label: "replacement character", pattern: /�/ },
  { label: "snake_case enum token", pattern: /\b(?:half_day|in_progress|surprise_test|beat_topper|unit_test|class_test)\b/ },
  // Match the error phrasing, not the words themselves — the landing page
  // legitimately advertises "PostgreSQL with row-level security".
  {
    label: "raw database error",
    pattern:
      /violates row-level security policy|duplicate key value violates|violates (?:unique|check|foreign key) constraint|in the schema cache|permission denied for (?:table|relation)/i,
  },
  { label: "PostgREST code", pattern: /\bPGRST\d{3}\b/ },
];

async function assertNoInternalValues(page: Page, where: string) {
  const text = (await page.locator("body").innerText()).trim();
  expect(text.length, `${where}: page rendered nothing at all`).toBeGreaterThan(0);
  for (const { label, pattern } of FORBIDDEN_TEXT) {
    expect(pattern.test(text), `${where}: visible ${label} -> ${text.slice(0, 400)}`).toBe(
      false,
    );
  }
}

test.use({ storageState: { cookies: [], origins: [] } });

for (const path of ["/", "/auth", "/reset-password", "/definitely-not-a-route"]) {
  test(`no internal values are visible on ${path}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });

    await page.goto(path, { waitUntil: "networkidle" });
    await assertNoInternalValues(page, path);

    // A React "objects are not valid as a React child" crash shows up here.
    const fatal = consoleErrors.filter((e) =>
      /not valid as a React child|Objects are not valid/i.test(e),
    );
    expect(fatal, `${path}: React child-type errors`).toEqual([]);
  });
}

test("form inputs start empty rather than showing an internal default", async ({ page }) => {
  await page.goto("/auth", { waitUntil: "networkidle" });
  const inputs = page.locator("input:not([type=checkbox]):not([type=radio])");
  const count = await inputs.count();
  expect(count, "no inputs found on /auth").toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const value = await inputs.nth(i).inputValue();
    // An input may be legitimately prefilled, but never with these.
    expect(value).not.toMatch(/\[object|undefined|null|NaN/);
    expect(value).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
  }
});

test("the internal debug route is not reachable in a production build", async ({ page }) => {
  // In dev this route exists by design; the assertion that matters is that the
  // built bundle does not contain it (checked in CI by grepping dist/), and
  // that it never renders a JSON dump to an unauthenticated visitor.
  await page.goto("/student/_debug/weak-areas-v2", { waitUntil: "networkidle" });
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("Raw JSON");
});
