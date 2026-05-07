-- ============================================================
-- LIBRARY TABLES
-- ============================================================

-- Table: library_books (book catalog)
CREATE TABLE IF NOT EXISTS public.library_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  isbn TEXT DEFAULT '',
  category TEXT DEFAULT 'General',
  total_copies INTEGER NOT NULL DEFAULT 1,
  available_copies INTEGER NOT NULL DEFAULT 1,
  shelf_location TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: library_checkouts (borrow/return tracking)
CREATE TABLE IF NOT EXISTS public.library_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.library_books(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  checked_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date DATE NOT NULL DEFAULT (current_date + interval '14 days'),
  returned_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'borrowed' CHECK (status IN ('borrowed', 'returned', 'overdue')),
  issued_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_library_books_title ON public.library_books(title);
CREATE INDEX IF NOT EXISTS idx_library_checkouts_student ON public.library_checkouts(student_id);
CREATE INDEX IF NOT EXISTS idx_library_checkouts_book ON public.library_checkouts(book_id);
CREATE INDEX IF NOT EXISTS idx_library_checkouts_status ON public.library_checkouts(status);

-- Enable RLS
ALTER TABLE public.library_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_checkouts ENABLE ROW LEVEL SECURITY;

-- Everyone can view books
CREATE POLICY "Anyone can view books" ON public.library_books FOR SELECT USING (true);

-- Admins can manage books
CREATE POLICY "Admins manage books" ON public.library_books FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')));

-- Students can view their own checkouts
CREATE POLICY "Students view own checkouts" ON public.library_checkouts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = auth.uid() AND s.id = library_checkouts.student_id)
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal', 'teacher'))
  );

-- Admins can manage checkouts
CREATE POLICY "Admins manage checkouts" ON public.library_checkouts FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')));
