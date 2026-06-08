-- FRESH DATABASE batch 3/12
-- For NEW empty Supabase project (paste in SQL Editor → Run)
-- Project: imrsjhftejghcrhzdjrl

-- ── 20260507070200_messages_table.sql

-- ============================================================
-- MESSAGES TABLE (in-app chat)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES auth.users(id),
  receiver_id UUID NOT NULL REFERENCES auth.users(id),
  content TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON public.messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages(created_at);

-- Enable RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Users can view messages they sent or received
CREATE POLICY "Users can view own messages" ON public.messages FOR SELECT
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

-- Users can send messages
CREATE POLICY "Users can send messages" ON public.messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

-- Users can update messages they received (mark as read)
CREATE POLICY "Users can mark received messages as read" ON public.messages FOR UPDATE
  USING (receiver_id = auth.uid());



-- ── 20260507070300_chat_rpc.sql

-- ============================================================
-- CHAT CONTACTS RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_chat_contacts()
RETURNS TABLE(user_id uuid, name text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_role text;
BEGIN
  -- Get the primary role of the caller
  SELECT ur.role::text INTO caller_role
  FROM public.user_roles ur
  WHERE ur.user_id = caller_id
  ORDER BY 
    CASE ur.role
      WHEN 'admin' THEN 1
      WHEN 'principal' THEN 2
      WHEN 'teacher' THEN 3
      WHEN 'student' THEN 4
      WHEN 'parent' THEN 5
      ELSE 6
    END
  LIMIT 1;

  IF caller_role IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    u.id AS user_id,
    COALESCE(p.full_name, u.email, u.phone, 'Unknown') AS name,
    ur.role::text AS role
  FROM auth.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id != caller_id
  AND (
    -- Admins and Principals can chat with everyone
    caller_role IN ('admin', 'principal')
    -- Teachers can chat with everyone
    OR caller_role = 'teacher'
    -- Students can chat with teachers, admins, principals
    OR (caller_role = 'student' AND ur.role IN ('teacher', 'admin', 'principal'))
    -- Parents can chat with teachers, admins, principals
    OR (caller_role = 'parent' AND ur.role IN ('teacher', 'admin', 'principal'))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_chat_contacts() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_chat_contacts() TO authenticated;



-- ── 20260507070400_principal_permissions.sql

-- ============================================================
-- PRINCIPAL PERMISSIONS ENHANCEMENT
-- ============================================================

-- Drop old policies
DROP POLICY IF EXISTS "classes admin write" ON public.classes;
DROP POLICY IF EXISTS "students admin all" ON public.students;

-- Allow both admins and principals to manage classes
CREATE POLICY "classes admin and principal write" ON public.classes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')));

-- Allow both admins and principals to manage students
CREATE POLICY "students admin and principal all" ON public.students FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')));



-- ── 20260507070500_homework_parent_read.sql

-- ============================================================
-- PARENT READ ACCESS FOR HOMEWORK
-- ============================================================

-- Parents can view homework for their children's classes
CREATE POLICY "Parents can view homework for their children"
  ON public.homework FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.parent_user_id = auth.uid() AND s.class_id = homework.class_id
    )
  );

-- Parents can view submissions of their children
CREATE POLICY "Parents can view submissions of their children"
  ON public.homework_submissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.parent_user_id = auth.uid() AND s.id = homework_submissions.student_id
    )
  );


