-- ═══════════════════════════════════════════════════════════════════════════
-- Ruling 1 — the parent digest is rebuilt from school data, not stripped
--
-- ── WHAT IT WAS SENDING TO PARENTS ────────────────────────────────────────
--
-- The old function passed the child's FULL academic snapshot straight through:
--
--     'snapshot', COALESCE(_snap, '{}'::jsonb)
--
-- where _snap = rpc_student_academic_snapshot_internal(...). That payload
-- carried, to a PARENT:
--
--   practice_accuracy_pct   computed straight from question_attempts. The
--                           repo's own comment calls it the "Practice-only
--                           accuracy SSOT".
--   accuracy_pct            a test/practice blend that DEGENERATES to pure
--                           practice accuracy when the child has no submitted
--                           tests.
--   active_days_14d         battle_count + self_practice_count.
--   activity_heatmap        totals including battle_count.
--   exam_readiness.score    0.35 x blended-accuracy + 0.15 x practice VOLUME.
--
-- §10.8: practice is "completely private to the student. No teacher, no parent,
-- no principal, no aggregate." §10.15: the weekly summary is "school data only
-- — homework, marks, attendance", and weak-concept alerts are "derived from
-- tests and exams only. Never from practice."
--
-- All three alert branches keyed off `score` or `active_days_14d`, so all three
-- were practice-derived. The first was titled "Needs support in practice."
--
-- Migration 20260828220000 already flagged this and left it in.
--
-- ── AND IT WAS MISSING THE HALF IT WAS SUPPOSED TO HAVE ───────────────────
--
-- §10.15 names three things: homework, marks, attendance. The old payload had
-- no marks or exam figure ANYWHERE. Homework appeared only as an
-- undifferentiated addend inside two sums. Only attendance_pct survived as a
-- distinct figure — one of three.
--
-- So stripping was the wrong instruction and the ruling is right: removing the
-- practice fields would have left attendance and a test-completion count and
-- killed every alert. This rebuilds the function against the three sources the
-- spec actually names.
--
-- ── WHAT IS DELIBERATELY GONE ─────────────────────────────────────────────
--
-- NO READINESS SCORE. The ruling allowed "recomputed school-only or dropped",
-- and dropped is the honest choice. A school-only readiness would be a NEW
-- weighted composite invented in SQL — and "it must not compute figures itself,
-- or it will eventually state an invented number to a parent as fact" (§10.15)
-- is precisely what the old 0.25/0.25/0.35/0.15 weighting did. Replacing one
-- invented composite with another is not a fix.
--
-- NO ALERT GENERATION. Every generation rule was practice-contaminated, and
-- re-deriving them needs thresholds (ATTENDANCE_LOW, HOMEWORK_LOW,
-- SUBJECT_AVERAGE_LOW) that live in src/academic/metrics/thresholds.ts.
-- Restating them in SQL would create a second home for each — the exact defect
-- Chunk 10 exists to remove. The digest now returns FIGURES; the judgement
-- belongs to the metric layer. Alerts are still READ and returned, so a future
-- writer surfaces immediately.
--
-- This costs nothing today: parent_academic_alerts holds 0 rows, because
-- nothing has ever called this function. useParentWeeklyDigest has no
-- importers and no scheduler exists, so NO PARENT HAS EVER RECEIVED A DIGEST
-- OR AN ALERT. There is no behaviour to regress.
--
-- ── THE WINDOW IS STATED, NOT ASSUMED ─────────────────────────────────────
--
-- Every figure is scoped to the last 7 days and the window is returned in the
-- payload. The old function used `CURRENT_DATE - 7` for alert de-duplication
-- while the snapshot it forwarded covered 14 days and "since forever"
-- depending on the field, so "this week" meant three different periods in one
-- message.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_parent_weekly_digest()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _parent  uuid := auth.uid();
  _from    date := CURRENT_DATE - 7;
  _to      date := CURRENT_DATE;
  _result  jsonb := '[]'::jsonb;
  _child   record;
  _att     jsonb;
  _hw      jsonb;
  _marks   jsonb;
BEGIN
  IF _parent IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.has_role(_parent, 'parent') AND NOT public.has_role(_parent, 'admin') THEN
    RAISE EXCEPTION 'Parent only';
  END IF;

  FOR _child IN
    SELECT s.*
      FROM public.students s
     WHERE s.deleted_at IS NULL
       AND (
         s.parent_user_id = _parent
         OR EXISTS (
           SELECT 1 FROM public.parents p
             JOIN public.parent_students ps ON ps.parent_id = p.id
            WHERE p.user_id = _parent AND ps.student_id = s.id
         )
       )
  LOOP
    -- ── ATTENDANCE ────────────────────────────────────────────────────────
    -- attendance carries no date of its own; the day lives on the submission.
    SELECT jsonb_build_object(
             'present',  count(*) FILTER (WHERE a.status = 'present'),
             'absent',   count(*) FILTER (WHERE a.status = 'absent'),
             'late',     count(*) FILTER (WHERE a.status = 'late'),
             'leave',    count(*) FILTER (WHERE a.status = 'leave'),
             'half_day', count(*) FILTER (WHERE a.status = 'half_day'),
             'marked',   count(*),
             -- NULL, not 0, when nothing was marked. A child with no attendance
             -- record this week has an UNKNOWN rate, not a rate of zero.
             'pct',      CASE WHEN count(*) = 0 THEN NULL
                              ELSE round(100.0 * count(*) FILTER (WHERE a.status IN ('present','late','half_day'))
                                         / count(*), 1) END
           )
      INTO _att
      FROM public.attendance a
      JOIN public.attendance_submissions sub ON sub.id = a.submission_id
     WHERE a.student_id = _child.id
       AND sub.date BETWEEN _from AND _to;

    -- ── HOMEWORK ──────────────────────────────────────────────────────────
    -- §10.12: completion is measured AT THE DUE DATE, so the window is on
    -- due_date. Published, undeleted homework for the child's class only.
    SELECT jsonb_build_object(
             'due',       count(*),
             'submitted', count(*) FILTER (WHERE hs.submitted_at IS NOT NULL),
             'pct',       CASE WHEN count(*) = 0 THEN NULL
                               ELSE round(100.0 * count(*) FILTER (WHERE hs.submitted_at IS NOT NULL)
                                          / count(*), 1) END
           )
      INTO _hw
      FROM public.homework h
      LEFT JOIN public.homework_submissions hs
             ON hs.homework_id = h.id AND hs.student_id = _child.id
     WHERE h.class_id = _child.class_id
       AND h.deleted_at IS NULL
       AND h.published_at IS NOT NULL
       AND h.due_date BETWEEN _from AND _to;

    -- ── MARKS ─────────────────────────────────────────────────────────────
    -- Only results the school has PUBLISHED, and only in this window. An
    -- unpublished mark is not the parent's to see yet (§10.13).
    SELECT jsonb_build_object(
             'published', count(*),
             'subjects',  COALESCE(jsonb_agg(jsonb_build_object(
                            'exam',    e.name,
                            'subject', e.subject,
                            'scored',  m.marks_obtained,
                            'out_of',  e.max_marks,
                            'pct',     CASE WHEN e.max_marks IS NULL OR e.max_marks = 0 THEN NULL
                                            ELSE round(100.0 * m.marks_obtained / e.max_marks, 1) END
                          ) ORDER BY e.results_published_at DESC), '[]'::jsonb)
           )
      INTO _marks
      FROM public.marks m
      JOIN public.exams e ON e.id = m.exam_id
     WHERE m.student_id = _child.id
       AND e.results_published_at IS NOT NULL
       AND e.results_published_at::date BETWEEN _from AND _to;

    _result := _result || jsonb_build_array(jsonb_build_object(
      'student_id', _child.id,
      'name',       _child.full_name,
      'class',      (SELECT COALESCE(display_name, name || '-' || section)
                       FROM public.classes WHERE id = _child.class_id),
      'attendance', COALESCE(_att,   jsonb_build_object('marked', 0, 'pct', NULL)),
      'homework',   COALESCE(_hw,    jsonb_build_object('due', 0, 'pct', NULL)),
      'marks',      COALESCE(_marks, jsonb_build_object('published', 0, 'subjects', '[]'::jsonb)),
      -- Read, never written here. See the header.
      'alerts', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'id', a.id, 'kind', a.kind, 'title', a.title, 'body', a.body,
                 'read', a.read, 'created_at', a.created_at
               ) ORDER BY a.created_at DESC), '[]'::jsonb)
          FROM public.parent_academic_alerts a
         WHERE a.parent_user_id = _parent
           AND a.student_id = _child.id
           AND a.created_at >= now() - interval '7 days'
      )
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'window',       jsonb_build_object('starts_on', _from, 'ends_on', _to),
    'children',     _result,
    'generated_at', now()
  );
END;
$function$;

-- ── Assert the outcome, not the statements ────────────────────────────────
DO $verify$
DECLARE _d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _d
    FROM pg_proc
   WHERE proname = 'rpc_parent_weekly_digest' AND pronamespace = 'public'::regnamespace;

  -- Every practice surface the measurement found, named individually so a
  -- partial revert cannot pass.
  IF _d ILIKE '%question_attempts%'      THEN RAISE EXCEPTION 'digest still reads question_attempts'; END IF;
  IF _d ILIKE '%practice_accuracy%'      THEN RAISE EXCEPTION 'digest still returns practice_accuracy'; END IF;
  IF _d ILIKE '%active_days%'            THEN RAISE EXCEPTION 'digest still returns active_days'; END IF;
  IF _d ILIKE '%activity_heatmap%'       THEN RAISE EXCEPTION 'digest still returns activity_heatmap'; END IF;
  IF _d ILIKE '%exam_readiness%'         THEN RAISE EXCEPTION 'digest still returns exam_readiness'; END IF;
  IF _d ILIKE '%battle%'                 THEN RAISE EXCEPTION 'digest still reads a battle figure'; END IF;
  IF _d ILIKE '%academic_snapshot_internal%' THEN
    RAISE EXCEPTION 'digest still forwards the student snapshot wholesale';
  END IF;

  -- It must no longer WRITE alerts, which is where the practice-derived
  -- judgements lived.
  IF _d ~* 'insert into[[:space:]]+(public\.)?parent_academic_alerts' THEN
    RAISE EXCEPTION 'digest still generates alerts';
  END IF;

  -- And it must actually carry the three things §10.15 names.
  IF _d NOT ILIKE '%attendance_submissions%' THEN RAISE EXCEPTION 'digest has no attendance figure'; END IF;
  IF _d NOT ILIKE '%homework_submissions%'   THEN RAISE EXCEPTION 'digest has no homework figure'; END IF;
  IF _d NOT ILIKE '%results_published_at%'   THEN RAISE EXCEPTION 'digest has no published-marks figure'; END IF;

  -- The parent gate must survive the rewrite.
  IF _d NOT ILIKE '%Parent only%' THEN
    RAISE EXCEPTION 'the parent-only gate was lost';
  END IF;
END
$verify$;

COMMIT;
