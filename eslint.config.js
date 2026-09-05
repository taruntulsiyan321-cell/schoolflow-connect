import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // `supabase/functions/` is Deno, not the browser bundle: different runtime,
  // different globals, and `globals.browser` below is wrong for all of it.
  // Linting it was never intentional — it only started when the verbatim
  // production snapshot landed on claude/edge-function-provenance, taking the
  // baseline from 143 to 151. Two of those files are production source
  // recovered from a running deployment (rule 26); reformatting them to
  // satisfy a browser lint config would destroy the only reason they exist.
  { ignores: ["dist", "supabase/functions/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
