-- ════════════════════════════════════════════════════════════════════════════
-- ONE WRONG ANSWER IS NOT A WEAKNESS
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHAT WAS MEASURED, 2026-09-15, on production
--
--   _weak_topics_for_user across all 42 students:
--       rows returned .......................... 244
--       rows a caller would call "weak" ........ 202   (83%)
--       rows at exactly 0% accuracy ............ 200
--
--   question_attempts:
--       total .................................. 4,841
--       with a template_id ..................... 0
--       with a bank_question_id ................ 41
--       skipped ................................ 241
--       correct ................................ 823
--       accuracy counting skips as wrong ....... 17.0%
--       accuracy excluding skips ............... 17.9%
--
-- FOUR DEFECTS, IN THE ORDER THEY MATTER
--
-- 1. A FIXED 60% BAR CALLS 83% OF EVERYTHING WEAK. A student at 17.9% overall
--    gets a "weak chapters" list containing essentially every chapter they
--    have touched, which tells them nothing about where to start — and the
--    mirror failure is a student at 90% whose real 65% gap never clears the
--    bar. Weak has to mean "worse than you usually do", which is a different
--    number for every student and for the same student over time.
--
-- 2. THE THRESHOLD HAD NO HOME. Three live values disagreed: 60 in
--    _rebuild_revision_queue, 60 in rpc_student_academic_snapshot, 65 in
--    rpc_student_improvement_plans. Spec §10: "No component may contain any of
--    these as a literal."
--
-- 3. TWO ATTEMPTS WAS ENOUGH TO BE JUDGED. attempts >= 2 with a 60% bar means
--    one wrong answer out of two is 50% and therefore weak. It does not happen
--    to fire in today's data, which is luck, not safety.
--
-- 4. SKIPPED QUESTIONS COUNTED AS WRONG. 241 attempts. A skip is "I did not
--    answer this", not "I got this wrong", and rpc_record_question_attempt
--    forces is_correct false on a skip — so every skip silently lowered a
--    chapter's accuracy. Worth 0.9 points across the whole cohort today and
--    far more for any individual who skips a lot.
--
-- AND ONE PIECE OF DEAD CODE REMOVED
--
-- The old body derived its topic from question_templates via
-- question_attempts.template_id. ZERO of 4,841 attempts carry a template_id,
-- so that LEFT JOIN has never matched anything and the topic has always
-- collapsed to the session's chapter. The join goes; the behaviour does not
-- change, because the behaviour was already this.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--
-- The unit stays the session's chapter, not the question's. Only 41 of 4,841
-- attempts name a bank question, so there is no per-question dimension to read
-- for 99% of the data. question_bank's own `concept` column would not help
-- either: 11,948 distinct values across 21,681 questions, i.e. a label that is
-- nearly unique per question and cannot group anything.
--
-- The test branch keeps contributing, but no longer as a fabricated 0%. Only a
-- test's WRONG answers survive submission (§10.8 purges the rest), so a test
-- can tell you a chapter was missed; it cannot tell you an accuracy. Counting
-- it as "0 correct out of N" states something nobody measured — a student who
-- scored 19/20 would have their one missed chapter recorded at 0%.
--
-- ROLLBACK: supabase/migrations/rollback/20261013000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The constants ───────────────────────────────────────────────────────

INSERT INTO public.recovery_constants (key, value, spec_ref, rationale) VALUES
  ('WEAK_MIN_ATTEMPTS', 5, '§6.2',
   'Attempts in a chapter before any verdict. The old floor of two made one wrong answer out of two a 50% accuracy and therefore weak. Five is the smallest count where a single unlucky question cannot by itself put a chapter on the list. Below it the row is still returned with is_weak false — "not enough evidence" and "fine" are different statements.'),
  ('WEAK_MARGIN_POINTS', 15, '§6.2',
   'Accuracy points below the student''s OWN baseline that count as weak. Replaces a fixed 60/65, which called 83% of rows weak for a cohort at 17.9% overall and would never fire for a strong student with a real gap. A judgment, and the first of these to revisit: there is no data yet on how widely one student''s chapter accuracies actually spread.'),
  ('WEAK_WINDOW_DAYS', 90, '§6.2',
   'How far back the accuracy behind "weak" is measured, so a chapter can STOP being weak. Without a window it is a lifetime average and a chapter fixed months ago drags its old failures forward for ever. Falls back to all time for a chapter with fewer than WEAK_MIN_ATTEMPTS in the window, so a student returning after a break does not find their analysis blank.')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, spec_ref = EXCLUDED.spec_ref,
      rationale = EXCLUDED.rationale, updated_at = now();


-- ── 2. The definition ──────────────────────────────────────────────────────
-- DROP and recreate rather than REPLACE: the return signature gains three
-- columns, which CREATE OR REPLACE cannot do.

DROP FUNCTION IF EXISTS public._weak_topics_for_user(uuid);

CREATE FUNCTION public._weak_topics_for_user(_uid uuid)
RETURNS TABLE(
  subject           text,
  chapter           text,
  topic             text,
  attempts          integer,
  correct           integer,
  accuracy          numeric,
  -- NEW. The verdict now travels WITH the data, so no caller writes a
  -- threshold of its own and no two callers can disagree about what weak means.
  is_weak           boolean,
  -- NEW. This student's own accuracy, so a screen can say "your average is
  -- 62%, this chapter is 41%" instead of quoting a bar nobody recognises.
  baseline_accuracy numeric,
  -- NEW. When the chapter was last worked on, so "weak" can be read as a
  -- statement about now rather than about an unspecified time.
  last_attempt_at   timestamptz,
  -- NEW. True when the row has too little evidence for any verdict. Distinct
  -- from is_weak = false, which means "measured, and not weak".
  thin              boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH k AS (
    SELECT public._recovery_const('WEAK_MIN_ATTEMPTS')::int   AS min_attempts,
           public._recovery_const('WEAK_MARGIN_POINTS')::numeric AS margin,
           public._recovery_const('WEAK_WINDOW_DAYS')::int    AS window_days
  ),
  -- ── Practice, the only source with a real denominator ──────────────────
  -- SKIPS ARE EXCLUDED, not counted as wrong. rpc_record_question_attempt
  -- forces is_correct false on a skip, so leaving them in silently lowered
  -- every chapter a student skipped in.
  --
  -- The template_id join is gone: zero of 4,841 attempts carry one, so it has
  -- never matched and the topic always collapsed to the session's chapter.
  practice AS (
    SELECT
      ps.subject AS subject,
      ps.chapter AS chapter,
      qa.created_at,
      qa.is_correct
    FROM public.question_attempts qa
    JOIN public.practice_sessions ps ON ps.id = qa.session_id
    WHERE qa.user_id = _uid
      AND NOT COALESCE(qa.skipped, false)
  ),
  battle AS (
    SELECT b.subject, b.chapter, ba.created_at, ba.is_correct
      FROM public.battle_participants bp
      JOIN public.battles b        ON b.id = bp.battle_id
      JOIN public.battle_answers ba ON ba.participant_id = bp.id
     WHERE bp.user_id = _uid AND bp.finished_at IS NOT NULL
  ),
  graded AS (
    SELECT * FROM practice
    UNION ALL SELECT * FROM battle
  ),
  -- Within the window first; all time is the fallback for a thin window.
  windowed AS (
    SELECT COALESCE(subject, 'General') AS subject,
           chapter,
           count(*)::int                                   AS attempts,
           count(*) FILTER (WHERE is_correct)::int          AS correct,
           max(created_at)                                  AS last_attempt_at
      FROM graded, k
     WHERE created_at >= now() - make_interval(days => k.window_days)
     GROUP BY 1, 2
  ),
  lifetime AS (
    SELECT COALESCE(subject, 'General') AS subject,
           chapter,
           count(*)::int                                   AS attempts,
           count(*) FILTER (WHERE is_correct)::int          AS correct,
           max(created_at)                                  AS last_attempt_at
      FROM graded
     GROUP BY 1, 2
  ),
  chosen AS (
    SELECT l.subject, l.chapter,
           CASE WHEN COALESCE(w.attempts, 0) >= (SELECT min_attempts FROM k)
                THEN w.attempts ELSE l.attempts END AS attempts,
           CASE WHEN COALESCE(w.attempts, 0) >= (SELECT min_attempts FROM k)
                THEN w.correct  ELSE l.correct  END AS correct,
           l.last_attempt_at
      FROM lifetime l
      LEFT JOIN windowed w
             ON w.subject = l.subject
            AND COALESCE(w.chapter, '') = COALESCE(l.chapter, '')
  ),
  -- Chapters a TEST flagged and practice has never covered.
  --
  -- A test leaves only its wrong answers behind (§10.8), so it can say a
  -- chapter was missed but cannot say how often it was right. Such a row is
  -- surfaced as THIN — zero attempts, no accuracy, no verdict — rather than as
  -- a fabricated 0%, which is what the old body emitted and what put 200 of
  -- its 202 "weak" rows on the list.
  test_only AS (
    SELECT COALESCE(sm.subject, 'General') AS subject,
           sm.chapter,
           0::int          AS attempts,
           0::int          AS correct,
           max(sm.last_wrong_at) AS last_attempt_at
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.source = 'test'
     GROUP BY 1, 2
    EXCEPT ALL
    SELECT c.subject, c.chapter, 0, 0, c.last_attempt_at FROM chosen c
  ),
  combined AS (
    SELECT * FROM chosen
    UNION ALL
    SELECT t.subject, t.chapter, t.attempts, t.correct, t.last_attempt_at
      FROM test_only t
     WHERE NOT EXISTS (
       SELECT 1 FROM chosen c
        WHERE c.subject = t.subject
          AND COALESCE(c.chapter, '') = COALESCE(t.chapter, ''))
  ),
  -- THE BASELINE: this student's own accuracy over the same evidence, which is
  -- what makes "weak" mean "worse than you usually do" rather than "under a
  -- number somebody picked".
  baseline AS (
    SELECT CASE WHEN sum(attempts) > 0
                THEN round(100.0 * sum(correct) / sum(attempts), 1)
                ELSE NULL END AS acc
      FROM combined
  )
  SELECT
    c.subject,
    c.chapter,
    -- Topic IS the chapter, stated rather than implied. The old body computed
    -- COALESCE(template.concept, template.chapter, session.chapter) and the
    -- first two were always NULL, so this is what it has always returned —
    -- now without a join that suggests otherwise. Kept as a column because
    -- revision_queue rows join on it.
    c.chapter AS topic,
    c.attempts,
    c.correct,
    CASE WHEN c.attempts > 0
         THEN round(100.0 * c.correct / c.attempts, 1) ELSE 0 END AS accuracy,
    (
      c.attempts >= (SELECT min_attempts FROM k)
      AND b.acc IS NOT NULL
      AND round(100.0 * c.correct / c.attempts, 1) <= b.acc - (SELECT margin FROM k)
    ) AS is_weak,
    b.acc AS baseline_accuracy,
    c.last_attempt_at,
    (c.attempts < (SELECT min_attempts FROM k)) AS thin
  FROM combined c
  CROSS JOIN baseline b
  ORDER BY
    (c.attempts >= (SELECT min_attempts FROM k)) DESC,
    CASE WHEN c.attempts > 0 THEN 100.0 * c.correct / c.attempts ELSE 999 END ASC;
$fn$;

COMMENT ON FUNCTION public._weak_topics_for_user(uuid) IS
  'One chapter per row for a student, with is_weak decided HERE and not at the call sites. Weak means materially below that student''s own baseline (WEAK_MARGIN_POINTS) with enough evidence (WEAK_MIN_ATTEMPTS), measured over WEAK_WINDOW_DAYS so a chapter can stop being weak. Skips are excluded from the denominator; a test-only chapter is reported thin rather than as a fabricated 0%.';


-- ── 3. The call sites stop deciding for themselves ─────────────────────────
-- Rewritten by substitution against the LIVE bodies, because these functions
-- have been rewritten in place across many migrations and a CREATE OR REPLACE
-- typed from a file would silently revert whichever change came last.
--
-- Line endings normalised first: live bodies are stored with CRLF, an anchor
-- written with LF matches nothing, and a substitution that matches nothing
-- fails OPEN unless a guard catches it.

DO $rewrite$
DECLARE
  _fn   text;
  _def  text;
  _new  text;
  _pairs text[][] := ARRAY[
    ['_rebuild_revision_queue',        'w.accuracy < 60',     'w.is_weak'],
    ['rpc_student_academic_snapshot',  'w.accuracy < 60',     'w.is_weak'],
    ['rpc_student_improvement_plans',  'w.accuracy < 65',     'w.is_weak']
  ];
  _i int;
BEGIN
  FOR _i IN 1 .. array_length(_pairs, 1) LOOP
    _fn := _pairs[_i][1];

    SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = _fn;

    IF _def IS NULL THEN
      RAISE EXCEPTION 'function public.% not found', _fn;
    END IF;
    IF position(E'\r' IN _def) > 0 THEN
      RAISE EXCEPTION 'a carriage return survived normalisation in %', _fn;
    END IF;

    -- _rebuild_revision_queue writes `accuracy < 60` without the w. prefix in
    -- its first query, so try the bare form too rather than failing open.
    _new := replace(_def, _pairs[_i][2], _pairs[_i][3]);
    IF _new = _def THEN
      _new := replace(_def,
                      replace(_pairs[_i][2], 'w.', ''),
                      replace(_pairs[_i][3], 'w.', ''));
    END IF;

    IF _new = _def THEN
      RAISE EXCEPTION
        'the threshold anchor % matched nothing in % — the substitution would have failed open',
        _pairs[_i][2], _fn;
    END IF;

    EXECUTE _new;
    RAISE NOTICE 'rewrote %', _fn;
  END LOOP;
END $rewrite$;

-- rpc_student_improvement_plans also applies 65 to concept_mastery, a second
-- table with its own scale. That is a separate split-brain and is NOT touched
-- here: concept_mastery.mastery_score is not the same measurement as attempt
-- accuracy, and silently pointing it at the same constant would be the
-- "changing a shared definition when the call sites genuinely disagree" half
-- of RULE 0. It is recorded so the next reader does not mistake it for missed.

DO $check$
DECLARE _n int;
BEGIN
  -- No live function may still carry its own weak threshold.
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) LIKE '%_weak_topics_for_user%'
     AND (pg_get_functiondef(p.oid) LIKE '%accuracy < 60%'
       OR pg_get_functiondef(p.oid) LIKE '%accuracy < 65%');
  IF _n <> 0 THEN
    RAISE EXCEPTION '% caller(s) still hold their own weak threshold', _n;
  END IF;

  -- And the new definition must actually answer.
  PERFORM 1 FROM public._weak_topics_for_user(
    (SELECT user_id FROM public.students LIMIT 1)) LIMIT 1;
END $check$;

COMMIT;
