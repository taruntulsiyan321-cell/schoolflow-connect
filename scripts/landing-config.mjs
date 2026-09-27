/**
 * The landing page reads its plans from Supabase (#gurukul-plans in
 * public/landing.html). It is a static file Vite copies untouched, so the
 * project's URL and publishable key are written into the built copy here,
 * from the same VITE_ variables the app is built with.
 *
 * A value that is not a plain https URL or a plain key is not written: it
 * lands inside a JavaScript string, and the page then names no price rather
 * than run something it was not meant to.
 */
export const URL_TOKEN = "__GURUKUL_SUPABASE_URL__";
export const KEY_TOKEN = "__GURUKUL_SUPABASE_PUBLISHABLE_KEY__";

export function injectLandingConfig(html, { url, key }) {
  if (!html.includes(URL_TOKEN) || !html.includes(KEY_TOKEN)) {
    throw new Error("landing-config: public/landing.html no longer carries its Supabase placeholders");
  }
  const cleanUrl = typeof url === "string" ? url.trim().replace(/\/+$/, "") : "";
  const cleanKey = typeof key === "string" ? key.trim() : "";
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(cleanUrl) || !/^[A-Za-z0-9._-]+$/.test(cleanKey)) {
    return { html, injected: false };
  }
  return {
    html: html.split(URL_TOKEN).join(cleanUrl).split(KEY_TOKEN).join(cleanKey),
    injected: true,
  };
}
