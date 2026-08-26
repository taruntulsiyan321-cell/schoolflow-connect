/**
 * Canonical, code-based live-database verification. Every check here is a
 * literal SQL query against the running database, not a claim from a text
 * report -- this exists specifically because several "audit" reports handed
 * to this project during 2026-08-21's production-readiness pass repeated
 * already-refuted or already-fixed claims (a 69% mojibake-corruption claim
 * that never reproduced, a battle-XP double-award claim contradicted by a
 * live unique index, an is_late-forgery claim already closed by a trigger)
 * without ever re-checking current state. Anyone -- a person, a future
 * session, CI -- can run this file and get an answer they can trust, instead
 * of a report they have to independently re-verify from scratch.
 *
 * Run: SUPABASE_ACCESS_TOKEN=... node scripts/verify-database-integrity.mjs
 * Exit code 0 = every check passed. Exit code 1 = at least one failed --
 * see the FAIL lines for exactly what and by how much.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnvFile(name) {
  const path = join(ROOT, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error(
    "\nNo SUPABASE_ACCESS_TOKEN in .env.local -- this script needs Management API\n" +
      "access (bypasses RLS) to check things RLS would otherwise hide, like\n" +
      "cross-tenant leaks or orphaned rows with a null owner column.\n",
  );
  process.exit(1);
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 500));
  return JSON.parse(text);
}

let failures = 0;
async function check(label, sql, ok) {
  try {
    const rows = await query(sql);
    const pass = ok(rows);
    console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : "  -- " + JSON.stringify(rows)}`);
    if (!pass) failures++;
  } catch (e) {
    console.log(`ERROR ${label}  -- ${e.message.slice(0, 200)}`);
    failures++;
  }
}

const count = (rows) => Number(rows[0]?.count ?? 0);

async function main() {
  console.log(`Verifying live database integrity against ${PROJECT_REF}\n`);

  // --- Migration ledger completeness (G0-4) ---
  const files = readdirSync(join(ROOT, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""));
  const ledgerRows = await query("SELECT version FROM public.schema_migrations").catch(() => []);
  const applied = new Set(ledgerRows.map((r) => r.version));
  const missing = files.filter((f) => !applied.has(f));
  console.log(
    `${missing.length === 0 ? "PASS" : "FAIL"}  Migration ledger covers all ${files.length} local migration files` +
      (missing.length ? `  -- missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ""}` : ""),
  );
  if (missing.length) failures++;

  // --- Phase 1 fixes (supabase/migrations/20260821120000_phase1_verified_fixes.sql) ---
  await check(
    "question_bank.class_level 5/null archived (expect 0 active)",
    "SELECT count(*) FROM question_bank WHERE (class_level=5 OR class_level IS NULL) AND is_active=true",
    (r) => count(r) === 0,
  );
  await check(
    "student_xp.level matches progression_level_for_xp(xp) (expect 0 drift)",
    "SELECT count(*) FROM student_xp WHERE level IS DISTINCT FROM progression_level_for_xp(xp)",
    (r) => count(r) === 0,
  );
  await check(
    "recovery_assignments has no open duplicates (expect 0 groups)",
    "SELECT count(*) FROM (SELECT 1 FROM recovery_assignments WHERE status IN ('pending','in_progress') GROUP BY user_id, subject, concept HAVING count(*)>1) x",
    (r) => count(r) === 0,
  );
  await check(
    "revision_queue.school_id fully backfilled (expect 0 null)",
    "SELECT count(*) FROM revision_queue WHERE school_id IS NULL",
    (r) => count(r) === 0,
  );
  await check(
    "student_academic_brain.school_id fully backfilled (expect 0 null)",
    "SELECT count(*) FROM student_academic_brain WHERE school_id IS NULL",
    (r) => count(r) === 0,
  );
  await check(
    "recovery_assignments.school_id fully backfilled (expect 0 null; found by lint-tenant-scope.mjs's first run)",
    "SELECT count(*) FROM recovery_assignments WHERE school_id IS NULL",
    (r) => count(r) === 0,
  );
  await check(
    "dpp_attempts.student_id enforced NOT NULL (expect 0 orphans)",
    "SELECT count(*) FROM dpp_attempts WHERE student_id IS NULL",
    (r) => count(r) === 0,
  );

  // --- Tenant-scoping fix (20260821180000_tenant_scope_semantic_search_rpcs.sql) ---
  await check(
    "match_question_bank has a school_id parameter",
    "SELECT pg_get_function_identity_arguments(oid) args FROM pg_proc WHERE proname='match_question_bank'",
    (r) => (r[0]?.args ?? "").includes("p_school_id"),
  );
  await check(
    "match_ai_answer_cache has a school_id parameter",
    "SELECT pg_get_function_identity_arguments(oid) args FROM pg_proc WHERE proname='match_ai_answer_cache'",
    (r) => (r[0]?.args ?? "").includes("p_school_id"),
  );

  // --- Server-side is_late enforcement ---
  await check(
    "homework_submissions.is_late computed server-side by trigger",
    "SELECT count(*) FROM pg_trigger WHERE tgname='trg_homework_is_late'",
    (r) => count(r) === 1,
  );

  // --- 2026-08-22 code-trace fixes ---
  await check(
    "attendance_locks.school_id is NOT NULL (a nullable lock-scope column would silently bypass the lock-check trigger)",
    "SELECT is_nullable FROM information_schema.columns WHERE table_name='attendance_locks' AND column_name='school_id'",
    (r) => r[0]?.is_nullable === "NO",
  );
  await check(
    "no template-path (bank_question_id null) duplicate question_attempts rows",
    "SELECT count(*) FROM (SELECT 1 FROM question_attempts WHERE bank_question_id IS NULL AND attempt_number IS NOT NULL GROUP BY session_id, attempt_number HAVING count(*) > 1) x",
    (r) => count(r) === 0,
  );

  // --- HIGH-tier fixes (20260821200000_high_tier_verified_fixes.sql) ---
  await check(
    "question_bank has no active duplicate (question, class_level, subject) groups",
    "SELECT count(*) FROM (SELECT 1 FROM question_bank WHERE is_active=true GROUP BY question, class_level, subject HAVING count(*)>1) x",
    (r) => count(r) === 0,
  );
  await check(
    "progression_league_for_xp has hysteresis (295xp, currently silver, stays silver)",
    "SELECT progression_league_for_xp(295, 'silver') AS league",
    (r) => r[0]?.league === "silver",
  );
  await check(
    "progression_league_for_xp old 1-arg overload was dropped (no stale duplicate)",
    "SELECT count(*) FROM pg_proc WHERE proname='progression_league_for_xp' AND pronargs=1",
    (r) => count(r) === 0,
  );
  await check(
    "fees.status has a server-side trigger (can't drift from client writes alone)",
    "SELECT count(*) FROM pg_trigger WHERE tgname='trg_fees_compute_status'",
    (r) => count(r) === 1,
  );

  // --- Claims independently checked and refuted -- asserted here so a
  // regression (or a future audit resurrecting the same false claim) gets
  // caught immediately instead of requiring another multi-hour re-investigation. ---
  await check(
    "question_bank contains no literal U+FFFD replacement character (the '69% mojibake' claim never reproduced)",
    "SELECT count(*) FROM question_bank WHERE question LIKE '%�%' OR chapter LIKE '%�%'",
    (r) => count(r) === 0,
  );

  // --- Phase 1 audit (2026-08-22): school_id gap closure on tables whose
  // only live writer never set it (20260822150000_phase1_school_id_gap_closure.sql) ---
  await check(
    "concept_mastery.school_id fully backfilled (expect 0 null)",
    "SELECT count(*) FROM concept_mastery WHERE school_id IS NULL",
    (r) => count(r) === 0,
  );
  await check(
    "student_mistakes.school_id fully backfilled (expect 0 null)",
    "SELECT count(*) FROM student_mistakes WHERE school_id IS NULL",
    (r) => count(r) === 0,
  );
  await check(
    "academic_daily_activity.school_id fully backfilled (expect 0 null)",
    "SELECT count(*) FROM academic_daily_activity WHERE school_id IS NULL",
    (r) => count(r) === 0,
  );
  await check(
    "recovery_assignment_questions.school_id fully backfilled (expect 0 null)",
    "SELECT count(*) FROM recovery_assignment_questions WHERE school_id IS NULL",
    (r) => count(r) === 0,
  );
  await check(
    "attendance.school_id fully backfilled (expect 0 null)",
    "SELECT count(*) FROM attendance WHERE school_id IS NULL",
    (r) => count(r) === 0,
  );
  await check(
    "concept_mastery/student_mistakes/academic_daily_activity/recovery_assignment_questions all have a school_id-setting trigger (prevents regression to NULL on new writes)",
    `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE p.proname = 'tg_set_school_id_from_session' AND NOT t.tgisinternal
       AND c.relname IN ('concept_mastery','student_mistakes','academic_daily_activity','recovery_assignment_questions')`,
    (r) => r.length === 4,
  );

  // --- Phase 2 audit (2026-08-22): homework late-detection forgery + IST
  // timezone fix, mastery-score volatility fix
  // (20260822160000_phase2_homework_late_forgery_and_tz.sql,
  // 20260822170000_phase2_mastery_score_volatility_fix.sql) ---
  await check(
    "tg_homework_compute_is_late forces submitted_at server-side (no longer trusts client input)",
    "SELECT prosrc FROM pg_proc WHERE proname = 'tg_homework_compute_is_late'",
    (r) => (r[0]?.prosrc ?? "").includes("NEW.submitted_at := now()"),
  );
  await check(
    "tg_homework_compute_is_late compares against IST wall-clock, not an implicit UTC session cast",
    "SELECT prosrc FROM pg_proc WHERE proname = 'tg_homework_compute_is_late'",
    (r) => (r[0]?.prosrc ?? "").includes("Asia/Kolkata"),
  );
  await check(
    "_compute_mastery_score is STABLE, not mislabeled IMMUTABLE (it reads now())",
    "SELECT provolatile FROM pg_proc WHERE proname = '_compute_mastery_score'",
    (r) => r[0]?.provolatile === "s",
  );

  // --- Phase 5 audit (2026-08-22): critical account-takeover hole closed +
  // internal-helper lockdown (20260822180000_phase5_revoke_internal_helper_execute.sql) ---
  await check(
    "_demo_upsert_auth_user (unauthenticated auth.users password-overwrite primitive) no longer exists",
    "SELECT count(*) FROM pg_proc WHERE proname = '_demo_upsert_auth_user'",
    (r) => count(r) === 0,
  );
  await check(
    "internal data-forgery/leak helpers are no longer callable by anon or authenticated",
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY(ARRAY[
       '_upsert_concept_mastery','_upsert_question_record','_bump_academic_activity',
       '_exam_readiness','_rebuild_revision_queue','_weak_topics_for_user',
       '_notify_student_parents','_award_badge','_maybe_finish_battle'
     ])
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`,
    (r) => r.length === 0,
  );
  await check(
    "new functions created by postgres no longer default to anon/authenticated EXECUTE (foundation fix)",
    `SELECT defaclacl FROM pg_default_acl WHERE defaclrole = 'postgres'::regrole AND defaclnamespace = 'public'::regnamespace AND defaclobjtype = 'f'`,
    (r) => {
      const acl = String(r[0]?.defaclacl ?? "");
      return !acl.includes("anon=X") && !acl.includes("authenticated=X");
    },
  );

  // --- Phase 5 audit continued (20260822190000_phase5_parent_join_table_and_snapshot_lockdown.sql) ---
  await check(
    "rpc_student_academic_snapshot_internal (private per-student data, no ownership check) is no longer callable by anon or authenticated",
    `SELECT 1 WHERE has_function_privilege('anon', 'public.rpc_student_academic_snapshot_internal(uuid,uuid)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.rpc_student_academic_snapshot_internal(uuid,uuid)', 'EXECUTE')`,
    (r) => r.length === 0,
  );
  await check(
    // rpc_parent_concept_analytics dropped from this list by Chunk 1.6: it is
    // now gutted and raises, so it has no parent_students join to check.
    "rpc_parent_child_snapshot/rpc_parent_weekly_digest also check the parent_students join table, not just the legacy parent_user_id column",
    `SELECT proname FROM pg_proc WHERE proname IN ('rpc_parent_child_snapshot','rpc_parent_weekly_digest')
       AND prosrc NOT ILIKE '%parent_students%'`,
    (r) => r.length === 0,
  );

  // --- User-journey-trace cross-check round 2, 2026-08-22
  // (20260822200000_phase5_battle_participants_school_check.sql) ---
  await check(
    "battle_participants INSERT policy requires the battle's own school_id to match the row being inserted (not just user_id = auth.uid())",
    `SELECT pg_get_expr(polwithcheck, polrelid) AS chk FROM pg_policy
     WHERE polname = 'bp self insert' AND polrelid = 'public.battle_participants'::regclass`,
    (r) => (r[0]?.chk ?? "").includes("get_my_school_id"),
  );

  // --- Gap-closure pass, 2026-08-22: CHECK constraints + revision-queue
  // auto-clear (20260822210000_gap_closure_check_constraints.sql,
  // 20260822220000_gap_closure_revision_queue_auto_clear.sql) ---
  await check(
    "all 13 gap-closure CHECK constraints exist",
    `SELECT conname FROM pg_constraint WHERE conname IN (
       'approval_requests_status_check','battle_events_kind_check','battle_invites_status_check',
       'battles_source_check','concept_mastery_classification_check','exams_status_check',
       'homework_priority_check','notices_status_check','progression_history_source_type_check',
       'question_attempts_source_check','recovery_assignments_source_type_check',
       'student_mistakes_assessment_type_check','teachers_status_check'
     )`,
    (r) => r.length === 13,
  );
  await check(
    "_rebuild_revision_queue auto-clears revision items whose topic accuracy has recovered",
    "SELECT prosrc FROM pg_proc WHERE proname = '_rebuild_revision_queue'",
    (r) => (r[0]?.prosrc ?? "").includes("w.accuracy >= 60"),
  );

  // --- Gap closure, 2026-08-22: admin/principal cross-school leaks in RPC
  // bodies (distinct from the RLS-policy sweep done earlier this session)
  // + a pre-existing nested-aggregate bug that made two functions
  // completely non-functional
  // (20260822240000_gap_closure_admin_principal_cross_school_leaks.sql,
  // 20260822250000_gap_closure_nested_aggregate_bug.sql) ---
  await check(
    "admin/principal-branch RPCs all require same_school() (not just has_role) before cross-school-capable reads/writes",
    `SELECT proname FROM pg_proc WHERE proname IN (
       'admin_link_user_to_student','admin_link_user_to_teacher','ai_session_memory_close',
       'rpc_battle_monitor','rpc_mark_best_community_answer',
       'rpc_save_battle_ai_insights','rpc_teacher_class_insights',
       'rpc_teacher_class_progression_insights',
       'rpc_teacher_doubt_dashboard','rpc_parent_child_snapshot'
     ) AND prosrc NOT ILIKE '%same_school%' AND prosrc NOT ILIKE '%get_my_school_id%'`,
    (r) => r.length === 0,
  );

  // --- Chunk 1.6, 2026-08-26: practice privacy (locked decision 10.8).
  // The two concept-analytics RPCs above were dropped from that list because
  // they no longer read anything — they are gutted and raise. The check that
  // asserted their internal query shape is replaced by one asserting they
  // stay gutted, so the guarantee is still under test rather than deleted.
  await check(
    "the three concept-analytics RPCs are gutted and expose no practice data",
    `SELECT proname, prosrc FROM pg_proc WHERE proname IN
       ('rpc_principal_concept_analytics','rpc_teacher_concept_analytics','rpc_parent_concept_analytics')`,
    (r) =>
      r.length === 3 &&
      r.every(
        (row) =>
          /RAISE EXCEPTION/i.test(row.prosrc) &&
          !/concept_mastery|student_mistakes/i.test(row.prosrc),
      ),
  );
  await check(
    "no policy grants practice data (student_mistakes/concept_mastery/question_records/revision_queue/student_academic_brain) to another role",
    `SELECT tablename, policyname FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('student_mistakes','concept_mastery','question_records',
                          'revision_queue','student_academic_brain')
        AND permissive = 'PERMISSIVE'
        AND (coalesce(qual,'') || ' ' || coalesce(with_check,''))
            ~ '(has_role|teacher_teaches_class|parent_user_id|parent_students)'`,
    (r) => r.length === 0,
  );
  await check(
    "public.user_roles is read-only — roles live on memberships (Chunk 1.5)",
    `SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.user_roles'::regclass
        AND tgname = 'trg_user_roles_read_only' AND NOT tgisinternal`,
    (r) => r.length === 1,
  );

  // ---- Chunk 2.5: the two live practice leaks Chunk 1.6 missed --------
  // Both were reachable despite 1.6 reporting ALL CHECKS PASSED, because its
  // verification never enumerated a function and RLS is row-level, not column.
  await check(
    "rpc_get_student_progression returns practice counts to the student ONLY (10.16)",
    `SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'rpc_get_student_progression'`,
    (r) => r.length === 1 && /WHEN _is_self THEN/.test(r[0].prosrc),
  );
  await check(
    "student_xp is self-only — no policy hands the whole row (incl. practice_sessions_count) to staff",
    `SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'student_xp'
        AND permissive = 'PERMISSIVE' AND coalesce(qual,'') ~ 'has_role'`,
    (r) => r.length === 0,
  );
  await check(
    "Nova gates every practice-derived fact on the student themselves (service role bypasses RLS)",
    `SELECT 1`,
    () => {
      const src = readFileSync('supabase/functions/_shared/aiRouter.ts', 'utf8');
      // Each of the three wholly-private projections, plus the progression split.
      const gates = (src.match(/actorRole !== "student"/g) || []).length;
      return gates >= 3 && /actorRole === "student"/.test(src);
    },
  );
  await check(
    "homework.school_id is NOT NULL — otherwise the composite FK is MATCH SIMPLE bypassable",
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'homework' AND column_name = 'school_id'`,
    (r) => r.length === 1 && r[0].is_nullable === 'NO',
  );
  await check(
    "teacher_assignments binds the teacher to the assignment's own institution",
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.teacher_assignments'::regclass
        AND conname = 'teacher_assignments_teacher_school_fk'`,
    (r) => r.length === 1,
  );

  // ---- Chunk 3: people ------------------------------------------------
  await check(
    "every student has an enrolment_date (10.27: attendance counts from it, never session start)",
    `SELECT count(*)::int AS n FROM public.students WHERE enrolment_date IS NULL`,
    (r) => r[0].n === 0,
  );
  await check(
    "every student has exactly one open enrolment row (section history is kept, not overwritten)",
    `SELECT count(*)::int AS n FROM public.students s
      WHERE NOT EXISTS (SELECT 1 FROM public.student_enrolments e
                         WHERE e.student_id = s.id AND e.to_date IS NULL)`,
    (r) => r[0].n === 0,
  );
  await check(
    "roll numbers are unique per (section, year) and reusable elsewhere",
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.student_enrolments'::regclass
        AND conname = 'student_enrolments_roll_unique'`,
    (r) => r.length === 1,
  );
  await check(
    "soft delete is enforced by RLS on students/teachers/teacher_remarks, not by app filtering (G6)",
    `SELECT tablename FROM pg_policies
      WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
        AND policyname IN ('students_hide_soft_deleted','teachers_hide_soft_deleted',
                           'teacher_remarks_hide_soft_deleted')`,
    (r) => r.length === 3,
  );
  await check(
    "an exited student is immediately invisible to guardians, and the record is retained",
    `SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'students'
        AND policyname = 'students_exit_hides_from_guardian' AND permissive = 'RESTRICTIVE'`,
    (r) => r.length === 1,
  );
  await check(
    "a remark may only be written by a teacher who teaches that student (10.14)",
    `SELECT with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'teacher_remarks'
        AND policyname = 'teacher_remarks_teacher_write'`,
    (r) => r.length === 1 && /teacher_teaches_class/.test(r[0].with_check || ''),
  );
  await check(
    "editing a remark stamps edited_at — the parent may already have read the original",
    `SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.teacher_remarks'::regclass
        AND tgname = 'trg_teacher_remarks_mark_edited' AND NOT tgisinternal`,
    (r) => r.length === 1,
  );

  // ---- Chunk 4: attendance ---------------------------------------------

  // ---- Chunk 4.5: roll_number convergence -------------------------------
  await check(
    "students.roll_number is DROPPED — student_enrolments is the only roll number (G9)",
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'roll_number'`,
    (r) => r[0].n === 0,
  );
  await check(
    "no SQL function still reads roll_number off public.students",
    `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosrc ~ 'public.studentsM[^;]*roll_number'`,
    (r) => r[0].n === 0,
  );
  await check(
    "students_current inherits RLS (security_invoker) rather than bypassing it as its owner",
    `SELECT c.reloptions::text AS opts FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'students_current'`,
    (r) => r.length === 1 && /security_invoker=true/.test(r[0].opts || ""),
  );
  await check(
    "the current academic year's roll number resolves through students_current",
    `SELECT count(*)::int AS n FROM public.students_current WHERE roll_number IS NOT NULL`,
    (r) => r[0].n > 0,
  );
  await check(
    "attendance_submissions exists and is unique per (section, date) — the absence of a row is what 'not marked' means",
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.attendance_submissions'::regclass
        AND conname = 'attendance_submissions_section_date_key'`,
    (r) => r.length === 1,
  );
  await check(
    "every attendance record is anchored on a submission (never infer marking from per-student rows)",
    `SELECT count(*)::int AS n FROM public.attendance WHERE submission_id IS NULL`,
    (r) => r[0].n === 0,
  );
  await check(
    "attendance is present/absent only — no late, no half-day, no leave (locked decision 5)",
    `SELECT count(*)::int AS n FROM public.attendance
      WHERE status::text NOT IN ('present','absent')`,
    (r) => r[0].n === 0,
  );
  await check(
    "the present/absent CHECK is enforced in the database, not just the UI",
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.attendance'::regclass
        AND conname = 'attendance_status_present_absent_only'`,
    (r) => r.length === 1,
  );
  await check(
    "an attendance row cannot disagree with its submission about section/date (G9 divergence guard)",
    `SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.attendance'::regclass
        AND tgname = 'trg_attendance_matches_submission' AND NOT tgisinternal`,
    (r) => r.length === 1,
  );
  await check(
    "the principal is fenced out of marking and editing attendance by RESTRICTIVE policy, not by the UI",
    `SELECT tablename FROM pg_policies
      WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
        AND policyname IN ('attendance_principal_never_writes',
                           'attendance_submissions_principal_never_writes')`,
    (r) => r.length === 2,
  );
  await check(
    "the bulk attendance write path creates the submission before the records",
    `SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'rpc_bulk_upsert_attendance'`,
    (r) => r.length === 1 && /rpc_ensure_attendance_submission/.test(r[0].prosrc),
  );

  // ---- progression_history whitelist -----------------------------------
  // Was too narrow from 2026-08-22 to 2026-08-26: nine of the eleven
  // source types the app emits raised 23514, and awardSafe's bare catch{}
  // hid every one. Guard the widened list so it cannot silently shrink again.
  await check(
    "progression_history.source_type accepts every source type the application emits",
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'progression_history_source_type_check'`,
    (r) =>
      r.length === 1 &&
      ['attendance','battle','deep_link','dpp_attempt','homework_submission',
       'practice_session','recovery_followup','revision','student_mistake',
       'student_test_attempt','weak_concept']
        .every((t) => r[0].def.includes(`'${t}'`)),
  );
  await check(
    "every legacy students.parent_user_id link is represented in parent_students",
    `SELECT count(*)::int AS n FROM public.students s
      WHERE s.parent_user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.parent_students ps
                          JOIN public.parents p ON p.id = ps.parent_id
                         WHERE ps.student_id = s.id AND p.user_id = s.parent_user_id)`,
    (r) => r[0].n === 0,
  );

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
