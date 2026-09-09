-- ═══════════════════════════════════════════════════════════════════════════
-- The semantic path ranks the same pool it always filtered (§5, §10.9, G14)
--
-- `20260916050000` said this in its own header, and this migration is that
-- promise kept:
--
--     "The semantic path earns its place when a teacher types a free text
--      topic that matches no chapter label, and that is a widening of this
--      function once `embed` is reachable — not a different function."
--
-- `rpc_fill_paper_section_from_bank` now takes an optional ordered list of bank
-- ids. Given one, it draws from those ids IN THAT ORDER; given none, it behaves
-- exactly as before. Same filters, same de-duplication, same shortfall, same
-- insert. One function, two ways of choosing which questions come first.
--
-- ── WHY IDS AND NOT A VECTOR ────────────────────────────────────────────
--
-- The obvious shape was `_query_embedding vector`, with the client fetching an
-- embedding and passing it in. Three reasons it is not that:
--
--   1. `match_question_bank` is called by `ai-gateway` with the SERVICE ROLE,
--      which bypasses RLS — the function re-states the board test internally
--      precisely because of that. The gateway is where the embedding already
--      lives (`resolveQueryEmbedding` → `embedQueryText`), so there is no
--      reason to move a vector through the browser to get it back to Postgres.
--   2. A 1536-float vector is ~30KB of JSON per fill, each way.
--   3. The ids are checked again here. The gateway's match ran as service_role
--      and applied class level, board and subject; THIS function re-applies
--      every one of the section's own filters — subject, chapter, difficulty,
--      class level, board, and not-already-in-this-paper — as the CALLER.
--      A semantic suggestion cannot widen what the teacher may retrieve; it can
--      only reorder it. That is the belt-and-braces the rest of this schema
--      uses, and it is what stops a service-role ranking from becoming a
--      service-role read.
--
-- ── WHAT `match_question_bank` DOES NOT DO ──────────────────────────────
--
-- It has no chapter filter and no exclusion list — measured, its body filters
-- `embed_status`, `is_active`, approval-or-authorship, `class_level`, board,
-- subjects and the similarity threshold, and nothing else. So the ids it
-- returns are candidates, not answers, and the caller must ask for more of them
-- than it needs. That is why the client requests a multiple of the shortfall.
--
-- ── THE OLD SIGNATURE IS DROPPED, NOT LEFT BESIDE THIS ONE ──────────────
--
-- Adding a parameter with a DEFAULT creates a second overload rather than
-- replacing the first, and PostgREST then cannot choose: `probe14` has already
-- watched a call fail as AMBIGUOUS rather than as missing. The one-argument
-- form is dropped first, and calls that pass one argument keep working through
-- the default.
--
-- Rollback: supabase/migrations/rollback/
--           20260916090000_the_semantic_path_ranks_the_same_pool_it_always_filtered.rollback.sql
-- Assertion: verification/caller-privileges/probe41.sql
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.rpc_fill_paper_section_from_bank(uuid);

CREATE OR REPLACE FUNCTION public.rpc_fill_paper_section_from_bank(
  _section_id uuid,
  _bank_ids uuid[] DEFAULT NULL
)
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
    RAISE EXCEPTION 'This paper is final — reopen it before changing its questions'
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
  -- it — every structural filter below applies in both paths.
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
             -- used. `random()` is deliberately absent from both — a fill that
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
    'ranked_candidates', CASE WHEN semantic THEN cardinality(_bank_ids) ELSE 0 END
  );
END;
$function$;

COMMENT ON FUNCTION public.rpc_fill_paper_section_from_bank(uuid, uuid[]) IS
  'Bank-first fill for one MCQ section. Given an ordered list of bank ids it '
  'draws from those in that order (the semantic path); given none it uses the '
  'deterministic chapter round-robin. Either way it re-applies every one of the '
  'section''s own filters as the CALLER, so a service-role ranking can reorder '
  'what a teacher retrieves but never widen it.';

REVOKE ALL ON FUNCTION public.rpc_fill_paper_section_from_bank(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_fill_paper_section_from_bank(uuid, uuid[]) TO authenticated;

-- ── Proof, before this commits ───────────────────────────────────────────
DO $verify$
DECLARE _n int; _dims int;
BEGIN
  -- Exactly ONE overload. Two is the ambiguity probe14 already watched break a
  -- call, and it would break the structured fill that ships today.
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_fill_paper_section_from_bank';
  IF _n <> 1 THEN
    RAISE EXCEPTION
      'ROLLED BACK: % overload(s) of rpc_fill_paper_section_from_bank — PostgREST '
      'cannot choose between them', _n;
  END IF;

  -- Still SECURITY INVOKER. A definer here would bypass qb_select_approved_board
  -- and the paper''s own fences, which is the entire reason the ids are
  -- re-filtered rather than trusted.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='rpc_fill_paper_section_from_bank'
       AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the fill became SECURITY DEFINER';
  END IF;

  -- The semantic branch must still filter, not just order. If `_bank_ids` ever
  -- became the only predicate, a service-role ranking would decide what a
  -- teacher may read.
  IF (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='rpc_fill_paper_section_from_bank')
     NOT LIKE '%qb.subject = pap.subject%' THEN
    RAISE EXCEPTION 'ROLLED BACK: the candidate pool no longer restates the section''s own filters';
  END IF;

  -- The embedding column the whole path depends on. A dimension change would
  -- make every `<=>` throw, and the failure would look like "no matches".
  SELECT vector_dims(embedding) INTO _dims
    FROM public.question_bank WHERE embedding IS NOT NULL LIMIT 1;
  IF _dims IS NULL OR _dims <> 1536 THEN
    RAISE EXCEPTION
      'ROLLED BACK: question_bank.embedding is % dimensions, not the 1536 the '
      'embedding provider produces', coalesce(_dims::text, 'absent');
  END IF;

  RAISE NOTICE 'semantic fill installed: one overload, invoker, filters restated, 1536-dim embeddings present.';
END $verify$;
