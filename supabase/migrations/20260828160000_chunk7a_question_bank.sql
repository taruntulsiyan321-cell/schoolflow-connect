-- =====================================================================
-- CHUNK 7A — QUESTION BANK AND CURRICULUM
--
-- Scope is the split table's 7A row only: the question bank, topics,
-- chapter keying, tags and the board/class filter. No practice tables, no
-- chapter_tally, no recovery or revision — those are 7B and 7C. The doc's
-- 7A section body still contains them because only its heading was split.
--
-- This is a CONVERGENCE, not a greenfield. The doc describes `questions`;
-- the live table is `question_bank` with 21,696 rows and a different
-- shape. Nothing here creates a question bank; it makes the existing one
-- match what §10.10 and G2 already decided.
--
-- WHAT WAS MEASURED FIRST
--   21,696 questions, every one gradable (correct_index populated)
--   21,681 keyed on chapter_id; 15 not
--   the SAME 15 are the only rows with a NULL class_level
--   0 rows with a NULL board
--   50 rows with school_id, all source='seed', one school
--   11,917 distinct free-text topic strings — §10.10's evidence, intact
--   665 chapters, 0 near-duplicate names within a subject
-- =====================================================================

-- ---------------------------------------------------------------------
-- SECTION 1 — retire the 15 questions that cannot be keyed
--
-- Their chapter text is Civics, General, Grammar, Vocabulary, Web and the
-- like: subject-level or non-curricular labels, not chapters. §10.10 makes
-- chapter the stable unit and says everything downstream keys on
-- chapter_id, so a question without one can never be selected, tracked or
-- analysed. They are retired rather than deleted — a retired question may
-- still sit in a student's mistake book, and deleting it would remove
-- something they actually got wrong.
--
-- These same 15 are the only rows with a NULL class_level, so retiring
-- them is also what makes Section 4's invariant satisfiable.
-- ---------------------------------------------------------------------
UPDATE public.question_bank
   SET is_active = false
 WHERE chapter_id IS NULL
   AND is_active;

-- ---------------------------------------------------------------------
-- SECTION 2 — the bank is global
--
-- G2 lists the question bank among the shared tables that carry no
-- institution scope, and 7A repeats it: "Shared across every school. No
-- institution_id." The column existed anyway, populated on 50 rows — all
-- source='seed', all one school. Demo seed content, not school-authored
-- material, so making it global exposes nothing real.
--
-- Checked before dropping: no view, no foreign key, and neither of the two
-- SECURITY DEFINER functions that read this table use question_bank's
-- school_id — rpc_dpp_pick_from_bank and rpc_generate_battle both take
-- school_id from dpps and battles respectively.
--
-- Four client call sites DO reference it (practiceService.ts) and are
-- updated in the same change. PostgREST would fail at runtime on a column
-- that no longer exists, and no type check would have caught it because
-- the predicate is a string.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS qb_select_approved_board ON public.question_bank;
DROP POLICY IF EXISTS qb_staff_manage          ON public.question_bank;
DROP POLICY IF EXISTS qb_teacher_insert        ON public.question_bank;

ALTER TABLE public.question_bank DROP COLUMN IF EXISTS school_id;

-- ---------------------------------------------------------------------
-- SECTION 3 — question lineage
--
-- Required by 7A's own schema even though the generator that fills them is
-- 7C: a rewrite creates a NEW question and retires the old one rather than
-- overwriting in place, and recovery generates variants of a student's own
-- wrong questions. Both need somewhere to record what a question came from.
-- ---------------------------------------------------------------------
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS source_question_id     uuid REFERENCES public.question_bank(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaced_by_question_id uuid REFERENCES public.question_bank(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_tier            smallint;

ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS question_bank_variant_tier_check;
ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_variant_tier_check
  CHECK (variant_tier IS NULL OR variant_tier IN (1, 2));

-- A question cannot be its own source or its own replacement.
ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS question_bank_no_self_lineage;
ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_no_self_lineage
  CHECK (source_question_id IS DISTINCT FROM id AND replaced_by_question_id IS DISTINCT FROM id);

CREATE INDEX IF NOT EXISTS question_bank_source_idx ON public.question_bank (source_question_id);

COMMENT ON COLUMN public.question_bank.variant_tier IS
  'Recovery variant tier, 1 or 2 (spec 4.2a). NULL for an ordinary bank question. A variant is an ordinary question that records what it was derived from.';

-- ---------------------------------------------------------------------
-- SECTION 4 — an active question must be keyed
--
-- §10.10: "Everything downstream — mistake book, custom sessions,
-- analysis — keys on chapter_id." Today that is true of the data and false
-- of the schema: nothing stopped an unkeyed question being active, and 15
-- were. This makes the rule structural rather than incidental, so the next
-- import cannot quietly reintroduce them.
--
-- class_level is included because it is what stops a Class 5 student being
-- served Class 8 content, and the same 15 rows were the only ones missing
-- it.
-- ---------------------------------------------------------------------
ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS question_bank_active_must_be_keyed;
ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_active_must_be_keyed
  CHECK (NOT is_active OR (chapter_id IS NOT NULL AND class_level IS NOT NULL));

-- ---------------------------------------------------------------------
-- SECTION 5 — question_reports
--
-- "Goes to the AI and super admin. Never to the school." So it carries no
-- institution scope and no school-side reader: not admin, not principal,
-- not teacher. Anyone signed in may file one, because the report control
-- sits in the practice UI and practice is the student's own.
--
-- The reporter CAN read their own report back, and nothing else. That is
-- not a widening of "never to the school" — a student is not the school,
-- and practice is theirs. It was added after the verification found a
-- concrete reason: PostgreSQL evaluates SELECT policies on the new row
-- when a statement uses RETURNING, so with no read arm at all,
-- `INSERT ... RETURNING id` fails with 42501 — and supabase-js emits
-- exactly that shape whenever a caller chains .select() onto .insert().
-- Filing a report would have failed from the UI while passing every
-- policy test that did not use RETURNING.
--
-- Teacher, principal and admin still read nothing here. That is the rule
-- the doc actually states, and it is unchanged.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.question_reports (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id             uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  reported_by_account_id  uuid NOT NULL,
  reason                  text NOT NULL,
  body                    text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS question_reports_question_idx ON public.question_reports (question_id);

ALTER TABLE public.question_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS question_reports_insert ON public.question_reports;
CREATE POLICY question_reports_insert ON public.question_reports
  FOR INSERT TO authenticated
  WITH CHECK (reported_by_account_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS question_reports_own_read ON public.question_reports;
CREATE POLICY question_reports_own_read ON public.question_reports
  FOR SELECT TO authenticated
  USING (reported_by_account_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS question_reports_super_read ON public.question_reports;
CREATE POLICY question_reports_super_read ON public.question_reports
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()));

COMMENT ON TABLE public.question_reports IS
  'Chunk 7A. Question quality reports from the practice UI. Global (G2): no institution scope, and no school-side reader — the report goes to the AI and super admin, never to the school, because practice is private to the student.';

-- ---------------------------------------------------------------------
-- SECTION 6 — question_bank policies, in the pattern
--
-- Per docs/rls-policy-pattern.md: no per-row helper calls, every
-- argument-free call hoisted into (SELECT ...), and no permissive FOR ALL
-- on a table that is read — the old qb_staff_manage was FOR ALL, so every
-- reader paid the staff check before reaching their own arm.
--
-- The board filter is PRESERVED exactly and stays in the policy. Note it
-- is not redundant with the client query: the client filter protects the
-- practice path, this protects every other path.
--
-- No tenant fence: this table is global by G2, and adding one would be the
-- error G2 exists to prevent.
-- ---------------------------------------------------------------------
CREATE POLICY qb_select_approved_board ON public.question_bank
  FOR SELECT TO authenticated
  USING (
    is_approved
    AND (
      board IS NULL
      OR board = 'both'
      OR board = (SELECT s.board FROM public.schools s WHERE s.id = (SELECT public.get_my_school_id()))
    )
  );

CREATE POLICY qb_staff_read ON public.question_bank
  FOR SELECT TO authenticated
  USING ((SELECT public.is_principal_or_admin(auth.uid()))
      OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role)));

CREATE POLICY qb_staff_insert ON public.question_bank
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_principal_or_admin(auth.uid()))
           OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role)));

CREATE POLICY qb_staff_update ON public.question_bank
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_principal_or_admin(auth.uid()))
      OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role)))
  WITH CHECK ((SELECT public.is_principal_or_admin(auth.uid()))
           OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role)));

CREATE POLICY qb_staff_delete ON public.question_bank
  FOR DELETE TO authenticated
  USING ((SELECT public.is_principal_or_admin(auth.uid()))
      OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role)));

-- ---------------------------------------------------------------------
-- SECTION 7 — topics
--
-- The table already exists, correctly global, with the right shape, and
-- holds ZERO rows. That is not an oversight to fix here: §10.10 decided
-- the 11,917 free-text topic strings are a per-question descriptor and not
-- a taxonomy, so seeding topics from them is exactly what it forbids.
-- topics fills as teachers add them (§10.22), one chapter at a time.
--
-- Only the FOR ALL super-admin policy is split, so a read stops paying it.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS topics_write_super ON public.topics;

CREATE POLICY topics_update_super ON public.topics
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_super_admin())) WITH CHECK ((SELECT public.is_super_admin()));

CREATE POLICY topics_delete_super ON public.topics
  FOR DELETE TO authenticated
  USING ((SELECT public.is_super_admin()));

DROP POLICY IF EXISTS topics_read ON public.topics;
CREATE POLICY topics_read ON public.topics
  FOR SELECT TO authenticated
  USING (true);

COMMENT ON TABLE public.topics IS
  'Chunk 7A. Teacher-curated topics within a chapter (10.22). Deliberately EMPTY at rest: 10.10 decided the question bank''s 11,917 free-text topic strings are a per-question descriptor, not a taxonomy, so this is never seeded from them. It grows as teachers add topics to a chapter.';

-- ---------------------------------------------------------------------
-- SECTION 8 — the two SECURITY DEFINER paths that bypass the board filter
--
-- THE FINDING. 7A's verification asks: "A Class 5 CBSE student cannot be
-- served a Class 8 or ICSE question. Prove the filter is in the query."
-- It is — in the practice path. practiceService filters class_level and
-- board explicitly and fails closed ("Never dump all classes when we
-- cannot resolve the student's class" returns []).
--
-- But two RPCs read the bank as SECURITY DEFINER, so qb_select_approved_
-- board never runs for them, and neither reproduces it:
--
--   rpc_dpp_pick_from_bank   no board filter, NO class filter at all
--   rpc_generate_battle      no board filter; class filter passes whenever
--                            either side is NULL
--
-- This is the Nova shape exactly — policies correct, data reachable
-- through a door policy-level auditing does not see. A Class 5 DPP could
-- draw Class 12 questions today.
--
-- Both are given the board predicate the policy uses, verbatim. The class
-- filter is handled differently in each because the two tables carry
-- different information, and neither is guessed at:
--
--   battles already store class_level as an integer, so the fix is to stop
--   treating NULL on either side as "matches anything".
--
--   dpps store class_id, not class_level, so the level is resolved through
--   the curriculum tree — the path 10.10 defines — and every one of the 8
--   curriculum_classes labels matches '^Class [0-9]+$', so the parse is
--   deterministic rather than a guess. If it cannot be resolved the
--   function RAISES rather than serving every class, matching the
--   fail-closed guard the practice path already uses.
--
-- The q.class_level IS NULL escape arm is dropped because after Section 1
-- no active question has a NULL class_level, and Section 4 forbids one.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_dpp_pick_from_bank(_dpp_id uuid, _count integer DEFAULT 5, _difficulty text DEFAULT NULL::text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _d record; _n int := 0; _start int; _board text; _level int;
BEGIN
  SELECT * INTO _d FROM public.dpps WHERE id = _dpp_id;
  IF _d IS NULL THEN RAISE EXCEPTION 'DPP not found'; END IF;
  IF NOT (teacher_teaches_class(auth.uid(), _d.class_id) OR has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT s.board INTO _board FROM public.schools s WHERE s.id = _d.school_id;

  SELECT NULLIF(regexp_replace(cc.label, '\D', '', 'g'), '')::int
    INTO _level
    FROM public.classes c
    JOIN public.class_groups g        ON g.id = c.class_group_id
    JOIN public.curriculum_classes cc ON cc.id = g.curriculum_class_id
   WHERE c.id = _d.class_id;

  -- Fail closed. Serving every class because the level could not be
  -- resolved is the failure this filter exists to prevent.
  IF _level IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve the class level for section %, so questions cannot be drawn safely', _d.class_id;
  END IF;

  SELECT COALESCE(MAX(order_index)+1, 0) INTO _start FROM public.dpp_questions WHERE dpp_id = _dpp_id;

  WITH picked AS (
    SELECT question, options, correct_index, explanation
    FROM public.question_bank
    WHERE is_approved
      AND is_active
      AND class_level = _level
      AND (board IS NULL OR board = 'both' OR board = _board)
      AND lower(subject) = lower(_d.subject)
      AND (_d.chapter IS NULL OR chapter ILIKE _d.chapter)
      AND (_difficulty IS NULL OR difficulty = _difficulty)
    ORDER BY random() LIMIT GREATEST(_count,1)
  ), ins AS (
    INSERT INTO public.dpp_questions (dpp_id, order_index, kind, question, options, correct, marks, explanation, school_id)
    SELECT _dpp_id, _start + (row_number() OVER ()) - 1, 'mcq'::dpp_question_kind,
           question, options, jsonb_build_object('indexes', jsonb_build_array(correct_index)),
           1, explanation, _d.school_id
    FROM picked
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM ins;

  UPDATE public.dpps SET
    question_count = (SELECT count(*) FROM public.dpp_questions WHERE dpp_id = _dpp_id),
    total_marks = (SELECT COALESCE(SUM(marks),0) FROM public.dpp_questions WHERE dpp_id = _dpp_id)
  WHERE id = _dpp_id;
  RETURN _n;
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_generate_battle(_battle_id uuid, _count integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _b   record;
  _uid uuid := auth.uid();
  _inserted int := 0;
  _board text;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;
  IF _b.creator_user_id <> _uid
     AND NOT has_role(_uid,'admin') AND NOT has_role(_uid,'teacher')
     AND NOT (
       coalesce(_b.source, '') LIKE 'featured_%'
       AND _b.class_id IS NOT NULL
       AND public.student_class_id(_uid) IS NOT DISTINCT FROM _b.class_id
     ) THEN
    RAISE EXCEPTION 'Not your battle';
  END IF;

  SELECT s.board INTO _board FROM public.schools s WHERE s.id = _b.school_id;

  IF _b.class_level IS NULL THEN
    RAISE EXCEPTION 'Battle % has no class level, so questions cannot be drawn safely', _battle_id;
  END IF;

  WITH pool AS (
    SELECT q.id, q.question, q.options, q.correct_index, q.difficulty,
           COALESCE(h.times_seen, 0) AS seen,
           COALESCE(h.last_seen_at, 'epoch'::timestamptz) AS last_seen
    FROM public.question_bank q
    LEFT JOIN public.student_question_history h
      ON h.question_id = q.id AND h.user_id = _uid
    WHERE q.is_approved
      AND q.is_active
      AND q.class_level = _b.class_level
      AND (q.board IS NULL OR q.board = 'both' OR q.board = _board)
      AND lower(q.subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR q.chapter ILIKE _b.chapter)
      AND (_b.topic IS NULL OR q.topic ILIKE _b.topic)
  ), picked AS (
    SELECT id, question, options, correct_index FROM pool
    ORDER BY seen ASC,
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC,
      last_seen ASC, random()
    LIMIT GREATEST(_count, 1)
  ), ins AS (
    INSERT INTO public.battle_questions
      (battle_id, order_index, question, options, correct_index, points, bank_question_id, school_id)
    SELECT _battle_id, row_number() OVER () - 1, question, options, correct_index, 10, id, _b.school_id
    FROM picked RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  UPDATE public.battles
    SET
      source = CASE
        WHEN nullif(trim(source), '') IS NULL THEN 'bank'
        ELSE source
      END,
      question_count = _inserted,
      duration_sec = per_question_sec * _inserted
    WHERE id = _battle_id;
  RETURN _inserted;
END $function$;


INSERT INTO public.schema_migrations (version)
VALUES ('20260828160000_chunk7a_question_bank')
ON CONFLICT DO NOTHING;
