/**
 * Outbound email behind an interface (ADR 0010). Tests use a recording fake; production
 * uses Resend, whose SDK reports failure in `{ data, error }` rather than by throwing.
 * Verified against resend@6.28.0's type declarations: `emails.send(payload, { idempotencyKey })`.
 */

import { Resend } from "resend";

export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly idempotencyKey: string;
  readonly attachments?: readonly { filename: string; content: Buffer }[];
}

export type SendResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: string };

export interface MailSender {
  send(email: OutboundEmail): Promise<SendResult>;
}

export class ResendMailSender implements MailSender {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(email: OutboundEmail): Promise<SendResult> {
    const { data, error } = await this.client.emails.send(
      {
        from: this.from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.attachments === undefined
          ? {}
          : {
              attachments: email.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
              })),
            }),
      },
      { idempotencyKey: email.idempotencyKey },
    );
    if (error !== null) return { ok: false, error: `${error.name}: ${error.message}` };
    return { ok: true, id: data.id };
  }
}
