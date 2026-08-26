-- =====================================================================
-- CHUNK 4 — ATTENDANCE
--
-- "The absence of a row in attendance_submissions is what 'not marked' means."
-- Until now the app inferred marking from the presence of per-student rows,
-- which is why an unmarked section could render as 0.0% instead of "—".
--
-- RECONCILIATION (same adapt-don't-duplicate pattern approved for Chunk 3):
--     doc's `attendance_records` == existing `attendance`       (gains submission_id)
--     doc's `attendance_edits`   == existing `attendance_audit` (gains submission_id)
--     doc's `attendance_submissions` is genuinely new.
-- Creating a second per-student table beside `attendance` would have been the
-- exact two-sources-of-truth shape G9 forbids.
--
-- STATUS COLLAPSE — confirmed before building, not guessed.
-- Locked decision 5 and Chunk 4 both say "Present/absent only. No late, no
-- half-day." The enum carried five values and live data used four:
--   present 131 · absent 9 · late 4 · leave 3
-- Decision taken: late -> present (they were physically in the room);
-- leave -> absent (they were not). The reason for an approved absence is not
-- lost — leave_requests owns it (Chunk 8) — so nothing is destroyed by folding
-- the register down to physical presence.
--
-- G9 — the stale copy this chunk creates, declared rather than hidden:
-- once a submission row owns (section_id, date), `attendance.class_id` and
-- `attendance.date` are a second copy of that fact, and `attendance_locks`
-- keys on (class_id, date) as a third. Authority is attendance_submissions.
-- Converging the ~20 files and 10 SQL functions that read the columns, and
-- then dropping them, is its own chunk — scoped exactly like 4.5 did for
-- roll_number. Until then divergence is made IMPOSSIBLE rather than merely
-- unlikely: a trigger rejects any attendance row whose class_id/date disagree
-- with its submission. That is a consistency guard, not a sync — nothing is
-- copied, a mismatch is simply refused at write time.
--
-- Reverse: supabase/migrations/rollback/20260826170000_chunk4_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — collapse the register to present/absent
-- ---------------------------------------------------------------------

-- The 24-hour edit lock (tg_reject_locked_attendance_write) exists to stop a
-- TEACHER editing a submitted register after the window closes. It is not
-- meant to freeze a migration correcting a product-rule violation, and one of
-- the seven affected rows sits under a lock. Disabled for the length of this
-- migration only — it is BEFORE INSERT OR UPDATE on every column, so the
-- submission_id backfill in Section 3 trips it too. DISABLE TRIGGER is
-- transactional, so a
-- failure anywhere below rolls the re-enable back with everything else.
ALTER TABLE public.attendance DISABLE TRIGGER trg_attendance_reject_if_locked;

UPDATE public.attendance SET status = 'present' WHERE status::text = 'late';
UPDATE public.attendance SET status = 'absent'  WHERE status::text = 'leave';


DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.attendance WHERE status::text NOT IN ('present','absent');
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 4: % attendance row(s) still hold a status outside present/absent', _n;
  END IF;
END $$;

-- The enum type keeps its five labels (Postgres cannot drop enum values without
-- rewriting the type, and other tables may reference it). The CHECK is what
-- makes the product rule real: a value the product says does not exist can no
-- longer be written.
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_status_present_absent_only;
ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_status_present_absent_only
  CHECK (status::text IN ('present', 'absent'));

COMMENT ON COLUMN public.attendance.status IS
  'Present/absent only (locked decision 5). late/leave were folded in on 2026-08-26: late->present, leave->absent. Approved leave is owned by leave_requests, not by the register.';

ALTER TABLE public.attendance ALTER COLUMN school_id SET NOT NULL;


-- ---------------------------------------------------------------------
-- SECTION 2 — attendance_submissions: the single most important table
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.attendance_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  section_id       uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  date             date NOT NULL,
  submitted_by     uuid,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  edited_by        uuid,
  edited_at        timestamptz,
  CONSTRAINT attendance_submissions_section_date_key UNIQUE (section_id, date),
  -- Lets attendance rows carry a composite FK and inherit the institution, so a
  -- record can never be attached to another institution's submission.
  CONSTRAINT attendance_submissions_id_school_key UNIQUE (id, school_id)
);

COMMENT ON TABLE public.attendance_submissions IS
  'One row per section per day. The ABSENCE of a row is what "not marked" means — never infer marking from the presence of per-student rows. Unmarked and past = holiday, excluded from the denominator (locked decision 5).';

CREATE INDEX IF NOT EXISTS attendance_submissions_school_idx  ON public.attendance_submissions (school_id);
CREATE INDEX IF NOT EXISTS attendance_submissions_section_idx ON public.attendance_submissions (section_id, date);

-- A submission must sit in the same institution as its section.
CREATE OR REPLACE FUNCTION public.tg_attendance_submissions_same_institution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _section_school uuid;
BEGIN
  SELECT c.school_id INTO _section_school FROM public.classes c WHERE c.id = NEW.section_id;
  IF _section_school IS NULL THEN
    RAISE EXCEPTION 'section % does not exist', NEW.section_id;
  END IF;
  IF _section_school IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'section % belongs to institution %, not %',
      NEW.section_id, _section_school, NEW.school_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_submissions_same_institution ON public.attendance_submissions;
CREATE TRIGGER trg_attendance_submissions_same_institution
  BEFORE INSERT OR UPDATE OF section_id, school_id ON public.attendance_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_attendance_submissions_same_institution();

REVOKE EXECUTE ON FUNCTION public.tg_attendance_submissions_same_institution() FROM public, anon, authenticated;

-- Backfill one submission per (section, date) that already has records.
-- submitted_by/submitted_at come from the records themselves — nothing invented.
INSERT INTO public.attendance_submissions
  (school_id, academic_year_id, section_id, date, submitted_by, submitted_at)
SELECT a.school_id,
       (SELECT ay.id FROM public.academic_years ay
         WHERE ay.school_id = a.school_id AND ay.is_current LIMIT 1),
       a.class_id,
       a.date,
       (ARRAY_AGG(a.marked_by) FILTER (WHERE a.marked_by IS NOT NULL))[1],
       MIN(a.created_at)
  FROM public.attendance a
 GROUP BY a.school_id, a.class_id, a.date
ON CONFLICT (section_id, date) DO NOTHING;


-- ---------------------------------------------------------------------
-- SECTION 3 — attendance becomes the doc's attendance_records
-- ---------------------------------------------------------------------

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS submission_id uuid;

UPDATE public.attendance a
   SET submission_id = s.id
  FROM public.attendance_submissions s
 WHERE a.submission_id IS NULL
   AND s.section_id = a.class_id
   AND s.date = a.date;

DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.attendance WHERE submission_id IS NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 4: % attendance row(s) could not be matched to a submission', _n;
  END IF;
END $$;

ALTER TABLE public.attendance ALTER COLUMN submission_id SET NOT NULL;

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_submission_fk;
ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_submission_fk
  FOREIGN KEY (submission_id, school_id)
  REFERENCES public.attendance_submissions (id, school_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS attendance_submission_idx ON public.attendance (submission_id);

COMMENT ON COLUMN public.attendance.class_id IS
  'DEPRECATED — attendance_submissions.section_id is the authority. Kept only until the ~20 files and 10 SQL functions reading it are converged (G9). A trigger refuses any row that disagrees with its submission. Do not add new readers.';
COMMENT ON COLUMN public.attendance.date IS
  'DEPRECATED — attendance_submissions.date is the authority. See attendance.class_id.';

-- Divergence is refused, not reconciled. Nothing is copied either way.
CREATE OR REPLACE FUNCTION public.tg_attendance_matches_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _sec uuid; _d date;
BEGIN
  SELECT s.section_id, s.date INTO _sec, _d
    FROM public.attendance_submissions s WHERE s.id = NEW.submission_id;

  IF _sec IS NULL THEN
    RAISE EXCEPTION 'attendance submission % does not exist', NEW.submission_id;
  END IF;

  IF NEW.class_id IS DISTINCT FROM _sec OR NEW.date IS DISTINCT FROM _d THEN
    RAISE EXCEPTION
      'attendance row names section %/date %, but its submission is section %/date % (attendance_submissions is the authority)',
      NEW.class_id, NEW.date, _sec, _d;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_matches_submission ON public.attendance;
CREATE TRIGGER trg_attendance_matches_submission
  BEFORE INSERT OR UPDATE OF class_id, date, submission_id ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_attendance_matches_submission();

REVOKE EXECUTE ON FUNCTION public.tg_attendance_matches_submission() FROM public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SECTION 4 — attendance_audit becomes the doc's attendance_edits
-- ---------------------------------------------------------------------

ALTER TABLE public.attendance_audit
  ADD COLUMN IF NOT EXISTS submission_id uuid REFERENCES public.attendance_submissions(id) ON DELETE CASCADE;

UPDATE public.attendance_audit e
   SET submission_id = s.id
  FROM public.attendance_submissions s
 WHERE e.submission_id IS NULL
   AND s.section_id = e.class_id
   AND s.date = e.date;

CREATE INDEX IF NOT EXISTS attendance_audit_submission_idx ON public.attendance_audit (submission_id);

COMMENT ON TABLE public.attendance_audit IS
  'The doc''s `attendance_edits`: old value, new value, who, when. prev_status/new_status are this codebase''s names for old_status/new_status.';


-- Every write to public.attendance is done; the edit lock goes back on.
ALTER TABLE public.attendance ENABLE TRIGGER trg_attendance_reject_if_locked;


-- ---------------------------------------------------------------------
-- SECTION 5 — RLS
--
-- Class teacher marks. Admin may mark on any day and is the ONLY role that may
-- edit. Principal may NEVER mark or edit — read only, enforced here rather
-- than in the UI.
-- ---------------------------------------------------------------------

ALTER TABLE public.attendance_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_submissions_tenant_fence ON public.attendance_submissions;
CREATE POLICY attendance_submissions_tenant_fence ON public.attendance_submissions
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

-- Everyone in the institution may READ whether a section was marked. "Not
-- marked" is a dashboard fact, not a secret, and the principal needs it.
DROP POLICY IF EXISTS attendance_submissions_read ON public.attendance_submissions;
CREATE POLICY attendance_submissions_read ON public.attendance_submissions
  FOR SELECT TO authenticated
  USING (public.same_school(school_id));

-- The class teacher of that section may create the submission.
DROP POLICY IF EXISTS attendance_submissions_class_teacher_insert ON public.attendance_submissions;
CREATE POLICY attendance_submissions_class_teacher_insert ON public.attendance_submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.same_school(school_id)
    AND public.is_class_teacher_of_class(auth.uid(), section_id)
  );

-- Admin may mark on any day, and is the only role that may edit or delete.
DROP POLICY IF EXISTS attendance_submissions_admin_all ON public.attendance_submissions;
CREATE POLICY attendance_submissions_admin_all ON public.attendance_submissions
  FOR ALL TO authenticated
  USING (public.same_school(school_id) AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.same_school(school_id) AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- Restrictive, so no permissive policy added later can ever hand the principal
-- a write. The principal's read comes from attendance_submissions_read above.
DROP POLICY IF EXISTS attendance_submissions_principal_never_writes ON public.attendance_submissions;
CREATE POLICY attendance_submissions_principal_never_writes ON public.attendance_submissions
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (true)
  WITH CHECK (NOT public.has_role(auth.uid(), 'principal'::public.app_role));

DROP POLICY IF EXISTS attendance_principal_never_writes ON public.attendance;
CREATE POLICY attendance_principal_never_writes ON public.attendance
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (true)
  WITH CHECK (NOT public.has_role(auth.uid(), 'principal'::public.app_role));


-- ---------------------------------------------------------------------
-- SECTION 6 — assertions
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _subs int; _pairs int;
BEGIN
  SELECT count(*) INTO _subs  FROM public.attendance_submissions;
  SELECT count(*) INTO _pairs FROM (SELECT DISTINCT class_id, date FROM public.attendance) x;
  IF _subs < _pairs THEN
    RAISE EXCEPTION 'Chunk 4: % submissions for % distinct (section,date) pairs', _subs, _pairs;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.attendance_submissions'::regclass
                    AND conname = 'attendance_submissions_section_date_key') THEN
    RAISE EXCEPTION 'Chunk 4: (section_id, date) is not unique — a section could be marked twice in a day';
  END IF;

  SELECT count(*) INTO _n FROM public.attendance WHERE submission_id IS NULL;
  IF _n > 0 THEN RAISE EXCEPTION 'Chunk 4: % record(s) not anchored on a submission', _n; END IF;

  SELECT count(*) INTO _n FROM public.attendance WHERE status::text NOT IN ('present','absent');
  IF _n > 0 THEN RAISE EXCEPTION 'Chunk 4: % row(s) outside present/absent', _n; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'attendance_submissions'
                    AND policyname = 'attendance_submissions_principal_never_writes'
                    AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'Chunk 4: the principal is not fenced out of marking';
  END IF;

  RAISE NOTICE 'Chunk 4: % submissions covering % records', _subs, (SELECT count(*) FROM public.attendance);
END $$;
