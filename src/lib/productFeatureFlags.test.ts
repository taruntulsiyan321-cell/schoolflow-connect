import { describe, expect, it } from "vitest";
import {
  COMING_SOON_LABEL,
  NOVA_FEATURE_FLAGS,
  UNAVAILABLE_FEATURE_MODE,
  comingSoonToast,
  resolveFeaturePresentation,
  resolveNovaPresentation,
} from "./productFeatureFlags";

describe("productFeatureFlags", () => {
  it("uses Coming Soon label from config (not Not available)", () => {
    expect(COMING_SOON_LABEL).toBe("Coming Soon");
    expect(COMING_SOON_LABEL.toLowerCase()).not.toContain("not available");
  });

  it("resolves deferred features from UNAVAILABLE_FEATURE_MODE", () => {
    expect(["hide", "coming_soon"]).toContain(UNAVAILABLE_FEATURE_MODE);
    expect(resolveFeaturePresentation(true)).toBe("live");
    expect(resolveFeaturePresentation(false)).toBe(
      UNAVAILABLE_FEATURE_MODE === "hide" ? "hidden" : "coming_soon",
    );
  });

  it("presents Nova attachments from their flag — live by default", () => {
    expect(resolveNovaPresentation("attachment")).toBe(resolveFeaturePresentation(NOVA_FEATURE_FLAGS.attachment));
    expect(NOVA_FEATURE_FLAGS.attachment).toBe(true);
    expect(resolveNovaPresentation("attachment")).toBe("live");
    // Voice is no flag: the browser decides (useSpeechCapture).
    expect(Object.keys(NOVA_FEATURE_FLAGS)).toEqual(["attachment"]);
  });

  it("words a deferred capability's toast with the Coming Soon label", () => {
    expect(comingSoonToast("Attachments")).toBe(`Attachments — ${COMING_SOON_LABEL}`);
  });
});
