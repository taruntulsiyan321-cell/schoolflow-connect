-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7C-C part 1 VERIFICATION — the bank-first half
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE, so
-- the fixture rows never commit. That is what lets it insert real variants into
-- the shared bank to prove serving, without leaving them there.
--
-- Covers 7C verification item 3 in full, item 4's cache-hit half, and the §4.2
-- difficulty rule and §4.2a skipped-not-faked rule. Item 4's "then generated"
-- half needs the AI path and is left visibly absent rather than stubbed.
--
-- CHUNK7C_C1_VERIFY_OK means every item ran and passed.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  _arjun    uuid;
  _other    uuid;
  _chapter  uuid;
  _foreign  uuid;
  _orig     public.question_bank%ROWTYPE;
  _v1       uuid := gen_random_uuid();
  _v1_wrong uuid := gen_random_uuid();
  _v2       uuid := gen_random_uuid();
  _plan     jsonb;
  _n        bigint;
  _raised   boolean;
  _other_difficulty text;
  _fail     text := '';
BEGIN

  SELECT id INTO _arjun FROM auth.users WHERE email = 'arjun.mehta@wisdomcampus.com';
  SELECT id INTO _other FROM auth.users WHERE email = 'priya.patel@wisdomcampus.com';
  IF _arjun IS NULL OR _other IS NULL THEN
    RAISE EXCEPTION 'CHUNK7C_C1_VERIFY: demo student accounts missing; cannot verify as a real role.';
  END IF;

  -- A chapter this student's section actually teaches, holding real questions,
  -- in which the student has NO mistakes of their own. Every check below reads
  -- the ladder built from the ONE mistake seeded here: item 1 expects tier 0 to
  -- hold exactly it, item 7 needs deep mode. The first taught chapter used to
  -- be taken as found, so once the student had practised and got questions
  -- wrong there, tier 0 held those too ("tier 0 filled 2") and then the seed
  -- itself collided with a real mistake on the same question (23505).
  SELECT ch.id INTO _chapter
    FROM public.chapters ch
    JOIN public.section_subjects ss ON ss.curriculum_subject_id = ch.curriculum_subject_id
    JOIN public.students st ON st.class_id = ss.section_id
   WHERE st.user_id = _arjun
     AND (SELECT count(*) FROM public.question_bank qb
           WHERE qb.chapter_id = ch.id AND qb.is_active AND qb.is_approved) >= 3
     AND NOT EXISTS (
       SELECT 1 FROM public.student_mistakes sm
        WHERE sm.user_id = _arjun AND sm.chapter_id = ch.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.student_mistakes sm
         JOIN public.question_bank qb ON qb.id = sm.question_id
        WHERE sm.user_id = _arjun AND qb.chapter_id = ch.id)
   ORDER BY ch.id
   LIMIT 1;

  IF _chapter IS NULL THEN
    RAISE EXCEPTION 'CHUNK7C_C1_VERIFY: no taught chapter with 3+ approved questions and no mistakes of the student''s own; the checks below would read someone else''s ladder.';
  END IF;

  -- One chapter the student is NOT entitled to, for the filter check: neither
  -- taught to their section nor practised by them. A practised chapter is
  -- theirs since 20261044000000, so an untaught one alone no longer is.
  SELECT ch.id INTO _foreign
    FROM public.chapters ch
   WHERE NOT EXISTS (
     SELECT 1 FROM public.section_subjects ss
       JOIN public.students st ON st.class_id = ss.section_id
      WHERE ss.curriculum_subject_id = ch.curriculum_subject_id AND st.user_id = _arjun)
     AND NOT EXISTS (
     SELECT 1 FROM public.question_attempts qa
       JOIN public.question_bank qb ON qb.id = qa.bank_question_id
      WHERE qa.user_id = _arjun AND qb.chapter_id = ch.id)
   LIMIT 1;

  -- A question with no variants yet: item 1 expects tier 1 to start empty.
  SELECT * INTO _orig FROM public.question_bank qb
   WHERE qb.chapter_id = _chapter AND qb.is_active AND qb.is_approved
     AND qb.source_question_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.question_bank v WHERE v.source_question_id = qb.id)
   ORDER BY qb.created_at, qb.id LIMIT 1;

  IF _orig.id IS NULL THEN
    RAISE EXCEPTION 'CHUNK7C_C1_VERIFY: every question in chapter % already has variants; item 1 would be vacuous.', _chapter;
  END IF;

  -- A difficulty that is NOT the original's, for the mirroring check.
  _other_difficulty := CASE WHEN _orig.difficulty = 'hard' THEN 'easy' ELSE 'hard' END;

  -- The student's own wrong question. This is the tier-0 source and the thing
  -- tiers 1 and 2 are variants OF.
  INSERT INTO public.student_mistakes
    (user_id, student_id, school_id, source, subject, chapter, chapter_id, question_id,
     question_text, correct_answer, times_wrong, last_wrong_at, status, difficulty)
  SELECT _arjun, st.id, st.school_id, 'practice', _orig.subject, _orig.chapter, _chapter, _orig.id,
         _orig.question, to_jsonb(_orig.correct_index), 2, now(), 'open', _orig.difficulty
    FROM public.students st WHERE st.user_id = _arjun;


  -- ═════════════════════════════════════════════════════════════════════
  -- 1. SKIPPED, NOT FAKED — with no variants in the bank, the plan runs
  --    short and says so rather than padding the ladder.
  -- ═════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _arjun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _plan := public.rpc_recovery_session_plan(_chapter);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF (_plan->'tiers'->'0'->>'filled')::int <> 1 THEN
    _fail := _fail || format('(FAIL) 1: tier 0 filled %s, expected the student''s own wrong question. ',
                             _plan->'tiers'->'0'->>'filled');
  END IF;
  IF (_plan->'tiers'->'1'->>'filled')::int <> 0
     OR jsonb_array_length(_plan->'tiers'->'1'->'from_bank') <> 0 THEN
    _fail := _fail || '(FAIL) 1: tier 1 returned questions when the bank holds no variants — the ladder was padded. ';
  END IF;
  -- `generation_required` is gone from the plan (Chunk 7F). It was
  -- (_total_short > 0) — a second home for `shortfall`, which the next check
  -- already asserts on — so the rewrite dropped it rather than carrying two
  -- keys that can disagree. No client ever read it. `complete` stays: it is
  -- the plan's own verdict and not a restatement of the count.
  IF (_plan->>'complete')::boolean IS NOT FALSE THEN
    _fail := _fail || '(FAIL) 1: an incomplete ladder did not report itself as incomplete. ';
  END IF;
  IF (_plan->>'shortfall')::int = 0 THEN
    _fail := _fail || '(FAIL) 1: shortfall is 0 with an empty variant bank, so it is not being counted. ';
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 2. ITEM 4 (cache half) — the bank is checked BEFORE generating.
  --    Put one tier-1 variant in the bank and the plan must use it.
  -- ═════════════════════════════════════════════════════════════════════
  INSERT INTO public.question_bank
    (id, subject, chapter, chapter_id, class_level, difficulty, question, options,
     correct_index, is_approved, is_active, embed_status, source_question_id, variant_tier)
  VALUES
    (_v1, _orig.subject, _orig.chapter, _chapter, _orig.class_level, _orig.difficulty,
     'VERIFY tier-1 variant of ' || left(_orig.question, 40), _orig.options,
     _orig.correct_index, true, true, _orig.embed_status, _orig.id, 1);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _arjun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _plan := public.rpc_recovery_session_plan(_chapter);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF (_plan->'tiers'->'1'->>'filled')::int <> 1 THEN
    _fail := _fail || format('(FAIL) 2: tier 1 filled %s after a matching variant was banked — the bank is not being checked first. ',
                             _plan->'tiers'->'1'->>'filled');
  END IF;
  IF NOT (_plan->'tiers'->'1'->'from_bank' @> to_jsonb(_v1)) THEN
    _fail := _fail || '(FAIL) 2: the banked variant is not the one served. ';
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 3. ITEM 3 — a variant is an ordinary bank question, servable to OTHER
  --    students. §4.2a: "This is what makes it affordable."
  -- ═════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.question_bank WHERE id = _v1;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _n <> 1 THEN
    _fail := _fail || '(FAIL) 3: a different student cannot read the variant, so the cache never warms across students. ';
  END IF;

  SELECT count(*) INTO _n FROM public.question_bank
   WHERE id = _v1 AND source_question_id = _orig.id AND variant_tier = 1;
  IF _n <> 1 THEN
    _fail := _fail || '(FAIL) 3: the variant is not tagged with source_question_id and variant_tier. ';
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 4. §4.2 DIFFICULTY MIRRORING — a variant at the wrong difficulty is not
  --    served. Then the same variant at the RIGHT difficulty is, so this
  --    discriminates rather than merely failing to find anything.
  -- ═════════════════════════════════════════════════════════════════════
  INSERT INTO public.question_bank
    (id, subject, chapter, chapter_id, class_level, difficulty, question, options,
     correct_index, is_approved, is_active, embed_status, source_question_id, variant_tier)
  VALUES
    (_v1_wrong, _orig.subject, _orig.chapter, _chapter, _orig.class_level, _other_difficulty,
     'VERIFY tier-2 variant at the WRONG difficulty', _orig.options,
     _orig.correct_index, true, true, _orig.embed_status, _orig.id, 2);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _arjun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _plan := public.rpc_recovery_session_plan(_chapter);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF (_plan->'tiers'->'2'->>'filled')::int <> 0 THEN
    _fail := _fail || format('(FAIL) 4: tier 2 served %s question(s) at difficulty %L when the student failed at %L. ',
                             _plan->'tiers'->'2'->>'filled', _other_difficulty, _orig.difficulty);
  END IF;

  INSERT INTO public.question_bank
    (id, subject, chapter, chapter_id, class_level, difficulty, question, options,
     correct_index, is_approved, is_active, embed_status, source_question_id, variant_tier)
  VALUES
    (_v2, _orig.subject, _orig.chapter, _chapter, _orig.class_level, _orig.difficulty,
     'VERIFY tier-2 variant at the right difficulty', _orig.options,
     _orig.correct_index, true, true, _orig.embed_status, _orig.id, 2);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _arjun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _plan := public.rpc_recovery_session_plan(_chapter);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF (_plan->'tiers'->'2'->>'filled')::int <> 1 THEN
    _fail := _fail || '(FAIL) 4: a difficulty-matched tier-2 variant was not served, so the filter rejects everything rather than discriminating. ';
  END IF;
  IF _plan->'tiers'->'2'->'from_bank' @> to_jsonb(_v1_wrong) THEN
    _fail := _fail || '(FAIL) 4: the wrong-difficulty variant was served after all. ';
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 5. NEGATIVE CONTROL — retiring the variant must remove it from the pool.
  --    If it is still served, every pass above was the lookup returning
  --    everything rather than filtering.
  -- ═════════════════════════════════════════════════════════════════════
  UPDATE public.question_bank SET is_active = false WHERE id = _v1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _arjun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _plan := public.rpc_recovery_session_plan(_chapter);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF (_plan->'tiers'->'1'->>'filled')::int <> 0 THEN
    _fail := _fail || '(FAIL) 5: a retired variant is still served, so the pool does not filter and item 2''s pass proved nothing. ';
  END IF;

  UPDATE public.question_bank SET is_active = true WHERE id = _v1;


  -- ═════════════════════════════════════════════════════════════════════
  -- 6. THE CURRICULUM FILTER — a chapter the student's section does not
  --    teach is refused. This is the doc's "enforce in the query layer".
  -- ═════════════════════════════════════════════════════════════════════
  IF _foreign IS NOT NULL THEN
    _raised := false;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _arjun, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.rpc_recovery_session_plan(_foreign);
    EXCEPTION WHEN others THEN
      _raised := true;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);

    IF NOT _raised THEN
      _fail := _fail || '(FAIL) 6: a chapter neither taught to the student''s section nor practised by them was planned without objection. ';
    END IF;
  ELSE
    _fail := _fail || '(FAIL) 6: no unentitled chapter exists to test the filter with, so this check is vacuous. ';
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 7. NO LITERALS — the ladder sizes come from the constants (item 7).
  --    Proved by moving one and watching the plan move with it, which a
  --    hardcoded count would not.
  --
  --    RECOVERY_TIER1 no longer exists: Chunk 7F replaced the fixed 2/3/3/2
  --    ladder with a PER-MISTAKE one, because the fixed tier 0 of two silently
  --    dropped four of one student's six mistakes. The constant that now sets
  --    tier 1's size in deep mode is RECOVERY_DEEP_TIER1, and the plan needs
  --    (open mistakes x that) — so the assertion multiplies, which also proves
  --    the per-mistake arithmetic is real and not a coincidence at 1.
  -- ═════════════════════════════════════════════════════════════════════
  SELECT count(*)::int INTO _n
    FROM public.student_mistakes sm
   WHERE sm.user_id = _arjun::uuid AND sm.chapter_id = _chapter
     AND sm.status = 'open' AND sm.question_id IS NOT NULL;

  IF _n = 0 OR _n > public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int THEN
    _fail := _fail || format('(FAIL) 7: fixture has %s open mistake(s); this item needs 1..%s so the plan is in deep mode. ',
                             _n, public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES'));
  ELSE
    UPDATE public.recovery_constants SET value = 4 WHERE key = 'RECOVERY_DEEP_TIER1';

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _arjun, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _plan := public.rpc_recovery_session_plan(_chapter);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);

    IF (_plan->'tiers'->'1'->>'needed')::int <> 4 * _n THEN
      _fail := _fail || format('(FAIL) 7: RECOVERY_DEEP_TIER1 was changed to 4 with %s open mistake(s), so the plan should need %s at tier 1; it needs %s — the count is a literal, not the constant. ',
                               _n, 4 * _n, _plan->'tiers'->'1'->>'needed');
    END IF;
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  IF _fail <> '' THEN
    RAISE EXCEPTION 'CHUNK7C_C1_VERIFY — AT LEAST ONE CHECK FAILED: %', _fail;
  END IF;

  RAISE EXCEPTION
    'CHUNK7C_C1_VERIFY_OK — bank-first lookup, item 3 in full, item 4 cache half, difficulty mirroring, skipped-not-faked, curriculum filter, constants not literals; negative control fired; rolling back.';
END
$verify$;
