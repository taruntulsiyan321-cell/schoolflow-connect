import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Android app must open the STUDENT APP, not the website's landing page.
 *
 * `npm run build` is the website's build: scripts/promote-landing.mjs makes
 * dist/index.html the marketing page and moves the student app to app.html,
 * which only vercel.json's rewrite reaches. Capacitor opens index.html with no
 * rewrite, so while capacitor.config.ts pointed at dist, every screen of the
 * Android app — sign-in, practice, screen capture — was the landing page
 * (seen on the emulator 2026-10-02). The app has its own build now.
 */
const root = process.cwd();
const capacitor = readFileSync(join(root, "capacitor.config.ts"), "utf8");
const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts as Record<string, string>;

const webDirOf = (src: string) => src.match(/webDir:\s*['"]([^'"]+)['"]/)?.[1] ?? null;
const hostnameOf = (src: string) => src.match(/hostname:\s*['"]([^'"]+)['"]/)?.[1] ?? "localhost";
const manifest = readFileSync(join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
/** The scripts that write a directory: an explicit --outDir, else vite's dist. */
const writersOf = (dir: string) =>
  Object.entries(scripts).filter(([, cmd]) => {
    if (!/\bvite build\b/.test(cmd)) return false;
    const out = cmd.match(/--outDir\s+(\S+)/)?.[1] ?? "dist";
    return out === dir;
  });

describe("the Android app ships the student app", () => {
  const webDir = webDirOf(capacitor);

  it("Capacitor reads a build of its own", () => {
    expect(webDir).not.toBeNull();
    expect(webDir).not.toBe("dist");
  });

  it("that build is written by a script, and nothing in it promotes the landing page", () => {
    const writers = writersOf(webDir!);
    expect(writers.map(([name]) => name)).toEqual(["build:app"]);
    for (const [, cmd] of writers) expect(cmd).not.toMatch(/promote-landing/);
  });

  it("the website's build still promotes the landing page (control)", () => {
    const site = writersOf("dist").find(([name]) => name === "build");
    expect(site?.[1]).toMatch(/promote-landing/);
  });

  it("the checks see the shape that broke the app (mutant)", () => {
    expect(webDirOf("webDir: 'dist',")).toBe("dist");
    expect(webDirOf('webDir: "dist-app"')).toBe("dist-app");
  });
});

/**
 * Sign-in inside the app. MSG91's widget runs hCaptcha, which refuses the
 * default origin https://localhost ("localhost detected. Please use a valid
 * host"); the OTP request then failed with "network-error" and nobody could
 * sign in to the app. Measured on the emulator 2026-10-02: app.gurukul.study
 * succeeds.
 */
describe("the Android app can sign in and record", () => {
  it("is served under a real host name, over https", () => {
    const host = hostnameOf(capacitor);
    expect(host).not.toMatch(/^localhost$|^127\./);
    expect(host).toMatch(/\.[a-z]{2,}$/);
    expect(capacitor).toMatch(/androidScheme:\s*['"]https['"]/);
  });

  it("the check sees the default it replaced (mutant)", () => {
    expect(hostnameOf("webDir: 'dist-app'")).toBe("localhost");
  });

  it("declares the microphone voice notes record with", () => {
    expect(manifest).toMatch(/android\.permission\.RECORD_AUDIO/);
    // Control: the permission screen capture runs on is found the same way.
    expect(manifest).toMatch(/android\.permission\.FOREGROUND_SERVICE_MEDIA_PROJECTION/);
  });
});
