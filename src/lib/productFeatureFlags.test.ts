import { describe, expect, it } from "vitest";
import {
  COMING_SOON_LABEL,
  DOUBT_ATTACH_FLAGS,
  UNAVAILABLE_FEATURE_MODE,
  listDoubtAttachControls,
  resolveDoubtAttachPresentation,
  resolveFeaturePresentation,
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

  it("lists only visible doubt attach controls", () => {
    const controls = listDoubtAttachControls();
    for (const c of controls) {
      expect(["live", "coming_soon"]).toContain(c.presentation);
      expect(c.presentation).toBe(resolveDoubtAttachPresentation(c.id));
    }
    if (UNAVAILABLE_FEATURE_MODE === "hide") {
      expect(controls.every((c) => DOUBT_ATTACH_FLAGS[c.id])).toBe(true);
    } else {
      expect(controls.map((c) => c.id).sort()).toEqual(["camera", "image", "pdf", "voice"]);
      expect(controls.every((c) => c.presentation === "coming_soon" || DOUBT_ATTACH_FLAGS[c.id])).toBe(true);
    }
  });

  it("can scope reply strip to image + voice only", () => {
    const reply = listDoubtAttachControls(["image", "voice"]);
    expect(reply.every((c) => c.id === "image" || c.id === "voice")).toBe(true);
  });
});
