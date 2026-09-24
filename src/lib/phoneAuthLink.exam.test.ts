/**
 * One phone number, one account per exam.
 *
 * The rule (2026-09-23): the exam is chosen on the login page and fixed on the
 * account for ever, so preparing for a second exam means a second account on
 * the same number. auth.users.phone is UNIQUE, so it cannot be what identifies
 * them -- an exam account is keyed by its synthetic email alone and carries no
 * auth.users.phone at all.
 *
 * These assert the two halves that a mistake would quietly break: that an exam
 * sign-in never resolves to the school account on the same number (it would
 * hand over somebody else's session), and that a second exam never resolves to
 * the first (it would merge two students' practice into one account).
 */
import { describe, it, expect, vi } from "vitest";
import {
  linkOrCreatePhoneUser,
  syntheticEmailForPhone,
  syntheticEmailForExamAccount,
} from "../../supabase/functions/_shared/phoneAuthLink";

type FakeUser = { id: string; email?: string | null; phone?: string | null };

function fakeAdmin(existing: FakeUser[]) {
  const createUser = vi.fn(async (attrs: Record<string, unknown>) => {
    const user = { id: `new-${existing.length + 1}`, ...attrs } as FakeUser;
    existing.push(user);
    return { data: { user }, error: null };
  });
  return {
    createUser,
    admin: {
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({ data: { users: existing }, error: null })),
          createUser,
          generateLink: vi.fn(async () => ({
            data: { properties: { hashed_token: "tok" } },
            error: null,
          })),
        },
      },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asAdmin = (a: unknown) => a as any;

describe("an exam account is keyed by phone AND exam", () => {
  it("names the two families apart", () => {
    expect(syntheticEmailForPhone("919876543210")).toBe("919876543210@phone.vidyalaya.local");
    expect(syntheticEmailForExamAccount("919876543210", "cuet")).toBe(
      "919876543210.cuet@exam.vidyalaya.local",
    );
    expect(syntheticEmailForExamAccount("919876543210", "neet")).not.toBe(
      syntheticEmailForExamAccount("919876543210", "cuet"),
    );
  });

  it("creates an exam account with no auth.users.phone", async () => {
    const { admin, createUser } = fakeAdmin([]);
    const res = await linkOrCreatePhoneUser(asAdmin(admin), "+91 98765 43210", "cuet");

    expect(res.email).toBe("919876543210.cuet@exam.vidyalaya.local");
    expect(res.is_new_user).toBe(true);
    const attrs = createUser.mock.calls[0][0];
    expect(attrs.email).toBe("919876543210.cuet@exam.vidyalaya.local");
    expect(attrs.email_confirm).toBe(true);
    // The two that must NOT be there: setting either would make the number
    // unique across exams and refuse the second account.
    expect("phone" in attrs).toBe(false);
    expect("phone_confirm" in attrs).toBe(false);
  });

  it("does not hand an exam sign-in the school account on the same number", async () => {
    const users: FakeUser[] = [
      { id: "school-1", email: "919876543210@phone.vidyalaya.local", phone: "919876543210" },
    ];
    const { admin, createUser } = fakeAdmin(users);
    const res = await linkOrCreatePhoneUser(asAdmin(admin), "+91 98765 43210", "cuet");

    expect(createUser).toHaveBeenCalledTimes(1);
    expect(res.user_id).not.toBe("school-1");
    expect(res.is_new_user).toBe(true);
  });

  it("does not hand a second exam the first exam's account", async () => {
    const users: FakeUser[] = [
      { id: "cuet-1", email: "919876543210.cuet@exam.vidyalaya.local", phone: null },
    ];
    const { admin, createUser } = fakeAdmin(users);
    const res = await linkOrCreatePhoneUser(asAdmin(admin), "+91 98765 43210", "neet");

    expect(createUser).toHaveBeenCalledTimes(1);
    expect(res.user_id).not.toBe("cuet-1");
    expect(res.email).toBe("919876543210.neet@exam.vidyalaya.local");
  });

  it("signs a returning exam student back into the same account", async () => {
    const users: FakeUser[] = [
      { id: "cuet-1", email: "919876543210.cuet@exam.vidyalaya.local", phone: null },
    ];
    const { admin, createUser } = fakeAdmin(users);
    const res = await linkOrCreatePhoneUser(asAdmin(admin), "9876543210", "cuet");

    expect(createUser).not.toHaveBeenCalled();
    expect(res.user_id).toBe("cuet-1");
    expect(res.is_new_user).toBe(false);
  });

  it("leaves the school path exactly as it was", async () => {
    const { admin, createUser } = fakeAdmin([]);
    const res = await linkOrCreatePhoneUser(asAdmin(admin), "+91 98765 43210");

    expect(res.email).toBe("919876543210@phone.vidyalaya.local");
    const attrs = createUser.mock.calls[0][0];
    expect(attrs.phone).toBe("919876543210");
    expect(attrs.phone_confirm).toBe(true);
  });

  it("still matches a school account by its stored number alone", async () => {
    // The pre-existing rule this must not lose: an account created before the
    // canonical-format fix has the right phone and an unexpected email.
    const users: FakeUser[] = [{ id: "old-1", email: "someone@example.com", phone: "+919876543210" }];
    const { admin, createUser } = fakeAdmin(users);
    const res = await linkOrCreatePhoneUser(asAdmin(admin), "9876543210");

    expect(createUser).not.toHaveBeenCalled();
    expect(res.user_id).toBe("old-1");
  });
});
