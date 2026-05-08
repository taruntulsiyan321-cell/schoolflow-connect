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
