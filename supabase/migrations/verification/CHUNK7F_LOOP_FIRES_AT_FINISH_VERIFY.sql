-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY: finishing a practice session books the revision AND prepares the
--         recovery — for a student who did not open any tab
-- ════════════════════════════════════════════════════════════════════════════
--
-- Run it:
--   psql "$DB" -f supabase/migrations/verification/CHUNK7F_LOOP_FIRES_AT_FINISH_VERIFY.sql
--   (or POST the file to the Management API /database/query endpoint)
--
-- THE THING BEING PROVED
--
-- Before this work the whole loop had fired ZERO times in production, across
-- 42 students, because of two thresholds nobody could reach:
--
--   RECOVERY_TRIGGER_COUNT = 5   one student had ever reached it
--   REVISION_ENGAGEMENT_MIN = 10 no chapter_tally row had ever reached it
--                                (11 rows, mean 2.3 attempted, max 5)
--
-- So "does the loop fire at all" is the assertion, and it is asserted against
-- CONTENT — a dated row, a stored plan naming specific question ids — never
-- against "the function returned without error", which the old code also did.
--
-- Item 5 is the POSITIVE CONTROL: it re-applies the old thresholds to the same
-- fixture and requires that they produce NOTHING. If the old settings also
-- pass, the first four items are measuring something other than the change.
--
-- WRITES ARE ROLLED BACK. The probe builds a practice session, its tally and
-- its mistakes, because waiting for a real student to produce this shape is
-- not verification. The inner block is an implicit savepoint: the report is
-- accumulated in a plpgsql variable, which a rollback cannot touch.
-- ════════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  _report   text := '';
  _fail     text := '';
  _pass     int := 0;
  _uid      uuid;
  _sid      uuid;
  _school   uuid;
  _chapter  uuid;
  _psid     uuid;
  _qs       uuid[];
  _res      jsonb;
  _cs       public.chapter_state%ROWTYPE;
  _rs       public.recovery_sessions%ROWTYPE;
  _days     numeric;
  _t0       int;
  _i        int;
  _old_trig int;
  _old_eng  int;
  _n_state  int;
  _n_rec    int;
BEGIN
  BEGIN
    ----------------------------------------------------------------------
    -- Fixture: a real student, a real chapter of theirs with spare bank
    -- questions, and a practice session that worked in it.
    ----------------------------------------------------------------------
    SELECT st.user_id, st.id, st.school_id INTO _uid, _sid, _school
      FROM public.students st
     WHERE st.school_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.practice_sessions ps WHERE ps.user_id = st.user_id)
     LIMIT 1;

    IF _uid IS NULL THEN
      RAISE EXCEPTION 'NO FIXTURE: no student with a school and any practice history. NOT a pass.';
    END IF;

    SELECT ch.id INTO _chapter
      FROM public.chapters ch
      JOIN public.section_subjects ss ON ss.curriculum_subject_id = ch.curriculum_subject_id
      JOIN public.students st        ON st.class_id = ss.section_id
     WHERE st.user_id = _uid
       AND (SELECT count(*) FROM public.question_bank qb
             WHERE qb.chapter_id = ch.id AND qb.is_active AND qb.is_approved) >= 8
     LIMIT 1;

    IF _chapter IS NULL THEN
      RAISE EXCEPTION 'NO FIXTURE: this student''s curriculum has no chapter with 8 bank questions. NOT a pass.';
    END IF;

    SELECT array_agg(id) INTO _qs FROM (
      SELECT qb.id FROM public.question_bank qb
       WHERE qb.chapter_id = _chapter AND qb.is_active AND qb.is_approved
         AND qb.source_question_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                          WHERE sm.user_id = _uid AND sm.question_id = qb.id)
       ORDER BY qb.created_at LIMIT 8) t;

    IF COALESCE(array_length(_qs, 1), 0) < 5 THEN
      RAISE EXCEPTION 'NO FIXTURE: only % spare question(s) in that chapter. NOT a pass.',
        COALESCE(array_length(_qs, 1), 0);
    END IF;

    -- Clear the decks for this chapter so the assertions below are about what
    -- THIS probe produced. Rolled back with everything else.
    DELETE FROM public.recovery_sessions WHERE user_id = _uid AND chapter_id = _chapter;
    DELETE FROM public.chapter_state     WHERE user_id = _uid AND chapter_id = _chapter;
    DELETE FROM public.student_mistakes  WHERE user_id = _uid AND chapter_id = _chapter;

    INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject)
    VALUES (_uid, _sid, _school, 'loop probe') RETURNING id INTO _psid;

    -- Four questions worked in this chapter — above REVISION_ENGAGEMENT_MIN (3)
    -- and far below the old 10, which is what makes item 5 meaningful.
    INSERT INTO public.chapter_tally (user_id, student_id, school_id, chapter_id, session_id, attempted, correct)
    VALUES (_uid, _sid, _school, _chapter, _psid, 4, 2);

    -- Two of them wrong: above RECOVERY_TRIGGER_COUNT (1), below the old 5.
    FOR _i IN 1 .. 2 LOOP
      INSERT INTO public.student_mistakes
        (user_id, student_id, school_id, chapter_id, question_id, source, status,
         question_text, times_wrong, last_wrong_at)
      VALUES (_uid, _sid, _school, _chapter, _qs[_i], 'practice', 'open',
              'loop probe — rolled back', 1, now());
    END LOOP;

    ----------------------------------------------------------------------
    -- Run the step the finish path runs. (rpc_finish_practice_session calls
    -- this function; that wiring is asserted separately by CHUNK7E.)
    ----------------------------------------------------------------------
    _res := public._apply_chapter_state(_psid);

    SELECT * INTO _cs FROM public.chapter_state
     WHERE user_id = _uid AND chapter_id = _chapter;

    ----------------------------------------------------------------------
    -- 1. A revision is booked, one week out, off the practice alone.
    ----------------------------------------------------------------------
    IF _cs.user_id IS NULL THEN
      _fail := _fail || '(FAIL) 1: no chapter_state row was written at all. ';
    ELSIF _cs.next_revision_at IS NULL THEN
      _fail := _fail || '(FAIL) 1: chapter_state exists but carries no revision date. ';
    ELSE
      _days := round(EXTRACT(EPOCH FROM (_cs.next_revision_at - now())) / 86400.0);
      IF _days <> public._recovery_const('REVISION_INTERVAL_1')::numeric THEN
        _fail := _fail || format('(FAIL) 1: the check is %s days out, expected %s. ',
          _days, public._recovery_const('REVISION_INTERVAL_1'));
      ELSE
        _pass := _pass + 1;
        _report := _report || format(
          '(PASS) 1: four questions in the chapter booked a revision %s days out — no recovery needed first, no 10-question gate.',
          _days) || E'\n';
      END IF;
    END IF;

    ----------------------------------------------------------------------
    -- 2. The chapter is NOT labelled as having been started.
    ----------------------------------------------------------------------
    IF _cs.state = 'in_recovery' THEN
      _fail := _fail || '(FAIL) 2: preparing a session marked the chapter in_recovery — the student has begun nothing. ';
    ELSE
      _pass := _pass + 1;
      _report := _report || format('(PASS) 2: chapter state is ''%s'', not ''in_recovery'' — preparing is not starting.', _cs.state) || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 3. A recovery session is WAITING, with a stored plan.
    ----------------------------------------------------------------------
    SELECT * INTO _rs FROM public.recovery_sessions
     WHERE user_id = _uid AND chapter_id = _chapter AND completed_at IS NULL
     ORDER BY started_at DESC LIMIT 1;

    IF _rs.id IS NULL THEN
      _fail := _fail || '(FAIL) 3: no recovery session was prepared. ';
    ELSIF _rs.plan IS NULL THEN
      _fail := _fail || '(FAIL) 3: a session was created with no plan — it could never be scored. ';
    ELSIF (_res->>'recovery_sessions_prepared')::int <> 1 THEN
      _fail := _fail || format('(FAIL) 3: the state machine reported %s prepared, expected 1. ',
        _res->>'recovery_sessions_prepared');
    ELSE
      _pass := _pass + 1;
      _report := _report || format(
        '(PASS) 3: a recovery session was waiting the moment the sitting ended — mode %s, %s question(s), before any tab was opened.',
        _rs.plan->>'mode',
        _rs.tier0_total + _rs.tier1_total + _rs.tier2_total + _rs.tier3_total) || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 4. Its tier 0 names BOTH mistakes, by id.
    ----------------------------------------------------------------------
    IF _rs.plan IS NOT NULL THEN
      SELECT count(*)::int INTO _t0
        FROM jsonb_array_elements_text(_rs.plan->'tiers'->'0'->'from_bank') AS e(q)
       WHERE e.q::uuid = ANY (ARRAY[_qs[1], _qs[2]]);

      IF _t0 <> 2 THEN
        _fail := _fail || format('(FAIL) 4: tier 0 names %s of the 2 mistakes made. ', _t0);
      ELSE
        _pass := _pass + 1;
        _report := _report || '(PASS) 4: the waiting plan names BOTH mistakes at tier 0, by question id.' || E'\n';
      END IF;
    END IF;

    ----------------------------------------------------------------------
    -- 5. POSITIVE CONTROL — the OLD thresholds produce nothing at all.
    --
    -- Same fixture, same function, old constants. If this also fires, items
    -- 1-4 are not measuring the change they claim to.
    ----------------------------------------------------------------------
    DELETE FROM public.recovery_sessions WHERE user_id = _uid AND chapter_id = _chapter;
    DELETE FROM public.chapter_state     WHERE user_id = _uid AND chapter_id = _chapter;

    SELECT value::int INTO _old_trig FROM public.recovery_constants WHERE key = 'RECOVERY_TRIGGER_COUNT';
    SELECT value::int INTO _old_eng  FROM public.recovery_constants WHERE key = 'REVISION_ENGAGEMENT_MIN';
    UPDATE public.recovery_constants SET value = 5  WHERE key = 'RECOVERY_TRIGGER_COUNT';
    UPDATE public.recovery_constants SET value = 10 WHERE key = 'REVISION_ENGAGEMENT_MIN';

    PERFORM public._apply_chapter_state(_psid);

    SELECT count(*)::int INTO _n_state FROM public.chapter_state
     WHERE user_id = _uid AND chapter_id = _chapter;
    SELECT count(*)::int INTO _n_rec FROM public.recovery_sessions
     WHERE user_id = _uid AND chapter_id = _chapter;

    UPDATE public.recovery_constants SET value = _old_trig WHERE key = 'RECOVERY_TRIGGER_COUNT';
    UPDATE public.recovery_constants SET value = _old_eng  WHERE key = 'REVISION_ENGAGEMENT_MIN';

    IF _n_state <> 0 OR _n_rec <> 0 THEN
      _fail := _fail || format(
        '(FAIL) 5: POSITIVE CONTROL BROKEN — the old thresholds produced %s chapter_state and %s recovery row(s), so items 1-4 do not measure the change. ',
        _n_state, _n_rec);
    ELSE
      _pass := _pass + 1;
      _report := _report ||
        '(PASS) 5: positive control — with trigger 5 and engagement 10, this identical sitting produces NO revision date and NO recovery session. That is the state production has been in for 42 students.' || E'\n';
    END IF;

    ----------------------------------------------------------------------
    IF _fail <> '' THEN
      _report := _report || format('════ %s of 5 PASSED ════', _pass) || E'\n';
      _report := _report || 'VERIFICATION FAILED: ' || _fail;
    ELSE
      _report := _report || '════ ALL 5 CHECKS PASSED ════' || E'\n';
    END IF;

    RAISE EXCEPTION 'ROLLBACK_AFTER_PROOF';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ROLLBACK_AFTER_PROOF' THEN
        _report := _report || 'probe writes rolled back; the results above stand.';
      ELSE
        RAISE;
      END IF;
  END;

  -- The house contract: end in a deliberate RAISE. It rolls the fixtures
  -- back, it is how run-verification-files.mjs tells a file that ran from
  -- one that has rotted, and it is the only channel that survives the
  -- Management API, which discards NOTICEs.
  RAISE EXCEPTION E'\n%', _report;
END $verify$;
