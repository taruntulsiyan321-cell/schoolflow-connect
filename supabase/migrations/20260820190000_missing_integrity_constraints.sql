-- Found via a rigorous re-pass: confirmed zero data violations currently
-- exist for these invariants (duplicate admission numbers, duplicate
-- class name+section, invalid leave date ranges, negative/inconsistent
-- fee amounts) -- but ZERO constraints enforce any of them at the database
-- level. Every one of these is currently true by luck/application
-- discipline, not by guarantee -- the same class of latent risk as the
-- question_attempts duplicate-race gap documented earlier this session.
-- These four are same-row, straightforward, and safe to add now (verified
-- no existing violations, so the migration cannot fail). Not included:
-- "marks_obtained <= exams.max_marks" -- that needs a cross-table trigger,
-- not a plain CHECK constraint (Postgres CHECK cannot reference another
-- table), a bigger change deliberately deferred rather than rushed.

ALTER TABLE public.students
  ADD CONSTRAINT students_school_admission_number_key
  UNIQUE (school_id, admission_number);

-- Includes academic_year: name+section legitimately repeats across years
-- (confirmed live -- academic_year is the populated column, academic_year_id
-- is unused/always NULL currently -- checked before writing this, not
-- assumed, since a naive (school_id, name, section) key would have wrongly
-- blocked every school from re-creating "10-A" for a new cohort each year).
ALTER TABLE public.classes
  ADD CONSTRAINT classes_school_name_section_year_key
  UNIQUE (school_id, name, section, academic_year);

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_date_range_check
  CHECK (to_date >= from_date);

ALTER TABLE public.fees
  ADD CONSTRAINT fees_amount_nonnegative_check
  CHECK (amount >= 0 AND paid_amount >= 0);

-- Deliberately NOT adding "paid_amount <= amount": checked the actual admin
-- write path (src/pages/admin/FeesAdmin.tsx's updateAmount) before adding
-- this, and it legitimately allows reducing `amount` below an already-
-- recorded `paid_amount` with no guard against it -- e.g. a late-fee waiver
-- or correction issued after a student already paid the original higher
-- amount. A CHECK constraint here would turn that real, reachable admin
-- action into a hard failure. Confirmed via reading the component, not
-- assumed -- the same mistake almost made with the classes constraint above
-- before checking for academic_year.
