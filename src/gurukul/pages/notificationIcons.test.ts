import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The notification icon map was keyed on names nothing writes.
 *
 * `notifications.icon` holds LUCIDE names in kebab-case; `notifications.type`
 * holds DOMAIN names. The old map held a mixture of both in one object, and the
 * lookup tried the icon column against it first — so of 2,866 live rows it
 * resolved 35, and every other notification in the list drew the same generic
 * sparkle. Two maps and a dotted-type fallback replaced it.
 *
 * This test reads the source rather than importing the component, because the
 * component pulls in the router and the notifications hook, and the thing worth
 * protecting is the KEYS — that they still match what the database stores.
 *
 * VALUES MEASURED FROM THE LIVE TABLE, 2026-09-12:
 *
 *   select type, icon, count(*) from notifications group by type, icon;
 *
 * If a writer starts emitting a new icon or type, add it here first — a name
 * this file does not list is a name the panel will draw a bell for.
 */

const SOURCE = readFileSync(
  join(process.cwd(), "src", "gurukul", "pages", "Notifications.tsx"),
  "utf8",
);

/** Every distinct `notifications.icon` in the live table. */
const STORED_ICONS = [
  "alert-triangle",
  "award",
  "bell",
  "book",
  "book-open",
  "calendar",
  "calendar-check",
  "check-circle",
  "clipboard-check",
  "inbox",
  "megaphone",
  "swords",
  "wallet",
];

/** Every distinct `notifications.type` in the live table. */
const STORED_TYPES = [
  "announcement",
  "attendance",
  "attendance.risk_alert",
  "badge",
  "exam",
  "fee",
  "general",
  "homework",
  "homework.risk_alert",
  "inquiry",
  "invite",
  "leave",
  "notice",
  "result",
];

function mapBody(name: string): string {
  const start = SOURCE.indexOf(`const ${name}`);
  expect(start, `${name} should exist`).toBeGreaterThan(-1);
  const open = SOURCE.indexOf("{", start);
  const close = SOURCE.indexOf("};", open);
  return SOURCE.slice(open, close);
}

describe("notification icons resolve for the values the database actually holds", () => {
  it("reads a real source file (control)", () => {
    // Without this a bad path makes every assertion below vacuous.
    expect(SOURCE.length).toBeGreaterThan(2000);
    expect(SOURCE).toContain("function iconFor");
  });

  it("every stored icon name has an entry", () => {
    const body = mapBody("ICON_BY_STORED_NAME");
    const missing = STORED_ICONS.filter(
      (name) => !body.includes(`"${name}"`) && !new RegExp(`\\b${name}:`).test(body),
    );
    expect(
      missing,
      `these icon names are written to the notifications table but the panel has no mapping, ` +
        `so they fall back to a generic bell:\n${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every stored type has an entry, dotted ones included", () => {
    const body = mapBody("ICON_BY_TYPE");
    const missing = STORED_TYPES.filter((type) => {
      // A dotted type is resolved by the risk-alert branch or by its prefix.
      const key = type.includes(".") ? type.split(".")[0] : type;
      return !new RegExp(`\\b${key}:`).test(body);
    });
    expect(missing, `unmapped notification types:\n${missing.join(", ")}`).toEqual([]);
  });

  it("and the dotted sub-event branch is still there", () => {
    // `homework.risk_alert` can never match an exact-key lookup. 30 live rows
    // depend on this branch.
    expect(SOURCE).toContain('type.endsWith(".risk_alert")');
    expect(SOURCE).toContain('type.split(".")[0]');
  });

  it("POSITIVE CONTROL: the same check fails on a name that is not mapped", () => {
    // A key-matching assertion that has never been shown to fail is not
    // evidence — this is the exact shape that let the old map pass review.
    const body = mapBody("ICON_BY_STORED_NAME");
    expect(body).not.toContain('"no-such-lucide-icon"');
    const wouldFail = ["no-such-lucide-icon"].filter((name) => !body.includes(`"${name}"`));
    expect(wouldFail).toEqual(["no-such-lucide-icon"]);
  });
});
