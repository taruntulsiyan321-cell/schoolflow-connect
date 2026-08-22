# Phase 0 — Architecture Map & Risk Register

**Campaign:** Full production-readiness audit and repair (SchoolFlow Connect / Gurukul)
**Date generated:** 2026-08-21 — updated in-place via live code inspection 2026-08-21 (Phase 0 deep re-verify, no code changes)
**Status:** Phase 0 complete. Phase 1 (data integrity) gated on this doc.
**Supersedes prior:** Snippet from earlier 2026-08-21 map preserved; this version expands to cover every system in the campaign brief. Do not create dated copies — update in place.
**Workspace:** `C:\Users\Tarun\Documents\Default Project\schoolflow-connect` — git `a1737f4` `origin/main`, Supabase project `psqxykzqfvxgsvkmgurn`

---

## 0. How this map was built

* Static inspection only per Phase 0 rules — no migration applied, no DB queried live, no code mutated.
* 258 migration files read via `supabase/migrations/*`, 147 `src/academic/**/*` files, 54 `src/lib/*`, 18 `supabase/functions/*` + 35 `_shared`, 5 panels (`gurukul`, `gurukul-admin`, `gurukul-teacher`, `gurukul-parent`, `gurukul-principal`), `src/auth/*`, `src/components/*`, `src/pages/*`.
* Every claim below cites the file that *actually* implements it (not filenames/comments assumed correct). Where code says “TODO / Coming Soon / hide” that truth is preserved — no data fabricated.

---

## 1. System overview

**Stack:** Vite 5.4 + `@vitejs/plugin-react-swc` + React 18 + TS 5.8 + React Router 6.30 + TanStack Query 5.83 (installed but unused for academic reads) + shadcn/ui (Radix 20 primitives) + Tailwind 3.4 + `framer-motion` + `recharts` + `katex` + `react-markdown` + `pdfjs-dist` + Supabase JS 2.105 + Capacitor 8.3 (`appId study.gurukul.app`, `webDir dist`, `android/` shell present) + Vercel SPA rewrite `vercel.json:3` `/(.*)->/index.html`.

**App is a pure SPA + Supabase backend.** There are **no Next.js API routes / server actions / custom backend** — all writes are direct Supabase `from().insert/upsert` or `rpc()` calls gated by Postgres RLS + `SECURITY DEFINER` RPCs. `src/app.tsx:1` mounts `QueryClientProvider > TooltipProvider > BrowserRouter > AuthProvider > AcademicLiveProvider` — no server.

**Tenant model is retrofit:** `schools` became the tenant root on `20260730010000_complete_panel_database.sql` (not Day 1). Every tenant table carries `school_id uuid FK schools(id) + index`. Helper `get_my_school_id()` resolves `auth.uid() -> profiles/teachers/students/parents.school_id` (`20260730000000_auth_multitenant_foundation.sql`). RLS template: `USING (has_role(auth.uid(),'admin') AND same_school(school_id))` with `WITH CHECK` twin — hardening swept 2026-08-08 .. 2026-08-20 (10+ migrations in last 24h alone: `20260820130000_battle_family_school_id_root_cause.sql`, `20260820150000_remaining_tenant_isolation_sweep.sql`, `20260820240000_close_marks_classmate_read_leak.sql`, etc.).

**Codebase size:** `src/academic/services/practiceService.ts:1521` lines, `supabase/functions/_shared/aiRouter.ts:4200` lines, `PrincipalApp.tsx:709` lines — flagged by `CLAUDE.md` 500-line rule but not a correctness blocker.

---

## 2. Frontend architecture

### 2.1 Entry & providers `src/App.tsx:1`, `src/main.tsx:1`
`createRoot(#root) -> <App>` imports `gurukul-brand.css + index.css`. `App` lazy-splits only the 5 dashboards (`lazy(() => import("./pages/*Dashboard"))`); public pages eager. `Suspense` fallback `Loading…`. Provider order matters: `QueryClient` outermost (for `invalidateAcademicQueries`), then `AuthProvider` (`onAuthStateChange` + `getSession`), then `AcademicLiveProvider` (needs `user/schoolId/role`).

### 2.2 Routing — global `src/App.tsx:22`
```
/ -> Index (Landing or dashboardForRole redirect)
/auth -> Auth (707 lines, dual Password|OTP, RolePicker student/parent)
/login,/signup -> Navigate /auth
/reset-password -> ResetPassword (152 lines, PASSWORD_RECOVERY guard)
/unauthorized -> ProtectedRoute -> Unauthorized (100 lines, MESSAGES[reason])
/admin/* -> allow [admin,super_admin] -> AdminDashboard -> gurukul-admin/AdminApp.tsx (302 lines, 13 keys)
/principal/* -> [principal] -> PrincipalApp.tsx (709 lines, 12 keys)
/teacher/* -> [teacher] -> TeacherApp.tsx (325 lines, 10 keys)
/student/* -> [student] -> StudentDashboard.tsx (339 lines) -> GurukulStudentProvider -> Layout.tsx (721 lines, 18 keys + legacy)
/parent/* -> [parent] -> ParentApp.tsx (437 lines, 8 keys)
* -> NotFound
```
`vite.config.ts:5` `host "::" port 8080 hmr.overlay:false`, `playwright.config.ts:8` `baseURL localhost:8080`. Vercel `vercel.json` SPA rewrite fixes prior `/auth` 404.

### 2.3 Guard `src/components/ProtectedRoute.tsx:64`
`loading -> spinner "Restoring your session…"`, `!user -> Navigate /auth state:from`, `pathname===/unauthorized` bypass loop, `disabled/missing_profile -> /unauthorized`, `allow && !role -> missing_role`, `allow && !allow.includes(role) -> forbidden (homePath)`. Breaks the infinite loop that pre-refactor caused.

### 2.4 Per-portal routers

**Student** `gurukul/nav.ts:122` `PageKey` 22 keys, `PAGE_PATH` under `/student`, `pathToPage()` + `legacyClassesRedirectPath()` (hash `#attendance|fees|chat` -> hubs). Inner `Routes` under `/student`:
`index->Dashboard, practice, aicoach (Nova 1203 lines), analysis, recovery, revision, mistakes (MistakeBook), battleground + /battle/:id/report/:participantId, leaderboard, achievements, resources, doubts, homework, attendance, profile, timetable, calendar, tests, learning, class, recovery/:id/complete|result, practice/math12/session, _debug/weak-areas-v2, dpp/:id/attempt|result, chat (userRole=student), notices, notifications, fees, classes#hash redirect, *->/student`.
Shell `GurukulStudentProvider` merges `StudentAcademicIdentity` + `ProgressionService.getSnapshot` + `rpc_student_academic_snapshot` + `rpc_student_performance_charts` with `useLatestEffect` race guard + `AcademicLive` version.

**Admin** `gurukul-admin/nav.ts:75` 13 keys `dashboard|students|teachers|parents|classes|reports|announcements|examinations|homework|calendar|leave_requests|ai_analytics|settings`, `AdminApp.tsx:302` 4 NavGroups (Overview/Users/Academic/System), collapsed/mobile sidebar, breadcrumb `Admin / TITLES[page]`.

**Teacher** `gurukul-teacher/nav.ts:76` 10 keys `dashboard|myclasses|doubts|communication|announcements|leave|profile|battleground|questionbank|aicoach`, `TeacherApp.tsx:325` unread `MessageService.countUnread` badge, `RedirectTeacherClassTab` via `sessionStorage teacher.openTab` for legacy `exams|performance|homework|dpp`.

**Principal** `gurukul-principal/nav.ts:79` 12 keys `dashboard|analytics|teachers|students|classes|examinations|attendance|leaves|cases|announcements|messages|settings`, `PrincipalApp.tsx:709` inlined 6 live components `PrincipalSchoolOverview/ClassRollups/StudentRankings/AttendanceLive/TeachersLive/HomeworkLive` + `AnnouncementService.listForSchool` publish flow + `CasesPage inquiries|complaints`.

**Parent** `gurukul-parent/nav.ts:47` 8 keys `dashboard|children|academic_insights|test_results|announcements|messages|notifications|profile`, `ParentApp.tsx:437` `ActiveChild` selector `useParentLiveChildren()`, deep-link seeding, `AcademicInsights` via `useAcademicContext` SSOT.

Pages `src/pages:70+` files: `Landing.tsx`, `admin/ClassesAdmin, StudentsAdmin, TeachersAdmin, RolesAdmin, FeesAdmin`, `teacher/BattleMonitor, TeacherBattleground`, `student/Battleground, DppAttempt/Result, PracticeSessionResult, Class12*(Math/Ai)`, `principal/PrincipalClasses` etc.

### 2.5 Components `src/components:~120`
Shell `AppLayout.tsx:192` (desktop 64w sidebar + mobile Sheet + bottom nav `MOBILE_PRIMARY=4`), `ProtectedRoute`, `PushNotificationsBootstrap` (7 lines side-effect only), `MathText.tsx` (KaTeX), `NovaMarkdown.tsx` (safe markdown + `rehype-katex` + `remark-math`), `NotificationBell`. Domain `community/CommunityDoubtPortal`, `dpp/ScoreRing+QuestionRenderer`, `student/dashboard/StudentMissionDashboard, flow/FlowDesign, analytics/* (AcademicAnalyticsDashboard, AnalyticsStudio, WeakConceptInsights), practice/PracticeHubPage, recovery/RecoveryHubPage`, `battleground/ArenaHub+LiveBattleCard+Leaderboard`, `learn/ExplainPanel`. `ui/` 40 shadcn files.

### 2.6 Hooks `src/hooks:18`
`useAuth.tsx` re-exports `AuthProvider`, `useAcademicBrain:28`, `useAcademicCoach:136` (ConceptMastery+mistakeAnalytics+pipeline `mergeCoachIntoInsights`), `useStudentAcademicSnapshot:72` (`rpc_student_academic_snapshot` + `useAcademicLive` filter + `useInitialLoadGate:23` anti-flicker), `useConceptMastery:45`, `useRecoveryZone:158` (`rpc_student_recovery_zone` + `isGenericAcademicLabel` filter), `useAnalysisPageData:254`, `useStudentXp:96` (`ProgressionService.getSnapshot` + `student-xp-updated` event), `useNotifications:128` (50 limit + realtime `notif-<userId>` + `markRead/allRead/remove`), `usePushNotifications:40` (Capacitor native `device_tokens` upsert), `useLatestEffect:34` race guard, `useInitialLoadGate`.

### 2.7 `src/lib:54` utilities
Guardrails `presentationMode.ts PRESENTATION_MODE=false`, `qualityGuards.ts isGenericAcademicLabel/dedupeSubjectChartPoints/buildSubjectRadarPoints/hasXpInventFingerprint (1382/Arjun Sharma)`, `productFeatureFlags.ts:119 UNAVAILABLE_FEATURE_MODE coming_soon|hide` + `DOUBT_ATTACH image/camera/pdf/voice false` + `NOVA attachment:true voice:false` + `DECISION_ENGINE weakAreasV2/revisionV2 false`. Practice lifecycle `practiceSessionSnapshot/persistence/stats/diversity/templatePracticeLoader`. Analytics `studentAnalysisMetrics/learningMetrics/deterministicEngines computeSessionAnalytics/classifyMistake/computeMasteryScore`. Curriculum `curriculumScope/ncertSyllabus/class12Subjects`. Validation `phone/emailValidation/loginIdentifier/msg91Widget+msg91Auth`. UTF `utf8MojibakeRepair.ts` SSOT. Battle `battlegroundHelpers/battleTemplateSolo`.

---

## 3. Auth, organization, roles

### 3.1 Types & constants `src/auth/types.ts:55`, `constants.ts:91`
`AppRole super_admin|admin|principal|teacher|student|parent`, `PortalRole Exclude<super_admin>`, `AuthSchool/AuthProfile/AuthContextData`, `AuthStatus loading|authenticated|unauthenticated|disabled|missing_profile|missing_role`. `ROLE_HOME admin:/admin principal:/principal teacher:/teacher student:/student parent:/parent`, `ROUTE_ALLOW` prefix map, `ROLE_MODULES` per role, `DEFAULT_SCHOOL_ID 000...001`.

### 3.2 Session resolution `src/auth/session.ts:176`
`ROLE_PRIORITY super_admin>admin>principal>teacher>student>parent` + `pickRole()`. `resolveRole(userId)` calls `link_portal_on_auth(_uid)` then `user_roles` select, if empty calls `ensure_default_role` (portal link only, never synthetic student) then reselect. `loadAuthContext(userId)` role-first via `resolveRole`, then optional `get_auth_context` RPC enriching profile/school but never overwriting role, fallback to `profiles(id,email,full_name,photo_url)` + `profiles(school_id,is_active)` + `schools(name,slug,logo_url)`. `clearClientAuthCaches()` wipes `gurukul:*` + `sf-cache:*`.

### 3.3 Provider `src/auth/AuthProvider.tsx:252`
`Ctx {user,session,role,profile,school,schoolId,loading,isAuthenticated,status,signIn,requestPasswordReset,updatePassword,signOut,refreshAuth,homePath}`. `AUTH_CONTEXT_TIMEOUT_MS 15000` race-bound via `contextRequestId` monotonic + `Promise.race`. `onAuthStateChange` handler captures `requestId` synchronously before `setTimeout(applyContext,0)` to avoid deadlock/resurrection after logout (commented fix). `signIn` `signInWithPassword` + `mapAuthError`, `signOut` bumps counter + `clearClientAuthCaches + queryClient.clear`. `status` derived: `loading -> !user -> !ctx -> !isActive -> !role -> authenticated`.

### 3.4 Tenant helpers `src/academic/tenant.ts:1082`, `src/auth/tenant.ts:5`
`requireSchoolId/resolveSchoolId/scopeBySchool`, `MissingSchoolContextError` fail-closed (never invent tenant).

### 3.5 Service-layer RBAC `src/academic/services/context.ts:71`
`ServiceContext {schoolId,userId,role,teacherId?,studentId?,classId?,classLabel?,classCategory?}`. `toRepoContext`, `asOwnerRole` (never maps `super_admin` into portal ownership), `assertCanOwn(entity)` / `assertCanConsume(entity)` via `ENTITY_OWNERSHIP` + `canOwn/canConsume`. `isSchoolOperator` admin|principal override.

### 3.6 Student context `src/academic/services/assertStudentContext.ts:106`, `resolveStudentContext.ts:219`
`assertStudentContext` requires `role=student + schoolId`, `evaluateStudentContext({requireStudentRow,requireClass}) -> StudentContextReadiness`, `assertStudentClassContext` adds `studentId+classId`, `studentShellReady({academicReady,progressionLoaded})`. `loadStudentAcademicIdentity` prefers `rpc_get_my_student_identity` SECURITY DEFINER; fallback `link_portal+ensure_default_role+get_my_role+students/classes` join + RLS-fallback single-class fetch. `identityToServiceContext` enforces `studentId + (role=student || hasStudentRole)`. `resolveStudentServiceContext()` for non-React paths.

### 3.7 Organization hierarchy
`ORGANIZATION = schools` (tenant root). `schools {id,name,slug,logo_url,board,stream,category}` board `rbse|cbse|icse|other|both` + stream `commerce|science|arts|null`. `profiles {id (=auth.users.id), school_id, full_name,email,photo_url,is_active}` every user has one. `user_roles {user_id,role}` one row, priority pick. `parents {id,user_id,school_id}` + `parent_students {parent_id,student_id,school_id}` link (dual linkage: legacy `students.parent_user_id` + new `parent_students` — both supported in `aiRouter:316 parent check` + `20260820170000_parent_students_linkage_root_cause.sql`). Class-teacher is `teachers.class_teacher_of` / `teacher_classes` assignment, not a separate role.

**Permission hierarchy:** `super_admin` platform (outside school) -> `admin` school CRUD -> `principal` analytics/read-most + announcements/teacher oversight -> `teacher` class-scoped (via `teacher_teaches_class(_user_id,_class_id)`) -> `student` self-only -> `parent` child-linked. Verified in `aiRouter:assertMayAccessStudent` + `parentAccess.ts:3698` + `teacherClassesRepository`.

---

## 4. Database schema (258 migrations `supabase/migrations/20260*`)

### 4.1 `src/integrations/supabase/types.ts:~8500` — ~110 tables
Tenant/school `schools, profiles, user_roles, app_settings, academic_terms, academic_years, school_calendar_events, school_inquiries/complaints, school_activity_feed, approval_requests, learning_resources, subjects`.
People `students, teachers, teacher_classes, parents, parent_students, classes, timetable_slots/class_timetables, teacher_remarks`.
Academics `attendance (+ audit/locks), homework/homework_submissions, exams/marks, fees, notices, library_books/checkouts, messages/attachments/read_receipts, chat_conversations/participants, community_doubts/answers/votes/vues/attachments/reputation, leave_requests, staff_attendance, question_bank/templates/records, question_attempts, practice_sessions, student_question_history, dpps/dpp_questions/dpp_attempts/dpp_answers`.
Intelligence `concept_mastery (mastery_score + confidence_score/classification post 20260804040000), student_mistakes, revision_queue, recovery_assignments, student_improvement_plans, student_academic_brain/profiles, ai_benchmark_*, ai_budget_quotas/usage, ai_embedding_jobs, ai_explanations, ai_feature_flags, ai_feedback_signals, ai_kms_*, ai_prompt_library, ai_request_decisions, ai_session_memory, ai_solution_cache, ai_workflow_registry, parent_academic_alerts, device_tokens, phone_otps, notifications, academic_daily_activity, academic_terms/years/taxonomy_terms`.
Gamification `battles/battle_questions/participants/answers/events/invites/reports, student_xp/badges/achievements, progression_leagues/history/achievements/level_config/xp_rules`.

**Views:** `[_ in never]` — none. **Functions section:** ~80 RPCs (see §4.4).

### 4.2 Multi-tenant columns & triggers
`20260730010000_complete_panel_database.sql:40` dynamic loop `ADD COLUMN school_id uuid REFERENCES schools(id)` + backfill `default_school_id()` + index on every tenant table. `tg_set_school_id_from_session() BEFORE INSERT` sets `NEW.school_id=get_my_school_id()` if NULL (not on `battles/battle_questions/participants` where class-derived `school_id` would be wrong — fixed explicitly in RPCs). `20260730000000_auth_multitenant_foundation.sql` creates `schools, profiles.school_id, get_my_school_id(), same_school()`.

### 4.3 RLS policies `CREATE POLICY` 100+ hits
`ENABLE ROW LEVEL SECURITY` on every table. Template after Aug hardening:
```sql
DROP POLICY "att admin all" ON attendance;
CREATE POLICY "att admin all" ON attendance FOR ALL TO authenticated
 USING (has_role(auth.uid(),'admin') AND same_school(school_id))
 WITH CHECK (has_role(auth.uid(),'admin') AND same_school(school_id));
```
Teacher `teacher_teaches_class`, principal `is_principal_or_admin`, student `user_id=auth.uid()`. OR-trap documented: legacy unscoped `homework "Admins can manage all homework"` coexisting with scoped `homework admin all` -> dropped; same for `library_checkouts`.

### 4.4 RPCs & helpers (from `types.ts:6680` + migration SQL)
Helpers `has_role(uuid,app_role) bool`, `get_my_school_id()`, `same_school(uuid)`, `default_school_id()`, `teacher_teaches_class`, `is_principal_or_admin`, `student_class_id()`. Write RPCs `rpc_start_practice_session, rpc_finish_practice_session, rpc_record_question_attempt, rpc_save_practice_session, rpc_toggle_question_bookmark, rpc_submit_recovery_answer, rpc_assign_concept_recovery, rpc_apply_progression, rpc_create_class_battle/open_battle/quick_battle/generate_battle/join_battle_by_code, rpc_dpp_pick_from_bank/start/submit, rpc_leaderboard, process_pending_academic_events/process_academic_event/refresh_student_academic_profile, ai_kms_retrieve_chunks, ai_budget_check_and_reserve, teacher_teaches_class, get_auth_context, get_my_role, link_portal_on_auth, ensure_default_role, rpc_get_my_student_identity, rpc_student_academic_snapshot, rpc_student_concept_mastery, rpc_student_recovery_zone, rpc_student_performance_charts, rpc_weak_areas_v2/revision_plan_v2/recovery_v2` (Decision Engine slices), `ai_session_memory_open/append`, `emit_academic_event, write_academic_audit`, `rpc_list_practice_history` etc.
Sweeps `20260820100000..20260820250000` backfilled `battles(31/34 NULL) + battle_questions(229/231 NULL)` via `COALESCE(classes.school_id,students.school_id,profiles...)` then tightened RLS.

### 4.5 Triggers & indexes
`trg_*_set_school BEFORE INSERT` defense-in-depth, `attendance_locks` trigger `20260820161000_attendance_locks_db_trigger.sql`, `community_doubt` first-answer-solves trigger. Indexes `*_school_id_idx` on all tenant tables + `*_student_id_idx` etc. `20260820191000_drop_redundant_duplicate_indexes.sql` deduped.

### 4.6 Seed `supabase/SEED_DEMO_DATA.sql:529`
Idempotent fixed UUIDs: 11 auth users `DemoPass123!` (`qa.automation@wisdomcampus.com` for `e2e/auth.setup.ts`), 2 classes `10-A/9-A`, 5 students, attendance/fees/marks/notices/homework/messages/leave_requests `student_xp/badges` + `battles/dpps/notifications` + `audit_logs`.

---

## 5. Supabase architecture

**Client** `src/integrations/supabase/client.ts:17` `createClient<Database>(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, {localStorage,persistSession,autoRefreshToken})` anon only; `SERVICE_ROLE` never in bundle. `supabase/config.toml:28` `project_id psqxykzqfvxgsvkmgurn`, `send-otp/verify-otp verify_jwt=false`, all `ai-* + ai-gateway + dpp-generate-questions verify_jwt=true` (but file lists 9, dir has 18 — drift: `admin-link-account, ai-academic-coach-agent, ai-learning-pattern-agent, ai-recovery-agent, ai-revision-agent, send-push` missing from `config.toml`).

**Edge functions `supabase/functions:18`** `send-otp, verify-otp, verify-msg91-widget, send-push, admin-link-account, ai-battle-report, ai-concept-report, ai-explain, ai-improvement-plan, ai-analytics-insights, dpp-generate-questions, ai-gateway, ai-learning-pattern-agent, ai-recovery-agent, ai-revision-agent, ai-academic-coach-agent`. `_shared:35` modules (see §9).

**Migration tooling `scripts/apply-pending-migrations.mjs:138`** dual credential `SUPABASE_ACCESS_TOKEN` Management API vs `DATABASE_URL:6543` pg SSL, `RECENT_SINCE 20260509000000` default else `--all`. `check-pending-migrations.mjs:240` probe via anon REST `PGRST202/203` markers (26) or Management API `pg_proc` with token. Seed via `apply-seed.mjs:116` verifies `arjun.mehta@wisdomcampus.com` login.

---

## 6. Entity catalog `src/academic/entities.ts:286`, `ownership.ts:261`

`ENTITY_REGISTRY: Record<AcademicEntityKey, EntityMapping>` 31 keys: `school->schools !tenantScoped`, `academic_year->academic_years (alias academic_terms)`, `class->classes tenantScoped`, `section->classes.section`, `subject->subjects (text subject until subject_id backfill)`, `teacher->teachers, student->students, parent->parents(+parent_students)`, `teacher_class_subject->teacher_classes`, `attendance->attendance (owners teacher/admin/principal)`, `homework/assignment->homework (teacher)`, `homework_submission->homework_submissions (student+teacher)`, `test->dpps (teacher)`, `question->dpp_questions (teacher/admin, aliases question_bank/templates)`, `student_test_attempt->dpp_attempts (student)`, `marks/examination_marks->marks (teacher)`, `examination->exams (teacher/admin/principal)`, `practice->practice_sessions (student)`, `practice_attempt->question_attempts (student)`, `battle->battles !tenantScoped (student+teacher+admin, XP/wins on student_xp not battle)`, `student_xp->student_xp !tenantScoped (via ProgressionService)`, `student_badge->student_badges !tenantScoped (_award_badge)`, `student_doubt->community_doubts (student)`, `teacher_reply->community_doubt_answers (teacher)`, `learning_resource->learning_resources (admin/principal/teacher)`, `announcement->notices (admin/principal/teacher)`, `message->messages (all roles)`, `notification->notifications (admin-generated, sync-owned)`, `leave_request->leave_requests`, `teacher_remark->teacher_remarks (teacher)`, `student_academic_profile/performance_summary/reports->student_academic_profiles (sync-only)`, `ai_insights->academic_agent_cache`, `analytics->academic_events`. `OWNERSHIP` enforces `assertCanOwn/assertCanConsume` — exactly one write owner set per entity.

---

## 7. Taxonomy & curriculum

**Kinds** `src/academic/taxonomy/types.ts:60` `TaxonomyKind board|class_level|subject|chapter|topic|concept|question_type`, `BoardId rbse|cbse|icse|other|both`, `ClassLevel 6|7|8|9|10|11|12`, `QuestionTypeId 7`, `TaxonomyTerm {id,displayName,aliases[],kind,board?,classLevel?,subjectId?,parentId?}`, `TaxonomyPath {board,classLevel,subject,chapter,topic,concept}` hierarchy `Board -> Class -> Subject -> Chapter -> Topic -> Concept -> QuestionType`.

**Registry** `taxonomy/registry.ts` built from `BOARDS[5]+CLASS_LEVELS[7]+QUESTION_TYPES[7]+commerceTaxonomyBundle()+scienceTaxonomyBundle()+CONCEPT_DISPLAY`. `canonicalize.ts` `slugifyAcademicId` NFKD keep Devanagari -> lower -> `&->and` -> `[^a-z0-9\u0900-\u097F]->_` , `chapterTermId ${slug}_${subject}_c${class}`, `ALIAS_TO_CANONICAL 30+` `brs/bst/accounts/p&l -> bank_reconciliation_statement/business_studies/accountancy/pl_account`, `canonicalizeConceptId, mergeDuplicateLabels`, `normalizeIncomingAcademicTerm` repairs mojibake via `repairUtf8Mojibake`. `dictionary.ts:240` `CORE_CONCEPT_DISPLAY ~80` + `BANK_CONCEPT_DISPLAY 411` + `TOKEN_DISPLAY vs/BST/BRS/P&L/GAAP`. `humanize.ts:242` `presentAcademicLabel` NEVER raw snake_case. Seeds `taxonomy/seeds/commerceRbse.ts:18038 6 subjects 240+ chapters 11-12`, `bankConcepts.ts:13829`, `sciencePlaceholders.ts:6118`.

**Curriculum scope** `lib/curriculumScope.ts:7710` `normalizeSubjectName, filterSubjectsForStream, inferStreamFromText, parseClassLevel, isSubjectAllowedForScope` + `lib/ncertSyllabus.ts:12419` + `lib/class12Subjects.ts`. `PracticeService.resolveCurriculumScope()` derives `classLevel` from `ctx.classLabel/classCategory` + `schools.board/stream` + `teacher_classes` fallback, never dump other class levels.

---

## 8. Question bank & question system

**Store:** `question_bank` (authoring SSOT, curated `is_approved + is_active` soft-delete since `20260804040000`, `exam_year/source/source_type, class_level, board, stream, school_id NULL|schoolId, subject, chapter, topic, concept, difficulty, question, options, correct_index, explanation`) + `question_templates` (legacy `class12Math` engine source, 13 chapters -> `buildClass12MathCatalog 105/chapter 1300+`) vs `dpp_questions` (assigned instances), `question_attempts` append-only log, `question_records` current-state SSOT (`current_status correct|wrong|skipped, attempt_count, wrong_count, last_selected_option, bookmarked`), `question_bank_semantic_search` migration `20260819200000` adds `embedding` pgvector vs lexical fallback.

**Service** `src/academic/services/practiceService.ts:1521` `start({subject,chapter,count,mode,difficulty,time_limit})` -> `rpc_start_practice_session` with progressive fallback `_difficulty/_time_limit_sec` probing. `recordAttempt({sessionId,generatedQuestion,selectedAnswer,correctAnswer,isCorrect,score,timeTaken,skipped,concept,...meta})` -> `rpc_record_question_attempt` single canonical RPC (no omit args -> PostgREST overload). `listBankQuestions({subject,chapter,topic,concept,difficulty,limit,pyqOnly,examYear,ids,excludeIds,weakTargets,includeInactive})` hard `class_level + board + stream` filter + `includeInactive` only for history/MistakeBook, shuffled client-side. `listWeakConcepts({threshold=WEAK_CONCEPT_THRESHOLD,limit,source weighted|simple})` v1 vs `DecisionEngineService.getWeakAreasV2` v2 feature-flagged swap, `listQuestionIdsByStatus/listMistakeQuestions/listMistakeBook/listBookmarkedQuestions/toggleBookmark`, `listBankSubjects/Chapters/Topics` via `question_bank` with display dedup + mojibake filter. `questionBankService.ts:3615` inserts into `question_bank` (teacher/admin only).

---

## 9. Practice / mastery / revision / XP / leaderboard / Battleground

**Practice flow:** `question_bank -> rpc_start_practice_session -> question_attempts + question_records -> rpc_finish_practice_session (server scores/accuracy) -> concept_mastery.mastery_score` (server-only) -> weak/revision. `PracticeHubPage.tsx` + `PracticeService.listBank*` + `academicDisplay.ts` presentation. V1 schema probes `softDeleteAvailable/questionRecordsAvailable/confidenceAvailable` graceful degrade `MISSING_SCHEMA_CODES 42703/42P01/42883/PGRST202/205`.

**Mastery** `eie/masteryBands.ts:30` `WEAK_CONCEPT_THRESHOLD=60` bands `critical<40 weak<60 developing<75 strong<90 mastered≥90` + `EIE_ALGORITHM_ID eie.mastery.v1` + `bandFromScore`. `concept_mastery {user_id,subject,chapter,concept,mastery_score, confidence_score/classification (simple), mistake_count, updated_at}` written server-only; client mirror `deterministicEngines.ts computeMasteryScore` labeled drift-risk. `conceptMasteryEngine.ts` + `eie/studentIntelligence.ts:5264 buildStudentEducationalIntelligence`.

**Weak concepts** `practiceService.listWeakConcepts` thresholded vs `DecisionEngineService.getWeakAreasV2` reading `rpc_weak_areas_v2` returning `WeakAreaRecommendation {subject,chapter,concept,subconcept,understanding,evidenceStrength,consistency,growthTrend,priority,reason{understanding,evidence_strength,consistency,growth_trend}}` — Learning Dimensions only, no client thresholds. Observability via `emitEventBestEffort practice.weak_areas.path_used|v2_failed`.

**Revision/Recovery** `revision_queue, recovery_assignments` + `DecisionEngineService.getRevisionPlanV2 (rpc_revision_plan_v2 -> RevisionRecommendation {retention,forgettingEventsCount})` + `getRecoveryV2 (rpc_recovery_v2 -> RecoveryRecommendation {recoveryNeed})` + `useRecoveryZone:158 rpc_student_recovery_zone` + `useRevisionQueueV2`. Report builders `recoveryCompletionReport.ts, conceptReportFallback.ts`. Assignment `rpc_assign_concept_recovery` idempotent per concept.

**XP/Progression** `student_xp {user_id,xp,level,study_streak,current_streak,wins,total_battles,practice_sessions_count,league_code,reputation,updated_at}` + `progression_leagues/history/achievements/level_config/xp_rules` + `ProgressionService:13190` `getSnapshot` via `student_academic_snapshot`, `rpc_apply_progression` idempotent duplicate-guard, `xpService.ts:5283` equip badge only, `battleExperienceService.ts:33549` `BattleCreateOpts` owns battleground XP explicitly not double-bumping. Math `progressionMath.ts:3188 progressionXpForLevel triangular 0/100/300/600, progressionLevelProgress, progressionLeagueFromXp/CodeOrXp 10 leagues bronze..nova, demote_below_xp hysteresis, progressionXpToNextLeague` — `PROGRESSION_LEAGUES 10`. Client mirror flagged “prefer snapshot league_code over XP”.

**Leaderboard** dual paths `ProgressionService.leaderboard` vs `rpc_leaderboard` (known drift M2 in `QUALITY_PRODUCTION_AUDIT`). `League` computations hysteresis-aware.

**Battleground** `battles/battle_questions/participants/answers/events/invites/reports` + `battleExperienceService` create/join/finish + `battleTemplateSolo` + `battlegroundHelpers` + `ArenaHub/ArenaLiveBattleCard/ArenaLeaderboard`. `TeacherBattleground` monitors via `BattleMonitor/TeacherReport`. RLS: `20260820130000` fixed NULL `school_id` (31/34 battles, 229/231 questions), RPCs now set explicitly, triggers not on battles (would silently wrong). Cache `student_academic_brain` stores battle stats.

---

## 10. Homework / attendance / marks / exams / timetable / calendar / notifications / analytics

**Homework/Assignments** `ENTITY_REGISTRY homework->homework alias assignment` `homework_submissions alias assignment_submission`. Service `homeworkService.ts:28303` owns create/update/publish/unpublish/archive/duplicate/delete + submissions list/review/grade + `emitEvent homework.*` + `broadcastAcademicWrite ["homework","profile"]`. Repo `homeworkRepository.ts`. Audience `homework.class_id + school_id`, submission `student_id`. Flow: Teacher `Homework.tsx` create -> `publishHomework` -> `homework.published` event -> student sees via `homeworkService.listForStudent` scoped `same_school + class_id` -> submit -> `homework.submitted` -> teacher grades -> `homework.graded` -> parent sees via `assertMayAccessStudent`.

**Attendance** `attendance {school_id,student_id,class_id,date,status present|absent|late|leave|half_day,marked_by}` + `attendance_audit/locks`. Service `attendanceService.ts:13887` `upsertAttendance/bulkUpsertAttendance + listStudentAttendance/listAttendanceForClassDate` + `assertTeacherOwnsClass + isClassTeacherOfClass` (write restricted to class teacher — fixed `20260820230000_fix_attendance_write_class_teacher_only.sql`) + `TeacherAttendancePage.tsx`. Calculation `fetchAttendance` in `aiRouter:425` `attendance_pct = round((present + late*0.5 + half_day*0.5)/total *1000)/10`. Calendar aggregation via `academicProfileRepository` `attendance_pct, homework_completion_pct` SSOT.

**Marks/Exams** `exams {id,school_id,class_id,subject,max_marks,results_published_at,status}` + `marks {exam_id,student_id,school_id,marks_obtained,created_at}` one-row per exam+student. Service `marksService.ts:17371` + `examRepository.ts + marksRepository.ts` + `workLifecycle.ts assertTeacherMayManageAcademicWork + validateMarks`. Flow teacher creates `exams.scheduled` -> `marks.published` -> `marks.results_published` -> `student_academic_profiles.exams_avg_pct` refreshed via `process_academic_event`. Published gate: `admin/teacher->marks.summary` recomputes via `published` only (`results_published_at NOT NULL`); `parent/student -> parentChildSummary` reuses same gate to avoid leakage (`aiRouter:847` comment). Classmate leak closed `20260820240000_close_marks_classmate_read_leak.sql`.

**Timetable** `timetable_slots/class_timetables` + `timetableService.ts:3972 ClassTimetableSnapshot` per class `school_id+class_id`. `TeacherTimetablePage / StudentTimetablePage`. Scope strictly `Class A must not see Class B` verified in Phase 4 plan.

**Academic calendar** `school_calendar_events {school_id,class_id,audience all|students|teachers|parents|class,event_type holiday|exam|meeting|sports|cultural|deadline,starts_at,ends_at,all_day}` + `calendarEventsService.ts:6912` + `upcomingEvents` Nova `audience.in.(all,students) OR class_id.eq.X`. Admin/class-teacher creates `Program -> student/teacher/parent/principal` every appropriate surface.

**Notifications** `notifications {school_id,user_id,type,title,body,read_at,created_at}` tenant + user scoped. `notificationsService` via `useNotifications:128` limit 50 + realtime `notif-<userId>` + `markRead/markAllRead/remove`. Produced by sync engine `EVENT_SYNC_TARGETS` `notifications` fan-out; class-targeting verified `20260820210000_fix_notices_teacher_class_audience_leak.sql`.

**Analytics** `analytics/foundation.ts + analyticsService` reads `academic_events + student_academic_profiles + attendance/marks/homework/practice` — no separate analytics fact table (`ENTITY_REGISTRY analytics->academic_events`). Per-student `getStudentAnalytics`, per-class `getClassPerformance`, per-school `getSchoolPerformance`. `principal/analytics, teacher insights, parent insights` all via same `AiDataLayer / AnalyticsFoundation`.

---

## 11. Panels — wiring to services

All panels share `useAcademicContext` SSOT `ServiceContext {schoolId,userId,role,studentId,classId,classLabel,classCategory}` from `loadStudentAcademicIdentity` sticky `lastGoodIdentity` + `effectiveRole` vs global role.

* **Student** `gurukul/` 25+ pages — Learning Loop `Practice -> Analyse (useAnalysisPageData:254 practice_sessions 40 + leaderboard + mastery) -> Weakness (DecisionEngine V2) -> Recover (RecoveryHubPage) -> Revise (RevisionQueueV2) -> Coach (Nova)`. `AICoach.tsx 1203` via `gatewayClient askAiCoach` + `productFeatureFlags`. Gates `studentShellReady({academicReady,progressionLoaded})` + `assertStudentContext` on every journey page (checked by `quality-student-context.mjs 86`).
* **Teacher** `gurukul-teacher/` 10 pages — `MyClasses` via `academicProfileRepository + teacherClassesRepository`, `TeacherAttendancePage` via `attendanceService`, `Communication` via `MessageService countUnread`, `Doubts` via `DoubtService + community_doubts` (`teacher_teaches_class` gated), `QuestionBankPage` via `questionBankService`, `Battleground` via `battleExperienceService`, `TeacherAICoach` via same gateway but `teacher.question_paper.*` capabilities.
* **Parent** `gurukul-parent/` — `MyChildren` via `useParentLiveChildren`, `AcademicInsights` same SSOT, `TestResults` via `marksService` filtered by linked child, `ParentLiveAttendance/AcAdemic` realtime.
* **Principal** `gurukul-principal/PrincipalLiveAcademic.tsx` 6 live rollups `SchoolOverview/ClassRollups/StudentRankings/AttendanceLive/TeachersLive/HomeworkLive`, all Academic Engine no mocks.
* **Admin** `gurukul-admin/` — `Students/Teachers/Parents` via `admin/*` wrappers + `AccountLinking.tsx`, `Classes, Examinations, Homework, Announcements, LeaveRequests, AiAnalytics, Settings`.

---

## 12. AI — Nova (student) + Teacher AI

### 12.1 Gateway `supabase/functions/ai-gateway/index.ts:331`
`Deno.serve` `POST /functions/v1/ai-gateway Bearer <user_jwt>` body `{feature_id,input:{text,structured},target_refs:{studentId},intent_hint,channel,session_id}`. `resolveActor(admin,userId)` loops `has_role` for `admin/principal/teacher/student/parent` (never `super_admin`), resolves `schoolId` via `students/parents/teachers/profiles` fail-closed 403, `actor {userId,role,schoolId,studentId}`. Honors global kill switch `ai_feature_flags flag_key ai.gateway.enabled WHERE school_id IS NULL` 503. Embedding batch `system.embedding.process_batch` admin/principal only via `processEmbeddingJobsBatch`. Rejects `tenant_forge/actor_forge` 400, `open_session` via `ai_session_memory_open/append` under user JWT `scope sessionScopeForCapability(feature_id)` TTL 120m, `routeAiRequest(userClient,admin,{request_id,feature_id,input_text,structured,target_student_id,session_id,locale,actor})` + persists `ai_request_decisions`.

### 12.2 Capability catalog `supabase/functions/_shared/capabilityCatalog.ts:212` mirrored `src/academic/ai/capabilityCatalog.ts`
20 capabilities, each `{feature_id,route_class,model_policy never|optional_explain|required_when_budget, allowed_roles[], requires_student_target bool}`:
`student.attendance.query|homework.due|marks.summary|calendar.upcoming (deterministic_record never)`, `student.eie.mastery_summary (eie_insight never)`, `student.performance.explain|concept.explain|image_doubt(.submit/.solve)|voice_doubt.submit (personalised/multimodal optional_explain)`, `parent.child.summary|narrative (deterministic_insight never)`, `student.knowledge.retrieve (grounded_retrieval never)`, `student.recommendation.next (recommendation never)`, `student.nova.chat (personalised required_when_budget)`, `teacher.question_paper.plan (never) | generate_outline|marking_scheme (required_when_budget)`, `principal.school.health_brief (deterministic never)`. `isModelAllowed cap.model_policy!=never`.

### 12.3 Router `supabase/functions/_shared/aiRouter.ts:4200`
Deterministic -> EIE -> cache -> model-last. Steps per `routeAiRequest`:
1 `loadKillSwitches(admin,schoolId)` fail-closed if flags unread or global seed missing.
2 `getCapability(feature_id)` 404 if unknown; role check; `resolveStudentTarget(actor,target)` + `assertMayAccessStudent(userClient,admin,actor,studentId)` per-role school-scoped (admin/principal `students.school_id=actor.schoolId`, student `user_id=auth.uid()`, parent via `students.parent_user_id|parent_students`, teacher via `teacher_teaches_class`).
3 Budget `ai_budget_check_and_reserve(p_school_id,p_feature_id,p_units)` soft/hard breach -> downgrade or `budget_exhausted`.
4 Per-capability deterministic fetchers (double `eq(school_id).eq(student_id)`): `fetchAttendance(120 rows, attendance_pct calc)`, `fetchHomeworkDue(class_id -> homework published/active + submissions map pending_count)`, `fetchMarksSummary(100 marks join exams results_published_at, isPlaceholderLabel filtered, average_pct)`, `fetchProgression(student_xp progressive vs legacy + concept_mastery<60 weak_concepts)`, `fetchEie(mastery+revision_queue+student_academic_profiles -> buildEieProjection)`, `fetchParentSummary(exams_avg recomputed via fetchMarksSummary for student/parent, not direct column)`, `fetchStudentProfileContext(subjects via teacher_classes deduped)`, `fetchPracticeHistory/MistakesBook/RecoveryQueue/UpcomingEvents`.
5 Cache probes `probeAttendance|Homework|Marks|Eie|Progression|ParentSummary|StudentProfile|PracticeHistory|Mistakes|Recovery|UpcomingEvents` each `hashRows(SHA256 of JSON.stringify sorted rows).slice(0,16)` composite keys guarantee miss on edit — L1 `Map<string,{value,expiresAt}> 60s` + L2 `ai_solution_cache {school_id,cache_key,feature_id,student_id,data_version,payload,expires_at 10m}` via `readL2Cache/writeL2Cache`.
6 Vector `retrieveKmsChunks` if needed (see §12.5) + `embedQueryText` before retrieval, fallback lexicalOverlap.
7 Model call `completeWithPromptLibrary` only if `isModelAllowed + generativeEnabled + budget ok` via `modelRouter.ts` OpenRouter `nvidia/nemotron-3-ultra-550b:free` primary `qwen/qwen3.7-flash` fallback `reasoning:{enabled:false}` `HTTP-Referer gurukul.app`. Curriculum weights `questionPaperPlan` deterministic dry-run, outline/markingScheme via prompt library.
8 `confidenceEngine scoreConfidence + applyConfidencePolicy`, `responseValidator validateModelResponse + evidenceFromExplainFacts`, `contextBuilder packForModel` redacts IDs, `novaContextBuilder dedupeSubjects`.
9 `writeDecision(admin, {request_id,school_id,actor_user_id/role,feature_id,route_class,decision,used_model,model_id,cache_hit,kill_switch_hit,latency_ms,error_code,evidence,confidence,budget_tier,validation_ok,estimated_cost_units})` always.
Number safety `extractNumbers -> numbersMatch` prevents reusing cached answer when numeric values differ (0.94 same-template-different-values vs 0.79 paraphrase empirically).

### 12.4 Client facade `src/academic/ai/gatewayClient.ts:26029`, `contextBuilder.ts`, `novaContextBuilder.ts`
`askAiCoach(feature_id, {text,structured,studentId,sessionId})` envelopes via `envelope.ts` + `capabilityCatalog` `planRoute/wouldCallModel` + `contextApis.ts` + `l1Cache.ts`. `workflowOrchestrator.ts` drives multi-turn `ai_session_memory`. `intentMapper.ts` maps natural language -> `feature_id`. `responseValidator.ts` + `confidenceEngine.ts` harden model output.

### 12.5 Vector / semantic search `src/academic/ai/vectorRetrieval.ts`, `embeddingProvider.ts`, `knowledgeManagement.ts` + edge `vectorRetrieval.ts, embeddingWorker.ts, embeddingProvider.ts`
`ai_kms_documents {school_id,tenant_scope,visibility_scope[],status published,approval_status}` + `ai_kms_document_versions + ai_kms_chunks {embedding_compat real[], embedding_stub, published, approval_status}`. Retrieval `retrieveKmsChunks(school_id,query_embedding?, limit, min_score 0.79)` via `ai_kms_retrieve_chunks` RPC strictly `approved+published+tenant+visibility` filtered, `vector_compat` when `embedding_compat` present else `lexicalOverlap`. `embeddingProvider.ts` resolves `OPENROUTER_API_KEY|AI_EMBEDDING_*|OPENAI_API_KEY` + `OPENROUTER_EMBEDDING_MODEL`. Worker `embeddingWorker.ts processEmbeddingJobsBatch(admin,limit,{schoolId})` + `ai_embedding_jobs` queue, triggered via `system.embedding.process_batch` capability. Cache hashes already cover `embedding_compat` versioning.

### 12.6 Answer / reference cache
L1 60s map + `ai_solution_cache` 10m per `Cache version probes` `hashRows` design (see aiRouter `1173..1431`): old bug was hardcoded `"pending"` key -> TTL-bound stale; fix folds row content into key so edit -> miss instantly. Also `ai_answer_cache` NEW `20260819210000_ai_answer_cache.sql` service-role-only, zero RLS, `match_ai_answer_cache(class_level,subject only)` — cross-school scope intentional? flag as risk #2.

### 12.7 Teacher AI
`teacher.question_paper.plan` dry-run deterministic curriculum weights (no model), `.generate_outline` + `.marking_scheme` via Gateway -> Qwen + Validator + session memory (outline must exist before markingScheme). UI `TeacherAICoach.tsx`, `QuestionBankPage.tsx`. Same `assertMayAccessStudent` + `teacher_teaches_class` gating.

### 12.8 Background jobs & scheduled ops
No cron/queue outside Supabase `pg_cron`/`pg_net` (not confirmed deployed). Sync is event-driven: `academic_events {school_id,event_type,entity_type,entity_id,actor_user_id,student_id,class_id,payload,status pending|processing|processed|failed|skipped,created_at}` emitted by repos (`emitEvent`/`emitEventBestEffort`) -> `SyncEngine.processPendingEvents(schoolId,50) -> rpc process_pending_academic_events(_limit)` + `process_academic_event(_event_id)` SQL processors refresh `student_academic_profiles` (`refresh_student_academic_profile`), `notifications`, `school_activity_feed`, `academic_audit`. Poll on focus + 90s via `AcademicLiveProvider` + manual `refreshStudentProfile(studentId)`. No other scheduled jobs confirmed.

---

## 13. Data flows — traceable every hop

### 13.1 USER ACTION -> UI -> mutation -> DB -> derived -> cache -> consumers -> UI
Example Student solves question: `Practice.tsx PracticeHubPage click answer -> PracticeService.recordAttempt(ctx,{sessionId,generatedQuestion,selectedAnswer,correctAnswer,isCorrect,...}) assertCanOwn(practice) -> rpc_record_question_attempt (_correct_answer etc) -> question_attempts insert + question_records upsert(current_status) -> concept_mastery update (server trigger) -> recovery_assignments? -> emitEvent practice.session.completed -> syncTargetsFor -> SyncEngine/process_pending_academic_events -> student_academic_profiles refreshed -> broadcastAcademicWrite(["xp","profile"]) -> AcademicLiveProvider bump(250ms debounce) -> useStudentXp/useConceptMastery/useStudentAcademicSnapshot reload -> Nova fetchProgression/fetchEie show new weak_concepts -> parent sees same via fetchParentSummary`.

Example Teacher marks: `Teacher marks modal -> MarksService.publishMarks({classId,examId,rows}) assertTeacherMayManageAcademicWork + teacherAssignedToClassSubject -> marks upsert -> emit marks.published -> sync -> student_academic_profiles.exams_avg_pct -> student MyMarksPage (marksService.listMarksForStudent published only) + parent TestResults + principal analytics + Nova fetchMarksSummary (recomputed)`.

### 13.2 DATABASE -> query -> service -> transform -> component -> value
`attendance` rows -> `attendanceRepository.listStudentAttendance({studentId,schoolId}) -> AttendanceService.listForStudent assertCanConsume -> Student Attendance.tsx + Parent Attendance + Principal AttendanceLive + Nova fetchAttendance(120 rows -> attendance_pct)` — all four surfaces share same repo, same `attendance_pct` formula, verified via single `fetchAttendance` function (no second implementation). Same for marks/homework/practice/progression branches.

### 13.3 Organization & permission hierarchy verification
All reads go through `RepoContext {schoolId,userId}` + `scopeBySchool(query,schoolId)`; no raw `from("students").select("*")` without `eq(school_id)`. Writes via `tg_set_school_id_from_session` or explicit `school_id` propagated from `ServiceContext` derived from JWT — never client-asserted. `super_admin` never maps into portal `ServiceContext`.

---

## 14. Authoritative vs derived / cached / duplicated

**Authoritative (single writer, source of truth):** `question_bank (teacher/admin)`, `question_attempts (student append-only)`, `question_records (derived	current-state but SSOT for status, server-maintained)`, `practice_sessions (student)`, `concept_mastery (server only)`, `attendance (teacher, audit in attendance_audit/locks)`, `homework/homework_submissions (teacher/student)`, `exams/marks (teacher)`, `student_xp/progression_* (RPCs)`, `class_timetables/school_calendar_events (admin/class-teacher)`, `community_doubts/answers (student/teacher)`, `messages (all, via MessageService RPCs)`.

**Derived / cached / aggregated (never write directly from UI):** `student_academic_profiles.{attendance_pct,homework_completion_pct,tests_avg_pct,exams_avg_pct,metrics.weakTopics,refreshed_at}` owned solely by Sync Engine (`process_academic_event` + `refresh_student_academic_profile`); `ai_solution_cache / ai_answer_cache` (gateway only); `academic_agent_cache (ai_explanations)`. UI reads `student_academic_profiles` via `rpc_student_academic_snapshot` read-only.

**Duplicated calculations (intentional mirrors, drift risk):** `deterministicEngines.ts computeSessionAnalytics/classifyMistake/computeMasteryScore` mirrors server mastery; `progressionMath.ts` mirrors `student_xp` leveling; Decision Engine shim reuses `mastery_score` name for `understanding` (semantically different, numerically compatible 0-100) — all flagged in §3 #6.

**Multiple writers checked:** No competing writers found on same authoritative table beyond allowed ownership sets (`homework_submissions student+teacher (submit vs grade)` is intentional split via `status`; `notifications` only sync writes). `ExplainPanel.tsx` direct `(supabase as any).from("ai_explanations")` bypasses service layer — flagged.

---

## 16. What this map does NOT yet verify (honest gaps — Phase 1+ must cover)

* Live DB vs migration files divergence (campaign rule: query `information_schema` + `pg_proc` + RLS policies live, not just files) — Phase 1 first step.
* Per-table writers/readers/mutation/read paths exhaustively enumerated and pen-tested (Phase 1 audit matrix + Phase 4 RLS probe).
* Per-value formula correctness with controlled test cases (Phase 2: attendance % edge half_day, marks averages weighted, XP thresholds/league hysteresis, mastery gain/loss, revision intervals, weakConcept thresholds).
* Page-by-page data-to-UI correctness across all 5 panels (Phase 3: every displayed weakConcept/questionsSolved/revisionPending/mastery/XP/attendance/marks/homework traced to query).
* Cross-school and cross-class isolation live pen-test (Phase 4: School A must never read/modify B).
* End-to-end wiring cache invalidation (Phase 5: create->read publish->visibility, grading->analytics, db->ai context).
* Every Nova capability live probe with correct/missing/stale/empty/another-student/another-school/ambiguous/image/file/follow-up cases plus vector similarity numeric-tolerance check (Phase 6) + Teacher AI paper generation.
* Dead-code proof for `src/auth/rbac.ts canAccessPath`, `mcp` Windows path, legacy `pages/student/*`, `src/lib/deterministicEngines` mirrors (cleanup only after prove-unused).

---

## 17. Highest-risk areas for Phase 1+ (prioritized, updated)

1. **RLS retrofit still mid-sweep with repeating failure pattern** — 10 cross-school leaks patched 2026-08-20 alone (notices audience, DPP gate, attendance write, marks read, deleted-row refresh). Hand-driven, no CI RLS lint — Phase 1/4 must re-verify recent tables independently.
2. **`ai_answer_cache` cross-school read** — `match_ai_answer_cache` filters `class_level/subject` only, not `school_id` though column exists. Confirm intentional shared-curriculum vs bug; cheap fix `school_id` param to RPC + `aiRouter:3562`.
3. **`supabase/config.toml` vs `functions/` vs deploy workflow drift** — 3 lists disagree (9 vs 18 vs 11) — gateway/push/otp may not deploy after next push; missing `verify_jwt` entries risk public invoke.
4. **Migration / live-DB drift** — no CI applies migrations, `db:check-migrations` once missed 70+ migrations, `db:migrate` no txn/rollback. Confirm live parity before trusting any schema finding; `s.teacher` salary leak earlier was migration-file-only.
5. **Test suite false confidence** — 35 Vitest files zero Supabase I/O, CI runs 8/35 + 4 text scans, no lint/typecheck/build/e2e gate; edge deploy auto-pushes zero-tested.
6. **Client mirrors of server math** — `deterministicEngines + progressionMath + Decision Engine Understanding->mastery_score alias` drift if server formula changes.
7. **`mcp` function Windows absolute path** — `npm:D:\Projects\...` won't resolve on Supabase deploy.
8. **`ExplainPanel.tsx` service-layer bypass** — `(supabase as any).from("ai_explanations")` skips `academic/services` enforcement + types.
9. **Legacy dead routes** `pages/student/RevisionQueue, AcademicAnalytics` confirmed dead per `KNOWN_ISSUES.md` — do not resurrect without re-verifying 08-08 trace.
10. **Prior Mediums still open per `QUALITY_PRODUCTION_AUDIT.md` M1-M5** — Battle Rating client-derived, dual leaderboard paths, non-persisted 2FA, parent mark % fallback, practice duration +1min.

---

## 18. Source reports

Six deep inspections (frontend + Supabase/schema/RLS + academic logic + AI/Nova + org/roles/auth + quality tooling) ran in parallel — verbatim kept in session transcript. This doc is the reconciled, updated authoritative synthesis for the campaign. Treat as starting point, not substitute for live verification per campaign rule #11/32.
