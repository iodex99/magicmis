import { Donut, MiniBars, Sparkline } from "@/components/Charts";

/**
 * Sample dashboards, drifting past in two rows (ADR 0051).
 *
 * The dashboard is the product, so the public site shows dashboards rather than offering a
 * workbook to download. Two rows move in opposite directions, slowly enough to read a card as it
 * passes, and stop under the pointer. Every company here is invented (SPEC §2.3 permits public
 * samples on fictional data only) and the section says so where a reader will see it.
 *
 * Drawn with the chart components the product uses, not screenshots, so both themes work and
 * nothing here can ever be a picture of a real account. The motion is one CSS animation
 * (`.marquee-track` in globals.css): each row is laid out twice and slides by exactly one copy,
 * which is why the second copy is hidden from assistive technology. Under reduced motion nothing
 * moves and the row scrolls by hand instead.
 */

type Kpi = { label: string; value: string; note: string; tone?: "positive" | "negative" };

type Sample = {
  company: string;
  trade: string;
  period: string;
  /** Stated on every board, as the product states it (ADR 0034). */
  scale: string;
  kpis: readonly [Kpi, Kpi, Kpi];
  trend: { label: string; values: readonly number[] };
  side:
    | { kind: "bars"; label: string; values: readonly number[] }
    | {
        kind: "donut";
        label: string;
        parts: readonly {
          percent: number;
          tone: "accent" | "warning" | "muted";
          name: string;
        }[];
      };
};

const ROW_ONE: readonly Sample[] = [
  {
    company: "Northwind Traders",
    trade: "Wholesale distribution",
    period: "May 2026",
    scale: "USD, thousands",
    kpis: [
      {
        label: "Revenue",
        value: "$1,432K",
        note: "↑ 11.7% vs last year",
        tone: "positive",
      },
      { label: "Gross margin", value: "33.7%", note: "↑ 1.1 pts", tone: "positive" },
      { label: "Debtor days", value: "58", note: "from 64", tone: "positive" },
    ],
    trend: {
      label: "Revenue, twelve months",
      values: [98, 104, 96, 112, 119, 108, 124, 131, 122, 136, 128, 143],
    },
    side: {
      kind: "donut",
      label: "Receivables ageing",
      parts: [
        { percent: 62, tone: "accent", name: "Current" },
        { percent: 21, tone: "muted", name: "30–60 days" },
        { percent: 17, tone: "warning", name: "60+ days" },
      ],
    },
  },
  {
    company: "Sahyadri Auto Components",
    trade: "Manufacturing",
    period: "June 2026",
    scale: "INR, lakhs",
    kpis: [
      {
        label: "Revenue",
        value: "₹482.6 L",
        note: "↑ 6.4% vs last month",
        tone: "positive",
      },
      { label: "EBITDA", value: "₹71.3 L", note: "14.8% of revenue" },
      { label: "Inventory days", value: "74", note: "from 69", tone: "negative" },
    ],
    trend: {
      label: "EBITDA margin, twelve months",
      values: [13.1, 13.4, 12.8, 13.9, 14.2, 13.6, 14.0, 14.4, 13.8, 14.5, 14.3, 14.8],
    },
    side: {
      kind: "bars",
      label: "Inventory days, six months",
      values: [66, 67, 68, 69, 72, 74],
    },
  },
  {
    company: "Harbour & Finch",
    trade: "Architecture practice",
    period: "April 2026",
    scale: "GBP, thousands",
    kpis: [
      {
        label: "Fee income",
        value: "£318K",
        note: "↑ 4.2% vs last month",
        tone: "positive",
      },
      { label: "Staff cost", value: "61.5%", note: "of fee income" },
      { label: "WIP days", value: "43", note: "from 47", tone: "positive" },
    ],
    trend: {
      label: "Fee income, twelve months",
      values: [262, 271, 268, 284, 279, 291, 288, 297, 301, 296, 305, 318],
    },
    side: {
      kind: "donut",
      label: "Income by sector",
      parts: [
        { percent: 48, tone: "accent", name: "Residential" },
        { percent: 34, tone: "muted", name: "Commercial" },
        { percent: 18, tone: "warning", name: "Public" },
      ],
    },
  },
  {
    company: "Lumen Clinics",
    trade: "Healthcare, four sites",
    period: "May 2026",
    scale: "AED, thousands",
    kpis: [
      {
        label: "Revenue",
        value: "AED 2,906K",
        note: "↑ 9.3% vs last year",
        tone: "positive",
      },
      { label: "Op. margin", value: "18.2%", note: "↓ 0.6 pts", tone: "negative" },
      { label: "Cash runway", value: "7.4 mo", note: "at current burn" },
    ],
    trend: {
      label: "Revenue, twelve months",
      values: [241, 236, 248, 252, 259, 255, 263, 270, 266, 278, 284, 291],
    },
    side: {
      kind: "bars",
      label: "Operating cost, six months",
      values: [208, 211, 214, 219, 229, 238],
    },
  },
  {
    company: "Kestrel Freight",
    trade: "Logistics",
    period: "March 2026",
    scale: "EUR, thousands",
    kpis: [
      {
        label: "Revenue",
        value: "€1,087K",
        note: "↓ 2.1% vs last month",
        tone: "negative",
      },
      { label: "Gross margin", value: "22.4%", note: "↑ 0.8 pts", tone: "positive" },
      { label: "Creditor days", value: "39", note: "from 41" },
    ],
    trend: {
      label: "Gross margin, twelve months",
      values: [20.1, 20.6, 20.2, 21.0, 21.4, 20.9, 21.3, 21.8, 21.2, 21.9, 21.6, 22.4],
    },
    side: {
      kind: "donut",
      label: "Cost of sales",
      parts: [
        { percent: 54, tone: "accent", name: "Carriers" },
        { percent: 29, tone: "muted", name: "Fuel" },
        { percent: 17, tone: "warning", name: "Customs" },
      ],
    },
  },
];

const ROW_TWO: readonly Sample[] = [
  {
    company: "Meridian Foods",
    trade: "Food processing",
    period: "June 2026",
    scale: "INR, crores",
    kpis: [
      {
        label: "Revenue",
        value: "₹18.42 Cr",
        note: "↑ 13.5% vs last year",
        tone: "positive",
      },
      { label: "Net profit", value: "₹1.26 Cr", note: "6.8% of revenue" },
      { label: "Current ratio", value: "1.62", note: "from 1.48", tone: "positive" },
    ],
    trend: {
      label: "Revenue, twelve months",
      values: [14.1, 14.6, 13.9, 15.2, 15.8, 15.1, 16.4, 16.9, 16.2, 17.5, 17.1, 18.4],
    },
    side: {
      kind: "bars",
      label: "Net profit, six months",
      values: [0.92, 0.98, 1.04, 1.01, 1.17, 1.26],
    },
  },
  {
    company: "Alder & Pike",
    trade: "Accounting firm",
    period: "May 2026",
    scale: "USD, thousands",
    kpis: [
      {
        label: "Billings",
        value: "$264K",
        note: "↑ 5.9% vs last month",
        tone: "positive",
      },
      { label: "Realisation", value: "87.3%", note: "↑ 2.4 pts", tone: "positive" },
      { label: "Lock-up days", value: "52", note: "from 61", tone: "positive" },
    ],
    trend: {
      label: "Billings, twelve months",
      values: [212, 219, 208, 226, 231, 224, 238, 243, 236, 251, 249, 264],
    },
    side: {
      kind: "donut",
      label: "Billings by service",
      parts: [
        { percent: 44, tone: "accent", name: "Compliance" },
        { percent: 37, tone: "muted", name: "Advisory" },
        { percent: 19, tone: "warning", name: "Payroll" },
      ],
    },
  },
  {
    company: "Tidewater Hotels",
    trade: "Hospitality",
    period: "April 2026",
    scale: "SGD, thousands",
    kpis: [
      {
        label: "Revenue",
        value: "S$1,754K",
        note: "↑ 8.8% vs last year",
        tone: "positive",
      },
      { label: "Occupancy", value: "27.1%", note: "of revenue" },
      {
        label: "Payroll",
        value: "S$512K",
        note: "↑ 3.0% vs last month",
        tone: "negative",
      },
    ],
    trend: {
      label: "Revenue, twelve months",
      values: [148, 152, 161, 158, 149, 143, 151, 164, 172, 169, 166, 175],
    },
    side: {
      kind: "bars",
      label: "Payroll, six months",
      values: [471, 478, 483, 490, 497, 512],
    },
  },
  {
    company: "Corvid Software",
    trade: "Subscription software",
    period: "June 2026",
    scale: "USD, thousands",
    kpis: [
      {
        label: "Recurring",
        value: "$896K",
        note: "↑ 3.7% vs last month",
        tone: "positive",
      },
      { label: "Gross margin", value: "78.9%", note: "↑ 0.4 pts", tone: "positive" },
      { label: "Net burn", value: "$142K", note: "from $171K", tone: "positive" },
    ],
    trend: {
      label: "Recurring revenue, twelve months",
      values: [612, 634, 655, 671, 698, 716, 741, 768, 793, 829, 864, 896],
    },
    side: {
      kind: "donut",
      label: "Operating spend",
      parts: [
        { percent: 51, tone: "accent", name: "Engineering" },
        { percent: 31, tone: "muted", name: "Sales" },
        { percent: 18, tone: "warning", name: "Admin" },
      ],
    },
  },
  {
    company: "Banyan Textiles",
    trade: "Garment exports",
    period: "May 2026",
    scale: "INR, lakhs",
    kpis: [
      {
        label: "Export sales",
        value: "₹936.8 L",
        note: "↑ 10.2% vs last year",
        tone: "positive",
      },
      { label: "Gross margin", value: "26.3%", note: "↓ 0.9 pts", tone: "negative" },
      { label: "Debtor days", value: "81", note: "from 77", tone: "negative" },
    ],
    trend: {
      label: "Export sales, twelve months",
      values: [712, 748, 731, 779, 802, 768, 836, 861, 829, 894, 902, 937],
    },
    side: {
      kind: "bars",
      label: "Debtor days, six months",
      values: [72, 74, 75, 77, 79, 81],
    },
  },
];

const NOTE_TONE = {
  positive: "text-positive",
  negative: "text-negative",
} as const;

function Board({ sample }: { sample: Sample }) {
  return (
    <article className="w-[26rem] shrink-0 rounded-2xl border border-neutral-200/80 bg-surface p-5 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[0.9375rem] font-semibold text-neutral-900">
            {sample.company}
          </h3>
          <p className="mt-0.5 truncate text-[0.75rem] text-neutral-500">
            {sample.trade} · {sample.period}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-neutral-200 px-2 py-0.5 text-[0.6875rem] font-medium text-neutral-600">
          {sample.scale}
        </span>
      </header>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        {sample.kpis.map((kpi) => (
          <div key={kpi.label} className="min-w-0">
            <dt className="truncate text-[0.6875rem] tracking-[0.04em] text-neutral-500 uppercase">
              {kpi.label}
            </dt>
            <dd className="mt-1 text-[1.0625rem] tabular-nums leading-tight font-semibold whitespace-nowrap text-neutral-900">
              {kpi.value}
            </dd>
            <dd
              className={`mt-0.5 truncate text-[0.6875rem] ${
                kpi.tone === undefined ? "text-neutral-500" : NOTE_TONE[kpi.tone]
              }`}
            >
              {kpi.note}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-6 border-t border-neutral-100 pt-4">
        <div className="min-w-0">
          <p className="truncate text-[0.6875rem] text-neutral-500">
            {sample.trend.label}
          </p>
          <div className="mt-2">
            <Sparkline values={sample.trend.values} width={168} height={52} />
          </div>
        </div>
        <div className="w-[9.5rem]">
          <p className="truncate text-[0.6875rem] text-neutral-500">
            {sample.side.label}
          </p>
          <div className="mt-2">
            {sample.side.kind === "bars" ? (
              <MiniBars values={sample.side.values} />
            ) : (
              <div className="flex items-center gap-2.5">
                <Donut parts={sample.side.parts} size={52} thickness={8} />
                <ul className="flex min-w-0 flex-col gap-0.5 text-[0.625rem] text-neutral-500">
                  {sample.side.parts.map((part) => (
                    <li key={part.name} className="truncate">
                      <span className="tabular-nums">{part.percent}%</span> {part.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Row({ samples, reverse }: { samples: readonly Sample[]; reverse: boolean }) {
  return (
    <div className="marquee" data-testid="dashboard-row">
      <div className={`marquee-track ${reverse ? "marquee-reverse" : ""}`}>
        {/* Laid out twice so the row can slide by one copy and meet itself without a seam. */}
        {[false, true].map((copy) => (
          <ul
            key={String(copy)}
            className="marquee-group"
            aria-hidden={copy ? true : undefined}
          >
            {samples.map((sample) => (
              <li key={sample.company}>
                <Board sample={sample} />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

export function DashboardCarousel() {
  return (
    <section
      aria-labelledby="sample-dashboards"
      className="overflow-hidden border-y border-neutral-200/70 bg-neutral-25 py-14"
      data-testid="dashboard-carousel"
    >
      <div className="mx-auto mb-8 w-full max-w-[1120px] px-6">
        <p className="eyebrow">Sample dashboards</p>
        <h2
          id="sample-dashboards"
          className="display mt-2 max-w-2xl text-[1.75rem] leading-tight font-semibold tracking-tight text-neutral-900"
        >
          Any business, its own currency, ready for the boardroom
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-neutral-600">
          Each board is built from raw data and changed by chatting with it. These
          companies are invented, and so is every figure on them.
        </p>
      </div>
      <div className="flex flex-col gap-5">
        <Row samples={ROW_ONE} reverse={false} />
        <Row samples={ROW_TWO} reverse />
      </div>
    </section>
  );
}
