
-- HOMEWORK
CREATE TABLE IF NOT EXISTS public.homework (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date DATE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.homework ENABLE ROW LEVEL SECURITY;

CREATE POLICY "homework admin all" ON public.homework FOR ALL
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "homework principal read" ON public.homework FOR SELECT
  USING (public.has_role(auth.uid(),'principal'));
CREATE POLICY "homework teacher manage" ON public.homework FOR ALL
  USING (public.teacher_teaches_class(auth.uid(), class_id))
  WITH CHECK (public.teacher_teaches_class(auth.uid(), class_id));
CREATE POLICY "homework student read" ON public.homework FOR SELECT
  USING (public.student_class_id(auth.uid()) = class_id);
CREATE POLICY "homework parent read" ON public.homework FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s
                 WHERE s.parent_user_id = auth.uid() AND s.class_id = homework.class_id));

CREATE TRIGGER homework_set_updated BEFORE UPDATE ON public.homework
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- HOMEWORK SUBMISSIONS
CREATE TABLE IF NOT EXISTS public.homework_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_id UUID NOT NULL REFERENCES public.homework(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  grade TEXT,
  teacher_remarks TEXT,
  submitted_at TIMESTAMPTZ,
  graded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (homework_id, student_id)
);
ALTER TABLE public.homework_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hw_sub admin all" ON public.homework_submissions FOR ALL
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "hw_sub principal read" ON public.homework_submissions FOR SELECT
  USING (public.has_role(auth.uid(),'principal'));
CREATE POLICY "hw_sub student own" ON public.homework_submissions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
CREATE POLICY "hw_sub parent read" ON public.homework_submissions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.parent_user_id = auth.uid()));
CREATE POLICY "hw_sub teacher manage" ON public.homework_submissions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.homework h WHERE h.id = homework_id AND public.teacher_teaches_class(auth.uid(), h.class_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.homework h WHERE h.id = homework_id AND public.teacher_teaches_class(auth.uid(), h.class_id)));

CREATE TRIGGER hw_sub_set_updated BEFORE UPDATE ON public.homework_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- LIBRARY BOOKS
CREATE TABLE IF NOT EXISTS public.library_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  author TEXT,
  category TEXT,
  isbn TEXT,
  total_copies INT NOT NULL DEFAULT 1,
  available_copies INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.library_books ENABLE ROW LEVEL SECURITY;
CREATE POLICY "books read auth" ON public.library_books FOR SELECT TO authenticated USING (true);
CREATE POLICY "books admin all" ON public.library_books FOR ALL
  USING (public.is_principal_or_admin(auth.uid()))
  WITH CHECK (public.is_principal_or_admin(auth.uid()));

CREATE TRIGGER books_set_updated BEFORE UPDATE ON public.library_books
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- LIBRARY CHECKOUTS
CREATE TABLE IF NOT EXISTS public.library_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.library_books(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  checked_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date DATE,
  returned_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'borrowed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Add a FK alias the code uses: library_checkouts -> library_books via embed name "library_books"
-- PostgREST infers from column FK; the code does select("*, library_books(title, author)") which works because book_id references library_books.
-- But the code references `library_books` as the relationship - we need the FK column name; let's also rename for safety:
ALTER TABLE public.library_checkouts RENAME COLUMN book_id TO library_books_id;
ALTER TABLE public.library_checkouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkouts admin all" ON public.library_checkouts FOR ALL
  USING (public.is_principal_or_admin(auth.uid()))
  WITH CHECK (public.is_principal_or_admin(auth.uid()));
CREATE POLICY "checkouts student read" ON public.library_checkouts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
CREATE POLICY "checkouts parent read" ON public.library_checkouts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.parent_user_id = auth.uid()));
CREATE POLICY "checkouts class teacher manage" ON public.library_checkouts FOR ALL
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.teacher_teaches_class(auth.uid(), s.class_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.teacher_teaches_class(auth.uid(), s.class_id)));

-- MESSAGES
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL,
  receiver_id UUID NOT NULL,
  content TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages send" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid());
CREATE POLICY "messages read participants" ON public.messages FOR SELECT
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());
CREATE POLICY "messages mark read" ON public.messages FOR UPDATE
  USING (receiver_id = auth.uid())
  WITH CHECK (receiver_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON public.messages(receiver_id, created_at DESC);

-- CHAT CONTACTS RPC
CREATE OR REPLACE FUNCTION public.get_chat_contacts()
RETURNS TABLE(user_id UUID, name TEXT, role public.app_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ur.user_id,
         COALESCE(NULLIF(p.full_name,''), p.email, 'User')::text AS name,
         ur.role
  FROM public.user_roles ur
  LEFT JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.user_id <> auth.uid()
$$;
