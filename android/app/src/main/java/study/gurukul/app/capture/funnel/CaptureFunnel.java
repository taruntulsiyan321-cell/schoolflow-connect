package study.gurukul.app.capture.funnel;

import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * §5 on-device funnel — docs/screen-capture-mistakes-spec.md §5.1–§5.4.
 * Nothing here costs money or leaves the device until {@link FunnelDecision#SEND}.
 *
 * Thresholds (§13): measured 2026-09-24; re-tune on live PW video (§10.4).
 */
public final class CaptureFunnel {
  /** §5.2 — video motion: mean abs pixel delta above this looks like a lecture. */
  public static final double LECTURE_DELTA_MIN = 0.12;
  /**
   * §5.2 — after dark/light-aware text density (see MlKitOcrProvider), lecture
   * frames stay at or below this. Measured 2026-09-24 on §12 PW-shaped fixtures.
   */
  public static final double LECTURE_TEXT_MAX = 0.04;
  /**
   * §5.2 / §5.3 — still frame with at least this glyph fraction is a question
   * candidate. Measured 2026-09-24: PW dark-theme wrong instant ≈0.0105.
   */
  public static final double QUESTION_TEXT_MIN = 0.008;
  /** §8 — same OCR fingerprint must not re-bill AI within this window. */
  public static final long SEND_COOLDOWN_MS = 45_000L;

  private static final Pattern VERDICT_WORDS = Pattern.compile(
      "(?i)(your\\s*answer|correct\\s*answer|incorrect|wrong|solution|\\bcorrect\\b|\\bincorrect\\b)"
  );
  private static final Pattern WRONG_VERDICT = Pattern.compile(
      "(?i)(\\bincorrect\\b|\\bwrong\\b|not\\s+correct)"
  );
  private static final Pattern YOUR_CHOICE = Pattern.compile(
      "(?i)your\\s*answer\\s*[:.\\-]?\\s*([a-d0-9])"
  );
  private static final Pattern CORRECT_CHOICE = Pattern.compile(
      "(?i)correct\\s*answer\\s*[:.\\-]?\\s*([a-d0-9])"
  );
  private static final Pattern QUESTION_MARKERS = Pattern.compile(
      "(?i)(^|\\n)\\s*(q\\.?\\s*\\d+|question\\s*\\d+|\\d+[.)]|which |what |how |why |who )"
  );
  private static final Pattern STUDENT_ANSWER = Pattern.compile(
      "(?i)your\\s*answer"
  );
  private static final Pattern OPTION_MARKERS = Pattern.compile(
      "(?i)\\b(a\\.|b\\.|c\\.|d\\.)\\s"
  );

  private final FunnelCounters counters;
  private final OcrProvider ocr;
  private String lastSentFingerprint = "";
  private long lastSentAtMs = 0L;

  public CaptureFunnel(FunnelCounters counters, OcrProvider ocr) {
    this.counters = counters == null ? new FunnelCounters() : counters;
    this.ocr = ocr;
  }

  public FunnelCounters counters() {
    return counters;
  }

  public void resetSendCooldown() {
    lastSentFingerprint = "";
    lastSentAtMs = 0L;
  }

  /**
   * Evaluate one frame. Increments counters. OCR runs only if §5.1–§5.3 pass
   * and the sample has no pre-supplied text.
   */
  public FunnelDecision evaluate(FrameSample frame) {
    Optional<FunnelDecision> early = dropThrough53(frame);
    if (early.isPresent()) return early.get();
    String text = frame.ocrTextOrNull;
    if (text == null) {
      if (ocr == null) {
        synchronized (counters) {
          counters.droppedAt54 += 1;
        }
        return FunnelDecision.DROP_TEXT_GATE;
      }
      synchronized (counters) {
        counters.ocrInvocations += 1;
      }
      text = ocr.recognise(frame);
    } else if (frame.countAsOcrInvocation) {
      synchronized (counters) {
        counters.ocrInvocations += 1;
      }
    }
    return finishWithOcrText(text == null ? "" : text);
  }

  /**
   * §5.1–§5.3 only. Empty = frame should reach OCR / §5.4.
   * Increments {@code framesSeen} and early drop counters.
   */
  public Optional<FunnelDecision> dropThrough53(FrameSample frame) {
    synchronized (counters) {
      counters.framesSeen += 1;

      String pkg = frame.packageName.trim().toLowerCase(Locale.US);
      if (pkg.isEmpty() || !frame.allowedPackages.contains(pkg)) {
        counters.droppedAt51 += 1;
        return Optional.of(FunnelDecision.DROP_APP_NOT_ALLOWED);
      }

      if (frame.frameDelta >= LECTURE_DELTA_MIN && frame.textDensity <= LECTURE_TEXT_MAX) {
        counters.droppedAt52 += 1;
        return Optional.of(FunnelDecision.DROP_LECTURE);
      }

      boolean stillQuestion =
          frame.frameDelta < LECTURE_DELTA_MIN && frame.textDensity >= QUESTION_TEXT_MIN;
      if (!frame.verdictColourSignal && !stillQuestion) {
        counters.droppedAt53 += 1;
        return Optional.of(FunnelDecision.DROP_NO_VERDICT_TRIGGER);
      }
      return Optional.empty();
    }
  }

  /**
   * §5.4 + send-cooldown. Does <strong>not</strong> increment framesSeen
   * (caller already counted via {@link #dropThrough53}).
   */
  public FunnelDecision finishWithOcrText(String text) {
    synchronized (counters) {
      if (text == null) text = "";
      if (!looksLikeQuestionWithVerdict(text)) {
        counters.droppedAt54 += 1;
        return FunnelDecision.DROP_TEXT_GATE;
      }
      String fp = sendFingerprint(text);
      long now = System.currentTimeMillis();
      if (!fp.isEmpty()
          && fp.equals(lastSentFingerprint)
          && (now - lastSentAtMs) < SEND_COOLDOWN_MS) {
        counters.droppedDuplicate += 1;
        return FunnelDecision.DROP_RECENT_DUPLICATE;
      }
      lastSentFingerprint = fp;
      lastSentAtMs = now;
      counters.sent += 1;
      return FunnelDecision.SEND;
    }
  }

  /** Normalise OCR for duplicate cooldown (§7.3 / §8). */
  public static String sendFingerprint(String text) {
    if (text == null) return "";
    return text.toLowerCase(Locale.US).replaceAll("\\s+", " ").trim();
  }

  /** §5.4 / §6.3 / §12.4 — question + student answer + evidence they were wrong. */
  public static boolean looksLikeQuestionWithVerdict(String text) {
    if (text == null) return false;
    String t = text.trim();
    if (t.length() < 24) return false;
    boolean hasStudent = STUDENT_ANSWER.matcher(t).find();
    boolean hasQuestion = QUESTION_MARKERS.matcher(t).find()
        || t.contains("?")
        || OPTION_MARKERS.matcher(t).find();
    if (!hasQuestion || !hasStudent) return false;
    // §12.4 — correct answers must not leave the phone (cost + mistake-book trust).
    if (!studentLooksWrong(t)) return false;
    // Still require a verdict-shaped screen (not a bare "Your answer" draft).
    return VERDICT_WORDS.matcher(t).find();
  }

  /**
   * True when OCR shows the student was wrong: explicit incorrect/wrong, or
   * Your answer ≠ Correct answer letters.
   */
  static boolean studentLooksWrong(String text) {
    if (WRONG_VERDICT.matcher(text).find()) return true;
    java.util.regex.Matcher yours = YOUR_CHOICE.matcher(text);
    java.util.regex.Matcher correct = CORRECT_CHOICE.matcher(text);
    if (yours.find() && correct.find()) {
      String a = yours.group(1).toLowerCase(Locale.US);
      String b = correct.group(1).toLowerCase(Locale.US);
      return !a.equals(b);
    }
    return false;
  }
}
