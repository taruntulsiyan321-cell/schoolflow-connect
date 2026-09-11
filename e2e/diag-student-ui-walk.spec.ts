import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { createHash } from "node:crypto";

/**
 * Screenshot walk of every student screen, desktop + mobile, so the panel can
 * be reviewed as a whole rather than one screen at a time. Diagnostic.
 *
 * The first version of this walk PASSED while capturing 22 screenshots of the
 * login form, because its only assertion was `report.length === SCREENS.length`
 * — which proves the loop ran, not that anything rendered. The two guards at
 * the bottom, and the bounce check inside the loop, exist for that.
 */
const SCREENS = [
  "", "practice", "aicoach", "analysis", "recovery", "revision", "mistakes",
  "battleground", "leaderboard", "achievements", "resources", "doubts",
  "homework", "attendance", "profile", "timetable", "calendar", "tests",
  "learning", "class", "notices", "notifications",
];

const OUT = "e2e/.ui-walk";

test("walk every student screen", async ({ page }) => {
  test.setTimeout(SCREENS.length * 25000 + 60000);
  fs.mkdirSync(OUT, { recursive: true });
  const report: string[] = [];
  const consoleErrors: string[] = [];

  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`${page.url().split("/student/")[1] ?? "?"}: ${m.text().slice(0, 160)}`);
  });

  for (const s of SCREENS) {
    const name = s || "dashboard";
    const url = `/student/${s}`;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // Bounced to /auth means the storage state is not authenticated. Fail here:
    // a walk that silently screenshots 22 login forms looks exactly like a
    // successful walk.
    await expect(page, `${url} bounced to sign-in — storage state is not authenticated`)
      .toHaveURL(/\/student/, { timeout: 15000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/${name}-desktop.png`, fullPage: true });

    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
    // Fingerprint the WHOLE body, not a prefix. The first ~120 characters are
    // the sidebar and header, which are identical on all 22 screens — the
    // first version of this guard compared exactly that and reported 5
    // distinct bodies for a walk that had rendered all 22 correctly.
    const fingerprint = createHash("sha1").update(text).digest("hex").slice(0, 12);
    let row = `${name}\tchars=${text.length}\tfp=${fingerprint}\t${text.slice(0, 110)}`;

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${name}-mobile.png`, fullPage: true });
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    if (overflow.scrollW > overflow.innerW + 1) {
      row += `\tMOBILE-OVERFLOW ${overflow.scrollW}>${overflow.innerW}`;
    }
    report.push(row);
  }

  fs.writeFileSync(`${OUT}/report.tsv`, report.join("\n"));
  fs.writeFileSync(`${OUT}/console-errors.txt`, consoleErrors.join("\n"));
  console.log("\n===REPORT===\n" + report.join("\n"));
  console.log("\n===CONSOLE ERRORS (" + consoleErrors.length + ")===\n" + consoleErrors.slice(0, 40).join("\n"));

  expect(report.length).toBe(SCREENS.length);

  // Every screen rendering the SAME text means they all rendered one fallback
  // — a login form, an error boundary — not 22 screens.
  const bodies = new Set(report.map((r) => /fp=([0-9a-f]+)/.exec(r)?.[1] ?? r));
  expect(
    bodies.size,
    "every screen rendered identical text — that is one fallback, not 22 screens",
  ).toBeGreaterThan(SCREENS.length / 2);

  // And they must not all be near-empty, which is the other way a walk can
  // look successful while showing nothing.
  const median = report
    .map((r) => Number(/chars=(\d+)/.exec(r)?.[1] ?? 0))
    .sort((a, b) => a - b)[Math.floor(SCREENS.length / 2)];
  expect(median, "the median screen rendered almost no text").toBeGreaterThan(200);
});
