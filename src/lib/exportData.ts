/** CSV download (Excel-compatible with UTF-8 BOM). */
export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => escape(r[c])).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(filename.endsWith(".csv") ? filename : `${filename}.csv`, blob);
}

/** Same data as CSV with .xls extension — opens cleanly in Excel without extra deps. */
export function downloadExcel(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [cols.join("\t"), ...rows.map((r) => cols.map((c) => escape(r[c])).join("\t"))].join("\n");
  const blob = new Blob(["\uFEFF" + body], { type: "application/vnd.ms-excel;charset=utf-8" });
  const name = filename.replace(/\.(csv|xlsx?)$/i, "") + ".xls";
  triggerDownload(name, blob);
}

function triggerDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
