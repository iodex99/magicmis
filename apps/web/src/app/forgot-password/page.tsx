import { OpeningSoon } from "@/components/OpeningSoon";
import { prelaunch } from "@/lib/server/prelaunch";

import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata = { title: "Reset your password" };
// Whether accounts are open is read at request time (ADR 0078).
export const dynamic = "force-dynamic";

/**
 * Before launch there is no account to reset, so the page says what sign-in says rather than
 * offering a form whose answer is "not open yet" (ADR 0091).
 */
export default function ForgotPasswordPage() {
  if (prelaunch()) return <OpeningSoon />;
  return <ForgotPasswordForm />;
}
