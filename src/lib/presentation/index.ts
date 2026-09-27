/**
 * The presentation boundary.
 *
 *   DATABASE / API / RPC / AI / STATE
 *            |
 *            v
 *   VALIDATE + NORMALIZE   <- safeText.ts
 *            |
 *            v
 *   TRANSFORM TO A LABEL   <- enums.ts, people.ts, errors.ts, taxonomy
 *            |
 *            v
 *   UI COMPONENT -> USER
 *
 * Nothing downstream of this module should coerce an unknown value to text.
 * If you find yourself writing `String(x)`, `` `${x}` ``, `x ?? ""` or
 * `e.message` for something a user will read, use one of these instead:
 *
 *   toDisplayText(value)                  any value -> safe text
 *   toEnumLabel(value, "attendance_status")  internal token -> label
 *   toPersonName(value, { kind: "student" }) name, never an id
 *   toUserMessage(error)                  caught value -> safe sentence
 *
 * Academic taxonomy labels (subject / chapter / topic / concept) keep their
 * existing SSOT in `@/academic/taxonomy`; re-exported here so there is one
 * import site for presentation concerns.
 */

export {
  toDisplayText,
  toPercentLabel,
  toCountLabel,
  isUuid,
} from "./safeText";

export {
  toErrorMessage,
} from "./errors";

export {
  enumOptions,
  humanizeEnumValue,
  toEnumLabel,
} from "./enums";

export {
  toClassLabel,
  toPersonName,
} from "./people";

export {
  toAiLine,
  toAssistantMarkdown,
} from "./aiText";

// Academic label presentation already has an SSOT — surface it here too so a
// single import covers every "value -> user-facing text" need.
export {
  displayChapter,
  displaySubject,
  displayTopic,
} from "@/academic/taxonomy";
