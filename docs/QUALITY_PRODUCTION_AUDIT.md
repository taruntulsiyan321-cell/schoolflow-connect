# Gurukul Quality Production Audit

**Date:** 2026-08-02  
**Role:** Lead Architect / QA Lead / Release Manager  
**Scope:** Production-grade quality infrastructure + remaining integrity bugs (not feature churn).

---

## Verdict

**Not fully production-ready** for whole-product release.  
**Student academic / practice / progression core: conditionally production-ready** if release gates below are green.

| Surface | Ready? | Gate |
|---------|--------|------|
| Student Gurukul (mounted) | **Near** | `npm run quality` green; shell readiness; no mock imports |
| Practice / Progression XP writes | **Yes** | Progression Engine / `ProgressionService.awardSafe` |
| Battleground data integrity | **Near** | Win-streak + W–L consistency fixed; Battle Rating still client-derived (labeled) |
| Teacher / Parent / Principal academic | **Yes** (core) | Engine services; messaging still empty stubs |
| Admin directory / ops | **No** | Local CRUD / settings still non-persisted (honest empty seeds) |
| Encoding | **Yes** if APPLY used | See `docs/ENCODING_SSOT.md` |

---

## 1. Categorized bug report

### Critical

| ID | Finding | Status |
|----|---------|--------|
| C1 | Admin account linking claimed auth side-effects with no API | **Fixed** — honest not-wired panel; no fake link/unlink success |
| C2 | Admin announcements / exams / leave / directory CRUD local-only | **Fixed** — Announcements/Exams Engine-wired; Leave via LeaveService; Parents live `parents`/`parent_students`; Students/Teachers re-export live admin pages |
| C3 | Admin Settings school identity not wired | **Fixed** — loads/saves `schools` row via Supabase |

### High

| ID | Finding | Status |
|----|---------|--------|
| H1 | Revision due labels off-by-one | **Fixed** |
| H2 | Battleground motivation used study streak as win streak | **Fixed** |
| H3 | Battleground W–L mixed lifetime wins with partial history | **Fixed** |
| H4 | No readiness gate → EMPTY_STUDENT Level 1 flash | **Fixed** — `assertStudentContext` + `shellReady` |
| H5 | `practiceSessionStats.xpFromDb` true for DEFAULT 0 unfinished | **Fixed** |

### Medium

| ID | Finding | Status |
|----|---------|--------|
| M1 | Client Battle Rating not engine-stored | Open (labeled) |
| M2 | Dual leaderboard paths | Open |
| M3 | Non-persisted 2FA / settings toggles | Open |
| M4 | Parent mark % UI fallback | Open |
| M5 | Practice duration ≥1 minute inflation | Open |

### Low

| ID | Finding | Status |
|----|---------|--------|
| L1 | DESIGN-ONLY fixtures unmounted | OK with `quality:scan` allowlist |
| L2 | `PRESENTATION_MODE` helpers unused | Safe while false + CI |

---

## 2. Root cause per Critical

**C1–C3:** Admin panel shipped as prototype with local `useState` success UX and no Auth/Directory service facade.  
**Architectural fix:** `AdminDirectoryService` + Announcement/Leave/Marks services; UI read-only or “not connected” until wired.

---

## 3. Files / modules (this pass)

Readiness, practice SSOT, progression tests, battleground integrity, revision due labels, admin AccountLinking honesty, `scripts/quality-scan.mjs`, CI `quality.yml`, `docs/ENCODING_SSOT.md`, this audit.

---

## 4. Architectural fixes

1. Progression SSOT via Engine / `ProgressionService`
2. `assertStudentContext` / `evaluateStudentContext` / `studentShellReady`
3. Practice display SSOT (`finished_at` for credited XP)
4. `npm run quality:scan` CI gate
5. AcademicLive drain + invalidate (safe self-heal; never auto-delete user data)
6. Encoding APPLY invariant documented

---

## 5. Implementation plan (remaining)

| P | Work |
|---|------|
| P0 | Keep CI quality required; wire or disable admin mutate |
| P1 | Unify Battleground LB on ProgressionService; optional draws column |
| P2 | Extend shellReady to LearningHub / AICoach |

---

## 6. Evidence

```bash
npm run quality:scan
npm run quality:student-context
npm run quality:flow
npm run quality:guardrails
npm run quality
```

Detects: missing student context / shell readiness, analytics placeholder labels (`Subject|Topic|Daily|General`), duplicate subjects (via `dedupeSubjectChartPoints`), XP invent fingerprints, `PRESENTATION_MODE === false`.

---

## 7. Remaining known issues

- Battle Rating client heuristic
- Draws folded into non-wins
- Messaging honest-empty
- DESIGN-ONLY fixtures remain unmounted
- Admin non-academic report tabs (account/platform/communication) honest placeholder — not Academic Engine
- Account linking auth admin APIs still not wired (honest empty panel)

### Cross-cutting supervisor note (Auth + SSOT + Live + Encoding + Quality) — 2026-08-03

| ID | Domain | Status | Fix |
|----|--------|--------|-----|
| AUTH-C1 | Auth | **Fixed** | `AuthProvider` request-id guard — stale `loadAuthContext` cannot overwrite newer session |
| AUTH-C2 | Auth | **APPLY required** | `handle_new_user` no longer binds `default_school_id`; see `docs/APPLY_AUTH_SIGNUP_NO_DEFAULT_SCHOOL.sql` + migration `20260803400000_*` |
| SSOT-C1 | SSOT | **Fixed** | Class-12 Math practice/session gated on `parseClassLevel(classLabel) === 12` |
| SSOT-C2 | SSOT | **Fixed (Analysis XP)** | Analysis class rank uses `ProgressionService.leaderboard`; subject battle boards may still use `rpc_leaderboard` |
| L1 | Live | **Fixed** | Focus/90s poll drains SyncEngine only — no `bump(["all"])` rematch storm |
| L2 | Live | **Mitigated** | `useInitialLoadGate` on student panels + homework; Chat first-load pattern retained |
| E1–E2 | Encoding | **Fixed** | Notices/Chat/Doubts repair via services; Analysis priority label uses `displayTopic/Chapter/Subject` |
| Q1–Q2 | Quality | **Prior** | Admin directory / AccountLinking honesty already on main (`d7ebdd6`); gates remain green |

**CEO:** Student academic core stays conditionally production-ready. Paste AUTH-C2 APPLY before next public self-signup wave. Parent/principal panels still have some ungated live spinners (High, not blocking student release). Admin ops local CRUD remains non-production.

---


| Issue | Status | Evidence |
|-------|--------|----------|
| **9** Doubt attachments | **Done** | `src/lib/productFeatureFlags.ts` + Doubt/Nova UI; Coming Soon / hide via config + `VITE_FF_*` |
| **11** Placeholder purge | **Partial** | Doubt purged hardcoded CHAPTERS / "General" / "not available"; scan+guardrails ban regression. Analysis/Practice generic labels still owned by other supervisors |
| **12** E2E student flow | **Gate** | Static contract spine: `npm run quality:flow` (`scripts/student-flow-validate.mjs`) |
| **13** Engineering guardrails | **Done** | `npm run quality:guardrails` + CI steps; complements `quality:scan` |

**Lead:** Flip attachment flags live only after storage/upload RPCs ship. Keep `UNAVAILABLE_FEATURE_MODE=coming_soon` until product wants hide. Run `npm run quality` before release.

---

## Release gate checklist

- [ ] `npm run quality:scan` passes
- [ ] Integrity unit tests pass
- [ ] `PRESENTATION_MODE === false`
- [ ] No mock imports on mounted student routes
- [ ] UTF-8 APPLY verified in target DB
- [ ] Admin ops labeled non-production
- [ ] AcademicLive mounted under AuthProvider
