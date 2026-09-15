-- ═══════════════════════════════════════════════════════════════════════════
-- One recovery engine
--
-- Two recovery engines have been running side by side in this database.
--
--   OLD   recovery_assignments + recovery_assignment_questions. An assignment
--         was created on the FIRST wrong answer, keyed on a free-text
--         (subject, chapter, concept) triple, and worked through by a set of
--         screens that were deleted in "Delete the retired recovery-assignment
--         flow". Since that commit NOTHING reads these rows: the 17 live
--         assignments all sit at questions_completed = 0 and no client can
--         open one.
--
--   NEW   chapter_state + recovery_sessions + revision_sessions, keyed on
--         chapter_id, triggered at RECOVERY_TRIGGER_COUNT open mistakes,
--         scored as two rates that are never blended (§4.2b), and followed by
--         the §5.3 revision ladder at 7/21/60 days.
--
-- This migration removes the old one entirely — its writers, its readers, its
-- report branch and its two tables — so there is exactly one place where
-- "does this student need recovery?" is decided.
--
-- ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
--
-- public.revision_queue SURVIVES, deliberately. It looks like a second
-- revision engine and it is not one: _rebuild_revision_queue derives it from
-- _weak_topics_for_user, it auto-clears when a topic's accuracy recovers, and
-- it is read only by the AI/EIE layer as a weak-TOPIC worklist. The §5.3
-- ladder answers a different question — "you cleared recovery on this CHAPTER,
-- come back in 7 days" — and is the only thing the student's Revision screen
-- has read since "Switch Recovery onto the 7C engine". Two questions, two
-- tables, one home each.
--
-- What was wrong is that rpc_student_academic_snapshot served the weak-topic
-- worklist to the student panel under the key `revision_queue`, so the
-- Dashboard badge and the Revision screen counted different things. That is
-- fixed here too: the snapshot now reports `revision_due` from chapter_state,
-- the same source the Revision screen reads.
--
-- ── HOW THE FUNCTION REWRITES ARE GUARDED ───────────────────────────────────
--
-- 20260828200000 rewrote ten function bodies in place, so migration FILE text
-- is no longer a reliable picture of what is live. Every body replaced below
-- was read out of the live database with pg_get_functiondef immediately before
-- this file was written, and the precheck asserts each one still hashes to
-- exactly what was read. If anything moved underneath, this migration refuses
-- to run rather than silently reverting somebody else's change.
--
-- Reverse: supabase/migrations/rollback/20260926000000_one_recovery_engine.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Precheck: the live bodies are the ones this rewrite was written against
-- G11: this can fail. Change any one of these six functions by a single byte
-- and the migration aborts before touching anything.
DO $precheck$
DECLARE
  _expected constant jsonb := jsonb_build_object(
    '_build_concept_recovery_report',       '6c028219c0788b8b191b2c015567b80c',
    'rpc_get_concept_recovery_report',      'c7b9cd20a9d51636461c2d1ce043455e',
    'rpc_post_assessment_concept_analysis', '78c29afd60a221e8a9ca2db716f3e1c3',
    'rpc_record_concept_mistake',           '63ae19cd797999a5c2cf8d53fa2ebd82',
    'rpc_refresh_academic_brain',           '23338635aa77a8b7643d08d9932325fd',
    'rpc_student_academic_snapshot',        '1260ae45c86a00d9fede2e39f128a946'
  );
  _name text; _want text; _got text;
BEGIN
  FOR _name, _want IN SELECT * FROM jsonb_each_text(_expected) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = _name;

    IF _got IS NULL THEN
      RAISE EXCEPTION 'precheck: public.% does not exist', _name;
    ELSIF _got <> _want THEN
      RAISE EXCEPTION
        'precheck: public.% has changed since this migration was written (live md5 %, expected %). Re-read the live body with pg_get_functiondef and rewrite this file against it.',
        _name, _got, _want;
    END IF;
  END LOOP;
  RAISE NOTICE 'precheck: all six live bodies match';
END
$precheck$;

-- ── 1. The report stops having a recovery-assignment shape to report on ──────
--
-- _build_concept_recovery_report had a fourth source_type, 'recovery_assignment',
-- which scored a finished assignment. Nothing has passed that value since the
-- Recovery screens were deleted, and the table it read is dropped below. The
-- branch goes, and with it the two locals (_a, _acc) that only it used.
CREATE OR REPLACE FUNCTION public._build_concept_recovery_report(_source_type text, _source_id uuid, _uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  _total int := 0; _correct int := 0; _time_sec int := 0;
  _weak jsonb := '[]'::jsonb; _row record;
BEGIN

  IF _source_type = 'test_attempt' THEN
    SELECT att.correct_count, att.total_count, att.time_spent_sec
      INTO _correct, _total, _time_sec
    FROM public.test_attempts att WHERE att.id = _source_id AND att.user_id = _uid;

    FOR _row IN
      SELECT
        COALESCE(sm.subject, 'General') AS subject,
        sm.chapter AS chapter,
        COALESCE(sm.concept, sm.subconcept, sm.topic, sm.chapter) AS concept,
        sm.subconcept,
        count(*)::int AS attempts,
        0::int AS correct
      FROM public.student_mistakes sm
      JOIN public.test_attempts att ON att.test_id = sm.source_id
      WHERE att.id = _source_id AND att.user_id = _uid
        AND sm.user_id = _uid AND sm.source = 'test'
      GROUP BY 1, 2, 3, 4
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter,
          'concept', _row.concept, 'subconcept', _row.subconcept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1),
          'attempts', _row.attempts, 'correct', _row.correct
        ));
      END IF;
    END LOOP;

  ELSIF _source_type = 'battle_participant' THEN
    SELECT bp.correct_count, bp.answered_count,
           GREATEST(EXTRACT(EPOCH FROM (bp.finished_at - bp.joined_at))::int, 0)
      INTO _correct, _total, _time_sec
    FROM public.battle_participants bp WHERE bp.id = _source_id AND bp.user_id = _uid;

    FOR _row IN
      SELECT
        COALESCE(b.subject, 'General') AS subject,
        b.chapter,
        COALESCE(bq.concept, b.topic, b.chapter, b.subject) AS concept,
        bq.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE ba.is_correct)::int AS correct
      FROM public.battle_answers ba
      JOIN public.battle_questions bq ON bq.id = ba.question_id
      JOIN public.battle_participants bp ON bp.id = ba.participant_id
      JOIN public.battles b ON b.id = bp.battle_id
      WHERE bp.id = _source_id AND bp.user_id = _uid
      GROUP BY 1, 2, 3, 4
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;

  ELSIF _source_type = 'practice_session' THEN
    SELECT ps.correct_count, ps.question_count,
           GREATEST(EXTRACT(EPOCH FROM (COALESCE(ps.finished_at, now()) - ps.created_at))::int, 0)
      INTO _correct, _total, _time_sec
    FROM public.practice_sessions ps WHERE ps.id = _source_id AND ps.user_id = _uid;

    SELECT count(*)::int, count(*) FILTER (WHERE qa.is_correct)::int
      INTO _total, _correct
    FROM public.question_attempts qa
    WHERE qa.session_id = _source_id AND qa.user_id = _uid;

    FOR _row IN
      SELECT
        COALESCE(qa.subject, ps.subject) AS subject,
        COALESCE(qa.chapter, ps.chapter) AS chapter,
        COALESCE(qa.concept, qa.chapter, ps.chapter, ps.subject) AS concept,
        qa.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE qa.is_correct)::int AS correct
      FROM public.question_attempts qa
      JOIN public.practice_sessions ps ON ps.id = qa.session_id
      WHERE ps.id = _source_id AND ps.user_id = _uid
      GROUP BY 1, 2, 3, 4
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;

  ELSE
    RAISE EXCEPTION 'Unknown source_type: %', _source_type;
  END IF;

  RETURN jsonb_build_object(
    'source_type', _source_type,
    'source_id', _source_id,
    'accuracy_pct', CASE WHEN _total > 0 THEN round(100.0 * _correct / _total, 1) ELSE 0 END,
    'correct_count', _correct,
    'total_count', _total,
    'time_sec', _time_sec,
    'time_minutes', round(COALESCE(_time_sec, 0) / 60.0, 1),
    'weak_concepts', _weak,
    'improvement_areas', (
      SELECT COALESCE(jsonb_agg(w->>'concept'), '[]'::jsonb)
      FROM jsonb_array_elements(_weak) w
    )
  );
END; $fn$;

-- ── 2. The two report RPCs stop appending an assignment list ─────────────────
--
-- Both returned `_report || jsonb_build_object('recovery_assignments', …)`.
-- The client read that key in exactly one place — a "Fix my mistakes (N
-- queued)" button — and that button is repointed at weak_concepts in the same
-- change, because weak_concepts is what the report is ABOUT.
CREATE OR REPLACE FUNCTION public.rpc_get_concept_recovery_report(_source_type text, _source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  RETURN public._build_concept_recovery_report(_source_type, _source_id, _uid);
END; $fn$;

-- rpc_post_assessment_concept_analysis additionally CREATED assignments, one
-- per weak concept, guarded by an EXISTS on the same table so a re-open of the
-- report did not duplicate them. With the table gone the whole loop goes; what
-- is left is the report plus the weak-topic worklist rebuild, which is the
-- only side effect this RPC still has a reason to perform.
CREATE OR REPLACE FUNCTION public.rpc_post_assessment_concept_analysis(_source_type text, _source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _report jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _report := public._build_concept_recovery_report(_source_type, _source_id, _uid);

  -- The AI layer's weak-TOPIC worklist (see the header). Not the §5.3 ladder.
  PERFORM public._rebuild_revision_queue(_uid, _sid);

  RETURN _report;
END; $fn$;

-- ── 3. A wrong answer stops creating an assignment ───────────────────────────
--
-- rpc_record_concept_mistake is the hot path: rpc_record_question_attempt
-- calls it for every wrong answer in practice, tests and battles. It did three
-- things — write the mistake book, update concept mastery, and fire the OLD
-- engine. Only the third goes. The _mastery local went with it: its single
-- reader was the rpc_assign_concept_recovery call.
--
-- The mistake-book INSERT is what feeds the NEW engine: RECOVERY_TRIGGER_COUNT
-- counts open student_mistakes rows per chapter_id, and chapter_id is set by
-- tg_student_mistakes_set_chapter_id (20260921000000).
CREATE OR REPLACE FUNCTION public.rpc_record_concept_mistake(_assessment_type text, _source_id uuid, _question_id uuid DEFAULT NULL::uuid, _subject text DEFAULT 'General'::text, _chapter text DEFAULT NULL::text, _concept text DEFAULT NULL::text, _subconcept text DEFAULT NULL::text, _class_level integer DEFAULT NULL::integer, _question_text text DEFAULT ''::text, _options jsonb DEFAULT '[]'::jsonb, _student_answer jsonb DEFAULT '{}'::jsonb, _correct_answer jsonb DEFAULT '{}'::jsonb, _explanation text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _mid uuid; _concept_f text; _sub_f text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _sub_f := COALESCE(NULLIF(_subconcept, ''), _concept_f);

  INSERT INTO public.student_mistakes (
    user_id, student_id, source, source_id, question_id,
    class_level, subject, chapter, topic, concept, subconcept, assessment_type,
    question_text, options, student_answer, correct_answer, explanation,
    times_wrong, last_wrong_at
  ) VALUES (
    _uid, _sid,
    CASE _assessment_type
      WHEN 'battle' THEN 'battleground'
      WHEN 'practice' THEN 'practice'
      ELSE _assessment_type
    END,
    _source_id, _question_id,
    _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _assessment_type,
    _question_text, _options, _student_answer, _correct_answer, _explanation,
    1, now()
  )
  ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
    times_wrong = student_mistakes.times_wrong + 1,
    last_wrong_at = now(),
    student_answer = EXCLUDED.student_answer,
    concept = EXCLUDED.concept,
    subconcept = EXCLUDED.subconcept,
    status = 'open', cleared_at = NULL
  RETURNING id INTO _mid;

  PERFORM public._upsert_concept_mastery(_uid, _sid, _class_level, _subject, _chapter, _concept_f, _sub_f, false, false);

  IF _assessment_type IN ('practice', 'test', 'battle') AND _sid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.revision_queue
      WHERE user_id = _uid AND NOT completed
        AND subject = _subject
        AND COALESCE(chapter, '') = COALESCE(_chapter, '')
        AND COALESCE(topic, '') = COALESCE(_concept_f, '')
    ) THEN
      INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (
        _uid, _sid, _subject, _chapter, _concept_f,
        CASE _assessment_type WHEN 'practice' THEN 'practice_wrong' ELSE _assessment_type || '_wrong' END,
        75, CURRENT_DATE
      );
    ELSE
      UPDATE public.revision_queue SET
        priority = GREATEST(priority, 75),
        due_date = LEAST(due_date, CURRENT_DATE),
        reason = CASE _assessment_type WHEN 'practice' THEN 'practice_wrong' ELSE _assessment_type || '_wrong' END
      WHERE user_id = _uid AND NOT completed
        AND subject = _subject
        AND COALESCE(chapter, '') = COALESCE(_chapter, '')
        AND COALESCE(topic, '') = COALESCE(_concept_f, '');
    END IF;
  END IF;

  RETURN _mid;
END; $fn$;

-- ── 4. The student panel counts recovery and revision the way its screens do ─
--
-- Two keys were wrong, and both were wrong in the same way: the snapshot
-- answered from the retired engine while the screen next to it answered from
-- the new one.
--
--   recovery_pending  was open recovery_assignments rows. Dashboard rendered
--                     it as "N mistakes waiting to recover" while Recovery
--                     itself showed chapters at RECOVERY_TRIGGER_COUNT.
--                     It is now that same count of ready CHAPTERS, decided
--                     against recovery_constants, exactly as
--                     rpc_student_recovery_queue decides `ready`.
--
--   revision_queue    was up to ten rows of the weak-topic worklist, rendered
--                     as "N topics due for revision" while Revision showed
--                     chapter_state rows whose next_revision_at had arrived.
--                     It is replaced by revision_due: that count, nothing else.
--                     No caller read the rows themselves — Dashboard and
--                     LearningHub both took .length.
--
-- _rebuild_revision_queue stays: it maintains the AI layer's worklist, and
-- this is still the most frequently called place that can keep it current.
CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid(); _s record; _xp record;
  _hw_pending int := 0; _hw_done int := 0; _test_open int := 0; _test_done int := 0;
  _weak jsonb; _mistakes int; _heat jsonb;
  _recovery_pending int := 0; _mastery_summary jsonb; _practice_sessions int := 0;
  _revision_due int := 0; _trigger int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _s FROM public.students_current WHERE user_id = _uid LIMIT 1;
  SELECT * INTO _xp FROM public.student_xp WHERE user_id = _uid;

  IF _s.id IS NOT NULL THEN
    -- completed: given (submitted or accepted). pending: not given and the
    -- deadline has not passed, so there is still something to do — rejected
    -- work included. homework_student_status is the one place both are decided.
    SELECT count(*) FILTER (WHERE hss.given),
           count(*) FILTER (WHERE NOT hss.given AND NOT hss.closed)
      INTO _hw_done, _hw_pending
    FROM public.homework_student_status hss
    WHERE hss.student_id = _s.id;

    SELECT count(*) FILTER (WHERE att.status = 'submitted'),
           count(*) FILTER (WHERE att.status IS DISTINCT FROM 'submitted')
      INTO _test_done, _test_open
    FROM public.tests d
    LEFT JOIN public.test_attempts att ON att.test_id = d.id AND att.user_id = _uid
    WHERE d.status = 'published' AND d.section_subject_id IN (SELECT ss.id FROM public.section_subjects ss WHERE ss.section_id = _s.class_id);
  END IF;

  -- "Finished" is not "answered": a session the loader could not fill is
  -- auto-finished with zero attempts (20260925000000).
  SELECT count(*)::int INTO _practice_sessions
  FROM public.practice_sessions WHERE user_id = _uid AND finished_at IS NOT NULL
    AND (COALESCE(correct_count, 0) + COALESCE(wrong_count, 0) + COALESCE(skipped_count, 0)) > 0;

  SELECT COALESCE(jsonb_agg(row_to_json(w) ORDER BY w.accuracy ASC), '[]'::jsonb)
    INTO _weak FROM public._weak_topics_for_user(_uid) w WHERE w.accuracy < 60 LIMIT 5;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', activity_date, 'test', test_count, 'homework', homework_count,
    'battles', battle_count, 'self_practice', self_practice_count, 'minutes', practice_minutes
  ) ORDER BY activity_date), '[]'::jsonb)
    INTO _heat FROM public.academic_daily_activity
    WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 28;

  SELECT count(*) INTO _mistakes FROM public.student_mistakes
    WHERE user_id = _uid AND status = 'open';

  -- §4.1. The same comparison rpc_student_recovery_queue makes, against the
  -- same constant, so the badge and the screen cannot disagree.
  _trigger := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;

  SELECT count(*)::int INTO _recovery_pending FROM (
    SELECT sm.chapter_id
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.status = 'open' AND sm.chapter_id IS NOT NULL
     GROUP BY sm.chapter_id
    HAVING count(*) >= _trigger
  ) ready_chapters;

  -- §5.3. A chapter is due when its scheduled date has arrived. A chapter that
  -- reached REVISION_STAGES_TO_SOLID has next_revision_at NULL and is counted
  -- by neither branch, which is what removes it from the student's list.
  SELECT count(*)::int INTO _revision_due
  FROM public.chapter_state cs
  WHERE cs.user_id = _uid
    AND cs.next_revision_at IS NOT NULL
    AND cs.next_revision_at <= now();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'concept', concept, 'mastery_score', mastery_score
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _mastery_summary
  FROM public.concept_mastery WHERE user_id = _uid AND mastery_score < 60 LIMIT 5;

  -- Maintains the AI/EIE weak-topic worklist. No student screen reads it.
  PERFORM public._rebuild_revision_queue(_uid, _s.id);

  RETURN jsonb_build_object(
    'student', CASE WHEN _s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', _s.id, 'full_name', _s.full_name, 'class_id', _s.class_id,
      'roll_number', _s.roll_number, 'admission_number', _s.admission_number
    ) END,
    'xp', CASE WHEN _xp IS NULL THEN NULL ELSE to_jsonb(_xp) END,
    'homework', jsonb_build_object('pending', _hw_pending, 'completed', _hw_done),
    'test', jsonb_build_object('open', _test_open, 'completed', _test_done),
    'self_practice', jsonb_build_object('sessions_completed', _practice_sessions),
    'weak_topics', _weak,
    'revision_due', _revision_due,
    'mistake_count', _mistakes,
    'recovery_pending', _recovery_pending,
    'weak_concepts', _mastery_summary,
    'activity_heatmap', _heat,
    'exam_readiness', public._exam_readiness(_uid, _s.id)
  );
END; $fn$;

-- ── 5. The academic brain summarises recovery from the sessions it has ───────
--
-- Targeted substitution rather than a rewrite: rpc_refresh_academic_brain is
-- 7.3 KB and only its recovery summary is wrong. The two edits below are
-- anchored on whole statements, and the guard makes an edit that matched
-- nothing fatal instead of silent.
--
-- The shape changes with the source. `avg_completion` was "how far through
-- their assignments the student got", which recovery sessions do not have —
-- a session is taken in one sitting. `avg_readiness` is the §4.2b readiness
-- those sessions were scored at, which is the comparable fact.
DO $brain$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'rpc_refresh_academic_brain';

  _new := replace(_def,
$old$  SELECT jsonb_build_object(
    'total_assignments', count(*),
    'completed', count(*) FILTER (WHERE status = 'completed'),
    'open', count(*) FILTER (WHERE status IN ('pending', 'in_progress')),
    'avg_completion', round(
      COALESCE(avg(CASE WHEN question_count > 0
        THEN questions_completed::numeric / question_count * 100 END), 0), 1
    )
  )
  INTO _recovery_hist FROM public.recovery_assignments WHERE user_id = _uid;$old$,
$new$  SELECT jsonb_build_object(
    'total_rounds', count(*),
    'cleared', count(*) FILTER (WHERE outcome = 'ready'),
    'open', count(*) FILTER (WHERE completed_at IS NULL),
    'avg_readiness', round(COALESCE(avg(readiness) * 100, 0), 1)
  )
  INTO _recovery_hist FROM public.recovery_sessions WHERE user_id = _uid;$new$);

  IF _new = _def THEN
    RAISE EXCEPTION 'could not find the recovery_assignments summary in rpc_refresh_academic_brain';
  END IF;
  _def := _new;

  _new := replace(_def,
    $old$_recovery_pct := COALESCE((_recovery_hist->>'avg_completion')::numeric, 0);$old$,
    $new$_recovery_pct := COALESCE((_recovery_hist->>'avg_readiness')::numeric, 0);$new$);

  IF _new = _def THEN
    RAISE EXCEPTION 'could not find the _recovery_pct assignment in rpc_refresh_academic_brain';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'rpc_refresh_academic_brain now summarises recovery_sessions';
END
$brain$;

-- ── 6. The retired engine's own functions ────────────────────────────────────
--
-- Every one of these either reads or writes recovery_assignments and has no
-- caller left. rpc_complete_revision is here for a different reason: it marked
-- one weak-topic worklist row done for the "Mark done" button that
-- "Switch Recovery onto the 7C engine" replaced with a real revision check,
-- and PracticeService.completeRevision, its only caller, goes in the same
-- commit as this migration.
DO $drop_fns$
DECLARE _p record; _n int := 0;
BEGIN
  FOR _p IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (ARRAY[
         'rpc_assign_concept_recovery',
         'rpc_complete_recovery_assignment',
         'rpc_get_recovery_assignment',
         'rpc_student_recovery_zone',
         'rpc_submit_recovery_answer',
         'rpc_complete_revision'
       ])
  LOOP
    EXECUTE format('DROP FUNCTION %s', _p.sig);
    _n := _n + 1;
  END LOOP;

  IF _n = 0 THEN
    RAISE EXCEPTION 'nothing dropped: the retired functions were expected to exist';
  END IF;
  RAISE NOTICE 'dropped % retired functions', _n;
END
$drop_fns$;

-- ── 7. The tables ────────────────────────────────────────────────────────────
--
-- No CASCADE. If anything still depends on either table — a view, a policy on
-- a third table, a function body missed above — this fails and the whole
-- migration rolls back, which is the point. The child goes first because
-- recovery_assignment_questions.assignment_id references the parent.
DROP TABLE public.recovery_assignment_questions;
DROP TABLE public.recovery_assignments;

-- ── 8. Prove it ──────────────────────────────────────────────────────────────
-- G11: every assertion here can fail. The first two would fail if a DROP had
-- been written as a no-op; the third reads the live snapshot for a real
-- student and asserts the new keys are present AND that the retired one is
-- gone, which a rewrite that forgot to delete the old key would not survive.
DO $prove$
DECLARE
  _left text;
  _uid  uuid;
  _snap jsonb;
  _want int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('recovery_assignments', 'recovery_assignment_questions')
  ) THEN
    RAISE EXCEPTION 'a recovery-assignment table survived the drop';
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO _left
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) LIKE '%recovery_assignment%';

  IF _left IS NOT NULL THEN
    RAISE EXCEPTION 'these functions still mention recovery_assignment: %', _left;
  END IF;

  -- A student who actually has mistakes, so the counts below are exercised
  -- rather than defaulted.
  SELECT sm.user_id INTO _uid
    FROM public.student_mistakes sm
   WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL
   GROUP BY sm.user_id
   ORDER BY count(*) DESC
   LIMIT 1;

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'no student has an open mistake with a chapter; the snapshot counts could not be exercised';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  _snap := public.rpc_student_academic_snapshot();

  IF _snap ? 'revision_queue' THEN
    RAISE EXCEPTION 'the snapshot still returns the retired revision_queue key';
  END IF;
  IF NOT (_snap ? 'revision_due') THEN
    RAISE EXCEPTION 'the snapshot does not return revision_due';
  END IF;

  SELECT count(*)::int INTO _want FROM (
    SELECT sm.chapter_id
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.status = 'open' AND sm.chapter_id IS NOT NULL
     GROUP BY sm.chapter_id
    HAVING count(*) >= public._recovery_const('RECOVERY_TRIGGER_COUNT')::int
  ) x;

  IF (_snap->>'recovery_pending')::int IS DISTINCT FROM _want THEN
    RAISE EXCEPTION 'recovery_pending reports % but % chapters are at the trigger',
      _snap->>'recovery_pending', _want;
  END IF;

  RAISE NOTICE 'one engine: recovery_pending = %, revision_due = %',
    _snap->>'recovery_pending', _snap->>'revision_due';
END
$prove$;

COMMIT;
