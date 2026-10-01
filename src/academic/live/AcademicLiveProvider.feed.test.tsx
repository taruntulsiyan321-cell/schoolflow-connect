/**
 * The school's activity feed is the staff view (20261134000000): RLS gives a
 * student or a parent no row of it. The live provider subscribes only staff to
 * its changes; everyone keeps the subscriptions to their own tables.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const auth = vi.hoisted(() => ({ role: "student" as string }));
const tables = vi.hoisted(() => ({ list: [] as string[] }));

vi.mock("@/auth", () => ({
  useAuth: () => ({ user: { id: "11111111-2222-3333-4444-555555555555" }, schoolId: "s1", isAuthenticated: true, role: auth.role }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: (_kind: string, opts: { table: string }) => { tables.list.push(opts.table); return channel; },
    subscribe: () => channel,
  };
  return { supabase: { channel: () => channel, removeChannel: () => {} } };
});

const { AcademicLiveProvider } = await import("./AcademicLiveProvider");
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AcademicLiveProvider><div /></AcademicLiveProvider>
    </QueryClientProvider>,
  );

beforeEach(() => { tables.list = []; });

describe("the live provider and the school's activity feed", () => {
  it.each(["student", "parent"])("a %s is not subscribed to the feed, and keeps its own tables", (role) => {
    auth.role = role;
    show();
    expect(tables.list).not.toContain("school_activity_feed");
    expect(tables.list).toContain("homework");
    expect(tables.list).toContain("notifications");
  });

  it.each(["teacher", "principal", "admin", "super_admin"])("CONTROL: a %s is subscribed to the feed", (role) => {
    auth.role = role;
    show();
    expect(tables.list).toContain("school_activity_feed");
  });
});
