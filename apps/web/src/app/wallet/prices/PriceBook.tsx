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
 * It carries no heading of its own: the page it is the whole of is already called "What actions
 * cost", and a panel titled "What each action costs" directly beneath said the same thing a
 * second time. The quote sentence it used to carry moved up to the page, where it belongs —
 * it is about pressing any action, not about reading this table.
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
