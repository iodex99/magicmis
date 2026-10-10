import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";
import { brandLogoUrl, readBrand } from "@/lib/server/brand";
import { logoLimits } from "@/lib/server/logo";
import { visitorCountry } from "@/lib/server/visitor-currency";

import { BrandSettings } from "./BrandSettings";
import { ProfileForm } from "./ProfileForm";

export const metadata = { title: "Business profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const account = await accountOrRedirect("/settings/profile");
  const pool = db();
  const [brand, limits, country] = await Promise.all([
    readBrand(pool, account.accountId),
    logoLimits(pool),
    visitorCountry(),
  ]);
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        title="Business profile"
        description="Your business's name and billing details, and how you appear on what you prepare."
      />
      <div className="flex flex-col gap-6">
        <ProfileForm visitorCountry={country} />
        <BrandSettings
          name={brand?.name ?? account.businessName}
          on={brand?.on ?? false}
          logo={brandLogoUrl(brand?.logoVersion ?? null)}
          limits={limits}
        />
      </div>
    </AppFrame>
  );
}
