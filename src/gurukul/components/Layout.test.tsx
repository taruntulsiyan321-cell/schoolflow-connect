import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PageKey } from "@/gurukul/nav";

/**
 * The menu under its five heads (owner, 2026-10-03): the sidebar shows each head
 * as a section; a phone shows one tab per head, and the open head's pages along
 * the top. Which of those a screen width draws is CSS (md:), so all three are in
 * the DOM here; the browser check measures what each width shows.
 */

const notes = vi.hoisted(() => ({ unread: 0, photo: null as string | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, signOut: vi.fn() }) }));
vi.mock("@/hooks/useProfilePhoto", () => ({ useProfilePhoto: () => ({ url: notes.photo, hasPhoto: Boolean(notes.photo) }) }));
vi.mock("@/hooks/useNotifications", () => ({ useNotifications: () => ({ unread: notes.unread }) }));

import Layout from "./Layout";

function show(page: PageKey) {
  const setPage = vi.fn();
  render(
    <MemoryRouter>
      <Layout page={page} setPage={setPage} profile={{ name: "Asha", avatar: "AS" }}>
        <p>Page body</p>
      </Layout>
    </MemoryRouter>,
  );
  const [sidebar, bottom] = screen.getAllByRole("navigation", { name: "Main" });
  return { setPage, sidebar, bottom };
}

beforeEach(() => {
  notes.unread = 0;
  notes.photo = null;
});

describe("the student's photo where the initials were (D1)", () => {
  it("shows the photo in the top bar, the account menu and the Account tab", () => {
    notes.photo = "https://signed.example/me.jpg";
    const { bottom } = show("dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    const photos = screen.getAllByTestId("student-photo");
    // Top bar, menu, Account tab.
    expect(photos).toHaveLength(3);
    for (const p of photos) expect(p).toHaveAttribute("src", "https://signed.example/me.jpg");
    expect(within(bottom).getByRole("button", { name: /Account/ })).not.toHaveTextContent("AS");
  });

  it("CONTROL: the initials, with no photo", () => {
    show("dashboard");
    expect(screen.queryByTestId("student-photo")).toBeNull();
    expect(screen.getByRole("button", { name: "Your account" })).toHaveTextContent("AS");
  });

  it("falls back to the initials when the photo will not load", () => {
    notes.photo = "https://signed.example/expired.jpg";
    show("dashboard");
    const top = within(screen.getByRole("button", { name: "Your account" })).getByTestId("student-photo");
    fireEvent.error(top);
    expect(screen.getByRole("button", { name: "Your account" })).toHaveTextContent("AS");
  });
});

describe("the sidebar", () => {
  it("lists every page under its head, the current one marked", () => {
    const { sidebar } = show("mocktests");
    const sections = within(sidebar).getAllByRole("group");
    expect(sections.map((s) => [s.getAttribute("aria-label"), within(s).getAllByRole("button").map((b) => b.textContent)])).toEqual([
      ["Home", ["Home"]],
      ["Study", ["Practice", "Mock Tests", "AI Coach"]],
      ["Improve", ["Recovery", "Revision", "Mistake Book"]],
      ["Progress", ["Analysis", "Achievements"]],
      ["Account", ["Profile", "Plans", "Notifications"]],
    ]);
    expect(within(sidebar).getByRole("button", { name: "Mock Tests" })).toHaveAttribute("aria-current", "page");
    expect(within(sidebar).getByRole("button", { name: "Practice" })).not.toHaveAttribute("aria-current");
  });
});

describe("on a phone", () => {
  it("one tab per head; the open head is lit, and a head opens its first page", () => {
    const { bottom, setPage } = show("mistakebook");
    const tabs = within(bottom).getAllByRole("button");
    expect(tabs.map((t) => t.textContent?.replace(/^AS/, ""))).toEqual(["Home", "Study", "Improve", "Progress", "Account"]);
    expect(within(bottom).getByRole("button", { name: "Improve" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(bottom).getByRole("button", { name: "Progress" }));
    expect(setPage).toHaveBeenLastCalledWith("analysis");
    fireEvent.click(within(bottom).getByRole("button", { name: /Account/ }));
    expect(setPage).toHaveBeenLastCalledWith("profile");
  });

  it("the open head's pages run along the top, and each opens", () => {
    const { setPage } = show("revision");
    const row = screen.getByRole("navigation", { name: "Improve" });
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["Recovery", "Revision", "Mistake Book"]);
    expect(within(row).getByRole("button", { name: "Revision" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(row).getByRole("button", { name: "Mistake Book" }));
    expect(setPage).toHaveBeenLastCalledWith("mistakebook");
  });

  it("the bottom bar is the column's last row, not laid over the page", () => {
    const { bottom } = show("practice");
    expect(bottom.className).not.toMatch(/\bfixed\b/);
    const main = screen.getByRole("main");
    // Nothing reserves room for a bar on top of it, either.
    expect((main.firstElementChild as HTMLElement).className).not.toMatch(/pb-24/);
    expect(main.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a page that fills the screen gets a full-height frame; a document page gets padding", () => {
    show("aicoach");
    expect((screen.getByRole("main").firstElementChild as HTMLElement).className).toMatch(/\bh-full\b/);
    cleanup();
    show("practice");
    const frame = screen.getByRole("main").firstElementChild as HTMLElement;
    expect(frame.className).not.toMatch(/\bh-full\b/);
    expect(frame.className).toMatch(/\bp-4\b/);
  });

  it("Home is a head of one page, so no row is drawn", () => {
    show("dashboard");
    // CONTROL: the row exists for a head of several pages (above); none for Home.
    expect(screen.queryByRole("navigation", { name: "Home" })).toBeNull();
    expect(screen.getAllByRole("navigation")).toHaveLength(2);
  });
});

describe("unread notifications", () => {
  it("are counted on Notifications and on the Account tab", () => {
    notes.unread = 3;
    const { sidebar, bottom } = show("profile");
    expect(within(sidebar).getByRole("button", { name: /Notifications/ })).toHaveTextContent("3");
    expect(within(bottom).getByRole("button", { name: /Account/ })).toHaveTextContent("3");
    expect(within(screen.getByRole("navigation", { name: "Account" })).getByRole("button", { name: /Notifications/ }))
      .toHaveTextContent("3");
  });

  it("none unread: no count anywhere", () => {
    show("profile");
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });
});

describe("the student's initials", () => {
  it("are shown once known, and until then a plain figure — never a made-up pair", () => {
    render(
      <MemoryRouter>
        <Layout page="dashboard" setPage={vi.fn()} profile={{}}>
          <p>Page body</p>
        </Layout>
      </MemoryRouter>,
    );
    const account = screen.getByRole("button", { name: "Your account" });
    expect(account.textContent).toBe("");
    expect(account.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("ST")).toBeNull();
    cleanup();
    // CONTROL: known initials are drawn.
    show("dashboard");
    expect(screen.getByRole("button", { name: "Your account" })).toHaveTextContent("AS");
  });
});

describe("the account menu", () => {
  it("is who is signed in, and Sign out — the pages it linked are in the menu now", () => {
    show("dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Asha")).toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Sign out"]);
  });
});
