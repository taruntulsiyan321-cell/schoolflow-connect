import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

/**
 * The Android app's half of a push: the phone's token is saved for the signed-in
 * user, and tapping a notification opens the page it is about — an in-app path
 * only, never a link out of the app.
 */
const listeners: Record<string, (payload: unknown) => unknown> = {};
const register = vi.fn();
const upsert = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
}));
vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    checkPermissions: async () => ({ receive: "granted" }),
    requestPermissions: async () => ({ receive: "granted" }),
    register: async () => register(),
    addListener: async (event: string, cb: (payload: unknown) => unknown) => {
      listeners[event] = cb;
      return {
        remove: async () => {
          delete listeners[event];
        },
      };
    },
  },
}));
vi.mock("@/hooks/useAuth", () => {
  const value = { user: { id: "user-1" } };
  return { useAuth: () => value };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ upsert: (...a: unknown[]) => upsert(...a) }) },
}));

import { pushLinkOf, usePushNotifications } from "./usePushNotifications";

function Probe() {
  usePushNotifications();
  return <div data-testid="path">{useLocation().pathname}</div>;
}

describe("push notifications on the phone", () => {
  beforeEach(() => {
    register.mockReset();
    upsert.mockReset().mockResolvedValue({ error: null });
    for (const k of Object.keys(listeners)) delete listeners[k];
  });

  it("listens before registering, and saves the phone's token for the signed-in user", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Probe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(Object.keys(listeners).sort()).toEqual(["pushNotificationActionPerformed", "registration", "registrationError"]);
    await act(async () => {
      await listeners.registration({ value: "fcm-token-1" });
    });
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "user-1", token: "fcm-token-1", platform: "android" },
      { onConflict: "token" },
    );
  });

  it("opens the page a tapped notification is about", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Probe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(listeners.pushNotificationActionPerformed).toBeDefined());
    act(() => {
      listeners.pushNotificationActionPerformed({ notification: { data: { link: "/parent/children" } } });
    });
    expect(screen.getByTestId("path").textContent).toBe("/parent/children");
  });

  it("never follows a link out of the app", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Probe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(listeners.pushNotificationActionPerformed).toBeDefined());
    act(() => {
      listeners.pushNotificationActionPerformed({ notification: { data: { link: "//evil.example/x" } } });
    });
    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(pushLinkOf({ link: "https://evil.example" })).toBeNull();
    expect(pushLinkOf({ link: "/student/homework" })).toBe("/student/homework");
    expect(pushLinkOf(null)).toBeNull();
  });
});
