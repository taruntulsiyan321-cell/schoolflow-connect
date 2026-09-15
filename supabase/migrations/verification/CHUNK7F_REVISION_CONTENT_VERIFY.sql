-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY: a revision check is the misses plus the genuinely unseen
-- ════════════════════════════════════════════════════════════════════════════
--
-- Run it:
--   psql "$DB" -f supabase/migrations/verification/CHUNK7F_REVISION_CONTENT_VERIFY.sql
--   (or POST the file to the Management API /database/query endpoint)
--
-- WHY THE POSITIVE CONTROL IS THE MOST IMPORTANT ITEM HERE
--
-- "No question in the fresh half has been seen before" passes trivially
-- against a chapter the student has never touched, against an empty bank, and
-- against a function that returns an empty list. All three would be green and
-- all three prove nothing.
--
-- So item 1 is paired with item 2, which asserts that this student HAS
-- attempted questions in this chapter and that those questions ARE in the
-- bank — i.e. that there was something for the filter to exclude. Item 1 only
-- means anything because item 2 holds.
--
-- Read-only. This file makes no writes at all, so there is nothing to roll
-- back; it asserts against production as it stands.
--
-- IT RUNS AS `authenticated`, NOT AS THE OWNER. Setting request.jwt.claims
-- makes auth.uid() answer; it does not make the session that user. An earlier
-- version of this file set the claim and ran as the database owner, who has
-- EXECUTE on everything and is not subject to RLS — so it passed against a
-- rpc_revision_session_plan that NO STUDENT COULD CALL, because the grant had
-- been forgotten. Running under the role is what makes the pass mean the
-- feature works for a student rather than for me.
-- ════════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  _report   text := '';
  _uid      uuid;
  _chapter  uuid;
  _plan     jsonb;
  _fail     text := '';
  _pass     int := 0;
  _fresh    uuid[];
  _miss     uuid[];
  _seen     int;
  _overlap  int;
  _n_seen_in_chapter int;
  _open     uuid[];
  _cap      int;
BEGIN
  ----------------------------------------------------------------------
  -- Fixture: a student who has BOTH attempted questions in a chapter AND
  -- holds an open mistake there. Both halves of the check need exercising.
  ----------------------------------------------------------------------
  SELECT sm.user_id, sm.chapter_id INTO _uid, _chapter
    FROM public.student_mistakes sm
   WHERE sm.status = 'open' AND sm.question_id IS NOT NULL AND sm.chapter_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.question_attempts qa
        JOIN public.question_bank qb ON qb.id = qa.bank_question_id
        WHERE qa.user_id = sm.user_id AND qb.chapter_id = sm.chapter_id)
   GROUP BY sm.user_id, sm.chapter_id
   ORDER BY count(*) DESC
   LIMIT 1;

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NO FIXTURE: no student both holds an open mistake in a chapter and has attempted questions in it. This suite cannot run, which is NOT a pass.';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid::text)::text, true);
  IF auth.uid() IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'IMPERSONATION FAILED: auth.uid() is % not %.', auth.uid(), _uid;
  END IF;

  -- Become the student. Everything from here obeys RLS and the EXECUTE grants.
  SET LOCAL ROLE authenticated;
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'ROLE SWITCH FAILED: running as %, so RLS and grants are not in force', current_user;
  END IF;

  _plan := public.rpc_revision_session_plan(_chapter);

  SELECT array_agg(v::uuid) INTO _fresh
    FROM jsonb_array_elements_text(_plan->'fresh_ids') AS e(v);
  SELECT array_agg(v::uuid) INTO _miss
    FROM jsonb_array_elements_text(_plan->'mistake_ids') AS e(v);

  ----------------------------------------------------------------------
  -- 2 FIRST, because item 1 leans on it: was there anything to exclude?
  ----------------------------------------------------------------------
  SELECT count(DISTINCT qa.bank_question_id)::int INTO _n_seen_in_chapter
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
   WHERE qa.user_id = _uid AND qb.chapter_id = _chapter;

  IF _n_seen_in_chapter = 0 THEN
    _fail := _fail || '(FAIL) 2: POSITIVE CONTROL — this student has attempted NO question in this chapter, so item 1 would pass against a function that does nothing. ';
  ELSE
    _pass := _pass + 1;
    _report := _report || format(
      '(PASS) 2: positive control — this student has already attempted %s question(s) in this chapter, so the "never seen" filter had real work to do.',
      _n_seen_in_chapter) || E'\n';
  END IF;

  ----------------------------------------------------------------------
  -- 1. Nothing in the fresh half has ever been attempted by this student.
  ----------------------------------------------------------------------
  SELECT count(*)::int INTO _seen
    FROM unnest(COALESCE(_fresh, ARRAY[]::uuid[])) AS f(qid)
   WHERE EXISTS (
     SELECT 1 FROM public.question_attempts qa
      WHERE qa.user_id = _uid AND qa.bank_question_id = f.qid)
      OR EXISTS (
     SELECT 1 FROM public.student_mistakes sm
      WHERE sm.user_id = _uid AND sm.question_id = f.qid);

  IF _seen > 0 THEN
    _fail := _fail || format('(FAIL) 1: %s of %s "fresh" question(s) have already been seen by this student. ',
      _seen, COALESCE(array_length(_fresh, 1), 0));
  ELSIF COALESCE(array_length(_fresh, 1), 0) = 0 THEN
    -- An empty fresh half is a legitimate state (an exhausted chapter), but it
    -- is not evidence the filter works, so it is reported as its own outcome
    -- rather than counted as a pass.
    _fail := _fail || format('(FAIL) 1: the fresh half is EMPTY for this chapter (%s unseen available), so this item proves nothing. Pick a chapter with material left. ',
      _plan->>'fresh');
  ELSE
    _pass := _pass + 1;
    _report := _report || format('(PASS) 1: all %s question(s) in the fresh half are unseen — no attempt and no mistake row against any of them.',
      array_length(_fresh, 1)) || E'\n';
  END IF;

  ----------------------------------------------------------------------
  -- 3. The miss half is exactly this student's open mistakes, capped.
  ----------------------------------------------------------------------
  _cap := public._recovery_const('REVISION_MISTAKE_MAX')::int;
  SELECT array_agg(question_id) INTO _open
    FROM public.student_mistakes
   WHERE user_id = _uid AND chapter_id = _chapter AND status = 'open' AND question_id IS NOT NULL;

  SELECT count(*)::int INTO _overlap
    FROM unnest(COALESCE(_miss, ARRAY[]::uuid[])) AS m(qid)
   WHERE NOT (m.qid = ANY (COALESCE(_open, ARRAY[]::uuid[])));

  IF _overlap > 0 THEN
    _fail := _fail || format('(FAIL) 3: %s question(s) in the miss half are not open mistakes of this student. ', _overlap);
  ELSIF COALESCE(array_length(_miss, 1), 0)
        <> LEAST(_cap, COALESCE(array_length(_open, 1), 0)) THEN
    _fail := _fail || format('(FAIL) 3: miss half has %s, expected LEAST(%s, %s). ',
      COALESCE(array_length(_miss, 1), 0), _cap, COALESCE(array_length(_open, 1), 0));
  ELSE
    _pass := _pass + 1;
    _report := _report || format('(PASS) 3: the miss half is %s of this student''s %s open mistake(s), all genuinely theirs.',
      COALESCE(array_length(_miss, 1), 0), COALESCE(array_length(_open, 1), 0)) || E'\n';
  END IF;

  ----------------------------------------------------------------------
  -- 4. The halves do not overlap, and the total is their sum.
  ----------------------------------------------------------------------
  SELECT count(*)::int INTO _overlap
    FROM unnest(COALESCE(_fresh, ARRAY[]::uuid[])) AS f(qid)
   WHERE f.qid = ANY (COALESCE(_miss, ARRAY[]::uuid[]));

  IF _overlap > 0 THEN
    _fail := _fail || format('(FAIL) 4: %s question(s) are in BOTH halves, so one answer would be scored twice. ', _overlap);
  ELSIF (_plan->>'total')::int <> COALESCE(array_length(_fresh, 1), 0) + COALESCE(array_length(_miss, 1), 0) THEN
    _fail := _fail || format('(FAIL) 4: total says %s but the two halves hold %s. ',
      _plan->>'total', COALESCE(array_length(_fresh, 1), 0) + COALESCE(array_length(_miss, 1), 0));
  ELSE
    _pass := _pass + 1;
    _report := _report || format('(PASS) 4: the halves are disjoint and total (%s) is exactly their sum.', _plan->>'total') || E'\n';
  END IF;

  ----------------------------------------------------------------------
  -- 5. A shortfall is REPORTED, never padded away.
  ----------------------------------------------------------------------
  IF (_plan->>'fresh_short')::int
     <> greatest(0, (_plan->>'fresh_wanted')::int - (_plan->>'fresh')::int) THEN
    _fail := _fail || '(FAIL) 5: fresh_short does not equal wanted minus filled. ';
  ELSIF (_plan->>'fresh')::int > (_plan->>'fresh_wanted')::int THEN
    _fail := _fail || format('(FAIL) 5: the fresh half holds %s, more than the %s asked for. ',
      _plan->>'fresh', _plan->>'fresh_wanted');
  ELSE
    _pass := _pass + 1;
    _report := _report || format('(PASS) 5: fresh %s of %s wanted, shortfall reported as %s — short, never padded.',
      _plan->>'fresh', _plan->>'fresh_wanted', _plan->>'fresh_short') || E'\n';
  END IF;

  ----------------------------------------------------------------------
  IF _fail <> '' THEN
    _report := _report || format('════ %s of 5 PASSED ════', _pass) || E'\n';
    _report := _report || 'VERIFICATION FAILED: ' || _fail;
  ELSE
    _report := _report || '════ ALL 5 CHECKS PASSED ════' || E'\n';
  END IF;

  RESET ROLE;

  -- The house contract: end in a deliberate RAISE. It rolls the fixtures
  -- back, it is how run-verification-files.mjs tells a file that ran from
  -- one that has rotted, and it is the only channel that survives the
  -- Management API, which discards NOTICEs.
  RAISE EXCEPTION E'\n%', _report;
END $verify$;
