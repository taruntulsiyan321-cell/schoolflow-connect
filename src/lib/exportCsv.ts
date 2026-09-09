/**
 * CSV download — one implementation, for every portal.
 *
 * This lived in `src/gurukul-admin/shared.tsx` and was reachable only from the
 * admin portal. The teacher's test report and the student's own report are both
 * required to be downloadable (§10.25), and neither is an admin screen, so the
 * choice was a second copy or one home. `gurukul-admin/shared` re-exports this
 * one, so every existing import site is unchanged.
 *
 * Values go through `toDisplayText` rather than `String(...)`: a report row
 * carries jsonb straight from the database, and `String({})` writes
 * "[object Object]" into a file a teacher opens in Excel — the same rendering
 * defect the presentation boundary exists to stop, one layer out from the DOM.
 */
import { toast } from "sonner";
import { toDisplayText } from "@/lib/presentation";

export function exportCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) {
    toast.error("Nothing to export — this report has no rows.");
    return;
  }
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      headers
        .map((h) => JSON.stringify(toDisplayText(r[h], { allowEmpty: true, fallback: "" })))
        .join(","),
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
