package study.gurukul.app.capture.funnel;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * §5 on-device funnel — docs/screen-capture-mistakes-spec.md §5.1–§5.4.
 * Nothing here costs money or leaves the device until {@link FunnelDecision#SEND}.
 *
 * Thresholds (§13): picked for Stage 2; tune against instrumented §12 and record.
 */
public final class CaptureFunnel {
  /** §5.2 — video motion: mean abs pixel delta above this looks like a lecture. */
  public static final double LECTURE_DELTA_MIN = 0.12;
  /** §5.2 — lecture frames carry little text. */
  public static final double LECTURE_TEXT_MAX = 0.04;
  /** §5.2 — a still question is mostly text. */
  public static final double QUESTION_TEXT_MIN = 0.06;

  private static final Pattern VERDICT_WORDS = Pattern.compile(
      "(?i)(your\\s*answer|correct\\s*answer|incorrect|wrong|solution|\\bcorrect\\b|\\bincorrect\\b)"
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

  public CaptureFunnel(FunnelCounters counters, OcrProvider ocr) {
    this.counters = counters == null ? new FunnelCounters() : counters;
    this.ocr = ocr;
  }

  public FunnelCounters counters() {
    return counters;
  }

  /**
   * Evaluate one frame. Increments counters. OCR runs only if §5.1–§5.3 pass
   * and the sample has no pre-supplied text.
   */
  public FunnelDecision evaluate(FrameSample frame) {
    synchronized (counters) {
      counters.framesSeen += 1;

      // §5.1 — not on list → drop before any read.
      String pkg = frame.packageName.trim().toLowerCase(Locale.US);
      if (pkg.isEmpty() || !frame.allowedPackages.contains(pkg)) {
        counters.droppedAt51 += 1;
        return FunnelDecision.DROP_APP_NOT_ALLOWED;
      }

      // §5.2 — lecture: high motion + little text. No AI.
      if (frame.frameDelta >= LECTURE_DELTA_MIN && frame.textDensity <= LECTURE_TEXT_MAX) {
        counters.droppedAt52 += 1;
        return FunnelDecision.DROP_LECTURE;
      }

      // §5.3 — verdict trigger (colour or motion toward a still high-text frame).
      // A timer is wrong; we only proceed when a verdict signal is present or
      // the frame is still + dense text (candidate for OCR confirmation).
      boolean stillQuestion =
          frame.frameDelta < LECTURE_DELTA_MIN && frame.textDensity >= QUESTION_TEXT_MIN;
      if (!frame.verdictColourSignal && !stillQuestion) {
        counters.droppedAt53 += 1;
        return FunnelDecision.DROP_NO_VERDICT_TRIGGER;
      }

      // §5.4 — on-device text: question AND verdict. OCR only here.
      String text = frame.ocrTextOrNull;
      if (text == null) {
        if (ocr == null) {
          counters.droppedAt54 += 1;
          return FunnelDecision.DROP_TEXT_GATE;
        }
        counters.ocrInvocations += 1;
        text = ocr.recognise(frame);
      } else if (frame.countAsOcrInvocation) {
        counters.ocrInvocations += 1;
      }
      if (text == null) text = "";
      if (!looksLikeQuestionWithVerdict(text)) {
        counters.droppedAt54 += 1;
        return FunnelDecision.DROP_TEXT_GATE;
      }

      counters.sent += 1;
      return FunnelDecision.SEND;
    }
  }

  /** §5.4 / §6.3 — question-shaped text and a student-attached verdict. */
  public static boolean looksLikeQuestionWithVerdict(String text) {
    if (text == null) return false;
    String t = text.trim();
    if (t.length() < 24) return false;
    boolean hasVerdict = VERDICT_WORDS.matcher(t).find();
    boolean hasStudent = STUDENT_ANSWER.matcher(t).find();
    boolean hasQuestion = QUESTION_MARKERS.matcher(t).find()
        || t.contains("?")
        || OPTION_MARKERS.matcher(t).find();
    // Need a verdict attached to the student's answer (§6.3 / §6.4), not merely
    // a teacher solution on screen.
    return hasQuestion && hasVerdict && hasStudent;
  }
}
