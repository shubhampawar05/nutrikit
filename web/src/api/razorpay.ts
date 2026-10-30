// Razorpay Checkout (https://checkout.razorpay.com/v1/checkout.js), loaded only when a payment starts.
import type { RazorpayPaymentResponse } from './client.ts';

export interface CheckoutOptions {
  key: string;
  order_id: string;
  amount?: number;
  currency?: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string };
  theme?: { color?: string };
  handler: (response: RazorpayPaymentResponse) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayCheckout { open(): void; on(event: 'payment.failed', cb: (e: { error?: { description?: string } }) => void): void }
type RazorpayConstructor = new (options: CheckoutOptions) => RazorpayCheckout;

declare global {
  interface Window { Razorpay?: RazorpayConstructor }
}

const SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loading: Promise<RazorpayConstructor> | null = null;

export function loadRazorpay(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SRC;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay Checkout did not load')));
    script.onerror = () => { loading = null; reject(new Error('Could not load Razorpay Checkout; check your connection and try again')); };
    document.head.append(script);
  });
  return loading;
}

/**
 * Opens Checkout and settles with the signed payment response, or null if the buyer closed it.
 * A failed attempt keeps Checkout open so the buyer can retry; `onFailed` reports it meanwhile.
 */
export async function payWithRazorpay(
  options: Omit<CheckoutOptions, 'handler' | 'modal'>,
  onFailed?: (message: string) => void,
): Promise<RazorpayPaymentResponse | null> {
  const Razorpay = await loadRazorpay();
  return new Promise((resolve) => {
    const checkout = new Razorpay({
      ...options,
      handler: (response) => resolve(response),
      modal: { ondismiss: () => resolve(null) },
    });
    checkout.on('payment.failed', (e) => onFailed?.(e.error?.description || 'The payment failed'));
    checkout.open();
  });
}
