import { describe, expect, it } from "vitest";
import { calendarDaysAgo, formatLastSeen } from "@/lib/analyticsInsights";

// Local times throughout, so each assertion holds on any clock.
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m);

describe("calendarDaysAgo", () => {
  it("counts calendar days, not 24-hour periods", () => {
    const now = at(28, 9);
    // 11 pm last night is ten hours ago — and it is yesterday, not today.
    expect(calendarDaysAgo(at(27, 23).toISOString(), now)).toBe(1);
    // The day before yesterday in the evening: 36 hours, two calendar days.
    expect(calendarDaysAgo(at(26, 21).toISOString(), now)).toBe(2);
    expect(calendarDaysAgo(at(28, 0, 5).toISOString(), now)).toBe(0);
  });

  it("is null for no date and for an unreadable one", () => {
    expect(calendarDaysAgo(null)).toBeNull();
    expect(calendarDaysAgo("not a date")).toBeNull();
  });
});

describe("formatLastSeen", () => {
  it("names last night Yesterday and two nights ago 2 days ago", () => {
    const now = at(28, 9);
    expect(formatLastSeen(at(27, 23).toISOString(), now)).toBe("Yesterday");
    expect(formatLastSeen(at(26, 21).toISOString(), now)).toBe("2 days ago");
    expect(formatLastSeen(at(28, 8).toISOString(), now)).toBe("Today");
  });
});
