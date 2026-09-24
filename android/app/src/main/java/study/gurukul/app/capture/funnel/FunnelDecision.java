package study.gurukul.app.capture.funnel;

/** Outcome of one frame through §5.1–§5.4. */
public enum FunnelDecision {
  DROP_APP_NOT_ALLOWED,   // §5.1 — never read
  DROP_LECTURE,           // §5.2 — never leave phone
  DROP_NO_VERDICT_TRIGGER,// §5.3 — no right/wrong beside student answer
  DROP_TEXT_GATE,         // §5.4 — OCR ran; not question+verdict
  SEND                    // survived all four — may touch the network
}
