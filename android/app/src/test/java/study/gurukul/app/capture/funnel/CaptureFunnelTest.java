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
  public void unlistedApp_neverInvokesOcr() {
    funnel.evaluate(FrameSample.of("com.whatsapp", allow(), 0.01, 0.2, true, WRONG));
    assertEquals(1, counters.droppedAt51);
    assertEquals(0, counters.sent);
    assertEquals(0, ocrCalls);
  }

  @Test
  public void lecture_neverInvokesOcr() {
    funnel.evaluate(FrameSample.of(PW, allow(), 0.5, 0.01, false, null));
    assertEquals(1, counters.droppedAt52);
    assertEquals(0, ocrCalls);
  }

  @Test
  public void wrongAnswer_sends() {
    assertEquals(
        FunnelDecision.SEND,
        funnel.evaluate(FrameSample.of(PW, allow(), 0.02, 0.2, true, WRONG))
    );
    assertEquals(1, counters.sent);
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
}
