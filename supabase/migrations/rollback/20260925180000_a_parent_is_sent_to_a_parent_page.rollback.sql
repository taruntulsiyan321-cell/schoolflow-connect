-- Rollback for 20260925180000_a_parent_is_sent_to_a_parent_page.
--
-- Puts `_notify_student_parents` back exactly as it was defined before (from
-- the snapshot the migration took), puts back every parent notification's old
-- link, and drops `parent_link_for` and the two snapshot tables.
--
-- WHAT REVERTING COSTS: parents are sent the student's link again
-- ("/student/homework"), which the parent panel cannot open.

DO $pre$
BEGIN
  IF to_regclass('public.routines_pre_20260925180000') IS NULL
     OR to_regclass('public.notification_links_pre_20260925180000') IS NULL THEN
    RAISE EXCEPTION 'ABORT: the snapshots 20260925180000 took are missing, so its rollback cannot restore exactly';
  END IF;
  -- Something applied since may have redefined the function; restoring the
  -- snapshot would silently undo that too.
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public._notify_student_parents(uuid,text,text,text,text,text)'::regprocedure)
     !~ 'public\.parent_link_for\(_link\)' THEN
    RAISE EXCEPTION 'ABORT: _notify_student_parents is not the version 20260925180000 left. Roll back what changed it first.';
  END IF;
END
$pre$;

DO $restore$
BEGIN
  EXECUTE (SELECT definition FROM public.routines_pre_20260925180000
            WHERE routine = 'public._notify_student_parents(uuid,text,text,text,text,text)');
END
$restore$;

UPDATE public.notifications n
   SET link = p.link
  FROM public.notification_links_pre_20260925180000 p
 WHERE p.id = n.id;

DO $verify$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public._notify_student_parents(uuid,text,text,text,text,text)'::regprocedure)
     ~ 'parent_link_for' THEN
    RAISE EXCEPTION 'ROLLED BACK: _notify_student_parents still maps links';
  END IF;
  IF pg_get_functiondef('public._notify_student_parents(uuid,text,text,text,text,text)'::regprocedure)
     IS DISTINCT FROM (SELECT definition FROM public.routines_pre_20260925180000
                        WHERE routine = 'public._notify_student_parents(uuid,text,text,text,text,text)') THEN
    RAISE EXCEPTION 'ROLLED BACK: _notify_student_parents is not the definition it had before 20260925180000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_links_pre_20260925180000 p
               JOIN public.notifications n ON n.id = p.id
              WHERE n.link IS DISTINCT FROM p.link) THEN
    RAISE EXCEPTION 'ROLLED BACK: a parent notification did not get its old link back';
  END IF;
END
$verify$;

DROP FUNCTION public.parent_link_for(text);
DROP TABLE public.notification_links_pre_20260925180000;
DROP TABLE public.routines_pre_20260925180000;

DO $done$
BEGIN
  IF to_regprocedure('public.parent_link_for(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: parent_link_for is still defined';
  END IF;
  RAISE NOTICE 'rollback OK: parents are sent the link the caller wrote again, and every corrected link is back as it was';
END
$done$;
