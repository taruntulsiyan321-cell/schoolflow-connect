import { describe, expect, it } from "vitest";
import {
  FIRST_STREAM_CLASS,
  appliesCommerceSubjectAllowlist,
  appliesScienceSubjectAllowlist,
  streamForClass,
  subjectsForStreamPicker,
} from "./curriculumScope";

describe("a stream applies only from Class 11", () => {
  it("drops a school's stream below Class 11 and keeps it from 11", () => {
    expect(FIRST_STREAM_CLASS).toBe(11);
    expect(streamForClass("commerce", 9)).toBeNull();
    expect(streamForClass("commerce", 10)).toBeNull();
    expect(streamForClass("commerce", 11)).toBe("commerce");
    expect(streamForClass("science", 12)).toBe("science");
  });

  it("keeps the stream when the class is unknown, and has none when there is none", () => {
    expect(streamForClass("commerce", null)).toBe("commerce");
    expect(streamForClass(null, 12)).toBeNull();
  });

  it("the subject allowlists follow the same rule", () => {
    expect(appliesCommerceSubjectAllowlist("commerce", 10)).toBe(false);
    expect(appliesCommerceSubjectAllowlist("commerce", 12)).toBe(true);
    expect(appliesScienceSubjectAllowlist("science", 9)).toBe(false);
    expect(appliesScienceSubjectAllowlist("science", 11)).toBe(true);
  });

  it("a Class 10 student at a commerce school is offered the general subjects", () => {
    const general = ["Mathematics", "Science", "Social Science", "English", "Hindi"];
    expect(subjectsForStreamPicker("commerce", 10, general)).toEqual(general);
    expect(subjectsForStreamPicker("commerce", 12, general)).not.toContain("Science");
  });
});
