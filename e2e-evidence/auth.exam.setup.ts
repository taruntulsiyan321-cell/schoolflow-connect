/**
 * Mint Playwright storageState for individual (exam) accounts.
 *
 * HOW AN EXAM ACCOUNT SIGNS IN (measured 2026-09-24):
 *   Auth.tsx Individual tab → pick exam → MSG91 OTP widget →
 *   verify-msg91-widget → linkOrCreatePhoneUser with
 *   syntheticEmailForExamAccount(phone, examCode) =
 *   `{digits}.{exam}@exam.vidyalaya.local` → client redeem via
 *   supabase.auth.verifyOtp({ token_hash, type: "email" }).
 *
 * Password /auth form uses phoneToSyntheticEmail → `@phone.vidyalaya.local`,
 * which cannot reach exam accounts. Automating MSG91 OTP needs a real SMS
 * or a backdoor — we do neither (HANDOFF / brief).
 *
 * Least invasive real harness: refresh an already-issued session
 * (E2E_EXAM_CUET_REFRESH_TOKEN or scratchpad sessions.json) and inject the
 * same localStorage key the app writes after OTP. That is a real GoTrue
 * session for a real exam account — not a fake role, not a service-role mint.
 */
import { test as setup, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { authFile } from "./roles";

const REF =
  process.env.VITE_SUPABASE_PROJECT_ID ||
  process.env.SUPABASE_PROJECT_ID ||
  "psqxykzqfvxgsvkmgurn";
const URL =
  process.env.VITE_SUPABASE_URL || `https://${REF}.supabase.co`;
const ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

const SP_CANDIDATES = [
  process.env.E2E_EXAM_SESSIONS_JSON || "",
  "C:/Users/Tarun/AppData/Local/Temp/claude/C--Users-Tarun-Documents-Default-Project-schoolflow-connect--claude-worktrees-rulings-artifact-worktree-40d771/7a42c032-dc70-46cc-aec6-c42fcf3b6a39/scratchpad/sessions.json",
].filter(Boolean);

type ExamRole = {
  role: "exam_cuet" | "exam_second";
  envRefresh: string;
  scratchKey: string;
  home: RegExp;
};

const EXAMS: ExamRole[] = [
  {
    role: "exam_cuet",
    envRefresh: "E2E_EXAM_CUET_REFRESH_TOKEN",
    scratchKey: "exam_cuet",
    home: /\/student/,
  },
  {
    role: "exam_second",
    envRefresh: "E2E_EXAM_SECOND_REFRESH_TOKEN",
    scratchKey: "exam_second",
    home: /\/student/,
  },
];

function loadScratchRefresh(key: string): string | null {
  for (const p of SP_CANDIDATES) {
    if (!p || !existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      const t = j?.roles?.[key]?.refresh_token;
      // GoTrue refresh tokens can be short opaque strings (measured: 12 chars).
      if (typeof t === "string" && t.length >= 8) return t;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function refreshSession(refreshToken: string) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error(`refresh failed HTTP ${r.status}: ${j.error_description || j.msg || "no token"}`);
  }
  return j as {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
    expires_in?: number;
    user: { id: string; email?: string };
  };
}

setup.beforeAll(() => {
  mkdirSync("e2e-evidence/.auth", { recursive: true });
  for (const e of EXAMS) {
    if (!existsSync(authFile(e.role))) {
      writeFileSync(authFile(e.role), JSON.stringify({ cookies: [], origins: [] }));
    }
  }
});

for (const account of EXAMS) {
  setup(`auth ${account.role}`, async ({ page }) => {
    const fromEnv = process.env[account.envRefresh];
    const refresh =
      (fromEnv && fromEnv.length >= 8 ? fromEnv : null) || loadScratchRefresh(account.scratchKey);
    if (!refresh) {
      setup.skip(
        true,
        `${account.role}: no refresh token. Set ${account.envRefresh} or provide scratchpad sessions.json. OTP cannot be automated without a backdoor.`,
      );
      return;
    }
    if (!ANON) {
      setup.skip(true, "VITE_SUPABASE_PUBLISHABLE_KEY missing");
      return;
    }

    const session = await refreshSession(refresh);
    const storageKey = `sb-${REF}-auth-token`;
    const value = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
      expires_in: session.expires_in ?? 3600,
      token_type: "bearer",
      user: session.user,
    };

    await page.goto("/auth");
    await page.evaluate(
      ([key, val]) => localStorage.setItem(key, JSON.stringify(val)),
      [storageKey, value] as [string, typeof value],
    );
    await page.goto("/student", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(account.home, { timeout: 45000 });
    await expect(page).not.toHaveURL(/\/auth(\?|$)/);
    // Positive control: must not be a school-student empty panel crash.
    //
    // Wait for the shell to RENDER, do not sample it once. The first page
    // after a session is injected pays for the auth bootstrap, the identity
    // RPC and the shell's own reads, and until those land it draws a skeleton
    // with no text in it at all. Measured 2026-09-24: reading immediately
    // returned 38 characters and failed this check on a panel that was
    // perfectly healthy a second later. A timeout here is still a real
    // failure — a shell that never renders never satisfies the wait.
    await page
      .waitForFunction(() => (document.body?.innerText ?? "").trim().length > 80, null, {
        timeout: 45000,
      })
      .catch(() => {});
    const body = (await page.textContent("body")) ?? "";
    expect(body.length, "student shell rendered content").toBeGreaterThan(80);
    expect(body, "not unauthorized").not.toMatch(/No portal role|unauthorized/i);

    await page.context().storageState({ path: authFile(account.role) });
    writeFileSync(
      `e2e-evidence/.auth/${account.role}.status.json`,
      JSON.stringify(
        {
          reachable: true,
          authed: true,
          email: session.user.email ?? null,
          user_id: session.user.id,
          note: "minted via refresh_token (OTP not automated)",
        },
        null,
        2,
      ),
    );
  });
}
