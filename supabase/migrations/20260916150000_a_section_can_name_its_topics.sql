-- ═══════════════════════════════════════════════════════════════════════════
-- A section can name its topics (§5, §10.9, rule 31)
--
-- `20260916130000` gave every banked question a `topic_group` -- a canonical
-- topic per (subject, chapter), so the same teachable topic stopped appearing
-- under thirty spellings. Nothing read it. This is the reader.
--
-- ── WHAT RULE 31 ACTUALLY PERMITS, AND WHAT IT STILL REFUSES ─────────────
--
-- Rule 31 says topic is not a selection or analysis unit, and defers a
-- canonical taxonomy "until the bank has grown through write-back". Its
-- parenthetical is precise about the limit of that:
--
--     "This rule does not remove topic as a stored tag or as a filter where
--      one is already supplied -- it rules that nothing may INVENT one, and
--      that selection and analysis surfaces key on chapter and subject."
--
-- A teacher TYPING a topic they chose is a filter that is already supplied.
-- Nothing here invents a topic, guesses one, or moves any student-facing
-- analysis to topic level.
--
-- And the deferral still stands where it was aimed. Rule 31 wants 15-20
-- questions per topic before topic can carry analysis, "or one bad day reads
-- as a weakness". Measured 2026-09-10 across the grouped bank:
--
--     topic groups                      10,273
--     questions per group, MEDIAN          1.0
--     groups with 15 or more                86
--     singletons                         6,379   (62% of all groups)
--     questions sitting in a group of 15+  10.9%
--
-- So the grouping made the vocabulary CONSISTENT; it did not make it DENSE.
-- Consistency is what a filter needs -- a teacher asking for
-- `taddhit_pratyay` now gets all 51 questions instead of needing to know
-- thirty spellings. Density is what analysis needs, and the bank does not
-- have it yet. Analysis stays at chapter and subject, exactly as ruled.
--
-- ── THE CHANGE ───────────────────────────────────────────────────────────
--
-- `question_paper_sections.topics text[]`, mirroring `chapters` in shape,
-- default and meaning: EMPTY MEANS NO NARROWING, never "no topics". The fill
-- gains one predicate beside the chapter one and is otherwise untouched --
-- same pool definition for the count and the pick, same deterministic
-- ordering, same refusal to use `random()`.
--
-- Also repairs mojibake in two teacher-visible strings. The deployed body
-- carried a replacement character where an em dash belonged, in the message
-- shown when a finalised paper is edited. This file is ASCII-only so it
-- cannot reintroduce it.
--
-- Rollback: supabase/migrations/rollback/
--           20260916150000_a_section_can_name_its_topics.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.question_paper_sections
  ADD COLUMN IF NOT EXISTS topics text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.question_paper_sections.topics IS
  'Canonical topics (question_bank.topic_group) this section draws on. EMPTY '
  'MEANS THE WHOLE CHAPTER SET, never "no topics" -- same convention as '
  'chapters. Supplied by the teacher; never inferred (rule 31).';

CREATE OR REPLACE FUNCTION public.rpc_fill_paper_section_from_bank(
  _section_id uuid,
  _bank_ids   uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
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
  semantic  boolean := _bank_ids IS NOT NULL AND cardinality(_bank_ids) > 0;
BEGIN
  SELECT * INTO sec FROM public.question_paper_sections WHERE id = _section_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your question paper section' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO pap FROM public.question_papers WHERE id = sec.paper_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your question paper' USING ERRCODE = '42501';
  END IF;

  IF pap.status <> 'draft' THEN
    RAISE EXCEPTION 'This paper is final - reopen it before changing its questions'
      USING ERRCODE = '22023';
  END IF;

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

  -- ONE statement, ONE definition of the candidate pool, used for both the
  -- count and the pick. The semantic list narrows that pool; it never widens
  -- it - every structural filter below applies in both paths.
  --
  -- `wanted` may be 0 (the section is already full). `LIMIT 0` then picks
  -- nothing and the INSERT inserts nothing, while the pool is still counted,
  -- so there is no second copy of this query behind an IF.
  WITH candidates AS (
    SELECT qb.id, qb.question, qb.options, qb.correct_index, qb.explanation, qb.chapter,
           CASE WHEN semantic THEN array_position(_bank_ids, qb.id) END AS rank_ix,
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
       -- The topic narrowing. Empty means the whole chapter set, exactly as
       -- an empty `chapters` means the whole subject. A row whose topic_group
       -- is NULL -- not yet classified -- is excluded only when the teacher
       -- actually named topics, so an unclassified bank still fills normally.
       AND (cardinality(sec.topics) = 0 OR qb.topic_group = ANY (sec.topics))
       AND (sec.difficulty IS NULL OR qb.difficulty = sec.difficulty)
       AND (NOT semantic OR qb.id = ANY (_bank_ids))
       AND NOT EXISTS (
             SELECT 1 FROM public.question_paper_questions q
              WHERE q.paper_id = sec.paper_id AND q.bank_id = qb.id)
  ), ordered AS (
    SELECT c.*,
           row_number() OVER (
             -- Semantic rank first when there is one; otherwise the
             -- deterministic chapter round-robin the structured path has always
             -- used. `random()` is deliberately absent from both - a fill that
             -- cannot be repeated cannot be tested.
             ORDER BY c.rank_ix NULLS LAST,
                      c.rn_in_chapter,
                      c.chapter,
                      md5(c.id::text || _section_id::text)
           ) AS pick_ix
      FROM candidates c
  ), picked AS (
    SELECT * FROM ordered ORDER BY pick_ix LIMIT wanted
  ), ins AS (
    INSERT INTO public.question_paper_questions
      (paper_id, section_id, school_id, order_index, origin, bank_id,
       question, options, correct_index, explanation, chapter, marks)
    SELECT sec.paper_id, _section_id, sec.school_id,
           next_ix + (p.pick_ix - 1)::int, 'retrieved', p.id,
           p.question, p.options, p.correct_index, p.explanation, p.chapter,
           sec.marks_per_question
      FROM picked p
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM candidates), (SELECT count(*) FROM ins)
    INTO pool, inserted;

  RETURN jsonb_build_object(
    'section_id', _section_id,
    'target_count', sec.target_count,
    'already_present', present,
    'requested', wanted,
    'pool_size', pool,
    'inserted', inserted,
    'shortfall', GREATEST(wanted - inserted, 0),
    -- Which path chose these. A teacher who asked for a semantic fill and
    -- silently got the structured one has been told something false about
    -- their own paper.
    'strategy', CASE WHEN semantic THEN 'semantic' ELSE 'structured' END,
    'ranked_candidates', CASE WHEN semantic THEN cardinality(_bank_ids) ELSE 0 END,
    -- So a teacher can see the narrowing was applied, and a shortfall of zero
    -- pool is legible as "no questions carry that topic yet" rather than as a
    -- silent empty section.
    'topics_requested', cardinality(sec.topics)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_fill_paper_section_from_bank(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_fill_paper_section_from_bank(uuid, uuid[]) TO authenticated;

-- ── Proof, before this commits ────────────────────────────────────────────
-- Runs as `postgres`, so it proves the PREDICATE, not the fence. It writes
-- nothing: it evaluates the candidate filter three ways over live rows.
DO $verify$
DECLARE
  s_subject text; s_class int; s_chapter text; s_topic text;
  n_no_topic int; n_real_topic int; n_bogus_topic int;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='question_paper_sections'
         AND column_name='topics') <> 1 THEN
    RAISE EXCEPTION 'verify: topics column missing';
  END IF;

  -- A real (subject, chapter, topic_group) that has approved active rows.
  SELECT qb.subject, qb.class_level, qb.chapter, qb.topic_group
    INTO s_subject, s_class, s_chapter, s_topic
    FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.topic_group IS NOT NULL
   GROUP BY 1,2,3,4
  HAVING count(*) >= 2
   LIMIT 1;

  IF s_topic IS NULL THEN
    RAISE EXCEPTION 'verify: no classified fixture -- run scripts/classify-question-topics.mjs --apply first';
  END IF;

  SELECT count(*) INTO n_no_topic
    FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.class_level = s_class
     AND qb.subject = s_subject AND qb.chapter = s_chapter
     AND (cardinality(ARRAY[]::text[]) = 0 OR qb.topic_group = ANY (ARRAY[]::text[]));

  SELECT count(*) INTO n_real_topic
    FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.class_level = s_class
     AND qb.subject = s_subject AND qb.chapter = s_chapter
     AND qb.topic_group = ANY (ARRAY[s_topic]);

  SELECT count(*) INTO n_bogus_topic
    FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.class_level = s_class
     AND qb.subject = s_subject AND qb.chapter = s_chapter
     AND qb.topic_group = ANY (ARRAY['__no_such_topic__']);

  -- It narrows.
  IF NOT (n_real_topic < n_no_topic) THEN
    RAISE EXCEPTION 'verify: naming a topic did not narrow the pool (% of %)',
      n_real_topic, n_no_topic;
  END IF;
  -- It still returns the questions that DO carry the topic. Without this a
  -- predicate that matched nothing at all would pass the line above.
  IF n_real_topic < 2 THEN
    RAISE EXCEPTION 'verify: naming a real topic returned % rows -- too tight', n_real_topic;
  END IF;
  -- And an unknown topic returns nothing rather than everything.
  IF n_bogus_topic <> 0 THEN
    RAISE EXCEPTION 'verify: an unknown topic matched % rows', n_bogus_topic;
  END IF;

  RAISE NOTICE 'verify OK: chapter=% topic=% -> pool % narrowed to %, unknown topic 0',
    s_chapter, s_topic, n_no_topic, n_real_topic;
END
$verify$;
