/**
 * Text that a tax invoice can actually print (SPEC §13, Rule 46; R-25).
 *
 * Invoice PDFs are drawn with the standard Helvetica face, which covers WinAnsi only. Any
 * character outside it is replaced with `?` when the page is drawn — silently, and on a
 * legal document that must carry the recipient's name and address correctly.
 *
 * A Unicode font would be the other answer, and was considered: it means embedding a
 * multi-megabyte face for a case the GST system does not produce, since the legal name
 * behind a GSTIN is registered in Latin script. The cheaper and more honest fix is to
 * refuse the input at the field where someone can still correct it, rather than to accept
 * it and mangle it months later on an invoice nobody re-reads.
 *
 * WinAnsi is wider than ASCII: `₹`, `é`, `&`, `—` and the rest of Latin-1 all pass. What
 * does not is a script the font has no glyphs for at all.
 */

/**
 * One character the invoice font can draw: printable ASCII, or printable Latin-1.
 *
 * Deliberately the same two ranges as `winAnsiSafe` in `@magicmis/billing`, spelled the
 * same way. A property test asserts the two agree on every input, because a guard that is
 * looser than the renderer lets a `?` reach an invoice, and one that is stricter refuses a
 * name that would have printed perfectly well.
 */
function renderable(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff);
}

export function isInvoiceable(text: string): boolean {
  return Array.from(text).every(renderable);
}

/** The characters that would be replaced, de-duplicated and in the order they appear. */
export function unrenderable(text: string): string[] {
  return [...new Set(Array.from(text).filter((ch) => !renderable(ch)))];
}

/**
 * The message shown against the offending field. It names the characters rather than the
 * rule, because "remove ₹" is actionable and "WinAnsi" is not.
 */
export function invoiceableMessage(text: string): string {
  const bad = unrenderable(text);
  return bad.length === 0
    ? ""
    : `Tax invoices are printed in Latin script, so ${bad.join(" ")} cannot be used here. Please use the name as registered for GST.`;
}
