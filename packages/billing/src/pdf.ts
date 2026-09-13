/**
 * Invoice PDF (SPEC §13), rendered from the immutable invoice row alone.
 *
 * pdf-lib (ADR 0013): pure JS, bundled types, no native build. Metadata dates are pinned
 * to the issue time and no producer string is written, so the same invoice renders the
 * same bytes every time — the PDF is regenerated on download rather than stored.
 *
 * The standard Helvetica font covers WinAnsi only; characters outside it are replaced.
 * TODO(review): R-06 — invoice template wording pending CA review; a Unicode font for
 * non-Latin business names is a follow-up.
 */

import { paise } from "@magicmis/core/money";
import { formatPaise } from "@magicmis/core/format";
import { formatIstDate } from "@magicmis/core/time";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { InvoiceRecord } from "./invoice";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.4, 0.4, 0.44);
const RULE = rgb(0.8, 0.8, 0.82);

/** Keep printable WinAnsi-safe ASCII and Latin-1; replace everything else. */
export function winAnsiSafe(text: string): string {
  return Array.from(text, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? ch : "?";
  }).join("");
}

const rupees = (p: string): string =>
  `INR ${formatPaise(paise(BigInt(p)), { style: "lakhs_crores", decimals: 2 })}`;

class Writer {
  y = A4[1] - MARGIN;
  constructor(
    readonly page: PDFPage,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {}

  text(
    value: string,
    opts: {
      x?: number;
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
    } = {},
  ): void {
    this.page.drawText(winAnsiSafe(value), {
      x: opts.x ?? MARGIN,
      y: this.y,
      size: opts.size ?? 10,
      font: opts.bold === true ? this.bold : this.regular,
      color: opts.color ?? INK,
    });
  }

  right(value: string, opts: { size?: number; bold?: boolean } = {}): void {
    const size = opts.size ?? 10;
    const font = opts.bold === true ? this.bold : this.regular;
    const safe = winAnsiSafe(value);
    this.page.drawText(safe, {
      x: A4[0] - MARGIN - font.widthOfTextAtSize(safe, size),
      y: this.y,
      size,
      font,
      color: INK,
    });
  }

  line(
    value: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {},
  ): void {
    this.text(value, opts);
    this.down((opts.size ?? 10) + 4);
  }

  down(by: number): void {
    this.y -= by;
  }

  rule(): void {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4[0] - MARGIN, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
    this.down(14);
  }
}

export async function renderInvoicePdf(invoice: InvoiceRecord): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const title = invoice.type === "tax_invoice" ? "Tax Invoice" : "Proforma Invoice";
  doc.setTitle(`${title} ${invoice.number}`);
  doc.setCreationDate(invoice.issuedAt);
  doc.setModificationDate(invoice.issuedAt);

  const page = doc.addPage(A4);
  const w = new Writer(
    page,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
  );
  const t = invoice.totals;

  w.text(title.toUpperCase(), { size: 18, bold: true });
  w.down(28);

  // Seller (Rule 46(a))
  w.line(invoice.seller.legal_name, { size: 11, bold: true });
  for (const l of invoice.seller.address) w.line(l, { color: MUTED });
  w.line(`GSTIN: ${invoice.seller.gstin === "" ? "-" : invoice.seller.gstin}`);
  w.down(6);
  w.rule();

  // Number and date (Rule 46(b), (c))
  w.text(
    `${invoice.type === "tax_invoice" ? "Invoice" : "Proforma"} No: ${invoice.number}`,
    { bold: true },
  );
  w.right(`Date: ${formatIstDate(invoice.issuedAt)}`);
  w.down(14);
  w.line(`Financial year: ${invoice.financialYear}`, { color: MUTED });
  if (t.valid_until !== null)
    w.line(`Valid until: ${formatIstDate(new Date(t.valid_until))}`, { color: MUTED });
  w.down(6);
  w.rule();

  // Buyer and place of supply (Rule 46(d), (e), (n))
  w.line("Bill to", { bold: true });
  w.line(invoice.buyer.name);
  for (const l of invoice.buyer.address) w.line(l, { color: MUTED });
  w.line(`GSTIN: ${invoice.buyer.gstin ?? "Unregistered"}`);
  w.line(`State: ${invoice.buyer.state_name} (${invoice.buyer.state_code})`);
  w.line(
    `Place of supply: ${invoice.placeOfSupplyStateName} (${invoice.placeOfSupplyStateCode})`,
  );
  w.down(6);
  w.rule();

  // Lines (Rule 46(g)-(j))
  w.text("Description", { bold: true });
  w.text("SAC", { x: 390, bold: true });
  w.right("Taxable value", { bold: true });
  w.down(16);
  for (const item of invoice.lineItems) {
    w.text(item.description);
    w.text(item.sac, { x: 390 });
    w.right(rupees(item.taxable_paise));
    w.down(16);
  }
  w.rule();

  const row = (label: string, value: string, bold = false): void => {
    w.text(label, { x: 300, bold });
    w.right(value, { bold });
    w.down(16);
  };
  row("Taxable value", rupees(t.taxable_paise));
  if (t.supply === "intra_state") {
    row(`CGST @ ${t.cgst_rate_percent ?? ""}%`, rupees(t.cgst_paise));
    row(`SGST @ ${t.sgst_rate_percent ?? ""}%`, rupees(t.sgst_paise));
  } else {
    row(`IGST @ ${t.igst_rate_percent ?? ""}%`, rupees(t.igst_paise));
  }
  row("Total", rupees(t.total_paise), true);
  w.down(4);
  w.line(t.total_in_words, { bold: true });
  w.down(10);

  if (t.bank_details !== null) {
    w.rule();
    w.line("Bank transfer details", { bold: true });
    for (const [k, v] of Object.entries(t.bank_details))
      w.line(`${k.replace(/_/gu, " ")}: ${v === "" ? "-" : v}`);
    w.line(`Quote the proforma number ${invoice.number} as the transfer reference.`, {
      color: MUTED,
    });
    w.line(
      "This proforma is not a tax invoice. A tax invoice is issued when payment is received.",
      { color: MUTED },
    );
  }

  w.y = MARGIN + 20;
  w.line("Prepaid service credits are non-refundable and non-transferable.", {
    size: 8,
    color: MUTED,
  });
  w.line("Electronically generated invoice; signature not required.", {
    size: 8,
    color: MUTED,
  });

  return doc.save({ useObjectStreams: false });
}
