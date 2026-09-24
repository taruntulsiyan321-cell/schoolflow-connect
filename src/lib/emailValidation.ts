// Email validation for signing in: is this shaped like an email address, and is it
// an obvious typo of a popular provider (`gmail.con`, `gmial.com`, `yahoo.coom`)?
//
// It does NOT decide whether an address may exist. Every caller (password sign-in,
// password reset, email OTP — src/pages/Auth.tsx) is about an account that already
// exists, and Supabase Auth is what knows that. This file used to hold a curated list
// of "widely-used" domain extensions and refused anything else, which refused real
// accounts before Supabase was asked: every Riverside Public School login
// (`…@rps.e2e.test`, the E2E organisation) could not sign in through the form, and neither
// could a school on any extension the list forgot. The typo check is kept — it
// catches the mistakes the list was written for, without locking anyone out.

const STRICT_EMAIL_RE =
  /^(?!.*\.\.)[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

// Common typos for popular providers — all should map to the canonical domain.
const PROVIDER_TYPOS: Record<string, string> = {
  // gmail
  "gmail.coom": "gmail.com", "gmail.con": "gmail.com", "gmail.cmo": "gmail.com",
  "gmail.cm": "gmail.com", "gmail.co": "gmail.com", "gmail.om": "gmail.com",
  "gmial.com": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
  "gmal.com": "gmail.com", "gmail.comm": "gmail.com", "gmali.com": "gmail.com",
  "gmail.in": "gmail.com",
  // yahoo
  "yahoo.coom": "yahoo.com", "yahoo.con": "yahoo.com", "yahoo.cm": "yahoo.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.co": "yahoo.com",
  // hotmail
  "hotmail.coom": "hotmail.com", "hotmail.con": "hotmail.com", "hotmial.com": "hotmail.com",
  "hotmal.com": "hotmail.com", "hotmail.cm": "hotmail.com",
  // outlook
  "outlook.coom": "outlook.com", "outlook.con": "outlook.com", "outlok.com": "outlook.com",
  // icloud
  "icloud.coom": "icloud.com", "icloud.con": "icloud.com", "iclould.com": "icloud.com",
  // rediff / proton
  "rediffmail.con": "rediffmail.com", "protonmail.con": "protonmail.com",
};

export type EmailValidation = {
  ok: boolean;
  email: string;
  message: string;
};

export function validateEmail(input: string): EmailValidation {
  const email = (input ?? "").trim().toLowerCase();
  if (!email) return { ok: false, email: "", message: "Please enter an email address" };
  if (email.length > 255) return { ok: false, email: "", message: "Email is too long" };
  if (!STRICT_EMAIL_RE.test(email)) {
    return { ok: false, email: "", message: "Please enter a valid email address" };
  }

  const domain = email.split("@")[1];
  if (PROVIDER_TYPOS[domain]) {
    const suggestion = email.replace(`@${domain}`, `@${PROVIDER_TYPOS[domain]}`);
    return { ok: false, email: "", message: `Did you mean ${suggestion}?` };
  }

  return { ok: true, email, message: "" };
}
