"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CompanyLogoSettings } from "@/components/CompanyLogo";
import { Alert, Panel } from "@/components/ui";
import { api } from "@/lib/client-api";
import type { LogoLimits } from "@/lib/logo";

/**
 * Your mark on what you prepare (ADR 0087): your business name and logo beside each company's, in
 * Present and on the workbook's cover. Off until turned on, because an owner presenting their own
 * business is not its preparer; an accountant, a bookkeeper or a finance team presenting a
 * client's usually wants to be named.
 */
export function BrandSettings({
  name,
  on: initialOn,
  logo,
  limits,
}: {
  name: string;
  on: boolean;
  logo: string | null;
  limits: LogoLimits;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initialOn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel
      title="Your name on what you prepare"
      description="Shown beside each company's own name and logo when you present its board, and on the cover of its workbooks."
    >
      <div className="flex flex-col gap-4" data-testid="brand-settings">
        {error === null ? null : <Alert tone="error">{error}</Alert>}
        <label className="flex items-start gap-3 text-sm text-neutral-800">
          <input
            id="brand-on"
            type="checkbox"
            className="mt-0.5 size-4 accent-accent-600"
            checked={on}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.checked;
              // The box moves when it is clicked and goes back if the save fails: waiting for
              // the server left a click that seemed to do nothing.
              setOn(next);
              setBusy(true);
              setError(null);
              void api<{ on: boolean }>("/api/account/brand", {
                method: "PATCH",
                body: { on: next },
              }).then((r) => {
                setBusy(false);
                if (!r.ok) {
                  setOn(!next);
                  setError(r.message);
                  return;
                }
                setOn(r.data.on);
                router.refresh();
              });
            }}
          />
          <span>
            Show <strong className="font-semibold">{name}</strong> as the preparer
            <span className="mt-0.5 block text-[0.8125rem] text-neutral-500">
              For accountants, bookkeepers and finance teams presenting a company&rsquo;s
              figures to its owners or board. Leave it off if you present your own
              business.
            </span>
          </span>
        </label>
        <CompanyLogoSettings
          companyId=""
          name={name}
          current={logo}
          limits={limits}
          endpoint="/api/account/brand/logo"
          saved="Logo saved. It appears beside your name when you are shown as the preparer."
        />
      </div>
    </Panel>
  );
}
