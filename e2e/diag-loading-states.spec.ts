import { test, expect } from "@playwright/test";

/**
 * Proves the claim this pass is built on: a student sees the screen's TITLE
 * while its data is still loading, not a spinner where the page should be.
 *
 * The old shape returned `<LoadingState />` INSTEAD of the page, so the title —
 * a hard-coded string needing no network — was hidden behind the network for
 * the 5-10 seconds these screens take. Sixteen screens did this; three more
 * returned a bare unlabelled spinning icon (one of them a rotating AlertCircle,
 * the error icon).
 *
 * WHY THE ASSERTION IS SHAPED THIS WAY
 *
 * "The title is on screen early" alone proves nothing — it would also pass if
 * the screen simply loaded fast. The check that carries weight is that the
 * title and the SKELETON are on screen AT THE SAME INSTANT: the page is
 * demonstrably still loading, and the title is already readable. That is the
 * whole change, stated so it can fail.
 *
 * A screen whose data lands before the first sample is reported as
 * "loaded-too-fast" rather than counted as a pass — a fast screen is not
 * evidence either way, and silently treating it as one is how a guard stops
 * being able to fail.
 */

const SCREENS: { path: string; title: string }[] = [
  // Paths come from PAGE_PATH in src/gurukul/nav.ts — several differ from the
  // page-component name (mistakebook → /student/mistakes, assignments →
  // /student/homework, learninghub → /student/learning, classhub →
  // /student/class). Notices and Notifications are routed directly in
  // StudentDashboard.tsx and have no PageKey.
  { path: "/student/analysis", title: "Analysis" },
  { path: "/student/homework", title: "Homework" },
  { path: "/student/attendance", title: "Attendance" },
  { path: "/student/calendar", title: "Calendar" },
  { path: "/student/class", title: "Class" },
  { path: "/student/doubts", title: "Doubts" },
  { path: "/student/learning", title: "Learning" },
  { path: "/student/leaderboard", title: "Rankings" },
  { path: "/student/mistakes", title: "Mistake Book" },
  { path: "/student/notices", title: "Notices" },
  { path: "/student/notifications", title: "Notifications" },
  { path: "/student/achievements", title: "Achievements" },
  { path: "/student/profile", title: "Profile" },
  { path: "/student/recovery", title: "Recovery" },
  { path: "/student/resources", title: "Resources" },
  { path: "/student/revision", title: "Revision" },
  { path: "/student/tests", title: "Tests" },
  { path: "/student/timetable", title: "Timetable" },
];

type Sample = {
  path: string;
  title: string;
  /** Both on screen in the same frame — the claim. */
  titleWithSkeleton: boolean;
  /** Data arrived before the first sample; proves nothing either way. */
  tooFast: boolean;
  /** The page never showed the title at all, even after settling. */
  noTitle: boolean;
};

test("every screen shows its title while its data is still loading", async ({ page }) => {
  // 18 screens, each sampled then allowed to settle. The default 60s per-test
  // budget is for a single interaction, not a walk.
  test.setTimeout(300_000);
  const samples: Sample[] = [];

  for (const screen of SCREENS) {
    await page.goto(screen.path, { waitUntil: "commit" });

    // One tight poll window. The screens take seconds; anything that has not
    // produced a skeleton within this is either instant or broken, and the two
    // are told apart below.
    let titleWithSkeleton = false;
    let sawSkeleton = false;
    for (let i = 0; i < 25 && !titleWithSkeleton; i++) {
      const frame = await page.evaluate((wanted) => {
        const skeleton = document.querySelector('[role="status"][aria-busy="true"]');
        const heading = [...document.querySelectorAll("h1")].some(
          (h) => (h.textContent ?? "").trim() === wanted,
        );
        return { skeleton: Boolean(skeleton), heading };
      }, screen.title);
      if (frame.skeleton) sawSkeleton = true;
      if (frame.skeleton && frame.heading) titleWithSkeleton = true;
      if (!titleWithSkeleton) await page.waitForTimeout(120);
    }

    // Let it finish so "the title never appears" can be told from "the title
    // appeared after the skeleton", which is the regression this replaces.
    await page.waitForTimeout(6000);
    const settledTitle = await page.evaluate(
      (wanted) =>
        [...document.querySelectorAll("h1")].some((h) => (h.textContent ?? "").trim() === wanted),
      screen.title,
    );

    samples.push({
      path: screen.path,
      title: screen.title,
      titleWithSkeleton,
      tooFast: !sawSkeleton,
      noTitle: !settledTitle,
    });
    console.log(
      `${screen.path.padEnd(28)} title+skeleton=${titleWithSkeleton}  sawSkeleton=${sawSkeleton}  titleAfterSettle=${settledTitle}`,
    );
  }

  // Nothing may be missing a title outright — that is the defect four screens
  // had before the PageHeader pass and Analysis still had after it.
  expect(
    samples.filter((s) => s.noTitle).map((s) => `${s.path} (expected h1 "${s.title}")`),
    "every screen must render its own h1",
  ).toEqual([]);

  const observable = samples.filter((s) => !s.tooFast);
  const failures = observable.filter((s) => !s.titleWithSkeleton);

  // POSITIVE CONTROL. If every screen loaded before the first sample there is
  // nothing to conclude, and a green result here would be the "check that
  // cannot fail" shape. Say so and fail rather than report success.
  expect(
    observable.length,
    `no screen was caught mid-load, so this run proves nothing about loading states.\n` +
      `Screens sampled: ${samples.length}. Re-run against a live backend.`,
  ).toBeGreaterThan(6);

  expect(
    failures.map((s) => `${s.path}: skeleton rendered without the "${s.title}" title`),
    "a screen that is loading must still show what screen it is",
  ).toEqual([]);
});
