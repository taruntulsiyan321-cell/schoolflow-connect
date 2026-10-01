-- ═══════════════════════════════════════════════════════════════════════════
-- HOMEWORK BELONGS TO ITS CLASS'S SCHOOL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Found re-running CHUNK2_5_VERIFY (KNOWN_ISSUES 64), whose item 5 had rotted
-- on homework.section_subject_id. That item guarded a composite tenant key:
-- homework could not name a school other than its own. The homework redesign
-- (20260925110000) removed section_subject_id and the composite key went with
-- it, so nothing ties homework.school_id to its class any more. Measured on
-- live 2026-10-01: a homework row naming a class of one school and the id of
-- another is ACCEPTED.
--
-- It is reachable, not theoretical. "homework admin all" admits an admin on
-- school_id alone — has_role(admin) AND school_id IN my_accessible_school_ids()
-- — and never looks at class_id, so an admin can file homework under their
-- own school against another school's class: the row then sits in that
-- class's students' homework (they read it by class) while every staff screen
-- and fence treats it as the other school's.
--
-- The rule has one home now, the schema: homework (class_id, school_id) must
-- be a real (id, school_id) of classes. It REPLACES homework_class_id_fkey
-- rather than sitting beside it — the composite key already requires the class
-- to exist, and two foreign keys from homework to classes would make the app's
-- `classes(name, section)` embed ambiguous to PostgREST (PGRST201). ON DELETE
-- CASCADE is kept from the key it replaces. 0 of 54 live rows disagree today
-- (counting a class with no school as disagreeing: classes.school_id is nullable).
--
-- AND A CLASS CAN BE DELETED WITH ITS HOMEWORK. This migration's own proof
-- found that it could not, before or after the key: deleting a class cascades
-- to its homework, the homework's AFTER DELETE trigger (tg_emit_homework_event)
-- then writes a 'homework.deleted' event naming the class — which is already
-- gone — and academic_events_class_id_fkey refuses the whole delete. No screen
-- deletes a class today, so nobody has hit it. The event now names the class
-- only if it still exists. Nothing is lost by that: the router's class fan-out
-- (process_academic_event) recounts the students WHERE class_id = the event's
-- class, and a deleted class has none left to recount.
--
-- ROLLBACK: rollback/20261133000000_homework_belongs_to_its_class_school.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $pre$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM public.homework h JOIN public.classes c ON c.id = h.class_id
   WHERE c.school_id IS DISTINCT FROM h.school_id;
  IF _n <> 0 THEN
    RAISE EXCEPTION '% homework row(s) name a class of another school, or of none; they need a ruling before the key can hold', _n;
  END IF;
END
$pre$;

ALTER TABLE public.classes
  ADD CONSTRAINT classes_id_school_id_key UNIQUE (id, school_id);

ALTER TABLE public.homework
  DROP CONSTRAINT homework_class_id_fkey,
  ADD CONSTRAINT homework_class_in_its_school_fkey
    FOREIGN KEY (class_id, school_id) REFERENCES public.classes (id, school_id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT homework_class_in_its_school_fkey ON public.homework IS
  'Homework belongs to its class''s school: (class_id, school_id) is a real class of that school (20261133000000). Replaces homework_class_id_fkey; ON DELETE CASCADE kept.';

-- ── The event names the class only while it exists ─────────────────────────
DO $edit$
DECLARE _def text; _n int;
  _old constant text := E'_etype, ''homework'', _row.id, _row.school_id, NULL, _row.class_id, NULL,';
  _new constant text := E'_etype, ''homework'', _row.id, _row.school_id, NULL,\n'
    || E'    -- The class while it exists: a class being deleted takes its homework\n'
    || E'    -- with it, and an event naming the deleted class refused the delete\n'
    || E'    -- (20261133000000).\n'
    || E'    (SELECT c.id FROM public.classes c WHERE c.id = _row.class_id), NULL,';
BEGIN
  _def := replace(pg_get_functiondef('public.tg_emit_homework_event()'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _old, ''))) / length(_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'tg_emit_homework_event: expected its event call once, found %', _n; END IF;
  EXECUTE replace(_def, _old, _new);
END
$edit$;

-- ── THE PROOF ─────────────────────────────────────────────────────────────
--   1. a homework naming a real class and ANOTHER school is refused (23503);
--   2. CONTROL — the same row with the class's own school is accepted;
--   3. deleting a class takes its homework with it (the cascade kept), which
--      the event trigger used to refuse;
--   3b. CONTROL — a homework of a class that exists still names its class in
--      its event, so the fan-out is untouched;
--   4. exactly one foreign key runs from homework to classes.
DO $proof$
DECLARE _cls uuid; _sch uuid; _other uuid; _hw uuid; _n int;
BEGIN
  SELECT c.id, c.school_id INTO _cls, _sch
    FROM public.classes c WHERE EXISTS (SELECT 1 FROM public.schools s WHERE s.id <> c.school_id)
   ORDER BY c.created_at LIMIT 1;
  SELECT s.id INTO _other FROM public.schools s WHERE s.id <> _sch ORDER BY s.created_at LIMIT 1;
  IF _cls IS NULL OR _other IS NULL THEN RAISE EXCEPTION 'NO FIXTURE: need a class and a second school'; END IF;

  BEGIN
    INSERT INTO public.homework (class_id, subject, title, school_id, closes_at)
    VALUES (_cls, 'PROOF', 'cross-school', _other, now() + interval '1 day');
    RAISE EXCEPTION '1: homework naming another school''s class was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.homework (class_id, subject, title, school_id, closes_at)
    VALUES (_cls, 'PROOF', 'own-school', _sch, now() + interval '1 day') RETURNING id INTO _hw;
    IF _hw IS NULL THEN RAISE EXCEPTION '2: the own-school control was not inserted'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.academic_events e
                    WHERE e.entity_id = _hw AND e.event_type LIKE 'homework.%' AND e.class_id = _cls) THEN
      RAISE EXCEPTION '3b: a homework of an existing class no longer names its class in its event';
    END IF;

    -- 3, on a throwaway class of the same school.
    INSERT INTO public.classes (school_id, name, section, academic_year)
    SELECT _sch, 'PROOF class', 'Z', c.academic_year FROM public.classes c WHERE c.id = _cls
    RETURNING id INTO _cls;
    INSERT INTO public.homework (class_id, subject, title, school_id, closes_at)
    VALUES (_cls, 'PROOF', 'cascade', _sch, now() + interval '1 day') RETURNING id INTO _hw;
    DELETE FROM public.classes WHERE id = _cls;
    IF EXISTS (SELECT 1 FROM public.homework WHERE id = _hw) THEN
      RAISE EXCEPTION '3: deleting a class left its homework behind';
    END IF;
    RAISE EXCEPTION 'HOMEWORK_KEY_PROOF_OK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'HOMEWORK_KEY_PROOF_OK' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO _n FROM pg_constraint
   WHERE conrelid = 'public.homework'::regclass AND confrelid = 'public.classes'::regclass AND contype = 'f';
  IF _n <> 1 THEN RAISE EXCEPTION '4: % foreign keys from homework to classes; the app''s embed needs exactly one', _n; END IF;
END
$proof$;

NOTIFY pgrst, 'reload schema';

INSERT INTO public.schema_migrations (version)
VALUES ('20261133000000_homework_belongs_to_its_class_school')
ON CONFLICT (version) DO NOTHING;

COMMIT;
