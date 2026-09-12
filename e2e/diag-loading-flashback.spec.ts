import { test, expect } from "@playwright/test";

/**
 * A screen must not go BACKWARDS: content, then a loading state, then content.
 *
 * Measured on 2026-09-11, `profile` and `class` did exactly that — the body
 * went 806 chars, 123, 148, 850. Something rendered, was replaced by a loading
 * state, and came back. That is the most jarring loading pattern there is, and
 * it is the one skeletons exist to prevent; swapping a spinner for a skeleton
 * without fixing it would just make a nicer-looking flash.
 *
 * `useInitialLoadGate` is meant to stop this: it suppresses the loading state
 * on a refetch of the SAME subject and reopens only when the identity changes.
 * This samples each screen densely from first paint and fails if a loading
 * state appears AFTER real content has already been on screen.
 */

const SCREENS = [
  "/student/profile",
  "/student/class",
  "/student/attendance",
  "/student/tests",
  "/student/learning",
  "/student/analysis",
];

/** Body text long enough to be the real page rather than chrome + a skeleton. */
const CONTENT_CHARS = 400;

test("no screen replaces rendered content with a loading state", async ({ page }) => {
  test.setTimeout(300_000);
  const report: string[] = [];
  const offenders: string[] = [];

  for (const path of SCREENS) {
    await page.goto(path, { waitUntil: "commit" });

    let sawContent = false;
    let flashedBack = false;
    let sawLoadingAtAll = false;
    const trail: string[] = [];

    for (let i = 0; i < 90; i++) {
      const frame = await page.evaluate(() => ({
        loading: Boolean(document.querySelector('[role="status"][aria-busy="true"], [role="status"][aria-live="polite"]')),
        chars: (document.body.innerText ?? "").length,
      }));
      if (frame.loading) sawLoadingAtAll = true;
      // Content means: real body text AND no loading state on screen.
      if (!frame.loading && frame.chars > CONTENT_CHARS) sawContent = true;
      else if (frame.loading && sawContent) flashedBack = true;
      trail.push(`${frame.loading ? "L" : "."}${frame.chars}`);
      await page.waitForTimeout(150);
    }

    report.push(
      `${path.padEnd(24)} loadingSeen=${sawLoadingAtAll} contentSeen=${sawContent} wentBackwards=${flashedBack}`,
    );
    if (flashedBack) {
      offenders.push(`${path}: content → loading → content\n   ${trail.join(" ")}`);
    }
  }

  console.log(report.join("\n"));

  // POSITIVE CONTROL: if no screen ever rendered content in the window, the
  // "no flashback" result is vacuous — nothing could have flashed back.
  expect(
    report.filter((r) => r.includes("contentSeen=true")).length,
    `no screen reached a content state in the sample window, so this proves nothing:\n${report.join("\n")}`,
  ).toBeGreaterThan(3);

  expect(offenders, `these screens go backwards:\n${offenders.join("\n")}`).toEqual([]);
});
