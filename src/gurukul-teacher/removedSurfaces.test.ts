/**
 * Chat and the teacher's Question Bank are removed (ruling 2026-09-13).
 *
 * A removal is easy to half-do: the screen goes, the nav entry stays; the nav
 * entry goes, a stale import keeps the module in the bundle; one panel loses
 * chat and the other three keep writing into it. This file is the measurement
 * for all three failure modes, and every claim here fails if the thing comes
 * back.
 *
 * The source scan carries its own positive control: it asserts that a module
 * that DOES exist is found by the same walk, so "no hits" can never mean "the
 * walk found no files".
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  TEACHER_PAGE_TITLES,
  TEACHER_PAGE_PATH,
  teacherPathToPage,
} from "./nav";
import { PARENT_PAGE_TITLES, parentPathToPage } from "../gurukul-parent/nav";
import { PAGE_TITLE, pathToPage } from "../gurukul/nav";

const SRC = resolve(__dirname, "..");

function everySourceFile(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) everySourceFile(p, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

// This file names every removed module, so it must not scan itself.
const FILES = everySourceFile(SRC).filter((f) => f !== resolve(__filename));

function filesMentioning(needle: string): string[] {
  return FILES.filter((f) => readFileSync(f, "utf8").includes(needle)).map((f) =>
    f.slice(SRC.length + 1),
  );
}

describe("the teacher panel after the removals", () => {
  it("has no Communication, Question Bank or AI Coach page", () => {
    const titles = Object.values(TEACHER_PAGE_TITLES);
    expect(titles).not.toContain("Communication");
    expect(titles).not.toContain("Question Bank");
    expect(titles).not.toContain("AI Coach");
    // Positive control: the pages that stayed are still here, so an empty
    // title map could not pass the three assertions above.
    expect(titles).toContain("Question Papers");
    expect(titles).toContain("Student Doubts");
    expect(Object.keys(TEACHER_PAGE_PATH)).toContain("questionpapers");
  });

  it("sends the retired addresses to Question Papers, not to a dead route", () => {
    expect(teacherPathToPage("/teacher/question-bank")).toBe("questionpapers");
    expect(teacherPathToPage("/teacher/ai-coach")).toBe("questionpapers");
    expect(teacherPathToPage("/teacher/practice")).toBe("questionpapers");
    // Chat has no home at all, so it falls back to the dashboard.
    expect(teacherPathToPage("/teacher/communication")).toBe("dashboard");
    expect(teacherPathToPage("/teacher/chat")).toBe("dashboard");
    // Positive control: a path that still resolves to its own page.
    expect(teacherPathToPage("/teacher/classes")).toBe("myclasses");
  });
});

describe("chat is gone from the other panels too", () => {
  it("the parent has no Messages page and /parent/chat lands on notices", () => {
    expect(Object.values(PARENT_PAGE_TITLES)).not.toContain("Messages");
    expect(parentPathToPage("/parent/chat")).toBe("announcements");
    expect(parentPathToPage("/parent/messages")).toBe("announcements");
    expect(parentPathToPage("/parent/marks")).toBe("test_results"); // control
  });

  it("the student has no Chat page", () => {
    expect(Object.values(PAGE_TITLE)).not.toContain("Chat");
    expect(pathToPage("/student/chat")).not.toBe("chat");
    expect(pathToPage("/student/practice")).toBe("practice"); // control
  });
});

describe("nothing in src still reaches for what was deleted", () => {
  it("finds no importer of the removed modules", () => {
    for (const gone of [
      "services/messageService",
      "MessageService",
      "shared/ChatPage",
      "components/chat/",
      "QuestionBankPage",
      "TeacherAICoach",
      "chatFileUpload",
    ]) {
      expect({ gone, importers: filesMentioning(gone) }).toEqual({ gone, importers: [] });
    }
  });

  it("the deleted files are not on disk", () => {
    for (const gone of [
      "pages/shared/ChatPage.tsx",
      "gurukul-teacher/Communication.tsx",
      "gurukul-teacher/TeacherAICoach.tsx",
      "gurukul-parent/Messages.tsx",
      "academic/services/messageService.ts",
      "pages/shared/QuestionBankPage.tsx",
    ]) {
      expect({ gone, onDisk: existsSync(join(SRC, gone)) }).toEqual({ gone, onDisk: false });
    }
    // Positive control: the same check against a file that is still there.
    expect(existsSync(join(SRC, "academic/services/testService.ts"))).toBe(true);
  });

  it("the scan can actually find things (positive control)", () => {
    expect(filesMentioning("services/testService").length).toBeGreaterThan(0);
    expect(FILES.length).toBeGreaterThan(300);
  });
});
