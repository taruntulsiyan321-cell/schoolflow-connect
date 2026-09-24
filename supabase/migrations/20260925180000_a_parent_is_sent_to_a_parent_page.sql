-- ═══════════════════════════════════════════════════════════════════════════
-- A parent's notification opens a parent's page
--
-- Asked 2026-09-15: does homework reach "the particular student's parents'
-- phone". It reaches their notifications — and there it pointed into a panel
-- a parent cannot open.
--
-- ── MEASURED ON LIVE 2026-09-15 ──────────────────────────────────────────────
--
-- The router writes one link per event, for the student's panel, and
-- `_notify_student_parents` passes the parents that same link. Notifications
-- held by parent accounts (and by no student account), by link:
--
--     /student/homework   homework        248
--     /student/tests      exam, result    222
--     /student/notices    announcement     86
--     /student/marks      result           59
--     /student            homework          4
--
-- 619 links into the student panel, and the parent Notifications page opened
-- no link at all, so nothing on screen showed the fault.
--
-- ── WHAT CHANGES ──────────────────────────────────────────────────────────
--
-- 1. `parent_link_for(link)` — the parent page that shows what a student link
--    is about: homework and attendance on My Children, tests and marks on
--    Marks, notices on Notices, anything else of the student's on the parent
--    dashboard. A parent link, or a link into no student page, is unchanged.
-- 2. `_notify_student_parents` — the one home for who a student's parents are
--    — sends each parent `parent_link_for(_link)`. Every caller (the router's
--    homework, test, exam, notice and decision branches, remarks, badges, risk
--    alerts) is corrected at once, and the student's own link is untouched.
-- 3. The links already written to parents are corrected the same way; the old
--    ones are kept in `notification_links_pre_20260925180000` so the rollback
--    can put every one back.
--
-- Rollback: supabase/migrations/rollback/20260925180000_a_parent_is_sent_to_a_parent_page.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Snapshots, so the rollback restores exactly ──────────────────────────

CREATE TABLE public.routines_pre_20260925180000 (
  routine text PRIMARY KEY,
  definition text NOT NULL
);
ALTER TABLE public.routines_pre_20260925180000 ENABLE ROW LEVEL SECURITY;
-- A new table in public is granted ALL to anon and authenticated by default.
REVOKE ALL ON public.routines_pre_20260925180000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20260925180000 IS
  'Rollback source for 20260925180000: _notify_student_parents exactly as it was defined before. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';

INSERT INTO public.routines_pre_20260925180000 (routine, definition)
VALUES ('public._notify_student_parents(uuid,text,text,text,text,text)',
        pg_get_functiondef('public._notify_student_parents(uuid,text,text,text,text,text)'::regprocedure));

CREATE TABLE public.notification_links_pre_20260925180000 (
  id uuid PRIMARY KEY,
  link text NOT NULL
);
ALTER TABLE public.notification_links_pre_20260925180000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_links_pre_20260925180000 FROM anon, authenticated;
COMMENT ON TABLE public.notification_links_pre_20260925180000 IS
  'Rollback source for 20260925180000: the student-panel link each parent notification carried before it was corrected. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';

-- ── 1. Where a student link takes a parent ─────────────────────────────────

CREATE FUNCTION public.parent_link_for(_link text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _link IS NULL OR _link !~ '^/student(/|$)' THEN _link
    WHEN _link ~ '^/student/(homework|assignments|attendance)(/|$)' THEN '/parent/children'
    WHEN _link ~ '^/student/(tests|marks|results|exams)(/|$)' THEN '/parent/marks'
    WHEN _link ~ '^/student/(notices|announcements)(/|$)' THEN '/parent/notices'
    ELSE '/parent'
  END
$$;
REVOKE ALL ON FUNCTION public.parent_link_for(text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.parent_link_for(text) IS
  'The parent page that shows what a student-panel link is about (20260925180000). Used by _notify_student_parents; a parent link, or any link outside the student panel, passes through.';

-- ── 2. The one home for a student's parents sends a parent's link ──────────

CREATE OR REPLACE FUNCTION public._notify_student_parents(
  _student_id uuid, _type text, _title text,
  _body text DEFAULT NULL, _icon text DEFAULT NULL, _link text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _student_user uuid;
  _parent uuid;
BEGIN
  SELECT user_id INTO _student_user FROM public.students WHERE id = _student_id;

  -- Both paths are collected FIRST, then de-duplicated, then notified. A
  -- parent reachable down both used to be told twice (20260918000000).
  FOR _parent IN
    SELECT DISTINCT u.user_id
      FROM (
        SELECT s.parent_user_id AS user_id
          FROM public.students s
         WHERE s.id = _student_id AND s.parent_user_id IS NOT NULL
        UNION
        SELECT p.user_id
          FROM public.parent_students ps
          JOIN public.parents p ON p.id = ps.parent_id
         WHERE ps.student_id = _student_id AND p.user_id IS NOT NULL
      ) u
     WHERE u.user_id IS NOT NULL
       AND u.user_id IS DISTINCT FROM _student_user
  LOOP
    -- The caller's link is the student's page; a parent is sent the parent
    -- page that shows the same thing (20260925180000).
    PERFORM public._notify(_parent, _type, _title, _body, _icon, public.parent_link_for(_link));
  END LOOP;
END;
$function$;

-- ── 3. The links already written ──────────────────────────────────────────

INSERT INTO public.notification_links_pre_20260925180000 (id, link)
SELECT n.id, n.link
  FROM public.notifications n
 WHERE n.link ~ '^/student(/|$)'
   AND (EXISTS (SELECT 1 FROM public.parents p WHERE p.user_id = n.user_id)
        OR EXISTS (SELECT 1 FROM public.students s WHERE s.parent_user_id = n.user_id))
   AND NOT EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = n.user_id);

UPDATE public.notifications n
   SET link = public.parent_link_for(p.link)
  FROM public.notification_links_pre_20260925180000 p
 WHERE p.id = n.id;

-- ── 4. Proof ──────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  _student uuid; _student_user uuid; _parent uuid;
  _n integer; _link text;
BEGIN
  -- 0. The map, case by case — the links it must leave alone included, so a
  --    map that rewrote everything fails here too.
  IF public.parent_link_for('/student/homework') IS DISTINCT FROM '/parent/children'
     OR public.parent_link_for('/student/attendance') IS DISTINCT FROM '/parent/children'
     OR public.parent_link_for('/student/tests') IS DISTINCT FROM '/parent/marks'
     OR public.parent_link_for('/student/marks') IS DISTINCT FROM '/parent/marks'
     OR public.parent_link_for('/student/notices') IS DISTINCT FROM '/parent/notices'
     OR public.parent_link_for('/student') IS DISTINCT FROM '/parent'
     OR public.parent_link_for('/student/battleground') IS DISTINCT FROM '/parent'
     OR public.parent_link_for('/parent/fees') IS DISTINCT FROM '/parent/fees'
     OR public.parent_link_for('/parent') IS DISTINCT FROM '/parent'
     OR public.parent_link_for('/teacher/classes') IS DISTINCT FROM '/teacher/classes'
     OR public.parent_link_for('/studentship') IS DISTINCT FROM '/studentship'
     OR public.parent_link_for(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: parent_link_for maps a link to the wrong page';
  END IF;
  IF has_function_privilege('authenticated', 'public.parent_link_for(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.parent_link_for(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLED BACK: parent_link_for is callable by anon or authenticated';
  END IF;

  -- 1. No parent-only notification points into the student panel any more, and
  --    every one corrected is recorded with the link it had.
  SELECT count(*) INTO _n
    FROM public.notifications n
   WHERE n.link ~ '^/student(/|$)'
     AND (EXISTS (SELECT 1 FROM public.parents p WHERE p.user_id = n.user_id)
          OR EXISTS (SELECT 1 FROM public.students s WHERE s.parent_user_id = n.user_id))
     AND NOT EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = n.user_id);
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % parent notification(s) still point into the student panel', _n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_links_pre_20260925180000 p
               JOIN public.notifications n ON n.id = p.id
              WHERE n.link IS DISTINCT FROM public.parent_link_for(p.link)
                 OR p.link !~ '^/student(/|$)') THEN
    RAISE EXCEPTION 'ROLLED BACK: a corrected notification does not carry the parent page of the link recorded for it';
  END IF;

  -- 2. Told about homework: the parent is sent My Children, once; the student
  --    keeps their own homework page. Inside a savepoint that always ends by
  --    raising P0999, so nothing the proof writes survives it.
  BEGIN
    SELECT s.id, s.user_id, p.user_id INTO _student, _student_user, _parent
      FROM public.students s
      JOIN public.parent_students ps ON ps.student_id = s.id
      JOIN public.parents p ON p.id = ps.parent_id AND p.user_id IS NOT NULL AND p.user_id <> s.user_id
     WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL
     ORDER BY s.id
     LIMIT 1;
    IF _parent IS NULL THEN
      RAISE EXCEPTION 'ROLLED BACK: need a signed-in student with a signed-in parent — a check that cannot run is not a check that passed';
    END IF;
    -- The parent is linked down BOTH paths, as every legacy link is.
    UPDATE public.students SET parent_user_id = _parent WHERE id = _student;

    PERFORM public._notify_student_circle(_student, 'homework', '[verify 20260925180000]', 'b', 'book-open', '/student/homework');

    SELECT count(*), min(link) INTO _n, _link
      FROM public.notifications WHERE user_id = _parent AND title = '[verify 20260925180000]';
    IF _n <> 1 OR _link IS DISTINCT FROM '/parent/children' THEN
      RAISE EXCEPTION 'ROLLED BACK: the parent was told % time(s), with link %; expected once, with /parent/children', _n, _link;
    END IF;
    SELECT count(*), min(link) INTO _n, _link
      FROM public.notifications WHERE user_id = _student_user AND title = '[verify 20260925180000]';
    IF _n <> 1 OR _link IS DISTINCT FROM '/student/homework' THEN
      RAISE EXCEPTION 'ROLLED BACK: the student was told % time(s), with link %; expected once, with /student/homework', _n, _link;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify fixtures rolled back';
  EXCEPTION WHEN SQLSTATE 'P0999' THEN
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.notifications WHERE title = '[verify 20260925180000]') THEN
    RAISE EXCEPTION 'ROLLED BACK: verify fixtures survived the savepoint';
  END IF;

  RAISE NOTICE 'verify OK: student links map to the parent page that shows the same thing and nothing else moves; a parent is sent My Children for homework, once, while the student keeps their homework page; no parent notification points into the student panel, each corrected one recorded for the rollback';
END
$verify$;
