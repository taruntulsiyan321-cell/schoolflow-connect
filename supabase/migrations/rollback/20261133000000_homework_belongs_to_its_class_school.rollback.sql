-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: homework's class key without its school
--
-- Puts back the single-column homework_class_id_fkey (ON DELETE CASCADE) and
-- drops the composite key and the classes (id, school_id) key it needed. Note
-- what you are restoring: a homework row may again name a class of another
-- school, and the admin policy admits one; and a class with homework can again
-- not be deleted, because its homework's delete event names the deleted class
-- (see 20261133000000's header).
--
-- Undoes: 20261133000000_homework_belongs_to_its_class_school.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- The event call as it was: naming the class whether or not it still exists.
DO $edit$
DECLARE _def text; _n int;
  _new constant text := E'_etype, ''homework'', _row.id, _row.school_id, NULL,\n'
    || E'    -- The class while it exists: a class being deleted takes its homework\n'
    || E'    -- with it, and an event naming the deleted class refused the delete\n'
    || E'    -- (20261133000000).\n'
    || E'    (SELECT c.id FROM public.classes c WHERE c.id = _row.class_id), NULL,';
  _old constant text := E'_etype, ''homework'', _row.id, _row.school_id, NULL, _row.class_id, NULL,';
BEGIN
  _def := replace(pg_get_functiondef('public.tg_emit_homework_event()'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _new, ''))) / length(_new);
  IF _n <> 1 THEN RAISE EXCEPTION 'tg_emit_homework_event: expected the 20261133000000 call once, found %', _n; END IF;
  EXECUTE replace(_def, _new, _old);
END
$edit$;

ALTER TABLE public.homework
  DROP CONSTRAINT homework_class_in_its_school_fkey,
  ADD CONSTRAINT homework_class_id_fkey
    FOREIGN KEY (class_id) REFERENCES public.classes (id) ON DELETE CASCADE;

ALTER TABLE public.classes DROP CONSTRAINT classes_id_school_id_key;

NOTIFY pgrst, 'reload schema';

DELETE FROM public.schema_migrations WHERE version = '20261133000000_homework_belongs_to_its_class_school';

COMMIT;
