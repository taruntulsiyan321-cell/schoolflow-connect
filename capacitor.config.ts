import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The app ships its OWN build. `npm run build` is the website's: it makes
 * dist/index.html the marketing page and moves the student app to app.html,
 * which only Vercel's rewrite reaches. Capacitor opens index.html with no
 * rewrite, so pointed at dist every screen of the app was the landing page.
 * `npm run build:app` writes dist-app, where index.html is the student app.
 *
 * The app is served as https://app.gurukul.study, not Capacitor's default
 * https://localhost: sign-in's captcha (hCaptcha, inside MSG91's widget)
 * refuses localhost — "localhost detected. Please use a valid host" — and the
 * OTP request then fails with "network-error", so nobody could sign in to the
 * app (measured on the emulator 2026-10-02; this hostname succeeds). The name
 * never reaches DNS: the web view answers it from the bundled files. Edge
 * functions allow any origin.
 *
 * capacitorEntry.test.ts fails if either is undone.
 */
const config: CapacitorConfig = {
  appId: 'study.gurukul.app',
  appName: 'Gurukul',
  webDir: 'dist-app',
  server: {
    hostname: 'app.gurukul.study',
    androidScheme: 'https',
  },
};

export default config;
