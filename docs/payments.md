# Payments (Razorpay)

With `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` set, developers can buy Starter or Growth from their dashboard,
paying in INR by card, UPI or any method your Razorpay account allows.

## How plans are bought

- Each payment is **one-time** and unlocks the plan for **30 days**. Nothing renews automatically.
- Paying again for the same plan adds 30 days. Paying for Growth upgrades with a fresh 30 days.
- A cheaper plan can be bought once the current period ends.
- When the period ends, the account is simply Free again. No scheduled job is needed.
- Enterprise, and servers without Razorpay keys, use upgrade requests instead. Plans set by an admin never expire.

## How a payment is confirmed

```
 Dashboard ─► Razorpay Checkout ─► signed response ─► server verifies signature ─► plan applied
                                        (backup) Razorpay webhook order.paid ──┘
```

The server checks the signature and that the order belongs to the account, then records the payment in the
`payments` table. Each payment is applied exactly once, whichever path arrives first.

## Try it in test mode (no real money)

1. At [dashboard.razorpay.com](https://dashboard.razorpay.com), switch to **Test Mode** and generate a key under
   *Account & Settings → API Keys*.
2. Put `RAZORPAY_KEY_ID=rzp_test_…` and `RAZORPAY_KEY_SECRET=…` in `.env` and restart the API.
3. Pick a plan on the dashboard and pay with a
   [test card or UPI id](https://razorpay.com/docs/payments/payments/test-card-details/).

No webhook is needed for testing.

## Go live

1. Switch to `rzp_live_…` keys.
2. In Razorpay, add a webhook at `https://<your domain>/webhooks/razorpay` for the `order.paid` event.
3. Put its secret in `RAZORPAY_WEBHOOK_SECRET`.

The webhook catches payments whose browser confirmation never arrived (a closed tab, a lost connection).
Without the secret, the webhook endpoint answers `501`.
