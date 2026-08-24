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
  NOT_AVAILABLE,
  describeDisplayText,
  toDisplayText,
  isDisplaySafe,
  isIdentifierLike,
  type DisplayKind,
  type DisplayTextOptions,
  type DisplayTextResult,
} from "./safeText";

export {
  GENERIC_ERROR_MESSAGE,
  looksLikeDatabaseNoise,
  toErrorLabel,
  toErrorMessage,
  toUserMessage,
  type UserMessageOptions,
} from "./errors";

export {
  enumOptions,
  humanizeEnumValue,
  isKnownEnumValue,
  toEnumLabel,
  type EnumDomain,
  type EnumLabelOptions,
} from "./enums";

export {
  toClassLabel,
  toInitials,
  toPersonName,
  toPersonNameFrom,
  type PersonKind,
  type PersonNameOptions,
} from "./people";

export {
  toAiLine,
  toAssistantMarkdown,
  toAssistantText,
  type AssistantTextResult,
} from "./aiText";

// Academic label presentation already has an SSOT — surface it here too so a
// single import covers every "value -> user-facing text" need.
export {
  displayChapter,
  displayConcept,
  displaySubject,
  displayTopic,
  isPlaceholderAcademicLabel,
  presentAcademicLabel,
} from "@/academic/taxonomy";
