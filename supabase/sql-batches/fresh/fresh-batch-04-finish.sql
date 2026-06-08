-- Run this ONCE if batch 4 failed on duplicate constraints (batch 4 is otherwise done)
-- Safe to re-run — skips existing objects

ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE public.homework
    ADD CONSTRAINT homework_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.homework_submissions
    ADD CONSTRAINT hw_sub_student_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.library_checkouts
    ADD CONSTRAINT checkout_book_fkey FOREIGN KEY (book_id) REFERENCES public.library_books(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.library_checkouts
    ADD CONSTRAINT checkout_student_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
