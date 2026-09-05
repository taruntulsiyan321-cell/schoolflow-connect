// Admin link account: looks up an auth user by email/phone using service-role,
// creates the account if it does not exist (so admins don't need the user to sign in first),
// then links the user to the given student/teacher record.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { normalizePhone } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Not authenticated" }, 401);
    }

    // Validate caller and check admin role
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // THE SCHOOL IS RESOLVED FIRST, BECAUSE THE ROLE CHECK NEEDS IT.
    //
    // `has_role(user, role)` asks "is this caller ACTING in this role right
    // now", and answers from `active_membership_id()`, which is derived from
    // `auth.uid()`. This client is created with the service key and carries no
    // user session, so `auth.uid()` is NULL, the predicate takes its
    // cross-account branch, and that branch resolves the institution with
    // `get_my_school_id()` -- also NULL without a session. The two-argument
    // form therefore answered false for every role, and this function returned
    // 403 "Admin only" to every admin who called it.
    //
    // 20260905120000 added the three-argument form for precisely this caller:
    // one with no session that nevertheless KNOWS which institution it is
    // asking about. It is not an escape hatch -- probe12 asserts that the wrong
    // school and a NULL school both still answer false. Naming the school is
    // the fix. Widening the predicate for session-less callers was proposed as
    // KNOWN_ISSUES 1 route (a) and was rejected.
    const { data: callerProfile, error: profileErr } = await admin
      .from("profiles")
      .select("school_id, is_active")
      .eq("id", u.user.id)
      .maybeSingle();
    // A lookup that FAILED is not a caller who has no school. Distinguish them,
    // or an outage reads to the admin as a tenancy decision.
    if (profileErr) {
      return json({ error: `Could not read the caller's profile: ${profileErr.message}` }, 500);
    }
    if (!callerProfile?.school_id) return json({ error: "No school context" }, 403);
    if (callerProfile.is_active === false) return json({ error: "Account disabled" }, 403);
    const callerSchoolId = callerProfile.school_id as string;

    const { data: hasRole, error: roleErr } = await admin.rpc("has_role", {
      _user_id: u.user.id,
      _role: "admin",
      _school_id: callerSchoolId,
    });
    // Same rule: a predicate that could not be EVALUATED is not a denial. The
    // previous version discarded this error, so a failing RPC was indistinguishable
    // from an admin who genuinely lacked the role.
    if (roleErr) {
      return json({ error: `Could not check the admin role: ${roleErr.message}` }, 500);
    }
    if (!hasRole) return json({ error: "Admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind || "");
    const target_id = String(body.target_id || "");
    const identifier = String(body.identifier || "").trim();
    const as = String(body.as || "student"); // for student: 'student' | 'parent'

    if (!target_id || !identifier) return json({ error: "Missing fields" }, 400);
    if (!["student", "teacher"].includes(kind)) return json({ error: "Invalid kind" }, 400);

    // Tenant isolation: target row must belong to caller's school
    if (kind === "teacher") {
      const { data: teacher } = await admin
        .from("teachers")
        .select("id, school_id")
        .eq("id", target_id)
        .maybeSingle();
      if (!teacher || teacher.school_id !== callerSchoolId) {
        return json({ error: "Teacher is outside your school" }, 403);
      }
    } else {
      const { data: student } = await admin
        .from("students")
        .select("id, school_id")
        .eq("id", target_id)
        .maybeSingle();
      if (!student || student.school_id !== callerSchoolId) {
        return json({ error: "Student is outside your school" }, 403);
      }
    }

    // Resolve or create the auth user
    let userId: string | null = null;

    if (isEmail(identifier)) {
      // Try to find existing
      const found = await findByEmail(admin, identifier);
      if (found) {
        userId = found;
      } else {
        // Create the user (no password) — they can sign in via Google or magic link later
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email: identifier,
          email_confirm: true,
        });
        if (cErr || !created?.user) {
          return json({ error: "Invalid Google account" }, 400);
        }
        userId = created.user.id;
      }
    } else {
      const phone = normalizePhone(identifier);
      if (!phone) return json({ error: "Invalid phone number" }, 400);
      const found = await findByPhone(admin, phone);
      if (found) {
        userId = found;
      } else {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          phone,
          phone_confirm: true,
        });
        if (cErr || !created?.user) {
          return json({ error: cErr?.message || "Could not create account" }, 400);
        }
        userId = created.user.id;
      }
    }

    if (!userId) return json({ error: "Could not resolve account" }, 400);

    // Link via existing tables (bypasses login-first RPC limitation)
    if (kind === "teacher") {
      const { error } = await admin
        .from("teachers")
        .update({ user_id: userId, status: "active" })
        .eq("id", target_id)
        .eq("school_id", callerSchoolId);
      if (error) return json({ error: error.message }, 400);
      await grantMembership(admin, userId, callerSchoolId, "teacher", target_id);
    } else {
      const patch: Record<string, string> = as === "parent" ? { parent_user_id: userId } : { user_id: userId };
      const { error } = await admin
        .from("students")
        .update(patch)
        .eq("id", target_id)
        .eq("school_id", callerSchoolId);
      if (error) return json({ error: error.message }, 400);
      const role = as === "parent" ? "parent" : "student";
      // A parent's local record is a parents row, not the student row, so
      // local_person_id is only carried for the student case.
      await grantMembership(
        admin,
        userId,
        callerSchoolId,
        role,
        as === "parent" ? null : target_id,
      );
    }

    // Bind linked auth user to this tenant when profile school is empty
    await admin
      .from("profiles")
      .update({ school_id: callerSchoolId })
      .eq("id", userId)
      .is("school_id", null);

    return json({ ok: true, user_id: userId });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

/**
 * Grant an active membership at an institution.
 *
 * Replaces the old `user_roles` upsert. Since Chunk 1.5 `public.user_roles` is
 * read-only at the table level, so writing it here would now raise — roles live
 * on `public.memberships` and are resolved from the session's active membership.
 *
 * `accounts` is upserted first because `memberships.account_id` references it.
 */
async function grantMembership(
  admin: ReturnType<typeof createClient>,
  accountId: string,
  schoolId: string,
  role: string,
  localPersonId: string | null,
): Promise<void> {
  await admin.from("accounts").upsert({ id: accountId }, { onConflict: "id", ignoreDuplicates: true });

  const row: Record<string, unknown> = {
    account_id: accountId,
    school_id: schoolId,
    role,
    status: "active",
    responded_at: new Date().toISOString(),
  };
  if (localPersonId) row.local_person_id = localPersonId;

  const { error } = await admin
    .from("memberships")
    .upsert(row, { onConflict: "account_id,school_id,role" });
  if (error) throw new Error(`membership grant failed: ${error.message}`);
}

async function findByEmail(admin: ReturnType<typeof createClient>, email: string): Promise<string | null> {
  // Paginate through users; school accounts will be small enough for this approach.
  let page = 1;
  const perPage = 200;
  while (page < 50) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data) return null;
    const hit = data.users.find((x) => (x.email || "").toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < perPage) return null;
    page++;
  }
  return null;
}

async function findByPhone(admin: ReturnType<typeof createClient>, phone: string): Promise<string | null> {
  let page = 1;
  const perPage = 200;
  while (page < 50) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data) return null;
    const hit = data.users.find((x) => normalizePhone(x.phone) === phone);
    if (hit) return hit.id;
    if (data.users.length < perPage) return null;
    page++;
  }
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
