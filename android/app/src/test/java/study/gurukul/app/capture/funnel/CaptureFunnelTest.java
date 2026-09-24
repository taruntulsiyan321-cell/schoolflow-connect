package study.gurukul.app.capture.funnel;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.Set;
import org.junit.Before;
import org.junit.Test;

/**
 * JVM mirror of the androidTest funnel assertions — runs without a device via
 * `./gradlew :app:testDebugUnitTest`. The instrumented suite is the §5 source
 * of truth when a device/emulator is available.
 */
public class CaptureFunnelTest {
  private static final String PW = "com.physicswallah.pw";
  private static final String WA = "com.whatsapp";
  private static final String GALLERY = "com.google.android.apps.photos";

  private FunnelCounters counters;
  private CaptureFunnel funnel;
  private int ocrCalls;

  @Before
  public void setUp() {
    counters = new FunnelCounters();
    ocrCalls = 0;
    funnel = new CaptureFunnel(counters, frame -> {
      ocrCalls++;
      return frame.ocrTextOrNull == null ? "" : frame.ocrTextOrNull;
    });
  }

  private Set<String> allow() {
    Set<String> s = new HashSet<>();
    s.add(PW);
    return s;
  }

  private static final String WRONG =
      "Q1. Efficiency means?\nA. Waste\nYour answer: A Incorrect\nCorrect answer: B";

  @Test
  public void whatsappAndGallery_droppedAt51_nothingRead_sentZero() {
    funnel.evaluate(FrameSample.of(WA, allow(), 0.01, 0.2, true, WRONG));
    funnel.evaluate(FrameSample.of(GALLERY, allow(), 0.01, 0.2, true, WRONG));
    funnel.evaluate(FrameSample.of(WA, allow(), 0.02, 0.15, false, WRONG));

    assertEquals(3, counters.framesSeen);
    assertEquals(3, counters.droppedAt51);
    assertEquals(0, counters.sent);
    assertEquals(0, counters.ocrInvocations);
    assertEquals(0, ocrCalls);
  }

  @Test
  public void lecture_droppedAt52_sentZero_ocrNotRun() {
    for (int i = 0; i < 20; i++) {
      funnel.evaluate(FrameSample.of(PW, allow(), 0.35, 0.01, false, null));
    }
    assertEquals(20, counters.framesSeen);
    assertEquals(20, counters.droppedAt52);
    assertEquals(0, counters.sent);
    assertEquals(0, counters.ocrInvocations);
    assertEquals(0, ocrCalls);
  }

  @Test
  public void wrongAnswer_sendsExactlyOne_positiveControl() {
    assertEquals(
        FunnelDecision.SEND,
        funnel.evaluate(FrameSample.of(PW, allow(), 0.02, 0.2, true, WRONG))
    );
    assertEquals(1, counters.framesSeen);
    assertEquals(1, counters.sent);
    assertEquals(0, counters.droppedAt51);
    assertEquals(0, counters.droppedAt52);
  }

  @Test
  public void cost_lectureHourDoesNotImplyStreamingBill() {
    counters.sessionStartedAtMs = System.currentTimeMillis() - 3_600_000L;
    for (int i = 0; i < 9000; i++) {
      funnel.evaluate(FrameSample.of(PW, allow(), 0.4, 0.008, false, null));
    }
    funnel.evaluate(FrameSample.of(PW, allow(), 0.02, 0.2, true, WRONG));
    counters.sessionEndedAtMs = counters.sessionStartedAtMs + 3_600_000L;

    assertEquals(1, counters.sent);
    assertEquals(9000, counters.droppedAt52);
    assertTrue("sent/hour=" + counters.framesSentPerHour(), counters.framesSentPerHour() < 5.0);
    assertTrue(counters.framesSeen > 1000);
  }

  @Test
  public void looksLikeQuestionWithVerdict_requiresStudentAnswer() {
    assertTrue(CaptureFunnel.looksLikeQuestionWithVerdict(WRONG));
    // Teacher solve without "Your answer" must not pass §5.4.
    assertEquals(
        false,
        CaptureFunnel.looksLikeQuestionWithVerdict(
            "Q. Management is a process.\nCorrect answer: B\nSir is solving on the board"
        )
    );
  }

  @Test
  public void duplicateSend_withinCooldown_doesNotRebill() {
    assertEquals(
        FunnelDecision.SEND,
        funnel.evaluate(FrameSample.of(PW, allow(), 0.02, 0.2, true, WRONG))
    );
    assertEquals(
        FunnelDecision.DROP_RECENT_DUPLICATE,
        funnel.evaluate(FrameSample.of(PW, allow(), 0.02, 0.2, true, WRONG))
    );
    assertEquals(1, counters.sent);
    assertEquals(1, counters.droppedDuplicate);
  }

  @Test
  public void scoreOnly_withoutStudentAnswer_droppedAt54() {
    String score =
        "Q1. Efficiency?\nA. Waste\nB. Gain\nScore: 3/10\nOpen solutions to review";
    assertEquals(
        FunnelDecision.DROP_TEXT_GATE,
        funnel.evaluate(FrameSample.of(PW, allow(), 0.02, 0.2, true, score))
    );
    assertEquals(0, counters.sent);
    assertEquals(1, counters.droppedAt54);
  }
}
