-- ═══════════════════════════════════════════════════════════════════════════
-- The parent weekly digest gets a sender, a fifth item, and one home
--
-- ── WHAT WAS ACTUALLY WRONG: IT DID NOT SEND ─────────────────────────────
--
-- Reported previously as "3 of rule 17's 5 items", which understated it.
-- `useParentWeeklyDigest` has no caller anywhere in the client and nothing
-- scheduled the RPC, so §10.15's "sends automatically, no human check" was
-- entirely unbuilt. The missing teacher's remark was a detail inside a feature
-- that never ran.
--
-- ── 2a AND 2b WERE ALREADY DONE ──────────────────────────────────────────
--
-- Both checked before writing anything, and both turned out to be closed:
--
--   2a  rpc_parent_weekly_digest is ALREADY a pure read. The alert-writing
--       side effect was removed by 20260904120000; no function in this database
--       INSERTs into parent_academic_alerts.
--   2b  There is no surviving alert write to justify or remove. The table has
--       0 rows, 0 triggers, no database writer and no client writer.
--
-- So the `alerts` key returned `[]` and always would. It is REMOVED from the
-- payload here: a key that can only ever be empty is an invitation to start
-- filling it again, and the feature it belonged to was ruled not to exist. The
-- table itself is left in place — dropping it is a separate call, and it is now
-- referenced by nothing but its own policies.
--
-- ── ONE COMPUTATION, TWO CALLERS ─────────────────────────────────────────
--
-- The digest is needed by a signed-in parent (pull) and by a scheduled job
-- (push). Writing it twice would be G9 with the two copies drifting until the
-- notification says something the screen does not.
--
--   _parent_weekly_digest(_parent uuid)   the computation. Takes the parent as
--                                         an argument instead of reading
--                                         auth.uid(), which is the only reason
--                                         a cron job can call it at all.
--   rpc_parent_weekly_digest()            unchanged signature, unchanged
--                                         behaviour, still auth-gated. Now a
--                                         thin wrapper.
--   rpc_send_parent_weekly_digests()      the job. One notification per parent.
--
-- ── THE FIFTH ITEM, AND ONE INFERENCE THAT NEEDS CONFIRMING ──────────────
--
-- Rule 17 fixes the contents: attendance · homework completed · homework not
-- completed · a teacher's remark if one exists · test marks where a test was
-- conducted online. The remark is added here.
--
-- TWO THINGS ABOUT THE MARKS ITEM ARE FLAGGED RATHER THAN DECIDED:
--
--   1. The payload carried EXAM marks (public.marks + public.exams). Rule 17
--      says TEST marks, and names the exam report as the parent's other
--      surface. Both are now returned, under distinct keys `test_marks` and
--      `exam_marks`, so nothing a parent could already see disappears while the
--      question is open. If rule 17 is literal, `exam_marks` goes.
--
--   2. "Conducted online" has no explicit marker. `tests.test_kind` is NULL on
--      all 72 rows, so the only available signal is whether the test has
--      attempts — 24 of 72 do. That inference is implemented and named here so
--      it can be corrected in one place rather than discovered later.
--
-- ── WHY THE JOB WRITES A NOTIFICATION AND NOT AN EMAIL ───────────────────
--
-- Ruled: shape 1. It satisfies "sends automatically" on infrastructure that
-- exists (pg_cron + notifications) and arrives without the parent pulling. Push
-- is formally unproven pending a native build; when it is settled, the
-- notification row is the thing it would carry anyway.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── The computation ───────────────────────────────────────────────────────
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
  _em     jsonb;
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
    -- ── 1 & 2. ATTENDANCE ─────────────────────────────────────────────────
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

    -- ── 3. HOMEWORK, completed and not completed ──────────────────────────
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
    -- Rule 17's missing item. "If one exists" is the whole contract: no remark
    -- is `null`, not an empty string and not a cheerful placeholder.
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
    -- on every row, so there is no explicit marker to read. Flagged in the
    -- header; change it here and nowhere else.
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

    -- Exam marks, retained under their own key while rule 17's wording is
    -- confirmed. Only PUBLISHED results — an unpublished mark is not the
    -- parent's to see yet (§10.13).
    SELECT jsonb_build_object(
             'published', count(*),
             'subjects',  COALESCE(jsonb_agg(jsonb_build_object(
                            'exam',    e.name,
                            'subject', e.subject,
                            'scored',  m.marks_obtained,
                            'out_of',  e.max_marks,
                            'pct',     CASE WHEN e.max_marks IS NULL OR e.max_marks = 0 THEN NULL
                                            ELSE round(100.0 * m.marks_obtained / e.max_marks, 1) END
                          ) ORDER BY e.results_published_at DESC), '[]'::jsonb)
           )
      INTO _em
      FROM public.marks m
      JOIN public.exams e ON e.id = m.exam_id
     WHERE m.student_id = _child.id
       AND e.results_published_at IS NOT NULL
       AND e.results_published_at::date BETWEEN _from AND _to;

    _result := _result || jsonb_build_array(jsonb_build_object(
      'student_id',  _child.id,
      'name',        _child.full_name,
      'class',       (SELECT COALESCE(display_name, name || '-' || section)
                        FROM public.classes WHERE id = _child.class_id),
      'attendance',  COALESCE(_att,    jsonb_build_object('marked', 0, 'pct', NULL)),
      'homework',    COALESCE(_hw,     jsonb_build_object('due', 0, 'pct', NULL)),
      'remarks',     COALESCE(_remark, '[]'::jsonb),
      'test_marks',  COALESCE(_tm,     jsonb_build_object('count', 0, 'tests', '[]'::jsonb)),
      'exam_marks',  COALESCE(_em,     jsonb_build_object('published', 0, 'subjects', '[]'::jsonb))
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'window',       jsonb_build_object('starts_on', _from, 'ends_on', _to),
    'children',     _result,
    'generated_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._parent_weekly_digest(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- ── The pull, unchanged from the caller's point of view ───────────────────
CREATE OR REPLACE FUNCTION public.rpc_parent_weekly_digest()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _parent uuid := auth.uid();
BEGIN
  IF _parent IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.has_role(_parent, 'parent') AND NOT public.has_role(_parent, 'admin') THEN
    RAISE EXCEPTION 'Parent only';
  END IF;

  RETURN public._parent_weekly_digest(_parent, CURRENT_DATE - 7, CURRENT_DATE);
END;
$function$;

-- ── The push ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_send_parent_weekly_digests()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _from date := CURRENT_DATE - 7;
  _to   date := CURRENT_DATE;
  _p         record;
  _digest    jsonb;
  _kids      int;
  _sent      int := 0;
  _skipped   int := 0;
BEGIN
  -- Same rule as rpc_purge_expired: a platform job with no per-user caller. It
  -- reads every institution's parents by design, and there is no correct
  -- institution to scope it to.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'rpc_send_parent_weekly_digests is a scheduled job; it has no per-user caller and reads across institutions by design';
  END IF;

  FOR _p IN
    SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
     WHERE ur.role = 'parent'
  LOOP
    _digest := public._parent_weekly_digest(_p.user_id, _from, _to);
    _kids := jsonb_array_length(_digest -> 'children');

    -- A parent with no linked child gets nothing. An empty digest is not a
    -- weekly summary; it is a notification that says the school did not happen.
    IF _kids = 0 THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;

    PERFORM public._notify(
      _p.user_id,
      'general',
      'Your weekly summary',
      format('Attendance, homework and marks for the week to %s.', to_char(_to, 'DD Mon')),
      'calendar-check',
      '/parent'
    );
    _sent := _sent + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'sent', _sent, 'skipped_no_children', _skipped,
    'window', jsonb_build_object('starts_on', _from, 'ends_on', _to),
    'ran_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_send_parent_weekly_digests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_send_parent_weekly_digests() TO service_role;

-- ── Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE _d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _d FROM pg_proc
   WHERE proname = 'rpc_parent_weekly_digest' AND pronamespace = 'public'::regnamespace;

  IF _d ~* 'INSERT\s+INTO\s+public\.parent_academic_alerts' THEN
    RAISE EXCEPTION 'ABORT: the digest writes alerts again; it must be a pure read';
  END IF;
  IF _d ~* 'parent_academic_alerts' THEN
    RAISE EXCEPTION 'ABORT: the digest still references parent_academic_alerts';
  END IF;
  IF _d !~ '_parent_weekly_digest' THEN
    RAISE EXCEPTION 'ABORT: the pull no longer delegates to the shared computation';
  END IF;

  SELECT pg_get_functiondef(oid) INTO _d FROM pg_proc
   WHERE proname = '_parent_weekly_digest' AND pronamespace = 'public'::regnamespace;

  -- Each of rule 17's five items, named by the column it comes from, so a
  -- rewrite that silently drops one aborts.
  IF _d !~* 'public\.attendance'      THEN RAISE EXCEPTION 'ABORT: attendance missing'; END IF;
  IF _d !~* 'public\.homework'        THEN RAISE EXCEPTION 'ABORT: homework missing'; END IF;
  IF _d !~* 'not_completed'           THEN RAISE EXCEPTION 'ABORT: homework not-completed missing'; END IF;
  IF _d !~* 'public\.teacher_remarks' THEN RAISE EXCEPTION 'ABORT: the teacher remark is missing'; END IF;
  IF _d !~* 'public\.test_marks'      THEN RAISE EXCEPTION 'ABORT: test marks missing'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE proname = 'rpc_send_parent_weekly_digests'
                    AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'ABORT: the sender was not created';
  END IF;

  -- The job must refuse a signed-in caller, or any parent could fan out
  -- notifications to every parent in every school.
  IF (SELECT pg_get_functiondef(oid) FROM pg_proc
       WHERE proname = 'rpc_send_parent_weekly_digests'
         AND pronamespace = 'public'::regnamespace) !~* 'auth\.uid\(\) IS NOT NULL' THEN
    RAISE EXCEPTION 'ABORT: the sender does not refuse a per-user caller';
  END IF;
END $$;

COMMIT;
