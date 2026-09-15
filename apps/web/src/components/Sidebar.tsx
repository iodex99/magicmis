"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PRODUCT_NAME } from "@/lib/brand";

import { Icon, type IconName } from "./Icon";
import { Avatar, BrandMark } from "./ui";

/**
 * Primary navigation (SPEC §32).
 *
 * The dark surface is the one place the app goes dark: it frames the working area and
 * holds no figures, so the reading-accuracy cost of a dark ground is not paid where it
 * would matter. The current page is marked by a filled pill *and* `aria-current`, so the
 * state is never carried by colour alone.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  /** Also mark this item current for descendant paths. */
  readonly match?: string;
}

const PRIMARY: readonly NavItem[] = [
  { href: "/app", label: "Companies", icon: "building", match: "/app/companies" },
  { href: "/app/data", label: "Source files", icon: "file" },
  { href: "/wallet", label: "Wallet", icon: "wallet" },
];

const SETTINGS: readonly NavItem[] = [
  { href: "/settings/profile", label: "Profile", icon: "user" },
  { href: "/settings/security", label: "Security", icon: "shield" },
  { href: "/settings/privacy", label: "Privacy and data", icon: "lock" },
];

function workspaceItems(id: string): readonly NavItem[] {
  return [
    { href: `/app/companies/${id}`, label: "Overview", icon: "table" },
    { href: `/app/companies/${id}/run`, label: "Run", icon: "play" },
    { href: `/app/companies/${id}/dashboard`, label: "Dashboard", icon: "chart" },
    { href: `/app/companies/${id}/commentary`, label: "Commentary", icon: "document" },
    { href: `/app/companies/${id}/chat`, label: "Chat", icon: "chat" },
  ];
}

function isCurrent(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true;
  if (item.match !== undefined && pathname.startsWith(item.match)) return true;
  return false;
}

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[0.8125rem] font-medium transition-colors ${
        current
          ? "bg-accent-600 text-white"
          : "text-neutral-300 hover:bg-ink-700 hover:text-white"
      }`}
    >
      <Icon name={item.icon} size={16} />
      {item.label}
    </Link>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-3 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-neutral-500 uppercase">
        {label}
      </p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

export function Sidebar({
  businessName,
  availableCredits,
  company,
  onSignOut,
}: {
  businessName: string;
  /** Pre-formatted with Indian grouping; the wallet page is the authority on the figure. */
  availableCredits: string;
  company?: { id: string; name: string };
  onSignOut: React.ReactNode;
}) {
  const pathname = usePathname();
  // A company page is a workspace even before its name has been passed in.
  const companyId = company?.id ?? pathname.split("/")[3];
  const workspace =
    pathname.startsWith("/app/companies/") && companyId !== undefined ? companyId : null;

  return (
    <aside className="on-ink sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-ink-900 px-3 py-4">
      <Link href="/app" className="mb-6 flex items-center gap-2.5 px-2">
        <BrandMark size={30} />
        <span className="text-[0.9375rem] font-semibold tracking-tight text-white">
          {PRODUCT_NAME}
        </span>
      </Link>

      <nav aria-label="Main" className="flex flex-col gap-5 overflow-y-auto">
        <div className="flex flex-col gap-0.5">
          {PRIMARY.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              current={isCurrent(pathname, item) && workspace === null}
            />
          ))}
        </div>

        {workspace === null ? null : (
          <Group label={company?.name ?? "Company"}>
            {workspaceItems(workspace).map((item) => (
              <NavLink key={item.href} item={item} current={pathname === item.href} />
            ))}
          </Group>
        )}

        <Group label="Settings">
          {SETTINGS.map((item) => (
            <NavLink key={item.href} item={item} current={pathname === item.href} />
          ))}
        </Group>
      </nav>

      <div className="mt-auto flex flex-col gap-3 pt-6">
        <Link
          href="/wallet"
          className="rounded-xl bg-ink-700 p-3 transition-colors hover:bg-ink-600"
        >
          <p className="text-[0.6875rem] font-semibold tracking-[0.06em] text-neutral-400 uppercase">
            Credits available
          </p>
          <p className="num mt-1 text-left text-xl font-semibold text-white">
            {availableCredits}
          </p>
          <p className="mt-1.5 flex items-center gap-1 text-[0.75rem] font-medium text-accent-300">
            Buy credits
            <Icon name="arrow-right" size={12} />
          </p>
        </Link>

        <div className="flex items-center gap-2.5 rounded-xl px-1 py-1">
          <Avatar name={businessName} size={30} />
          <span
            className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-neutral-200"
            title={businessName}
          >
            {businessName}
          </span>
          {onSignOut}
        </div>
      </div>
    </aside>
  );
}
