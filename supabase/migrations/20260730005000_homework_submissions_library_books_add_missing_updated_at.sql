-- Migration 20260508010554 declared both homework_submissions and library_books
-- with an updated_at column and immediately attached BEFORE UPDATE triggers
-- (hw_sub_set_updated, books_set_updated) that depend on it — but both tables
-- already existed from earlier same-day migrations (20260507070000_homework_tables.sql,
-- 20260507070100_library_tables.sql) without that column, so those CREATE TABLE
-- IF NOT EXISTS statements were silent no-ops and the column never actually
-- landed on either table. homework_submissions.updated_at is separately added
-- later by 20260731080000_homework_engine.sql (confirming this was always the
-- intended shape), but 20260730010000_complete_panel_database.sql runs a
-- generic per-table UPDATE ... SET school_id before that point and fires the
-- broken trigger on both tables. Adding the columns here, ahead of that
-- migration, rather than editing any historical file.
ALTER TABLE public.homework_submissions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.library_books
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
