import { describe, expect, it } from "vitest";
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_PAGES } from "./uploadLimits";

describe("uploadLimits (§13)", () => {
  it("size is 20 MiB (storage home)", () => {
    expect(UPLOAD_MAX_BYTES).toBe(20 * 1024 * 1024);
  });

  it("the page cap is the ruled number", () => {
    expect(UPLOAD_MAX_PAGES).toBe(20);
  });
});
