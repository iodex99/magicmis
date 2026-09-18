"use client";

import type { NumberFormatOptions } from "@magicmis/core/format";
import type { PeriodId } from "@magicmis/core/time";
import { companyFormat } from "@magicmis/render-dashboard";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { CHAT_COOKIE, OPEN_CHAT_EVENT, OPEN_CHAT_PARAM, remember } from "@/lib/prefs";

import { Assistant, type CommentaryRow } from "./Assistant";
import { DashboardClient } from "./DashboardClient";

/**
 * The company workspace (ADR 0033): the dashboard with the chat beside it, so a question is
 * always asked with the figures in view. Investigate on a dashboard card hands its question
 * straight to the chat rather than opening another page.
 *
 * The chat can be put away to give the dashboard the whole width (ADR 0044), and because it is
 * what the product earns from, putting it away never puts it out of reach: a launcher stays in
 * the corner of the screen however far the page is scrolled, Ctrl/⌘ K opens it from the
 * keyboard, the rail opens it from any page, and Investigate opens it by itself. It stays
 * mounted while hidden, so a conversation — or an answer still on its way — is not lost by
 * closing the panel. Below the wide breakpoint, where there is no room beside the dashboard, it
 * floats over the corner instead of being stacked a long scroll beneath it.
 */
export function Workspace({
  companyId,
  companyName,
  money,
  currencySymbol,
  periods,
  commentaries,
  chatPreference,
  children,
}: {
  companyId: string;
  companyName: string;
  money: NumberFormatOptions;
  currencySymbol: string;
  periods: readonly string[];
  commentaries: readonly CommentaryRow[];
  /** From the `chat` cookie; null when the reader has never chosen. */
  chatPreference: "open" | "closed" | null;
  /** Workbooks, files and history, below the dashboard. */
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [prefill, setPrefill] = useState<{
    type: "investigate";
    text: string;
    nonce: number;
  } | null>(null);
  const [chatOpen, setChatOpen] = useState(chatPreference !== "closed");
  const [focusNonce, setFocusNonce] = useState(0);

  const [layoutVersion, setLayoutVersion] = useState(0);
  const [dashboardVersion, setDashboardVersion] = useState<number | null>(null);
  const layoutChanged = useCallback(() => {
    setLayoutVersion((v) => v + 1);
  }, []);

  const openChat = useCallback(() => {
    setChatOpen(true);
    remember(CHAT_COOKIE, "open");
    setFocusNonce((n) => n + 1);
  }, []);
  const closeChat = useCallback(() => {
    setChatOpen(false);
    remember(CHAT_COOKIE, "closed");
  }, []);

  // With no room beside the dashboard an open chat would sit on top of it, so a reader who
  // has never chosen starts with it put away there. Not remembered: it is not their choice.
  useEffect(() => {
    if (chatPreference === null && !window.matchMedia("(min-width: 1280px)").matches)
      setChatOpen(false);
  }, [chatPreference]);

  // Arriving from the rail on another page: open, then tidy the address so the same link
  // works again after the chat has been closed.
  useEffect(() => {
    if (params.get(OPEN_CHAT_PARAM) !== "open") return;
    openChat();
    router.replace(pathname, { scroll: false });
  }, [params, pathname, router, openChat]);

  useEffect(() => {
    const onOpen = () => {
      openChat();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (chatOpen) closeChat();
      else openChat();
    };
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [chatOpen, openChat, closeChat]);

  const investigate = useCallback(
    (metric: string, period: PeriodId, name: string) => {
      // Opened for the reader, and remembered as open: they asked a question of it.
      setChatOpen(true);
      remember(CHAT_COOKIE, "open");
      setPrefill({
        type: "investigate",
        text: `Why did ${name} move in ${companyFormat(money, currencySymbol).period(period)}? Which ledgers drove the change?`,
        nonce: Date.now(),
      });
    },
    [money, currencySymbol],
  );

  return (
    <div
      className={`grid items-start gap-5 ${
        chatOpen ? "xl:grid-cols-[minmax(0,1fr)_25rem]" : ""
      }`}
      data-chat={chatOpen ? "open" : "closed"}
    >
      <div className="flex min-w-0 flex-col gap-5">
        <DashboardClient
          companyId={companyId}
          onInvestigate={investigate}
          reloadKey={layoutVersion}
          onVersion={setDashboardVersion}
        />
        {children}
      </div>

      <div
        hidden={!chatOpen}
        className="fixed right-4 bottom-4 z-40 w-[min(25rem,calc(100vw-2rem))] xl:sticky xl:top-7 xl:right-auto xl:bottom-auto xl:z-auto xl:w-auto"
        data-testid="chat-panel"
        data-print="hide"
      >
        <Assistant
          companyId={companyId}
          companyName={companyName}
          money={money}
          currencySymbol={currencySymbol}
          periods={periods}
          commentaries={commentaries}
          prefill={prefill}
          focusNonce={focusNonce}
          onCollapse={closeChat}
          onLayoutChanged={layoutChanged}
          dashboardVersion={dashboardVersion}
        />
      </div>

      {chatOpen ? null : (
        <button
          type="button"
          onClick={openChat}
          className="press rise fixed right-6 bottom-6 z-40 flex items-center gap-2.5 rounded-full bg-accent-600 py-3 pr-5 pl-4 text-[0.875rem] font-semibold text-white shadow-lg transition-colors hover:bg-accent-700"
          aria-label="Chat with the MIS"
          title="Chat with the MIS (Ctrl K)"
          data-testid="chat-launcher"
          data-print="hide"
        >
          <Icon name="chat" size={18} />
          Chat with the MIS
          <kbd className="ml-1 rounded bg-white/15 px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium">
            Ctrl K
          </kbd>
        </button>
      )}
    </div>
  );
}
