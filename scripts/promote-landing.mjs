/**
 * After Vite build: make the Gurukul marketing page the real `/` document
 * (so Google/crawlers see it), and keep the SPA at `/app.html`.
 *
 * The landing page reads its plans and prices from the database; the
 * project's URL and publishable key are written into it here
 * (scripts/landing-config.mjs).
 */
import { readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "vite";
import { injectLandingConfig } from "./landing-config.mjs";

const dist = join(process.cwd(), "dist");
const spa = join(dist, "index.html");
const app = join(dist, "app.html");
const landing = join(dist, "landing.html");

if (!existsSync(spa)) {
  console.error("promote-landing: dist/index.html missing");
  process.exit(1);
}
if (!existsSync(landing)) {
  console.error("promote-landing: dist/landing.html missing — put it in public/");
  process.exit(1);
}

const env = loadEnv("production", process.cwd(), "VITE_");
const { html, injected } = injectLandingConfig(readFileSync(landing, "utf8"), {
  url: env.VITE_SUPABASE_URL,
  key: env.VITE_SUPABASE_PUBLISHABLE_KEY,
});

renameSync(spa, app);
writeFileSync(landing, html);
writeFileSync(spa, html);
console.log("promote-landing: / → landing.html, SPA → /app.html");
console.log(
  injected
    ? "promote-landing: the pricing section reads the live plans"
    : "promote-landing: WARNING — no usable VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY; the pricing section will name no price",
);
