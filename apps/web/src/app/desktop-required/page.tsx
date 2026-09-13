import { PRODUCT_NAME } from "@/lib/brand";

export const metadata = { title: "Desktop required" };

/** SPEC §2.13, §32: a clean "desktop required" page for non-desktop user agents. */
export default function DesktopRequiredPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="max-w-sm text-center">
        <h1 className="mb-3 text-lg font-semibold text-neutral-900">
          Please use a desktop computer
        </h1>
        <p className="text-sm text-neutral-700">
          {PRODUCT_NAME} works with large spreadsheets and dense financial tables, so it
          is available on desktop browsers only: the latest Chrome, Edge or Firefox.
        </p>
      </div>
    </main>
  );
}
