import { priceList } from "@magicmis/wallet";

import { DataTable, Panel, Td, Th, Tr } from "@/components/ui";
import { ACTION_LABELS, formatCredits } from "@/lib/actions";
import { db } from "@/lib/db";

/**
 * What each action costs, in credits, by intelligence tier.
 *
 * It has a page of its own, one quiet link from the Wallet (ADR 0050). The Wallet is where
 * credits are bought and this table is about spending them, so it no longer sits between a
 * customer and the packs. It stays readable, and uncharged (SPEC §2.3), because a button that
 * holds credits must have its price on record somewhere the customer can open. It is read from
 * the versioned price book, so an admin price change is what the next render shows.
 *
 * Credits only — never the AI cost cap, the ratio behind it, tokens or a model name
 * (SPEC §2.5).
 */
export async function PriceBook() {
  const rows = await priceList(db());
  return (
    <Panel
      title="What each action costs"
      description="The standard price of each action in credits, by intelligence tier. A job that needs more than its standard price stops and shows you a quote first."
      icon="table"
      padding="none"
    >
      <DataTable
        testId="price-list"
        className="px-2 pb-2"
        head={
          <>
            <Th>Action</Th>
            <Th numeric>Efficient</Th>
            <Th numeric>Professional</Th>
            <Th numeric>Expert</Th>
          </>
        }
      >
        {rows.map((r) => (
          <Tr key={r.actionKey}>
            <Td className="text-neutral-900">
              <span className="font-medium">{ACTION_LABELS[r.actionKey]}</span>
            </Td>
            <Td numeric>{formatCredits(r.credits.efficient.toString())}</Td>
            <Td numeric>{formatCredits(r.credits.professional.toString())}</Td>
            <Td numeric>{formatCredits(r.credits.expert.toString())}</Td>
          </Tr>
        ))}
      </DataTable>
    </Panel>
  );
}
