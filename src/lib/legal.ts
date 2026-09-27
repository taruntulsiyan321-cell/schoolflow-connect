/**
 * The legal documents a buyer reads, in one place: the Terms, the Refund and
 * Cancellation Policy and the Privacy Policy pages render from here.
 *
 * LEGAL_VERSION is what a buyer accepts. premium_settings.terms_version must
 * equal it, and the Plans screen sells only when it does — so nobody can
 * accept a version other than the text on the screen in front of them.
 * Change the text → change LEGAL_VERSION → set premium_settings.terms_version
 * to match when the new text is live.
 *
 * DRAFTS. Written from what the app actually does (20261111000000–
 * 20261114000000, the payment functions). They are not legal advice: have a
 * lawyer review them, and fill in LEGAL_ENTITY, before sales are switched on.
 * The Plans screen refuses to sell while LEGAL_ENTITY is incomplete.
 */

export const LEGAL_VERSION = "2026-09-27";

/** The business behind Gurukul. null = not yet supplied by the owner. */
export const LEGAL_ENTITY: {
  brand: string;
  website: string;
  supportEmail: string;
  legalName: string | null;
  registeredAddress: string | null;
  gstin: string | null;
  jurisdictionCity: string | null;
  grievanceOfficer: { name: string; email: string; phone: string | null } | null;
} = {
  brand: "Gurukul",
  website: "https://www.gurukul.study",
  supportEmail: "hello@gurukul.study",
  legalName: null,
  registeredAddress: null,
  gstin: null,
  jurisdictionCity: null,
  grievanceOfficer: null,
};

/** Every field a buyer is entitled to see, supplied. */
export function legalEntityComplete(): boolean {
  const e = LEGAL_ENTITY;
  return !!(e.legalName && e.registeredAddress && e.jurisdictionCity && e.grievanceOfficer?.name && e.grievanceOfficer.email);
}

const PENDING = "[to be published before payments open]";

export type LegalDoc = {
  slug: "terms" | "refund-policy" | "privacy";
  title: string;
  sections: { heading: string; paragraphs: string[] }[];
};

function operator(): string {
  return LEGAL_ENTITY.legalName ? `${LEGAL_ENTITY.brand}, operated by ${LEGAL_ENTITY.legalName}` : `${LEGAL_ENTITY.brand} (operator: ${PENDING})`;
}

function grievance(): string {
  const g = LEGAL_ENTITY.grievanceOfficer;
  return g
    ? `Grievance Officer: ${g.name}, ${g.email}${g.phone ? `, ${g.phone}` : ""}. We acknowledge a complaint within 48 hours and resolve it within one month.`
    : `Grievance Officer: ${PENDING}.`;
}

export function legalDocs(): LegalDoc[] {
  const e = LEGAL_ENTITY;
  return [
    {
      slug: "terms",
      title: "Terms of Use",
      sections: [
        { heading: "Who we are", paragraphs: [
          `These terms are an agreement between you and ${operator()} ("we", "us") for the use of ${e.website} and the Gurukul app.`,
          `Registered address: ${e.registeredAddress ?? PENDING}. GSTIN: ${e.gstin ?? PENDING}.`,
        ] },
        { heading: "Your account", paragraphs: [
          "An individual account is for one person preparing for one exam. Keep your sign-in to yourself; you are responsible for what is done with your account.",
          "If you are under 18, a parent or guardian must agree to these terms on your behalf, and must make or approve any purchase.",
        ] },
        { heading: "Plans", paragraphs: [
          "Gurukul has a Free plan and three paid plans: Starter, Standard and Premium. What each plan includes, and how much of each feature it allows per day or per month, is shown on the Plans screen before you buy.",
          "The price you pay is shown at checkout in Indian rupees and includes GST. A paid plan lasts the number of days shown when you buy it. It is a one-time payment: nothing renews automatically, and nothing is charged again unless you choose to buy again.",
          "If you buy the plan you already have, the new days start when your current plan ends. If you buy a higher plan, it starts immediately, and the unused part of a lower plan you paid for is converted into extra days of the higher plan at its price. A lower plan cannot be bought while a higher one is running.",
          "We may change what plans include for future purchases. A plan you have already bought keeps what it included when you bought it, until it ends.",
        ] },
        { heading: "Paying", paragraphs: [
          "Payments are processed by Razorpay. We never see or store your card, UPI or bank details. Your plan starts once Razorpay confirms your payment; if confirmation takes a few minutes, the Plans screen shows it as pending.",
        ] },
        { heading: "Fair use", paragraphs: [
          "Plan allowances are for your own study. Automated, shared or abusive use may be limited or stopped.",
        ] },
        { heading: "AI features", paragraphs: [
          "Nova and other AI features generate answers automatically and can make mistakes. Use them as a study aid; check anything important against your textbook or teacher. We do not guarantee any exam result.",
        ] },
        { heading: "Refunds", paragraphs: ["Refunds are governed by our Refund and Cancellation Policy."] },
        { heading: "Ending and changes", paragraphs: [
          "You can stop using Gurukul at any time. We may suspend accounts that break these terms. We will tell you in the app before changes to these terms take effect; buying after a change means accepting the new terms.",
          `These terms are governed by the laws of India. Courts at ${e.jurisdictionCity ?? PENDING} have jurisdiction.`,
        ] },
        { heading: "Contact and complaints", paragraphs: [`Email ${e.supportEmail}. ${grievance()}`] },
      ],
    },
    {
      slug: "refund-policy",
      title: "Refund and Cancellation Policy",
      sections: [
        { heading: "Nothing to cancel", paragraphs: [
          "Every paid plan is a one-time payment for a fixed number of days. Nothing renews automatically, so there is no subscription to cancel.",
        ] },
        { heading: "When you get a refund", paragraphs: [
          "You are refunded in full if you were charged and your plan did not start because of a fault on our side, or if you were charged twice for the same purchase.",
          "If money left your account but the payment failed, it is returned by your bank or by Razorpay automatically, usually within 5–7 working days.",
          "Because a plan gives access immediately, a plan that has started is otherwise not refundable.",
        ] },
        { heading: "How to ask", paragraphs: [
          `Email ${e.supportEmail} with the order number shown under Receipts on the Plans screen. We reply within 2 working days. An approved refund goes back to the original payment method, usually within 5–7 working days.`,
        ] },
        { heading: "What a refund does", paragraphs: [
          "A full refund ends the plan it paid for. A partial refund does not change your plan.",
        ] },
        { heading: "Complaints", paragraphs: [grievance()] },
      ],
    },
    {
      slug: "privacy",
      title: "Privacy Policy",
      sections: [
        { heading: "What we keep", paragraphs: [
          "Your account: your phone number, name and the exam you prepare for.",
          "Your learning: the questions you answer, your answers, mistakes, practice sessions, revision and recovery progress, and messages to Nova.",
          "Files you choose to give us: Custom Practice uploads, and — only if you switch it on in the Android app, only from apps you allow — screens you capture.",
          "Purchases: the plan, amount, date, payment method type and Razorpay's order and payment numbers. Card, UPI and bank details are handled by Razorpay and never reach us.",
        ] },
        { heading: "Why", paragraphs: [
          "To run your account and your plan, to show your progress, to answer your questions, to give you receipts, and to keep the records tax and accounting law requires.",
        ] },
        { heading: "Who else handles it", paragraphs: [
          "Supabase hosts our database and files. Razorpay processes payments. AI answers are generated by models reached through OpenRouter: the question and the study context needed to answer it are sent to them. We do not sell your data.",
        ] },
        { heading: "Children", paragraphs: [
          "If you are under 18, your parent or guardian's consent is needed to use Gurukul and to buy a plan.",
        ] },
        { heading: "How long", paragraphs: [
          "Learning data is kept while your account exists. Purchase records are kept for as long as tax and accounting law requires, even after an account is deleted.",
        ] },
        { heading: "Your rights", paragraphs: [
          `You can ask to see, correct or delete your data by emailing ${e.supportEmail}. Records the law requires us to keep are kept. ${grievance()}`,
        ] },
      ],
    },
  ];
}
