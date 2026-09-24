import { describe, expect, it } from "vitest";
import {
  UPLOAD_CLASSIFIER_MODEL,
  UPLOAD_CONFIDENCE_THRESHOLD,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_PAGES,
  UPLOAD_MAX_PER_ACCOUNT,
} from "./uploadLimits";

describe("uploadLimits (§13)", () => {
  it("confidence is 0.55 (tuned with §4.5; same as IMAGE_DOUBT)", () => {
    expect(UPLOAD_CONFIDENCE_THRESHOLD).toBe(0.55);
  });

  it("size is 20 MiB (storage home)", () => {
    expect(UPLOAD_MAX_BYTES).toBe(20 * 1024 * 1024);
  });

  it("page and keep caps are the ruled numbers", () => {
    expect(UPLOAD_MAX_PAGES).toBe(20);
    expect(UPLOAD_MAX_PER_ACCOUNT).toBe(40);
  });

  it("names the classifier model", () => {
    expect(UPLOAD_CLASSIFIER_MODEL).toMatch(/qwen/i);
  });
});
