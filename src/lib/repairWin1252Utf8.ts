/**
 * @deprecated Import `repairUtf8Mojibake` from `@/lib/utf8MojibakeRepair` / `@/lib/utf8Text`.
 * Alias kept for Meta2/Supervisor coordination during the encoding RCA.
 */
export {
  looksLikeUtf8Mojibake as looksLikeWin1252Utf8Mojibake,
  repairUtf8Mojibake as repairWin1252Utf8,
  UTF8_MOJIBAKE_SIGNATURE,
} from "@/lib/utf8MojibakeRepair";
