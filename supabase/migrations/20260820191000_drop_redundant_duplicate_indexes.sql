-- Cleanup: the previous migration (20260820190000) added two UNIQUE
-- constraints that turned out to be exact duplicates of pre-existing unique
-- indexes this session's check missed. pg_constraint only registers
-- formally-declared constraints (ADD CONSTRAINT ... UNIQUE) -- a bare
-- CREATE UNIQUE INDEX enforces the same guarantee without ever showing up
-- there. Confirmed via pg_indexes (not just pg_constraint) after a live
-- constraint-violation test surfaced a different, pre-existing index name
-- than the one just added: students_school_admission_uidx and
-- classes_school_name_section_year_uidx both already existed with the
-- identical column list. The two CHECK constraints from that same migration
-- (leave_requests date range, fees non-negative) are unaffected -- CHECK
-- constraints always register in pg_constraint, so that part of the
-- original check was accurate and those are genuinely new.

ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_school_admission_number_key;
DROP INDEX IF EXISTS public.students_school_admission_number_key;

ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS classes_school_name_section_year_key;
DROP INDEX IF EXISTS public.classes_school_name_section_year_key;
