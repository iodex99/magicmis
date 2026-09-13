import { loadInvoice, renderInvoicePdf } from "@magicmis/billing";
import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, withAccount } from "@/lib/http";

/** GET /api/invoices/:id/pdf — rendered on demand from the immutable invoice row. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      return apiError(404, "invoice_not_found", "Invoice not found.");
    const invoice = await loadInvoice(db(), {
      invoiceId: id,
      accountId: account.accountId,
    });
    if (invoice === null) return apiError(404, "invoice_not_found", "Invoice not found.");

    const pdf = await renderInvoicePdf(invoice);
    const filename = `${invoice.number.replaceAll("/", "-")}.pdf`;
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
