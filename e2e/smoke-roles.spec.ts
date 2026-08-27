/**
 * G8 live-smoke gate.
 *
 * "Do not type passwords into login forms, even for seeded demo accounts.
 * Authenticate programmatically instead — mint a session for each role via the
 * auth admin API or a signed test JWT, set it, and drive the screens from
 * there."
 *
 * Sessions are minted by scripts/mint-role-sessions.mjs and read from the path
 * in SMOKE_SESSIONS. They are seeded into localStorage with addInitScript, so
 * the app boots already signed in as that role and every query runs under that
 * role's real RLS — not as a bypassing superuser (G11).
 *
 *   node scripts/mint-role-sessions.mjs <tmp>/role-sessions.json
 *   SMOKE_SESSIONS=<tmp>/role-sessions.json PLAYWRIGHT_BASE_URL=http://localhost:PORT \
 *     npx playwright test e2e/smoke-roles.spec.ts --project=chromium
 *
 * What this asserts, per the gate: the screen loads, the console is free of
 * errors, and no figure rendered as `undefined%` / `NaN%` — the null-contract
 * failure that this whole build exists to prevent.
 */
import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "fs";

const SESSIONS_PATH = process.env.SMOKE_SESSIONS;

type MintedSession = {
  email: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
};
type Minted = { ref: string; url: string; roles: Record<string, MintedSession> };

const minted: Minted | null =
  SESSIONS_PATH && existsSync(SESSIONS_PATH)
    ? (JSON.parse(readFileSync(SESSIONS_PATH, "utf8")) as Minted)
    : null;

/** Screens each role actually lands on. */
const ROLE_SCREENS: Record<string, string[]> = {
  admin: ["/admin"],
  principal: ["/principal"],
  teacher: ["/teacher"],
  student: ["/student"],
  parent: ["/parent"],
};

// Noise that is not a product failure: dev-server HMR chatter, and the
// favicon/asset 404s a Vite dev server emits. Anything else counts.
const IGNORABLE = [
  /\[vite\]/i,
  /favicon/i,
  /Download the React DevTools/i,
  /ERR_CONNECTION_REFUSED.*ws:/i,
];

test.describe("G8 live smoke — every role, programmatic session", () => {
  // The chromium project reuses e2e/.auth/student.json, produced by the
  // password-based auth.setup. This gate deliberately does not depend on that:
  // it starts from a blank context and installs a minted session per role, so
  // no password is typed anywhere and each role is genuinely its own session.
  test.use({ storageState: { cookies: [], origins: [] } });

  // FAIL rather than skip. A skipped Playwright test still exits 0, so
  // running this gate without SMOKE_SESSIONS reported "5 skipped / PASS" —
  // a green gate that had asserted nothing at all. G8 says an unusable
  // session means the gate is INCOMPLETE, and G10 says a failure must not be
  // swallowed; a skip satisfies neither.
  if (!minted) {
    test("G8 live smoke gate is INCOMPLETE — no minted sessions", () => {
      throw new Error(
        "No minted sessions, so no role was actually exercised.\n" +
          "  node scripts/mint-role-sessions.mjs e2e/.auth/role-sessions.json\n" +
          "  SMOKE_SESSIONS=e2e/.auth/role-sessions.json PLAYWRIGHT_BASE_URL=http://localhost:PORT \\\n" +
          "    npx playwright test e2e/smoke-roles.spec.ts --project=chromium\n" +
          "Failing rather than skipping so this cannot read as a pass.",
      );
    });
  }

  for (const [role, screens] of Object.entries(minted ? ROLE_SCREENS : {})) {
    test(`${role} loads its screens with no console errors and no undefined%`, async ({
      page,
    }) => {
      const session = minted!.roles[role];
      expect(
        session,
        `No session was minted for ${role}; the gate is incomplete, not passed`,
      ).toBeTruthy();

      const storageKey = `sb-${minted!.ref}-auth-token`;
      const payload = JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        token_type: "bearer",
        expires_at: session.expires_at,
        expires_in: 3600,
        user: {
          id: session.user_id,
          email: session.email,
          aud: "authenticated",
          role: "authenticated",
        },
      });

      await page.addInitScript(
        ([k, v]) => window.localStorage.setItem(k as string, v as string),
        [storageKey, payload],
      );

      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text();
        if (IGNORABLE.some((re) => re.test(text))) return;
        errors.push(text);
      });
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

      // "Failed to load resource: 500" on its own names nothing. Record WHICH
      // request failed, so an intended breakage (a deliberately gutted RPC) is
      // distinguishable from a regression instead of both reading the same.
      page.on("response", async (res) => {
        if (res.status() < 400) return;
        const url = res.url();
        if (IGNORABLE.some((re) => re.test(url))) return;
        // Include the query string and the body: "HTTP 500" alone names
        // nothing, and the body carries PostgREST's actual reason.
        let body = "";
        try {
          body = (await res.text()).slice(0, 400);
        } catch {
          body = "(body unavailable)";
        }
        errors.push(`HTTP ${res.status()} ${url}\n      -> ${body}`);
      });

      for (const path of screens) {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        // The app resolves auth then loads data; give it room without a fixed
        // sleep masking a genuinely slow screen.
        await page
          .waitForLoadState("networkidle", { timeout: 45_000 })
          .catch(() => void 0);

        const body = (await page.locator("body").innerText()).slice(0, 200_000);

        // The null contract: no data must render as — , never as a broken number.
        expect(body, `${role} ${path} rendered undefined%`).not.toMatch(/undefined\s*%/i);
        expect(body, `${role} ${path} rendered NaN%`).not.toMatch(/NaN\s*%/);
        expect(body, `${role} ${path} rendered [object Object]`).not.toContain("[object Object]");

        // Landing on the login screen means the session was not accepted, which
        // would make a clean console meaningless (G11: a negative result must be
        // distinguishable from an inability to act).
        expect(
          page.url(),
          `${role} was bounced to auth — the session did not take, so this screen proves nothing`,
        ).not.toMatch(/\/(auth|login|unauthorized)\b/);
      }

      expect(errors, `${role} console errors:\n${errors.join("\n")}`).toEqual([]);
    });
  }
});
