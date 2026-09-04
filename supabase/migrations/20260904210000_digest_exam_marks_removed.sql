-- ═══════════════════════════════════════════════════════════════════════════
-- The weekly digest drops `exam_marks`. Five items, not six.
--
-- ── RULED, WITH THE DISTINCTION THAT DECIDED IT ──────────────────────────
--
-- 20260904190000 returned BOTH `test_marks` and `exam_marks`, and flagged the
-- choice rather than making it, on the precedent that removing something a
-- parent can already see needs a ruling. That precedent was applied too widely.
--
-- The earlier case (homework at 65% disappearing from a teacher's action list)
-- removed items with NO OTHER HOME — they simply stopped being visible
-- anywhere. Exam marks have an explicit other home, named in the same rule:
-- the exam report, which is available to parents throughout the year. Removing
-- `exam_marks` here removes a DUPLICATE, not a feature.
--
-- Two supporting reasons, both structural rather than aesthetic:
--
--   1. The digest is a weekly summary of what happened that week. Exams do not
--      happen weekly, so the key is empty most weeks. That is the same
--      "permanently-empty key is an invitation to refill it" argument that
--      removed `alerts` in 190000, applied one field over.
--
--   2. §10.15 lists exam results as parent-facing, and that clause is
--      satisfied by the exam report. A clause saying parents see something is
--      not a clause saying they see it HERE.
--
-- §10.17 independently supports this: rank is "Sent to parents in the exam
-- report. Never in the weekly summary." The digest was carrying the marks that
-- rank is computed from while the rank itself was correctly excluded.
--
-- ── WHAT IS LEFT, AND WHY THE COMMENT NUMBERING CHANGED ──────────────────
--
-- Rule 17's five items, and the payload key each one lands in:
--
--   1  attendance                      → attendance
--   2  homework completed              → homework.submitted
--   3  homework not completed          → homework.not_completed
--   4  a teacher's remark, if one      → remarks
--   5  test marks, test conducted      → test_marks
--      online
--
-- Five items, four keys, because item 2 and item 3 are two halves of one
-- count. 190000's inline comments labelled attendance "1 & 2" and homework
-- "3", which does not match rule 17's list; corrected here so a reader
-- counting items against the rule gets five and not six.
--
-- ── WHAT IS NOT CHANGED ──────────────────────────────────────────────────
--
-- `attendance.pct` and `homework.pct` stay NULL — not 0 — when nothing was
-- marked or nothing was due. Confirmed correct: a child with no attendance
-- record this week has an UNKNOWN rate, not a rate of zero, and `null < 60` is
-- true in JavaScript so a 0 would band as the worst rung. Pinned by
-- probe6 ("210000 pct is null not zero") and by the compile-time assertion in
-- src/hooks/useParentWeeklyDigest.test.ts.
--
-- The online-test inference (a test "conducted online" is one that HAS
-- attempts, because tests.test_kind is NULL on all 72 rows) is unchanged and
-- still lives in exactly one place — the EXISTS below.
--
-- public.marks and public.exams are no longer read by this function at all.
-- The verification block asserts that, because dropping the key while leaving
-- the join would keep the cost and lose only the output.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._parent_weekly_digest(_parent uuid, _from date, _to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb := '[]'::jsonb;
  _child  record;
  _att    jsonb;
  _hw     jsonb;
  _remark jsonb;
  _tm     jsonb;
BEGIN
  FOR _child IN
    SELECT s.*
      FROM public.students s
     WHERE s.deleted_at IS NULL
       AND (
         s.parent_user_id = _parent
         OR EXISTS (
           SELECT 1 FROM public.parents p
             JOIN public.parent_students ps ON ps.parent_id = p.id
            WHERE p.user_id = _parent AND ps.student_id = s.id
         )
       )
  LOOP
    -- ── 1. ATTENDANCE ─────────────────────────────────────────────────────
    -- attendance carries no date of its own; the day lives on the submission.
    SELECT jsonb_build_object(
             'present',  count(*) FILTER (WHERE att.status = 'present'),
             'absent',   count(*) FILTER (WHERE att.status = 'absent'),
             'late',     count(*) FILTER (WHERE att.status = 'late'),
             'leave',    count(*) FILTER (WHERE att.status = 'leave'),
             'half_day', count(*) FILTER (WHERE att.status = 'half_day'),
             'marked',   count(*),
             -- NULL, not 0, when nothing was marked. A child with no attendance
             -- record this week has an UNKNOWN rate, not a rate of zero.
             'pct',      CASE WHEN count(*) = 0 THEN NULL
                              ELSE round(100.0 * count(*) FILTER (WHERE att.status IN ('present','late','half_day'))
                                         / count(*), 1) END
           )
      INTO _att
      FROM public.attendance att
      JOIN public.attendance_submissions sub ON sub.id = att.submission_id
     WHERE att.student_id = _child.id
       AND sub.date BETWEEN _from AND _to;

    -- ── 2 & 3. HOMEWORK, completed and not completed ──────────────────────
    -- §10.12: completion is measured AT THE DUE DATE, so the window is on
    -- due_date. `not_completed` is stated rather than left to subtraction —
    -- rule 17 names both halves, and a reader should not have to derive one.
    SELECT jsonb_build_object(
             'due',           count(*),
             'submitted',     count(*) FILTER (WHERE hs.submitted_at IS NOT NULL),
             'not_completed', count(*) FILTER (WHERE hs.submitted_at IS NULL),
             'pct',           CASE WHEN count(*) = 0 THEN NULL
                                   ELSE round(100.0 * count(*) FILTER (WHERE hs.submitted_at IS NOT NULL)
                                              / count(*), 1) END
           )
      INTO _hw
      FROM public.homework h
      LEFT JOIN public.homework_submissions hs
             ON hs.homework_id = h.id AND hs.student_id = _child.id
     WHERE h.class_id = _child.class_id
       AND h.deleted_at IS NULL
       AND h.published_at IS NOT NULL
       AND h.due_date BETWEEN _from AND _to;

    -- ── 4. A TEACHER'S REMARK, IF ONE EXISTS ──────────────────────────────
    -- "If one exists" is the whole contract: no remark is `null`, not an empty
    -- string and not a cheerful placeholder.
    --
    -- VISIBILITY IS RESPECTED AND THE FILTER FAILS CLOSED. `visibility`
    -- defaults to 'parent_student' and has no CHECK constraint, so other values
    -- can exist. Matching on '%parent%' includes every parent-visible variant
    -- and excludes anything else — an unrecognised value keeps the remark out
    -- of the parent's digest rather than into it. §10.14 says the parent sees a
    -- remark immediately, but "the parent sees remarks" is not "the parent sees
    -- every row in this table".
    --
    -- `edited_at` is carried because §10.14 asks for an edited marker: a remark
    -- the parent already read, later changed, must not arrive looking original.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'remark',     r.body,
             'kind',       r.remark_type,
             'created_at', r.created_at,
             'edited_at',  r.edited_at
           ) ORDER BY r.created_at DESC), '[]'::jsonb)
      INTO _remark
      FROM public.teacher_remarks r
     WHERE r.student_id = _child.id
       AND r.deleted_at IS NULL
       AND COALESCE(r.visibility, '') LIKE '%parent%'
       AND r.created_at::date BETWEEN _from AND _to;

    -- ── 5. TEST MARKS, where the test was conducted online ────────────────
    -- The online test is identified by having attempts: tests.test_kind is NULL
    -- on every row, so there is no explicit marker to read. This EXISTS is the
    -- only place that inference lives; change it here and nowhere else.
    SELECT jsonb_build_object(
             'count',  count(*),
             'tests',  COALESCE(jsonb_agg(jsonb_build_object(
                         'test',    t.title,
                         'scored',  tm.mark,
                         'out_of',  t.max_mark,
                         'pct',     CASE WHEN t.max_mark IS NULL OR t.max_mark = 0 THEN NULL
                                         ELSE round(100.0 * tm.mark / t.max_mark, 1) END
                       ) ORDER BY tm.uploaded_at DESC NULLS LAST), '[]'::jsonb)
           )
      INTO _tm
      FROM public.test_marks tm
      JOIN public.tests t ON t.id = tm.test_id
     WHERE tm.student_id = _child.id
       AND t.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM public.test_attempts a WHERE a.test_id = t.id)
       AND COALESCE(tm.uploaded_at, tm.created_at)::date BETWEEN _from AND _to;

    -- EXAM MARKS ARE DELIBERATELY ABSENT. They live in the exam report, which
    -- is available to parents all year; carrying them here duplicated that
    -- surface and left a key that is empty in every week without an exam.
    -- Restoring them means restoring the join too — see the rollback.

    _result := _result || jsonb_build_array(jsonb_build_object(
      'student_id',  _child.id,
      'name',        _child.full_name,
      'class',       (SELECT COALESCE(display_name, name || '-' || section)
                        FROM public.classes WHERE id = _child.class_id),
      'attendance',  COALESCE(_att,    jsonb_build_object('marked', 0, 'pct', NULL)),
      'homework',    COALESCE(_hw,     jsonb_build_object('due', 0, 'pct', NULL)),
      'remarks',     COALESCE(_remark, '[]'::jsonb),
      'test_marks',  COALESCE(_tm,     jsonb_build_object('count', 0, 'tests', '[]'::jsonb))
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'window',       jsonb_build_object('starts_on', _from, 'ends_on', _to),
    'children',     _result,
    'generated_at', now()
  );
END;
$function$;

-- CREATE OR REPLACE preserves grants, so this is belt and braces rather than
-- a fix — it matters only if the function is ever dropped and recreated.
REVOKE ALL ON FUNCTION public._parent_weekly_digest(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- ── Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE _d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _d FROM pg_proc
   WHERE proname = '_parent_weekly_digest' AND pronamespace = 'public'::regnamespace;

  IF _d IS NULL THEN
    RAISE EXCEPTION 'ABORT: _parent_weekly_digest does not exist';
  END IF;

  -- The removal itself.
  IF _d ~* '''exam_marks''' THEN
    RAISE EXCEPTION 'ABORT: the exam_marks key is still in the payload';
  END IF;
  -- Dropping the key while leaving the join would keep the cost and lose only
  -- the output, which is the worst of both.
  IF _d ~* 'public\.exams' THEN
    RAISE EXCEPTION 'ABORT: the function still joins public.exams';
  END IF;
  IF _d ~* 'FROM\s+public\.marks' THEN
    RAISE EXCEPTION 'ABORT: the function still reads public.marks';
  END IF;

  -- Rule 17's five items must all survive the edit. Named by the column each
  -- comes from, so a rewrite that silently drops one aborts here.
  IF _d !~* 'public\.attendance'      THEN RAISE EXCEPTION 'ABORT: item 1 attendance missing'; END IF;
  IF _d !~* 'public\.homework'        THEN RAISE EXCEPTION 'ABORT: items 2-3 homework missing'; END IF;
  IF _d !~* 'not_completed'           THEN RAISE EXCEPTION 'ABORT: item 3 homework not-completed missing'; END IF;
  IF _d !~* 'public\.teacher_remarks' THEN RAISE EXCEPTION 'ABORT: item 4 the teacher remark is missing'; END IF;
  IF _d !~* 'public\.test_marks'      THEN RAISE EXCEPTION 'ABORT: item 5 test marks missing'; END IF;

  -- The online-test inference must not be dropped along with the exam join;
  -- without it every test's marks reach the digest, not only online ones.
  IF _d !~* 'public\.test_attempts' THEN
    RAISE EXCEPTION 'ABORT: the "conducted online" filter (EXISTS on test_attempts) is gone';
  END IF;

  -- null-not-zero, asserted on the function body because it is the property
  -- most likely to be "tidied" into a COALESCE by a later reader.
  IF _d !~* 'CASE WHEN count\(\*\) = 0 THEN NULL' THEN
    RAISE EXCEPTION 'ABORT: a rate no longer returns NULL when nothing was measured';
  END IF;

  -- The pull must still delegate rather than growing its own copy (G9).
  SELECT pg_get_functiondef(oid) INTO _d FROM pg_proc
   WHERE proname = 'rpc_parent_weekly_digest' AND pronamespace = 'public'::regnamespace;
  IF _d !~ '_parent_weekly_digest' THEN
    RAISE EXCEPTION 'ABORT: the pull no longer delegates to the shared computation';
  END IF;
END $$;

COMMIT;
