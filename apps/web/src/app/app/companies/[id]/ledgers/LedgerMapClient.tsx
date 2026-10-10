"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";

import { Alert, Badge, Button, DataTable, Td, Th, Tr } from "@/components/ui";
import { api, newIdempotencyKey } from "@/lib/client-api";

interface Row {
  key: string;
  group: string;
  name: string;
  tokenised: boolean;
  head: string;
  /** Off the MIS because its owner chose so, not because a run could not place it. */
  keptOff: boolean;
  balance: string | null;
}

const STATEMENTS: readonly { id: string; label: string }[] = [
  { id: "pnl", label: "Profit and loss" },
  { id: "balance_sheet", label: "Balance sheet" },
  { id: "memo", label: "Other" },
];

/** What the picker starts on for a ledger nobody has decided about yet. */
const UNDECIDED = "";

const without = <T,>(record: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/**
 * The ledger map's table (ADR 0086): the ledgers no run could place first, because they are
 * missing from the figures and nobody has looked at them; then the ones kept off on purpose; then
 * every other ledger by the line it feeds.
 *
 * Choosing a line saves nothing until Save is pressed (ADR 0091): a closed select fires a change
 * on every arrow key, and each one used to write a new version of the company's memory. An error
 * is said on its row, and a map that changed elsewhere is reloaded rather than refused for ever.
 */
export function LedgerMapClient({
  companyId,
  version: initialVersion,
  asAt,
  heads,
  unmapped,
  live,
  rows: initialRows,
}: {
  companyId: string;
  version: number;
  asAt: string | null;
  heads: readonly { code: string; name: string; statement: string }[];
  unmapped: string;
  /** A run for the company is in progress, so every change would be refused until it ends. */
  live: boolean;
  rows: readonly Row[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([...initialRows]);
  const [version, setVersion] = useState(initialVersion);
  // Refused as busy since the page was drawn; the server's own answer is `live`.
  const [refusedBusy, setRefusedBusy] = useState(false);
  const running = live || refusedBusy;
  const [filter, setFilter] = useState("");
  // The line picked on each row and not yet saved.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [errors, setErrors] = useState<
    Record<string, { message: string; reload: boolean }>
  >({});

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q === ""
      ? rows
      : rows.filter((r) => `${r.group} ${r.name}`.toLowerCase().includes(q));
  }, [rows, filter]);
  const unplaced = rows.filter((r) => r.head === unmapped && !r.keptOff).length;
  const keptOff = rows.filter((r) => r.head === unmapped && r.keptOff).length;

  // What a row's picker shows as saved: an undecided ledger has no choice yet.
  const current = (row: Row): string =>
    row.head === unmapped && !row.keptOff ? UNDECIDED : row.head;

  const save = async (row: Row, head: string) => {
    setBusy(row.key);
    setSaved(null);
    setErrors((e) => without(e, row.key));
    const r = await api<{ version: number }>(`/api/companies/${companyId}/ledgers`, {
      method: "PATCH",
      body: { ledgerKey: row.key, head, basedOn: version },
      idempotencyKey: newIdempotencyKey(),
    });
    setBusy(null);
    if (!r.ok) {
      if (r.error === "busy") setRefusedBusy(true);
      setErrors((e) => ({
        ...e,
        [row.key]: { message: r.message, reload: r.error === "stale" },
      }));
      return;
    }
    setVersion(r.data.version);
    setRows((list) =>
      list.map((x) =>
        x.key === row.key ? { ...x, head, keptOff: head === unmapped } : x,
      ),
    );
    setPicked((p) => without(p, row.key));
    setSaved(row.key);
  };

  const label = (row: Row) =>
    row.tokenised ? `${row.name} (name kept private)` : row.name;

  return (
    <div className="flex flex-col gap-4" data-testid="ledger-map">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="neutral">{rows.length} ledgers</Badge>
        <Badge tone={unplaced === 0 ? "positive" : "warning"} dot>
          {unplaced === 0
            ? "Every ledger is on a line or kept off"
            : `${unplaced.toString()} not placed yet`}
        </Badge>
        {keptOff === 0 ? null : (
          <Badge tone="muted">{keptOff.toString()} kept off on purpose</Badge>
        )}
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

      {running ? (
        <Alert tone="warning" title="A run for this company is in progress">
          <p>
            It writes the map back when it ends, so the map can be changed once it has
            finished.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => {
              setRefusedBusy(false);
              router.refresh();
            }}
          >
            Check again
          </Button>
        </Alert>
      ) : (
        <Alert tone="info">
          A ledger not placed yet is missing from every figure until you choose its line,
          or keep it off the MIS if it belongs on none. Pick a line, then press Save. A
          change reaches the figures the next time you add a file for this company.
        </Alert>
      )}

      <div className="rounded-xl border border-neutral-200/80 bg-surface shadow-sm">
        <DataTable
          className="px-2 pb-2"
          testId="ledger-table"
          head={
            <>
              <Th>Ledger</Th>
              <Th numeric>{asAt === null ? "Balance" : `Balance, ${asAt}`}</Th>
              <Th>MIS line</Th>
              <Th>
                <span className="sr-only">Save</span>
              </Th>
            </>
          }
        >
          {shown.map((row) => {
            const value = picked[row.key] ?? current(row);
            const changed = value !== current(row) && value !== UNDECIDED;
            const error = errors[row.key];
            const undecided = row.head === unmapped && !row.keptOff;
            return (
              <Fragment key={row.key}>
                <Tr data-testid="ledger-row">
                  <Td className="min-w-48">
                    <p className="text-[0.875rem] font-medium wrap-anywhere text-neutral-900">
                      {label(row)}
                    </p>
                    <p className="text-[0.75rem] wrap-anywhere text-neutral-500">
                      {row.group}
                    </p>
                    {row.head !== unmapped ? null : (
                      <Badge tone={undecided ? "warning" : "muted"} className="mt-1" dot>
                        {undecided ? "Not placed yet" : "Kept off on purpose"}
                      </Badge>
                    )}
                  </Td>
                  <Td numeric className="w-40 text-[0.8125rem] whitespace-nowrap">
                    {row.balance ?? "—"}
                  </Td>
                  <Td className="w-72">
                    <select
                      aria-label={`MIS line for ${label(row)}`}
                      value={value}
                      disabled={running}
                      onChange={(e) => {
                        const next = e.target.value;
                        setPicked((p) => ({ ...p, [row.key]: next }));
                        setSaved(null);
                      }}
                      className={`h-9 w-72 rounded-md border bg-surface px-2 text-[0.8125rem] ${
                        undecided && !changed
                          ? "border-warning text-warning"
                          : "border-neutral-200 text-neutral-900"
                      }`}
                    >
                      {undecided ? (
                        <option value={UNDECIDED} disabled>
                          Not placed yet: choose
                        </option>
                      ) : null}
                      <option value={unmapped}>Keep off the MIS</option>
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
                  </Td>
                  <Td className="w-28 whitespace-nowrap">
                    {changed ? (
                      <Button
                        size="sm"
                        disabled={running || busy !== null}
                        onClick={() => void save(row, value)}
                      >
                        {busy === row.key ? "Saving…" : "Save"}
                        <span className="sr-only"> the line for {label(row)}</span>
                      </Button>
                    ) : (
                      <span className="text-[0.75rem] text-positive" aria-live="polite">
                        {saved === row.key ? "Saved" : ""}
                      </span>
                    )}
                  </Td>
                </Tr>
                {error === undefined ? null : (
                  <tr>
                    <td colSpan={4} className="px-3 pb-3">
                      <Alert tone="error">
                        {error.message}{" "}
                        {error.reload ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="ml-1"
                            onClick={() => {
                              router.refresh();
                            }}
                          >
                            Reload the map
                          </Button>
                        ) : null}
                      </Alert>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </DataTable>
      </div>
    </div>
  );
}
