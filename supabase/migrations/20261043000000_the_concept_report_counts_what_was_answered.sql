-- ═══════════════════════════════════════════════════════════════════════════
-- THE CONCEPT REPORT COUNTS WHAT WAS ANSWERED
--
-- The practice result screen shows a session's figures from the finished row:
-- accuracy over ANSWERED questions (a skip is not a wrong answer,
-- 20261021000000) and the time its questions took (20261030000000). Inside
-- that same screen, the concept recovery report computed its own — over every
-- attempt, and over the wall clock from opening the session to finishing it.
--
-- ── MEASURED 2026-09-19, AS THE STUDENT ─────────────────────────────────────
--
-- Across his 40 most recent finished sessions, the two disagreed on 24:
--
--     session   q=20 c=0 w=0 s=20   screen: —     report: 0%    0/20
--     session   q=2  c=1 w=0 s=1    screen: 100%  report: 50%   1/2
--
-- and 23 sessions in which nothing was answered wrongly still listed a weak
-- concept at 0% — the chapter flagged weak for questions the student only
-- skipped, which is the defect 20261021000000 removed from the practice
-- engine and left standing here.
--
-- ── WHAT THIS CHANGES ───────────────────────────────────────────────────────
--
-- Only the practice_session branch, and only where it disagreed:
--
--   * the accuracy, the correct count and the answered count are the finished
--     row's own, which is the one home for them — not recounted from the
--     attempt rows, and not re-rounded (a first draft reported 38.5 for a row
--     holding 38.46, and this migration's proof refused it);
--   * the session's own total_time_ms, not finished_at - created_at;
--   * a weak concept is judged on the questions ANSWERED for it, so a topic
--     that was only skipped is not weak at 0%.
--
-- The test_attempt and battle_participant branches are untouched. One line
-- outside the branches changes for every source: accuracy_pct is NULL when
-- nothing was answered, where it was 0 — the same "absent, not zero" the
-- screen already applies, and the reason the client type now admits null.
--
-- Rollback: rollback/20261043000000_the_concept_report_counts_what_was_answered.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Snapshot, so the rollback restores the definition exactly ───────────

CREATE TABLE public.routines_pre_20261043000000 (
  object text PRIMARY KEY,
  definition text NOT NULL,
  applied text
);
ALTER TABLE public.routines_pre_20261043000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261043000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261043000000 IS
  'Rollback source for 20261043000000: _build_concept_recovery_report exactly as it was before it, and as it left it. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';

INSERT INTO public.routines_pre_20261043000000 (object, definition)
VALUES ('public._build_concept_recovery_report(text,uuid,uuid)', 'function-placeholder');

UPDATE public.routines_pre_20261043000000
   SET definition = pg_get_functiondef(object::regprocedure);

CREATE FUNCTION pg_temp.occurrences(_haystack text, _needle text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$ SELECT (length(_haystack) - length(replace(_haystack, _needle, ''))) / length(_needle) $$;

CREATE FUNCTION pg_temp.report_edits(_def text)
RETURNS TABLE (n int, before text, after text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  _nl text := CASE WHEN position(E'\r\n' IN _def) > 0 THEN E'\r\n' ELSE E'\n' END;
BEGIN
  -- 0. Somewhere to hold the session's own accuracy.
  n := 0;
  before := concat_ws(_nl,
    $t$  _total int := 0; _correct int := 0; _time_sec int := 0;$t$) || _nl;
  after := concat_ws(_nl,
    $t$  _total int := 0; _correct int := 0; _time_sec int := 0; _accuracy numeric;$t$) || _nl;
  RETURN NEXT;

  -- 1. The session's own figures, from the row that decided them.
  n := 1;
  before := concat_ws(_nl,
    $t$    SELECT ps.correct_count, ps.question_count,$t$,
    $t$           GREATEST(EXTRACT(EPOCH FROM (COALESCE(ps.finished_at, now()) - ps.created_at))::int, 0)$t$,
    $t$      INTO _correct, _total, _time_sec$t$,
    $t$    FROM public.practice_sessions ps WHERE ps.id = _source_id AND ps.user_id = _uid;$t$,
    $t$$t$,
    $t$    SELECT count(*)::int, count(*) FILTER (WHERE qa.is_correct)::int$t$,
    $t$      INTO _total, _correct$t$,
    $t$    FROM public.question_attempts qa$t$,
    $t$    WHERE qa.session_id = _source_id AND qa.user_id = _uid;$t$) || _nl;
  after := concat_ws(_nl,
    $t$    -- correct ÷ ANSWERED, and the time the questions took: the finished$t$,
    $t$    -- row is the one home for both (20261021000000, 20261030000000).$t$,
    $t$    -- This counted every attempt, so a skip read as a wrong answer, and$t$,
    $t$    -- timed the session by the clock — disagreeing with the screen that$t$,
    $t$    -- shows this report (20261043000000).$t$,
    $t$    SELECT ps.correct_count,$t$,
    $t$           ps.correct_count + COALESCE(ps.wrong_count, 0),$t$,
    $t$           CASE WHEN ps.total_time_ms > 0 THEN round(ps.total_time_ms / 1000.0)::int END,$t$,
    $t$           ps.accuracy$t$,
    $t$      INTO _correct, _total, _time_sec, _accuracy$t$,
    $t$    FROM public.practice_sessions ps WHERE ps.id = _source_id AND ps.user_id = _uid;$t$) || _nl;
  RETURN NEXT;

  -- 2. A weak concept is judged on what was answered for it.
  n := 2;
  before := concat_ws(_nl,
    $t$        count(*)::int AS attempts,$t$,
    $t$        count(*) FILTER (WHERE qa.is_correct)::int AS correct$t$,
    $t$      FROM public.question_attempts qa$t$,
    $t$      JOIN public.practice_sessions ps ON ps.id = qa.session_id$t$) || _nl;
  after := concat_ws(_nl,
    $t$        count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS attempts,$t$,
    $t$        count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct$t$,
    $t$      FROM public.question_attempts qa$t$,
    $t$      JOIN public.practice_sessions ps ON ps.id = qa.session_id$t$) || _nl;
  RETURN NEXT;

  -- 3. A practice session's accuracy is the one its row holds — not
  --    recomputed, which rounded 38.46 to 38.5 beside a screen showing 38 —
  --    and no accuracy is absent, not zero, for every source.
  n := 3;
  before := concat_ws(_nl,
    $t$    'accuracy_pct', CASE WHEN _total > 0 THEN round(100.0 * _correct / _total, 1) ELSE 0 END,$t$) || _nl;
  after := concat_ws(_nl,
    $t$    'accuracy_pct', CASE WHEN _source_type = 'practice_session' THEN _accuracy$t$,
    $t$                         WHEN _total > 0 THEN round(100.0 * _correct / _total, 1) END,$t$) || _nl;
  RETURN NEXT;

  n := 4;
  before := concat_ws(_nl,
    $t$    'time_minutes', round(COALESCE(_time_sec, 0) / 60.0, 1),$t$) || _nl;
  after := concat_ws(_nl,
    $t$    'time_minutes', CASE WHEN COALESCE(_time_sec, 0) > 0 THEN round(_time_sec / 60.0, 1) END,$t$) || _nl;
  RETURN NEXT;
END
$fn$;

-- ── 1. The edit ────────────────────────────────────────────────────────────

DO $edit$
DECLARE
  _def text := pg_get_functiondef('public._build_concept_recovery_report(text,uuid,uuid)'::regprocedure);
  _e record;
BEGIN
  FOR _e IN SELECT * FROM pg_temp.report_edits(_def) ORDER BY n LOOP
    IF pg_temp.occurrences(_def, _e.before) <> 1 THEN
      RAISE EXCEPTION 'ABORT: edit % found its anchor % time(s), expected once. Re-read _build_concept_recovery_report before editing it.',
        _e.n, pg_temp.occurrences(_def, _e.before);
    END IF;
  END LOOP;
  FOR _e IN SELECT * FROM pg_temp.report_edits(_def) ORDER BY n LOOP
    _def := replace(_def, _e.before, _e.after);
  END LOOP;
  EXECUTE _def;
END
$edit$;

UPDATE public.routines_pre_20261043000000
   SET applied = pg_get_functiondef(object::regprocedure);

-- ── 2. Proof ───────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  _was text := (SELECT definition FROM public.routines_pre_20261043000000);
  _now text := pg_get_functiondef('public._build_concept_recovery_report(text,uuid,uuid)'::regprocedure);
  _src text := (SELECT prosrc FROM pg_proc WHERE oid = 'public._build_concept_recovery_report(text,uuid,uuid)'::regprocedure);
  _expected text;
  _e record;
  _r jsonb;
  _s record;
  _checked int := 0; _with_accuracy int := 0; _with_weak int := 0; _with_time int := 0;
  _disagreed int := 0; _skip_weak int := 0;
BEGIN
  -- 0. The old definition with exactly these five edits, and nothing else.
  _expected := _was;
  FOR _e IN SELECT * FROM pg_temp.report_edits(_was) ORDER BY n LOOP
    _expected := replace(_expected, _e.before, _e.after);
    IF pg_temp.occurrences(_now, _e.after) <> 1 THEN
      RAISE EXCEPTION 'ROLLED BACK: edit % is not in the live definition', _e.n;
    END IF;
    IF position(_e.before IN _now) > 0 THEN
      RAISE EXCEPTION 'ROLLED BACK: edit % left the old text behind', _e.n;
    END IF;
  END LOOP;
  IF _now IS DISTINCT FROM _expected THEN
    RAISE EXCEPTION 'ROLLED BACK: the report changed by more than its five edits';
  END IF;
  -- The other two sources are untouched: their branches still count every
  -- attempt they have, which is right for a test and a battle.
  IF position($t$FROM public.test_attempts att WHERE att.id = _source_id AND att.user_id = _uid;$t$ IN _src) = 0
     OR position($t$FROM public.battle_participants bp WHERE bp.id = _source_id AND bp.user_id = _uid;$t$ IN _src) = 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: the test or battle branch was changed';
  END IF;
  IF position(E'\r' IN _src) > 0
     AND pg_temp.occurrences(_src, E'\r\n') <> pg_temp.occurrences(_src, E'\n') THEN
    RAISE EXCEPTION 'ROLLED BACK: the line endings were mixed by the edit';
  END IF;

  -- 1. Against every finished practice session in this database: the report
  --    now says what the session's own row says, and flags no weak concept
  --    for a session in which nothing was answered wrongly.
  FOR _s IN
    SELECT ps.id, ps.user_id, ps.accuracy, ps.correct_count, ps.wrong_count,
           ps.skipped_count, ps.total_time_ms
      FROM public.practice_sessions ps
     WHERE ps.finished_at IS NOT NULL
     ORDER BY ps.finished_at DESC
     LIMIT 300
  LOOP
    _r := public._build_concept_recovery_report('practice_session', _s.id, _s.user_id);
    _checked := _checked + 1;

    -- Exactly the row's accuracy: equal, or both absent. (A first draft
    -- compared rounded figures and this very proof caught the difference:
    -- a session of 5/13 held 38.46 while the report said 38.5.)
    IF (_r->>'accuracy_pct')::numeric IS DISTINCT FROM _s.accuracy::numeric THEN
      _disagreed := _disagreed + 1;
    END IF;
    IF (_r->>'accuracy_pct') IS NOT NULL THEN
      _with_accuracy := _with_accuracy + 1;
    END IF;

    IF (_r->>'correct_count')::int <> COALESCE(_s.correct_count, 0)
       OR (_r->>'total_count')::int <> COALESCE(_s.correct_count, 0) + COALESCE(_s.wrong_count, 0) THEN
      _disagreed := _disagreed + 1;
    END IF;

    -- The time its questions took, to the second — or absent, when none was
    -- timed. It was the wall clock, which a session left open inflates.
    IF _s.total_time_ms > 0 THEN
      IF (_r->>'time_sec') IS NULL
         OR (_r->>'time_sec')::int <> round(_s.total_time_ms / 1000.0)::int THEN
        _disagreed := _disagreed + 1;
      END IF;
      _with_time := _with_time + 1;
    ELSIF (_r->>'time_sec') IS NOT NULL OR (_r->>'time_minutes') IS NOT NULL THEN
      _disagreed := _disagreed + 1;
    END IF;

    IF COALESCE(_s.wrong_count, 0) = 0 AND jsonb_array_length(_r->'weak_concepts') > 0 THEN
      _skip_weak := _skip_weak + 1;
    END IF;
    IF jsonb_array_length(_r->'weak_concepts') > 0 THEN
      _with_weak := _with_weak + 1;
    END IF;
  END LOOP;

  IF _checked = 0 THEN
    RAISE EXCEPTION 'ROLLED BACK (control): there are no finished practice sessions, so nothing was proved';
  END IF;
  IF _disagreed > 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % of % session report(s) still disagree with their own row', _disagreed, _checked;
  END IF;
  IF _skip_weak > 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % session(s) with no wrong answer still list a weak concept', _skip_weak;
  END IF;
  -- Controls: the checks above would pass on a report that answered nothing.
  IF _with_accuracy = 0 THEN
    RAISE EXCEPTION 'ROLLED BACK (control): no session reported an accuracy at all, so the agreement check proved nothing';
  END IF;
  IF _with_weak = 0 THEN
    RAISE EXCEPTION 'ROLLED BACK (control): no session reported a weak concept at all, so the skip check proved nothing';
  END IF;
  IF _with_time = 0 THEN
    RAISE EXCEPTION 'ROLLED BACK (control): no session carried a timing, so the duration check proved nothing';
  END IF;

  RAISE NOTICE 'verify OK: % finished session(s) checked — % report an accuracy and % a duration, all matching the session row; % report a weak concept and none of those sessions was merely skipped',
    _checked, _with_accuracy, _with_time, _with_weak;
END
$verify$;

COMMIT;
