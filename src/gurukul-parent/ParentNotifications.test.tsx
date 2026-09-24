import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * A parent's notification opens what it is about — a parent page. The page
 * used to open nothing, and the router handed parents the student's own link
 * ("/student/homework"), which the parent panel cannot open.
 */
const markRead = vi.fn();
const items = [
  {
    id: "n1",
    type: "homework",
    title: "New homework",
    body: "Real numbers",
    icon: null,
    link: "/parent/children",
    read: false,
    created_at: "2026-09-15T08:00:00.000Z",
  },
  {
    id: "n2",
    type: "homework",
    title: "Old homework alert",
    body: "Written before the parent link",
    icon: null,
    link: "/student/homework",
    read: false,
    created_at: "2026-09-10T08:00:00.000Z",
  },
];

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({
    items,
    unread: 2,
    loading: false,
    error: null,
    markRead: (...a: unknown[]) => markRead(...a),
    markAllRead: vi.fn(),
    remove: vi.fn(),
  }),
}));

import ParentNotifications from "./Notifications";
import { parentLinkOf } from "./nav";

function renderAt() {
  render(
    <MemoryRouter initialEntries={["/parent/notifications"]}>
      <Routes>
        <Route path="/parent/notifications" element={<ParentNotifications />} />
        <Route path="/parent/children" element={<div>My Children page</div>} />
        <Route path="/student/homework" element={<div>Student homework page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("parent notifications", () => {
  beforeEach(() => {
    markRead.mockReset();
  });

  it("opens the parent page a notification is about, and marks it read", () => {
    renderAt();
    fireEvent.click(screen.getByText("New homework"));
    expect(screen.getByText("My Children page")).toBeInTheDocument();
    expect(markRead).toHaveBeenCalledWith("n1");
  });

  it("does not send a parent into the student panel", () => {
    renderAt();
    fireEvent.click(screen.getByText("Old homework alert"));
    expect(screen.queryByText("Student homework page")).toBeNull();
    expect(screen.getByText("Old homework alert")).toBeInTheDocument();
    expect(markRead).toHaveBeenCalledWith("n2");
  });

  it("follows only parent links", () => {
    expect(parentLinkOf({ link: "/parent" })).toBe("/parent");
    expect(parentLinkOf({ link: "/parent/marks" })).toBe("/parent/marks");
    expect(parentLinkOf({ link: "/student/tests" })).toBeNull();
    expect(parentLinkOf({ link: "/parentship" })).toBeNull();
    expect(parentLinkOf({ link: null })).toBeNull();
  });
});
