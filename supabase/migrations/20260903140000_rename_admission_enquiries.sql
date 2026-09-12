-- Rename school_inquiries to admission_enquiries
ALTER TABLE public.school_inquiries RENAME TO admission_enquiries;

-- Rename indexes or triggers if necessary, but just table rename is usually sufficient for Supabase RPCs.
-- Wait, the spec says admission_enquiries.
-- What about the trigger? school_inquiries_set_school
ALTER TRIGGER school_inquiries_set_school ON public.admission_enquiries RENAME TO admission_enquiries_set_school;

-- Rename policies?
-- "inquiries staff all" -> "admission_enquiries staff all"
ALTER POLICY "inquiries staff all" ON public.admission_enquiries RENAME TO "admission_enquiries staff all";
ALTER POLICY "inquiries anyone insert" ON public.admission_enquiries RENAME TO "admission_enquiries anyone insert";

-- Update references in types? db:types will do this.
