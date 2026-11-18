// The team's plan, and moving up: paid plans through Razorpay Checkout when billing is on, the rest as requests.
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, can, errorText, fmt, fmtDate, fmtPeriodDate, fmtPrice, sentence, type Me } from '../../api/client.ts';
import { payWithRazorpay } from '../../api/razorpay.ts';
import { PAYMENTS_VISIBLE } from '../../features.ts';
import { Select } from '../../components/Select.tsx';

/** After a payment the browser couldn't confirm, reload the account this long after (the webhook applies it). */
const VERIFY_RETRY_MS = [5_000, 30_000];

const UPGRADE_OPTIONS: [string, string][] = [
  ['starter', 'Starter — 100k tokens'],
  ['growth', 'Growth — 1M tokens'],
  ['enterprise', 'Enterprise — custom'],
];

/** Keyed by team on the dashboard, so nothing here (status, requests sent, an unconfirmed payment) carries over to another team. */
export function PlanCard({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const price = (p: string) => me.plans[p]?.price ?? null;
  // Paid plans are bought online (Razorpay, 30 days per payment) when the server has billing set up; the rest are requests.
  const payable = (p: string) => Boolean(me.billing.enabled && (price(p) ?? 0) > 0);
  const paidUntil = me.plan.expiresAt;
  // The same rank the server uses: the current plan can be extended (if it can be paid for) and a higher one chosen;
  // a cheaper one is never offered, whether or not the current plan has an end date.
  const selectable = (p: string) =>
    p === me.plan.id ? payable(p) : (me.plans[p]?.rank ?? Infinity) > me.plan.rank;
  const firstOpen = UPGRADE_OPTIONS.find(([v]) => v !== me.plan.id && selectable(v))?.[0]
    ?? UPGRADE_OPTIONS.find(([v]) => selectable(v))?.[0];
  const { register, handleSubmit, watch, resetField, setValue } = useForm<{ plan: string; message: string }>({
    defaultValues: { plan: firstOpen ?? 'starter', message: '' },
  });
  const plan = watch('plan');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const pending = useRef(false);
  // Upgrade requests sent during this visit, by plan: the form for that plan is replaced by "Request sent".
  const [sent, setSent] = useState<Record<string, { plan: string; sentAt: string }>>({});
  // A payment Checkout reported but the portal couldn't confirm: a notice that stays until the next attempt.
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);
  const request = useMutation({ mutationFn: (v: { plan: string; message: string }) => api.requestUpgrade(v.plan, v.message) });

  const buy = async (p: string) => {
    setUnconfirmed(null);
    const order = await api.createOrder(p);
    setStatus('Complete the payment in the Razorpay window…');
    const response = await payWithRazorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: 'Nutrikit',
      description: `${me.plans[p]?.name ?? p} plan — 30 days`,
      prefill: { name: me.user.name, email: me.user.email },
      theme: { color: '#e0462b' },
    }, (message) => setStatus(`${sentence(message)} You can try again in the Razorpay window.`));
    if (!response) {
      setStatus('Payment cancelled — you have not been charged.');
      return;
    }
    setStatus('Payment received — activating your plan…');
    const view = await api.verifyPayment(response).catch(() => null);
    // Switched team (or left the page) meanwhile: the reply describes the team that paid, so just reload the account.
    if (!mounted.current) {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      return;
    }
    if (!view) {
      // The webhook applies a charged payment the browser couldn't confirm; reload the plan shortly to pick it up.
      setStatus('');
      setUnconfirmed(response.razorpay_payment_id);
      timers.current.forEach(clearTimeout);
      timers.current = VERIFY_RETRY_MS.map((ms) => setTimeout(() => queryClient.invalidateQueries({ queryKey: ['me'] }), ms));
      return;
    }
    const { payment, ...account } = view;
    queryClient.setQueryData<Me>(['me'], (old) => (old ? { ...old, ...account } : old));
    if (payment && !payment.applied) {
      // Taken but not applied (the team already had a dearer plan, or this one with no end date): say so plainly.
      const why = (payment.note ?? '').replace(/^not applied:\s*/, '');
      setStatus(`Payment received, but your plan was not changed${why ? ` (${why})` : ''}. Contact us and we'll refund it.`);
      return;
    }
    setStatus(`You're on the ${view.plan.name} plan until ${fmtPeriodDate(view.plan.expiresAt)}.`);
  };

  const onSubmit = async (data: { plan: string; message: string }) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (payable(data.plan)) {
        await buy(data.plan);
        return;
      }
      await request.mutateAsync(data);
      setSent((s) => ({ ...s, [data.plan]: { plan: data.plan, sentAt: new Date().toISOString() } }));
      setStatus('');
      resetField('message');
    } catch (err) {
      setStatus(errorText(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const current = me.plan.price;
  const action = (p: string) => (p === me.plan.id ? 'Extend 30 days' : 'Pay');
  const planName = (p: string) => me.plans[p]?.name ?? UPGRADE_OPTIONS.find(([v]) => v === p)?.[1].split(' —')[0] ?? p;
  const sentFor = sent[plan];
  return (
    <section className="card" id="upgrade">
      <h2 style={{ margin: '0 0 12px' }}>Plan</h2>
      <p style={{ margin: 0 }}><b>{me.plan.name + (!PAYMENTS_VISIBLE ? '' : current ? ` — ${fmtPrice(current, me.plan.currency)} / 30 days` : current === 0 ? ` — ${fmtPrice(0, me.plan.currency)}` : '')}</b></p>
      {paidUntil ? <p className="small muted" style={{ margin: '4px 0 0' }}>Paid until {fmtPeriodDate(paidUntil)} · then the Free plan, unless you extend it.</p> : null}
      <ul className="muted small" style={{ paddingLeft: 18 }}>
        <li>{me.plan.monthlyTokens == null ? 'Custom monthly tokens' : `${fmt(me.plan.monthlyTokens)} tokens / month`}</li>
        <li>{fmt(me.plan.ratePerMinute)} requests / minute</li>
        <li>Up to {me.plan.maxKeys} live and {me.plan.maxKeys} test keys</li>
        <li>Up to {me.plan.maxMembers} people in the team</li>
      </ul>
      {unconfirmed ? (
        <div className="notice" role="alert" style={{ margin: '0 0 12px' }}>
          We couldn't confirm the payment yet. If you were charged, your plan will switch on within a few minutes.
          {' '}Payment id <code>{unconfirmed}</code>. If it hasn't switched on by then, contact support with this id.
        </div>
      ) : null}
      {!PAYMENTS_VISIBLE ? null : !can.manageTeam(me.team.role) ? (
        <p className="small muted" style={{ margin: 0 }}>Only a team owner can change the plan.</p>
      ) : firstOpen == null ? (
        <p className="small muted" style={{ margin: 0 }}>You're on our highest plan. To change it, contact us.</p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="field">
            <label htmlFor="upgrade-plan">{paidUntil ? 'Extend or move up' : 'Need more?'}</label>
            <Select
              id="upgrade-plan"
              value={plan}
              onChange={(v) => setValue('plan', v)}
              options={UPGRADE_OPTIONS.map(([value, label]) => ({ value, label, disabled: !selectable(value) }))}
            />
          </div>
          {sentFor ? (
            <p className="small" style={{ margin: '8px 0 0' }}>
              <b>Request sent</b> for the {planName(sentFor.plan)} plan on {fmtDate(sentFor.sentAt)}. We'll be in touch at {me.user.email}.
            </p>
          ) : (
            <>
              <div className="field" hidden={payable(plan)}>
                <label htmlFor="upgrade-msg">Tell us about your app (optional)</label>
                <textarea id="upgrade-msg" rows={2} maxLength={1000} {...register('message')} />
              </div>
              <button className="btn btn-ghost btn-sm" type="submit" disabled={busy || !selectable(plan)} aria-busy={busy || undefined}>
                {payable(plan) ? `${action(plan)} — ${fmtPrice(price(plan)!, me.plans[plan]?.currency)}` : 'Request upgrade'}
              </button>
              <p className="small muted" hidden={!payable(plan)} style={{ margin: '8px 0 0' }}>
                One-time payment for 30 days; no automatic renewal.
                {me.billing.mode === 'test' ? <> Test mode: use one of Razorpay's{' '}
                  <a href="https://razorpay.com/docs/payments/payments/test-card-details/" target="_blank" rel="noreferrer">test cards or UPI ids</a>.</> : null}
              </p>
            </>
          )}
          <p className="small muted" style={{ margin: '8px 0 0' }}>{status}</p>
        </form>
      )}
    </section>
  );
}
