/**
 * The sign-in page's mobile-number field. India-only, as the product is (MSG91,
 * +91): a mobile number is ten digits starting 6–9. What a student types or
 * pastes — "+91 98765 43210", "098765 43210", "91-98765-43210" — reduces to
 * those ten digits, or is refused.
 *
 * Input checking only. The server never takes the number from the page:
 * verify-msg91-widget reads the verified number from MSG91.
 */
export function parseIndianMobile(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** "+91 98765 43210", to show a number back to the student. */
export function displayIndianMobile(mobile: string): string {
  return `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`;
}
