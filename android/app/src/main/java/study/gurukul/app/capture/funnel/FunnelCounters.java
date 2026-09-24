package study.gurukul.app.capture.funnel;

/**
 * On-device funnel counters — docs/screen-capture-mistakes-spec.md §5 / §8 / §12.7.
 * Proves drops happen on the phone before the network: SENT only increments
 * when a frame would leave the device.
 */
public final class FunnelCounters {
  public int framesSeen;
  public int droppedAt51;
  public int droppedAt52;
  public int droppedAt53;
  public int droppedAt54;
  public int sent;
  /** True if ML Kit / OCR was invoked for this session's last evaluated frame. */
  public int ocrInvocations;
  public long sessionStartedAtMs;
  public long sessionEndedAtMs;

  public synchronized void reset() {
    framesSeen = 0;
    droppedAt51 = 0;
    droppedAt52 = 0;
    droppedAt53 = 0;
    droppedAt54 = 0;
    sent = 0;
    ocrInvocations = 0;
    sessionStartedAtMs = 0;
    sessionEndedAtMs = 0;
  }

  public synchronized FunnelCounters snapshot() {
    FunnelCounters c = new FunnelCounters();
    c.framesSeen = framesSeen;
    c.droppedAt51 = droppedAt51;
    c.droppedAt52 = droppedAt52;
    c.droppedAt53 = droppedAt53;
    c.droppedAt54 = droppedAt54;
    c.sent = sent;
    c.ocrInvocations = ocrInvocations;
    c.sessionStartedAtMs = sessionStartedAtMs;
    c.sessionEndedAtMs = sessionEndedAtMs;
    return c;
  }

  /** §8 — frames that would leave the device per hour of session. */
  public synchronized double framesSentPerHour() {
    long end = sessionEndedAtMs > 0 ? sessionEndedAtMs : System.currentTimeMillis();
    long start = sessionStartedAtMs > 0 ? sessionStartedAtMs : end;
    long ms = Math.max(1L, end - start);
    return sent * (3_600_000.0 / ms);
  }

  @Override
  public synchronized String toString() {
    return "FunnelCounters{seen=" + framesSeen
      + " d51=" + droppedAt51
      + " d52=" + droppedAt52
      + " d53=" + droppedAt53
      + " d54=" + droppedAt54
      + " sent=" + sent
      + " ocr=" + ocrInvocations
      + " sentPerHour=" + String.format("%.2f", framesSentPerHour())
      + "}";
  }
}
