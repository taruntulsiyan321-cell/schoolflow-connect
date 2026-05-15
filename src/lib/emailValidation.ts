// Strict email validation with common-typo detection.
// Catches things like `gmail.coom`, `gmial.com`, `yahoo.con`, etc.

const STRICT_EMAIL_RE =
  /^(?!.*\.\.)[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

// Curated list of widely-used TLDs. If a domain ends in something not on this
// list (e.g. `.coom`, `.cmo`, `.con`), we reject it.
const ALLOWED_TLDS = new Set([
  "com", "org", "net", "edu", "gov", "mil", "int",
  "co", "io", "ai", "app", "dev", "tech", "info", "biz", "me", "us",
  "in", "uk", "ca", "au", "nz", "de", "fr", "es", "it", "nl", "se", "no", "fi", "dk",
  "ch", "be", "at", "pl", "pt", "ie", "gr", "cz", "ro", "ru", "ua",
  "jp", "cn", "kr", "hk", "tw", "sg", "my", "th", "id", "ph", "vn", "pk", "bd", "lk", "np", "ae", "sa",
  "br", "mx", "ar", "cl", "co", "pe", "za", "ng", "eg", "ke",
  "edu.in", "ac.in", "co.in", "gov.in", "co.uk", "ac.uk", "gov.uk",
  "school", "academy", "agency", "studio", "online", "site", "store", "shop", "blog", "news", "live", "xyz",
]);

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

export type EmailValidation =
  | { ok: true; email: string }
  | { ok: false; message: string };

export function validateEmail(input: string): EmailValidation {
  const email = (input ?? "").trim().toLowerCase();
  if (!email) return { ok: false, message: "Please enter an email address" };
  if (email.length > 255) return { ok: false, message: "Email is too long" };
  if (!STRICT_EMAIL_RE.test(email)) {
    return { ok: false, message: "Please enter a valid email address" };
  }

  const domain = email.split("@")[1];
  if (!domain) return { ok: false, message: "Please enter a valid email address" };

  // Catch common typos for popular providers with a friendly suggestion
  if (PROVIDER_TYPOS[domain]) {
    const suggestion = email.replace(`@${domain}`, `@${PROVIDER_TYPOS[domain]}`);
    return { ok: false, message: `Did you mean ${suggestion}?` };
  }

  // Verify the TLD is real (or a recognized two-level TLD like co.in / ac.uk)
  const parts = domain.split(".");
  const lastTwo = parts.slice(-2).join(".");
  const last = parts[parts.length - 1];
  if (!ALLOWED_TLDS.has(lastTwo) && !ALLOWED_TLDS.has(last)) {
    return {
      ok: false,
      message: `"${"." + last}" is not a recognized domain extension. Check for typos.`,
    };
  }

  return { ok: true, email };
}
