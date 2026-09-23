import { Panel } from "@/components/ui";
import { businessReport, type Point } from "@/server/business";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Business" };
export const dynamic = "force-dynamic";

/**
 * The whole business on one page (ADR 0055).
 *
 * The Margin page asks whether each action is profitable. This asks the questions above it: who
 * signed up, who is actually using it, what came in, what recurs, and what the AI costs against
 * it. It sits behind the same gate as every other console page — separate app, email allowlist,
 * TOTP, optional IP lock — which is what makes it the owner's alone.
 */

const inr = (paise: string | bigint): string => {
  const p = BigInt(paise);
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const whole = (abs / 100n).toString();
  // Indian grouping: last three digits, then pairs (SPEC §2.14).
  const grouped =
    whole.length <= 3
      ? whole
      : whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/gu, ",") + "," + whole.slice(-3);
  return `${neg ? "-" : ""}₹${grouped}.${(abs % 100n).toString().padStart(2, "0")}`;
};

/** Credits are ₹1 ex-GST each, so a credit count reads as a rupee figure (SPEC §2.4). */
const credits = (n: string | bigint): string => inr(BigInt(n) * 100n);

const count = (n: number): string => n.toLocaleString("en-IN");

/** A whole percentage, floored, on integers. */
const pct = (part: number, whole: number): string =>
  whole === 0 ? "0" : ((part * 100 - ((part * 100) % whole)) / whole).toString();

/** A ratio to one decimal, floored, on integers. */
const ratio1 = (part: number, whole: number): string => {
  if (whole === 0) return "—";
  const tenths = (part * 10 - ((part * 10) % whole)) / whole;
  return `${((tenths - (tenths % 10)) / 10).toString()}.${(tenths % 10).toString()}`;
};

/** Indian digit grouping for a plain integer string, without going through a float. */
const groupDigits = (digits: string): string =>
  digits.length <= 3
    ? digits
    : `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/gu, ",")},${digits.slice(-3)}`;

/**
 * One figure, its name and the sentence that stops it being misread.
 *
 * `lead` marks the one number in a section that answers the section's question, so five bands
 * of four identical tiles stop reading as twenty equal facts (ADR 0065). Figures are Inter's
 * tabular numerals, never a monospace face: this is a report, and the house rule is that money
 * and counts look the same here as they do in a customer's workbook.
 */
function Stat({
  label,
  value,
  note,
  lead = false,
}: {
  label: string;
  value: string;
  note?: string;
  lead?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-surface p-4 shadow-sm ${
        lead ? "border-accent-200 ring-1 ring-accent-100" : "border-neutral-200/80"
      }`}
    >
      <p className="text-xs font-medium text-neutral-600">{label}</p>
      <p
        className={`mt-1.5 tabular-nums ${
          lead
            ? "text-[1.75rem] leading-none font-semibold tracking-tight text-accent-800"
            : "text-[1.375rem] leading-none font-semibold tracking-tight text-neutral-900"
        }`}
      >
        {value}
      </p>
      {note === undefined ? null : (
        <p className="mt-2 text-xs leading-snug text-neutral-500">{note}</p>
      )}
    </div>
  );
}

/** The change between the last two points of a series, said in words the chart cannot contradict. */
function Delta({
  points,
  format,
  unit,
}: {
  points: readonly Point[];
  format: (n: number) => string;
  unit: string;
}) {
  if (points.length < 2) return null;
  const last = points[points.length - 1]?.value ?? 0;
  const prev = points[points.length - 2]?.value ?? 0;
  const diff = last - prev;
  if (diff === 0)
    return <p className="mt-2 text-xs text-neutral-500">Level on the {unit} before.</p>;
  return (
    <p className="mt-2 text-xs text-neutral-500">
      <span
        className={`font-medium tabular-nums ${diff > 0 ? "text-emerald-700" : "text-rose-700"}`}
      >
        {diff > 0 ? "+" : "−"}
        {format(Math.abs(diff))}
      </span>{" "}
      on the {unit} before.
    </p>
  );
}

/** A bar per period. Drawn from the values themselves so it cannot disagree with them. */
function Bars({
  points,
  format,
}: {
  points: readonly Point[];
  format: (n: number) => string;
}) {
  if (points.length === 0)
    return <p className="text-sm text-neutral-500">Nothing in this window yet.</p>;
  // One period is not a shape. A lone bar filling a chart's width says "chart" and shows
  // nothing a sentence would not say better, and early in a product's life that is the
  // common case rather than the odd one (ADR 0065).
  if (points.length === 1) {
    const only = points[0];
    return (
      <p className="text-sm text-neutral-700">
        <span className="text-[1.125rem] font-semibold tabular-nums text-neutral-900">
          {format(only?.value ?? 0)}
        </span>{" "}
        <span className="text-neutral-500">
          in {only?.label ?? ""} — the only period with anything in it so far.
        </span>
      </p>
    );
  }
  const max = points.reduce((m, p) => (p.value > m ? p.value : m), 1);
  const lastIndex = points.length - 1;
  return (
    <ul className="flex items-end gap-2 border-b border-neutral-200 pb-0">
      {points.map((p, i) => {
        // Percent of the tallest bar, floored on integers. The bar's own box is a fixed
        // height, because a percentage height against an auto-height parent resolves to
        // nothing and the bar simply does not draw.
        const share = (p.value * 100 - ((p.value * 100) % max)) / max;
        const latest = i === lastIndex;
        return (
          <li
            key={p.label}
            className="flex min-w-0 max-w-[4.5rem] flex-1 flex-col items-center gap-1"
          >
            <span
              className={`text-[0.625rem] tabular-nums ${
                latest ? "font-semibold text-neutral-900" : "text-neutral-500"
              }`}
            >
              {format(p.value)}
            </span>
            <span className="flex h-20 w-full items-end">
              {/*
               * The accent, not the navigation ink: a near-black slab under a figure reads as a
               * fault rather than a bar, and the dark surface is for navigation only (ADR 0036).
               * The last period is the one the reader came for, so it keeps the full accent and
               * the others step back.
               */}
              <span
                className={`w-full rounded-t ${latest ? "bg-accent-600" : "bg-accent-200"}`}
                style={{ height: `${(share < 3 ? 3 : share).toString()}%` }}
                aria-hidden="true"
              />
            </span>
            <span
              className={`w-full truncate pt-1 text-center text-[0.625rem] ${
                latest ? "font-medium text-neutral-700" : "text-neutral-500"
              }`}
            >
              {p.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Table({
  head,
  rows,
}: {
  head: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-xs text-neutral-600">
          {head.map((h, i) => (
            <th key={h} className={`py-1.5 ${i === 0 ? "" : "text-right"}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={head.length} className="py-3 text-neutral-500">
              Nothing yet.
            </td>
          </tr>
        ) : (
          rows.map((r) => (
            <tr key={r[0]} className="border-b border-neutral-100 last:border-0">
              {r.map((cell, i) => (
                <td
                  key={`${r[0] ?? ""}-${i.toString()}`}
                  className={`py-1.5 ${i === 0 ? "" : "text-right tabular-nums"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

const SECTIONS = [
  ["growth", "Growth"],
  ["companies", "Companies"],
  ["revenue", "Revenue"],
  ["recurring", "Recurring"],
  ["ai", "AI cost"],
] as const;

export default async function BusinessPage() {
  await requireAdmin();
  const r = await businessReport(db());
  const g = r.growth;
  const activation = pct(g.activated, g.accounts);
  const conversion = pct(g.paying, g.accounts);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight text-neutral-900">
          Business
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Everything above the per-action margin. Figures are live and unrounded.
        </p>
        {/*
         * Five bands of figures is a page to be read in parts, so it says what its parts are and
         * lets the reader jump (ADR 0065). Plain anchors: nothing to hydrate, and they work with
         * the keyboard and the back button the way a link should.
         */}
        <nav aria-label="Sections" className="mt-4 flex flex-wrap gap-1.5">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-full border border-neutral-200 bg-surface px-3 py-1 text-[0.75rem] font-medium text-neutral-700 shadow-sm transition-colors hover:border-accent-300 hover:text-accent-800"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      <section id="growth" className="scroll-mt-6">
        <Panel
          title="Growth"
          description="Who signed up, and how far down the funnel they got."
        >
          <div className="grid grid-cols-4 gap-4" data-testid="business-growth">
            <Stat
              lead
              label="Accounts"
              value={count(g.accounts)}
              note={`${count(g.accountsLast7)} in the last 7 days`}
            />
            <Stat label="Signed up, last 30 days" value={count(g.accountsLast30)} />
            <Stat
              label="Activated"
              value={`${count(g.activated)} · ${activation}%`}
              note="Reached a first completed setup"
            />
            <Stat
              label="Paying"
              value={`${count(g.paying)} · ${conversion}%`}
              note="Bought credits at least once"
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-6">
            <div>
              <p className="mb-2 text-xs text-neutral-600">
                Signups by week, twelve weeks
              </p>
              <Bars points={g.signupsByWeek} format={(n) => n.toString()} />
              <Delta points={g.signupsByWeek} format={(n) => n.toString()} unit="week" />
            </div>
            <div className="text-sm text-neutral-700">
              <p className="mb-2 text-xs text-neutral-600">The funnel</p>
              <Table
                head={["Step", "Accounts"]}
                rows={[
                  ["Signed up", count(g.accounts)],
                  ["Added a company", count(g.withCompany)],
                  ["Completed a setup", count(g.activated)],
                  ["Bought credits", count(g.paying)],
                ]}
              />
              <p className="mt-3 text-xs text-neutral-500">
                {g.medianDaysToFirstSetup === null
                  ? "No completed setup yet, so there is no time-to-value figure."
                  : `Median ${g.medianDaysToFirstSetup} days from signing up to a first completed setup.`}
              </p>
            </div>
          </div>
        </Panel>
      </section>

      <section id="companies" className="scroll-mt-6">
        <Panel
          title="Companies"
          description="How many books are actually being kept here, not how many accounts exist."
        >
          <div className="grid grid-cols-4 gap-4" data-testid="business-companies">
            <Stat lead label="Companies" value={count(r.companies.total)} />
            <Stat
              label="Set up"
              value={count(r.companies.setUp)}
              note="Have a first completed run"
            />
            <Stat
              label="Ran in the last 30 days"
              value={count(r.companies.runLast30)}
              note="What active means commercially"
            />
            <Stat
              label="Per paying account"
              value={ratio1(r.companies.total, g.paying)}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-6">
            <div>
              <p className="mb-2 text-xs text-neutral-600">Companies added by month</p>
              <Bars points={r.companies.createdByMonth} format={(n) => n.toString()} />
              <Delta
                points={r.companies.createdByMonth}
                format={(n) => n.toString()}
                unit="month"
              />
            </div>
            <div>
              <p className="mb-2 text-xs text-neutral-600">By lifecycle state</p>
              <Table
                head={["State", "Companies"]}
                rows={r.companies.byState.map((s) => [s.label, count(s.value)])}
              />
            </div>
          </div>
        </Panel>
      </section>

      <section id="revenue" className="scroll-mt-6">
        <Panel
          title="Revenue"
          description="Cash collected is what reached the bank. Revenue recognised is what has actually been earned, because a customer pays for credits once and spends them over months."
        >
          <div className="grid grid-cols-4 gap-4" data-testid="business-revenue">
            <Stat
              label="Cash collected, all time"
              value={
                r.cash.collected.length === 0
                  ? "₹0.00"
                  : r.cash.collected
                      .map((c) =>
                        c.currency === "INR"
                          ? inr(c.exTax)
                          : `$${(BigInt(c.exTax) / 100n).toString()}`,
                      )
                      .join(" + ")
              }
              note="Ex-tax, credited purchases"
            />
            <Stat
              label="Cash, last 30 days"
              value={
                r.cash.last30.length === 0
                  ? "₹0.00"
                  : r.cash.last30
                      .map((c) =>
                        c.currency === "INR"
                          ? inr(c.exTax)
                          : `$${(BigInt(c.exTax) / 100n).toString()}`,
                      )
                      .join(" + ")
              }
              note={`${count(r.cash.purchases)} purchases all time`}
            />
            <Stat
              lead
              label="Revenue recognised, all time"
              value={credits(r.recognised.creditsAllTime)}
              note="Credits actually spent"
            />
            <Stat
              label="Deferred revenue"
              value={credits(r.recognised.deferredCredits)}
              note="Paid for, not yet spent — a liability"
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-6">
            <div>
              <p className="mb-2 text-xs text-neutral-600">
                Cash collected by month, rupees
              </p>
              <Bars points={r.cash.byMonth} format={(n) => inr(BigInt(n))} />
              <Delta
                points={r.cash.byMonth}
                format={(n) => inr(BigInt(n))}
                unit="month"
              />
            </div>
            <div>
              <p className="mb-2 text-xs text-neutral-600">Revenue recognised by month</p>
              <Bars points={r.recognised.byMonth} format={(n) => credits(BigInt(n))} />
              <Delta
                points={r.recognised.byMonth}
                format={(n) => credits(BigInt(n))}
                unit="month"
              />
            </div>
          </div>
        </Panel>
      </section>

      <section id="recurring" className="scroll-mt-6">
        <Panel
          title="Recurring"
          description="There is no subscription here, so these are two different things and are never added into one number that pretends to be contracted."
        >
          <div className="grid grid-cols-4 gap-4" data-testid="business-recurring">
            <Stat
              label="Committed monthly"
              value={credits(r.recurring.committedMonthlyCredits)}
              note={`${count(r.recurring.activeCompanies)} active companies × ${credits(r.recurring.feePerCompanyCredits)} memory fee`}
            />
            <Stat
              lead
              label="Consumption run rate, monthly"
              value={credits(r.recurring.consumptionMonthlyCredits)}
              note="Last 30 days of spend, less memory fees"
            />
            <Stat
              label="Annual run rate"
              value={credits(r.recurring.annualRunRateCredits)}
              note="Twelve times both. A run rate, not a contract"
            />
            <Stat
              label="Revenue per active company"
              value={credits(r.perCompany.revenueCredits)}
              note="Recognised, last 30 days"
            />
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            Only the memory fee is contracted: it is charged every month a company stays
            active, whether or not anybody runs anything. Consumption repeats in practice
            because the report is monthly, but nobody has promised it, so calling the
            total &ldquo;MRR&rdquo; would overstate what is actually owed to us.
          </p>
        </Panel>
      </section>

      <section id="ai" className="scroll-mt-6">
        <Panel
          title="AI usage and what it costs"
          description="The vendor bill behind every action, and what share of what was earned it took."
        >
          <div className="grid grid-cols-4 gap-4" data-testid="business-ai">
            <Stat
              label="AI cost, all time"
              value={inr(r.ai.costPaiseAllTime)}
              note={`${count(r.ai.calls)} calls`}
            />
            <Stat
              label="AI cost, last 30 days"
              value={inr(r.ai.costPaiseLast30)}
              note={`${count(r.ai.callsLast30)} calls`}
            />
            <Stat
              lead
              label="Share of revenue"
              value={`${r.ai.shareOfRevenuePercent}%`}
              note="AI cost over credits spent, last 30 days"
            />
            <Stat
              label="Cache hit rate"
              value={`${r.ai.cacheHitPercent}%`}
              note="Cached input over all input read"
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-6">
            <div>
              <p className="mb-2 text-xs text-neutral-600">By stage</p>
              <Table
                head={["Stage", "Calls", "Cost"]}
                rows={r.ai.byStage.map((s) => [s.stage, count(s.calls), inr(s.paise)])}
              />
            </div>
            <div>
              <p className="mb-2 text-xs text-neutral-600">By model</p>
              <Table
                head={["Model", "Calls", "Cost"]}
                rows={r.ai.byModel.map((m) => [m.model, count(m.calls), inr(m.paise)])}
              />
              <p className="mt-3 text-xs text-neutral-500">
                AI cost per company that ran in the last 30 days:{" "}
                <span className="tabular-nums">{inr(r.perCompany.aiCostPaise)}</span>.
                Tokens read{" "}
                <span className="tabular-nums">{groupDigits(r.ai.inputTokens)}</span>,
                written{" "}
                <span className="tabular-nums">{groupDigits(r.ai.outputTokens)}</span>.
              </p>
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}
