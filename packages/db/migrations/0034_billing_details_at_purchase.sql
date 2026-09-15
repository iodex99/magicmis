-- Billing details move from sign-up to the first purchase.
--
-- GST place of supply (SPEC §13) is needed to quote and invoice a credit purchase, and at
-- no other moment. Demanding a full postal address before a new account has seen a single
-- screen cost us eleven fields on the sign-up form; the address is now collected inline at
-- the first purchase, where the customer is already thinking about invoices.
--
-- `state_code` therefore becomes nullable. `billing_address` already defaulted to '{}',
-- so an account with neither is representable. Every billing path refuses clearly when the
-- state is still unknown and asks for it (packages/billing/src/purchases.ts).

alter table public.accounts alter column state_code drop not null;

-- The shape check still applies whenever a state IS set.
alter table public.accounts drop constraint accounts_state_code_shape;
alter table public.accounts add constraint accounts_state_code_shape
  check (state_code is null or state_code ~ '^[0-9]{2}$');
