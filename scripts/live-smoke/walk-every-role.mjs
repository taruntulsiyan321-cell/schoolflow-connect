/**
 * LIVE SMOKE: every role, every screen, in a real browser, under real RLS.
 *
 *   npm run dev -- --port 5173 --host 127.0.0.1
 *   SUPABASE_ACCESS_TOKEN=... node scripts/mint-role-sessions.mjs <scratch>/sessions.json
 *   SP=<scratch> node scripts/live-smoke/walk-every-role.mjs
 *   SP=<scratch> ROLES=teacher,parent node scripts/live-smoke/walk-every-role.mjs
 *
 * WHY THIS EXISTS
 * This file replaces walk-student-screens.mjs, which was 28 lines of docblock
 * and NO CODE — it could never have run, and nothing noticed. The audit it
 * claimed to do is done here, for every role rather than one.
 *
 * audit-four-tabs.mjs looks hard at four student screens. This looks once at
 * all of them, for all five portals, because a defect that only shows up on
 * the teacher's copy of a student's data is invisible from inside the student
 * account — and most of what this product does is show one person's work to
 * somebody else.
 *
 * WHAT COUNTS AS A FINDING
 * An uncaught render error, a console error, a 4xx/5xx to Supabase, a screen
 * that renders almost nothing, or a raw placeholder (NaN, undefined, [object
 * Object], Invalid Date) reaching the DOM. Those last ones are the cheap proxy
 * for "the data did not arrive in the shape the screen expected".
 *
 * WHAT IT CANNOT TELL YOU
 * That the numbers are RIGHT. A screen showing a confident, wrong figure
 * passes here. Cross-account agreement is checked separately.
 *
 * BROWSER AND PROXY NOTES (this container)
 * Chromium 127+ on Linux uses the Chrome Root Store, so it ignores both the
 * system trust store and ~/.pki/nssdb. The agent proxy's CA is therefore
 * pinned by SPKI hash below: that trusts exactly one key and leaves every
 * other certificate verified normally. It is NOT --ignore-certificate-errors.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "fs";

const SP = process.env.SP, REF = "psqxykzqfvxgsvkmgurn";
const sessions = JSON.parse(readFileSync(`${SP}/sessions.json`, "utf8")).roles;
mkdirSync(`${SP}/audit`, { recursive: true });

/**
 * Every top-level screen each portal routes to. Routes taking an :id are left
 * out — there is no honest generic id — and so is anything that starts a
 * destructive action.
 */
const ROUTES = {
  student: ["", "practice", "analysis", "recovery", "revision", "mistakes", "homework",
            "attendance", "calendar", "chat", "class", "doubts", "fees", "leaderboard",
            "achievements", "aicoach", "battleground", "analytics"],
  teacher: ["", "my-class", "my-subjects", "classes", "attendance", "homework", "exams",
            "doubts", "chat", "notices", "announcements", "timetable", "reports",
            "resources", "question-bank", "question-papers", "performance", "insights",
            "practice", "profile", "battleground", "leave", "leaves", "connect",
            "communication", "ai-coach"],
  parent:  ["", "children", "attendance", "homework", "marks", "test-results", "fees",
            "notices", "announcements", "messages", "chat", "complaints", "insights",
            "notifications", "profile"],
  admin:   ["", "students", "teachers", "classes", "attendance", "exams", "fees",
            "homework", "notices", "timetable", "users", "roles", "reports",
            "question-bank", "question-bank-review", "ai-analytics", "settings",
            "profile", "calendar", "announcements", "leave", "leave-requests", "parents"],
  // Design-only shell: PrincipalApp renders autonomous-design fixtures and is
  // not wired to the academic engine at all. Walked so the audit says so out
  // loud rather than leaving a portal unvisited.
  principal: [""],
};

const BAD = [
  [/\bNaN\b/, "NaN on screen"],
  [/\bundefined\b/, "'undefined' on screen"],
  [/\[object Object\]/, "[object Object] on screen"],
  [/Invalid Date/, "Invalid Date on screen"],
  [/\bInfinity\b/, "Infinity on screen"],
];

const only = (process.env.ROLES ?? "").split(",").map(r => r.trim()).filter(Boolean);
const roles = Object.keys(ROUTES).filter(r => (only.length ? only.includes(r) : true));

const browser = await chromium.launch({ headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" },
  args: ["--no-sandbox","--disable-dev-shm-usage",
         "--ignore-certificate-errors-spki-list=KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk="] });

const findings = [];
const visited = [];

for (const role of roles) {
  const s = sessions[role];
  if (!s) { findings.push({ role, where: "-", kind: "NO SESSION", detail: `no minted session for ${role}` }); continue; }

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  let where = `${role}:boot`;
  const note = (kind, detail) =>
    findings.push({ role, where, kind, detail: String(detail).replace(/\s+/g," ").slice(0, 200) });

  page.on("pageerror", e => note("RENDER ERROR", e));
  page.on("console", m => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Realtime websockets cannot traverse the agent proxy; that is the harness.
    if (/WebSocket|realtime/i.test(t)) return;
    note("CONSOLE ERROR", t);
  });
  page.on("response", r => {
    const u = r.url();
    if (!/supabase\.co/.test(u) || /realtime/.test(u)) return;
    if (r.status() >= 400) note("HTTP " + r.status(), u.replace(/apikey=[^&]+/, "apikey=…").slice(0, 170));
  });

  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([r,t]) => localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
    access_token:t.access_token, refresh_token:t.refresh_token, expires_at:t.expires_at,
    expires_in:9999, token_type:"bearer", user:{id:t.user_id,email:t.email}})), [REF,s]);

  for (const route of ROUTES[role]) {
    where = `${role}/${route || "(home)"}`;
    await page.goto(`http://127.0.0.1:5173/${role}/${route}`, { waitUntil: "domcontentloaded" })
      .catch(e => note("NAV FAILED", e));
    await page.waitForFunction(() => {
      const t = document.body?.innerText ?? "";
      return t.length > 60 && !/Restoring your session/.test(t);
      // 12s, not 30s. Five portals at ~90 screens means a per-screen timeout is
      // multiplied by however many screens are slow, and a 30s one turned a
      // sweep into something that outlived the session watching it.
    }, { timeout: 12000 }).catch(() => note("SLOW", "never finished loading in 12s"));
    await page.waitForTimeout(900);

    const text = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ").trim();

    // Landing on the login screen or the unauthorized page means this role
    // cannot reach a route its own portal declares — worth more than a warning.
    if (/Sign in|Log in to/i.test(text) && text.length < 900) note("BOUNCED TO LOGIN", text.slice(0, 90));
    else if (/not authorized|Unauthorized/i.test(text)) note("UNAUTHORIZED", text.slice(0, 90));
    else if (text.length < 150) note("EMPTY SCREEN", `rendered ${text.length} chars`);

    for (const [re, msg] of BAD) {
      if (!re.test(text)) continue;
      const m = text.match(new RegExp(".{0,55}" + re.source + ".{0,55}"));
      note("PLACEHOLDER", `${msg} — …${(m?.[0] ?? "").trim()}…`);
    }
    visited.push({ role, route: route || "(home)", chars: text.length });
  }

  await page.screenshot({ path: `${SP}/audit/role-${role}.png`, fullPage: true }).catch(() => {});
  await ctx.close();
}

writeFileSync(`${SP}/audit/every-role.json`, JSON.stringify({ findings, visited }, null, 1));

console.log(`\nvisited ${visited.length} screen(s) across ${roles.length} role(s)`);
for (const role of roles) {
  const mine = findings.filter(f => f.role === role);
  const seen = visited.filter(v => v.role === role).length;
  console.log(`  ${role.padEnd(10)} ${String(seen).padStart(2)} screens, ${mine.length} finding(s)`);
}
console.log(`\n${findings.length} finding(s)\n`);
const dedup = new Set();
for (const f of findings) {
  const k = f.role + "|" + f.kind + "|" + f.detail.slice(0, 80);
  if (dedup.has(k)) continue; dedup.add(k);
  console.log(`  [${f.where}] ${f.kind}: ${f.detail}`);
}
await browser.close();
