-- ═══════════════════════════════════════════════════════════════════════════
-- Resources: confine the read to the class, and stop a deleted class stranding
-- a resource forever
--
-- Two defects measured in probe9 and in the end-to-end run on 2026-09-04.
-- Ruled on 2026-09-04: the earlier "do not change any policy" instruction was
-- explicitly lifted for both.
--
-- ── 1. THE READ WAS SCHOOL-WIDE (KNOWN_ISSUES 6) ──────────────────────────
--
-- resources_select was:
--
--   same_school(school_id) AND (is_published OR has_role(admin) OR has_role(teacher))
--
-- No class predicate anywhere. probe9 measured a student of 12-A reading a
-- resource targeted at 10-A by querying the table directly. The class scoping
-- users actually experience came only from ResourceService.listForStudent's
-- `or(class_id.eq.<mine>, class_id.is.null)` filter — i.e. it lived in the
-- client, where it is a convenience, not a boundary.
--
-- §10.11 states who UPLOADS and is silent on who reads, so this was unspecified
-- rather than violated. The ruling is that "targeted at a specific class" binds
-- the read too.
--
-- Who can now see a published resource:
--   - a student of the target class            student_class_id(auth.uid())
--   - a parent of a child in that class        is_class_of_my_child(class_id)
--   - anything with class_id IS NULL           school-wide material
--   - staff, published or not                  admin / principal / teacher
--
-- Both helpers already exist and are used by other policies; nothing new is
-- invented here. PRINCIPAL IS ADDED to the staff branch: previously a principal
-- saw published rows only through the `is_published` disjunct, and removing
-- that disjunct would have left them seeing nothing at all. That is a
-- deliberate widening for unpublished rows, not an accident of the rewrite.
--
-- ── 2. A DELETED CLASS STRANDED ITS RESOURCES (KNOWN_ISSUES 8) ────────────
--
-- learning_resources.class_id is nullable and its FK is ON DELETE SET NULL, but
-- every write policy required `class_id IS NOT NULL`. Deleting a class
-- therefore left its resources readable but editable and deletable by NOBODY —
-- not even the teacher who uploaded them. Unreachable-for-write rows that only
-- a service-role key could clear.
--
-- §10.11 says "Deletable by the uploader. Permanent deletion — no trash." It
-- attaches no class condition to that at all, so the old delete policy was
-- over-restrictive against the spec as well as leaving orphans. Delete now
-- keys on the uploader, which is what the spec actually says.
--
-- Update keeps the teaches-this-class test for the row's CURRENT class, so a
-- teacher cannot edit a resource for a class they do not teach, and the WITH
-- CHECK still refuses to leave one untargeted — but a stranded row (class_id
-- IS NULL) can now be repaired or removed by the person who uploaded it.
--
-- Update is additionally narrowed to `created_by = auth.uid()`. Previously any
-- teacher of the class could edit any other teacher's resource, which does not
-- match the uploader-owns shape the delete rule states. Nothing calls update
-- today, so this narrows a path that has no users rather than removing one.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.student_class_id(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: student_class_id(uuid) is missing; the new read would admit no student';
  END IF;
  IF to_regprocedure('public.is_class_of_my_child(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: is_class_of_my_child(uuid) is missing; the new read would admit no parent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                  WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'principal') THEN
    RAISE EXCEPTION 'ABORT: app_role has no ''principal'' member';
  END IF;
END
$guard$;

-- ── read ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS resources_select ON public.learning_resources;

CREATE POLICY resources_select ON public.learning_resources
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role)
      OR (
        is_published
        AND (
          class_id IS NULL
          OR class_id = public.student_class_id(auth.uid())
          OR public.is_class_of_my_child(class_id)
        )
      )
    )
  );

COMMENT ON POLICY resources_select ON public.learning_resources IS
  '10.11: a resource targeted at a class is readable by that class, its parents, and staff. class_id IS NULL means school-wide.';

-- ── update ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS resources_update ON public.learning_resources;

CREATE POLICY resources_update ON public.learning_resources
  FOR UPDATE TO authenticated
  USING (
    public.same_school(school_id)
    AND public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND created_by = auth.uid()
    AND (
      class_id IS NULL
      OR public.teacher_teaches_class(auth.uid(), class_id)
    )
  )
  WITH CHECK (
    public.same_school(school_id)
    AND public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND created_by = auth.uid()
    AND class_id IS NOT NULL
    AND public.teacher_teaches_class(auth.uid(), class_id)
  );

COMMENT ON POLICY resources_update ON public.learning_resources IS
  '10.11: the uploader may edit their own. A row orphaned by a deleted class (class_id IS NULL) can be repaired; it cannot be left untargeted.';

-- ── delete ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS resources_delete ON public.learning_resources;

CREATE POLICY resources_delete ON public.learning_resources
  FOR DELETE TO authenticated
  USING (
    public.same_school(school_id)
    AND public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND created_by = auth.uid()
  );

COMMENT ON POLICY resources_delete ON public.learning_resources IS
  '10.11 "Deletable by the uploader" — no class condition, so a resource orphaned by a deleted class is still removable by the person who uploaded it.';

DO $verify$
DECLARE
  _sel text; _upd_u text; _upd_c text; _del text; _n int;
BEGIN
  SELECT pg_get_expr(polqual, polrelid) INTO _sel FROM pg_policy
   WHERE polrelid = 'public.learning_resources'::regclass AND polname = 'resources_select';
  SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    INTO _upd_u, _upd_c FROM pg_policy
   WHERE polrelid = 'public.learning_resources'::regclass AND polname = 'resources_update';
  SELECT pg_get_expr(polqual, polrelid) INTO _del FROM pg_policy
   WHERE polrelid = 'public.learning_resources'::regclass AND polname = 'resources_delete';

  IF _sel IS NULL OR _upd_u IS NULL OR _del IS NULL THEN
    RAISE EXCEPTION 'one of resources_select / resources_update / resources_delete is missing';
  END IF;

  -- The read must actually name a class now, or the fix is decorative.
  IF _sel NOT ILIKE '%student_class_id%' OR _sel NOT ILIKE '%is_class_of_my_child%' THEN
    RAISE EXCEPTION 'resources_select does not scope the read to a class';
  END IF;
  IF _sel NOT ILIKE '%same_school%' THEN
    RAISE EXCEPTION 'resources_select lost the school predicate';
  END IF;

  -- Delete must NOT carry a class condition, or orphans stay stranded.
  IF _del ILIKE '%teacher_teaches_class%' OR _del ILIKE '%class_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'resources_delete still conditions on the class; orphans would stay unreachable';
  END IF;
  IF _del NOT ILIKE '%created_by = auth.uid()%' THEN
    RAISE EXCEPTION 'resources_delete is not uploader-only';
  END IF;

  -- Update must still refuse to leave a row untargeted.
  IF _upd_c NOT ILIKE '%class_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'resources_update WITH CHECK would admit an untargeted resource';
  END IF;
  IF _upd_u ILIKE '%class_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'resources_update USING still blocks orphan repair';
  END IF;

  -- Insert is untouched and must remain the only unconditional write gate.
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.learning_resources'::regclass
                    AND polname = 'resources_write' AND polcmd = 'a') THEN
    RAISE EXCEPTION 'resources_write (INSERT) went missing';
  END IF;

  SELECT count(*) INTO _n FROM pg_policy
   WHERE polrelid = 'public.learning_resources'::regclass
     AND polpermissive AND polcmd IN ('a', 'w', 'd', '*');
  IF _n <> 3 THEN
    RAISE EXCEPTION 'expected exactly 3 permissive write policies on learning_resources, found %', _n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.learning_resources'::regclass
                    AND polname = 'learning_resources_tenant_fence'
                    AND polpermissive = false) THEN
    RAISE EXCEPTION 'the RESTRICTIVE tenant fence is missing';
  END IF;
END
$verify$;

COMMIT;
