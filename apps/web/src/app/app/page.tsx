import { AppFrame } from "@/components/AppFrame";
import { Panel } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";

export const metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

export default async function AppHomePage() {
  const account = await accountOrRedirect("/app");
  return (
    <AppFrame businessName={account.businessName}>
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Companies</h1>
      <Panel>
        <p className="text-sm text-neutral-700" data-testid="app-home">
          No companies yet. You will be able to add a company once your wallet has
          credits.
        </p>
      </Panel>
    </AppFrame>
  );
}
