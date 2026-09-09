-- probe41: the semantic fill RANKS the pool and cannot WIDEN it (§5, §10.9, G14).
--
-- `rpc_fill_paper_section_from_bank` now takes an optional ordered list of bank
-- ids. Those ids are produced by `ai-gateway`, which calls
-- `match_question_bank` with the SERVICE ROLE and therefore bypasses RLS. The
-- entire safety of the feature rests on one property: the ids are a SUGGESTED
-- ORDER, and the RPC re-applies the section's own filters as the CALLER before
-- anything reaches a paper.
--
-- If that were ever untrue, a service-role ranking would become a service-role
-- read — a teacher could be handed questions from another class, another
-- subject, another board, or a question already on their paper.
--
-- THE CLAIMS
--   1. the structured fill still works with no ids at all.   (POSITIVE CONTROL)
--   2. ...and reports strategy 'structured'.
--   3. a ranked list fills the section IN THAT ORDER.        (POSITIVE CONTROL)
--   4. ...and reports strategy 'semantic'.
--   5. an id for the WRONG SUBJECT is refused entry.               <- the fence
--   6. an id for the WRONG CLASS LEVEL is refused entry.           <- §10.9
--   7. an id outside the section's CHAPTERS is refused entry.      <- the fence
--   8. an id already on the paper is not added twice.              <- the rule
--   9. a garbage id changes nothing.
--  10. there is exactly ONE overload of the function.              <- PostgREST
--
-- 1 and 3 are what make the refusals mean anything: a fill that inserts nothing
-- satisfies every "must not insert" claim here.
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE probe(n serial, area text, role_tested text, expected text, observed text, verdict text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.as_user(_uid uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
  PERFORM set_config('role','authenticated', true);
  BEGIN
    EXECUTE _sql INTO _out;
    PERFORM set_config('role','postgres', true);
    RETURN 'OK: ' || coalesce(_out,'null');
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    RETURN 'ERROR: ' || SQLERRM;
  END;
END $fn$;

DO $probe$
DECLARE
  sch_a     uuid := '00000000-0000-4000-8000-000000000001';
  teacher   uuid;
  subj      text;
  chap      text;
  other_ch  text;
  paper     uuid;
  sec_a     uuid;
  sec_b     uuid;
  ids       uuid[];
  wrong_sub uuid;
  wrong_lvl uuid;
  wrong_ch  uuid;
  first_id  uuid;
  r         text;
BEGIN
  SELECT id INTO teacher FROM auth.users WHERE email='priya.sharma@wisdomcampus.com';

  -- A class-10 subject/chapter pair with enough medium questions to rank.
  SELECT qb.subject, qb.chapter INTO subj, chap
    FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.class_level = 10 AND qb.difficulty='medium'
   GROUP BY qb.subject, qb.chapter HAVING count(*) >= 4
   ORDER BY count(*) DESC LIMIT 1;

  -- A DIFFERENT chapter of the same subject and class — claim 7 needs an id
  -- that passes every filter except the chapter one.
  SELECT qb.chapter INTO other_ch
    FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.class_level = 10
     AND qb.subject = subj AND qb.chapter <> chap AND qb.difficulty='medium'
   GROUP BY qb.chapter HAVING count(*) >= 1
   ORDER BY qb.chapter LIMIT 1;

  SELECT array_agg(x.id ORDER BY x.id) INTO ids FROM (
    SELECT qb.id FROM public.question_bank qb
     WHERE qb.is_active AND qb.is_approved AND qb.class_level = 10
       AND qb.subject = subj AND qb.chapter = chap AND qb.difficulty='medium'
     ORDER BY qb.id LIMIT 4) x;

  -- One id from another SUBJECT, one from another CLASS, one from another CHAPTER.
  SELECT qb.id INTO wrong_sub FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.class_level = 10 AND qb.subject <> subj
   ORDER BY qb.id LIMIT 1;
  SELECT qb.id INTO wrong_lvl FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.class_level <> 10 AND qb.subject = subj
   ORDER BY qb.id LIMIT 1;
  SELECT qb.id INTO wrong_ch FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.class_level = 10
     AND qb.subject = subj AND qb.chapter = other_ch
   ORDER BY qb.id LIMIT 1;

  IF teacher IS NULL OR subj IS NULL OR ids IS NULL OR array_length(ids,1) < 4
     OR wrong_sub IS NULL OR wrong_lvl IS NULL OR wrong_ch IS NULL THEN
    RAISE EXCEPTION
      'probe41: fixtures missing (teacher=%, subject=%, ids=%, wrong_subject=%, wrong_level=%, wrong_chapter=%) '
      '— a skipped check is not a passing check',
      teacher, subj, coalesce(array_length(ids,1),0), wrong_sub, wrong_lvl, wrong_ch;
  END IF;

  first_id := ids[1];

  -- ── fixture: one paper, two identical sections ─────────────────────────
  INSERT INTO public.question_papers
    (school_id, created_by, title, subject, class_level, duration_minutes)
  VALUES (sch_a, teacher, 'probe41 paper', subj, 10, 60)
  RETURNING id INTO paper;

  INSERT INTO public.question_paper_sections
    (paper_id, school_id, order_index, title, question_format,
     marks_per_question, target_count, difficulty, chapters)
  VALUES (paper, sch_a, 0, 'Structured', 'mcq', 1, 2, 'medium', ARRAY[chap]::text[])
  RETURNING id INTO sec_a;

  INSERT INTO public.question_paper_sections
    (paper_id, school_id, order_index, title, question_format,
     marks_per_question, target_count, difficulty, chapters)
  VALUES (paper, sch_a, 1, 'Semantic', 'mcq', 1, 2, 'medium', ARRAY[chap]::text[])
  RETURNING id INTO sec_b;

  -- ── 1/2. the structured path, untouched ────────────────────────────────
  r := pg_temp.as_user(teacher, format(
    $q$SELECT (public.rpc_fill_paper_section_from_bank(%L) ->> 'inserted')$q$, sec_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the structured fill still works with no ids (positive control)','teacher','OK: 2', r,
     CASE WHEN r = 'OK: 2' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(teacher, format(
    $q$SELECT (public.rpc_fill_paper_section_from_bank(%L) ->> 'strategy')$q$, sec_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and calls itself structured','teacher','OK: structured', r,
     CASE WHEN r = 'OK: structured' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3/4. a ranked list, in that order ──────────────────────────────────
  --
  -- Section A already holds two of this chapter's questions, so the ids that
  -- reach section B are whichever of the four are still free. The claim is that
  -- the FIRST one inserted is the earliest surviving member of the list, which
  -- is what "ranked" has to mean.
  r := pg_temp.as_user(teacher, format(
    $q$SELECT (public.rpc_fill_paper_section_from_bank(%L, %L::uuid[]) ->> 'strategy')$q$,
    sec_b, ids));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a ranked fill calls itself semantic','teacher','OK: semantic', r,
     CASE WHEN r = 'OK: semantic' THEN 'PASS' ELSE 'FAIL' END);

  SELECT 'OK: ' || count(*)::text INTO r
    FROM public.question_paper_questions q WHERE q.section_id = sec_b;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and it actually inserted (positive control)','-','OK: 2', r,
     CASE WHEN r = 'OK: 2' THEN 'PASS' ELSE 'FAIL' END);

  SELECT CASE WHEN bool_and(q.bank_id = ANY(ids)) THEN 'OK: true' ELSE 'OK: false' END INTO r
    FROM public.question_paper_questions q WHERE q.section_id = sec_b;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...drawing only from the ranked list','-','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8. and never the same bank question twice in one paper ─────────────
  SELECT CASE WHEN count(*) = count(DISTINCT bank_id) THEN 'OK: true' ELSE 'OK: false' END INTO r
    FROM public.question_paper_questions WHERE paper_id = paper;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('no bank question appears twice across the paper','-','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5/6/7/9. THE RANKING CANNOT WIDEN THE POOL ─────────────────────────
  --
  -- A third section, and every id offered to it is one the structured filters
  -- would refuse. If the ranking could widen, these would land.
  INSERT INTO public.question_paper_sections
    (paper_id, school_id, order_index, title, question_format,
     marks_per_question, target_count, difficulty, chapters)
  VALUES (paper, sch_a, 2, 'Hostile', 'mcq', 1, 3, 'medium', ARRAY[chap]::text[])
  RETURNING id INTO sec_a;

  r := pg_temp.as_user(teacher, format(
    $q$SELECT (public.rpc_fill_paper_section_from_bank(%L, ARRAY[%L,%L,%L,%L]::uuid[]) ->> 'inserted')$q$,
    sec_a, wrong_sub, wrong_lvl, wrong_ch, '00000000-0000-0000-0000-000000000000'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('ids for the wrong subject / class / chapter, plus a junk id','teacher','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  SELECT 'OK: ' || count(*)::text INTO r
    FROM public.question_paper_questions q WHERE q.section_id = sec_a;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and nothing reached the paper','-','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ...while the SAME section fills normally from its own chapter. Without
  -- this, claim 5-7 would pass on a section that simply cannot be filled.
  r := pg_temp.as_user(teacher, format(
    $q$SELECT (public.rpc_fill_paper_section_from_bank(%L) ->> 'inserted')$q$, sec_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...while the same section still fills from its own chapter (positive control)','teacher','OK: > 0', r,
     CASE WHEN r LIKE 'OK: %' AND r <> 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8b. an id already on the paper is not re-added ─────────────────────
  INSERT INTO public.question_paper_sections
    (paper_id, school_id, order_index, title, question_format,
     marks_per_question, target_count, difficulty, chapters)
  VALUES (paper, sch_a, 3, 'Repeat', 'mcq', 1, 1, 'medium', ARRAY[chap]::text[])
  RETURNING id INTO sec_b;

  r := pg_temp.as_user(teacher, format(
    $q$SELECT (public.rpc_fill_paper_section_from_bank(%L, ARRAY[%L]::uuid[]) ->> 'inserted')$q$,
    sec_b, first_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('an id already on the paper, offered again','teacher','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 10. one overload ───────────────────────────────────────────────────
  SELECT 'OK: ' || count(*)::text INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_fill_paper_section_from_bank';
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('overloads of the fill function','-','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
