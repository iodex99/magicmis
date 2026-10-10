import { signupRequestSchema } from "@magicmis/accounts";
import { z } from "zod";

/**
 * The business name, with messages written for a person (ADR 0091). The account package checks
 * its length in Zod's own words — "Too small: expected string to have >=2 characters" — and the
 * sign-up and finish forms showed that under the field as it came. These run first; the package's
 * own check, that the name can be printed on an invoice, still runs after them.
 */
export const businessNameField = z
  .string("Enter your business name.")
  .trim()
  .min(2, "Enter your business name: at least 2 characters.")
  .max(200, "Keep the business name to 200 characters.")
  .pipe(signupRequestSchema.shape.businessName);

/** What sign-up accepts: the package's schema with the business name above. */
export const signupBodySchema = signupRequestSchema.extend({
  businessName: businessNameField,
});
