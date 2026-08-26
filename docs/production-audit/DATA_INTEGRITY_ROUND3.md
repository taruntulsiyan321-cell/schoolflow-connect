# DATA INTEGRITY REPORT — Round 3 (Verification Pass)

**Date:** 2026-08-23
**Repo:** `schoolflow-connect` @ `d9a3208` (main) + the fixes in §6
**Project:** `psqxykzqfvxgsvkmgurn`
**Method:** Code + migration verification against the current tree. **No live DB access yet** —
`SUPABASE_ACCESS_TOKEN` not available this session, so every live-data claim below is marked
`NEEDS LIVE`. Nothing here is assumed from prior docs; each item was re-read in the current code.

> **Repo note:** this work began against a stale checkout at `e0859d8`. A second working copy at
> `D:\Projects\schoolflow-connect` was 13 commits ahead and was the copy actually running. Per
> instruction the two were combined: this tree fast-forwarded to `origin/main` (`d9a3208`) and D:'s
> untracked work was copied in. **This tree is now the single source of truth.** See §6.

---

## 0. WHY THIS ROUND EXISTS

The data-integrity spec has now been run three times:

| Round | When | By | Record |
|---|---|---|---|
| 1 | 2026-08-20 | this assistant | memory (`schoolflow-ai-nova-production-readiness`) |
| 2 | 2026-08-21/22 | user's own terminal | `docs/production-audit/*` (7 phase files + 3 reports) |
| 3 | 2026-08-23 | this pass | **this file** |

Round 2 produced a ~95-bug backlog (`DEEP_AUDIT_FINDINGS.md`) and then partially fixed it
across 20 migrations dated 2026-08-21→23. **Nobody had verified which of those 95 are actually
still open.** That is what this round does first — re-auditing from scratch would have wasted
effort re-finding already-fixed bugs, which is exactly what `CURRENT_STATE_VERIFIED.md`
warned against.

---

## 1. VERIFIED FIXED SINCE ROUND 2 — do not re-report

Each re-read in the current tree, not taken from the prior doc's claims.

| ID | Finding | Evidence in current tree |
|---|---|---|
| **S-01** | `match_question_bank` no `school_id` | `20260821180000_tenant_scope_semantic_search_rpcs.sql` — `p_school_id uuid` param added; **old 5-arg signature dropped**, not shadowed, so nothing can call the insecure version |
| **S-02** | `match_ai_answer_cache` no `school_id` | same migration, same shape |
| **S-06** | call sites omit `p_school_id` | `aiRouter.ts:3572,3580` — both now pass `p_school_id: req.actor.schoolId` |
| **S-03** | embedding jobs claimed globally | Investigated in-migration and **deliberately closed as not-a-bug**, with reasoning: `FOR UPDATE SKIP LOCKED` prevents the race, each job carries its own `school_id`, zero rows live. Grant hygiene applied instead. Agreed with this call. |
| **HW-01** | `is_late` forgeable | `20260822160000` — `submitted_at` made server-authoritative (`now()`, not client), trigger scoped to `TG_OP='INSERT' OR status IN ('submitted','late')` so grading UPDATEs are untouched |
| **HW-02** | due-date timezone skew | same migration — explicit `AT TIME ZONE 'Asia/Kolkata'` instead of implicit session-TZ cast. Was silently granting up to 5.5h of unearned grace on **every** submission |
| **BG-01** | battle XP double-count | `20260822230000` — `rpc_finish_battle` touches battle counters/streaks/badges only; grepped the whole function for any XP award, **zero**. Client `awardSafe('battle.participate')` is now the single writer, with an idempotency key |
| **QB-07 / FE-02** | `parseClassLevel` Roman numerals | `curriculumScope.ts:80` — regex now `\b(XII\|XI\|IX\|X\|VIII\|VII\|VI)\b`, full VI–XII map |
| **W-01** | calendar writes don't broadcast | `calendarEventsService.ts:135,178,196` — `broadcastAcademicWrite(ctx.schoolId, ["calendar"])` on create/update/remove |
| **W-03** | `"calendar"` missing from `AcademicDomain` | `src/academic/live/bus.ts:7` — present |
| **L-01…L-04** | library feature: tables, zero code | **Resolved by removal.** `20260823100000_drop_school_ops_unused.sql` drops `library_books`, `library_checkouts`, `staff_attendance`. Correct call — dead schema, not a feature to build |
| **AI-01** | prompt injection, no defense | **Partially.** `promptLibrary.ts:43` now declares retrieval/document fields untrusted; `responseValidator.ts` adds `injection_signal` tripwires. This is output-side detection + instruction hardening, **not** input sanitization — see §3 |

---

## 2. CONFIRMED STILL OPEN — verified in current code

### 2.1 CRITICAL — `clearClientAuthCaches()` is a complete no-op, and Nova conversations are globally shared

This is a **new root-cause finding**. Round 2 flagged the symptom (`FE-05`, "namespace localStorage
keys") but missed that the clearing function itself never matches anything.

**`src/auth/session.ts:165`** clears only keys prefixed `gurukul:` or `sf-cache:` (colon).
**Every key the app actually writes uses a different shape:**

| Key | Written at | Scoped by | Matched by the clear filter? |
|---|---|---|---|
| `gurukul.nova.convos.v1` | `gurukul/pages/AICoach.tsx:64,792` | **nothing — global** | ❌ dot, not colon |
| `gurukul.mistake.bookmarks.${user.id}` | `gurukul/pages/MistakeBook.tsx:573` | user id | ❌ dot, not colon |
| `recovery-success-history` | `lib/recoveryCompletionReport.ts:61` | **nothing — global** | ❌ no prefix |
| `app-settings` | `pages/shared/SchoolFeatures.tsx:620` | **nothing — global** | ❌ no prefix |

Grepped `src/` for `gurukul:` and `sf-cache:` prefixed keys: **zero**. The function has never
cleared a single key.

**Blast radius, in severity order:**

1. **`gurukul.nova.convos.v1` is global and never cleared.** Nova conversation history — which by
   design contains the student's weak concepts, wrong answers, and personal academic struggles —
   persists across sign-out and is loaded by **whoever logs in next on that device**. Shared school
   computer lab or a family tablet is the realistic case, and this app explicitly ships parent and
   student portals intended for the same household.
2. **`app-settings` is global and never cleared.** This caches *school* configuration
   (school_name, currency, locale, feature flags). Round 1 restructured the `app_settings` **table**
   to be per-school (`20260820140000_app_settings_per_school_root_cause.sql`) precisely to stop
   cross-school bleed — this frontend cache silently re-introduces the same bleed one layer up.
3. `recovery-success-history` — global, same pattern, lower sensitivity.
4. `gurukul.mistake.bookmarks.${user.id}` — user-scoped, so no cross-user read; only leaks storage.

**Root cause:** the writers and the cleaner were written against two different key conventions and
nothing ever checked they agreed. Classic "write path and read path disagree", applied to client
storage instead of a table.

### 2.2 HIGH — implicit sign-out clears nothing (`FE-01`)

`src/auth/AuthProvider.tsx:107-113` — the `onAuthStateChange` `SIGNED_OUT` branch clears React
state and returns early. It does **not** call `clearClientAuthCaches()` or `queryClient.clear()`.
Only the explicit `signOut()` button path (line 174-188) does.

The implicit path fires on token expiry, refresh failure, sign-out in another tab, and
server-side session revocation. In all of those, the **React Query cache retains the previous
user's marks, attendance, fees, and children** until each query refetches.

Note these two bugs compound: even fixing `FE-01` would clear nothing extra, because
`clearClientAuthCaches()` (§2.1) matches no keys. **Both must be fixed together** or the fix is
cosmetic.

### 2.3 HIGH — timetable has no write path at all (`W-04`)

`src/academic/services/timetableService.ts:84` — `TimetableService` exposes exactly one method,
`forClass()` (read). There is no create/update/remove/upsert. Teachers and admins cannot write
timetables through the service layer.

Related and still open: `"timetable"` is **missing** from the `AcademicDomain` union
(`src/academic/live/bus.ts:7` — `"calendar"` was added, `"timetable"` was not), so even if a write
path existed, `invalidateAcademicQueries` would not match it (`W-05`). `W-06` (no `probeTimetable`)
follows from the same gap.

### 2.4 MEDIUM — `types.ts` is stale against the schema

`src/integrations/supabase/types.ts` last regenerated **2026-08-21 17:51**; 15 migrations have
landed since. Concretely it still declares `library_books`, `library_checkouts`, and
`staff_attendance` — all three **dropped** on 2026-08-23 — and does not know about the
`schema_migrations` ledger table or `attendance_locks.school_id`'s new `NOT NULL`.

I checked the DDL of every post-`types.ts` migration: no column adds, no renames, so **no runtime
read/write mismatch is created by this drift today**. It is a correctness/tripwire issue, not a
live bug. Fix is `npm run db:types`.

Verified separately: the commit's claim that dropping those 3 tables broke no code is **true** —
grep finds references only inside `types.ts` itself, nowhere in real app code.

### 2.5 LOW — `S-04` embedding worker release still unscoped

`supabase/functions/_shared/embeddingWorker.ts:99-103` — the release-claim update filters
`.eq("id", job.job_id).eq("status","processing")` with no `.eq("school_id", …)`. Since `id` is the
primary key and status is checked, the practical race window is very small, and the table holds
zero rows. Genuine defense-in-depth gap, trivially fixable, correctly deprioritized.

---

## 3. NOT YET VERIFIED — requires live DB access

Blocked on `SUPABASE_ACCESS_TOKEN`. These are the items whose truth is a property of the **data**,
not the code, so no amount of reading settles them:

| ID | Claim as of 2026-08-21 | Why it matters |
|---|---|---|
| **QB-01** | **13,272 ACTIVE rows** in `question_bank` contain `` (U+FFFD) — 69% of the active bank | Highest-severity open item. U+FFFD is the *replacement* character: the original bytes are already destroyed, so this is **not** repairable by the CP1252 mojibake repair function (which matches `à¤`/`â€`/etc.). Needs a byte-level diagnosis before any repair is attempted — and possibly re-import rather than repair |
| **QB-02** | `class_level=5` rows archived (2189, `is_active=false`), but the `CHECK class_level BETWEEN 6 AND 12` is `NOT VALID` | Constraint not enforced against future inserts |
| **G1-6** | `exams.results_published_at` null on 2/2 exams → `marks published 0/10` | Blocks end-to-end verification of the entire marks→student→parent→principal chain (spec §14 TEST 4) |
| **G1-10** | `subjects` catalog has **0 rows** | Spec §7 makes subject a required link in the classification chain |
| **V-01 / AI-05** | `ai_kms_chunks` 0, `ai_kms_documents` 0, `ai_embedding_jobs` 0 | Semantic search silently always falls back to lexical |
| **CM-01** | client mastery formula diverges from server | Needs both formulas compared against real rows |
| — | orphan / duplicate / NULL sweeps, RLS live JWT tests, the 7 end-to-end flow tests | Spec §14–15 |

---

## 4. STATUS AGAINST THE SPEC'S DEFINITION OF DONE

| Spec section | State |
|---|---|
| 1. Full schema map | Partial — `types.ts` is authoritative but stale; needs live introspection |
| 2. Data lineage map | Not started this round |
| 3–5. Student/teacher/admin write-path audits | Covered by Round 2; **fix status now verified** (§1, §2) |
| 6–8. Normalization, classification, question DB | **Blocked** — QB-01 mojibake is the gate |
| 9. Write paths match read paths | One new confirmed failure (§2.1) |
| 10. Atomicity | Round 1 verified; `question_attempts` race documented, deliberately unfixed |
| 11. Duplicates | Round 1 swept clean; needs re-confirmation live |
| 12. Silent write failures | Round 1 swept; §2.1 is a *new* instance (a clear function that silently clears nothing) |
| 13. RLS / isolation | Extensively fixed R1+R2; §2.1/§2.2 are the client-side residue |
| 14. E2E consistency tests | **Not started** — needs live DB |
| 15. Reconciliation | **Not started** — needs live DB |

**Not production-ready.** The single largest open risk is QB-01 (69% of the active question bank
unreadable), and it cannot even be diagnosed without live access.

---

## 6. FIXES APPLIED THIS ROUND

### 6.1 Client storage tenant-scoping (§2.1 + §2.2) — FIXED, live-verified

New `src/lib/clientStorage.ts` is now the single owner of every localStorage key. Personal keys are
built as `gurukul:<name>:<schoolId>:<userId>` and **return `null` rather than falling back to a
shared key when identity is incomplete**, so no read or write can land on an unscoped key during
the auth-loading window. `app-settings` is school-scoped. `clearClientAuthCaches()` now delegates
to `clearAppStorage()`, which clears the namespace **and purges the four pre-fix legacy keys** so
data already sitting on real devices is removed rather than orphaned.

`AuthProvider`'s `onAuthStateChange` `SIGNED_OUT` branch now also clears storage and the React Query
cache, closing the implicit-signout path (token expiry, other-tab signout, server revocation).

Files: `src/lib/clientStorage.ts` (new), `src/auth/session.ts`, `src/auth/AuthProvider.tsx`,
`src/gurukul/pages/AICoach.tsx`, `src/gurukul/pages/MistakeBook.tsx`,
`src/pages/shared/SchoolFeatures.tsx`, `src/lib/recoveryCompletionReport.ts`,
`src/pages/student/RecoveryCompletionReportPage.tsx`.

**Live-verified in the running app** (not just unit tests). Seeded a browser with the exact four
pre-fix keys, then:

| Check | Result |
|---|---|
| All 4 legacy keys purged by `clearAppStorage()` | ✅ |
| Unrelated Supabase auth token survives (session not nuked) | ✅ |
| **Counterfactual: the OLD filter run verbatim left all 4 behind** | ✅ confirms it was a total no-op |
| Two students, same school → different Nova keys | ✅ |
| Same user, different school → different key | ✅ |
| Incomplete identity → `null`, never a shared key | ✅ |

Plus 6 new unit tests in `src/lib/clientStorage.test.ts` guarding the writer/cleaner agreement that
drifted in the first place.

### 6.2 `main` did not build — three defects, all pre-existing, FIXED

Discovered while verifying the merge: **`origin/main` (`d9a3208`) fails `npm run build`.** Confirmed
independently in the D: copy, so this is not merge damage. All three came from the theme/animation
codemods in commits `543e4b2` and later:

1. **`.${panel}` written literally into CSS** — an uninterpolated JS template placeholder in
   `src/gurukul-{admin,parent,principal,teacher}/theme.css` (11 rules each, 44 total). PostCSS
   aborted the build outright. Replaced with each file's own `.gurukul-<panel>` selector, which was
   already in use elsewhere in the same file.
2. **Duplicated `active` line** in `src/gurukul-parent/ParentApp.tsx:200` — a stray repeat inside a
   `cn()` ternary; esbuild parse error. Swept the codebase for the same pattern: no other instances.
3. **Curly quotes as JSX delimiters** in `Practice.tsx` (1 line) and `Revision.tsx` (4 lines) — an
   autocorrect-style corruption of `className=`/`title=` attributes. Repaired with a rule that
   preserves content: U+201C is always a broken delimiter here, while U+201D is kept when preceded
   by U+20AC because that is the tail of this codebase's mojibake em-dash (`â€”`) and is real string
   content, not punctuation.

After: `npm run build` ✅, `tsc --noEmit` ✅ 0 errors, `npm test` ✅ 424/424 across 40 files, and no
new ESLint errors (22 pre-existing `no-explicit-any` in `SchoolFeatures.tsx` before and after).

**This deserves attention beyond the fix**: `main` was pushed in a state that cannot build, and
nothing caught it. `PC-03` in `DEEP_AUDIT_FINDINGS.md` already flagged that CI runs 8 of 35 test
files with no build/typecheck/lint gate — this is that gap producing a real outage-class defect.

---

## 5. RECOMMENDED ORDER

1. **§2.1 + §2.2 together** — client cache leak. Self-contained, no DB needed, real user-facing
   privacy impact, and the two bugs make each other invisible.
2. **`npm run db:types`** — one command, removes a whole class of future drift.
3. **QB-01 byte-level diagnosis** — needs the token. Determine whether the 13,272 rows are
   recoverable at all before writing any repair.
4. **§2.3 timetable write path** — a genuinely missing feature, not a bug.
5. Live sweeps + the 7 E2E flow tests (spec §14).

---

## 7. ROUND 3 CONTINUED (2026-08-23, session 2)

Baseline on resume: `822b7c0`, build ✓, 429 tests ✓. The §6 fixes are committed.

### 7.1 `main` was failing CI's typecheck, and the student Attendance page was CRASHING — FIXED

`npx tsc --noEmit -p tsconfig.app.json` (the exact command CI runs) reported **3 errors on clean
`822b7c0`**, all in `src/gurukul/pages/Attendance.tsx`: `RECENT_MONTHS` and `calendarDays` — both
undefined.

This was not a type nit. The "Recent attendance" card had been refactored from a flat day grid into
month-grouped sections, and **the refactor was left half-applied**: the `useMemo` building
`monthGroups` was added and referenced a `RECENT_MONTHS` constant nobody defined, while the JSX below
still rendered the deleted `calendarDays`. esbuild bundles unknown identifiers as runtime globals, so
`npm run build` passed cleanly and the page threw `ReferenceError: calendarDays is not defined` the
moment any student opened Attendance.

Fixed by finishing the refactor: defined `RECENT_MONTHS = 3` and rendered the `monthGroups` the memo
already built, under explicit month headings (which was the refactor's whole point — a flat
day-of-month grid rendered `2020-01-02` as a bare "2" next to August's "6 7").

Pinned by `src/gurukul/pages/Attendance.test.tsx` (4 tests). It **renders the real component** — a
test that merely imported the module would have stayed green through the entire outage, because the
undefined identifier only executes in the JSX body.

### 7.2 The edge-function deploy pipeline was DEAD, not merely ungated — FIXED

`deploy-edge-functions.yml` ran `npm run functions:sync` as its first step. That script was a
Gemini-era helper **deleted from package.json in `e9c0fc5`** ("Remove Gemini entirely"), but the
workflow step was never removed. `npm run` on a missing script exits non-zero, so **this job has
failed at step 1 on every run since that commit** — no edge function has deployed through CI since.
Anything live got there by a manual `supabase functions deploy`, which means edge-function security
fixes from earlier campaigns reached production only if someone remembered to push them by hand.

Two further drifts in the same file: the hardcoded list named two functions that do not exist
(`ai-improvement-plan`, `ai-analytics-insights` — with `set -e`, the loop would have aborted there
anyway), and omitted five that do (`admin-link-account`, `send-otp`, `send-push`, `verify-otp`,
`verify-msg91-widget`).

Fixed by removing the dead step and **deriving the function list from disk** (excluding `_shared`,
requiring `index.ts`), which removes the drift class entirely; verified against the real tree — 14
functions found. Added `tsc` + `npm test` gates before deploy (PC-04). Also dropped the two stale
`config.toml` entries. **Note:** this widens deploy scope to the five previously-omitted functions,
so confirm the repo is source-of-truth for them before the `SUPABASE_ACCESS_TOKEN` secret is added.

### 7.3 `npm run build` added as a CI gate (PC-03)

The root cause behind §6.2 and §7.1 both: CI ran `tsc` but never `build`. All three §6.2 defects
passed `tsc` and still broke the build, because tsc never sees CSS and never runs esbuild's parser.
`npm run build` is now a hard gate in `quality.yml`.

### 7.4 W-04 / W-05 timetable write path — FIXED

`TimetableService` had exactly one method, `forClass()` (read). Teachers and admins could not write
a timetable through the service layer at all.

Added `upsertForClass()` and `clearForClass()`. Authorization is deliberately **stricter than the
read path**: reads accept any teacher assigned to the class, but the `class_timetables` RLS grants
writes only to admin/principal (same school) or the class teacher, so the service uses
`isClassTeacherOfClass`, not the looser `assertTeacherOwnsClass` — otherwise a subject teacher would
pass the service check and then hit an opaque RLS rejection. `school_id` is set explicitly, because
the admin/principal policy branch is `has_role(...) AND same_school(school_id)` and
`same_school(NULL)` is never true — a row inserted without it would be invisible and unwritable to
the very roles that own timetables.

`"timetable"` added to `AcademicDomain` (W-05) and to the query-key map — tsc caught the second one,
which is exactly the wiring gap W-03/W-05 described.

Also fixed while in the file: `forClass`'s `class_timetables` read filtered only by `class_id`,
relying on RLS alone for tenancy — the anti-pattern this campaign has been closing everywhere else.

### 7.5 S-04 embedding worker release scoping — FIXED

`.eq("school_id", job.school_id)` added to the release-claim update. This path fires precisely when
the worker has decided a job belongs to a *different* tenant, so the release must no-op if the row
is no longer the one inspected.

### 7.6 Audit findings re-verified as ALREADY FIXED — do not re-report

Each re-read in current code, not taken from the prior docs:

| ID | Claim | Actual state |
|---|---|---|
| **CM-01** (CRITICAL) | client mastery formula diverges from server | **Resolved.** `deterministicEngines.ts` is now 90 lines of mistake classification with no mastery formula; repo-wide grep finds zero client-side `mastery_score` computation. Server is sole source. |
| **AI-02 / TN-02** (CRITICAL) | marking-scheme sequence bypass via client `outline_text` | **Fixed**, with an explicit "AI-02 fix" gate: `outlineFromSession` is read only from server-written session memory, never from `structured.outline_text`. |
| **QB-01** (CRITICAL) | 13,272 active mojibake rows | **Fixed** per the live audit — 0 affected rows. |

### 7.7 Findings re-classified as NOT BUGS — deliberately not "fixed"

Acting on these as written would have introduced regressions:

- **PS-01 (`practice_sessions.accuracy` nullable, "UI shows NaN%").** The finish RPC is the only
  writer and always writes a number: `CASE WHEN _total > 0 THEN round(...) ELSE 0 END`. Since it also
  sets `finished_at`, `accuracy IS NULL` means *"session was never finished"* — semantically correct,
  not corruption. The suggested `COALESCE(accuracy, 0)` would be actively wrong: it would render an
  abandoned session as a real 0% score. The read path is already safe — `practiceSessionStats.ts`
  falls back to `deriveSessionAccuracy`, which guards `questionCount <= 0`, so NaN was never
  reachable. No change made.
- **RV-03 (`Math.round` → `Math.floor` on the revision due-date diff).** The stated premise
  ("yesterday 23:59 gives diff = −0.01") cannot occur: both dates are normalized with
  `setHours(0,0,0,0)` first. `Math.floor` would *introduce* a DST bug — across a 23-hour spring-forward
  day the diff is 0.958, which floors to 0 and would mislabel tomorrow as "Today". `Math.round` is
  correct here. No change made.

### 7.8 Still open

- **PC-02** — `bun.lockb` still present alongside `bun.lock` + `package-lock.json` (triple lockfile).
- **G1-10 / G1-6 / V-01** — `subjects` catalog empty, no exam has published results, KMS pipeline
  holds zero rows. All three are data/environment state, not code; each needs live DB access.
- Remaining MEDIUM/LOW items in `DEEP_AUDIT_FINDINGS.md` §§10–21 not yet re-verified.

### 7.9 CI was RED on `main`, on two independent blocking steps — both FIXED

Running each `quality.yml` step by hand against clean `822b7c0` showed the workflow could not have
been passing:

| Step | State on `822b7c0` | Cause |
|---|---|---|
| `quality:scan` | **FAIL** | `AICoach.tsx: Math.random on product path` |
| `tsc -p tsconfig.app.json` | **FAIL** | the 3 `Attendance.tsx` errors in §7.1 |

Both are blocking steps, so every push to `main` has been failing CI — which is also why the
unbuildable-`main` window in §6.2 went unnoticed for five commits.

**`quality:scan`** — `genId()` used `Math.random()` as a fallback when `crypto.randomUUID` is
unavailable. The rule exists to enforce this repo's no-fabricated-data policy, and the honest fix
was to remove the randomness rather than add an exemption: the ids are React keys and localStorage
keys, so a monotonic counter guarantees session uniqueness outright where six random base36
characters only made a collision unlikely. Passing the gate for the right reason, not by
allowlisting the thing the gate exists to catch.

### 7.10 `lint:tenant-scope` promoted to a blocking gate

It was added `continue-on-error: true` on 2026-08-21 with an explicit written condition — "until
each of the 114 is triaged into either a real fix or an ALLOWLIST entry with a specific reason."
**That condition is now met**: the script reports "PASS: no unexplained tenant-scoping gaps" and
exits 0, every allowlist entry carrying its own checkable justification (revoked from
anon/authenticated, `auth.uid()`-self-scoped, RLS-policy primitive, or a read-and-confirmed trigger
body). Left non-blocking it would be worse than never added — the backlog that justified the
exemption is gone, so any new finding is a genuinely new tenant gap.

### 7.11 PC-02 triple lockfile — FIXED

`bun.lockb` (legacy binary, bun v0) removed; `bun.lock` (text, lockfileVersion 1) supersedes it, so
this is behaviour-neutral for bun users. Verified nothing in CI or `vercel.json` invokes bun.

**Flagged, not changed:** `vercel.json` pins `buildCommand` but not `installCommand`, so Vercel
auto-detects a package manager from the remaining lockfiles while CI uses `npm ci` — production and
CI can still resolve dependencies differently. Pinning `"installCommand": "npm ci"` would close
that, but it changes how production installs and is a deploy-affecting decision, so it is left for
an explicit call rather than made silently.

### 7.12 Verified state at end of this pass

Every `quality.yml` step run individually against the working tree:

```
PASS  quality:scan          PASS  lint:tenant-scope
PASS  quality:student-context   PASS  tsc -p tsconfig.app.json
PASS  quality:flow          PASS  test  (433 tests, 42 files)
PASS  quality:guardrails    PASS  build
PASS  lint:render-safety
```

This is the first state in which the full gate passes end to end.
