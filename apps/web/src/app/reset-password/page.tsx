import { OpeningSoon } from "@/components/OpeningSoon";
import { prelaunch } from "@/lib/server/prelaunch";

import { ResetPasswordScreen } from "./ResetPasswordForm";

export const metadata = { title: "Set a new password" };
// Whether accounts are open is read at request time (ADR 0078).
export const dynamic = "force-dynamic";

/**
 * Before launch no reset can be spent, so the page says what sign-in says rather than offering
 * a form whose answer is "not open yet" (ADR 0091).
 */
export default function ResetPasswordPage() {
  if (prelaunch()) return <OpeningSoon />;
  return <ResetPasswordScreen />;
}
