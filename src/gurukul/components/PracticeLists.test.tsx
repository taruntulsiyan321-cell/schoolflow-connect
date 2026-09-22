import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * A practice list that is still loading, or that failed, is never shown as an
 * empty bank.
 *
 * Measured 2026-09-22 in the browser: tapping a subject in Chapter Practice
 * said "No chapters in the bank for this subject yet." for the second or so
 * the chapter list took, every time, and then replaced it with 15 chapters.
 * The subject list did the same while it loaded. And a topic list's Try again
 * also re-read the chapters, which cleared the chapter the student had picked.
 * The hub said "No practice in the last 7 days" while its history loaded.
 */
const listBankChapters = vi.fn();
const listBankTopics = vi.fn();

vi.mock("@/academic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/academic")>();
  const value = {
    ctx: { schoolId: "school-1", userId: "user-1", role: "student", studentId: "stu-1" },
    ready: true,
    settled: true,
  };
  return {
    ...actual,
    useAcademicContext: () => value,
    PracticeService: {
      ...actual.PracticeService,
      listBankChapters: (...a: unknown[]) => listBankChapters(...a),
      listBankTopics: (...a: unknown[]) => listBankTopics(...a),
    },
  };
});

const { ConfigView, Hub } = await import("@/gurukul/pages/Practice");
const { SubjectPicker } = await import("./PracticeLists");
const { EMPTY_LIST, LOADING_LIST } = await import("@/lib/listState");

const MATHS = { status: "ready" as const, items: [{ id: "mathematics", name: "Mathematics", color: "#000" }] };
const CHAPTERS = [
  { id: "Real Numbers", displayName: "Real Numbers" },
  { id: "Polynomials", displayName: "Polynomials" },
];
const TOPICS = [{ id: "t-1", displayName: "HCF and LCM", chapter: "Real Numbers" }];

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const renderConfig = (modeKey: "chapter" | "topic") =>
  render(<ConfigView modeKey={modeKey} onStart={() => {}} onBack={() => {}} subjectList={MATHS} onRetrySubjects={() => {}} />);

const EMPTY_CHAPTERS = "No chapters in the bank for this subject yet.";

describe("a practice list says it is loading until it has been read", () => {
  beforeEach(() => {
    listBankChapters.mockReset();
    listBankTopics.mockReset();
  });

  it("does not claim the bank has no chapters while the chapters load", async () => {
    const read = deferred<typeof CHAPTERS>();
    listBankChapters.mockReturnValueOnce(read.promise);
    renderConfig("chapter");
    fireEvent.click(screen.getByRole("button", { name: "Mathematics" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByText(EMPTY_CHAPTERS)).toBeNull();

    read.resolve(CHAPTERS);
    expect(await screen.findByRole("button", { name: "Polynomials" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says the bank has no chapters once a read comes back empty", async () => {
    // The positive control: the empty sentence is reachable, so its absence
    // above is the loading state working, not the sentence having gone.
    listBankChapters.mockResolvedValueOnce([]);
    renderConfig("chapter");
    fireEvent.click(screen.getByRole("button", { name: "Mathematics" }));
    expect(await screen.findByText(EMPTY_CHAPTERS)).toBeInTheDocument();
  });

  it("says a failed read failed, and Try again reads it again", async () => {
    listBankChapters.mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce(CHAPTERS);
    renderConfig("chapter");
    fireEvent.click(screen.getByRole("button", { name: "Mathematics" }));
    expect(await screen.findByText(/Could not load this list/)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_CHAPTERS)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Real Numbers" })).toBeInTheDocument();
    expect(listBankChapters).toHaveBeenCalledTimes(2);
  });

  it("retries a failed topic list without clearing the chapter the student picked", async () => {
    listBankChapters.mockResolvedValue(CHAPTERS);
    listBankTopics
      .mockResolvedValueOnce(TOPICS)            // the subject's topics, before a chapter
      .mockRejectedValueOnce(new Error("503"))  // the chapter's topics fail
      .mockResolvedValueOnce(TOPICS);           // Try again
    renderConfig("topic");
    fireEvent.click(screen.getByRole("button", { name: "Mathematics" }));
    fireEvent.click(await screen.findByRole("button", { name: "Real Numbers" }));
    await waitFor(() => expect(screen.getByText(/Could not load this list/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "HCF and LCM" })).toBeInTheDocument();
    expect(listBankChapters, "a topic retry must not re-read the chapters").toHaveBeenCalledTimes(1);
    const lastTopicRead = listBankTopics.mock.calls.at(-1)?.[1] as { chapter: string | null };
    expect(lastTopicRead.chapter).toBe("Real Numbers");
    expect(screen.getByRole("button", { name: "Real Numbers" }).className).toContain("bg-primary");
  });

  it("does not claim the hub's history and saved sessions are empty while they load, or when they fail", () => {
    const onRetryHistory = vi.fn();
    const hub = (list: Parameters<typeof Hub>[0]["historyList"]) => (
      <MemoryRouter>
        <Hub onMode={() => {}} historyList={list} savedList={list} onRetryHistory={onRetryHistory} streak={0}
          onOpenSession={() => {}} onSaveLatest={() => {}} savingLatest={false}
          historyFilters={{ search: "", subject: "", practiceType: "", date: "" }} onHistoryFilters={() => {}} subjects={[]} />
      </MemoryRouter>
    );
    const { rerender } = render(hub(LOADING_LIST));
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.queryByText(/No practice in the last/)).toBeNull();
    expect(screen.queryByText("No saved sessions yet")).toBeNull();

    rerender(hub({ status: "failed" }));
    expect(screen.getAllByText(/Could not load this list/)).toHaveLength(2);
    expect(screen.queryByText(/No practice in the last/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
    expect(onRetryHistory).toHaveBeenCalledTimes(1);

    // The positive control: both empty sentences are reachable.
    rerender(hub(EMPTY_LIST));
    expect(screen.getByText(/No practice in the last/)).toBeInTheDocument();
    expect(screen.getByText("No saved sessions yet")).toBeInTheDocument();
  });

  it("does not claim the bank has no subjects while the subjects load", () => {
    const { rerender } = render(<SubjectPicker list={LOADING_LIST} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByText(/No subjects in the question bank/)).toBeNull();
    rerender(<SubjectPicker list={EMPTY_LIST} selected={null} onSelect={() => {}} />);
    expect(screen.getByText(/No subjects in the question bank/)).toBeInTheDocument();
  });
});
