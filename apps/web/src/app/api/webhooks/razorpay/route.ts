import { handleRazorpayWebhook } from "@magicmis/billing";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";

/**
 * POST /api/webhooks/razorpay (SPEC §13).
 *
 * The body is read as raw text and verified before it is parsed: re-serialised JSON would
 * not match the signature (https://razorpay.com/docs/webhooks/validate-test/). Processed
 * and duplicate events both return 200 so Razorpay stops retrying; a thrown error returns
 * 500 and the event is retried, which is safe because nothing was recorded.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000)
    return new Response("payload too large", { status: 413 });

  const result = await handleRazorpayWebhook(db(), {
    rawBody,
    signature: request.headers.get("x-razorpay-signature") ?? "",
    eventId: request.headers.get("x-razorpay-event-id") ?? "",
    secret: serverEnv().RAZORPAY_WEBHOOK_SECRET,
  });

  switch (result.status) {
    case "invalid_signature":
      return new Response("invalid signature", { status: 401 });
    case "malformed":
      return new Response("malformed", { status: 400 });
    case "duplicate":
    case "processed":
      return Response.json({ received: true }, { status: 200 });
  }
}
