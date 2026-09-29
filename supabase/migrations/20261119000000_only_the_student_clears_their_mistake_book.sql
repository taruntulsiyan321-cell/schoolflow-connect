-- ===========================================================================
-- ONLY THE STUDENT CLEARS THEIR MISTAKE BOOK
--
-- Owner's ruling (2026-09-28): the mistake book is cleared by the student
-- themselves, only. Recovery is there for their understanding; it does not
-- decide for them.
--
-- rpc_submit_recovery_session cleared every open mistake in the chapter the
-- moment a round came out ready, marked the chapter recovered and started its
-- revision clock. That was added by 20261003000000 (defect "B3"), reading
-- §4.5 "On clearing: those rows -> status = 'cleared'" as if a ready round
-- were a clearing; §4.4 and §4.6 say the opposite ("the student is
-- responsible for clearing their own mistake book", "Entries leave only when
-- the student clears them ... Nothing clears automatically"), and the owner
-- never ruled it. It is removed: a round records its readiness and nothing
-- else, whatever it scored.
--
-- rpc_clear_chapter_after_recovery was the student's door, but only after a
-- round scored NOT ready ("clear anyway"): it refused a ready round, because
-- the ready round had already cleared. It is now the student's clear after
-- any finished round — the latest one, as before, so an old score cannot be
-- replayed after a newer one. The confirm a not-ready round asks for stays
-- the screen's (§4.4). What clearing does (§4.5: mistakes cleared, chapter
-- recovered, revision clock at stage 1, readiness kept) is unchanged, and it
-- now has this one home.
--
-- The Mistake Book's own retry cleared the mistakes answered right in a
-- retry scoring 70%; that was client code (PracticeService.
-- completeMistakeRetry) and is removed in the same change, where the book
-- gains the student's own Clear.
--
-- Mistakes already cleared by the old rule stay cleared: which of them the
-- student would have kept cannot be known now.
--
-- ROLLBACK: rollback/20261119000000_only_the_student_clears_their_mistake_book.rollback.sql
-- ===========================================================================

BEGIN;

CREATE TABLE public.routines_pre_20261119000000 (
  object text PRIMARY KEY,
  definition text NOT NULL
);
ALTER TABLE public.routines_pre_20261119000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261119000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261119000000 IS
  'Rollback source for 20261119000000: the two functions it changes, as they were. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';
INSERT INTO public.routines_pre_20261119000000 (object, definition)
SELECT o, pg_get_functiondef(o::regprocedure)
  FROM unnest(ARRAY[
    'public.rpc_submit_recovery_session(uuid,uuid)',
    'public.rpc_clear_chapter_after_recovery(uuid)']) AS o;

DO $edit$
DECLARE
  _def text;
  _i   int;
  _j   int;
  _n   int;
  _from constant text := E'  _interval := public._revision_interval_days(1);\n';
  _to   constant text := E'  RETURN jsonb_build_object(\n    ''session_id'', _rs.id,';
  _block constant text := $new$  -- The round records what it measured and decides nothing for the student.
  -- The mistake book is theirs to clear — from the book, or from this
  -- round's report (rpc_clear_chapter_after_recovery) — ready or not
  -- (owner's ruling 2026-09-28; §4.4, §4.6).
  UPDATE public.chapter_state SET
    state = 'in_recovery', last_recovery_readiness = _ready, updated_at = now()
  WHERE user_id = _uid AND chapter_id = _rs.chapter_id;

  IF _outcome = 'not_ready' THEN
    -- §4.6: "Below that it fails, and a new session is generated." The
    -- next round is prepared now, and the new questions it needs are asked
    -- for, so it is waiting (or being written) when the student comes back.
    BEGIN
      PERFORM public._ensure_recovery_session(_uid, _rs.student_id, _rs.school_id, _rs.chapter_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'could not prepare the next recovery round for chapter %: %', _rs.chapter_id, SQLERRM;
    END;
  END IF;

$new$;
  _ret_old constant text :=
    E'    ''conceptual_passed'', _conc IS NOT NULL AND _conc >= _c_thr,\n' ||
    E'    ''next_revision_at'', CASE WHEN _outcome = ''ready''\n' ||
    E'                             THEN (now() + (_interval || '' days'')::interval) END);\n';
  _ret_new constant text :=
    E'    ''conceptual_passed'', _conc IS NOT NULL AND _conc >= _c_thr);\n';
  _decl constant text := E'  _interval  int;\n';
  _gate_old constant text :=
    E'  IF _rs.outcome IS DISTINCT FROM ''not_ready'' THEN\n' ||
    E'    RAISE EXCEPTION ''this session was not scored not ready — nothing to clear anyway'';\n' ||
    E'  END IF;\n';
  _gate_new constant text :=
    E'  IF _rs.outcome IS NULL THEN\n' ||
    E'    RAISE EXCEPTION ''this session has no score yet'';\n' ||
    E'  END IF;\n';
  _note_old constant text := E'  -- §4.5, identical to the ''ready'' path in rpc_submit_recovery_session.\n';
  _note_new constant text := E'  -- §4.5. The one place a recovery clears the book: the student chose to.\n';
BEGIN
  -- Scoring: the ready branch and the not-ready branch become one write.
  _def := replace(pg_get_functiondef('public.rpc_submit_recovery_session(uuid,uuid)'::regprocedure), E'\r\n', E'\n');
  _i := position(_from IN _def);
  _j := position(_to IN _def);
  IF _i = 0 OR _j <= _i
     OR position(_from IN substr(_def, _i + 1)) > 0
     OR position(_to IN substr(_def, _j + 1)) > 0 THEN
    RAISE EXCEPTION 'submit: expected one outcome section, between the interval and the RETURN';
  END IF;
  IF substr(_def, _i, _j - _i) NOT LIKE '%status = ''cleared''%' THEN
    RAISE EXCEPTION 'submit: the outcome section does not clear mistakes — this is not the body this migration was written for';
  END IF;
  _def := left(_def, _i - 1) || _block || substr(_def, _j);
  _n := (length(_def) - length(replace(_def, _ret_old, ''))) / length(_ret_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'submit: expected next_revision_at in the RETURN once, found %', _n; END IF;
  _def := replace(_def, _ret_old, _ret_new);
  _n := (length(_def) - length(replace(_def, _decl, ''))) / length(_decl);
  IF _n <> 1 THEN RAISE EXCEPTION 'submit: expected the _interval declaration once, found %', _n; END IF;
  EXECUTE replace(_def, _decl, '');

  -- The student's clear: after any finished round.
  _def := replace(pg_get_functiondef('public.rpc_clear_chapter_after_recovery(uuid)'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _gate_old, ''))) / length(_gate_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'clear: expected the not-ready gate once, found %', _n; END IF;
  _n := (length(_def) - length(replace(_def, _note_old, ''))) / length(_note_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'clear: expected the §4.5 note once, found %', _n; END IF;
  EXECUTE replace(replace(_def, _gate_old, _gate_new), _note_old, _note_new);
END
$edit$;

COMMENT ON FUNCTION public.rpc_clear_chapter_after_recovery(uuid) IS
  'The student''s own clear of a chapter''s mistakes after their latest finished recovery round, ready or not (§4.4, §4.5). Recovery scoring never clears.';

-- ── THE PROOF ────────────────────────────────────────────────────────────
--
-- On a real student's chapter, rolled back:
--   1. A round scored READY leaves every open mistake open and the chapter
--      in recovery, with its readiness recorded. The old body cleared them.
--   2. The student's clear after that ready round clears exactly those
--      mistakes, marks the chapter recovered and starts revision at stage 1.
--   3. CONTROL: a clear on a round that is not the latest is still refused.
DO $proof$
DECLARE
  _uid uuid; _chap uuid; _sid uuid; _school uuid; _ps uuid; _rs uuid; _old uuid;
  _plan jsonb; _open_before int; _open_after_submit int; _open_after_clear int;
  _state_after_submit text; _ready numeric; _outcome text;
  _state_after_clear text; _stage int; _refused boolean := false;
BEGIN
  -- A real chapter whose recovery can be offered now, so a round can be sat.
  SELECT m.user_id, m.chapter_id INTO _uid, _chap
    FROM (SELECT sm.user_id, sm.chapter_id
            FROM public.student_mistakes sm
           WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL
           GROUP BY sm.user_id, sm.chapter_id
          HAVING bool_and(sm.question_id IS NOT NULL)   -- every question answerable here
             AND count(*) <= public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int) m
   WHERE public._recovery_chapter_is_for(m.user_id, m.chapter_id)
     AND public._recovery_plan_startable(public._recovery_session_plan_for(m.user_id, m.chapter_id))
   LIMIT 1;
  IF _uid IS NULL THEN RAISE EXCEPTION 'no offerable recovery to prove this on'; END IF;
  SELECT s.id, s.school_id INTO _sid, _school FROM public.students s WHERE s.user_id = _uid LIMIT 1;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    SELECT count(*)::int INTO _open_before FROM public.student_mistakes
     WHERE user_id = _uid AND chapter_id = _chap AND status = 'open';

    -- A round started the way the app starts one, and every planned bank
    -- question answered right.
    SELECT (r->>'session_id')::uuid, r->'plan' INTO _rs, _plan
      FROM (SELECT public.rpc_start_recovery_session(_chap) AS r) q;
    IF _rs IS NULL THEN RAISE EXCEPTION 'the proof could not start the round'; END IF;
    INSERT INTO public.practice_sessions (user_id, school_id, subject)
    VALUES (_uid, _school, 'proof')
    RETURNING id INTO _ps;
    INSERT INTO public.question_attempts (user_id, school_id, session_id, bank_question_id,
      is_correct, skipped, correct_answer, generated_question)
    SELECT _uid, _school, _ps, x::uuid, true, false, '{}'::jsonb, '{}'::jsonb
      FROM jsonb_each(_plan->'tiers') t, jsonb_array_elements_text(t.value->'from_bank') x;

    SELECT public.rpc_submit_recovery_session(_rs, _ps)->>'outcome' INTO _outcome;
    SELECT count(*)::int INTO _open_after_submit FROM public.student_mistakes
     WHERE user_id = _uid AND chapter_id = _chap AND status = 'open';
    SELECT cs.state, cs.last_recovery_readiness INTO _state_after_submit, _ready
      FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = _chap;

    -- CONTROL: an older round cannot be cleared on once a newer one exists.
    -- round 1, not 0: recovery_sessions.round has carried CHECK (round >= 1)
    -- since 20260829240000, so a round-0 probe row cannot be inserted at all.
    -- What makes this one "not the latest" is its completed_at, which is what
    -- rpc_clear_chapter_after_recovery compares (r.completed_at > _rs.completed_at).
    INSERT INTO public.recovery_sessions (user_id, student_id, school_id, chapter_id, round,
      tier0_total, tier1_total, tier2_total, tier3_total, plan, completed_at, outcome, readiness)
    VALUES (_uid, _sid, _school, _chap, 1, 0, 0, 0, 0, _plan, now() - interval '1 day', 'ready', 1)
    RETURNING id INTO _old;
    BEGIN
      PERFORM public.rpc_clear_chapter_after_recovery(_old);
    EXCEPTION WHEN raise_exception THEN
      _refused := true;
    END;

    PERFORM public.rpc_clear_chapter_after_recovery(_rs);
    SELECT count(*)::int INTO _open_after_clear FROM public.student_mistakes
     WHERE user_id = _uid AND chapter_id = _chap AND status = 'open';
    SELECT cs.state, cs.revision_stage INTO _state_after_clear, _stage
      FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = _chap;

    RAISE EXCEPTION 'proof_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'proof_rollback' THEN RAISE; END IF;
  END;

  IF _outcome IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'the proof round scored %, not ready — check 1 would prove nothing', _outcome;
  END IF;
  IF _open_after_submit <> _open_before THEN
    RAISE EXCEPTION 'a ready round cleared % of % open mistakes by itself', _open_before - _open_after_submit, _open_before;
  END IF;
  IF _state_after_submit IS DISTINCT FROM 'in_recovery' OR _ready IS NULL THEN
    RAISE EXCEPTION 'a ready round left the chapter % with readiness %', _state_after_submit, _ready;
  END IF;
  IF _open_after_clear <> 0 OR _state_after_clear IS DISTINCT FROM 'recovered' OR _stage IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'the student''s clear left % open, chapter %, stage %', _open_after_clear, _state_after_clear, _stage;
  END IF;
  IF NOT _refused THEN
    RAISE EXCEPTION 'CONTROL FAILED: a clear on an older round was accepted';
  END IF;
END
$proof$;

COMMIT;
