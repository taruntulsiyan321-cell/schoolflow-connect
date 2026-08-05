import { useEffect, useState } from "react";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { DecisionEngineService, type WeakAreaRecommendation } from "@/academic/services/decisionEngineService";

/**
 * INTERNAL DEBUG TOOL — Decision Engine Slice 1.
 *
 * Not linked from any navigation, not a product feature. Exists so a human
 * can inspect raw rpc_weak_areas_v2 output during development without
 * reading network tab JSON by hand. Renders the Recommendation objects
 * exactly as the policy returns them — no interpretation, no styling
 * decisions beyond making the numbers legible. Delete or promote to a real
 * feature once Weak Areas is migrated to this engine; do not let this
 * quietly become the real UI.
 */
export default function WeakAreasV2Debug() {
  const { ctx, ready } = useAcademicContext();
  const [rows, setRows] = useState<WeakAreaRecommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready || !ctx) return;
    setLoading(true);
    setError(null);
    DecisionEngineService.getWeakAreasV2(ctx)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [ctx, ready]);

  return (
    <div style={{ padding: 24, fontFamily: "monospace", color: "#eee", background: "#111", minHeight: "100vh" }}>
      <div style={{ border: "2px solid #c00", padding: 12, marginBottom: 20, background: "#2a0000" }}>
        <strong>⚠ INTERNAL DEBUG TOOL — DECISION ENGINE SLICE 1</strong>
        <div>Not a product feature. rpc_weak_areas_v2, raw, unstyled.</div>
      </div>

      {!ready && <div>Loading academic context…</div>}
      {loading && <div>Calling rpc_weak_areas_v2…</div>}
      {error && <div style={{ color: "#f66" }}>Error: {error}</div>}

      {rows && (
        <>
          <div style={{ marginBottom: 12 }}>{rows.length} recommendation(s)</div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {["subject", "chapter", "concept", "subconcept", "understanding", "evidence_strength", "consistency", "growth_trend", "priority"].map((h) => (
                  <th key={h} style={{ border: "1px solid #444", padding: 6, textAlign: "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ border: "1px solid #444", padding: 6 }}>{r.subject}</td>
                  <td style={{ border: "1px solid #444", padding: 6 }}>{r.chapter ?? "—"}</td>
                  <td style={{ border: "1px solid #444", padding: 6 }}>{r.concept}</td>
                  <td style={{ border: "1px solid #444", padding: 6 }}>{r.subconcept ?? "—"}</td>
                  <td style={{ border: "1px solid #444", padding: 6 }}>{r.understanding ?? "—"}</td>
                  <td style={{ border: "1px solid #444", padding: 6 }}>{r.evidenceStrength ?? "—"}</td>
                  <td style={{ border: "1px solid #444", padding: 6 }}>{r.consistency ?? "—"}</td>
                  <td style={{ border: "1px solid #444", padding: 6 }}>{r.growthTrend ?? "—"}</td>
                  <td style={{ border: "1px solid #444", padding: 6 }}>{r.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details style={{ marginTop: 20 }}>
            <summary>Raw JSON</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(rows, null, 2)}</pre>
          </details>
        </>
      )}
    </div>
  );
}
