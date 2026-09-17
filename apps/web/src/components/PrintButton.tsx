"use client";

import { Button } from "@/components/ui";

/**
 * Print the dashboard, or save it as a PDF (ADR 0034). The print stylesheet drops the navigation,
 * the assistant and every control, so what comes out is the figures with their month and units.
 */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button
      variant="secondary"
      icon="document"
      data-print="hide"
      onClick={() => {
        window.print();
      }}
    >
      {label}
    </Button>
  );
}
