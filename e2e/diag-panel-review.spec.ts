import { test, expect } from "@playwright/test";

/**
 * The whole student panel, every screen, desktop and mobile, captured for
 * review and checked for the defects that are cheap to assert.
 *
 * This is the sweep behind "verify it visually". The screenshots are the
 * deliverable; the assertions below are the parts a person should not have to
 * re-check by eye every time.
 */

const TEST_ID = process.env.PANEL_TEST_ID || "9ec48b96-284e-4ae3-970b-6f7efef49f73";

const SCREENS = [
  "/student",
  "/student/practice",
  "/student/aicoach",
  "/student/battleground",
  "/student/learning",
  "/student/analysis",
  "/student/recovery",
  "/student/revision",
  "/student/mistakes",
  "/student/class",
  "/student/attendance",
  "/student/homework",
  "/student/tests",
  "/student/timetable",
  "/student/calendar",
  "/student/doubts",
  "/student/leaderboard",
  "/student/resources",
  "/student/achievements",
  "/student/profile",
  "/student/notices",
  "/student/notifications",
  "/student/chat",
  "/student/fees",
  "/student/classes",
  `/student/test/${TEST_ID}/result`,
];

type Row = {
  path: string;
  chars: number;
  h1: string[];
  placeholders: string[];
  overflow: number;
};

/** Strings that should never reach a student. */
const PLACEHOLDER = /\b(null|undefined|NaN|\[object Object\])\b/;

test("review every student screen", async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  const rows: Row[] = [];

  for (const viewport of [
    { name: "desktop", width: 1280, height: 720 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const path of SCREENS) {
      await page.goto(path);
      await page.waitForTimeout(8000);

      const info = await page.evaluate((placeholderSource) => {
        const re = new RegExp(placeholderSource);
        const body = document.body;
        const text = body.innerText ?? "";
        // Placeholder text that is actually VISIBLE, element by element, so a
        // hidden debug node or a URL containing the word does not count.
        const placeholders: string[] = [];
        for (const el of Array.from(document.querySelectorAll("body *"))) {
          const own = Array.from(el.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => (n.textContent ?? "").trim())
            .join(" ");
          if (!own || !re.test(own)) continue;
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          placeholders.push(own.slice(0, 80));
        }
        return {
          chars: text.length,
          h1: [...document.querySelectorAll("h1")].map((h) => (h.textContent ?? "").trim().slice(0, 40)),
          placeholders,
          // Horizontal overflow: the page body must never scroll sideways.
          overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        };
      }, PLACEHOLDER.source);

      if (viewport.name === "desktop") rows.push({ path, ...info });

      const name = path.replace(/\//g, "_").replace(TEST_ID, "id");
      await page.screenshot({
        path: `test-results/panel-${viewport.name}${name}.png`,
        fullPage: false,
      });
      console.log(
        `${viewport.name.padEnd(7)} ${path.padEnd(32)} chars=${String(info.chars).padEnd(5)} h1=${info.h1.length} overflowX=${info.overflow} placeholders=${info.placeholders.length}`,
      );
    }
  }

  await testInfo.attach("panel-review", { body: JSON.stringify(rows, null, 2), contentType: "application/json" });

  // POSITIVE CONTROL: a walk that got bounced to /auth renders the same login
  // form on every path, and every assertion below would pass on it.
  const thin = rows.filter((r) => r.chars < 200).map((r) => `${r.path} (${r.chars} chars)`);
  expect(thin, `these screens rendered almost nothing:\n${thin.join("\n")}`).toEqual([]);

  const noHeading = rows.filter((r) => r.h1.length === 0).map((r) => r.path);
  expect(noHeading, `screens with no h1 at all:\n${noHeading.join("\n")}`).toEqual([]);

  const manyHeadings = rows.filter((r) => r.h1.length > 1).map((r) => `${r.path} → ${JSON.stringify(r.h1)}`);
  expect(manyHeadings, `screens with more than one h1:\n${manyHeadings.join("\n")}`).toEqual([]);

  const leaks = rows
    .filter((r) => r.placeholders.length > 0)
    .map((r) => `${r.path}: ${r.placeholders.join(" | ")}`);
  expect(leaks, `placeholder values rendered to the student:\n${leaks.join("\n")}`).toEqual([]);

  const sideways = rows.filter((r) => r.overflow > 0).map((r) => `${r.path} (+${r.overflow}px)`);
  expect(sideways, `screens that scroll sideways:\n${sideways.join("\n")}`).toEqual([]);
});
