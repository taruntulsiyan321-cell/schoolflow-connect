-- =====================================================================
-- CHUNK 6.7 — BATCH 3: notifications
--
-- The smallest batch of the three, and worth saying why: notifications
-- has no role fan-out at all. Its four permissive policies are plain
-- `user_id = auth.uid()` column comparisons — no helper, no join, no
-- nested RLS. The RESTRICTIVE tenant fence is the entire cost.
--
-- The measurement says so before the code does. Per-row cost was
-- essentially IDENTICAL for all five roles:
--
--   admin 2,711ms · principal 2,597ms · teacher 2,568ms
--   parent 2,384ms · student 2,550ms      (1,354 rows)
--   1.76 - 2.00 ms/row, ~0 setup, no role variation
--
-- A cost that does not vary by role cannot be coming from a role-specific
-- arm. It is the one predicate every role shares: same_school(school_id),
-- per row.
--
-- 0 findings at current volume but all five project to 17.6-20.0s at
-- 10,000 rows, and notifications is a table that only grows — one row per
-- recipient per event, never edited, rarely deleted.
--
-- ONE DELIBERATE ADDITION beyond the fence: `user_id = auth.uid()` becomes
-- `user_id = (SELECT auth.uid())`, which hoists the call to a one-time
-- InitPlan instead of invoking it per row.
--
-- That is applied to the INSERT and UPDATE checks too, and the distinction
-- matters because it looks like the dead end recorded in batch 2. It is
-- not. The unsafe rewrite is `col IN (SELECT ... FROM the_table_being_
-- written)`, where the InitPlan may not see the row being inserted.
-- `(SELECT auth.uid())` reads no table and does not depend on the row at
-- all, so there is nothing for it to fail to see.
-- =====================================================================

DROP POLICY IF EXISTS notifications_tenant_fence ON public.notifications;
CREATE POLICY notifications_tenant_fence ON public.notifications
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY IF EXISTS "notif self read"   ON public.notifications;
DROP POLICY IF EXISTS "notif self insert" ON public.notifications;
DROP POLICY IF EXISTS "notif self update" ON public.notifications;
DROP POLICY IF EXISTS "notif self delete" ON public.notifications;

CREATE POLICY "notif self read" ON public.notifications
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "notif self insert" ON public.notifications
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "notif self update" ON public.notifications
  FOR UPDATE USING (user_id = (SELECT auth.uid()))
         WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "notif self delete" ON public.notifications
  FOR DELETE USING (user_id = (SELECT auth.uid()));

INSERT INTO public.schema_migrations (version)
VALUES ('20260828150000_chunk67_batch3_notifications')
ON CONFLICT DO NOTHING;
