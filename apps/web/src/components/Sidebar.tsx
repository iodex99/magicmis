"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PRODUCT_NAME } from "@/lib/brand";

import { Icon, type IconName } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";
import { Logo } from "./Logo";
import { Avatar } from "./ui";

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
  { href: "/wallet", label: "Wallet", icon: "wallet" },
];

const SETTINGS: readonly NavItem[] = [
  { href: "/settings/profile", label: "Profile", icon: "user" },
  { href: "/settings/security", label: "Security", icon: "shield" },
  { href: "/settings/privacy", label: "Privacy and data", icon: "lock" },
];

function workspaceItems(id: string): readonly NavItem[] {
  return [
    // One workspace: the dashboard with the assistant beside it (ADR 0033).
    { href: `/app/companies/${id}`, label: "Dashboard and assistant", icon: "chart" },
    { href: `/app/companies/${id}/run`, label: "Add a month", icon: "upload" },
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
      className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] font-medium transition-colors ${
        current
          ? "bg-ink-700 text-white before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-accent-400"
          : "text-neutral-300 hover:bg-ink-700/70 hover:text-white"
      }`}
    >
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
          current
            ? "bg-accent-600 text-white"
            : "bg-white/5 text-neutral-400 group-hover:text-white"
        }`}
      >
        <Icon name={item.icon} size={14} />
      </span>
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
      <Link href="/app" className="mb-6 flex items-center px-2" aria-label={PRODUCT_NAME}>
        <Logo size={30} onInk animate />
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
          className="group rounded-xl border border-white/5 bg-ink-700 p-3 transition-colors hover:border-accent-400/40 hover:bg-ink-600"
        >
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-neutral-400 uppercase">
            <Icon name="wallet" size={12} />
            Credits available
          </p>
          <p className="num display mt-1.5 text-left text-[1.375rem] leading-none font-semibold text-white">
            {availableCredits}
          </p>
          <p className="mt-2 flex items-center gap-1 text-[0.75rem] font-medium text-accent-300">
            Buy credits
            <Icon
              name="arrow-right"
              size={12}
              className="transition-transform group-hover:translate-x-0.5"
            />
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
          <ThemeToggle />
          {onSignOut}
        </div>
      </div>
    </aside>
  );
}
