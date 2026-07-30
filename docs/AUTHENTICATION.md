# Gurukul Authentication

Central auth lives in `src/auth/`. Prefer `import { useAuth } from "@/auth"`.

## Stack

- **Provider:** Supabase Auth (email + password; Google OAuth hook reserved)
- **Session:** persisted + auto-refreshed
- **Bootstrap:** `get_auth_context()` → profile + role + school

## Roles

| Role | Dashboard | How created |
|------|-----------|-------------|
| `admin` | `/admin` | School admin invites / portal link |
| `principal` | `/principal` | Admin provisions |
| `teacher` | `/teacher` | Admin provisions |
| `student` | `/student` | Self-signup **or** portal link |
| `parent` | `/parent` | Self-signup **or** portal link |
| `super_admin` | (future) | Platform only |

One role per account (`UNIQUE user_roles.user_id`).

## Signup (rechecked)

1. Public signup only offers **Student** or **Parent**.
2. `intended_role` is stored in Auth user metadata.
3. `handle_new_user` + `get_auth_context` assign that role server-side.
4. Client also calls `claim_signup_role(_role)` (SECURITY DEFINER) when a session exists immediately after signup — **no direct `user_roles` insert** (RLS blocked that before).
5. Staff cannot self-register; UI explains they must be invited.

## Login / session / logout

- Sign-in via `signIn({ email, password })` → Supabase → context load → role home
- Cross-role URLs → `/unauthorized`
- Disabled `profiles.is_active` → `/unauthorized`
- Logout clears Supabase session + React Query + app caches

## Password reset

1. Forgot password on `/auth` → `resetPasswordForEmail` → `/reset-password`
2. Recovery session verified before form
3. After update → **sign out** → redirect to `/auth` (clean login)

## Multi-tenant

- `profiles.school_id` + `useAuth().schoolId`
- Filter all tenant queries by school
- See `docs/DATABASE.md`

## Apply DB

```bash
supabase db push
```
