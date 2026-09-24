package study.gurukul.app.capture.funnel;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Stage 2 §5 funnel — proves drops happen BEFORE OCR / network.
 * Binding: docs/screen-capture-mistakes-spec.md §5 / §8 / §12 items 6–7.
 *
 * These inject FrameSample (package, motion, text, OCR string). That is the
 * honest way to assert "nothing was READ" — ocrInvocations stays 0 when §5.1
 * or §5.2 drops. A server measure cannot prove that.
 */
@RunWith(AndroidJUnit4.class)
public class CaptureFunnelInstrumentedTest {
  private static final String PW = "com.physicswallah.pw";
  private static final String WA = "com.whatsapp";
  private static final String GALLERY = "com.google.android.apps.photos";

  private FunnelCounters counters;
  private CaptureFunnel funnel;
  private int ocrCalls;

  @Before
  public void setUp() {
    counters = new FunnelCounters();
    counters.sessionStartedAtMs = System.currentTimeMillis() - 3_600_000L;
    ocrCalls = 0;
    funnel = new CaptureFunnel(counters, frame -> {
      ocrCalls += 1;
      return frame.ocrTextOrNull == null ? "" : frame.ocrTextOrNull;
    });
  }

  private Set<String> allowPw() {
    Set<String> s = new HashSet<>();
    s.add(PW);
    return s;
  }

  private static final String WRONG_OCR =
      "Q. Which is a function of management?\n"
          + "A. Cooking\nB. Planning\n"
          + "Your answer: A  Incorrect\n"
          + "Correct answer: B";

  @Test
  public void whatsappAndGallery_droppedAt51_nothingRead_sentZero() {
    // Mid-session: unlisted apps. framesSeen > 0, SENT = 0, all drops at §5.1.
    funnel.evaluate(FrameSample.of(WA, allowPw(), 0.01, 0.2, true, WRONG_OCR));
    funnel.evaluate(FrameSample.of(GALLERY, allowPw(), 0.01, 0.2, true, WRONG_OCR));
    funnel.evaluate(FrameSample.of(WA, allowPw(), 0.02, 0.15, false, WRONG_OCR));

    assertEquals(3, counters.framesSeen);
    assertEquals(3, counters.droppedAt51);
    assertEquals(0, counters.droppedAt52);
    assertEquals(0, counters.sent);
    assertEquals(0, counters.ocrInvocations);
    assertEquals(0, ocrCalls);
  }

  @Test
  public void lecturePlaying_droppedAt52_sentZero_ocrNotRun() {
    // High motion + little text = lecture. Drop attributed to §5.2.
    for (int i = 0; i < 20; i++) {
      funnel.evaluate(FrameSample.of(PW, allowPw(), 0.35, 0.01, false, null));
    }
    assertEquals(20, counters.framesSeen);
    assertEquals(0, counters.droppedAt51);
    assertEquals(20, counters.droppedAt52);
    assertEquals(0, counters.sent);
    assertEquals(0, counters.ocrInvocations);
    assertEquals(0, ocrCalls);
  }

  @Test
  public void realWrongAnswer_sentExactlyOne_positiveControl() {
    // OCR text supplied as the on-device recogniser would return it after §5.3.
    // Without this positive control, a funnel that drops everything would pass.
    FunnelDecision d = funnel.evaluate(
        new FrameSample(PW, allowPw(), 0.02, 0.18, true, WRONG_OCR, true)
    );
    assertEquals(FunnelDecision.SEND, d);
    assertEquals(1, counters.framesSeen);
    assertEquals(1, counters.sent);
    assertEquals(1, counters.ocrInvocations);
    assertEquals(0, counters.droppedAt51);
    assertEquals(0, counters.droppedAt52);
  }

  @Test
  public void cost_lectureHourDoesNotImplyStreamingBill() {
    // Simulate ~1 hour of lecture-dominated sampling at 2.5 Hz ≈ 9000 frames,
    // all dropped at §5.2, plus one real wrong.
    counters.sessionStartedAtMs = System.currentTimeMillis() - 3_600_000L;
    for (int i = 0; i < 9000; i++) {
      funnel.evaluate(FrameSample.of(PW, allowPw(), 0.4, 0.008, false, null));
    }
    funnel.evaluate(FrameSample.of(PW, allowPw(), 0.02, 0.2, true, WRONG_OCR));
    counters.sessionEndedAtMs = counters.sessionStartedAtMs + 3_600_000L;

    assertEquals(1, counters.sent);
    assertEquals(9000, counters.droppedAt52);
    double perHour = counters.framesSentPerHour();
    // 1 frame/hour ≪ streaming (~3600/hour). At ~$0.00008/image → pennies/month.
    assertTrue("sent/hour=" + perHour, perHour < 5.0);
    // Positive: if we had streamed every sample, sent would be ~9001.
    assertTrue(counters.framesSeen > 1000);
  }

  @Test
  public void pairedCan_allowedPackageStillSends() {
    // Every "cannot" needs a paired "can" on the same query.
    funnel.evaluate(FrameSample.of(WA, allowPw(), 0.01, 0.2, true, WRONG_OCR));
    assertEquals(0, counters.sent);
    funnel.evaluate(FrameSample.of(PW, allowPw(), 0.01, 0.2, true, WRONG_OCR));
    assertEquals(1, counters.sent);
  }

  @Test
  public void duplicateSend_withinCooldown_countsOnce() {
    funnel.evaluate(FrameSample.of(PW, allowPw(), 0.01, 0.2, true, WRONG_OCR));
    funnel.evaluate(FrameSample.of(PW, allowPw(), 0.01, 0.2, true, WRONG_OCR));
    assertEquals(1, counters.sent);
    assertEquals(1, counters.droppedDuplicate);
  }

  @Test
  public void scoreOnly_droppedAt54_nothingSent() {
    String score =
        "Q1. Efficiency?\nA. Waste\nB. Gain\nScore: 3/10\nOpen solutions to review";
    assertEquals(
        FunnelDecision.DROP_TEXT_GATE,
        funnel.evaluate(FrameSample.of(PW, allowPw(), 0.02, 0.2, true, score))
    );
    assertEquals(0, counters.sent);
    assertEquals(1, counters.droppedAt54);
  }

  @Test
  public void correctAnswer_droppedAt54_section124() {
    String correct =
        "Q. Which is a function of management?\n"
            + "A. Cooking\nB. Planning\n"
            + "Your answer: B  Correct\n"
            + "Correct answer: B";
    assertEquals(
        FunnelDecision.DROP_TEXT_GATE,
        funnel.evaluate(FrameSample.of(PW, allowPw(), 0.02, 0.2, true, correct))
    );
    assertEquals(0, counters.sent);
  }

  @Test
  public void teacherSolve_withoutYourAnswer_droppedAt54() {
    String teacher =
        "Q. Management is a process.\nCorrect answer: B\nSir is solving on the board now";
    assertEquals(
        FunnelDecision.DROP_TEXT_GATE,
        funnel.evaluate(FrameSample.of(PW, allowPw(), 0.02, 0.2, true, teacher))
    );
    assertEquals(0, counters.sent);
    assertEquals(0, counters.ocrInvocations);
  }
}
