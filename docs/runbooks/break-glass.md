# Runbook: break-glass access to customer data

**Applies to:** the admin console `/accounts/:id` → Break-glass (SPEC §26, ADR 0024).

**Audience:** admins handling support requests.

Customer financial data is not visible to admins by default. Break-glass is the only way to see an account's decrypted company memory.

A grant:
- is time-limited;
- carries a written reason;
- is recorded in the audit log;
- is emailed to the account holder.

## When it is allowed

- The account holder asked for help that needs their data, such as "my mapping looks wrong", and the request is in the support ticket.
- A security investigation that requires it, under [breach-response.md](breach-response.md).

Never use it out of curiosity, for analytics or product research, or to "check" a customer without a ticket.

## Steps

1. **Open the account.** Go to `/accounts/<id>` and find **Break-glass access**.
2. **Write the reason.** At least 20 characters. Include the ticket reference, e.g. "Ticket 1234: customer asked why Rent maps to Other expenses."
3. **Choose a duration.** The default is 15 minutes; the maximum is `admin.break_glass_max_minutes` (config, default 60). Pick the shortest that will do.
4. **Grant.** This:
   - writes `admin.break_glass_granted` to the audit log;
   - queues a `security.break_glass` email to the account holder, with the reason and expiry.
5. **View.** Open a company under the grant. Every page view writes `admin.break_glass_viewed`.
6. **Revoke.** Revoke as soon as you are done; don't wait for expiry. This writes `admin.break_glass_revoked`.
7. **Note it on the ticket.** Record what you looked at and what you told the customer.

## Review

Weekly, the product owner reviews `/audit` for all `admin.break_glass_*` entries. Any grant without a matching ticket is treated as an incident.

## Limits by design

- Only company memory (metrics, template, periods) is shown.
  - Raw files were never on the server.
  - Party and employee names appear as tokens unless the company stores names encrypted.
- Admins cannot act as the customer, run jobs, or spend credits under a grant.
