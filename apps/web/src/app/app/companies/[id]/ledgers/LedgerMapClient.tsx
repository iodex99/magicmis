"use client";

import { useMemo, useState } from "react";

import { Alert, Badge, Panel } from "@/components/ui";
import { api, newIdempotencyKey } from "@/lib/client-api";

interface Row {
  key: string;
  group: string;
  name: string;
  tokenised: boolean;
  head: string;
  balance: string | null;
}

const STATEMENTS: readonly { id: string; label: string }[] = [
  { id: "pnl", label: "Profit and loss" },
  { id: "balance_sheet", label: "Balance sheet" },
  { id: "memo", label: "Other" },
];

/**
 * The ledger map's table (ADR 0086): Unmapped first, because those are the ledgers missing from
 * the figures, then every other ledger by the line it feeds. Picking a line saves it at once, the
 * way the rest of the product saves, and says so — or says why it could not.
 */
export function LedgerMapClient({
  companyId,
  version: initialVersion,
  asAt,
  heads,
  unmapped,
  rows: initialRows,
}: {
  companyId: string;
  version: number;
  asAt: string | null;
  heads: readonly { code: string; name: string; statement: string }[];
  unmapped: string;
  rows: readonly Row[];
}) {
  const [rows, setRows] = useState<Row[]>([...initialRows]);
  const [version, setVersion] = useState(initialVersion);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q === ""
      ? rows
      : rows.filter((r) => `${r.group} ${r.name}`.toLowerCase().includes(q));
  }, [rows, filter]);
  const missing = rows.filter((r) => r.head === unmapped).length;

  const move = async (row: Row, head: string) => {
    setBusy(row.key);
    setError(null);
    setSaved(null);
    const r = await api<{ version: number }>(`/api/companies/${companyId}/ledgers`, {
      method: "PATCH",
      body: { ledgerKey: row.key, head, basedOn: version },
      idempotencyKey: newIdempotencyKey(),
    });
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setVersion(r.data.version);
    setRows((list) => list.map((x) => (x.key === row.key ? { ...x, head } : x)));
    setSaved(row.key);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="ledger-map">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="neutral">{rows.length} ledgers</Badge>
        <Badge tone={missing === 0 ? "positive" : "warning"} dot>
          {missing === 0
            ? "Every ledger is on a line"
            : `${missing.toString()} left unmapped`}
        </Badge>
        {asAt === null ? null : (
          <span className="text-[0.8125rem] text-neutral-500">Balances at {asAt}</span>
        )}
        <label className="ml-auto flex items-center gap-2 text-[0.8125rem] text-neutral-600">
          <span>Find a ledger</span>
          <input
            id="ledger-filter"
            type="search"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
            }}
            className="h-9 w-56 rounded-md border border-neutral-200 bg-surface px-2.5 text-[0.875rem] text-neutral-900"
          />
        </label>
      </div>

      <Alert tone="info">
        A change applies the next time the MIS is built: add this month&rsquo;s file, or
        set the MIS up again from the files already kept. Leaving a ledger unmapped keeps
        it off every figure for good.
      </Alert>
      {error === null ? null : <Alert tone="error">{error}</Alert>}

      <Panel padding="none">
        <ul className="divide-y divide-neutral-100">
          {shown.map((row) => (
            <li
              key={row.key}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3"
              data-testid="ledger-row"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.875rem] font-medium text-neutral-900">
                  {row.tokenised ? `${row.name} (name kept private)` : row.name}
                </p>
                <p className="truncate text-[0.75rem] text-neutral-500">{row.group}</p>
              </div>
              <span className="num w-40 text-right text-[0.8125rem] text-neutral-700">
                {row.balance ?? "—"}
              </span>
              <select
                aria-label={`MIS line for ${row.name}`}
                value={row.head}
                disabled={busy !== null}
                onChange={(e) => void move(row, e.target.value)}
                className={`h-9 w-72 rounded-md border bg-surface px-2 text-[0.8125rem] ${
                  row.head === unmapped
                    ? "border-warning text-warning"
                    : "border-neutral-200 text-neutral-900"
                }`}
              >
                <option value={unmapped}>Leave unmapped</option>
                {STATEMENTS.map((s) => (
                  <optgroup key={s.id} label={s.label}>
                    {heads
                      .filter((h) => h.statement === s.id && h.code !== unmapped)
                      .map((h) => (
                        <option key={h.code} value={h.code}>
                          {h.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <span className="w-14 text-[0.75rem] text-positive" aria-live="polite">
                {busy === row.key ? "Saving…" : saved === row.key ? "Saved" : ""}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
