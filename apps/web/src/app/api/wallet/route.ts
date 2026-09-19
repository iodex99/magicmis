import { walletView } from "@/lib/billing";
import { ok, withAccount } from "@/lib/http";
import { visitorCurrency } from "@/lib/server/visitor-currency";

/** GET /api/wallet — balances, lots, packs with GST, purchases, invoices, ledger. */
export async function GET(): Promise<Response> {
  return withAccount(async (account) =>
    ok(await walletView(account.accountId, await visitorCurrency())),
  );
}
