import { afterEach, describe, expect, it, vi } from 'vitest';
import { payWithRazorpay } from './razorpay.ts';

const scripts = () => [...document.head.querySelectorAll<HTMLScriptElement>('script[src*="checkout.razorpay.com"]')];
const options = { key: 'rzp_test', order_id: 'order_1', name: 'Nutrikit', description: 'Starter' };

afterEach(() => {
  vi.unstubAllGlobals();
  for (const s of scripts()) s.remove();
});

describe('payWithRazorpay', () => {
  it('loads Checkout again after a script that loaded without defining Razorpay', async () => {
    const first = payWithRazorpay(options);
    expect(scripts()).toHaveLength(1);
    scripts()[0]!.onload?.(new Event('load'));
    await expect(first).rejects.toThrow('Razorpay Checkout did not load');

    // The next attempt starts a fresh load instead of reusing the failed one.
    const second = payWithRazorpay(options);
    expect(scripts()).toHaveLength(1);
    vi.stubGlobal('Razorpay', class {
      constructor(private o: { modal?: { ondismiss?: () => void } }) {}
      on() {}
      open() { this.o.modal?.ondismiss?.(); }
    });
    scripts()[0]!.onload?.(new Event('load'));
    await expect(second).resolves.toBeNull();
  });
});
