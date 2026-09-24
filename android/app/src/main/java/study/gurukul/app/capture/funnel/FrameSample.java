package study.gurukul.app.capture.funnel;

import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * One sampled frame for the §5 funnel. OCR text is optional: when null and the
 * frame reaches §5.4, the funnel asks {@link OcrProvider} (never before §5.4).
 */
public final class FrameSample {
  public final String packageName;
  public final Set<String> allowedPackages;
  /** Mean absolute pixel difference vs previous frame, 0..1. Lecture ≫ still. */
  public final double frameDelta;
  /** Fraction of pixels that look like text ink, 0..1. Question ≫ video. */
  public final double textDensity;
  /** Red/green verdict colour signal appeared this frame (cheap pre-OCR). */
  public final boolean verdictColourSignal;
  /**
   * Pre-supplied OCR text for tests. Null in production until §5.4 runs.
   * When non-null, OCR is treated as already done (tests) without counting
   * a new invocation unless {@link #countAsOcrInvocation} is true.
   */
  public final String ocrTextOrNull;
  public final boolean countAsOcrInvocation;

  public FrameSample(
      String packageName,
      Set<String> allowedPackages,
      double frameDelta,
      double textDensity,
      boolean verdictColourSignal,
      String ocrTextOrNull,
      boolean countAsOcrInvocation
  ) {
    this.packageName = packageName == null ? "" : packageName;
    Set<String> allowed = new HashSet<>();
    if (allowedPackages != null) {
      for (String p : allowedPackages) {
        if (p != null && !p.trim().isEmpty()) {
          allowed.add(p.trim().toLowerCase(Locale.US));
        }
      }
    }
    this.allowedPackages = Collections.unmodifiableSet(allowed);
    this.frameDelta = frameDelta;
    this.textDensity = textDensity;
    this.verdictColourSignal = verdictColourSignal;
    this.ocrTextOrNull = ocrTextOrNull;
    this.countAsOcrInvocation = countAsOcrInvocation;
  }

  public static FrameSample of(
      String packageName,
      Set<String> allowed,
      double delta,
      double textDensity,
      boolean colour,
      String ocr
  ) {
    return new FrameSample(packageName, allowed, delta, textDensity, colour, ocr, false);
  }
}
