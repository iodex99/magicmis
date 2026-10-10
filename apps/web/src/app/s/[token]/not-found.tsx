import { PRODUCT_NAME } from "@/lib/brand";

/**
 * A link that is wrong, expired or withdrawn (ADR 0090): one answer for all three, so the page
 * says nothing about which, and nothing about whose board it was.
 */
export default function SharedBoardGone() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="max-w-md text-center" data-testid="share-gone">
        <h1 className="display mb-3 text-[1.375rem] font-semibold text-neutral-900">
          This link no longer opens a board
        </h1>
        <p className="text-sm leading-relaxed text-neutral-700">
          It may have expired, or the person who shared it may have withdrawn it. Ask them
          for a new link. Boards on {PRODUCT_NAME} are shared by their owners, for as long
          as they choose.
        </p>
      </div>
    </main>
  );
}
