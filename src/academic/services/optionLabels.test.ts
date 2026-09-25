import { describe, expect, it } from "vitest";
import { stripOptionLabels } from "../../../supabase/functions/_shared/optionLabels.ts";

describe("option labels", () => {
  it("removes the labels a page printed, in every common form", () => {
    expect(stripOptionLabels(["(A) Unity of Direction", "(B) Unity of Command", "(C) Scalar Chain", "(D) Centralisation"]))
      .toEqual(["Unity of Direction", "Unity of Command", "Scalar Chain", "Centralisation"]);
    expect(stripOptionLabels(["a. 5", "b. 10", "c. 15"])).toEqual(["5", "10", "15"]);
    expect(stripOptionLabels(["1) Planning", "2) Organising"])).toEqual(["Planning", "Organising"]);
    expect(stripOptionLabels(["A: yes", "B: no"])).toEqual(["yes", "no"]);
  });

  it("CONTROL: leaves options alone unless every one is labelled in order", () => {
    expect(stripOptionLabels(["Unity of Direction", "Unity of Command"])).toEqual(["Unity of Direction", "Unity of Command"]);
    expect(stripOptionLabels(["A. B. Smith", "C. D. Jones"])).toEqual(["A. B. Smith", "C. D. Jones"]);
    expect(stripOptionLabels(["(A) only this one", "no label"])).toEqual(["(A) only this one", "no label"]);
    expect(stripOptionLabels(["(B) first", "(A) second"])).toEqual(["(B) first", "(A) second"]);
  });
});
