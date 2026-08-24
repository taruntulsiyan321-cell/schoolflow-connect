/**
 * Second fix batch — the findings surfaced by scripts/lint-render-safety.mjs
 * that manual inspection had missed. Each entry is an exact verified string.
 */
const fs = require("fs");

function ensureImport(file, symbols) {
  const raw = fs.readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  let s = raw;
  const m = s.match(/import \{([^}]*)\} from "@\/lib\/presentation";/);
  if (m) {
    const have = m[1].split(",").map((x) => x.trim()).filter(Boolean);
    let added = false;
    for (const sym of symbols) if (!have.includes(sym)) { have.push(sym); added = true; }
    if (!added) return;
    s = s.replace(m[0], "import { " + have.sort().join(", ") + ' } from "@/lib/presentation";');
  } else {
    const lines = s.split(/\r?\n/);
    let last = 0;
    for (let i = 0; i < Math.min(lines.length, 80); i++) if (/^import /.test(lines[i])) last = i;
    lines.splice(last + 1, 0, "import { " + symbols.join(", ") + ' } from "@/lib/presentation";');
    s = lines.join(eol);
  }
  fs.writeFileSync(file, s);
}

const edits = [
  // --- raw error into a toast --------------------------------------------
  {
    file: "src/gurukul-parent/ParentApp.tsx",
    from: 'toast.error(e instanceof Error ? e.message : "Could not load unread messages")',
    to: 'toast.error(toErrorMessage(e, "Could not load unread messages"))',
    imports: ["toErrorMessage"],
  },

  // --- app_role rendered via ad-hoc humanization --------------------------
  {
    file: "src/components/chat/NewChatSheet.tsx",
    from: '{c.role.replace(/_/g, " ")}',
    to: '{toEnumLabel(c.role, "app_role")}',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/pages/shared/ChatPage.tsx",
    from: '{role.replace(/_/g, " ")}',
    to: '{toEnumLabel(role, "app_role")}',
    imports: ["toEnumLabel"],
  },

  // --- raw enum renders ---------------------------------------------------
  {
    file: "src/components/student/analytics/AnalysisDeepSections.tsx",
    from: "              {item.priority}",
    to: '              {toEnumLabel(item.priority, "severity")}',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/pages/shared/LeaveRequestsPage.tsx",
    from: "<Badge variant=\"outline\" className={STATUS_TONE[l.status]}>{l.status}</Badge>",
    to: '<Badge variant="outline" className={STATUS_TONE[l.status]}>{toEnumLabel(l.status, "leave_status")}</Badge>',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/pages/shared/NoticesPage.tsx",
    from:
      '<span className={`px-2.5 py-1 rounded-full border font-semibold capitalize ${audienceTone(r.audience)}`}>{r.audience}</span>',
    to:
      '<span className={`px-2.5 py-1 rounded-full border font-semibold ${audienceTone(r.audience)}`}>' +
      '{toEnumLabel(r.audience, "notice_audience")}</span>',
    imports: ["toEnumLabel"],
  },
  {
    file: "src/pages/student/RevisionQueue.tsx",
    from: '{r.priority_label ?? "Medium"} · {r.priority}',
    to: '{r.priority_label ?? "Medium"} · {toEnumLabel(r.priority, "severity")}',
    imports: ["toEnumLabel"],
  },

  // --- leave type -----------------------------------------------------------
  {
    file: "src/gurukul-teacher/Leave.tsx",
    from: '<div className="text-xs font-bold text-white capitalize">{r.leaveType} Leave</div>',
    to: '<div className="text-xs font-bold text-white">{toEnumLabel(r.leaveType, "leave_type")}</div>',
    imports: ["toEnumLabel"],
  },

  // --- String() coercion in text-bearing positions --------------------------
  {
    file: "src/components/student/practice/PracticeHubPage.tsx",
    from: '<Stat label="Correct" value={String(s.correct)} />',
    to: '<Stat label="Correct" value={toDisplayText(s.correct)} />',
    imports: ["toDisplayText"],
  },
  {
    file: "src/components/student/practice/PracticeHubPage.tsx",
    from: '<Stat label="Incorrect" value={String(s.incorrect)} warn />',
    to: '<Stat label="Incorrect" value={toDisplayText(s.incorrect)} warn />',
    imports: ["toDisplayText"],
  },
  {
    file: "src/components/student/recovery/RecoveryHubPage.tsx",
    from: '<MiniStat label="Questions" value={String(p.questionsAssigned)} />',
    to: '<MiniStat label="Questions" value={toDisplayText(p.questionsAssigned)} />',
    imports: ["toDisplayText"],
  },
  {
    file: "src/pages/student/AcademicReport.tsx",
    from: '{String(row.date).slice(5)}',
    to: '{toDisplayText(row.date, { fallback: "" }).slice(5)}',
    imports: ["toDisplayText"],
  },
  {
    file: "src/pages/student/DppResult.tsx",
    from: 'title={String(dpp.title ?? "Test")}',
    to: 'title={toDisplayText(dpp.title, { kind: "label", fallback: "Test" })}',
    imports: ["toDisplayText"],
  },
  {
    file: "src/pages/shared/StudentClassesPage.tsx",
    from:
      '<span className={cn("text-xs px-2.5 py-1 rounded-full capitalize font-medium", ' +
      'ATTENDANCE_COLORS[row.status] ?? "bg-muted text-muted-foreground")}>',
    to:
      '<span className={cn("text-xs px-2.5 py-1 rounded-full font-medium", ' +
      'ATTENDANCE_COLORS[row.status] ?? "bg-muted text-muted-foreground")}>',
    imports: [],
  },
  {
    file: "src/pages/shared/StudentClassesPage.tsx",
    from: "                  {row.status}",
    to: '                  {toEnumLabel(row.status, "attendance_status")}',
    imports: ["toEnumLabel"],
  },
];

let ok = 0;
for (const e of edits) {
  let s = fs.readFileSync(e.file, "utf8");
  const found = s.split(e.from).length - 1;
  if (found !== 1) {
    console.error("SKIP (found " + found + "): " + e.file + " :: " + e.from.slice(0, 70));
    process.exitCode = 1;
    continue;
  }
  fs.writeFileSync(e.file, s.split(e.from).join(e.to));
  if (e.imports.length) ensureImport(e.file, e.imports);
  ok++;
}
console.log("batch 2: " + ok + "/" + edits.length + " applied");

// SchoolEngagement needs its own look — the line is long and truncated above.
const se = "src/pages/principal/SchoolEngagement.tsx";
let seSrc = fs.readFileSync(se, "utf8");
const seMatches = seSrc.match(/value=\{String\(concepts\.[\w.?]+[^)]*\)\}/g) ?? [];
if (seMatches.length) {
  for (const m of seMatches) {
    const inner = m.slice("value={String(".length, -2);
    seSrc = seSrc.split(m).join("value={toDisplayText(" + inner + ")}");
  }
  fs.writeFileSync(se, seSrc);
  ensureImport(se, ["toDisplayText"]);
  console.log("SchoolEngagement: " + seMatches.length + " coercion(s) fixed");
} else {
  console.error("SchoolEngagement: no match");
  process.exitCode = 1;
}
