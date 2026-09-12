-- Rollback for 20260920080000.
--
-- Removes both tables from the realtime publication. The leaderboard and the
-- teacher's handed-in count then move only on their own poll — a few seconds
-- late rather than immediate. Nothing breaks; it stops being live.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='test_attempts') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.test_attempts;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='test_marks') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.test_marks;
  END IF;
END $$;

ALTER TABLE public.test_attempts REPLICA IDENTITY DEFAULT;
ALTER TABLE public.test_marks    REPLICA IDENTITY DEFAULT;
