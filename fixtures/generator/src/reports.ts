/**
 * Tally-like report layouts from generated books, with the export quirks of SPEC §16 as
 * options. Layouts are modelled on TallyPrime's exported reports but are not copies of any
 * real export; exact TallyPrime layouts are a review item (R-07).
 */

import type { Books, MonthBalance } from "./books";
import { addMonths, daysInMonth, dayOf, monthKey, type Voucher } from "./model";
import { tallyDate, type Grouping, type Out, type Table } from "./table";

/** Tally prints liabilities before assets, then P&L groups. */
const PRIMARY_ORDER = [
  "Capital Account",
  "Loans (Liability)",
  "Current Liabilities",
  "Suspense A/c",
  "Fixed Assets",
  "Investments",
  "Current Assets",
  "Misc. Expenses (ASSET)",
  "Sales Accounts",
  "Direct Incomes",
  "Purchase Accounts",
  "Direct Expenses",
  "Indirect Incomes",
  "Indirect Expenses",
];

export const PL_LEDGER = "Profit & Loss A/c";

const firstMonth = (books: Books): string => {
  const m = books.months[0];
  if (m === undefined) throw new Error("books have no months");
  return m;
};

const isPl = (books: Books, id: string) => {
  const n = books.nature(id);
  return n === "income" || n === "expense";
};

const fyStartMonth = (m: string): string => {
  const mo = Number.parseInt(m.slice(5), 10);
  const y = Number.parseInt(m.slice(0, 4), 10);
  return `${(mo >= 4 ? y : y - 1).toString()}-04`;
};

/**
 * A ledger's balance as a Tally report shows it for a period: P&L ledgers restart at the
 * financial year, carrying earlier years into the Profit & Loss A/c line.
 */
export function reportBalance(
  books: Books,
  id: string,
  from: string,
  to: string,
): MonthBalance {
  const per = books.balances.get(id);
  const first = per?.get(from);
  const last = per?.get(to);
  if (!first || !last) throw new Error(`no balance for ${id}`);
  let debit = 0n;
  let credit = 0n;
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    debit += per?.get(m)?.debit ?? 0n;
    credit += per?.get(m)?.credit ?? 0n;
  }
  let opening = first.opening;
  if (isPl(books, id)) {
    const fyStart = fyStartMonth(from);
    // In the first financial year of the books the cumulative balance already starts there.
    if (fyStart > firstMonth(books))
      opening -= per?.get(addMonths(fyStart, -1))?.closing ?? 0n;
  }
  return { opening, debit, credit, closing: opening + debit - credit };
}

/** The Profit & Loss A/c line: P&L results of financial years closed before `from`. */
export function plCarried(books: Books, from: string): bigint {
  const fyStart = fyStartMonth(from);
  if (fyStart <= firstMonth(books)) return 0n;
  const prior = addMonths(fyStart, -1);
  let sum = 0n;
  for (const l of books.company.ledgers) {
    if (isPl(books, l.id)) sum += books.balances.get(l.id)?.get(prior)?.closing ?? 0n;
  }
  return sum;
}

interface TreeNode {
  name: string;
  kind: "group" | "ledger";
  children: TreeNode[];
  bal: MonthBalance;
  ledgerId?: string;
}

const zero: MonthBalance = { opening: 0n, debit: 0n, credit: 0n, closing: 0n };
const addBal = (a: MonthBalance, b: MonthBalance): MonthBalance => ({
  opening: a.opening + b.opening,
  debit: a.debit + b.debit,
  credit: a.credit + b.credit,
  closing: a.closing + b.closing,
});
const isZero = (b: MonthBalance) =>
  b.opening === 0n && b.debit === 0n && b.credit === 0n && b.closing === 0n;

export function balanceTree(
  books: Books,
  from: string,
  to: string,
  filter?: (ledgerId: string) => boolean,
  closingOnly = false,
): TreeNode[] {
  const roots: TreeNode[] = [];
  const find = (list: TreeNode[], name: string) => {
    let n = list.find((x) => x.kind === "group" && x.name === name);
    if (!n) {
      n = { name, kind: "group", children: [], bal: zero };
      list.push(n);
    }
    return n;
  };
  for (const l of books.company.ledgers) {
    if (filter && !filter(l.id)) continue;
    const bal = reportBalance(books, l.id, from, to);
    // Closing-only layouts omit ledgers with a nil closing balance, as Tally does.
    if (isZero(bal) || (closingOnly && bal.closing === 0n)) continue;
    let level = roots;
    const chain: TreeNode[] = [];
    for (const g of books.groupPath(l.id)) {
      const node = find(level, g);
      chain.push(node);
      level = node.children;
    }
    level.push({ name: l.name, kind: "ledger", children: [], bal, ledgerId: l.id });
    for (const node of chain) node.bal = addBal(node.bal, bal);
  }
  const carried = filter ? 0n : plCarried(books, from);
  if (carried !== 0n)
    roots.push({
      name: PL_LEDGER,
      kind: "ledger",
      children: [],
      bal: { opening: carried, debit: 0n, credit: 0n, closing: carried },
    });
  roots.sort((a, b) => {
    const ia = PRIMARY_ORDER.indexOf(a.name);
    const ib = PRIMARY_ORDER.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return roots;
}

export type TbLayout = "indent" | "level_column" | "subtotal_rows" | "parent_column";

export interface TbOptions {
  readonly layout: TbLayout;
  readonly amounts: "split" | "suffix";
  readonly columns: "closing" | "full";
  readonly grouping: Grouping;
  readonly wrapLongNames?: boolean;
  readonly truncateLongNames?: boolean;
  readonly blankSeparators?: boolean;
  readonly title?: string;
  /** Alter one group total by this many paise (broken variant). */
  readonly corruptSubtotal?: bigint;
  /** Alter one ledger closing by this many paise (broken variant). */
  readonly corruptLedger?: bigint;
}

function titleRows(books: Books, title: string, periodText: string): Out[][] {
  return [[books.company.name], [books.company.address], [title], [periodText], []];
}

const periodText = (from: string, to: string) =>
  `${tallyDate(dayOf(from, 1))} to ${tallyDate(dayOf(to, daysInMonth(to)))}`;

export function trialBalance(
  books: Books,
  from: string,
  to: string,
  o: TbOptions,
): Table {
  const rows: Out[][] = titleRows(
    books,
    o.title ?? "Trial Balance",
    periodText(from, to),
  );
  const merges: { r: number; c: number; r2: number; c2: number }[] = [];
  const lead: string[] =
    o.layout === "level_column"
      ? ["Level"]
      : o.layout === "parent_column"
        ? ["Group"]
        : [];
  const fields: { key: keyof MonthBalance; label: string }[] =
    o.columns === "full"
      ? [
          { key: "opening", label: "Opening Balance" },
          { key: "debit", label: "Transactions" },
          { key: "closing", label: "Closing Balance" },
        ]
      : [{ key: "closing", label: "Closing Balance" }];

  const h1: Out[] = [...lead, "Particulars"];
  const h2: Out[] = [...lead.map(() => ""), ""];
  for (const f of fields) {
    if (o.amounts === "split" || f.key === "debit") {
      const c = h1.length;
      h1.push(f.label, "");
      h2.push(
        f.key === "debit" ? "Debit" : "Debit",
        f.key === "debit" ? "Credit" : "Credit",
      );
      merges.push({ r: rows.length, c, r2: rows.length, c2: c + 1 });
    } else {
      h1.push(f.label);
      h2.push("");
    }
  }
  const singleRow = o.amounts === "suffix" && o.columns === "closing";
  rows.push(h1);
  if (!singleRow) rows.push(h2);
  else merges.length = 0;

  const cells = (bal: MonthBalance): Out[] => {
    const out: Out[] = [];
    for (const f of fields) {
      if (f.key === "debit") {
        out.push(
          bal.debit === 0n ? null : { amount: bal.debit },
          bal.credit === 0n ? null : { amount: bal.credit },
        );
        continue;
      }
      const v = bal[f.key];
      if (o.amounts === "split")
        out.push(v > 0n ? { amount: v } : null, v < 0n ? { amount: -v } : null);
      else
        out.push(
          v === 0n ? null : { amount: v < 0n ? -v : v, side: v < 0n ? "cr" : "dr" },
        );
    }
    return out;
  };

  let corruptedGroup = false;
  let corruptedLedger = false;
  const LONG = 40;
  const emit = (node: TreeNode, depth: number, parents: string[]) => {
    let bal = node.bal;
    if (
      node.kind === "group" &&
      o.corruptSubtotal !== undefined &&
      !corruptedGroup &&
      depth === 0
    ) {
      bal = { ...bal, closing: bal.closing + o.corruptSubtotal };
      corruptedGroup = true;
    }
    if (node.kind === "ledger" && o.corruptLedger !== undefined && !corruptedLedger) {
      bal = { ...bal, closing: bal.closing + o.corruptLedger };
      corruptedLedger = true;
    }
    let name = node.name;
    if (o.truncateLongNames && name.length > LONG) name = `${name.slice(0, LONG - 3)}...`;
    const pre = (): Out[] =>
      o.layout === "level_column"
        ? [String(depth)]
        : o.layout === "parent_column"
          ? [parents[parents.length - 1] ?? ""]
          : [];
    const indentName = (n: string) =>
      o.layout === "indent" ? `${"  ".repeat(depth)}${n}` : n;

    if (o.layout === "parent_column") {
      if (node.kind === "ledger") rows.push([...pre(), name, ...cells(bal)]);
      for (const c of node.children) emit(c, depth + 1, [...parents, node.name]);
      return;
    }
    if (o.layout === "subtotal_rows") {
      if (node.kind === "group") {
        rows.push([name]);
        for (const c of node.children) emit(c, depth + 1, [...parents, node.name]);
        rows.push(["Total", ...cells(bal)]);
        if (o.blankSeparators && depth === 0) rows.push([]);
      } else rows.push([name, ...cells(bal)]);
      return;
    }
    if (o.wrapLongNames && node.kind === "ledger" && name.length > LONG) {
      const cut = name.lastIndexOf(" ", LONG);
      rows.push([...pre(), indentName(name.slice(0, cut))]);
      rows.push([...pre(), indentName(name.slice(cut + 1)), ...cells(bal)]);
    } else {
      rows.push([...pre(), indentName(name), ...cells(bal)]);
    }
    for (const c of node.children) emit(c, depth + 1, [...parents, node.name]);
    if (o.blankSeparators && depth === 0) rows.push([]);
  };
  const tree = balanceTree(books, from, to, undefined, o.columns === "closing");
  for (const n of tree) emit(n, 0, []);

  const total = tree.reduce((s, n) => addBal(s, n.bal), zero);
  const grand: Out[] = [...lead.map(() => ""), "Grand Total"];
  for (const f of fields) {
    if (f.key === "debit") {
      grand.push({ amount: total.debit }, { amount: total.credit });
      continue;
    }
    // Grand totals print each side's sum.
    const dr = tree.reduce((s, n) => s + (n.bal[f.key] > 0n ? n.bal[f.key] : 0n), 0n);
    const cr = tree.reduce((s, n) => s + (n.bal[f.key] < 0n ? -n.bal[f.key] : 0n), 0n);
    if (o.amounts === "split") grand.push({ amount: dr }, { amount: cr });
    else grand.push({ amount: dr, side: "dr" });
  }
  rows.push(grand);
  return { sheetName: "Trial Balance", rows, merges, grouping: o.grouping };
}

/** Group Summary for one group (e.g. Sundry Debtors): its ledgers' closing balances. */
export function groupSummary(
  books: Books,
  group: string,
  month: string,
  grouping: Grouping,
): Table {
  const rows: Out[][] = titleRows(
    books,
    `Group Summary: ${group}`,
    periodText(month, month),
  );
  rows.push(["Particulars", "Closing Balance", ""], ["", "Debit", "Credit"]);
  let dr = 0n;
  let cr = 0n;
  for (const l of books.company.ledgers.filter((x) => x.group === group)) {
    const b = reportBalance(books, l.id, month, month).closing;
    if (b === 0n) continue;
    rows.push([l.name, b > 0n ? { amount: b } : null, b < 0n ? { amount: -b } : null]);
    if (b > 0n) dr += b;
    else cr -= b;
  }
  rows.push(["Grand Total", { amount: dr }, { amount: cr }]);
  return {
    sheetName: "Group Summary",
    rows,
    merges: [{ r: 5, c: 1, r2: 5, c2: 2 }],
    grouping,
  };
}

/** First month of the financial-year-to-date period ending `month` (not before the books start). */
export function fyToDateStart(books: Books, month: string): string {
  return fyStartMonth(month) < firstMonth(books)
    ? firstMonth(books)
    : fyStartMonth(month);
}

/** P&L for the financial year to date ending `month`, horizontal or vertical. */
export function profitAndLoss(
  books: Books,
  month: string,
  layout: "horizontal" | "vertical",
  grouping: Grouping,
): { table: Table; netProfit: bigint } {
  const from =
    fyStartMonth(month) < firstMonth(books) ? firstMonth(books) : fyStartMonth(month);
  const tree = balanceTree(books, from, month, (id) => isPl(books, id));
  const side = (natures: readonly string[]) =>
    tree.filter((n) => natures.includes(n.name));
  const expenses = side(["Purchase Accounts", "Direct Expenses", "Indirect Expenses"]);
  const incomes = side(["Sales Accounts", "Direct Incomes", "Indirect Incomes"]);
  const expTotal = expenses.reduce((s, n) => s + n.bal.closing, 0n);
  const incTotal = incomes.reduce((s, n) => s - n.bal.closing, 0n);
  const netProfit = incTotal - expTotal;

  const lines = (nodes: TreeNode[], sign: 1n | -1n): Out[][] => {
    const out: Out[][] = [];
    const walk = (n: TreeNode, depth: number) => {
      const v = n.bal.closing * sign;
      out.push(
        n.kind === "group"
          ? [`${"  ".repeat(depth)}${n.name}`, null, { amount: v }]
          : [`${"  ".repeat(depth)}${n.name}`, { amount: v }, null],
      );
      for (const c of n.children) walk(c, depth + 1);
    };
    for (const n of nodes) walk(n, 0);
    return out;
  };
  const expLines = lines(expenses, 1n);
  const incLines = lines(incomes, -1n);
  if (netProfit >= 0n) expLines.push(["Nett Profit", null, { amount: netProfit }]);
  else incLines.push(["Nett Loss", null, { amount: -netProfit }]);
  const total = netProfit >= 0n ? incTotal : expTotal;

  const title = titleRows(books, "Profit & Loss A/c", periodText(from, month));
  if (layout === "horizontal") {
    const rows: Out[][] = [...title, ["Particulars", "", "", "Particulars", "", ""]];
    const n = Math.max(expLines.length, incLines.length);
    for (let i = 0; i < n; i += 1)
      rows.push([
        ...(expLines[i] ?? [null, null, null]),
        ...(incLines[i] ?? [null, null, null]),
      ]);
    rows.push(["Total", null, { amount: total }, "Total", null, { amount: total }]);
    return { table: { sheetName: "Profit & Loss", rows, grouping }, netProfit };
  }
  const rows: Out[][] = [
    ...title,
    ["Particulars", "", "Amount"],
    ["Income"],
    ...incLines.filter((l) => l[0] !== "Nett Loss"),
    ["Expenses"],
    ...expLines.filter((l) => l[0] !== "Nett Profit"),
  ];
  rows.push([
    netProfit >= 0n ? "Nett Profit" : "Nett Loss",
    null,
    { amount: netProfit >= 0n ? netProfit : -netProfit },
  ]);
  return { table: { sheetName: "Profit & Loss", rows, grouping }, netProfit };
}

/** Balance Sheet as at the end of `month`. */
export function balanceSheet(
  books: Books,
  month: string,
  grouping: Grouping,
): { table: Table; total: bigint } {
  const from = firstMonth(books);
  const tree = balanceTree(books, from, month, (id) => !isPl(books, id));
  // Profit to date across all years not yet closed into capital: the whole P&L since books start.
  let profit = 0n;
  for (const l of books.company.ledgers)
    if (isPl(books, l.id)) profit -= books.balances.get(l.id)?.get(month)?.closing ?? 0n;
  const liabilities = tree.filter((n) =>
    [
      "Capital Account",
      "Loans (Liability)",
      "Current Liabilities",
      "Suspense A/c",
      "Branch / Divisions",
    ].includes(n.name),
  );
  const assets = tree.filter((n) => !liabilities.includes(n));
  const lines = (nodes: TreeNode[], sign: 1n | -1n): Out[][] => {
    const out: Out[][] = [];
    const walk = (n: TreeNode, depth: number) => {
      const v = n.bal.closing * sign;
      out.push(
        n.kind === "group"
          ? [`${"  ".repeat(depth)}${n.name}`, null, { amount: v }]
          : [`${"  ".repeat(depth)}${n.name}`, { amount: v }, null],
      );
      for (const c of n.children) walk(c, depth + 1);
    };
    for (const n of nodes) walk(n, 0);
    return out;
  };
  const liab = lines(liabilities, -1n);
  liab.push([PL_LEDGER, null, { amount: profit }]);
  const ast = lines(assets, 1n);
  const total = assets.reduce((s, n) => s + n.bal.closing, 0n);
  const rows: Out[][] = [
    [books.company.name],
    [books.company.address],
    ["Balance Sheet"],
    [`as at ${tallyDate(dayOf(month, daysInMonth(month)))}`],
    [],
    ["Particulars", "", "", "Particulars", "", ""],
  ];
  const n = Math.max(liab.length, ast.length);
  for (let i = 0; i < n; i += 1)
    rows.push([...(liab[i] ?? [null, null, null]), ...(ast[i] ?? [null, null, null])]);
  rows.push(["Total", null, { amount: total }, "Total", null, { amount: total }]);
  return { table: { sheetName: "Balance Sheet", rows, grouping }, total };
}

const inRange = (v: Voucher, fromDay: string, toDay: string) =>
  v.date >= fromDay && v.date <= toDay;

/** Day Book: first line of each voucher carries date, type and number. */
export function dayBook(
  books: Books,
  fromDay: string,
  toDay: string,
  grouping: Grouping,
): Table {
  const rows: Out[][] = [
    [books.company.name],
    [books.company.address],
    ["Day Book"],
    [`${tallyDate(fromDay)} to ${tallyDate(toDay)}`],
    [],
  ];
  rows.push([
    "Date",
    "Particulars",
    "Vch Type",
    "Vch No.",
    "Debit Amount",
    "Credit Amount",
  ]);
  for (const v of books.vouchers.filter((x) => inRange(x, fromDay, toDay))) {
    v.entries.forEach((e, i) => {
      const lead: Out[] = i === 0 ? [{ date: v.date }] : [null];
      rows.push([
        ...lead,
        books.ledger(e.ledger).name,
        i === 0 ? v.type : null,
        i === 0 ? v.number : null,
        e.amount > 0n ? { amount: e.amount } : null,
        e.amount < 0n ? { amount: -e.amount } : null,
      ]);
    });
  }
  return { sheetName: "Day Book", rows, grouping };
}

/** Ledger Vouchers for one ledger in a month, with opening and closing balance rows. */
export function ledgerVouchers(
  books: Books,
  ledgerId: string,
  month: string,
  grouping: Grouping,
): Table {
  const l = books.ledger(ledgerId);
  const bal = reportBalance(books, ledgerId, month, month);
  const rows: Out[][] = [
    [books.company.name],
    [`Ledger: ${l.name}`],
    [periodText(month, month)],
    [],
  ];
  rows.push(["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit"]);
  rows.push([
    null,
    "Opening Balance",
    null,
    null,
    bal.opening > 0n ? { amount: bal.opening } : null,
    bal.opening < 0n ? { amount: -bal.opening } : null,
  ]);
  for (const v of books.vouchers.filter(
    (x) => monthKey(x.date) === month && x.entries.some((e) => e.ledger === ledgerId),
  )) {
    const own = v.entries
      .filter((e) => e.ledger === ledgerId)
      .reduce((s, e) => s + e.amount, 0n);
    const other = v.entries.find((e) => e.ledger !== ledgerId);
    rows.push([
      { date: v.date },
      other ? books.ledger(other.ledger).name : "",
      v.type,
      v.number,
      own > 0n ? { amount: own } : null,
      own < 0n ? { amount: -own } : null,
    ]);
  }
  rows.push([
    null,
    "Current Total",
    null,
    null,
    { amount: bal.debit },
    { amount: bal.credit },
  ]);
  rows.push([
    null,
    "Closing Balance",
    null,
    null,
    bal.closing > 0n ? { amount: bal.closing } : null,
    bal.closing < 0n ? { amount: -bal.closing } : null,
  ]);
  return { sheetName: "Ledger Vouchers", rows, grouping };
}

export function register(
  books: Books,
  kind: "Sales" | "Purchase",
  month: string,
  grouping: Grouping,
): Table {
  const rows: Out[][] = [
    [books.company.name],
    [`${kind} Register`],
    [periodText(month, month)],
    [],
  ];
  rows.push([
    "Date",
    "Particulars",
    "Voucher Type",
    "Voucher No.",
    "GSTIN/UIN",
    "Taxable Value",
    "CGST",
    "SGST",
    "IGST",
    "Gross Total",
  ]);
  for (const v of books.vouchers.filter(
    (x) => x.type === kind && monthKey(x.date) === month,
  )) {
    const party = v.party ? books.ledger(v.party) : null;
    const t = v.taxable ?? 0n;
    const g = t + (v.cgst ?? 0n) + (v.sgst ?? 0n) + (v.igst ?? 0n);
    rows.push([
      { date: v.date },
      party?.name ?? "",
      kind,
      v.number,
      party?.gstin ?? null,
      { amount: t },
      v.cgst ? { amount: v.cgst } : null,
      v.sgst ? { amount: v.sgst } : null,
      v.igst ? { amount: v.igst } : null,
      { amount: g },
    ]);
  }
  return { sheetName: `${kind} Register`, rows, grouping };
}

export function outstandingBills(
  books: Books,
  side: "receivable" | "payable",
  month: string,
  grouping: Grouping,
  partyHeadings: boolean,
): Table {
  const asAt = dayOf(month, daysInMonth(month));
  const open = books.bills.filter(
    (b) =>
      b.side === side && b.date <= asAt && (b.settledOn === null || b.settledOn > asAt),
  );
  const rows: Out[][] = [
    [books.company.name],
    [side === "receivable" ? "Bills Receivable" : "Bills Payable"],
    [`as at ${tallyDate(asAt)}`],
    [],
  ];
  const overdue = (due: string) =>
    Math.max(
      0,
      Math.floor(
        (Date.parse(`${asAt}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000,
      ),
    );
  const suffix = side === "receivable" ? "dr" : "cr";
  if (partyHeadings) {
    rows.push([
      "Date",
      "Ref. No.",
      "Party's Name",
      "Pending Amount",
      "Due on",
      "Overdue by days",
    ]);
    const parties = [...new Set(open.map((b) => b.party))];
    for (const p of parties) {
      rows.push([null, null, books.ledger(p).name, null, null, null]);
      for (const b of open.filter((x) => x.party === p))
        rows.push([
          { date: b.date },
          b.ref,
          null,
          { amount: b.amount, side: suffix },
          { date: b.dueDate },
          String(overdue(b.dueDate)),
        ]);
    }
  } else {
    rows.push([
      "Date",
      "Ref. No.",
      "Party's Name",
      "Pending Amount",
      "Due on",
      "Overdue by days",
    ]);
    for (const b of open)
      rows.push([
        { date: b.date },
        b.ref,
        books.ledger(b.party).name,
        { amount: b.amount, side: suffix },
        { date: b.dueDate },
        String(overdue(b.dueDate)),
      ]);
  }
  return {
    sheetName: side === "receivable" ? "Bills Receivable" : "Bills Payable",
    rows,
    grouping,
  };
}

export function stockSummary(books: Books, month: string, grouping: Grouping): Table {
  const rows: Out[][] = [
    [books.company.name],
    ["Stock Summary"],
    [periodText(month, month)],
    [],
  ];
  rows.push(["Particulars", "Closing Quantity", "Rate", "Value"]);
  let total = 0n;
  for (const s of books.stock.get(month) ?? []) {
    rows.push([
      s.item,
      `${s.quantity.toString()} ${s.unit}`,
      { amount: s.rate },
      { amount: s.value },
    ]);
    total += s.value;
  }
  rows.push(["Grand Total", null, null, { amount: total }]);
  return { sheetName: "Stock Summary", rows, grouping };
}

export function paySheet(books: Books, month: string, grouping: Grouping): Table {
  const rows: Out[][] = [
    [books.company.name],
    ["Pay Sheet"],
    [periodText(month, month)],
    [],
  ];
  rows.push([
    "Employee Name",
    "Designation",
    "Basic",
    "HRA",
    "Gross Earnings",
    "PF",
    "TDS",
    "Net Pay",
  ]);
  for (const p of books.payroll.get(month) ?? []) {
    rows.push([
      p.name,
      p.designation,
      { amount: p.basic },
      { amount: p.hra },
      { amount: p.gross },
      { amount: p.pf },
      { amount: p.tds },
      { amount: p.net },
    ]);
  }
  return { sheetName: "Pay Sheet", rows, grouping };
}
