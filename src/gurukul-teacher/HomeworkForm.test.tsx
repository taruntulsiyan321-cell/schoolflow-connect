import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HomeworkRecord } from "@/academic/repository/homeworkRepository";

/**
 * The teacher's homework form, held to what used to be missing:
 *
 * 1. A SAVED HOMEWORK COULD NOT BE EDITED. `HomeworkService.update` had no
 *    caller, so a draft saved without its question could never be given one,
 *    and a typo in published homework stayed. Editing goes through `update`,
 *    never through `create`.
 * 2. A COPY INHERITED A PASSED DEADLINE. "Duplicate" wrote a draft carrying the
 *    original's deadline, which the database refuses to release. A copy now
 *    starts with no deadline, and cannot be saved until one is set.
 * 3. PUBLISHED HOMEWORK IS ALREADY OUT. Editing it changes its content, not its
 *    release: no draft or schedule choice is offered.
 * 4. SAVING AN EDIT MOVED THE DEADLINE. The field holds minutes, so an untouched
 *    23:59:59 deadline went back as 23:59:00. It now goes back as it was.
 * 5. AN EDIT REFILED ANOTHER SUBJECT'S HOMEWORK. The form sent the subject the
 *    class screen was opened under, so a teacher of Accountancy and Mathematics
 *    in 12 A, on the screen opened as Accountancy, saved a Mathematics homework
 *    as Accountancy. An edit keeps the homework's subject; new homework is set
 *    in one the teacher teaches there, and a teacher of several picks.
 */
const create = vi.fn();
const update = vi.fn();
const subjectsForClass = vi.fn();
const listChaptersForClass = vi.fn();

vi.mock("@/academic", () => ({
  CurriculumService: {
    listChaptersForClass: (...a: unknown[]) => listChaptersForClass(...a),
    listTopics: vi.fn().mockResolvedValue([]),
    addTopic: vi.fn(),
  },
  HomeworkService: {
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    subjectsForClass: (...a: unknown[]) => subjectsForClass(...a),
  },
  HOMEWORK_QUESTION_FILE_PICKER: { accept: ".pdf", kinds: ["pdf", "image", "doc"], label: "an image, a Word document or a PDF" },
  WORK_KINDS: ["homework", "assignment"],
  WORK_KIND_LABELS: { homework: "Homework", assignment: "Assignment" },
}));

vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "school-1", userId: "teacher-1", role: "teacher" }, ready: true };
  return { useAcademicContext: () => value };
});

import { HomeworkForm, type HomeworkFormSource } from "./HomeworkForm";

const homework = (over: Partial<HomeworkRecord>): HomeworkRecord => ({
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
  closesAt: "2026-09-20T11:30:00.000Z",
  dueDate: "2026-09-20",
  priority: "normal",
  workKind: "homework",
  status: "draft",
  scheduledPublishAt: null,
  publishedAt: null,
  archivedAt: null,
  resolvedAt: null,
  missedCostsXp: true,
  createdBy: "teacher-1",
  createdAt: "2026-09-13T08:00:00.000Z",
  updatedAt: "2026-09-13T08:00:00.000Z",
  ...over,
});

const renderForm = (source?: HomeworkFormSource) => {
  const onSaved = vi.fn();
  render(
    <HomeworkForm classId="class-1" classLabel="Class 10 A" subject="Mathematics" source={source} onSaved={onSaved} onCancel={vi.fn()} />,
  );
  return { onSaved };
};

const deadlineInput = () => document.querySelector('input[type="datetime-local"]') as HTMLInputElement;

describe("the teacher's homework form", () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({ id: "hw-new" });
    update.mockReset().mockResolvedValue({ id: "hw-1" });
    subjectsForClass.mockReset().mockResolvedValue(["Mathematics"]);
    listChaptersForClass.mockReset().mockResolvedValue([]);
  });

  it("sets new homework through create, published, with the deadline as an instant", async () => {
    const { onSaved } = renderForm();
    fireEvent.change(screen.getByPlaceholderText("Title *"), { target: { value: "Polynomials" } });
    fireEvent.change(screen.getByPlaceholderText("The question"), { target: { value: "Find the zeroes of x² − 3x + 2." } });
    fireEvent.change(deadlineInput(), { target: { value: "2026-09-25T17:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const [, input] = create.mock.calls[0];
    expect(input).toMatchObject({ classId: "class-1", title: "Polynomials", status: "published", questionFile: null });
    expect(input.closesAt).toBe(new Date("2026-09-25T17:00").toISOString());
    expect(update).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it("edits a draft through update, and can publish it", async () => {
    renderForm({ as: "edit", homework: homework({ status: "draft" }) });
    expect(screen.getByPlaceholderText("Title *")).toHaveValue("Real numbers");
    expect(deadlineInput().value).not.toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const [, id, input] = update.mock.calls[0];
    expect(id).toBe("hw-1");
    expect(input).toMatchObject({ status: "published", questionText: "Prove that √2 is irrational." });
    expect(create).not.toHaveBeenCalled();
  });

  it("edits published homework without offering to take it back to draft", async () => {
    renderForm({ as: "edit", homework: homework({ status: "published", publishedAt: "2026-09-13T08:00:00.000Z" }) });
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schedule" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Title *"), { target: { value: "Real numbers (corrected)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][2]).toMatchObject({ title: "Real numbers (corrected)", status: "published" });
  });

  // The deadline field holds minutes. Every homework that existed before the
  // one-deadline model closes at 23:59:59, and saving any edit used to send the
  // field back as 23:59:00 — moving a released deadline a minute earlier
  // because the teacher fixed a typo.
  it("keeps a deadline the teacher did not touch to the second", async () => {
    renderForm({ as: "edit", homework: homework({ status: "published", closesAt: "2026-09-20T18:29:59.000Z" }) });
    fireEvent.change(screen.getByPlaceholderText("Title *"), { target: { value: "Real numbers (typo fixed)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][2].closesAt).toBe("2026-09-20T18:29:59.000Z");
  });

  it("sends the deadline the teacher changed it to", async () => {
    renderForm({ as: "edit", homework: homework({ status: "published", closesAt: "2026-09-20T18:29:59.000Z" }) });
    fireEvent.change(deadlineInput(), { target: { value: "2026-09-27T17:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][2].closesAt).toBe(new Date("2026-09-27T17:00").toISOString());
  });

  it("starts a copy with no deadline, and will not set it until one is given", async () => {
    renderForm({ as: "copy", homework: homework({ status: "published", closesAt: "2026-09-01T11:30:00.000Z" }) });
    expect(screen.getByPlaceholderText("Title *")).toHaveValue("Real numbers (copy)");
    expect(deadlineInput().value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText(/Set the deadline\./)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(deadlineInput(), { target: { value: "2026-09-30T17:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps an edited homework's own subject, whatever subject the screen was opened under", async () => {
    render(
      <HomeworkForm
        classId="class-1"
        classLabel="Class 12 A"
        subject="Accountancy"
        source={{ as: "edit", homework: homework({ status: "published", subject: "Mathematics" }) }}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Its chapters are the Mathematics chapters, not the screen's subject's.
    await waitFor(() => expect(listChaptersForClass).toHaveBeenCalledWith(expect.anything(), "Class 12 A", "Mathematics"));
    expect(listChaptersForClass).not.toHaveBeenCalledWith(expect.anything(), "Class 12 A", "Accountancy");
    // An edit has no subject to choose.
    expect(screen.queryByRole("combobox", { name: /Subject/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][2].subject).toBe("Mathematics");
  });

  it("sets new homework in whichever of the teacher's subjects in the class they pick", async () => {
    subjectsForClass.mockResolvedValue(["Accountancy", "Mathematics"]);
    render(
      <HomeworkForm classId="class-1" classLabel="Class 12 A" subject="Accountancy" onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    const picker = await screen.findByRole("combobox", { name: /Subject/ });
    expect(picker).toHaveValue("Accountancy");
    fireEvent.change(picker, { target: { value: "Mathematics" } });
    await waitFor(() => expect(listChaptersForClass).toHaveBeenCalledWith(expect.anything(), "Class 12 A", "Mathematics"));

    fireEvent.change(screen.getByPlaceholderText("Title *"), { target: { value: "Matrices" } });
    fireEvent.change(screen.getByPlaceholderText("The question"), { target: { value: "Find the inverse." } });
    fireEvent.change(deadlineInput(), { target: { value: "2026-09-25T17:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][1].subject).toBe("Mathematics");
  });

  it("offers no subject picker to a teacher of one subject in the class", async () => {
    renderForm();
    await waitFor(() => expect(subjectsForClass).toHaveBeenCalled());
    // Positive control: the form rendered, and says which subject it sets.
    expect(screen.getByText(/New homework · For Class 10 A · Mathematics/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Subject/ })).toBeNull();
  });
});
