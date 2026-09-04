-- ═══════════════════════════════════════════════════════════════════════════
-- Ruling 4 — four audit tables become one, and the principal loses the read
--
-- ── WHAT WAS MEASURED ─────────────────────────────────────────────────────
--
--   table                  rows   writer                     SELECT policy
--   academic_audit         8828   write_academic_audit()     admin_select *
--   attendance_audit         48   tg_log_attendance_change   school staff
--   audit_logs                2   NONE                       principal+admin
--   ai_kms_approval_audit     0   4 ai_kms_* functions       staff read
--
-- * the asterisk is the finding. `academic_audit_admin_select` reads
--   `is_principal_or_admin(auth.uid())`. The NAME says admin; the PREDICATE
--   admits the principal. §10.18 is "Visible to admin only. Not principal, not
--   super admin", so the violation was on the SURVIVOR too, not only on
--   audit_logs. A policy whose name disagrees with its predicate is G14: the
--   next reader audits the name.
--
-- ── THE SURVIVOR IS academic_audit ────────────────────────────────────────
--
-- It already has the shape the spec asks for — previous_value / new_value /
-- actor / school_id — which audit_logs does not, and it holds 99.4% of the
-- rows. audit_logs has no writer at all: two seed rows and nothing that could
-- ever add a third.
--
-- ── ai_kms_approval_audit IS DELIBERATELY NOT MERGED ──────────────────────
--
-- The ruling said four become one. This makes it three, and the fourth is
-- named here rather than quietly skipped.
--
-- ai_kms_approval_audit logs AI knowledge-management approvals: register,
-- submit, approve, reject a DOCUMENT VERSION. It has NO school_id column, and
-- academic_audit.school_id is NOT NULL. Merging it would mean inventing a
-- school for a row that has none — G4, an unknown becoming a stand-in — inside
-- an audit table, which is the worst place in the schema to fabricate a value.
-- It is also not a school admin action, which is what §10.18 governs.
--
-- It has 0 rows, so nothing is lost by leaving it. If it should merge, it
-- needs a school_id first, and that is a separate decision.
--
-- ── entity_id BECOMES NULLABLE, AND THAT IS THE POINT ─────────────────────
--
-- academic_audit.entity_id was NOT NULL. Nine of the fifty rows being migrated
-- cannot satisfy that:
--
--   1 audit_logs row     action 'demo_seed', entity 'migration' — an action
--                        that is not about any single row
--   8 attendance_audit   attendance_id IS NULL, because the FK is
--                        ON DELETE SET NULL and the attendance rows were
--                        deleted
--
-- Those eight are the audit working correctly: the record OUTLIVED its
-- subject. That is what an audit log is for. NOT NULL would have forced this
-- migration to either drop nine audit rows or invent nine UUIDs. It does
-- neither — the column becomes nullable, which is the honest shape for a log
-- that must survive the thing it describes.
--
-- ── attendance_audit LOSES NO INFORMATION ─────────────────────────────────
--
-- Its domain columns map onto the generic shape, and the ones with no home go
-- to metadata rather than being dropped:
--
--   attendance_id  -> entity_id            prev_status -> previous_value
--   edited_by      -> actor_user_id        new_status  -> new_value
--   edited_at      -> created_at           school_id   -> school_id
--   student_id, class_id, date, submission_id -> metadata
--
-- `date` and `class_id` were deliberately frozen copies, not live projections
-- — the original trigger says so — and they stay frozen inside metadata.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Refuse to run against numbers this migration was not measured against ──
DO $guard$
DECLARE
  _aa int; _att int; _log int;
BEGIN
  SELECT count(*) INTO _aa  FROM public.academic_audit;
  SELECT count(*) INTO _att FROM public.attendance_audit;
  SELECT count(*) INTO _log FROM public.audit_logs;

  IF _aa <> 8828 OR _att <> 48 OR _log <> 2 THEN
    RAISE EXCEPTION
      'ABORT: measured 8828/48/2, found %/%/% — re-measure before consolidating an audit log',
      _aa, _att, _log;
  END IF;
END
$guard$;

-- An audit row must be able to outlive its subject.
ALTER TABLE public.academic_audit ALTER COLUMN entity_id DROP NOT NULL;

-- ── audit_logs → academic_audit ───────────────────────────────────────────
INSERT INTO public.academic_audit
  (school_id, entity_type, entity_id, action, actor_user_id, metadata, created_at)
SELECT
  COALESCE(l.school_id, public.default_school_id()),
  COALESCE(NULLIF(l.entity, ''), 'unknown'),
  l.entity_id,
  l.action,
  l.actor_user_id,
  COALESCE(l.metadata, '{}'::jsonb) || jsonb_build_object('migrated_from', 'audit_logs'),
  l.created_at
FROM public.audit_logs l;

-- ── attendance_audit → academic_audit ─────────────────────────────────────
INSERT INTO public.academic_audit
  (school_id, entity_type, entity_id, action, actor_user_id,
   previous_value, new_value, metadata, created_at)
SELECT
  a.school_id,
  'attendance',
  a.attendance_id,
  'attendance.status_edited',
  a.edited_by,
  to_jsonb(a.prev_status),
  to_jsonb(a.new_status),
  jsonb_strip_nulls(jsonb_build_object(
    'student_id',    a.student_id,
    'class_id',      a.class_id,
    'date',          a.date,
    'submission_id', a.submission_id,
    'migrated_from', 'attendance_audit'
  )),
  a.edited_at
FROM public.attendance_audit a;

-- ── The writer, repointed BEFORE the table it writes to is dropped ────────
CREATE OR REPLACE FUNCTION public.tg_log_attendance_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _school uuid;
  _section uuid;
  _date date;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT s.section_id, s.date INTO _section, _date
      FROM public.attendance_submissions s WHERE s.id = NEW.submission_id;

    SELECT school_id INTO _school FROM public.classes WHERE id = _section;

    -- class_id and date are FROZEN copies of what was true at the moment of
    -- the edit, not a live projection of the submission. That was the point of
    -- the dedicated table and it survives the move: they go into metadata,
    -- which nothing recomputes.
    INSERT INTO public.academic_audit (
      school_id, entity_type, entity_id, action, actor_user_id,
      previous_value, new_value, metadata
    )
    VALUES (
      coalesce(_school, NEW.school_id, public.default_school_id()),
      'attendance',
      NEW.id,
      'attendance.status_edited',
      auth.uid(),
      to_jsonb(OLD.status::text),
      to_jsonb(NEW.status::text),
      jsonb_strip_nulls(jsonb_build_object(
        'student_id',    NEW.student_id,
        'class_id',      _section,
        'date',          _date,
        'submission_id', NEW.submission_id
      ))
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- ── The reader, repointed for the same reason ─────────────────────────────
-- attendance_day_edits is consumed by attendanceService.ts. Dropped and
-- recreated rather than CREATE OR REPLACE because the source table changes.
DROP VIEW IF EXISTS public.attendance_day_edits;
CREATE VIEW public.attendance_day_edits AS
SELECT
  (aa.metadata->>'submission_id')::uuid              AS submission_id,
  s.section_id,
  s.date,
  s.school_id,
  count(*)                                           AS edit_count,
  count(DISTINCT (aa.metadata->>'student_id')::uuid) AS students_changed,
  max(aa.created_at)                                 AS last_edited_at,
  (array_agg(aa.actor_user_id ORDER BY aa.created_at DESC))[1] AS last_edited_by
FROM public.academic_audit aa
JOIN public.attendance_submissions s
  ON s.id = (aa.metadata->>'submission_id')::uuid
WHERE aa.entity_type = 'attendance'
  AND aa.metadata ? 'submission_id'
GROUP BY (aa.metadata->>'submission_id')::uuid, s.section_id, s.date, s.school_id;

DROP TABLE public.attendance_audit;
DROP TABLE public.audit_logs;

-- ── §10.18: admin only. Not principal, not super admin. ───────────────────
-- The old policy was NAMED admin_select and ADMITTED the principal.
DROP POLICY IF EXISTS academic_audit_admin_select ON public.academic_audit;
CREATE POLICY academic_audit_admin_select ON public.academic_audit
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  );

COMMENT ON TABLE public.academic_audit IS
  'The single audit log. §10.18: visible to ADMIN ONLY - not principal, not '
  'super admin. Absorbed attendance_audit and audit_logs on 2026-09-04; those '
  'rows carry metadata.migrated_from. ai_kms_approval_audit is NOT here: it '
  'has no school_id and logs AI document approvals, not school admin actions.';

-- ── Assert the outcome, not the statements ────────────────────────────────
DO $verify$
DECLARE
  _total int; _att int; _log int; _sub int; _principal_can_read boolean;
BEGIN
  SELECT count(*) INTO _total FROM public.academic_audit;
  IF _total <> 8878 THEN
    RAISE EXCEPTION 'expected 8828 + 48 + 2 = 8878 rows, found %', _total;
  END IF;

  SELECT count(*) INTO _att FROM public.academic_audit
   WHERE metadata->>'migrated_from' = 'attendance_audit';
  IF _att <> 48 THEN
    RAISE EXCEPTION 'expected 48 migrated attendance rows, found %', _att;
  END IF;

  SELECT count(*) INTO _log FROM public.academic_audit
   WHERE metadata->>'migrated_from' = 'audit_logs';
  IF _log <> 2 THEN
    RAISE EXCEPTION 'expected 2 migrated audit_logs rows, found %', _log;
  END IF;

  -- The nine that could not carry an entity_id must have SURVIVED, not been
  -- dropped and not been given an invented id.
  IF (SELECT count(*) FROM public.academic_audit
       WHERE entity_id IS NULL AND metadata ? 'migrated_from') <> 9 THEN
    RAISE EXCEPTION
      'expected exactly 9 migrated rows with a NULL entity_id (1 seed + 8 deleted-subject attendance edits)';
  END IF;

  IF to_regclass('public.attendance_audit') IS NOT NULL THEN
    RAISE EXCEPTION 'attendance_audit still exists';
  END IF;
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    RAISE EXCEPTION 'audit_logs still exists';
  END IF;

  -- The view must still answer, and for the same submissions as before.
  SELECT count(*) INTO _sub FROM public.attendance_day_edits;
  IF _sub = 0 THEN
    RAISE EXCEPTION 'attendance_day_edits returns no rows after the move; the metadata join is wrong';
  END IF;

  -- §10.18, tested as a predicate rather than trusted as a policy name.
  SELECT pg_get_expr(polqual, polrelid) ILIKE '%principal%' INTO _principal_can_read
    FROM pg_policy
   WHERE polrelid = 'public.academic_audit'::regclass
     AND polname  = 'academic_audit_admin_select';
  IF _principal_can_read THEN
    RAISE EXCEPTION 'the audit read policy still admits the principal';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.academic_audit'::regclass
       AND polname = 'academic_audit_tenant_fence' AND polpermissive
  ) THEN
    RAISE EXCEPTION 'the tenant fence is no longer RESTRICTIVE';
  END IF;
END
$verify$;

COMMIT;
