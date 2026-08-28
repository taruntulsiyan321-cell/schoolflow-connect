-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7B — BATCH 2c: battles are practice
--
-- §10.8, as ruled: a battle is student-initiated and not teacher-assigned, so
-- it is practice. Its durable record is the score, the XP and the mistakes —
-- never a per-question list of what the student got right. And "strong areas
-- are never shown anywhere in the app."
--
-- Looking for battle_answers.is_correct found four more places the same fact
-- was being kept or served, three of which no column sweep would ever see.
--
-- ── 1. battle_reports.report is a durable per-question correctness record ───
--
-- _snapshot_battle_report writes a jsonb blob containing:
--
--     topics.strong   chapters where count(*) FILTER (WHERE ba.is_correct)
--                     = count(*) — literally "what you got entirely right"
--     questions[]     every question with correct_index AND selected_index
--
-- stored for 20 hours. CHUNK7B_BATCH1_VERIFY item 2 sweeps information_schema
-- for correctness COLUMNS and could never have found this: it is inside jsonb.
--
-- ── 2. Three paths served it to a teacher ──────────────────────────────────
--
--     policy   battle_reports "br teacher read"     creator, admin, principal,
--                                                   or teacher-of-class
--     policy   battle_reports "br ai update self"   same set, for writes
--     definer  rpc_ensure_battle_report             authenticated-callable, and
--                                                   authorises exactly that set
--                                                   to GENERATE and read another
--                                                   student's report
--
-- The definer is the same shape as rpc_teacher_class_insights, closed earlier
-- today, and as Nova's facts bundle. Fourth instance of the pattern.
--
-- Note `creator_user_id = auth.uid()` in those policies: a battle creator may
-- be a STUDENT, so this also leaked one student's topic breakdown to another
-- student who happened to create the battle. §10.16 makes XP, score, level,
-- league and streak public; it does not make a topic breakdown public.
--
-- ── 3. The UI was reachable, unlike the DPP one ────────────────────────────
--
-- src/pages/teacher/BattleTeacherReport.tsx is routed at
-- /teacher/battleground/monitor/:id/report/:participantId. A teacher could
-- navigate to a student's battle report today.
--
-- ── What this migration does ───────────────────────────────────────────────
--
-- Storage first, then the doors:
--
--   * battle_answers keeps is_correct as IN-FLIGHT working state, which §10.8
--     explicitly permits — a battle cannot be scored without it. When the
--     participant finishes, the CORRECT rows are deleted. Wrong and skipped
--     rows survive, which is exactly "only what went wrong is stored per
--     question". Skipped rows are is_correct = false, so they are kept.
--
--     This also fixes the report by construction: with no correct rows left,
--     topics.strong can never populate and questions[] can only contain
--     wrong and skipped ones. The derived violation follows the stored one.
--
--   * topics.strong is removed from _snapshot_battle_report anyway, rather
--     than left to fall out of the purge. A report generated mid-battle would
--     still have correct rows to aggregate, and strong areas must not be shown
--     at any point, in flight or not.
--
--   * The two policies and the definer's authorisation are narrowed to the
--     owning student.
--
-- ── Reported, not fixed here ───────────────────────────────────────────────
--
-- _capture_battle_mistakes writes a row into question_attempts for EVERY
-- battle answer, correct ones included, with is_correct set. That is the same
-- violation question_records had before batch 1 retired it, now in
-- question_attempts — which is 7C's subject because 14 SECURITY DEFINER
-- functions read it. Battles are one of its feeders, and that is the reason
-- it must be handled with the analytics engine rather than before it.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Prove the leak is live before closing it ────────────────────────────
DO $before$
DECLARE _teacher uuid; _n bigint;
BEGIN
  SELECT id INTO _teacher FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  IF _teacher IS NULL THEN
    RAISE EXCEPTION 'batch 2c: no teacher account to measure with.';
  END IF;

  -- Does the policy set currently admit a non-owner? Evaluated as the policy
  -- expression rather than by reading rows, because the demo battle_reports
  -- row may not belong to a class this teacher teaches — a zero row count
  -- would then prove nothing about whether the door is open.
  SELECT count(*) INTO _n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'battle_reports'
     AND p.polpermissive
     AND pg_get_expr(p.polqual, p.polrelid) ~* 'has_role|teacher_teaches_class|creator_user_id';

  IF _n = 0 THEN
    RAISE EXCEPTION
      'batch 2c: no non-owner read policy found on battle_reports, so there is nothing to close here and the after-check would be vacuous.';
  END IF;

  RAISE NOTICE 'batch 2c: % non-owner policy path(s) on battle_reports before closure.', _n;
END
$before$;


-- ── 2. The two doors on battle_reports ─────────────────────────────────────
DROP POLICY IF EXISTS "br teacher read" ON public.battle_reports;

DROP POLICY IF EXISTS "br ai update self" ON public.battle_reports;
CREATE POLICY "br ai update self" ON public.battle_reports
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ── 3. The definer that authorises the same set ────────────────────────────
-- Narrowed to the owning student. Rewritten through pg_get_functiondef so the
-- signature, volatility, SECURITY DEFINER flag and search_path survive exactly.
DO $narrow$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_ensure_battle_report';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'batch 2c: rpc_ensure_battle_report not found.';
  END IF;

  _new := regexp_replace(
    _def,
    'IF _p\.user_id <> auth\.uid\(\).*?THEN\s*RAISE EXCEPTION ''Not authorized'';',
    'IF _p.user_id <> auth.uid() THEN' || E'\n' ||
    '    -- A battle report is practice (§10.8): the student and nobody else.' || E'\n' ||
    '    RAISE EXCEPTION ''Not authorized'';',
    '');

  IF _new = _def THEN
    RAISE EXCEPTION
      'batch 2c: the authorisation block in rpc_ensure_battle_report did not match, so nothing was narrowed. Re-read the body rather than assuming this landed.';
  END IF;

  EXECUTE _new;
END
$narrow$;


-- ── 4. Strong areas out of the snapshot ────────────────────────────────────
DO $strong$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_snapshot_battle_report';

  _new := regexp_replace(
    _def,
    '''strong'', COALESCE\(\(.*?\), ''\[\]''::jsonb\),(\s*)''weak'',',
    '''strong'', ''[]''::jsonb,\1''weak'',',
    '');

  IF _new = _def THEN
    RAISE EXCEPTION
      'batch 2c: the topics.strong block in _snapshot_battle_report did not match, so strong areas would still be computed.';
  END IF;

  EXECUTE _new;

  -- Assert it: the surviving body must not aggregate correctness into strong.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = '_snapshot_battle_report'
       AND p.prosrc ~ 'HAVING count\(\*\) FILTER \(WHERE ba\.is_correct\) = count\(\*\)'
  ) THEN
    RAISE EXCEPTION 'batch 2c: the strong-areas aggregate survived the rewrite.';
  END IF;
END
$strong$;


-- ── 5. The transient rule, in rpc_finish_battle ────────────────────────────
-- Correct rows are deleted when the participant finishes. This runs AFTER the
-- existing mistake capture and question-history capture in that function, both
-- of which need the full answer set, so the purge is appended at the end.
DO $purge$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_battle';

  IF _def !~ '_bump_academic_activity' THEN
    RAISE EXCEPTION
      'batch 2c: rpc_finish_battle no longer ends with the activity bump; the purge would be inserted in the wrong place.';
  END IF;

  -- Append immediately before the function's final END.
  _new := regexp_replace(
    _def,
    'END;\s*\$function\$\s*$',
    E'\n  -- §10.8 transient rule: per-question correctness may exist while the\n'
    || E'  -- session is in flight, because a battle cannot be scored without it,\n'
    || E'  -- but it must not persist once the session closes. The score is on\n'
    || E'  -- battle_participants, the totals on student_xp, and the mistakes in\n'
    || E'  -- student_mistakes — all captured above. What is left here is the\n'
    || E'  -- record of what the student got RIGHT, which nothing may keep.\n'
    || E'  -- Wrong and skipped rows survive (skipped are is_correct = false).\n'
    || E'  BEGIN\n'
    || E'    DELETE FROM public.battle_answers\n'
    || E'     WHERE participant_id = _participant_id AND is_correct IS TRUE;\n'
    || E'  EXCEPTION WHEN OTHERS THEN\n'
    || E'    RAISE WARNING ''rpc_finish_battle(%): correct-answer purge failed: %'', _participant_id, SQLERRM;\n'
    || E'  END;\n'
    || E'END;\n$function$\n',
    '');

  IF _new = _def THEN
    RAISE EXCEPTION 'batch 2c: could not append the purge to rpc_finish_battle.';
  END IF;

  EXECUTE _new;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_battle'
       AND p.prosrc ~ 'DELETE FROM public\.battle_answers'
  ) THEN
    RAISE EXCEPTION 'batch 2c: the purge is not present in rpc_finish_battle after the rewrite.';
  END IF;
END
$purge$;


-- ── 6. Backfill: participants who already finished ─────────────────────────
-- Their correct answers are durable records of what they got right, written
-- before this rule existed. The mistakes and totals were already captured.
DELETE FROM public.battle_answers ba
 USING public.battle_participants bp
 WHERE bp.id = ba.participant_id
   AND bp.finished_at IS NOT NULL
   AND ba.is_correct IS TRUE;


-- ── 7. Assert the closure ──────────────────────────────────────────────────
DO $after$
DECLARE _fail text := ''; _n bigint;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'battle_reports'
     AND p.polpermissive
     AND pg_get_expr(p.polqual, p.polrelid) ~* 'has_role|teacher_teaches_class|creator_user_id';
  IF _n <> 0 THEN
    _fail := _fail || format('[%s non-owner policy path(s) survive on battle_reports] ', _n);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rpc_ensure_battle_report'
       AND p.prosrc ~* 'teacher_teaches_class|has_role'
  ) THEN
    _fail := _fail || '[rpc_ensure_battle_report still authorises non-owners] ';
  END IF;

  SELECT count(*) INTO _n
    FROM public.battle_answers ba
    JOIN public.battle_participants bp ON bp.id = ba.participant_id
   WHERE bp.finished_at IS NOT NULL AND ba.is_correct IS TRUE;
  IF _n <> 0 THEN
    _fail := _fail || format('[%s correct answer(s) still stored on finished battles] ', _n);
  END IF;

  -- The other half: wrong and skipped rows must NOT have been purged, or the
  -- mistake book loses its source and "nothing stored" would look identical
  -- to "correctly purged".
  SELECT count(*) INTO _n
    FROM public.battle_answers ba
    JOIN public.battle_participants bp ON bp.id = ba.participant_id
   WHERE bp.finished_at IS NOT NULL AND ba.is_correct IS FALSE;
  RAISE NOTICE 'batch 2c: % wrong/skipped answer(s) retained on finished battles.', _n;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'batch 2c FAILED: %', _fail;
  END IF;
END
$after$;

COMMIT;
