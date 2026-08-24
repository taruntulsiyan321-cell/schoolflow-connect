import { test, expect, type Page } from "@playwright/test";

/**
 * Live walkthrough of EVERY page of EVERY panel, each signed in as its own
 * real demo account (docs/DEMO_ACCOUNTS.md — demo credentials only).
 *
 * This is the runtime half of the rendering-integrity work: the unit tests
 * and the static linter prove the boundary is correct and reachable, but only
 * a real browser against real data proves nothing internal is on screen.
 *
 * Each panel is one test so a failure in one does not hide the others, and
 * every page is reported rather than failing on the first hit.
 */

/**
 * Demo-only credentials, already published in docs/DEMO_ACCOUNTS.md and
 * hardcoded the same way in e2e/auth.setup.ts. Overridable so this can be
 * pointed at a non-demo environment without editing the file.
 */
const PASSWORD = process.env.E2E_DEMO_PASSWORD || "DemoPass123!";

type Panel = {
  name: string;
  email: string;
  /** Defaults to the shared demo password. */
  password?: string;
  urlPattern: RegExp;
  pages: string[];
};

const PANELS: Panel[] = [
  {
    name: "teacher",
    email: "priya.sharma@wisdomcampus.com",
    urlPattern: /\/teacher/,
    pages: [
      "/teacher",
      "/teacher/classes",
      "/teacher/doubts",
      "/teacher/communication",
      "/teacher/announcements",
      "/teacher/leave",
      "/teacher/profile",
      "/teacher/battleground",
      "/teacher/question-bank",
      "/teacher/ai-coach",
    ],
  },
  {
    // NOT arjun.mehta: e2e/auth.setup.ts documents that this repo's own test
    // runs left that account with hundreds of practice sessions / mistakes /
    // history rows, and its identity load is now slow enough that sign-in
    // times out. The dedicated QA account is the maintained one.
    name: "student",
    email: "qa.automation@wisdomcampus.com",
    password: process.env.E2E_QA_STUDENT_PASSWORD || "QaAutomation123!",
    urlPattern: /\/student/,
    pages: [
      "/student",
      "/student/practice",
      "/student/aicoach",
      "/student/analysis",
      "/student/recovery",
      "/student/revision",
      "/student/mistakes",
      "/student/battleground",
      "/student/chat",
      "/student/leaderboard",
      "/student/achievements",
      "/student/resources",
      "/student/doubts",
      "/student/homework",
      "/student/attendance",
      "/student/profile",
      "/student/timetable",
      "/student/calendar",
      "/student/tests",
      "/student/learning",
      "/student/class",
    ],
  },
  {
    name: "parent",
    email: "mehta.parent@wisdomcampus.com",
    urlPattern: /\/parent/,
    pages: [
      "/parent",
      "/parent/children",
      "/parent/insights",
      "/parent/marks",
      "/parent/notices",
      "/parent/chat",
      "/parent/notifications",
      "/parent/profile",
    ],
  },
  {
    name: "principal",
    email: "principal@wisdomcampus.com",
    urlPattern: /\/principal/,
    pages: [
      "/principal",
      "/principal/analytics",
      "/principal/teachers",
      "/principal/students",
      "/principal/classes",
      "/principal/exams",
      "/principal/attendance",
      "/principal/leaves",
      "/principal/cases",
      "/principal/announcements",
      "/principal/messages",
      "/principal/settings",
    ],
  },
  {
    name: "admin",
    email: "admin@wisdomcampus.com",
    urlPattern: /\/admin/,
    pages: [
      "/admin",
      "/admin/students",
      "/admin/teachers",
      "/admin/parents",
      "/admin/classes",
      "/admin/reports",
      "/admin/announcements",
      "/admin/examinations",
      "/admin/homework",
      "/admin/calendar",
      "/admin/leave-requests",
      "/admin/ai-analytics",
      "/admin/settings",
    ],
  },
];

/** Things that are always a bug when a user can read them. */
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
    label: "snake_case enum",
    pattern:
      /\b(?:half_day|in_progress|surprise_test|beat_topper|unit_test|class_test|monthly_test|half_yearly|mid_term)\b/,
  },
  {
    label: "raw database error",
    pattern:
      /violates row-level security policy|duplicate key value violates|violates (?:unique|check|foreign key) constraint|in the schema cache|permission denied for (?:table|relation)|PGRST\d{3}/i,
  },
  { label: "raw JSON payload", pattern: /\{\s*"[a-z_]+"\s*:/i },
];

async function signIn(page: Page, panel: Panel) {
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email or Mobile").fill(panel.email);
  await page.locator("#signin-password").fill(panel.password ?? PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page, `sign-in as ${panel.email} did not reach ${panel.urlPattern}`).toHaveURL(
    panel.urlPattern,
    { timeout: 40000 },
  );
}

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 300000 });

for (const panel of PANELS) {
  test(`${panel.name} panel — no internal values on any page`, async ({ page }) => {
    const problems: string[] = [];
    const reactErrors: string[] = [];
    let current = "/auth";

    page.on("console", (m) => {
      if (
        m.type() === "error" &&
        /not valid as a React child|Objects are not valid|Minified React error/i.test(m.text())
      ) {
        reactErrors.push(`${current}: ${m.text().slice(0, 200)}`);
      }
    });
    page.on("pageerror", (e) => reactErrors.push(`${current}: pageerror ${e.message.slice(0, 200)}`));

    await signIn(page, panel);

    for (const path of panel.pages) {
      current = path;
      await page.goto(path, { waitUntil: "domcontentloaded" });

      /*
       * Wait for the app to actually finish booting before scanning.
       * A fixed sleep is not enough: the auth provider shows
       * "Restoring your session…" for a variable time, and scanning that
       * spinner reports a clean page that never rendered — a false pass.
       */
      const settled = await page
        .waitForFunction(
          () => {
            const t = document.body?.innerText ?? "";
            if (!t.trim()) return false;
            if (/Restoring your session/i.test(t)) return false;
            // A page whose entire content is a loading word is not settled.
            if (/^\s*(Loading|Loading…|Preparing)/i.test(t) && t.trim().length < 40) return false;
            /*
             * The chrome (sidebar + header) renders long before the panel's
             * own data. An earlier version of this check passed on that shell
             * and reported a page "clean" that had never rendered content —
             * a false pass. Require the main region to have real text, and
             * require any panel-level "Loading X…" banner to have cleared.
             */
            const main = document.querySelector("main") ?? document.body;
            const mainText = (main as HTMLElement).innerText ?? "";
            return mainText.trim().length > 60;
          },
          { timeout: 45000 },
        )
        .then(() => true)
        .catch(() => false);

      /*
       * Soft wait for panel-level "Loading X…" banners. Some screens keep a
       * sub-panel spinner indefinitely (an AI card, say) and failing on that
       * would be a false alarm — but scanning before the main content paints
       * is a false pass. So: wait, then scan regardless.
       */
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

      const body = await page.locator("body").innerText();
      if (!settled) {
        problems.push(
          `${path}: never finished loading within 30s — still "${body.trim().slice(0, 60)}"`,
        );
        continue;
      }
      if (!body.trim()) {
        problems.push(`${path}: rendered nothing at all`);
        continue;
      }

      for (const { label, pattern } of FORBIDDEN) {
        const m = body.match(pattern);
        if (!m) continue;
        const idx = body.indexOf(m[0]);
        const context = body
          .slice(Math.max(0, idx - 100), idx + 100)
          .replace(/\s*\n+\s*/g, " ⏎ ");
        problems.push(`${path}  [${label}]  …${context}…`);
      }

      await page.screenshot({
        path: `test-results/live/${panel.name}${path.replace(/\//g, "_")}.png`,
        fullPage: true,
      });
    }

    const report = [...problems, ...reactErrors.map((e) => `REACT ERROR  ${e}`)];
    if (report.length) {
      console.log(`\n=== ${panel.name.toUpperCase()} FINDINGS (${report.length}) ===`);
      for (const r of report) console.log("  " + r);
      console.log("");
    } else {
      console.log(`\n=== ${panel.name.toUpperCase()}: clean across ${panel.pages.length} pages ===\n`);
    }

    expect(report, `\n${report.join("\n")}\n`).toEqual([]);
  });
}
