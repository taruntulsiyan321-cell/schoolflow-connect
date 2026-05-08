
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Add FKs to enable PostgREST relationship embedding
ALTER TABLE public.homework
  ADD CONSTRAINT homework_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;

ALTER TABLE public.homework_submissions
  ADD CONSTRAINT hw_sub_student_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.library_checkouts
  ADD CONSTRAINT checkout_book_fkey FOREIGN KEY (library_books_id) REFERENCES public.library_books(id) ON DELETE CASCADE,
  ADD CONSTRAINT checkout_student_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
