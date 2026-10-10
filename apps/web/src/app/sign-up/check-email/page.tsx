import { AuthShell } from "@/components/ui";

import { ResendEmail } from "./ResendEmail";

export const metadata = { title: "Check your email" };

/**
 * After sign-up. The description promises only what holds (ADR 0071, ADR 0091): the link signs
 * in the browser that signed up, and elsewhere it confirms the address and asks for the password
 * again — the body says which.
 */
export default function CheckEmailPage() {
  return (
    <AuthShell
      moment="confirm"
      title="Check your email"
      description="We sent a link to confirm your address. Open it in this browser and it signs you in. The link lasts an hour."
    >
      <div className="flex flex-col gap-3 text-sm text-neutral-600">
        <ResendEmail />
      </div>
    </AuthShell>
  );
}
