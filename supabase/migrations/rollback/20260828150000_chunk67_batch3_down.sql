-- =====================================================================
-- REVERSE OF: 20260828150000_chunk67_batch3_notifications.sql
--
-- WHAT THIS COSTS, measured at 1,354 rows before the batch:
--
--   admin 2,711ms · principal 2,597ms · teacher 2,568ms
--   parent 2,384ms · student 2,550ms   (1.76-2.00 ms/row)
--
-- Under the 8s timeout today, and 17.6-20.0s at 10,000 rows. notifications
-- only grows — one row per recipient per event, never edited, rarely
-- deleted — so a school reaches that figure by ordinary use rather than by
-- anything going wrong.
--
-- Reverse to isolate a problem, not as a resting state.
-- =====================================================================

BEGIN;

DROP POLICY IF EXISTS notifications_tenant_fence ON public.notifications;
CREATE POLICY notifications_tenant_fence ON public.notifications
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

DROP POLICY IF EXISTS "notif self read"   ON public.notifications;
DROP POLICY IF EXISTS "notif self insert" ON public.notifications;
DROP POLICY IF EXISTS "notif self update" ON public.notifications;
DROP POLICY IF EXISTS "notif self delete" ON public.notifications;

CREATE POLICY "notif self read" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notif self insert" ON public.notifications
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "notif self update" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid())
         WITH CHECK (user_id = auth.uid());

CREATE POLICY "notif self delete" ON public.notifications
  FOR DELETE USING (user_id = auth.uid());

DELETE FROM public.schema_migrations
 WHERE version = '20260828150000_chunk67_batch3_notifications';

COMMIT;
