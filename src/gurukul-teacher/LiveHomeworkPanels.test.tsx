import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ManagedHomeworkRow } from "@/academic";

/**
 * The teacher's homework list, held to what it used to get wrong.
 *
 * 1. ANOTHER SUBJECT'S HOMEWORK OFFERED EVERY CONTROL. A teacher sees every
 *    subject's homework in a class they teach (docs/locked-decisions.md) and
 *    changes only their own; each control on another subject's card was a
 *    button the service then refused. Those cards are view-only now.
 * 2. CLOSED HOMEWORK OFFERED EDIT AND UNPUBLISH until the closure job had run —
 *    a minute, or for as long as a failed charge keeps it unresolved.
 * 3. THE LIST STOPPED AT THE PAGE without a word. Older homework is a click away,
 *    and a reload after an action keeps every page on screen.
 *
 * Each absence is asserted beside a presence on the same screen.
 */
const listForClass = vi.fn();

vi.mock("@/academic", () => ({
  HomeworkService: {
    listForClass: (...a: unknown[]) => listForClass(...a),
    publish: vi.fn(),
    unpublish: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
  },
  WORK_KIND_LABELS: { homework: "Homework" },
  homeworkHasClosed: (hw: { status: string; closesAt: string; resolvedAt: string | null }, now = Date.now()) =>
    hw.resolvedAt !== null || (hw.status === "published" && Date.parse(hw.closesAt) <= now),
  useAcademicLive: () => 0,
}));
vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "school-1", userId: "teacher-1", role: "teacher" }, ready: true };
  return { useAcademicContext: () => value };
});
vi.mock("@/academic/storage/academicFileUpload", () => ({ attachmentOfFile: (f: { name: string }) => ({ name: f.name }) }));
vi.mock("./AttachmentUI", () => ({ AttachmentList: () => null }));
vi.mock("./HomeworkForm", () => ({ HomeworkForm: () => null }));
vi.mock("./HomeworkReview", () => ({ HomeworkReview: () => null }));

import { HOMEWORK_PAGE, LiveHomeworkTab } from "./LiveHomeworkPanels";

const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 3600 * 1000).toISOString();

const row = (over: Partial<ManagedHomeworkRow>): ManagedHomeworkRow => ({
  id: "hw-1",
  schoolId: "school-1",
  classId: "class-1",
  subject: "Mathematics",
  title: "Real numbers",
  questionText: "Prove that √2 is irrational.",
  questionFile: null,
  chapterId: null,
  topicId: null,
  chapterLabel: null,
  closesAt: FUTURE,
  dueDate: FUTURE.slice(0, 10),
  priority: "normal",
  workKind: "homework",
  status: "published",
  scheduledPublishAt: null,
  publishedAt: "2026-09-08T08:00:00.000Z",
  archivedAt: null,
  resolvedAt: null,
  missedCostsXp: true,
  createdBy: "teacher-1",
  createdAt: "2026-09-08T08:00:00.000Z",
  updatedAt: "2026-09-08T08:00:00.000Z",
  completion: null,
  canManage: true,
  ...over,
});

/** The card is the innermost element holding its title and its Hand-ins control. */
const card = (title: string) =>
  screen
    .getAllByText(title)
    .map((t) => t.closest("div.p-4") as HTMLElement)
    .find(Boolean)!;

const renderTab = () => render(<LiveHomeworkTab classId="class-1" classLabel="Class 10 A" subject="Mathematics" />);

describe("LiveHomeworkTab", () => {
  // Braces, not an expression: vitest calls a function returned from beforeEach
  // as that test's teardown, and mockReset returns the mock itself.
  beforeEach(() => {
    listForClass.mockReset();
  });

  it("shows another subject's homework view-only, beside the teacher's own with every control", async () => {
    listForClass.mockResolvedValue([
      row({ id: "own", title: "Own subject" }),
      row({ id: "other", title: "Another subject", subject: "English", canManage: false }),
    ]);
    renderTab();
    await screen.findByText("Another subject");

    const own = within(card("Own subject"));
    for (const name of [/Hand-ins/, /Edit/, /Unpublish/, /Archive/, /Duplicate/, /Delete/]) {
      expect(own.getByRole("button", { name })).toBeTruthy();
    }

    const other = within(card("Another subject"));
    expect(other.getByRole("button", { name: /Hand-ins/ })).toBeTruthy();
    expect(other.getByText(/View only — you do not teach English in this class/)).toBeTruthy();
    for (const name of [/Edit/, /Unpublish/, /Archive/, /Duplicate/, /Delete/, /Publish now/]) {
      expect(other.queryByRole("button", { name })).toBeNull();
    }
  });

  it("offers closed homework only what closed homework allows, before the closure job has run", async () => {
    listForClass.mockResolvedValue([
      row({ id: "open", title: "Still open" }),
      row({ id: "closed", title: "Deadline passed", closesAt: PAST, resolvedAt: null }),
    ]);
    renderTab();
    await screen.findByText("Deadline passed");

    const open = within(card("Still open"));
    expect(open.getByRole("button", { name: /Edit/ })).toBeTruthy();
    expect(open.getByRole("button", { name: /Unpublish/ })).toBeTruthy();

    const closed = within(card("Deadline passed"));
    expect(closed.getByText("Closed")).toBeTruthy();
    expect(closed.getByRole("button", { name: /Archive/ })).toBeTruthy();
    expect(closed.getByRole("button", { name: /Delete/ })).toBeTruthy();
    expect(closed.queryByRole("button", { name: /Edit/ })).toBeNull();
    expect(closed.queryByRole("button", { name: /Unpublish/ })).toBeNull();
  });

  it("does not stop at a page: older homework is fetched on request, and appended", async () => {
    const firstPage = Array.from({ length: HOMEWORK_PAGE }, (_, i) => row({ id: `new-${i}`, title: `Newer ${i}` }));
    listForClass.mockImplementation((_ctx: unknown, _class: unknown, page: { offset: number }) =>
      Promise.resolve(page.offset === 0 ? firstPage : [row({ id: "old-0", title: "The oldest homework" })]),
    );
    renderTab();
    const more = await screen.findByRole("button", { name: "Show older homework" });
    expect(screen.queryByText("The oldest homework")).toBeNull();

    fireEvent.click(more);
    expect(await screen.findByText("The oldest homework")).toBeTruthy();
    expect(listForClass).toHaveBeenCalledWith(expect.anything(), "class-1", { limit: HOMEWORK_PAGE, offset: HOMEWORK_PAGE });
    expect(screen.getByText(`${HOMEWORK_PAGE + 1} homework`)).toBeTruthy();
    // The second page was short: there is nothing older to offer.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Show older homework" })).toBeNull());
    // A full page is the point of the test: HOMEWORK_PAGE cards, then +1,
    // rendered in jsdom. Page size is 25 so this stays under the default
    // vitest budget when the whole suite shares the machine (KI 77).
  }, 10000);

  it("offers no older homework when the first page is not full", async () => {
    listForClass.mockResolvedValue([row({ title: "Only homework" })]);
    renderTab();
    expect(await screen.findByText("Only homework")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show older homework" })).toBeNull();
  });
});
