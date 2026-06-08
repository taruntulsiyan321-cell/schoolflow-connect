-- FRESH DATABASE batch 4/12
-- For NEW empty Supabase project (paste in SQL Editor → Run)
-- Project: imrsjhftejghcrhzdjrl

-- ── 20260507070600_notices_expiration.sql

-- ============================================================
-- NOTICES EXPIRATION FEATURE
-- ============================================================

ALTER TABLE public.notices ADD COLUMN expires_at TIMESTAMPTZ;



-- ── 20260508000000_auto_link_user.sql

-- Auto-link signed-up users based on email match
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _student_id UUID;
  _teacher_id UUID;
  _parent_student_id UUID;
BEGIN
  -- Insert into profiles
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name',''),
    NEW.email,
    NEW.phone
  )
  ON CONFLICT (id) DO NOTHING;

  -- Auto-link Logic based on email (if provided)
  IF NEW.email IS NOT NULL THEN
    
    -- 1. Try to auto-link to a Teacher
    SELECT id INTO _teacher_id FROM public.teachers WHERE lower(email) = lower(NEW.email) LIMIT 1;
    IF _teacher_id IS NOT NULL THEN
      UPDATE public.teachers SET user_id = NEW.id WHERE id = _teacher_id AND user_id IS NULL;
    END IF;

    -- Note: For students and parents, the current schema does not have a dedicated email field 
    -- in the `students` table to match against. To fully automate this for students/parents,
    -- the schema would need to store the student's or parent's email during admission.
    -- Assuming this is the case for teachers first, and we can add student/parent email fields later if needed.
    
    -- But since the requirement states "we can sign in any user by writing its email or any other credentials... it automatically get linked",
    -- perhaps we can match against admission_number if passed in raw_user_meta_data?
    IF NEW.raw_user_meta_data->>'admission_number' IS NOT NULL THEN
       SELECT id INTO _student_id FROM public.students WHERE admission_number = NEW.raw_user_meta_data->>'admission_number' LIMIT 1;
       IF _student_id IS NOT NULL THEN
          UPDATE public.students SET user_id = NEW.id WHERE id = _student_id AND user_id IS NULL;
       END IF;
    END IF;

  END IF;

  RETURN NEW;
END; $$;



-- ── 20260508010554_d8dd1160-7988-492d-8445-d7b49bbe1090.sql


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

-- CHAT CONTACTS RPC (drop first — return type changed from batch 3)
DROP FUNCTION IF EXISTS public.get_chat_contacts();
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



-- ── 20260508010620_32b39c6a-20bb-4cb8-8b77-dfd851ae6b2f.sql


ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Add FKs to enable PostgREST relationship embedding
ALTER TABLE public.homework
  ADD CONSTRAINT homework_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;

ALTER TABLE public.homework_submissions
  ADD CONSTRAINT hw_sub_student_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.library_checkouts
  ADD CONSTRAINT checkout_book_fkey FOREIGN KEY (library_books_id) REFERENCES public.library_books(id) ON DELETE CASCADE,
  ADD CONSTRAINT checkout_student_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


