/**
 * Principal portal shell — Autonomous Design Implementation.
 * Design-only: screens use fixture data from autonomous-design/data.ts.
 * Not wired to Academic Engine / Supabase.
 */
import PrincipalPortalDesign from "./autonomous-design/PrincipalPortalDesign";

export default function PrincipalApp() {
  return (
    <div className="gurukul-principal h-screen overflow-hidden">
      <PrincipalPortalDesign />
    </div>
  );
}
