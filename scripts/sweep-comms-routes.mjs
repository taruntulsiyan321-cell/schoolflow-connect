/**
 * CHUNK 8 measurement, point 2 — every communication route followed to the
 * element it renders.
 *
 *   node scripts/sweep-comms-routes.mjs
 *
 * "A route existing is not a feature existing." So this does not read the route
 * table and stop. For every communication/requests/notifications route in the
 * five panel routers it resolves the element to a component, resolves the
 * component to a file, and then asks that file what it actually does:
 *
 *   REDIRECT  the element is <Navigate>. Nothing renders.
 *   REAL      the file reads at least one table or RPC in this domain.
 *   STUB      the file renders, and reads nothing — a screen with no source.
 *   PROXY     the file renders another component and reads nothing itself;
 *             the verdict belongs to what it delegates to, which is named.
 *
 * The classification is deliberately mechanical and its inputs are printed, so
 * a wrong verdict is visible as a wrong count rather than as a wrong word.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const PANELS = [
  ["Student", "src/pages/StudentDashboard.tsx"],
  ["Teacher", "src/gurukul-teacher/TeacherApp.tsx"],
  ["Principal", "src/gurukul-principal/PrincipalApp.tsx"],
  ["Admin", "src/gurukul-admin/AdminApp.tsx"],
  ["Parent", "src/gurukul-parent/ParentApp.tsx"],
];

/** Routes in scope: communication, requests, notifications. */
const IN_SCOPE =
  /^(chat|messages?|communication|connect|notices?|notifications?|announcements?|leave|leaves|leave-requests|doubts|cases|complaints|inquiries)(\/.*)?$/;

/** Tables and RPCs that belong to this domain. */
const DOMAIN = [
  "messages", "chat_conversations", "chat_participants", "message_read_receipts",
  "message_attachments", "notices", "notifications", "school_complaints",
  "school_inquiries", "leave_requests", "leave_decisions", "device_tokens",
  "parent_academic_alerts", "community_doubts", "community_doubt_answers",
  "community_doubt_votes", "academic_events",
];
const DOMAIN_RPC =
  /rpc_(send_chat_message|ensure_dm|ensure_class_group|ensure_teacher_group|create_class_group|create_teacher_group|mark_conversation_read|mark_group_messages_read|mark_messages_read|delete_chat_message|send_direct_message|send_group_message|teacher_doubt_dashboard|create_community_doubt|add_community_answer|vote_community_answer|record_community_doubt_view|mark_best_community_answer|parent_weekly_digest)/;

const SERVICES = /(MessageService|LeaveService|AnnouncementService|DoubtService|NotificationService|CalendarEventsService)/g;

/** Service -> file, so a screen reading through the engine still reports tables. */
const SERVICE_FILE = {
  MessageService: "src/academic/services/messageService.ts",
  LeaveService: "src/academic/services/leaveService.ts",
  AnnouncementService: "src/academic/services/announcementService.ts",
  DoubtService: "src/academic/services/doubtService.ts",
  CalendarEventsService: "src/academic/services/calendarEventsService.ts",
};

function serviceTables(names) {
  const out = new Set();
  for (const n of names) {
    const f = SERVICE_FILE[n];
    if (!f || !existsSync(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const t of DOMAIN) if (src.includes(`from("${t}")`)) out.add(t);
  }
  return [...out];
}

/**
 * Hooks that reach this domain. A screen calling one of these IS reading the
 * table — the first run of this sweep called both notification screens STUB
 * because it looked for `.from(` and `Service.` and never for a hook, and both
 * of them get every row through `useNotifications()`.
 */
const HOOK_FILE = {
  useNotifications: "src/hooks/useNotifications.ts",
  useLeaveRequests: "src/hooks/useLeaveRequests.ts",
};
const HOOKS = new RegExp(`\\b(${Object.keys(HOOK_FILE).join("|")})\\b`, "g");

function hookTables(names) {
  const out = new Set();
  for (const n of names) {
    const f = HOOK_FILE[n];
    if (!f || !existsSync(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const t of DOMAIN) if (src.includes(`from("${t}")`)) out.add(t);
  }
  return [...out];
}

function read(p) {
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/**
 * The body of one locally-defined component.
 *
 * The principal panel defines all four of its communication pages inside
 * PrincipalApp.tsx. Inspecting the whole FILE attributed every service used
 * anywhere in it to every one of them — reporting LeavesPage as reading
 * MessageService when it does nothing but render <LeaveRequests />. Scope to the
 * function, then the delegation is visible instead of hidden.
 */
function localBody(src, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length, depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    i += 1;
  }
  return src.slice(m.index, i);
}

/** Resolve an `@/x` or relative import to a real file. */
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith(".")) base = join(dirname(fromFile), spec).split("\\").join("/");
  else return null;
  for (const c of [base + ".tsx", base + ".ts", base + "/index.tsx", base + "/index.ts"]) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Map every imported identifier in a file to the file it came from. */
function importMap(src, file) {
  const map = new Map();
  const re = /import\s+(?:(\w+)\s*,\s*)?(?:\{([^}]*)\})?\s*from\s*["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = re.exec(src))) {
    const target = resolveImport(m[3], file);
    if (!target) continue;
    if (m[1]) map.set(m[1], target);
    for (const raw of (m[2] ?? "").split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (name) map.set(name, target);
    }
  }
  // default imports without braces
  const re2 = /import\s+(\w+)\s+from\s*["'`]([^"'`]+)["'`]/g;
  while ((m = re2.exec(src))) {
    const t = resolveImport(m[2], file);
    if (t) map.set(m[1], t);
  }
  return map;
}

/** What does this component file actually touch? */
function inspect(file, seen = new Set(), bodyOverride = null, localName = null) {
  const key = localName ? `${file}#${localName}` : file;
  if (!file || seen.has(key)) return { tables: [], rpcs: [], services: [], hooks: [], lines: 0, delegates: [] };
  seen.add(key);
  const whole = read(file);
  if (whole === null) return { tables: [], rpcs: [], services: [], hooks: [], lines: 0, delegates: [] };
  const src = bodyOverride ?? whole;

  const tables = DOMAIN.filter((t) => src.includes(`from("${t}")`) || src.includes(`from('${t}')`));
  const rpcs = [...new Set((src.match(DOMAIN_RPC) ?? []))];
  const services = [...new Set((src.match(SERVICES) ?? []))];
  const hooks = [...new Set((src.match(HOOKS) ?? []))];

  // Imports are file-wide even when the body is one function; the delegate must
  // still appear in THIS body to count.
  const imports = importMap(whole, file);
  const delegates = [];
  for (const [name, target] of imports) {
    if (!/^[A-Z]/.test(name)) continue;
    if (!new RegExp(`<${name}[\\s/>]`).test(src)) continue;
    if (target.includes("/components/ui/")) continue;
    delegates.push([name, target]);
  }
  return { tables, rpcs, services, hooks, lines: src.split("\n").length, delegates };
}

/** Inspect a component and, if it reads nothing, one level of what it renders. */
function classify(file, localName = null) {
  const whole = read(file);
  const body = localName && whole ? localBody(whole, localName) : null;
  const own = inspect(file, new Set(), body, localName);
  const direct = own.tables.length + own.rpcs.length + own.services.length + own.hooks.length;
  if (direct > 0) return { verdict: "REAL", own, via: null };

  for (const [name, target] of own.delegates) {
    const childLocal = target === file ? name : null;
    const childBody = childLocal && whole ? localBody(whole, name) : null;
    const child = inspect(target, new Set([localName ? file+"#"+localName : file]), childBody, childLocal);
    if (child.tables.length + child.rpcs.length + child.services.length + child.hooks.length > 0) {
      return { verdict: "PROXY", own, via: { name, target, child } };
    }
  }
  return { verdict: own.lines > 0 ? "STUB" : "MISSING", own, via: null };
}

let total = 0;
const counts = { REAL: 0, PROXY: 0, STUB: 0, REDIRECT: 0, MISSING: 0 };
const tableByPanel = new Map();

for (const [panel, appFile] of PANELS) {
  const src = read(appFile);
  if (src === null) { console.log(`\n### ${panel}: ${appFile} NOT FOUND`); continue; }
  const imports = importMap(src, appFile);

  console.log(`\n### ${panel}  (${appFile})`);
  const re = /<Route\s+path="([^"]+)"\s+element=\{<(\w+)([^>]*)\/?>/g;
  let m;
  const rows = [];
  while ((m = re.exec(src))) {
    const [, path, comp] = m;
    const head = path.split("/")[0];
    if (!IN_SCOPE.test(path) && !IN_SCOPE.test(head)) continue;
    total += 1;

    if (comp === "Navigate") {
      counts.REDIRECT += 1;
      const to = (m[3].match(/to="([^"]+)"/) ?? [])[1] ?? "?";
      rows.push([path, "REDIRECT", `-> ${to}`, ""]);
      continue;
    }
    // The principal panel defines its pages inside the router file rather than
    // importing them, so an import-only resolver reported four real screens as
    // MISSING. A locally-defined component resolves to the router file itself.
    const target = imports.get(comp)
      ?? (new RegExp(`function\\s+${comp}\\s*\\(`).test(src) ? appFile : null);
    const isLocal = !imports.get(comp) && target === appFile;
    const { verdict, own, via } = classify(target, isLocal ? comp : null);
    counts[verdict] += 1;

    const reads = [
      ...own.tables, ...own.rpcs, ...own.services, ...own.hooks,
      ...(via ? [`via ${via.name}: ${[...via.child.tables, ...via.child.rpcs, ...via.child.services].join(" ")}`] : []),
    ].filter(Boolean);

    const svcTables = [...serviceTables([...own.services, ...(via ? via.child.services : [])]), ...hookTables([...own.hooks, ...(via ? via.child.hooks : [])])];
    for (const t of [...own.tables, ...(via ? via.child.tables : []), ...svcTables]) {
      if (!tableByPanel.has(t)) tableByPanel.set(t, new Set());
      tableByPanel.get(t).add(panel);
    }

    rows.push([
      path,
      verdict,
      `${comp} (${target ? target.replace("src/", "") : "unresolved"})`,
      reads.join(" · ") || "reads nothing",
    ]);
  }
  const w = Math.max(...rows.map((r) => r[0].length), 4);
  for (const [p, v, c, r] of rows) {
    console.log(`  ${p.padEnd(w)}  ${v.padEnd(8)}  ${c}`);
    if (r) console.log(`  ${" ".repeat(w)}  ${" ".repeat(8)}  ${r}`);
  }
}

console.log(`\n${"=".repeat(70)}`);
console.log(`${total} route(s) in scope across ${PANELS.length} panels:`);
for (const [k, v] of Object.entries(counts)) if (v) console.log(`  ${String(v).padStart(3)}  ${k}`);

console.log(`\nWhich panels read which table:`);
for (const [t, panels] of [...tableByPanel.entries()].sort()) {
  console.log(`  ${t.padEnd(26)} ${[...panels].sort().join(", ")}`);
}
const unread = DOMAIN.filter((t) => !tableByPanel.has(t));
if (unread.length) {
  console.log(`\nDomain tables NO communication route reads:`);
  for (const t of unread) console.log(`  ${t}`);
}
