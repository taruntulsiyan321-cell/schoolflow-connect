import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Check, Crown, Loader2, Receipt, ShieldCheck } from "lucide-react";
import { GlassCard, LoadingState, PageHeader, ProgressBar, SectionLabel, cn } from "@/gurukul/components/shared";
import { usePremiumStatus, premiumChanged } from "@/hooks/usePremiumStatus";
import { useGurukulStudent } from "@/gurukul/StudentContext";
import { EMPTY_STUDENT } from "@/gurukul/emptyStudent";
import {
  FEATURE_NAMES,
  FEATURE_ORDER,
  buyPlan,
  canBuyInThisApp,
  describeAllowance,
  fetchMyOrders,
  formatRupees,
  verifyOrder,
  type PremiumOrder,
  type PremiumProduct,
  type PremiumStatus,
} from "@/lib/premium";
import { LEGAL_VERSION, legalEntityComplete } from "@/lib/legal";

type Individual = Extract<PremiumStatus, { individual: true }>;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function tierName(s: Individual, code: string): string {
  return s.tiers.find((t) => t.code === code)?.display_name ?? code;
}

/**
 * Why buying is not open, or null when it is. Four things must hold, and the
 * first that does not is what the student is told.
 */
function salesBlocker(s: Individual): string | null {
  if (!canBuyInThisApp()) return "native";
  if (!s.sales_enabled) return "Plans open for purchase soon.";
  if (!legalEntityComplete()) return "Plans open for purchase soon.";
  // The terms a buyer accepts must be the terms this screen links to.
  if (s.terms_version !== LEGAL_VERSION) return "Our terms are being updated. Plans can be bought again shortly.";
  return null;
}

export default function Premium() {
  const { status, loading, error, reload } = usePremiumStatus();
  const [orders, setOrders] = useState<PremiumOrder[] | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      setOrders(await fetchMyOrders());
    } catch {
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    if (status?.individual) void loadOrders();
  }, [status, loadOrders]);

  if (loading && !status) return <LoadingState label="Loading your plan" />;
  if (error && !status) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Plans" title="Your plan" />
        <GlassCard className="p-5 text-sm text-muted-foreground">
          Your plan could not be loaded. <button className="font-semibold text-primary" onClick={() => void reload()}>Try again</button>
        </GlassCard>
      </div>
    );
  }
  if (!status) return null;
  if (!status.individual) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Plans" title="Plans" />
        <GlassCard className="p-5 text-sm text-muted-foreground">
          Plans are for individual exam accounts. Your school gives you everything Gurukul has.
        </GlassCard>
      </div>
    );
  }

  return <PremiumScreen status={status} orders={orders} onChanged={() => { premiumChanged(); void loadOrders(); }} />;
}

function PremiumScreen({ status, orders, onChanged }: { status: Individual; orders: PremiumOrder[] | null; onChanged: () => void }) {
  const blocker = salesBlocker(status);
  const native = blocker === "native";
  const counted = status.features.filter((f) => f.period && f.period !== "none" && typeof f.limit === "number");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Plans"
        title="Your plan"
        subtitle={native ? undefined : "One-time payments. Nothing renews by itself."}
      />

      {!status.enforced && (
        <div className="rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm text-foreground">
          Plans aren&apos;t switched on yet — everything in Gurukul is open to you for now.
        </div>
      )}

      <GlassCard className="p-5" glow="purple">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Crown className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground">{tierName(status, status.tier)}</div>
            <div className="text-sm text-muted-foreground">
              {status.tier === "free" ? "The free plan" : `Active until ${formatDate(status.tier_until)}`}
            </div>
          </div>
        </div>
        {status.entitlements.filter((e) => new Date(e.starts_at) > new Date()).map((e) => (
          <p key={e.starts_at} className="mt-3 text-xs text-muted-foreground">
            Then {tierName(status, e.tier)} from {formatDate(e.starts_at)} to {formatDate(e.ends_at)}.
          </p>
        ))}
      </GlassCard>

      {counted.length > 0 && (
        <section>
          <SectionLabel>What you have used</SectionLabel>
          <GlassCard className="divide-y divide-border/60">
            {counted.map((f) => (
              <div key={f.feature} className="px-5 py-3">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-foreground">{FEATURE_NAMES[f.feature as keyof typeof FEATURE_NAMES] ?? f.feature}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {f.used ?? 0} of {describeAllowance(f.period, f.limit)}
                  </span>
                </div>
                <div className="mt-2">
                  <ProgressBar value={Math.min(f.used ?? 0, f.limit ?? 0)} max={f.limit ?? 1} />
                </div>
              </div>
            ))}
          </GlassCard>
        </section>
      )}

      <ComparePlans status={status} showPrices={!native} />

      {!native && (
        blocker
          ? <GlassCard className="p-5 text-sm text-muted-foreground">{blocker}</GlassCard>
          : <BuyPlans status={status} onChanged={onChanged} />
      )}

      <Receipts orders={orders} onChanged={onChanged} />
    </div>
  );
}

function ComparePlans({ status, showPrices }: { status: Individual; showPrices: boolean }) {
  const price = (tier: string) => status.products.find((p) => p.tier === tier);
  return (
    <section>
      <SectionLabel>Compare plans</SectionLabel>
      <GlassCard className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border/60">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground" />
              {status.tiers.map((t) => (
                <th key={t.code} className={cn("px-4 py-3 text-left", t.code === status.tier && "text-primary")}>
                  <div className="font-bold">{t.display_name}</div>
                  {showPrices && (
                    <div className="text-xs font-normal text-muted-foreground">
                      {t.code === "free" ? "₹0" : price(t.code) ? `${formatRupees(price(t.code)!.amount_paise)} · ${price(t.code)!.validity_days} days` : "—"}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/40">
              <td className="px-4 py-2.5 text-foreground">Recovery, Revision and the Mistake Book</td>
              {status.tiers.map((t) => (
                <td key={t.code} className="px-4 py-2.5"><Check className="h-4 w-4 text-success" aria-label="Included" /></td>
              ))}
            </tr>
            {FEATURE_ORDER.map((f) => (
              <tr key={f} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 text-foreground">{FEATURE_NAMES[f]}</td>
                {status.tiers.map((t) => {
                  const l = t.limits.find((x) => x.feature === f);
                  return (
                    <td key={t.code} className="px-4 py-2.5 text-muted-foreground">
                      {l ? describeAllowance(l.period, l.limit) : <span aria-label="Not included">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>
    </section>
  );
}

function BuyPlans({ status, onChanged }: { status: Individual; onChanged: () => void }) {
  const student = useGurukulStudent();
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [guardian, setGuardian] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const rankOf = useMemo(() => Object.fromEntries(status.tiers.map((t) => [t.code, t.rank])), [status.tiers]);
  const ready = termsAccepted && guardian;

  const buy = async (p: PremiumProduct) => {
    setBusy(p.code);
    try {
      const out = await buyPlan({
        product_code: p.code,
        terms_version: status.terms_version,
        guardian_confirmed: guardian,
        // The context holds a placeholder name until the profile loads: never send it.
        prefill: student?.name && student.name !== EMPTY_STUDENT.name ? { name: student.name } : undefined,
      });
      if (out.kind === "paid") {
        toast.success(`${tierName(status, out.tier ?? p.tier)} is active until ${formatDate(out.ends_at)}.`);
        setPending(null);
        onChanged();
      } else if (out.kind === "pending") {
        setPending(out.razorpay_order_id);
        onChanged();
      } else if (out.kind === "cancelled") {
        toast("Payment not completed.");
      } else {
        toast.error(out.message);
        onChanged();
      }
    } finally {
      setBusy(null);
    }
  };

  const checkPending = async () => {
    if (!pending) return;
    setBusy("pending");
    try {
      const v = await verifyOrder({ razorpay_order_id: pending });
      if (v.status === "paid") {
        toast.success(`${tierName(status, v.tier ?? "")} is active until ${formatDate(v.ends_at)}.`);
        setPending(null);
        onChanged();
      } else {
        toast("Still confirming your payment. Please check again in a minute.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <SectionLabel>Buy a plan</SectionLabel>
      {pending && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm">
          <span>We&apos;ve received your payment and are confirming it with the bank. This usually takes under a minute.</span>
          <button onClick={() => void checkPending()} disabled={busy !== null} className="shrink-0 font-semibold text-primary">
            Check again
          </button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {status.products.map((p) => {
          const current = status.tier;
          const lower = rankOf[p.tier] < rankOf[current];
          const same = p.tier === current;
          const label = lower
            ? `You have ${tierName(status, current)} until ${formatDate(status.tier_until)}`
            : same
              ? `Add ${p.validity_days} days`
              : current === "free"
                ? `Buy ${tierName(status, p.tier)}`
                : `Upgrade to ${tierName(status, p.tier)}`;
          return (
            <GlassCard key={p.code} className="flex flex-col p-5">
              <div className="font-bold text-foreground">{tierName(status, p.tier)}</div>
              <div className="mt-1 text-2xl font-black text-foreground">{formatRupees(p.amount_paise)}</div>
              <div className="text-xs text-muted-foreground">
                for {p.validity_days} days · GST included · one-time payment
              </div>
              {!lower && !same && current !== "free" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Starts now. The unused days of your current plan are added to it.
                </p>
              )}
              {same && <p className="mt-2 text-xs text-muted-foreground">Starts when your current days end.</p>}
              <button
                type="button"
                disabled={lower || !ready || busy !== null}
                onClick={() => void buy(p)}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === p.code && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {label}
              </button>
            </GlassCard>
          );
        })}
      </div>
      <div className="mt-4 space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
          <span>
            I have read and accept the <Link to="/terms" target="_blank" className="font-semibold text-primary">Terms of Use</Link> and
            the <Link to="/refund-policy" target="_blank" className="font-semibold text-primary">Refund and Cancellation Policy</Link>.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={guardian} onChange={(e) => setGuardian(e.target.checked)} />
          <span>I am 18 or older, or my parent or guardian is making or approving this payment.</span>
        </label>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Payments are processed securely by Razorpay. We never see your card or UPI details.
        </p>
      </div>
    </section>
  );
}

function Receipts({ orders, onChanged }: { orders: PremiumOrder[] | null; onChanged: () => void }) {
  const [checking, setChecking] = useState<string | null>(null);
  if (!orders || orders.length === 0) return null;

  const check = async (o: PremiumOrder) => {
    if (!o.razorpay_order_id) return;
    setChecking(o.order_id);
    try {
      const v = await verifyOrder({ razorpay_order_id: o.razorpay_order_id });
      if (v.status === "paid") {
        toast.success("Payment confirmed. Your plan is active.");
        onChanged();
      } else if (v.status === "pending") {
        toast("Still confirming this payment. Please check again in a minute.");
      } else {
        toast("No completed payment was found for this order.");
      }
    } finally {
      setChecking(null);
    }
  };

  return (
    <section>
      <SectionLabel>Receipts</SectionLabel>
      <GlassCard className="divide-y divide-border/60">
        {orders.map((o) => (
          <div key={o.order_id} className="flex items-start gap-3 px-5 py-3 text-sm">
            <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-foreground">{formatRupees(o.amount_paise)} · {o.validity_days} days</span>
                <span className={cn(
                  "text-xs font-semibold",
                  o.status === "paid" ? "text-success" : o.status === "refunded" ? "text-muted-foreground" : "text-warning",
                )}>
                  {o.status === "paid" ? "Paid" : o.status === "refunded" ? "Refunded" : "Not completed"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDate(o.paid_at ?? o.created_at)}
                {o.starts_at && o.ends_at ? ` · plan ${formatDate(o.starts_at)} – ${formatDate(o.ends_at)}` : ""}
                {o.refunded_paise > 0 && o.status !== "refunded" ? ` · ${formatRupees(o.refunded_paise)} refunded` : ""}
              </div>
              <div className="text-[11px] text-muted-foreground/80">Order {o.order_id}{o.razorpay_payment_id ? ` · Payment ${o.razorpay_payment_id}` : ""}</div>
            </div>
            {o.status === "created" && o.razorpay_order_id && (
              <button
                type="button"
                onClick={() => void check(o)}
                disabled={checking !== null}
                className="shrink-0 text-xs font-semibold text-primary"
              >
                {checking === o.order_id ? "Checking…" : "Check payment"}
              </button>
            )}
          </div>
        ))}
      </GlassCard>
    </section>
  );
}
