import { priceList } from "@magicmis/wallet";

import { DataTable, Panel, Td, Th, Tr } from "@/components/ui";
import { ACTION_LABELS, formatCredits } from "@/lib/actions";
import { db } from "@/lib/db";

/**
 * What each action costs, in credits, by intelligence tier.
 *
 * This used to be the public pricing page. It reads better here: a customer looking at a
 * balance is the one who wants it, and the page they land on when a run is short is this
 * one. Viewing it is still uncharged (SPEC §2.3) and it is still read from the versioned
 * price book, so an admin price change is what the next render shows.
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
              {r.instant ? (
                <span className="mt-0.5 block text-[0.75rem] text-neutral-500">
                  Instant delivery: {formatCredits(r.instant.efficient.toString())} /{" "}
                  {formatCredits(r.instant.professional.toString())} /{" "}
                  {formatCredits(r.instant.expert.toString())}
                </span>
              ) : null}
            </Td>
            <Td numeric>{formatCredits(r.standard.efficient.toString())}</Td>
            <Td numeric>{formatCredits(r.standard.professional.toString())}</Td>
            <Td numeric>{formatCredits(r.standard.expert.toString())}</Td>
          </Tr>
        ))}
      </DataTable>
    </Panel>
  );
}
