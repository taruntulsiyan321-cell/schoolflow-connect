/**
 * The header's bell and the Notifications page read ONE list. Measured
 * 2026-09-25: each kept its own copy — two fetches, two realtime channels, and
 * a bell still counting what the page had just marked read.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  selects: 0,
  channels: 0,
  removed: 0,
  rows: [] as Array<{ id: string; read: boolean }>,
}));

// One user object for the life of the test, as the real AuthProvider keeps.
vi.mock("@/hooks/useAuth", () => {
  const auth = { user: { id: "u1" } };
  return { useAuth: () => auth };
});
vi.mock("@/hooks/use-toast", () => ({ toast: () => {} }));
vi.mock("@/integrations/supabase/client", () => {
  const select = () => {
    h.selects += 1;
    const chain = {
      eq: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: h.rows.map((r) => ({ ...r, type: "x", title: r.id, body: null, icon: null, link: null, created_at: "2026-09-25T00:00:00Z" })), error: null }),
    };
    return chain;
  };
  const update = () => ({ eq: () => Promise.resolve({ error: null }) });
  return {
    supabase: {
      from: () => ({ select, update }),
      channel: () => {
        h.channels += 1;
        const ch = { on: () => ch, subscribe: () => ch };
        return ch;
      },
      removeChannel: () => { h.removed += 1; },
    },
  };
});

import { useNotifications } from "./useNotifications";

function Bell() {
  const { unread } = useNotifications();
  return <p>bell {unread}</p>;
}
function Page() {
  const { items, markRead } = useNotifications();
  return (
    <div>
      {items.map((n) => (
        <button key={n.id} onClick={() => void markRead(n.id)}>{`open ${n.id}`}</button>
      ))}
    </div>
  );
}

const renderBoth = () => {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <Bell />
      <Page />
    </QueryClientProvider>,
  );
};

describe("notifications are one list", () => {
  beforeEach(() => {
    h.selects = 0; h.channels = 0; h.removed = 0;
    h.rows = [{ id: "a", read: false }, { id: "b", read: false }];
  });

  it("two readers make one fetch and one realtime channel", async () => {
    renderBoth();
    await screen.findByText("bell 2");
    expect(h.selects).toBe(1);
    expect(h.channels).toBe(1);
  });

  it("marking one read on the page is seen by the bell at once", async () => {
    renderBoth();
    await screen.findByText("open a");
    await act(async () => { screen.getByText("open a").click(); });
    await waitFor(() => expect(screen.getByText("bell 1")).toBeInTheDocument());
  });

  it("the shared channel closes with its last reader", async () => {
    const view = renderBoth();
    await screen.findByText("bell 2");
    view.unmount();
    expect(h.removed).toBe(1);
  });
});
