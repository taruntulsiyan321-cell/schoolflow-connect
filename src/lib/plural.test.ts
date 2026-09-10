import { describe, it, expect } from "vitest";
import { pluralise, pluraliseWord } from "./plural";

describe("pluralise", () => {
  it("says 'mistake' for exactly one — the bug this exists to kill", () => {
    expect(pluralise(1, "mistake")).toBe("1 mistake");
  });

  it("pluralises everything else, including zero", () => {
    expect(pluralise(0, "mistake")).toBe("0 mistakes");
    expect(pluralise(2, "mistake")).toBe("2 mistakes");
    expect(pluralise(14, "mistake")).toBe("14 mistakes");
  });

  it("takes an explicit plural where adding s is wrong", () => {
    expect(pluralise(1, "try", "tries")).toBe("1 try");
    expect(pluralise(3, "try", "tries")).toBe("3 tries");
  });

  it("does not treat -1 as singular", () => {
    // Not reachable from a count today, but a negative rendering as "-1 mistake"
    // would read as correct English and hide whatever produced it.
    expect(pluralise(-1, "mistake")).toBe("-1 mistakes");
  });

  it("returns the bare word when the number is rendered separately", () => {
    expect(pluraliseWord(1, "mistake")).toBe("mistake");
    expect(pluraliseWord(6, "mistake")).toBe("mistakes");
    expect(pluraliseWord(1, "try", "tries")).toBe("try");
  });
});
