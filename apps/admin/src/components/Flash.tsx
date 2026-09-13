import { Alert } from "./ui";

export type FlashParams = Promise<{
  ok?: string;
  error?: string;
  q?: string;
  month?: string;
}>;

export async function Flash({ searchParams }: { searchParams: FlashParams }) {
  const { ok, error } = await searchParams;
  if (error !== undefined) return <Alert tone="error">{error}</Alert>;
  if (ok !== undefined) return <Alert tone="success">{ok}</Alert>;
  return null;
}

export const th = "px-3 py-2 text-left text-xs font-medium text-neutral-600";
export const td = "px-3 py-2 text-sm";
export const num = "px-3 py-2 text-right font-mono text-sm tabular-nums";
export const input =
  "h-8 rounded-md border border-neutral-300 bg-white px-2 text-sm text-neutral-900";
