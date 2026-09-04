-- ═══════════════════════════════════════════════════════════════════════════
-- Ruling 5 — resources_manage: teachers only, and only classes they teach
--
-- The live policy, verbatim:
--
--   resources_manage  PERMISSIVE  ALL  {authenticated}
--     USING = WITH CHECK =
--       same_school(school_id)
--       AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'teacher'))
--
-- §10.11: "Uploaded by teachers only — not admin, not principal … A teacher may
-- only upload to sections they teach."
--
-- Two defects, and the second is the larger one:
--
--   1. ADMIN IS ADMITTED. The spec excludes admin from uploading by name.
--
--   2. THE TEACHER HALF NAMES NO CLASS. `has_role(uid,'teacher')` tests a
--      MEMBERSHIP ROLE and nothing else. There is no class_id or section
--      predicate anywhere in the policy, so any teacher in the school could
--      INSERT, UPDATE or DELETE a resource targeted at any class in it —
--      including deleting another teacher's. The rule "only to sections they
--      teach" was not weakly enforced; it was not expressed at all.
--
-- This is G13's shape from the other side: reachability was reasoned about
-- from the ROLE, when the question the spec asks is about the RELATIONSHIP.
--
-- ── THE PREDICATE THIS REPO ALREADY HAS ───────────────────────────────────
--
--   teacher_teaches_class(_user_id uuid, _class_id uuid)  SECURITY DEFINER
--
-- It joins teacher_classes to teachers, fences on same_school, and — for the
-- caller's own id — additionally requires the ACTIVE membership to be the
-- teacher one, so a multi-role account cannot act as a teacher while switched
-- to another school. Nothing new is invented here.
--
-- ── class_id IS NULL IS A DENY, DELIBERATELY ──────────────────────────────
--
-- learning_resources.class_id is nullable. A row with no class cannot be shown
-- to be one of "the sections they teach", so it is refused rather than allowed
-- through on a NULL. The alternative — permitting untargeted resources — would
-- be a hole exactly the width of the rule.
--
-- The table holds 0 rows, so no existing resource is orphaned by that choice.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ───────────────────────────────────────
--
-- The rest of §10.11 is the Chunk 9 build, not this: the resource_type enum
-- still offers video/link/notes/worksheet/presentation where the spec allows
-- PDF and image only; there is no section target; created_by is not
-- uploaded_by_teacher_id; and "no view tracking" is currently true only
-- because nobody built any.
--
-- resources_select is also untouched. §10.11 restricts who UPLOADS, not who
-- reads, and widening or narrowing the read is a separate decision.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.teacher_teaches_class(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION
      'ABORT: teacher_teaches_class(uuid, uuid) does not exist; the new policy would admit nobody';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                  WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'teacher') THEN
    RAISE EXCEPTION 'ABORT: app_role has no ''teacher'' member';
  END IF;
END
$guard$;

DROP POLICY IF EXISTS resources_manage ON public.learning_resources;

CREATE POLICY resources_manage ON public.learning_resources
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND class_id IS NOT NULL
    AND public.teacher_teaches_class(auth.uid(), class_id)
  )
  WITH CHECK (
    public.same_school(school_id)
    AND public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND class_id IS NOT NULL
    AND public.teacher_teaches_class(auth.uid(), class_id)
  );

COMMENT ON POLICY resources_manage ON public.learning_resources IS
  '§10.11: teachers only (not admin, not principal), and only for classes they '
  'teach. class_id IS NULL is refused - an untargeted resource cannot be shown '
  'to belong to a section the uploader teaches.';

-- ── Assert the outcome, not the statements ────────────────────────────────
DO $verify$
DECLARE
  _using text; _check text; _n int;
BEGIN
  SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    INTO _using, _check
    FROM pg_policy
   WHERE polrelid = 'public.learning_resources'::regclass AND polname = 'resources_manage';

  IF _using IS NULL THEN
    RAISE EXCEPTION 'resources_manage is missing';
  END IF;

  -- admin must be gone from BOTH halves; a WITH CHECK that still admits admin
  -- would leave the INSERT path open while the USING half looked fixed.
  IF _using ILIKE '%''admin''%' OR _check ILIKE '%''admin''%' THEN
    RAISE EXCEPTION 'resources_manage still admits admin';
  END IF;

  IF _using NOT ILIKE '%teacher_teaches_class%' OR _check NOT ILIKE '%teacher_teaches_class%' THEN
    RAISE EXCEPTION 'resources_manage does not test the teaching relationship on both halves';
  END IF;

  IF _using NOT ILIKE '%class_id IS NOT NULL%' OR _check NOT ILIKE '%class_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'resources_manage would admit an untargeted resource';
  END IF;

  -- Exactly one permissive write path, or the fix is decorative.
  SELECT count(*) INTO _n FROM pg_policy
   WHERE polrelid = 'public.learning_resources'::regclass
     AND polpermissive AND polcmd IN ('a', 'w', 'd', '*');
  IF _n <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 permissive write policy on learning_resources, found %', _n;
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
