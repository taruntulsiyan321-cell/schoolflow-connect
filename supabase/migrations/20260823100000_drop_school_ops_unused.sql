-- Drop school-ops tables that are not learning-related and were never used.
-- These 3 tables had zero UI and zero RLS-ordered reads in src, verified grep 0.
-- Keep parent_academic_alerts and academic_taxonomy_terms (learning) — do not drop.
-- Safe to re-apply: IF EXISTS + CASCADE.

drop table if exists public.library_checkouts cascade;
drop table if exists public.library_books cascade;
drop table if exists public.staff_attendance cascade;

-- Verify clean: these selects should now error "does not exist" (expected).
-- select * from library_books;          -- 42703
-- select * from staff_attendance;       -- 42703
