-- ═══════════════════════════════════════════════════════════════════════════
-- THE SYLLABUS IS THE FENCE WHEREVER THE BANK IS READ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KNOWN_ISSUES 104. Which bank questions an exam account may be served was
-- decided in two places that disagreed:
--
--   question_bank_student (the view)   its exam arm fenced by EXAM only
--   _student_bank_pool                 the view, then the stream's syllabus
--                                      (exam_syllabus_chapters) on top
--
-- The practice catalog and the mock paper builder go through the pool, so they
-- never served an off-syllabus question. Everything that reads the view
-- directly could: the bank queries in practiceService, the Mistake Book's
-- askability check, useWeakChapters. Measured 2026-09-29/30: two ACTIVE CUET
-- questions sat outside every CUET syllabus — both in "Accounting Process",
-- class-11 material (journal, ledger) that the NTA CUET Accountancy syllabus
-- does not list — and two accounts had answered them.
--
-- RULED (the owner, 2026-10-01: "fix everything"; the consistent answer
-- KNOWN_ISSUES 104 named):
--
--   1. The syllabus is the fence, and it has ONE home: the view. Its exam arm
--      now admits only a chapter in the caller's own exam AND stream syllabus.
--      The pool keeps the view's answer and no longer restates the syllabus.
--      A question with no chapter is outside every syllabus and is not served
--      to an exam account (the two such CUET rows are inactive today).
--   2. An exam question outside its exam's syllabus is not an exam question.
--      "Accounting Process" is not in the CUET syllabus, so its active CUET
--      questions are retired — as 20261090000000 retired the class-11 seed
--      questions the syllabus does not cover. A mistake already made on one
--      becomes what a mistake on any retired question is (KNOWN_ISSUES 91):
--      kept in the book, not asked again — and recovery, which plans only
--      questions a student can be shown (20261117000000), agrees.
--
-- What does not change, and the proof holds it to that: every exam account's
-- pool (so its catalog and its mock papers) is identical before and after, and
-- a school student's view and pool are identical before and after.
--
-- ROLLBACK: rollback/20261129000000_the_syllabus_is_the_fence_wherever_the_bank_is_read.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE public.routines_pre_20261129000000 (
  object text PRIMARY KEY,
  definition text NOT NULL
);
ALTER TABLE public.routines_pre_20261129000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261129000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261129000000 IS
  'Rollback source for 20261129000000: the view and the pool as they were, and the questions it retired (object retired:<id>). No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';
INSERT INTO public.routines_pre_20261129000000 (object, definition) VALUES
  ('view:public.question_bank_student', pg_get_viewdef('public.question_bank_student'::regclass, true)),
  ('public._student_bank_pool(integer,text)', pg_get_functiondef('public._student_bank_pool(integer,text)'::regprocedure));

-- ── Before, as each reader ─────────────────────────────────────────────────
-- Every exam account, and one school student, by what the pool and the view
-- serve them. md5 over sorted ids: identical means identical.
CREATE TEMP TABLE _readers ON COMMIT DROP AS
SELECT ea.account_id AS uid, true AS exam FROM public.exam_accounts ea
UNION ALL
SELECT u.id, false FROM auth.users u WHERE u.email = 'arjun.mehta@wisdomcampus.com';

CREATE TEMP TABLE _seen (uid uuid, phase text, pool_h text, pool_n int, view_h text, view_off int) ON COMMIT DROP;

CREATE FUNCTION pg_temp.look(_phase text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r record; _ph text; _pn int; _vh text; _vo int; _lvl int;
BEGIN
  FOR r IN SELECT * FROM _readers LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
    -- A school student's pool is read at their class; an exam account's takes none.
    SELECT NULLIF(substring(c.name FROM '[0-9]+'), '')::int INTO _lvl FROM public.students s
      JOIN public.classes c ON c.id = s.class_id
     WHERE s.user_id = r.uid LIMIT 1;
    SELECT md5(COALESCE(string_agg(p.id::text, ',' ORDER BY p.id), '')), count(*)
      INTO _ph, _pn
      FROM public._student_bank_pool(CASE WHEN r.exam THEN NULL ELSE _lvl END, NULL) p;
    SET LOCAL ROLE authenticated;
    SELECT md5(COALESCE(string_agg(v.id::text, ',' ORDER BY v.id), '')),
           count(*) FILTER (WHERE v.exam_id IS NOT NULL
                              AND (v.chapter_id IS NULL OR NOT EXISTS (
                                    SELECT 1 FROM public.exam_syllabus_chapters s WHERE s.exam_id = v.exam_id AND s.chapter_id = v.chapter_id)))
      INTO _vh, _vo
      FROM public.question_bank_student v;
    RESET ROLE;
    INSERT INTO _seen VALUES (r.uid, _phase, _ph, _pn, _vh, _vo);
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);
END
$f$;

SELECT pg_temp.look('before');

-- ── 2. Retire the active exam questions outside their exam's syllabus ──────
INSERT INTO public.routines_pre_20261129000000 (object, definition)
SELECT 'retired:' || q.id, jsonb_build_object('id', q.id, 'chapter', q.chapter, 'is_active', q.is_active)::text
  FROM public.question_bank q
 WHERE q.exam_id IS NOT NULL AND q.is_active
   AND (q.chapter_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.exam_syllabus_chapters s WHERE s.exam_id = q.exam_id AND s.chapter_id = q.chapter_id));
UPDATE public.question_bank q SET is_active = false
 WHERE q.exam_id IS NOT NULL AND q.is_active
   AND (q.chapter_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.exam_syllabus_chapters s WHERE s.exam_id = q.exam_id AND s.chapter_id = q.chapter_id));

-- ── 1. One home: the view fences by the caller's exam AND its syllabus ─────
CREATE OR REPLACE VIEW public.question_bank_student AS
 SELECT q.id,
    q.class_level,
    q.subject,
    q.chapter,
    q.difficulty,
    q.question,
    q.options,
    q.source,
    q.is_approved,
    q.created_at,
    q.board,
    q.source_type,
    q.exam_year,
    q.stream,
    q.question_format,
    q.updated_at,
    q.is_active,
    q.chapter_id,
    q.variant_tier,
    q.topic_id,
    q.exam_id
   FROM public.question_bank q
  WHERE q.is_approved
    AND (
      -- A school student: no exam question, and their school's board.
      (q.exam_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.exam_accounts ea WHERE ea.school_id = (SELECT public.get_my_school_id()))
       AND (q.board IS NULL OR q.board = 'both'
            OR q.board = (SELECT s.board FROM public.schools s WHERE s.id = (SELECT public.get_my_school_id()))))
      OR
      -- An exam account: its own exam, and only a chapter of its own stream's
      -- syllabus (20261129000000 — the one home of that rule).
      (q.exam_id IS NOT NULL
       AND q.chapter_id IN (
             SELECT s.chapter_id
               FROM public.exam_accounts ea
               JOIN public.exam_syllabus_chapters s ON s.exam_id = ea.exam_id AND s.stream = ea.stream
              WHERE ea.school_id = (SELECT public.get_my_school_id())
                AND ea.exam_id = q.exam_id))
    );

COMMENT ON VIEW public.question_bank_student IS
  'The bank as a student may be served it: a school student their board''s non-exam questions; an exam account only its own exam''s questions in a chapter of its own stream''s syllabus (20261129000000). Every student read of the bank goes through this view; nothing restates its rule.';

-- ── The pool keeps the view's answer and no longer restates the syllabus ───
CREATE OR REPLACE FUNCTION public._student_bank_pool(_class_level integer DEFAULT NULL::integer, _stream text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, subject text, chapter text, chapter_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Which questions this caller may be served is the view's (board, exam,
  -- and the exam's syllabus — 20261129000000). The pool adds only what the
  -- view cannot know: that a question is active and has a subject, and a
  -- school student's class and stream.
  SELECT qb.id, qb.subject, qb.chapter, qb.chapter_id
    FROM public.question_bank_student qb
   WHERE qb.is_active
     AND NULLIF(btrim(qb.subject), '') IS NOT NULL
     AND CASE
       WHEN EXISTS (SELECT 1 FROM public.exam_accounts ea WHERE ea.school_id = (SELECT public.get_my_school_id())) THEN
         qb.exam_id IS NOT NULL
       ELSE
         qb.exam_id IS NULL
         AND qb.class_level = _class_level
         AND (_stream IS NULL OR qb.stream = _stream OR qb.stream IS NULL)
     END
$function$;

SELECT pg_temp.look('after');

-- ── THE PROOF ─────────────────────────────────────────────────────────────
DO $proof$
DECLARE _n int; _r record;
BEGIN
  -- Control: there was something to fence, and the readers read something.
  IF NOT EXISTS (SELECT 1 FROM _seen WHERE phase = 'before' AND view_off > 0) THEN
    RAISE EXCEPTION 'CONTROL FAILED: no exam account could see an off-syllabus question before, so nothing below proves the fence';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _seen s JOIN _readers r ON r.uid = s.uid WHERE s.phase = 'before' AND r.exam AND s.pool_n > 0)
     OR NOT EXISTS (SELECT 1 FROM _seen s JOIN _readers r ON r.uid = s.uid WHERE s.phase = 'before' AND NOT r.exam AND s.pool_n > 0) THEN
    RAISE EXCEPTION 'CONTROL FAILED: an exam account and a school student must both have a non-empty pool before';
  END IF;

  FOR _r IN
    SELECT b.uid, rd.exam, b.pool_h AS bp, a.pool_h AS ap, b.view_h AS bv, a.view_h AS av, a.view_off AS aoff
      FROM _seen b JOIN _seen a ON a.uid = b.uid AND a.phase = 'after' JOIN _readers rd ON rd.uid = b.uid
     WHERE b.phase = 'before'
  LOOP
    -- 1. Nobody's pool moved: the catalog and the mock papers are what they were.
    IF _r.bp IS DISTINCT FROM _r.ap THEN
      RAISE EXCEPTION '% (exam=%): the pool changed — the catalog would have', _r.uid, _r.exam;
    END IF;
    -- 2. No exam account sees an off-syllabus question through the view.
    IF _r.aoff <> 0 THEN
      RAISE EXCEPTION '% still sees % off-syllabus question(s) through the view', _r.uid, _r.aoff;
    END IF;
    -- 3. A school student's view is untouched.
    IF NOT _r.exam AND _r.bv IS DISTINCT FROM _r.av THEN
      RAISE EXCEPTION 'a school student''s view changed';
    END IF;
  END LOOP;

  -- 4. The rule has one home: the pool no longer names the syllabus.
  IF position('exam_syllabus_chapters' IN pg_get_functiondef('public._student_bank_pool(integer,text)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'the pool still restates the syllabus';
  END IF;

  -- 5. No active exam question is outside its syllabus.
  SELECT count(*) INTO _n FROM public.question_bank q
   WHERE q.exam_id IS NOT NULL AND q.is_active
     AND (q.chapter_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.exam_syllabus_chapters s WHERE s.exam_id = q.exam_id AND s.chapter_id = q.chapter_id));
  IF _n <> 0 THEN RAISE EXCEPTION '% active exam question(s) remain outside their syllabus', _n; END IF;

  -- 6. The grants did not move.
  IF NOT has_table_privilege('authenticated', 'public.question_bank_student', 'SELECT')
     OR has_table_privilege('anon', 'public.question_bank_student', 'SELECT') THEN
    RAISE EXCEPTION 'the view''s grants moved';
  END IF;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261129000000_the_syllabus_is_the_fence_wherever_the_bank_is_read')
ON CONFLICT (version) DO NOTHING;

COMMIT;
