/**
 * Razorpay Checkout, shared by the Wallet and the run screen (ADR 0027, R-57).
 *
 * Documented surface:
 * https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/
 *
 * The script only loads where the CSP allows it (`proxy.ts`), so importing this module
 * somewhere else will fail at runtime rather than quietly widening the payment surface.
 */

export interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface RazorpayInstance {
  open(): void;
  on(
    event: "payment.failed",
    handler: (response: { error: { description?: string } }) => void,
  ): void;
}

export type RazorpayConstructor = new (options: {
  key: string;
  amount: string;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayResponse) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}) => RazorpayInstance;

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export function loadCheckout(): Promise<RazorpayConstructor> {
  const existing = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => {
      const loaded = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
      if (loaded) resolve(loaded);
      else reject(new Error("Checkout did not load"));
    };
    script.onerror = () => {
      reject(new Error("Checkout did not load"));
    };
    document.body.appendChild(script);
  });
}
