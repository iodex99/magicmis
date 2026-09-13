# Runbook: break-glass access to customer data

**Applies to:** the admin console `/accounts/:id` → Break-glass (SPEC §26, ADR 0024, ADR 0025).

**Audience:** admins handling support requests.

Customer financial data is not visible to admins by default. Break-glass is the only way to see an account's decrypted company memory.

A grant:
- covers **one company**;
- needs a written reason and a **current authenticator code** from the requesting admin;
- with `admin.break_glass_second_admin` on, waits for a **different admin** to approve it with their own code;
- is time-limited, and its clock starts when access starts;
- is recorded in the audit log;
- is emailed to the account holder when access starts, and again on each day it is used.

## When it is allowed

- The account holder asked for help that needs their data, such as "my mapping looks wrong", and the request is in the support ticket.
- A security investigation that requires it, under [breach-response.md](breach-response.md).

Never use it out of curiosity, for analytics or product research, or to "check" a customer without a ticket.

## Steps

1. **Open the account.** Go to `/accounts/<id>` and find **Break-glass access**.
2. **Choose the company** the ticket is about. A grant never opens the account's other companies.
3. **Write the reason.** 20 to 500 characters. Include the ticket reference, e.g. "Ticket 1234: customer asked why Rent maps to Other expenses."
4. **Choose a duration.** The default is 15 minutes; the maximum is `admin.break_glass_max_minutes` (config, default 60). Pick the shortest that will do.
5. **Enter your authenticator code and grant.** Each code works once.
   - Single-admin mode: access starts now. The audit log gets `admin.break_glass_granted` and the account holder is emailed (`security.break_glass`).
   - Two-admin mode: the request is recorded (`admin.break_glass_requested`) and shown as awaiting approval. Nothing is viewable and nobody is emailed yet.
6. **Approval (two-admin mode).** Another admin opens the same account, checks the reason against the ticket, and approves with their own code. This writes `admin.break_glass_approved`, starts the clock, and emails the account holder. Nobody can approve their own request.
7. **View.** Open the company under the grant. Every page view writes `admin.break_glass_viewed`; the account holder gets one `security.break_glass_viewed` email per grant per day.
8. **Revoke.** Revoke (or withdraw a pending request) as soon as you are done; don't wait for expiry. This writes `admin.break_glass_revoked`.
9. **Note it on the ticket.** Record what you looked at and what you told the customer.

## Turning on two-admin approval

Once there are at least two active admins, publish `admin.break_glass_second_admin` = `true` in `/config`. The change is versioned and audit-logged like any config change.

## Review

Weekly, the product owner reviews `/audit` for all `admin.break_glass_*` entries. Any grant without a matching ticket is treated as an incident.

## Limits by design

- Only company memory (metrics, template, periods) is shown.
  - Raw files were never on the server.
  - Party and employee names appear as tokens unless the company stores names encrypted.
- Admins cannot act as the customer, run jobs, or spend credits under a grant.
