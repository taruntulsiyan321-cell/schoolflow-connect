## Goal
Restructure role & access management into a professional, institutional workflow. Move teacher account linking into the Teacher profile, restrict the Roles & Access page to student role assignment only, lock down Principal/Super Admin assignment, and rename UI terminology to feel premium and institutional.

## Scope of changes

### 1. Database (migration)
- New SQL function `admin_assign_student_role(_identifier text)` — admin-only, assigns ONLY the `student` role. Rejects attempts to assign principal/admin/super.
- New SQL function `admin_set_teacher_access(_teacher_id uuid, _email text, _active boolean)` — admin-only, links a Google email (auth.users lookup) to a teacher row, sets `teachers.status` to `active`/`inactive`, and grants/revokes the `teacher` role on that user.
- New SQL function `admin_unlink_teacher_access(_teacher_id uuid)` — clears `user_id`, sets status `inactive`, removes `teacher` role.
- Harden existing `admin_assign_role`: keep it but it will only be called by Platform Owner flows (we won't expose it in UI anymore). Add explicit guard so admins (non-super) cannot assign `principal` or `admin` — only platform-owner-marked accounts can. Since we have no super-admin concept, simplest safe rule: **`admin_assign_role` blocks `principal` and `admin` targets**; existing principal/admin must be seeded via migration or a service-role action. Add note in security memory.
- Add view/RPC `admin_list_students_for_role(search text)` returning students with their linked auth user + current role status (used by redesigned page).

### 2. Frontend — Roles & Access page (`/admin/permissions`)
Redesign to be **Student Access Management** only:
- Title: "Student Access"
- Subtitle: "Grant student-portal access to enrolled students by linking their Google account or mobile number."
- Search students by name / admission number.
- Each row shows: student name, class, **Connected Account** (Google email or phone, or "Not connected"), **Access Status** badge (Active / Pending), action: Link Account, Revoke Access.
- Remove ALL teacher/principal/admin role UI from this page.
- Remove the free-text "assign any role" form.

### 3. Frontend — Teachers Admin (`/admin/teachers`)
Add **Account Access** card inside the existing Edit Teacher dialog:
- Connected Google email field
- Linked mobile (read-only from teacher profile)
- Access status toggle (Active / Inactive)
- "Link & Activate" button → calls `admin_set_teacher_access`
- "Revoke Access" button → calls `admin_unlink_teacher_access`
- Last login (read from auth.users via existing admin RPC if available; otherwise show "—")
- Remove any Linked User Account UI from elsewhere referencing teachers.

### 4. Terminology sweep
Rename across student/teacher admin pages:
- "Linked User Account" → "Account Access"
- "Link user" → "Connect account"
- "User ID" → "Connected account"

### 5. Access hierarchy doc
Add a small read-only "Access Hierarchy" info card at top of Roles & Access page explaining: Platform Owner → Principal → Admin → Teacher → Student, and noting that Principal/Owner roles are managed by the platform team.

## Files

**New migration:**
- `supabase/migrations/<ts>_role_management_redesign.sql`

**Edited:**
- `src/pages/admin/Permissions.tsx` (or equivalent route file under `/admin/permissions`) — full redesign as student-only.
- `src/pages/admin/TeachersAdmin.tsx` — add Account Access section to edit dialog; new link/revoke handlers.
- `src/pages/admin/StudentsAdmin.tsx` — terminology rename only (Linked User Account → Account Access).

## Out of scope
- No changes to auth flow itself (Google OAuth already wired).
- No new tables — reusing `teachers.user_id`, `teachers.status`, `students.user_id`, `user_roles`.
- No edits to principal/super-admin seeding UI (intentionally removed from admin reach).

## Verification
- Migration applies cleanly.
- Admin cannot assign `principal`/`admin` via any UI path.
- Linking a teacher's Google email grants `teacher` role and sets status `active`.
- Student page only offers `student` role.
