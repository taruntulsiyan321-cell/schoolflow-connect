## Goal

Refine the Adarsh Campus Admin Panel across four areas: account access, reports, batch management, and class workflows.

---

## 1. Account Access — Remove standalone page, move into Student/Teacher workflows

**Remove**
- Delete `src/pages/admin/LinkUsersAdmin.tsx` and its route/sidebar entry in `AdminDashboard.tsx`.

**Move into Student workflow**
- In `StudentsAdmin.tsx`, add an "Account Access" section to:
  - The **Add Student** dialog (optional during admission).
  - A new **Edit Student** dialog (per-row "Edit" action).
- Fields & actions: linked email, status badge (Linked / Not linked / Inactive), buttons: **Link Account**, **Unlink**, **Activate / Deactivate**.

**Move into Teacher workflow**
- Same treatment in `TeachersAdmin.tsx` (already has access toggle — extend with inline link/unlink dialog using email or phone).

**Remove "login-first" limitation (server-side)**
- Create edge function `admin-link-account` (verify_jwt true, admin-only) that:
  1. Receives `{ kind: 'student'|'teacher'|'parent', target_id, email|phone }`.
  2. Uses the service-role key to look up the user via `auth.admin.listUsers` / `getUserByEmail`.
  3. If the user does not exist **and** an email was provided, calls `auth.admin.inviteUserByEmail` (or `createUser` with email) so the account is provisioned without requiring the user to sign in first.
  4. Calls existing `admin_connect_student_account` / `admin_link_user_to_teacher` RPCs with the resolved UID.
  5. Returns clear errors: `"Invalid Google account"` when the email format is bad or the invite fails.
- Frontend calls this function instead of the existing direct RPC, so admins can link by typing an email/phone with no prior sign-in.

---

## 2. Reports — Practical institutional reporting

Rewrite `src/pages/shared/TeacherReportsPage.tsx` usage on the admin route into a new `src/pages/admin/ReportsAdmin.tsx` with a tabbed layout (sidebar list on the left, content on the right). Each tab is a focused, table-style report with date filters, a summary strip, and a CSV export button.

Tabs:
1. **Students** — roster by class, gender mix, admission counts.
2. **Attendance** — daily/range %, class breakdown, absentees list.
3. **Fees** — collected vs pending, defaulters list.
4. **Pending Dues** — student-wise unpaid invoices.
5. **Teacher Salary** — pending salary placeholder (uses `teachers.salary`, status flag).
6. **Exams & Marks** — averages per class/subject, top scorers.
7. **Class Performance** — combined attendance + marks rollup per class.
8. **Admissions** — new admissions per month.
9. **Leave Requests** — by status, applicant kind.
10. **Notices** — delivery counts (created, audience).

Inquiries / complaints / timetable / notification-delivery reports are stubbed as "Coming soon" cards (no schema yet) so the section is visually complete without faking data.

Visual rules:
- Consistent header with title + date range + export.
- Compact dense tables, subtle dividers, no oversized hero cards.
- Empty states are short single-line messages, not large illustrations.

---

## 3. Batch Management inside Classes

Schema change (migration):
- Add `kind text not null default 'class'` to `classes` (values: `class`, `batch`).
- Add `display_name text` for free-form names (e.g. "NEET Morning Batch").
- `name` and `section` become nullable when `kind = 'batch'`.

`ClassesAdmin.tsx` rewrite:
- Two tabs: **School Classes** and **Batches & Programs**.
- "Add Class" keeps the existing class/section dropdowns.
- "Add Batch" uses free-text `display_name` + optional category (free text) + academic year. No fixed list.
- Both render in the same grid with a `kind` badge, edit + delete actions.

Downstream code that currently reads `classes.name`/`section` continues to work for `kind='class'` rows; batch cards display `display_name` directly.

---

## 4. Class / Batch Detail Page

New route: `/admin/classes/:id` rendered by `src/pages/admin/ClassDetail.tsx`.

Sections:
- **Header**: class/batch name, academic year, total students, class teacher (link to teacher profile).
- **Students table**: roll, name, parent contact, account status, "View Profile" → opens existing student detail.
- **Today's attendance**: small summary (Present / Absent / Leave) with link to Attendance page filtered to this class.
- **Recent exams & averages**: pulls from `exams` + `marks`, simple table.
- **Quick actions**: Mark Attendance, Add Notice (class), Create Exam — pre-filtered to this class.

Each class card in `ClassesAdmin` becomes clickable, navigating into this detail page so the flow is Class → Students → Student Profile.

---

## Technical Notes

- Existing RPCs (`admin_connect_student_account`, `admin_link_user_to_teacher`, `admin_set_teacher_access`, `admin_revoke_*`) are reused; the new edge function is a thin wrapper that adds the "create/invite if missing" step using service-role admin APIs.
- New edge function deploys automatically; secret `SUPABASE_SERVICE_ROLE_KEY` is already configured.
- Migration only adds nullable/default columns to `classes` so existing data is untouched. RLS unchanged.
- CSV export uses a tiny in-file helper (no new dependency).
- Sidebar entries in `AdminDashboard.tsx` updated: remove "Account Access", reorder to Students / Teachers / Classes & Batches / Fees / Reports.

---

## File Plan

**New**
- `src/pages/admin/ReportsAdmin.tsx`
- `src/pages/admin/ClassDetail.tsx`
- `supabase/functions/admin-link-account/index.ts`
- Migration: add `kind`, `display_name`, relax `name`/`section` on `classes`.

**Edited**
- `src/pages/AdminDashboard.tsx` (routes + sidebar)
- `src/pages/admin/StudentsAdmin.tsx` (Edit dialog + Account Access block + onboarding link)
- `src/pages/admin/TeachersAdmin.tsx` (inline link dialog using new edge function)
- `src/pages/admin/ClassesAdmin.tsx` (tabs, batches)

**Deleted**
- `src/pages/admin/LinkUsersAdmin.tsx`
