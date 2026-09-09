-- ═══════════════════════════════════════════════════════════════════════════
-- The bank fills the paper, and an all-MCQ paper becomes a test (§10.24)
--
-- Two RPCs, and BOTH ARE SECURITY INVOKER. That is deliberate and it is the
-- whole design: every fence they need already exists as a policy —
-- `qb_select_approved_board` on the bank, `qpq_owner` + `qpq_tenant_fence` on
-- the paper, `tests_insert` on the test. A SECURITY DEFINER wrapper would
-- bypass all four and then have to re-implement them, which is precisely how
-- `rpc_restore_from_trash` let a school-A admin restore a school-B row and how
-- `rpc_test_student_report` handed out another school's answer key three
-- migrations ago. Nothing here needs owner privilege, so nothing here takes it.
--
-- ── 1. `rpc_fill_paper_section_from_bank` ────────────────────────────────
--
-- BANK-FIRST, BY STRUCTURED QUERY, NOT BY VECTOR — and that is a deviation
-- from the brief that is being stated rather than hidden.
--
-- The brief says MCQ sections fill "bank-first via `embed` -> match_question_bank".
-- `match_question_bank` works: measured 2026-09-09 as the teacher, 10 rows
-- back, best similarity 1.0000, subject and class filters honoured, anon
-- refused at the grant. What is NOT available is `embed`, which turns the
-- teacher's blueprint into the query vector it needs: it is an edge function
-- on `*.supabase.co`, and this machine has no IPv4 route (`000`). There is no
-- way to make a query embedding here at all.
--
-- A paper section is also not a semantic query. It is
-- `(class_level, subject, chapter[], difficulty, count)` — every one of them a
-- column, and every one of them populated: 21,681 usable bank rows, ALL with a
-- chapter and a difficulty, 516 distinct chapters, all `question_format='mcq'`.
-- Retrieving on those columns is exact where a nearest-neighbour search is
-- approximate. The semantic path earns its place when a teacher types a free
-- text topic that matches no chapter label, and that is a widening of this
-- function once `embed` is reachable — not a different function.
--
-- SHORTFALL IS RETURNED, NOT SWALLOWED. When the bank cannot fill the section
-- the result says by how many. That number is the brief's "generate the
-- shortfall", and there is nothing to generate it with: `ai-gateway` exposes
-- exactly three paper capabilities — `plan`, `generate_outline`,
-- `marking_scheme` — and all three declare `generates_full_paper: false`. A
-- paper that comes back short must say so on the screen rather than look
-- finished.
--
-- ── 2. `rpc_question_paper_to_test` ──────────────────────────────────────
--
-- "Only all-MCQ papers can be pushed as online tests." §10.24 is the reason:
-- the app "can only analyse what it holds as structured questions with
-- answers", and a short or long answer is prose a person reads. The guard is
-- therefore on the QUESTIONS, not on the section headings — a section declared
-- 'mcq' whose rows carry a free-text `answer` and no `options` would pass a
-- heading check and produce a test that can never be marked.
--
-- The answer key is written as a POSITION — `{"indexes":[i]}` — because that is
-- what `rpc_test_submit` compares against. All 576 legacy `test_questions` rows
-- stored the LABEL instead and could never be marked right (20260914110000).
--
-- Rollback: supabase/migrations/rollback/
--           20260916050000_the_bank_fills_the_paper_and_an_all_mcq_paper_becomes_a_test.rollback.sql
-- Assertion: verification/caller-privileges/probe39.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Fill one section from the question bank ───────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_fill_paper_section_from_bank(_section_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  sec       public.question_paper_sections%ROWTYPE;
  pap       public.question_papers%ROWTYPE;
  present   int;
  wanted    int;
  pool      int;
  inserted  int;
  next_ix   int;
BEGIN
  -- No role check here. `question_paper_sections` is fenced by `qps_owner` and
  -- `qps_tenant_fence`, and this function runs as the caller — a section that
  -- is not theirs simply does not select, and the NOT FOUND below is the
  -- refusal. Restating the rule would put it in two homes (G9).
  SELECT * INTO sec FROM public.question_paper_sections WHERE id = _section_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your question paper section' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO pap FROM public.question_papers WHERE id = sec.paper_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your question paper' USING ERRCODE = '42501';
  END IF;

  IF pap.status <> 'draft' THEN
    RAISE EXCEPTION 'This paper is final — reopen it before changing its questions'
      USING ERRCODE = '22023';
  END IF;

  -- The bank holds MCQs and nothing else: 21,696 rows, every one
  -- question_format='mcq'. Saying so is better than returning zero rows and
  -- letting the teacher wonder which of their filters was too narrow.
  IF sec.question_format <> 'mcq' THEN
    RAISE EXCEPTION
      'The question bank holds multiple-choice questions only, so a % section cannot be filled from it',
      sec.question_format
      USING ERRCODE = '22023';
  END IF;

  IF pap.class_level IS NULL THEN
    RAISE EXCEPTION 'This paper has no class level, so the bank cannot be narrowed to it'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO present
    FROM public.question_paper_questions q WHERE q.section_id = _section_id;

  wanted := GREATEST(sec.target_count - present, 0);

  SELECT COALESCE(max(q.order_index), -1) + 1 INTO next_ix
    FROM public.question_paper_questions q WHERE q.section_id = _section_id;

  -- The candidate pool, before any limit — reported so "the bank had nothing"
  -- and "the bank had plenty and we took what was asked" are distinguishable.
  SELECT count(*) INTO pool
    FROM public.question_bank qb
   WHERE qb.is_active
     AND qb.is_approved
     AND qb.class_level = pap.class_level
     AND qb.subject = pap.subject
     AND (pap.board IS NULL OR qb.board = pap.board OR qb.board = 'both')
     AND (cardinality(sec.chapters) = 0 OR qb.chapter = ANY (sec.chapters))
     AND (sec.difficulty IS NULL OR qb.difficulty = sec.difficulty)
     AND NOT EXISTS (
           SELECT 1 FROM public.question_paper_questions q
            WHERE q.paper_id = sec.paper_id AND q.bank_id = qb.id);

  IF wanted > 0 THEN
    WITH candidates AS (
      SELECT qb.*,
             -- Deterministic but spread: hashing the pair gives the same paper
             -- the same questions on a re-run, and two sections of one paper
             -- different ones. `random()` would make the result unrepeatable
             -- and untestable.
             row_number() OVER (
               PARTITION BY qb.chapter
               ORDER BY md5(qb.id::text || _section_id::text)
             ) AS rn_in_chapter
        FROM public.question_bank qb
       WHERE qb.is_active
         AND qb.is_approved
         AND qb.class_level = pap.class_level
         AND qb.subject = pap.subject
         AND (pap.board IS NULL OR qb.board = pap.board OR qb.board = 'both')
         AND (cardinality(sec.chapters) = 0 OR qb.chapter = ANY (sec.chapters))
         AND (sec.difficulty IS NULL OR qb.difficulty = sec.difficulty)
         AND NOT EXISTS (
               SELECT 1 FROM public.question_paper_questions q
                WHERE q.paper_id = sec.paper_id AND q.bank_id = qb.id)
    ), picked AS (
      -- Round-robin across the chapters the teacher named, so a section over
      -- three chapters is not filled entirely from whichever one happens to
      -- hash lowest.
      SELECT *, row_number() OVER (ORDER BY rn_in_chapter, chapter,
                                   md5(id::text || _section_id::text)) AS pick_ix
        FROM candidates
       ORDER BY rn_in_chapter, chapter, md5(id::text || _section_id::text)
       LIMIT wanted
    )
    INSERT INTO public.question_paper_questions
      (paper_id, section_id, school_id, order_index, origin, bank_id,
       question, options, correct_index, explanation, chapter, marks)
    SELECT sec.paper_id, _section_id, sec.school_id,
           next_ix + (p.pick_ix - 1)::int, 'retrieved', p.id,
           p.question, p.options, p.correct_index, p.explanation, p.chapter,
           sec.marks_per_question
      FROM picked p;
    GET DIAGNOSTICS inserted = ROW_COUNT;
  ELSE
    inserted := 0;
  END IF;

  RETURN jsonb_build_object(
    'section_id', _section_id,
    'target_count', sec.target_count,
    'already_present', present,
    'requested', wanted,
    'pool_size', pool,
    'inserted', inserted,
    -- What the bank could not supply. The brief calls for generating this;
    -- nothing in ai-gateway generates questions, so it is surfaced instead of
    -- being quietly rounded away.
    'shortfall', GREATEST(wanted - inserted, 0)
  );
END;
$function$;

COMMENT ON FUNCTION public.rpc_fill_paper_section_from_bank(uuid) IS
  'Bank-first fill for one MCQ section, by structured query on class level, '
  'subject, chapter and difficulty. SECURITY INVOKER: every fence it needs is '
  'already a policy. Returns the shortfall rather than a short paper that '
  'looks complete.';

REVOKE ALL ON FUNCTION public.rpc_fill_paper_section_from_bank(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_fill_paper_section_from_bank(uuid) TO authenticated;

-- ── 2. Push an all-MCQ paper out as an online test ───────────────────────
CREATE OR REPLACE FUNCTION public.rpc_question_paper_to_test(
  _paper_id uuid,
  _section_subject_id uuid,
  _duration_sec integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  pap      public.question_papers%ROWTYPE;
  n_q      int;
  n_bad    int;
  total    numeric;
  new_test uuid;
BEGIN
  SELECT * INTO pap FROM public.question_papers WHERE id = _paper_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your question paper' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), count(*) FILTER (
           WHERE q.options IS NULL OR q.correct_index IS NULL
         ), COALESCE(sum(q.marks), 0)
    INTO n_q, n_bad, total
    FROM public.question_paper_questions q
   WHERE q.paper_id = _paper_id;

  IF n_q = 0 THEN
    RAISE EXCEPTION 'This paper has no questions yet' USING ERRCODE = '22023';
  END IF;

  -- THE RULE. Checked on the QUESTIONS, not on the section headings: a section
  -- labelled 'mcq' whose rows carry a free-text answer would pass a heading
  -- check and produce a test nothing can mark (§10.24 — the app can only
  -- analyse what it holds as structured questions with answers).
  IF n_bad > 0 THEN
    RAISE EXCEPTION
      'Only an all-MCQ paper can be pushed as an online test — % of % question(s) have no options and answer key',
      n_bad, n_q
      USING ERRCODE = '22023';
  END IF;

  -- INSERT runs as the caller, so `tests_insert` decides whether this teacher
  -- may put a test on this section. Nothing is re-stated here.
  INSERT INTO public.tests
    (school_id, section_subject_id, created_by, title, max_mark, total_marks,
     status, test_kind, duration_sec)
  VALUES
    (pap.school_id, _section_subject_id, (SELECT auth.uid()), pap.title,
     total, total, 'draft', 'class_test',
     COALESCE(_duration_sec, pap.duration_minutes * 60))
  RETURNING id INTO new_test;

  INSERT INTO public.test_questions
    (test_id, school_id, order_index, question, options, correct, marks,
     question_format, chapter)
  SELECT new_test, pap.school_id,
         row_number() OVER (ORDER BY s.order_index, q.order_index) - 1,
         q.question, q.options,
         -- A POSITION, not a label. rpc_test_submit compares jsonb equality
         -- against {"indexes":[i]}; all 576 legacy rows stored the label and
         -- could never be marked right (20260914110000).
         jsonb_build_object('indexes', jsonb_build_array(q.correct_index)),
         q.marks, 'mcq', q.chapter
    FROM public.question_paper_questions q
    JOIN public.question_paper_sections s ON s.id = q.section_id
   WHERE q.paper_id = _paper_id;

  RETURN new_test;
END;
$function$;

COMMENT ON FUNCTION public.rpc_question_paper_to_test(uuid, uuid, integer) IS
  'Turns an all-MCQ question paper into a draft test. Refuses any paper with a '
  'question that has no options and answer key — §10.24: the app can only '
  'analyse what it holds as structured questions with answers. SECURITY '
  'INVOKER, so tests_insert decides whether this teacher may put a test on '
  'this section.';

REVOKE ALL ON FUNCTION public.rpc_question_paper_to_test(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_question_paper_to_test(uuid, uuid, integer) TO authenticated;

-- ── Proof, before this commits ───────────────────────────────────────────
--
-- Both functions are SECURITY INVOKER, so this postgres-role block cannot
-- exercise them as a teacher at all — that is probe39's job, and it is the
-- point of them being INVOKER. What is provable here is that they are INVOKER,
-- that anon cannot execute them, and that the bank they read is actually
-- fillable, which is the input assumption the whole feature rests on.
DO $verify$
DECLARE _n int; _pool int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('rpc_fill_paper_section_from_bank','rpc_question_paper_to_test')
     AND p.prosecdef;
  IF _n <> 0 THEN
    RAISE EXCEPTION
      'ROLLED BACK: % of the two paper RPCs is SECURITY DEFINER — it would '
      'bypass qb_select_approved_board, qpq_owner, the tenant fences and '
      'tests_insert all at once', _n;
  END IF;

  SELECT count(*) INTO _n
    FROM information_schema.role_routine_grants
   WHERE routine_schema='public' AND grantee='anon'
     AND routine_name IN ('rpc_fill_paper_section_from_bank','rpc_question_paper_to_test');
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: anon holds EXECUTE on % paper RPC(s)', _n;
  END IF;

  -- The input assumption, asserted rather than believed: there is a class-10
  -- pool the structured filter can actually draw from. If the bank were
  -- unusable this way the whole fill is a no-op that returns success.
  SELECT count(*) INTO _pool
    FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.class_level = 10
     AND qb.chapter IS NOT NULL AND qb.difficulty IS NOT NULL;
  IF _pool = 0 THEN
    RAISE EXCEPTION
      'ROLLED BACK: no class-10 bank row carries both a chapter and a difficulty, '
      'so the structured fill can never return anything';
  END IF;

  RAISE NOTICE 'paper RPCs installed, both SECURITY INVOKER; class-10 structured pool = % row(s).', _pool;
END $verify$;
