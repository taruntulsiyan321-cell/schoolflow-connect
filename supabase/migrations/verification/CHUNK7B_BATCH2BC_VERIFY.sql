-- ---------------------------------------------------------------------
-- CHUNK 7B VERIFICATION — batches 2b and 2c
--
-- Both batches shipped without a verification file. This is that file, written
-- after the fact, and it deliberately checks BEHAVIOUR rather than the text of
-- the migrations that produced it — a check that greps a function body proves
-- a substitution ran, not that the rule holds.
--
-- 2b converged student_mistakes.mastered (boolean) onto status (open/cleared)
-- and rewrote ten SECURITY DEFINER functions through pg_get_functiondef().
-- The risk that carries is a SILENT INVERSION: `NOT m.mastered` becoming
-- `(NOT m.status) = 'open'` would not error, it would just turn the mistake
-- book inside out. Item 1 therefore round-trips a real mistake through the
-- open -> cleared -> open cycle and requires the book to follow it.
--
-- 2c made per-question correctness transient for battles: correct rows are
-- deleted when a participant finishes, so a battle keeps the score, the XP and
-- the mistakes but not the record of what was answered RIGHT.
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _demo uuid := '00000000-0000-4000-8000-000000000001';
  _uid_student uuid; _sid_student uuid;

  _mid uuid;                                   -- 1 a real mistake row
  _open_before bigint; _open_cleared bigint; _open_reopened bigint;
  _fn_mastered int; _fn_json int;              -- 2
  _pid uuid; _correct_after bigint; _wrong_after bigint;  -- 3
  _strong_aggregate int;                       -- 4
  _wide_policies int;                          -- 5
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text;
BEGIN
  SELECT id INTO _uid_student FROM auth.users WHERE email='arjun.mehta@wisdomcampus.com';
  SELECT id INTO _sid_student FROM public.students
   WHERE user_id=_uid_student AND deleted_at IS NULL LIMIT 1;

  ------------------------------------------------------------------
  -- 1. (2b) The mistake book still opens and clears the right way round
  ------------------------------------------------------------------
  -- The inversion this guards against is invisible to a text check and to a
  -- count: with the predicate flipped, a cleared mistake would APPEAR in the
  -- book and an open one would vanish, and both queries would still return
  -- "some number of rows".
  SELECT count(*) INTO _open_before
    FROM public.student_mistakes WHERE user_id=_uid_student AND status='open';

  INSERT INTO public.student_mistakes
    (user_id, student_id, school_id, source, subject, question_text, times_wrong, last_wrong_at, status)
  VALUES
    (_uid_student, _sid_student, _demo, 'practice', 'Verification',
     'A mistake created by CHUNK7B_BATCH2BC_VERIFY', 1, now(), 'open')
  RETURNING id INTO _mid;

  UPDATE public.student_mistakes
     SET status='cleared', cleared_at=now() WHERE id=_mid;
  SELECT count(*) INTO _open_cleared
    FROM public.student_mistakes WHERE user_id=_uid_student AND status='open';

  UPDATE public.student_mistakes
     SET status='open', cleared_at=NULL WHERE id=_mid;
  SELECT count(*) INTO _open_reopened
    FROM public.student_mistakes WHERE user_id=_uid_student AND status='open';

  _r1 := format('open book: %s at rest, %s once cleared, %s once re-opened',
                _open_before, _open_cleared, _open_reopened)
      || CASE WHEN _open_cleared = _open_before AND _open_reopened = _open_before + 1
              THEN ' — clearing removes it and re-opening restores it, so the predicate is not inverted (PASS)'
              ELSE ' — the mistake book does not track status correctly (FAIL)' END;

  ------------------------------------------------------------------
  -- 2. (2b) Nothing reads the dropped boolean, and the JSON key survived
  ------------------------------------------------------------------
  -- The 'unmastered' key in rpc_refresh_academic_brain is a WORD containing
  -- "mastered" that must NOT have been rewritten. A broad substitution would
  -- have eaten it silently, so both halves are asserted: zero functions
  -- reference the column, and the key is still there.
  SELECT count(*) INTO _fn_mastered
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.prosrc ~ '\mmastered\M';

  SELECT count(*) INTO _fn_json
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.prosrc LIKE '%''unmastered''%';

  _r2 := format('functions referencing the mastered column: %s; functions keeping the ''unmastered'' JSON key: %s',
                _fn_mastered, _fn_json)
      || CASE WHEN _fn_mastered = 0 AND _fn_json >= 1
              THEN ' — the column is gone and the lookalike key survived the substitution (PASS)'
              WHEN _fn_json = 0
              THEN ' — the ''unmastered'' key was eaten by the rewrite (FAIL)'
              ELSE ' — a function still reads the dropped column (FAIL)' END;

  ------------------------------------------------------------------
  -- 3. (2c) Finishing a battle destroys the record of what was right
  ------------------------------------------------------------------
  SELECT bp.id INTO _pid FROM public.battle_participants bp
   WHERE bp.finished_at IS NOT NULL ORDER BY bp.finished_at DESC LIMIT 1;

  IF _pid IS NULL THEN
    _r3 := 'SKIPPED — no finished battle participant exists to test against. '
        || 'A skipped check is not a passing check.';
  ELSE
    -- No row is planted here. An earlier draft inserted a correct answer and
    -- then excluded that participant from the count, which is a check that
    -- cannot fail — and it collided with
    -- battle_answers_participant_id_question_id_key anyway.
    --
    -- The purge lives in rpc_finish_battle and cannot be re-run (a second
    -- finish returns early on _already). So assert the INVARIANT the purge
    -- exists to maintain, across EVERY finished participant. That is also what
    -- makes this meaningful rather than circular: the number is not derived
    -- from the migration's own code path.
    --
    -- The negative control for this exact assertion lives in
    -- scripts/verify-database-integrity.mjs, where planting one correct row
    -- for a finished participant was shown to move it from 0 to 1.
    SELECT count(*) INTO _correct_after
      FROM public.battle_answers ba JOIN public.battle_participants bp ON bp.id=ba.participant_id
     WHERE bp.finished_at IS NOT NULL AND ba.is_correct IS TRUE;

    SELECT count(*) INTO _wrong_after
      FROM public.battle_answers ba JOIN public.battle_participants bp ON bp.id=ba.participant_id
     WHERE bp.finished_at IS NOT NULL AND ba.is_correct IS FALSE;

    _r3 := format('across all finished participants: %s correct rows retained, %s wrong/skipped rows retained',
                  _correct_after, _wrong_after)
        || CASE WHEN _correct_after = 0 AND _wrong_after > 0
                THEN ' — only what went wrong survives a finished battle (PASS)'
                WHEN _correct_after = 0
                THEN ' — no correct rows, but no wrong rows either, so the purge is not distinguishable from an empty table here (WEAK)'
                ELSE ' — a finished battle still records correct answers (FAIL)' END;
  END IF;

  ------------------------------------------------------------------
  -- 4. (2c) Strong areas are not computed, at any point
  ------------------------------------------------------------------
  -- Asserted against the aggregate itself rather than the word "strong",
  -- because the body still contains 'strong' as a now-constant key.
  SELECT count(*) INTO _strong_aggregate
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.proname='_snapshot_battle_report'
     AND p.prosrc ~ 'HAVING count\(\*\) FILTER \(WHERE ba\.is_correct\) = count\(\*\)';

  _r4 := format('strong-areas aggregate present in _snapshot_battle_report: %s', _strong_aggregate)
      || CASE WHEN _strong_aggregate = 0
              THEN ' — chapters answered entirely correctly are no longer computed, in flight or not (PASS)'
              ELSE ' — the strong-areas aggregate survives (FAIL)' END;

  ------------------------------------------------------------------
  -- 5. (2c) battle_reports policies name only the owner
  ------------------------------------------------------------------
  SELECT count(*) INTO _wide_policies
    FROM pg_policies
   WHERE schemaname='public' AND tablename='battle_reports'
     AND (COALESCE(qual,'') ILIKE '%teacher_teaches_class%'
       OR COALESCE(qual,'') ILIKE '%creator_user_id%'
       OR COALESCE(with_check,'') ILIKE '%teacher_teaches_class%'
       OR COALESCE(with_check,'') ILIKE '%creator_user_id%');

  _r5 := format('battle_reports policies still naming a teacher or creator: %s', _wide_policies)
      || CASE WHEN _wide_policies = 0
              THEN ' — the policy half of the fix holds (PASS)'
              ELSE ' — a policy still admits a non-owner (FAIL)' END
      || '. NOTE: policies alone were never sufficient here — rpc_get_battle_report'
      || ' is SECURITY DEFINER and bypassed all of them until batch 2d.'
      || ' CHUNK7B_BATCH2D_VERIFY item 1 is the check that covers that path.';

  RAISE EXCEPTION E'CHUNK7B_BATCH2BC\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n [all rolled back]',
    _r1, _r2, _r3, _r4, _r5;
END $verify$;
