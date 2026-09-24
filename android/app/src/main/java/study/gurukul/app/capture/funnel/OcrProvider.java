package study.gurukul.app.capture.funnel;

/**
 * Optional OCR for §5.4. Must not be called before §5.1–§5.3 pass —
 * {@link CaptureFunnel} enforces that order.
 */
public interface OcrProvider {
  /** Returns recognised text, or empty string. Never null. */
  String recognise(FrameSample frame);
}
