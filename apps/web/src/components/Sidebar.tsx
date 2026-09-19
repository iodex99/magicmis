"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { PRODUCT_NAME } from "@/lib/brand";
import { OPEN_CHAT_EVENT, OPEN_CHAT_PARAM, RAIL_COOKIE, remember } from "@/lib/prefs";

import { Icon, type IconName } from "./Icon";
import { Logo, LogoMark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar } from "./ui";

/**
 * Primary navigation (SPEC §32).
 *
 * The dark surface is the one place the app goes dark: it frames the working area and
 * holds no figures, so the reading-accuracy cost of a dark ground is not paid where it
 * would matter. The current page is marked by a filled pill *and* `aria-current`, so the
 * state is never carried by colour alone.
 *
 * It collapses to a strip of icons (ADR 0044) — a dashboard beside a chat wants every column it
 * can get — and remembers that in a cookie the server reads, so the page arrives at the right
 * width instead of jumping. Collapsed, every item keeps its name as its accessible label and
 * its tooltip; nothing becomes reachable only by guessing at an icon.
 *
 * The chat is the one thing here that is not a page: it is what the product earns from, so it
 * is one press away from anywhere in the app, in either width.
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
    // One workspace: the dashboard with the chat beside it (ADR 0033).
    { href: `/app/companies/${id}`, label: "Dashboard", icon: "chart" },
    { href: `/app/companies/${id}/run`, label: "Add a file", icon: "upload" },
    // Everything that is not the board: conventions, files, workbooks, charges (ADR 0047).
    {
      href: `/app/companies/${id}/manage`,
      label: "Files and settings",
      icon: "settings",
    },
  ];
}

function isCurrent(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true;
  if (item.match !== undefined && pathname.startsWith(item.match)) return true;
  return false;
}

function NavLink({
  item,
  current,
  collapsed,
}: {
  item: NavItem;
  current: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={`group relative flex items-center gap-2.5 rounded-lg py-2 text-[0.8125rem] font-medium transition-colors ${
        collapsed ? "justify-center px-0" : "px-2.5"
      } ${
        current
          ? "bg-ink-700 text-white before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-accent-400"
          : "text-neutral-300 hover:bg-ink-700/70 hover:text-white"
      }`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
          current
            ? "bg-accent-600 text-white"
            : "bg-white/5 text-neutral-400 group-hover:text-white"
        }`}
      >
        <Icon name={item.icon} size={14} />
      </span>
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function Group({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      {collapsed ? (
        <div className="mx-auto mb-2 h-px w-6 bg-white/10" role="presentation" />
      ) : (
        <p className="truncate px-3 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-neutral-500 uppercase">
          {label}
        </p>
      )}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

export function Sidebar({
  businessName,
  availableCredits,
  company,
  chatCompanyId,
  initialCollapsed = false,
  onSignOut,
}: {
  businessName: string;
  /** Pre-formatted; the wallet page is the authority on the figure. */
  availableCredits: string;
  company?: { id: string; name: string };
  /** The company whose chat the rail opens: the one on screen, or the most recent. */
  chatCompanyId: string | null;
  /** From the `rail` cookie, so the first paint is already the right width. */
  initialCollapsed?: boolean;
  onSignOut: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  // A company page is a workspace even before its name has been passed in.
  const companyId = company?.id ?? pathname.split("/")[3];
  const workspace =
    pathname.startsWith("/app/companies/") && companyId !== undefined ? companyId : null;

  // Remembered only once the reader has actually chosen, never for the default.
  const chose = useRef(false);
  const toggle = useCallback(() => {
    chose.current = true;
    setCollapsed((was) => !was);
  }, []);
  useEffect(() => {
    if (chose.current) remember(RAIL_COOKIE, collapsed ? "collapsed" : "open");
  }, [collapsed]);

  // Ctrl/⌘ + B, as in every editor with a side panel. Not while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "b") return;
      const target = event.target as HTMLElement | null;
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [toggle]);

  const chatPath = chatCompanyId === null ? null : `/app/companies/${chatCompanyId}`;
  const chatHref = chatPath === null ? "/app" : `${chatPath}?${OPEN_CHAT_PARAM}=open`;

  return (
    <aside
      className={`on-ink sticky top-0 flex h-screen shrink-0 flex-col bg-ink-900 py-4 transition-[width] duration-200 ${
        collapsed ? "w-[4.5rem] px-2.5" : "w-60 px-3"
      }`}
      data-collapsed={collapsed ? "true" : "false"}
      data-testid="rail"
      data-print="hide"
    >
      <div
        className={`mb-5 flex items-center ${
          collapsed ? "flex-col gap-3" : "justify-between px-2"
        }`}
      >
        <Link href="/app" aria-label={PRODUCT_NAME} className="flex items-center">
          {collapsed ? <LogoMark size={30} /> : <Logo size={30} onInk animate />}
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="rail-nav"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={
            collapsed ? "Expand navigation (Ctrl B)" : "Collapse navigation (Ctrl B)"
          }
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-ink-700 hover:text-white"
          data-testid="rail-toggle"
        >
          <Icon name="panel" size={16} />
        </button>
      </div>

      {/* The chat, from anywhere. On its own company's workspace it opens in place; from any
          other page it goes there and opens on arrival. */}
      <Link
        href={chatHref}
        onClick={(event) => {
          if (chatPath !== null && pathname === chatPath) {
            event.preventDefault();
            window.dispatchEvent(new Event(OPEN_CHAT_EVENT));
          }
        }}
        aria-label={collapsed ? "Chat with the MIS" : undefined}
        title={
          chatPath === null
            ? "Add a company, and you can chat with its MIS"
            : "Chat with the MIS (Ctrl K)"
        }
        className={`press mb-5 flex items-center gap-2.5 rounded-lg bg-accent-600 py-2 text-[0.8125rem] font-semibold text-white shadow-sm transition-colors hover:bg-accent-500 ${
          collapsed ? "justify-center px-0" : "px-2.5"
        }`}
        data-testid="rail-chat"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">
          <Icon name="chat" size={15} />
        </span>
        {collapsed ? null : <span className="truncate">Chat with the MIS</span>}
      </Link>

      <nav
        id="rail-nav"
        aria-label="Main"
        className="scroll-slim flex flex-col gap-5 overflow-x-hidden overflow-y-auto"
      >
        <div className="flex flex-col gap-0.5">
          {PRIMARY.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              current={isCurrent(pathname, item) && workspace === null}
              collapsed={collapsed}
            />
          ))}
        </div>

        {workspace === null ? null : (
          <Group label={company?.name ?? "Company"} collapsed={collapsed}>
            {workspaceItems(workspace).map((item) => (
              <NavLink
                key={item.href}
                item={item}
                current={pathname === item.href}
                collapsed={collapsed}
              />
            ))}
          </Group>
        )}

        <Group label="Settings" collapsed={collapsed}>
          {SETTINGS.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              current={pathname === item.href}
              collapsed={collapsed}
            />
          ))}
        </Group>
      </nav>

      <div className="mt-auto flex flex-col gap-3 pt-6">
        {collapsed ? (
          <Link
            href="/wallet"
            aria-label={`${availableCredits} credits available. Add credits`}
            title={`${availableCredits} credits available`}
            className="flex flex-col items-center gap-1 rounded-xl border border-white/5 bg-ink-700 py-2.5 transition-colors hover:border-accent-400/40 hover:bg-ink-600"
          >
            <Icon name="wallet" size={14} className="text-neutral-400" />
            <span className="num text-[0.6875rem] leading-none font-semibold text-white">
              {availableCredits}
            </span>
          </Link>
        ) : (
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
              Add credits
              <Icon
                name="arrow-right"
                size={12}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </p>
          </Link>
        )}

        <div
          className={`flex items-center rounded-xl py-1 ${
            collapsed ? "flex-col gap-1.5" : "gap-2.5 px-1"
          }`}
        >
          <Avatar name={businessName} size={30} />
          {collapsed ? null : (
            <span
              className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-neutral-200"
              title={businessName}
            >
              {businessName}
            </span>
          )}
          <ThemeToggle />
          {onSignOut}
        </div>
      </div>
    </aside>
  );
}
