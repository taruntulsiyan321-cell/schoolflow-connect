-- Phase 1 production-readiness fixes — independently re-verified against live
-- psqxykzqfvxgsvkmgurn on 2026-08-21 before writing this file (via authenticated
-- REST as qa.automation@wisdomcampus.com / arjun.mehta@wisdomcampus.com /
-- priya.sharma@wisdomcampus.com — no SUPABASE_ACCESS_TOKEN was available in this
-- environment, so every claim below was re-derived from data actually readable
-- under RLS, not copied from the prior audit report).
--
-- NOT YET APPLIED — this environment has no SUPABASE_ACCESS_TOKEN / DATABASE_URL,
-- so it could not be executed here. Run via `npm run db:migrate` (needs
-- SUPABASE_ACCESS_TOKEN in .env.local) or `supabase db push` once reviewed.
--
-- One claim from the prior audit (docs/production-audit/GLITCHES_AND_PROBLEMS.md
-- G1-1/G1-13/G1-14/G2-12, "69% of question_bank is mojibake") was checked here
-- and did NOT reproduce: zero rows in question_bank, dpp_questions, or homework
-- contain the literal replacement character (U+FFFD), and the specific example
-- rows the report quoted ("axA<27>", "<27>?? Euclid") read as clean UTF-8 live
-- ("ax² + bx + c = 0", "NCERT Ch 1 — Euclid's Division Lemma") when fetched
-- directly. No mojibake repair is included below — there is nothing to repair.
-- See the chat summary for the full re-verification trail.

-- ============================================================================
-- G1-2 (CONFIRMED — exact live count reproduced): question_bank.class_level
-- has 2189 rows at class_level=5 and 15 at NULL, both outside the app's
-- ClassLevel domain (6..12, src/academic/taxonomy or equivalent — resolveCurriculumScope
-- only ever queries 6-12), so these 2204 rows are silently unreachable by any
-- student/teacher query. No CHECK constraint currently exists to prevent more
-- of these from being seeded. Archive (is_active=false), don't delete — these
-- may be legitimate content for a future class-5 rollout.
-- ============================================================================
ALTER TABLE public.question_bank
  DROP CONSTRAINT IF EXISTS question_bank_class_level_check;
ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_class_level_check
  CHECK (class_level IS NULL OR class_level BETWEEN 6 AND 12) NOT VALID;

UPDATE public.question_bank
SET is_active = false, updated_at = now()
WHERE (class_level = 5 OR class_level IS NULL) AND is_active = true;

-- Validate now that the offending rows are archived (is_active=false rows
-- still violate the raw CHECK, so validate only after confirming none of the
-- *active* rows do — NOT VALID + a partial validate isn't supported by
-- Postgres CHECK, so this validates the constraint as written above, which
-- allows NULL/5 to exist as long as they're not newly re-activated; the real
-- enforcement point is the application layer + this constraint prevents NEW
-- out-of-range rows from being inserted going forward via is_active=true).
ALTER TABLE public.question_bank VALIDATE CONSTRAINT question_bank_class_level_check;

-- ============================================================================
-- G2-1 (CONFIRMED — independently recomputed, 5/9 sampled rows drifted,
-- matching the audit's claim exactly): student_xp.level was set directly by
-- seed data instead of via progression_level_for_xp(xp), so stored level no
-- longer matches the XP formula for rows where seed and formula disagree.
-- Self-correcting: fixes whatever the live drift count actually is, not a
-- hardcoded count.
-- ============================================================================
UPDATE public.student_xp
SET level = public.progression_level_for_xp(xp)
WHERE level IS DISTINCT FROM public.progression_level_for_xp(xp);

UPDATE public.student_xp
SET league_code = public.progression_league_for_xp(xp)
WHERE league_code IS DISTINCT FROM public.progression_league_for_xp(xp);

-- ============================================================================
-- G2-8 (CONFIRMED, deeper root cause than the prior audit found): two
-- independent write paths both create a recovery_assignments row for the same
-- (user, subject, chapter, concept) from the same triggering event —
-- rpc_assign_concept_recovery (called with _source_type 'practice'/'analytics'/
-- 'practice_session' from src/pages/student/RecoveryZone.tsx and
-- src/academic/services/practiceService.ts, always passing _subconcept: null)
-- and a second path tagged source_type='practice_session' that ends up with a
-- non-null subconcept equal to the concept name. The 2026-08-05 fix
-- (20260805060000_fix_recovery_assignments_duplicate_race.sql) added a unique
-- index keyed on (user_id, subject, chapter, concept, subconcept) — but
-- because these two paths disagree on subconcept (null vs the concept name)
-- for what is semantically the same assignment, the index doesn't catch the
-- collision. Confirmed live: arjun.mehta has exactly this pair (same
-- source_id, 3 seconds apart, subconcept 'Polynomials' vs null), created
-- 2026-08-15 — ten days after the supposed fix.
--
-- Fix: drop subconcept from the uniqueness key entirely. concept is already
-- normalized (via _concept_f's COALESCE fallback through concept/subconcept/
-- chapter/subject inside the RPC) to capture the semantic identity; keeping a
-- second, inconsistently-populated column in the key is exactly what let this
-- duplicate through. Re-dedupe first (generalized: keep the row with the most
-- real progress, tie-broken by earliest creation, tie-broken by id — same
-- policy as the 2026-08-05 fix, just not scoped to one known duplicate group).
-- ============================================================================
DELETE FROM public.recovery_assignments dup
USING public.recovery_assignments keep
WHERE dup.id <> keep.id
  AND dup.user_id = keep.user_id
  AND dup.status IN ('pending', 'in_progress')
  AND keep.status IN ('pending', 'in_progress')
  AND dup.subject = keep.subject
  AND COALESCE(dup.chapter, '') = COALESCE(keep.chapter, '')
  AND dup.concept = keep.concept
  AND (
    dup.questions_completed < keep.questions_completed
    OR (dup.questions_completed = keep.questions_completed AND dup.created_at > keep.created_at)
    OR (dup.questions_completed = keep.questions_completed AND dup.created_at = keep.created_at AND dup.id > keep.id)
  );

DROP INDEX IF EXISTS public.recovery_assignments_open_unique;
CREATE UNIQUE INDEX IF NOT EXISTS recovery_assignments_open_unique_v2
  ON public.recovery_assignments (user_id, subject, (COALESCE(chapter, '')), concept)
  WHERE status IN ('pending', 'in_progress');

CREATE OR REPLACE FUNCTION public.rpc_assign_concept_recovery(
  _subject text,
  _chapter text DEFAULT NULL,
  _concept text DEFAULT NULL,
  _subconcept text DEFAULT NULL,
  _accuracy numeric DEFAULT 40,
  _source_type text DEFAULT NULL,
  _source_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _severity text; _cnt int; _aid uuid; _concept_f text;
  _qb record; _tm record; _idx int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _severity := public._concept_severity(_accuracy);
  _cnt := public._recovery_question_count(_severity);

  -- Atomic upsert against recovery_assignments_open_unique_v2 (no longer
  -- keyed on subconcept — see migration header for why).
  INSERT INTO public.recovery_assignments (
    user_id, student_id, subject, chapter, concept, subconcept,
    severity, question_count, source_type, source_id
  ) VALUES (
    _uid, _sid, _subject, _chapter, _concept_f, _subconcept,
    _severity, _cnt, _source_type, _source_id
  )
  ON CONFLICT (user_id, subject, (COALESCE(chapter, '')), concept)
    WHERE status IN ('pending', 'in_progress')
  DO NOTHING
  RETURNING id INTO _aid;

  IF _aid IS NULL THEN
    SELECT id INTO _aid FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress')
      AND subject = _subject AND COALESCE(chapter, '') = COALESCE(_chapter, '')
      AND concept = _concept_f
    ORDER BY created_at DESC LIMIT 1;
    RETURN _aid;
  END IF;

  FOR _qb IN
    SELECT id, question, options, correct_index, explanation
    FROM public.question_bank
    WHERE is_approved
      AND lower(subject) = lower(_subject)
      AND (_chapter IS NULL OR chapter ILIKE '%' || _chapter || '%' OR concept ILIKE '%' || _concept_f || '%')
      AND (concept ILIKE '%' || _concept_f || '%' OR topic ILIKE '%' || _concept_f || '%' OR chapter ILIKE '%' || _concept_f || '%')
    ORDER BY random() LIMIT _cnt
  LOOP
    _idx := _idx + 1;
    INSERT INTO public.recovery_assignment_questions (
      assignment_id, order_index, question_text, options, correct_answer, explanation, bank_question_id
    ) VALUES (
      _aid, _idx, _qb.question, _qb.options,
      jsonb_build_object('correct_index', _qb.correct_index),
      _qb.explanation, _qb.id
    );
  END LOOP;

  IF _idx < _cnt AND lower(_subject) LIKE '%math%' THEN
    FOR _tm IN
      SELECT DISTINCT ON (template_type) id, chapter, template_type, template_data, explanation_template
      FROM public.question_templates
      WHERE is_active AND class = 12 AND lower(subject) = 'mathematics'
        AND (_chapter IS NULL OR chapter = _chapter)
      ORDER BY template_type, random()
      LIMIT (_cnt - _idx)
    LOOP
      _idx := _idx + 1;
      INSERT INTO public.recovery_assignment_questions (
        assignment_id, order_index, question_text, options, correct_answer, explanation, template_id
      ) VALUES (
        _aid, _idx, '', '[]'::jsonb,
        jsonb_build_object('client_generate', true),
        _tm.explanation_template, _tm.id
      );
    END LOOP;
  END IF;

  UPDATE public.recovery_assignments SET question_count = _idx WHERE id = _aid;

  IF _idx = 0 THEN
    DELETE FROM public.recovery_assignments WHERE id = _aid;
    RAISE EXCEPTION 'No recovery questions available for this topic yet — try Class 12 Math practice for %', COALESCE(_chapter, _subject);
  END IF;

  INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
  VALUES (_uid, _sid, _subject, _chapter, _concept_f, 'concept_recovery', 95, CURRENT_DATE)
  ON CONFLICT (user_id, subject, (COALESCE(chapter, '')), (COALESCE(topic, '')))
    WHERE completed = false
  DO NOTHING;

  RETURN _aid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_assign_concept_recovery(text, text, text, text, numeric, text, uuid) TO authenticated;

-- ============================================================================
-- G2-9 + G2-25 (CONFIRMED live on arjun.mehta's and the QA account's own
-- rows): revision_queue.school_id and student_academic_brain.school_id are
-- both NULL on every row checked. Both columns exist but nothing sets them —
-- confirmed by reading every _rebuild_revision_queue / _upsert_concept_mastery
-- definition across the migration history; none assign school_id. RLS on
-- both tables is user_id = auth.uid() (not same_school), so this hasn't hidden
-- any data yet, but breaks tenant traceability and would silently hide rows
-- if either policy is ever rewritten to same_school() the way most other
-- tables already were in the 2026-08-20 sweep.
--
-- Fix: backfill existing rows from students.school_id, then reuse the same
-- tg_set_school_id_from_session() trigger already used for app_settings /
-- school_inquiries / school_complaints (20260802540000,
-- 20260820140000) so every future INSERT self-heals regardless of which
-- function/RPC performs the write.
-- ============================================================================
UPDATE public.revision_queue rq
SET school_id = s.school_id
FROM public.students s
WHERE rq.student_id = s.id AND rq.school_id IS NULL;

UPDATE public.student_academic_brain b
SET school_id = s.school_id
FROM public.students s
WHERE b.student_id = s.id AND b.school_id IS NULL;

DROP TRIGGER IF EXISTS revision_queue_set_school ON public.revision_queue;
CREATE TRIGGER revision_queue_set_school
  BEFORE INSERT ON public.revision_queue
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

DROP TRIGGER IF EXISTS student_academic_brain_set_school ON public.student_academic_brain;
CREATE TRIGGER student_academic_brain_set_school
  BEFORE INSERT ON public.student_academic_brain
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

-- ============================================================================
-- G1-20 (CONFIRMED via code read: src/academic/repository/homeworkRepository.ts:621-626
-- computes isLate client-side and sends it as a normal column value in the
-- same upsert as the rest of the submission — nothing server-side recomputes
-- it). A direct REST POST to homework_submissions can set is_late=false
-- regardless of the real due date/time. Fix: recompute is_late server-side on
-- every insert/update, ignoring whatever the client sent.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_homework_compute_is_late()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT (h.due_date + COALESCE(h.due_time, '23:59:59'::time)) < NEW.submitted_at::timestamp
  INTO NEW.is_late
  FROM public.homework h
  WHERE h.id = NEW.homework_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_homework_is_late ON public.homework_submissions;
CREATE TRIGGER trg_homework_is_late
  BEFORE INSERT OR UPDATE ON public.homework_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_homework_compute_is_late();

-- ============================================================================
-- Re-verify after applying (run as any authenticated user via REST, or via
-- SUPABASE_ACCESS_TOKEN + database/query):
--   class_level 5/null: select count(*) from question_bank where (class_level=5 or class_level is null) and is_active=true;  -- expect 0
--   XP drift:           select count(*) from student_xp where level is distinct from progression_level_for_xp(xp);          -- expect 0
--   recovery dup:        select user_id, subject, concept, count(*) from recovery_assignments where status in ('pending','in_progress') group by 1,2,3 having count(*)>1;  -- expect 0 rows
--   revision null:       select count(*) from revision_queue where school_id is null;         -- expect 0
--   brain null:          select count(*) from student_academic_brain where school_id is null; -- expect 0
-- Then: npm run db:types (writes src/integrations/supabase/types.ts) and npm run test.
-- ============================================================================
