-- leave_requests.class_id and leave_requests.student_id have been bare uuid
-- columns since the table's original creation (20260505005850) — never
-- referenced classes(id) / students(id), even though every INSERT into this
-- table (see the demo-data migrations) always populates them with real
-- class/student ids, and the RLS policies on this table already join through
-- student_id assuming it identifies a real student.
--
-- The missing FK on class_id surfaced as a live bug: the admin dashboard's
-- pending-leave-requests widget (src/gurukul-admin/Dashboard.tsx) queries
-- PostgREST with `classes!inner(school_id)`, which requires a real foreign
-- key for PostgREST to discover the join path. Without it, every load fails:
--   PGRST200 "Could not find a relationship between 'leave_requests' and
--   'classes' in the schema cache"
-- Confirmed via live browser network trace (Admin Dashboard, first load,
-- every session) before making this change.
--
-- Zero orphaned rows found on this database (checked directly) for either
-- column, so both FKs add cleanly. No frontend code currently embeds through
-- student_id the same way, but the same intent gap exists there and the RLS
-- policies already assume it is a real reference, so it is corrected too for
-- consistency.
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE SET NULL;
