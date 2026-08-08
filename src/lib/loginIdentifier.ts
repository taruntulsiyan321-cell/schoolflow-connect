import { normalizePhone } from "@/lib/phone";

/** Parse admin-entered email or mobile for portal login reservation. */
export function parseLoginIdentifier(raw: string): { kind: "email" | "phone"; value: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return { kind: "email", value: email };
  }
  const phone = normalizePhone(trimmed);
  if (!phone) return null;
  return { kind: "phone", value: phone };
}

export function portalFieldsFromIdentifier(raw: string) {
  const parsed = parseLoginIdentifier(raw);
  if (!parsed) return {};
  if (parsed.kind === "email") {
    return { portal_email: parsed.value, portal_phone: null as string | null };
  }
  return { portal_email: null as string | null, portal_phone: parsed.value };
}
