import { priceList } from "@magicmis/wallet";

import { DataTable, Panel, Td, Th, Tr } from "@/components/ui";
import { ACTION_LABELS, formatCredits, TIER_LABELS, TIER_NOTES } from "@/lib/actions";
import { db } from "@/lib/db";

const TIERS = ["efficient", "professional", "expert"] as const;

/**
 * What a row is, for the rows nobody presses (ADR 0091): each is charged in place of something,
 * or on its own schedule, and a bare name read as a button that was missing.
 */
const ROW_NOTES: Partial<Record<keyof typeof ACTION_LABELS, string>> = {
  data_diagnostic:
    "Charged instead of the run's price when a run stops on a problem in your files.",
  refresh_with_restructure:
    "Charged instead of a monthly refresh when a month's files are laid out differently enough to be mapped again.",
  company_memory_monthly: "Charged each month a company stays active, whatever the tier.",
  company_restore: "Charged once to bring back an archived company.",
  cancel_after_ai_fee:
    "Charged if you cancel a run after its analysis has started; the rest of what was held comes back.",
};

/**
 * What each action costs, in credits, by intelligence tier.
 *
 * It has a page of its own, one quiet link from the Wallet (ADR 0050). The Wallet is where
 * credits are bought and this table is about spending them, so it no longer sits between a
 * customer and the packs. It stays readable, and uncharged (SPEC §2.3), because a button that
 * holds credits must have its price on record somewhere the customer can open. It is read from
 * the versioned price book, so an admin price change is what the next render shows.
 *
 * It carries no heading of its own: the page it is the whole of is already called "What actions
 * cost", and a panel titled "What each action costs" directly beneath said the same thing a
 * second time. The quote sentence it used to carry moved up to the page, where it belongs —
 * it is about pressing any action, not about reading this table.
 *
 * Each tier says what it changes under its name, and a price that is the same at every tier is
 * written once across them rather than three times (ADR 0091).
 *
 * Credits only — never the AI cost cap, the ratio behind it, tokens or a model name
 * (SPEC §2.5).
 */
export async function PriceBook() {
  const rows = await priceList(db());
  return (
    <Panel padding="none">
      <DataTable
        testId="price-list"
        className="p-2"
        head={
          <>
            <Th>Action</Th>
            {TIERS.map((t) => (
              <Th key={t} numeric className="align-top">
                {TIER_LABELS[t]}
                <span className="mt-0.5 block max-w-48 text-[0.6875rem] font-normal tracking-normal text-neutral-500 normal-case">
                  {TIER_NOTES[t]}
                </span>
              </Th>
            ))}
          </>
        }
      >
        {rows.map((r) => {
          const flat =
            r.credits.efficient === r.credits.professional &&
            r.credits.professional === r.credits.expert;
          const note = ROW_NOTES[r.actionKey];
          return (
            <Tr key={r.actionKey}>
              <Td className="text-neutral-900">
                <span className="font-medium">{ACTION_LABELS[r.actionKey]}</span>
                {note === undefined ? null : (
                  <span className="mt-0.5 block text-[0.75rem] text-neutral-500">
                    {note}
                  </span>
                )}
              </Td>
              {flat ? (
                <Td colSpan={3} className="text-center">
                  <span className="num text-neutral-900">
                    {formatCredits(r.credits.professional.toString())}
                  </span>
                  <span className="ml-1.5 text-[0.75rem] text-neutral-500">
                    at every tier
                  </span>
                </Td>
              ) : (
                TIERS.map((t) => (
                  <Td key={t} numeric>
                    {formatCredits(r.credits[t].toString())}
                  </Td>
                ))
              )}
            </Tr>
          );
        })}
      </DataTable>
    </Panel>
  );
}
