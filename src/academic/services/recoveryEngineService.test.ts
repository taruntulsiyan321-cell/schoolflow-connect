/**
 * Recovery plan bags → tier map.
 *
 * 710/770 put private originals in from_upload / from_capture on tier 0.
 * If the flatten only read from_bank, Practice would never load those ids and
 * submit scoring (800) would have nothing to join — a silent empty ladder.
 */
import { describe, expect, it } from "vitest";
import { flattenRecoveryPlanTiers } from "./recoveryEngineService";

describe("flattenRecoveryPlanTiers", () => {
  it("merges from_bank, from_upload and from_capture into tier 0", () => {
    const map = flattenRecoveryPlanTiers({
      tiers: {
        "0": {
          from_bank: ["bank-1"],
          from_upload: ["up-1"],
          from_capture: ["cap-1"],
        },
        "1": { from_bank: ["var-1"] },
      },
    });
    expect(map).toEqual({
      "bank-1": 0,
      "up-1": 0,
      "cap-1": 0,
      "var-1": 1,
    });
  });

  it("keeps ladder order: bank, then upload, then capture, then higher tiers", () => {
    const keys = Object.keys(
      flattenRecoveryPlanTiers({
        tiers: {
          "0": {
            from_bank: ["b"],
            from_upload: ["u"],
            from_capture: ["c"],
          },
          "2": { from_bank: ["t2"] },
        },
      }),
    );
    expect(keys).toEqual(["b", "u", "c", "t2"]);
  });

  it("ignores non-array bags and non-string ids", () => {
    const map = flattenRecoveryPlanTiers({
      tiers: {
        "0": {
          from_bank: "not-an-array",
          from_upload: [null, "", 12, "ok-up"],
          from_capture: undefined,
        },
      },
    });
    expect(map).toEqual({ "ok-up": 0 });
  });

  it("returns an empty map when the plan has no tiers", () => {
    expect(flattenRecoveryPlanTiers(null)).toEqual({});
    expect(flattenRecoveryPlanTiers({})).toEqual({});
  });
});
