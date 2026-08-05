# Wisdom Campus — Demo Accounts

Use these accounts to exercise **every major panel** (admin, principal, teacher, student, parent) and feature (attendance, fees, exams, homework, library, chat, battleground, DPPs, notices, leaves, inquiries, etc.).

## Apply demo data

**Fastest (no Lovable credits):**

1. Copy `.env.local.example` → `.env.local`
2. Add a [Supabase access token](https://supabase.com/dashboard/account/tokens) as `SUPABASE_ACCESS_TOKEN=sbp_...`
3. Run: `npm run db:seed`

**Or manually:** Supabase Dashboard → SQL Editor → open `supabase/SEED_DEMO_DATA.sql` → Run.

**Or CLI:** `supabase link` then `supabase db push` (applies all migrations).

Re-running the seed is **idempotent** (fixed UUIDs + `ON CONFLICT`).

## Password (all demo users)

| Field | Value |
|-------|--------|
| Password | `DemoPass123!` |

Minimum 8 characters — matches app signup rules.

## Login table

| Role | Email | Notes |
|------|--------|--------|
| **Admin** | `admin@wisdomcampus.com` | Full admin panel, roles, fees write, user linking |
| **Principal** | `principal@wisdomcampus.com` | Principal dashboard, leave approval, reports, inquiries |
| **Teacher (Math, Class 10-A)** | `priya.sharma@wisdomcampus.com` | Class teacher, attendance, homework, DPPs, battle monitor |
| **Teacher (Physics)** | `rajesh.verma@wisdomcampus.com` | Teaches 10-A Physics, exams/marks |
| **Student** | `arjun.mehta@wisdomcampus.com` | Class 10-A, roll 1 — battles, DPPs, fees, homework |
| **Student** | `priya.patel@wisdomcampus.com` | Class 10-A, roll 2 |
| **Student** | `rohan.singh@wisdomcampus.com` | Class 10-A, roll 3 — battle challenge target |
| **Student** | `ananya.iyer@wisdomcampus.com` | Class 10-A, roll 4 |
| **Student** | `vikram.joshi@wisdomcampus.com` | Class 10-A, roll 5 |
| **Student** | `kavya.nair@wisdomcampus.com` | Class 10-A, roll 6 — doubt portal contributor |
| **Student** | `ishaan.gupta@wisdomcampus.com` | Class 10-A, roll 7 — high reputation helper |
| **Student** | `meera.rao@wisdomcampus.com` | Class 10-A, roll 8 |
| **Student** | `kabir.khan@wisdomcampus.com` | Class 10-A, roll 9 |
| **Student** | `nisha.das@wisdomcampus.com` | Class 10-A, roll 10 |
| **Parent** | `mehta.parent@wisdomcampus.com` | Linked to Arjun Mehta |
| **Parent** | `patel.parent@wisdomcampus.com` | Linked to Priya Patel |

Sign in at `/auth` with **email + password** (not Google OAuth for demo users).

## Student login without signing up first

Admins can add a student and enter **email or mobile** on the student record. The student does **not** need to register first. On first sign-in (password or Google) with that email/phone, they are linked to the student profile automatically.

Apply migration: `20260605000000_student_portal_login.sql`

## Admission numbers (student signup / auto-link)

If a user signs up as **student** with metadata `admission_number`, `handle_new_user` links them:

| Student | Admission # |
|---------|----------------|
| Arjun Mehta | `WC10A001` |
| Priya Patel | `WC10A002` |
| Rohan Singh | `WC10A003` |
| Kavya Nair | `WC10A006` |
| Ishaan Gupta | `WC10A007` |
| Meera Rao | `WC10A008` |
| Kabir Khan | `WC10A009` |
| Nisha Das | `WC10A010` |

Teachers auto-link by matching `teachers.email` on signup.

## What the seed covers

| Feature | Demo data |
|---------|-----------|
| Classes | 10-A (main), 9-A |
| Students / teachers / parents | 10 students, 2 teachers, 2 parents |
| Attendance | Today + past week; one locked day |
| Fees | Paid, unpaid, partial months |
| Exams & marks | Unit test + half-yearly, all students |
| Notices | All, class, teachers, parents audiences |
| Homework | Assigned + submitted + graded |
| Library | NCERT-style books + active checkout |
| Chat | Parent ↔ class teacher thread |
| Leave requests | Pending, approved, rejected |
| Battleground | Scheduled, **live**, **finished** battles; invites; XP/badges; feed events; battle reports |
| DPPs | Published (with submitted attempt) + draft |
| Notifications | Per-user samples |
| Timetable | 10-A weekly grid |
| Doubt Portal | Demo doubts, teacher verified answers, accepted answers, votes, reputation |
| App settings | `Wisdom Campus Demo School` |
| Inquiries & complaints | Open cases for principal/admin |
| Staff attendance | Sample teacher present days |
| Audit / attendance audit | Sample rows for admin tools |

## Lovable / hosted Supabase

In Lovable, open **Supabase** → run migrations or paste `supabase/migrations/20260604120000_demo_data.sql` in the SQL editor. Confirm **Auth → Users** lists the emails above after the migration.

## QA automation account (Playwright / E2E)

A separate student account, reserved **only** for automated verification. Never sign into `arjun.mehta@wisdomcampus.com` for E2E runs — that account accumulated hundreds of practice sessions, bookmarks, mistakes, and history entries during the Practice module stabilization work, which makes every new verification run slower and harder to reason about (large queue-paging, ambiguous "before" counts).

Apply `supabase/migrations/20260805030000_qa_automation_student_account.sql` (idempotent, safe to re-run). It clones the school/class assignment from `arjun.mehta`'s student row, so it resolves to the same board/stream/class Practice already works against, without copying any of that account's history.

| Field | Value |
|-------|--------|
| Email | `qa.automation@wisdomcampus.com` |
| Password | `QaAutomation123!` |

`e2e/auth.setup.ts` uses this account by default (override with `E2E_STUDENT_EMAIL` / `E2E_STUDENT_PASSWORD` if needed). If this account ever accumulates its own testing debris, the fix is a fresh one — not reusing `arjun.mehta` again.

## Security

Demo users use the `@wisdomcampus.com` domain. **Do not use these passwords in production.** Remove or skip this migration in production databases.
