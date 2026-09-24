-- ═══════════════════════════════════════════════════════════════════════════
-- The family is told "Homework accepted" or "Homework rejected" — once each
--
-- The product owner's ruling, 2026-09-13 (docs/gurukul-spec-rules.md, "Homework
-- — RULED 2026-09-13"): a teacher does exactly two things with a submission,
-- accept or reject it, and the student and their parents are told which, in
-- those words.
--
-- ── WHAT THEY WERE TOLD, MEASURED ON LIVE 2026-09-13 ─────────────────────────
--
-- rpc_homework_decide (20260925110000) emits `homework.reviewed` on acceptance
-- and `homework.returned` on rejection — the names the router already routed.
-- The router's branch for them, as 20260903160000 left it:
--
--     ELSIF e.event_type IN ('homework.reviewed', 'homework.graded', 'homework.returned')
--       -- KEPT: §10.15 — the parent sees the submission and the teacher's comment.
--       _title := CASE  'homework.returned' → 'Work returned'
--                       'homework.graded'   → 'Work graded'
--                       else                → 'Work reviewed'
--       PERFORM _notify_student_circle(student, 'homework', _title, …)
--
-- So an accepted hand-in read "Work reviewed", which does not say accepted; a
-- rejected one read "Work returned"; and a `homework.graded` route remained for
-- grades the model no longer has — nothing emits that event any more, and a
-- handler for an event that never fires reads as coverage. The comment names a
-- teacher's comment that no longer exists.
--
-- And `_notify_student_circle` tells a parent TWICE when the parent is linked
-- both by `students.parent_user_id` and through `parent_students` — which
-- db:verify-integrity guarantees for every legacy link. 20260918000000 fixed
-- exactly that in `_notify_student_parents` and left this second copy of "who a
-- student's parents are" behind it; every decision a teacher takes would reach
-- such a parent as two identical notifications.
--
-- ── WHAT CHANGES ──────────────────────────────────────────────────────────
--
-- 1. The router's decision branch, edited IN PLACE. The router is 400 lines
--    and this touches four of them, so the live definition is read back and
--    only those lines are rewritten — each anchor must be found exactly once,
--    or nothing is changed. Its line endings are kept as they are (live stores
--    it with CRLF, a database built from the migrations with LF). The branch
--    becomes:
--        'homework.reviewed', 'homework.returned'  →  'Homework accepted' /
--                                                    'Homework rejected'
--    The comment is rewritten where the definition carries it.
-- 2. `_notify_student_circle` tells the student, then hands the parents to
--    `_notify_student_parents` — the one home for a student's parents, which
--    reaches both links and tells each parent once. Every caller of the circle
--    (remarks, badges, battles, risk alerts, homework decisions) stops doubling.
--
-- Both definitions are copied first into `routines_pre_20260925150000`, and the
-- rollback puts back exactly what was there, whichever database it was.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Snapshot, so the rollback restores the definitions exactly ────────────

CREATE TABLE public.routines_pre_20260925150000 (
  routine text PRIMARY KEY,
  definition text NOT NULL,
  applied text
);
ALTER TABLE public.routines_pre_20260925150000 ENABLE ROW LEVEL SECURITY;
-- A new table in public is granted ALL to anon and authenticated by default.
REVOKE ALL ON public.routines_pre_20260925150000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20260925150000 IS
  'Rollback source for 20260925150000: the router and _notify_student_circle exactly as they were defined before it, and as it left them. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';

INSERT INTO public.routines_pre_20260925150000 (routine, definition)
SELECT r, pg_get_functiondef(r::regprocedure)
  FROM unnest(ARRAY['public.process_academic_event(uuid)',
                    'public._notify_student_circle(uuid,text,text,text,text,text)']) AS r;

-- ── 1. The router says what the teacher decided ───────────────────────────

CREATE FUNCTION pg_temp.occurrences(_haystack text, _needle text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$ SELECT (length(_haystack) - length(replace(_haystack, _needle, ''))) / length(_needle) $$;

DO $router$
DECLARE
  _def text := pg_get_functiondef('public.process_academic_event(uuid)'::regprocedure);
  _events_before constant text := $t$'homework.reviewed', 'homework.graded', 'homework.returned'$t$;
  _events_after  constant text := $t$'homework.reviewed', 'homework.returned'$t$;
  _graded_line   constant text := $t$[ \t]*WHEN e\.event_type = 'homework\.graded' THEN 'Work graded'\r?\n$t$;
  _returned_before constant text := $t$THEN 'Work returned'$t$;
  _returned_after  constant text := $t$THEN 'Homework rejected'$t$;
  _reviewed_before constant text := $t$ELSE 'Work reviewed'$t$;
  _reviewed_after  constant text := $t$ELSE 'Homework accepted'$t$;
  _kept_before constant text := $t$-- KEPT: §10.15 — the parent sees the submission and the teacher's comment.$t$;
  _kept_after  constant text := $t$-- KEPT: §10.15 — the student and their parents are told the teacher's decision: accepted or rejected.$t$;
  _n int;
BEGIN
  IF pg_temp.occurrences(_def, _events_before) <> 1
     OR pg_temp.occurrences(_def, _returned_before) <> 1
     OR pg_temp.occurrences(_def, _reviewed_before) <> 1
     OR pg_temp.occurrences(_def, _kept_before) > 1 THEN
    RAISE EXCEPTION 'ABORT: the router''s homework decision branch is not the one this migration was written against (events %, returned %, reviewed %, comment %). Re-read process_academic_event before editing it.',
      pg_temp.occurrences(_def, _events_before), pg_temp.occurrences(_def, _returned_before),
      pg_temp.occurrences(_def, _reviewed_before), pg_temp.occurrences(_def, _kept_before);
  END IF;
  SELECT count(*) INTO _n FROM regexp_matches(_def, _graded_line, 'g');
  IF _n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the router''s ''Work graded'' line was found % times, expected once', _n;
  END IF;

  _def := replace(_def, _events_before, _events_after);
  _def := regexp_replace(_def, _graded_line, '');
  _def := replace(_def, _returned_before, _returned_after);
  _def := replace(_def, _reviewed_before, _reviewed_after);
  _def := replace(_def, _kept_before, _kept_after);
  EXECUTE _def;
END
$router$;

-- ── 2. A parent is told once, through the one home for a student's parents ──

CREATE OR REPLACE FUNCTION public._notify_student_circle(_student_id uuid, _type text, _title text, _body text DEFAULT NULL::text, _icon text DEFAULT NULL::text, _link text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
BEGIN
  -- The student, then their parents. Who a student's parents are is decided in
  -- one place, _notify_student_parents: it reaches both the legacy
  -- students.parent_user_id and parent_students, and tells a parent found down
  -- both paths once.
  SELECT user_id INTO _uid FROM public.students WHERE id = _student_id;
  IF _uid IS NOT NULL THEN
    PERFORM public._notify(_uid, _type, _title, _body, _icon, _link);
  END IF;
  PERFORM public._notify_student_parents(_student_id, _type, _title, _body, _icon, _link);
END;
$$;

UPDATE public.routines_pre_20260925150000 SET applied = pg_get_functiondef(routine::regprocedure);

-- ── 3. Proof ──────────────────────────────────────────────────────────────

-- One savepoint that always ends by raising P0999, as in 20260925110000:
-- nothing the proof hands in, decides or notifies survives it.
DO $verify$
DECLARE
  _src text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.process_academic_event(uuid)'::regprocedure);
  _was text := (SELECT definition FROM public.routines_pre_20260925150000 WHERE routine = 'public.process_academic_event(uuid)');
  _graded text := substring(_was FROM $t$[ \t]*WHEN e\.event_type = 'homework\.graded' THEN 'Work graded'\r?\n$t$);
  _back text;
  _school uuid; _class uuid; _teacher uuid; _student uuid; _ustudent uuid; _parent uuid;
  _acc uuid; _rej uuid; _sub_acc uuid; _sub_rej uuid; _path text; _n int; _m int;
BEGIN
  -- 0. The branch reads the two decisions and no longer routes grades…
  IF pg_temp.occurrences(_src, 'Homework accepted') <> 1 OR pg_temp.occurrences(_src, 'Homework rejected') <> 1
     OR position('Work reviewed' IN _src) > 0 OR position('Work returned' IN _src) > 0
     OR position('Work graded' IN _src) > 0 OR position($t$'homework.graded'$t$ IN _src) > 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: the router does not name the two decisions, or still routes grades';
  END IF;
  --    …its comment no longer promises a teacher's comment, where it did…
  IF pg_temp.occurrences(_src, $t$-- KEPT: §10.15 — the student and their parents are told the teacher's decision: accepted or rejected.$t$)
     <> pg_temp.occurrences(_was, $t$-- KEPT: §10.15 — the parent sees the submission and the teacher's comment.$t$)
     OR position($t$the teacher's comment$t$ IN _src) > 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: the decision branch''s comment still promises the parent a teacher''s comment';
  END IF;
  --    …with one line ending throughout: every LF a CRLF, or no CR at all…
  IF position(E'\r' IN _src) > 0
     AND pg_temp.occurrences(_src, E'\r\n') <> pg_temp.occurrences(_src, E'\n') THEN
    RAISE EXCEPTION 'ROLLED BACK: the router''s line endings were mixed by the edit';
  END IF;
  --    …and nothing else in it moved: putting the old words and the graded line
  --    (as the old definition held it, indentation and line ending included)
  --    back into the new definition gives the old definition, character for
  --    character.
  _back := pg_get_functiondef('public.process_academic_event(uuid)'::regprocedure);
  _back := replace(_back, $t$-- KEPT: §10.15 — the student and their parents are told the teacher's decision: accepted or rejected.$t$,
                          $t$-- KEPT: §10.15 — the parent sees the submission and the teacher's comment.$t$);
  _back := replace(_back, $t$'homework.reviewed', 'homework.returned'$t$, $t$'homework.reviewed', 'homework.graded', 'homework.returned'$t$);
  _back := replace(_back, $t$THEN 'Homework rejected'$t$, $t$THEN 'Work returned'$t$);
  _back := replace(_back, substring(_graded FROM '^[ \t]*') || $t$ELSE 'Homework accepted'$t$,
                          _graded || substring(_graded FROM '^[ \t]*') || $t$ELSE 'Work reviewed'$t$);
  IF _back IS DISTINCT FROM _was THEN
    RAISE EXCEPTION 'ROLLED BACK: the router changed by more than its homework decision branch';
  END IF;

BEGIN
  -- A signed-in student with a signed-in parent, in a section with a signed-in
  -- teacher; chosen through memberships, not has_role/2 (no caller).
  SELECT s.school_id, s.class_id, t.user_id, s.id, s.user_id, p.user_id
    INTO _school, _class, _teacher, _student, _ustudent, _parent
    FROM public.students s
    JOIN public.teacher_classes tc ON tc.class_id = s.class_id
    JOIN public.teachers t ON t.id = tc.teacher_id AND t.user_id IS NOT NULL AND t.deleted_at IS NULL
    JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher'
                             AND m.status = 'active' AND m.school_id = s.school_id
    JOIN public.parent_students ps ON ps.student_id = s.id
    JOIN public.parents p ON p.id = ps.parent_id AND p.user_id IS NOT NULL AND p.user_id <> s.user_id
   WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL
   LIMIT 1;
  IF _parent IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need a signed-in student with a signed-in parent and a signed-in teacher';
  END IF;
  -- The parent is linked down BOTH paths, as every legacy link is.
  UPDATE public.students SET parent_user_id = _parent WHERE id = _student;

  UPDATE public.progression_xp_rules SET enabled = true
   WHERE code IN ('homework.submit', 'homework.before_deadline', 'homework.missed');
  _path := _ustudent::text || '/verify-20260925150000-work.pdf';
  INSERT INTO storage.objects (bucket_id, name) VALUES ('academic-files', _path);

  -- The teacher sets two homework; the student hands in both.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925150000] to accept', 'q', now() + interval '1 day', 'published')
  RETURNING id INTO _acc;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925150000] to reject', 'q', now() + interval '1 day', 'published')
  RETURNING id INTO _rej;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _ustudent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _sub_acc := (public.rpc_homework_submit(_acc, jsonb_build_object('path', _path, 'name', 'w.pdf', 'mime', 'application/pdf'))->>'id')::uuid;
  _sub_rej := (public.rpc_homework_submit(_rej, jsonb_build_object('path', _path, 'name', 'w.pdf', 'mime', 'application/pdf'))->>'id')::uuid;
  RESET ROLE;

  -- 1. Accepted: the student and the parent each read "Homework accepted",
  --    once, about that homework.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_homework_decide(_sub_acc, 'accepted');
  PERFORM public.rpc_homework_decide(_sub_rej, 'rejected');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  -- Whether the queue is drained on insert or by the scheduler, it is drained.
  LOOP EXIT WHEN public.process_pending_academic_events(500) = 0; END LOOP;

  IF EXISTS (SELECT 1 FROM public.academic_events
              WHERE entity_id IN (_sub_acc, _sub_rej) AND status <> 'processed') THEN
    RAISE EXCEPTION 'ROLLED BACK: a decision event was not processed by the router';
  END IF;
  SELECT count(*) FILTER (WHERE user_id = _ustudent), count(*) FILTER (WHERE user_id = _parent) INTO _n, _m
    FROM public.notifications
   WHERE title = 'Homework accepted' AND body = '[verify 20260925150000] to accept' AND type = 'homework';
  IF (_n, _m) IS DISTINCT FROM (1, 1) THEN
    RAISE EXCEPTION 'ROLLED BACK: "Homework accepted" reached the student % time(s) and the parent % time(s); expected once each', _n, _m;
  END IF;

  -- 2. Rejected: "Homework rejected", once each.
  SELECT count(*) FILTER (WHERE user_id = _ustudent), count(*) FILTER (WHERE user_id = _parent) INTO _n, _m
    FROM public.notifications
   WHERE title = 'Homework rejected' AND body = '[verify 20260925150000] to reject' AND type = 'homework';
  IF (_n, _m) IS DISTINCT FROM (1, 1) THEN
    RAISE EXCEPTION 'ROLLED BACK: "Homework rejected" reached the student % time(s) and the parent % time(s); expected once each', _n, _m;
  END IF;

  -- 3. A grade event, were anything to raise one, tells nobody anything.
  SELECT count(*) INTO _n FROM public.notifications WHERE user_id IN (_ustudent, _parent);
  PERFORM public.emit_academic_event('homework.graded', 'homework_submission', _sub_acc, _school, _student, _class, NULL,
                                     jsonb_build_object('title', '[verify 20260925150000] graded'));
  LOOP EXIT WHEN public.process_pending_academic_events(500) = 0; END LOOP;
  IF (SELECT count(*) FROM public.notifications WHERE user_id IN (_ustudent, _parent)) <> _n THEN
    RAISE EXCEPTION 'ROLLED BACK: a homework.graded event still notified the family';
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify fixtures rolled back';
EXCEPTION WHEN SQLSTATE 'P0999' THEN
  NULL;
END;

  IF EXISTS (SELECT 1 FROM public.homework WHERE title LIKE '[verify 20260925150000]%')
     OR EXISTS (SELECT 1 FROM public.notifications WHERE body LIKE '[verify 20260925150000]%') THEN
    RAISE EXCEPTION 'ROLLED BACK: verify fixtures survived the savepoint';
  END IF;

  RAISE NOTICE 'verify OK: the router names the two decisions and no longer routes grades, with nothing else in it changed and its line endings kept; an accepted and a rejected hand-in each reach the student and a parent linked down both paths exactly once, in those words; a grade event tells nobody — and nothing the proof did survived';
END
$verify$;
