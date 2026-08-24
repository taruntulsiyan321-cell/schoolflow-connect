/**
 * One-shot codemod: route raw database enum values through `toEnumLabel`.
 *
 * Each entry is an exact, verified occurrence found by audit — not a pattern
 * match — so nothing is rewritten speculatively. Where a cosmetic
 * `capitalize` class was masking the token (`half_day` -> `Half_day`), the
 * class is removed too: the label map now does the job properly.
 */
const fs = require("fs");

const edits = [
  // --- attendance_status ---------------------------------------------------
  {
    file: "src/gurukul/pages/Attendance.tsx",
    from: "title={`${day.date}: ${day.status}`}",
    to: 'title={`${day.date}: ${toEnumLabel(day.status, "attendance_status")}`}',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul-parent/ParentLiveAttendance.tsx",
    from: "title={`${day.date}: ${day.status}`}",
    to: 'title={`${day.date}: ${toEnumLabel(day.status, "attendance_status")}`}',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul-teacher/LiveClassPanels.tsx",
    from: "                        {a.status}\n",
    to: '                        {toEnumLabel(a.status, "attendance_status")}\n',
    imports: ["toEnumLabel"],
  },

  // --- homework status / priority ------------------------------------------
  {
    file: "src/gurukul-admin/Homework.tsx",
    from: '<td className="p-3 capitalize">{h.status}</td>',
    to: '<td className="p-3">{toEnumLabel(h.status, "homework_status")}</td>',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul-admin/Homework.tsx",
    from: '<td className="p-3 capitalize">{h.priority}</td>',
    to: '<td className="p-3">{toEnumLabel(h.priority, "homework_priority")}</td>',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul-teacher/LiveHomeworkPanels.tsx",
    from: '{h.subject} · Due {h.dueDate ?? "—"} · {h.status ?? "draft"} · {h.priority}',
    to:
      '{h.subject} · Due {h.dueDate ?? "—"} · {toEnumLabel(h.status ?? "draft", "homework_status")}' +
      ' · {toEnumLabel(h.priority, "homework_priority")}',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul-teacher/LiveHomeworkPanels.tsx",
    from: "{s.status}{s.isLate ? \" · late\" : \"\"} · v{s.version}",
    to: '{toEnumLabel(s.status, "submission_status")}{s.isLate ? " · late" : ""} · v{s.version}',
    imports: ["toEnumLabel"],
  },

  // --- leave ---------------------------------------------------------------
  {
    file: "src/gurukul-teacher/Leave.tsx",
    from:
      '                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize"\n' +
      "                    style={{ background: `${statusColor[r.status]}18`, color: statusColor[r.status] }}\n" +
      "                  >\n" +
      "                    {r.status}\n",
    to:
      '                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"\n' +
      "                    style={{ background: `${statusColor[r.status]}18`, color: statusColor[r.status] }}\n" +
      "                  >\n" +
      '                    {toEnumLabel(r.status, "leave_status")}\n',
    imports: ["toEnumLabel"],
  },

  // --- announcements -------------------------------------------------------
  {
    file: "src/gurukul-admin/Announcements.tsx",
    from:
      '                        className="text-[9px] font-bold px-2 py-0.5 rounded-full capitalize"\n' +
      "                        style={{ background: `${statusColor}18`, color: statusColor }}\n" +
      "                      >\n" +
      "                        {ann.status}\n",
    to:
      '                        className="text-[9px] font-bold px-2 py-0.5 rounded-full"\n' +
      "                        style={{ background: `${statusColor}18`, color: statusColor }}\n" +
      "                      >\n" +
      '                        {toEnumLabel(ann.status, "announcement_status")}\n',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul-admin/Announcements.tsx",
    from: "                        {ann.audience}\n",
    to: '                        {toEnumLabel(ann.audience, "notice_audience")}\n',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul-principal/PrincipalApp.tsx",
    from: "<Chip color={statusColor}>{ann.status}</Chip>",
    to: '<Chip color={statusColor}>{toEnumLabel(ann.status, "announcement_status")}</Chip>',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul-teacher/Announcements.tsx",
    from:
      '<span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize" ' +
      "style={{ background: `${statusColor[a.status]}18`, color: statusColor[a.status] }}>{a.status}</span>",
    to:
      '<span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" ' +
      "style={{ background: `${statusColor[a.status]}18`, color: statusColor[a.status] }}>" +
      '{toEnumLabel(a.status, "announcement_status")}</span>',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul-teacher/Announcements.tsx",
    from:
      '<span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize" ' +
      "style={{ background: `${priorityColor[a.priority]}18`, color: priorityColor[a.priority] }}>{a.priority}</span>",
    to:
      '<span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" ' +
      "style={{ background: `${priorityColor[a.priority]}18`, color: priorityColor[a.priority] }}>" +
      '{toEnumLabel(a.priority, "announcement_priority")}</span>',
    imports: ["toEnumLabel"],
  },

  // --- misc ----------------------------------------------------------------
  {
    file: "src/gurukul/pages/Resources.tsx",
    from: "{r.type} · {formatDate(r.publishedAt)}",
    to: '{toEnumLabel(r.type, "resource_type")} · {formatDate(r.publishedAt)}',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul/pages/Dashboard.tsx",
    from:
      '<div className="flex items-center gap-1 text-amber-400 capitalize">' +
      '<span className="text-xs font-bold">{a.tier}</span></div>',
    to:
      '<div className="flex items-center gap-1 text-amber-400">' +
      '<span className="text-xs font-bold">{toEnumLabel(a.tier, "badge_tier")}</span></div>',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul-principal/PrincipalLiveAcademic.tsx",
    from:
      '<td style={{ padding: "12px 16px", fontSize: 11, textTransform: "capitalize", ' +
      'color: "var(--text-muted)" }}>{t.status}</td>',
    to:
      '<td style={{ padding: "12px 16px", fontSize: 11, color: "var(--text-muted)" }}>' +
      '{toEnumLabel(t.status, "severity")}</td>',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul-admin/AiAnalytics.tsx",
    from: '<Stat label="Status" value={forecast.status} />',
    to: '<Stat label="Status" value={toEnumLabel(forecast.status, "budget_forecast_status")} />',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/gurukul-parent/Notifications.tsx",
    from: "{typeConfig[t]?.label ?? t}",
    to: "{typeConfig[t]?.label ?? humanizeEnumValue(t)}",
    imports: ["humanizeEnumValue"],
  },
];

let ok = 0;
for (const e of edits) {
  let s = fs.readFileSync(e.file, "utf8");
  const found = s.split(e.from).length - 1;
  if (found !== 1) {
    console.error("SKIP (found " + found + ", expected 1): " + e.file + " :: " + e.from.slice(0, 70));
    process.exitCode = 1;
    continue;
  }
  s = s.split(e.from).join(e.to);

  const m = s.match(/import \{([^}]*)\} from "@\/lib\/presentation";/);
  if (m) {
    const have = m[1].split(",").map((x) => x.trim()).filter(Boolean);
    for (const sym of e.imports) if (!have.includes(sym)) have.push(sym);
    s = s.replace(m[0], "import { " + have.sort().join(", ") + ' } from "@/lib/presentation";');
  } else {
    const line = "import { " + e.imports.join(", ") + ' } from "@/lib/presentation";';
    const lines = s.split("\n");
    let last = 0;
    for (let i = 0; i < Math.min(lines.length, 80); i++) if (/^import /.test(lines[i])) last = i;
    lines.splice(last + 1, 0, line);
    s = lines.join("\n");
  }
  fs.writeFileSync(e.file, s);
  ok++;
}
console.log("enum sites rewritten: " + ok + "/" + edits.length);
