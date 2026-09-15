/**
 * LIVE SMOKE: drive the real app, in a real browser, as a real student.
 *
 *   npm run dev -- --port 5173 --host 127.0.0.1
 *   SUPABASE_ACCESS_TOKEN=... node scripts/mint-role-sessions.mjs <scratch>/sessions.json
 *   SP=<scratch> node scripts/live-smoke/walk-student-screens.mjs
 *
 * WHY THIS EXISTS
 * Every gate in this repo checks the database or the types. None of them opens
 * the app. Two defects found on 2026-09-15 were invisible to all of them and
 * obvious within a minute of looking:
 *
 *   - chapter practice loaded NOTHING for a chapter holding 43 questions,
 *     because the chapter filter ran client-side over a capped fetch;
 *   - the Overview tab printed 10 correct, 14 incorrect and "Accuracy 36%",
 *     which is not what 10 of 24 comes to.
 *
 * BROWSER AND PROXY NOTES (this container)
 * Chromium 127+ on Linux uses the Chrome Root Store, so it ignores both the
 * system trust store and ~/.pki/nssdb. The agent proxy's CA is therefore
 * pinned by SPKI hash below: that trusts exactly one key and leaves every
 * other certificate verified normally. It is NOT --ignore-certificate-errors.
 * The repo's playwright pins a browser build this image does not carry, so
 * executablePath points at the pre-installed one.
 *
 * It uses a REAL GoTrue session from mint-role-sessions.mjs, so everything
 * runs under real RLS as that student and never as a bypassing superuser.
 */
