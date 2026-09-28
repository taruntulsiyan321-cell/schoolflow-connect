import { useEffect, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { formatSessionDuration } from "@/lib/practiceSessionStats";

/**
 * What "Print or save as PDF" prints: the page's figures from every tab, on
 * paper, and nothing else.
 *
 * The buttons called window.print() on the screen as it stood, and the app
 * has no print styles — so the sidebar, the bottom bar and whichever tab was
 * open went to the printer, and since the buttons live on Milestones, that
 * was the tab. This is rendered into <body> itself while printing, and
 * index.css shows it alone on the page (`.analysis-print-report`).
 *
 * It takes figures the page has already worked out; it computes none.
 */
export type AnalysisPrintReportProps = {
  studentName: string;
  summary: { label: string; value: string | number | null }[];
  totals: { label: string; value: string }[];
  subjects: { name: string; accuracy: number | null; attempts: number; measuredMs: number | null }[];
  topics: { topic: string; chapter: string | null; subject: string; score: number | null; attempts: number }[];
  months: { label: string; thisM: number | null; lastM: number | null; unit: string }[];
};

const show = (v: number | null, unit: string) =>
  v == null ? "—" : unit === "time" ? formatSessionDuration(v) : `${v}${unit}`;

/**
 * True only while the browser is printing. The report is mounted for that
 * moment and no other: kept in the page it was a second copy of every figure
 * for a screen reader to read out, and a second match for every query of the
 * page's text. flushSync puts it in the document before print layout runs —
 * beforeprint is the last event before the browser takes its snapshot, and
 * it fires for the button and for Ctrl+P alike.
 */
function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const on = () => flushSync(() => setPrinting(true));
    const off = () => setPrinting(false);
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
    };
  }, []);
  return printing;
}

export function AnalysisPrintReport(p: AnalysisPrintReportProps) {
  const printing = usePrinting();
  if (!printing || typeof document === "undefined") return null;
  return createPortal(
    <div className="analysis-print-report" aria-hidden="true">
      <h1>Practice analysis{p.studentName ? ` — ${p.studentName}` : ""}</h1>
      <p className="apr-muted">
        Printed {new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
      </p>

      <h2>Summary</h2>
      <table>
        <tbody>
          {[...p.summary.map((r) => ({ label: r.label, value: r.value == null ? "not recorded yet" : String(r.value) })), ...p.totals].map((r) => (
            <tr key={r.label}><th>{r.label}</th><td>{r.value}</td></tr>
          ))}
        </tbody>
      </table>

      <h2>Subjects</h2>
      {p.subjects.length === 0 ? <p className="apr-muted">No subjects practised yet.</p> : (
        <table>
          <thead><tr><th>Subject</th><th>Accuracy</th><th>Attempts</th><th>Study time</th></tr></thead>
          <tbody>
            {p.subjects.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td>{s.accuracy == null ? "not enough yet" : `${s.accuracy}%`}</td>
                <td>{s.attempts}</td>
                <td>{formatSessionDuration(s.measuredMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Topics that need attention</h2>
      {p.topics.length === 0 ? <p className="apr-muted">Nothing flagged yet.</p> : (
        <table>
          <thead><tr><th>Topic</th><th>Chapter</th><th>Subject</th><th>Accuracy</th><th>Attempts</th></tr></thead>
          <tbody>
            {p.topics.map((t) => (
              <tr key={`${t.subject}|${t.chapter ?? ""}|${t.topic}`}>
                <td>{t.topic}</td><td>{t.chapter ?? "—"}</td><td>{t.subject}</td>
                <td>{t.score == null ? "—" : `${t.score}%`}</td><td>{t.attempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>This month against last month</h2>
      <table>
        <thead><tr><th /><th>This month</th><th>Last month</th></tr></thead>
        <tbody>
          {p.months.map((m) => (
            <tr key={m.label}><th>{m.label}</th><td>{show(m.thisM, m.unit)}</td><td>{show(m.lastM, m.unit)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}
