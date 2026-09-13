/**
 * Three fictional companies (SPEC §16): trading, professional services, manufacturing.
 * Names, addresses, GSTINs and people are invented; GSTINs are generated with a valid
 * checksum over fictional PANs so detectors see realistic shapes.
 */

import { gstinCheckCharacter } from "@magicmis/core/identifiers";

import type { CompanySpec, Employee, GroupDef, LedgerDef, StockItem } from "./model";

const rs = (rupees: number): bigint => BigInt(rupees) * 100n;

/** GSTIN over a fictional PAN (`AAACN1234K`): state + PAN + entity "1" + "Z" + check character. */
export function fictionalGstin(stateCode: string, pan: string): string {
  const body = `${stateCode}${pan}1Z`;
  return body + gstinCheckCharacter(body);
}

/** Custom groups the companies create beneath Tally's predefined groups. */
const COMMON_GROUPS: readonly GroupDef[] = [
  { name: "Administrative Expenses", parent: "Indirect Expenses", nature: "expense" },
  { name: "Employee Costs", parent: "Indirect Expenses", nature: "expense" },
];

function parties(
  prefix: string,
  names: readonly [string, string, string][],
  group: "Sundry Debtors" | "Sundry Creditors",
): LedgerDef[] {
  return names.map(([name, state, pan], i) => ({
    id: `${prefix}${(i + 1).toString()}`,
    name,
    group,
    opening: 0n,
    stateCode: state,
    gstin: fictionalGstin(state, pan),
  }));
}

const EMPLOYEES = (prefix: string, count: number): Employee[] =>
  Array.from({ length: count }, (_, i) => ({
    code: `${prefix}${(101 + i).toString()}`,
    name: `Employee ${String.fromCharCode(65 + i)} ${prefix}`,
    designation:
      ["Accountant", "Associate", "Executive", "Supervisor", "Analyst", "Assistant"][
        i % 6
      ] ?? "Associate",
    basic: rs(18000 + i * 3500),
    hra: rs(7200 + i * 1400),
  }));

function balanceOpenings(ledgers: LedgerDef[], balancingId: string): LedgerDef[] {
  const sum = ledgers.reduce((s, l) => s + l.opening, 0n);
  return ledgers.map((l) =>
    l.id === balancingId ? { ...l, opening: l.opening - sum } : l,
  );
}

export function tradingCompany(): CompanySpec {
  const items: StockItem[] = [
    { name: "Steel Brackets 40mm", unit: "Nos", rate: rs(85) },
    { name: "Aluminium Channel 2m", unit: "Nos", rate: rs(410) },
    { name: "Fastener Kit Type-B", unit: "Box", rate: rs(1250) },
    { name: "Hinge Assembly HD", unit: "Nos", rate: rs(230) },
  ];
  const ledgers: LedgerDef[] = [
    { id: "cap", name: "Capital - Partners", group: "Capital Account", opening: 0n },
    {
      id: "bank",
      name: "Synthetic Bank Current A/c",
      group: "Bank Accounts",
      opening: rs(850000),
    },
    { id: "cash", name: "Cash", group: "Cash-in-hand", opening: rs(25000) },
    {
      id: "furn",
      name: "Furniture & Fixtures",
      group: "Fixed Assets",
      opening: rs(360000),
    },
    { id: "veh", name: "Delivery Vehicle", group: "Fixed Assets", opening: rs(640000) },
    {
      id: "dep_paid",
      name: "Security Deposit",
      group: "Deposits (Asset)",
      opening: rs(150000),
    },
    {
      id: "dep_recd",
      name: "Security Deposit",
      group: "Current Liabilities",
      opening: rs(-60000),
    },
    { id: "stock", name: "Closing Stock", group: "Stock-in-hand", opening: rs(420000) },
    {
      id: "loan",
      name: "Loan from Partner",
      group: "Unsecured Loans",
      opening: rs(-300000),
    },
    { id: "ocgst", name: "Output CGST", group: "Duties & Taxes", opening: 0n },
    { id: "osgst", name: "Output SGST", group: "Duties & Taxes", opening: 0n },
    { id: "oigst", name: "Output IGST", group: "Duties & Taxes", opening: 0n },
    { id: "icgst", name: "Input CGST", group: "Duties & Taxes", opening: 0n },
    { id: "isgst", name: "Input SGST", group: "Duties & Taxes", opening: 0n },
    { id: "iigst", name: "Input IGST", group: "Duties & Taxes", opening: 0n },
    { id: "tds", name: "TDS Payable", group: "Duties & Taxes", opening: 0n },
    { id: "salpay", name: "Salary Payable", group: "Provisions", opening: 0n },
    { id: "sales", name: "Sales - Hardware", group: "Sales Accounts", opening: 0n },
    { id: "purch", name: "Purchase - Hardware", group: "Purchase Accounts", opening: 0n },
    { id: "freight", name: "Freight Inward", group: "Direct Expenses", opening: 0n },
    {
      id: "inv_change",
      name: "Changes in Inventory",
      group: "Direct Expenses",
      opening: 0n,
    },
    { id: "rent", name: "Warehouse Rent", group: "Administrative Expenses", opening: 0n },
    {
      id: "print",
      name: "Printing & Stationery",
      group: "Administrative Expenses",
      opening: 0n,
    },
    {
      id: "phone",
      name: "Telephone & Internet",
      group: "Administrative Expenses",
      opening: 0n,
    },
    { id: "salary", name: "Salaries & Wages", group: "Employee Costs", opening: 0n },
    { id: "depn", name: "Depreciation", group: "Indirect Expenses", opening: 0n },
    { id: "intinc", name: "Interest Received", group: "Indirect Incomes", opening: 0n },
    ...parties(
      "d",
      [
        ["Northwind Hardware Stores", "27", "AAACN1234K"],
        ["Bluegate Fabrication Works", "27", "AABCB2345L"],
        ["Crestline Interiors Pvt Ltd", "29", "AACCC3456M"],
        ["Duneview Builders LLP", "24", "AADFD4567N"],
        [
          "Eastbay Modular Kitchens Private Limited - Pune Branch Office",
          "27",
          "AAECE5678P",
        ],
      ],
      "Sundry Debtors",
    ),
    ...parties(
      "c",
      [
        ["Foundry Supply Co", "27", "AAFCF6789Q"],
        ["Greenfield Metals", "33", "AAGCG7890R"],
        ["Harbor Logistics", "27", "AAHCH8901S"],
      ],
      "Sundry Creditors",
    ),
  ];
  return {
    id: "trading",
    kind: "trading",
    name: "Synthetic Hardware Traders Pvt Ltd",
    address: "Unit 7, Example Industrial Estate, Pune 411001",
    stateCode: "27",
    booksStart: "2025-04-01",
    months: 14,
    groups: COMMON_GROUPS,
    ledgers: balanceOpenings(ledgers, "cap"),
    items,
    employees: EMPLOYEES("T", 5),
    seed: 20250401,
  };
}

export function servicesCompany(): CompanySpec {
  const ledgers: LedgerDef[] = [
    { id: "cap", name: "Partners Capital", group: "Capital Account", opening: 0n },
    {
      id: "bank",
      name: "Example Bank OD Account",
      group: "Bank OD A/c",
      opening: rs(-120000),
    },
    {
      id: "bank2",
      name: "Example Bank Savings",
      group: "Bank Accounts",
      opening: rs(540000),
    },
    { id: "cash", name: "Petty Cash", group: "Cash-in-hand", opening: rs(8000) },
    { id: "comp", name: "Computers", group: "Fixed Assets", opening: rs(290000) },
    {
      id: "tdsrec",
      name: "TDS Receivable",
      group: "Loans & Advances (Asset)",
      opening: rs(45000),
    },
    { id: "ocgst", name: "Output CGST", group: "Duties & Taxes", opening: 0n },
    { id: "osgst", name: "Output SGST", group: "Duties & Taxes", opening: 0n },
    { id: "oigst", name: "Output IGST", group: "Duties & Taxes", opening: 0n },
    { id: "icgst", name: "Input CGST", group: "Duties & Taxes", opening: 0n },
    { id: "isgst", name: "Input SGST", group: "Duties & Taxes", opening: 0n },
    { id: "iigst", name: "Input IGST", group: "Duties & Taxes", opening: 0n },
    { id: "tds", name: "TDS Payable", group: "Duties & Taxes", opening: 0n },
    { id: "salpay", name: "Salary Payable", group: "Provisions", opening: 0n },
    { id: "sales", name: "Professional Fees", group: "Sales Accounts", opening: 0n },
    {
      id: "purch",
      name: "Subcontracted Services",
      group: "Direct Expenses",
      opening: 0n,
    },
    {
      id: "freight",
      name: "Software Subscriptions",
      group: "Direct Expenses",
      opening: 0n,
    },
    { id: "rent", name: "Office Rent", group: "Administrative Expenses", opening: 0n },
    {
      id: "print",
      name: "Printing & Stationery",
      group: "Administrative Expenses",
      opening: 0n,
    },
    {
      id: "phone",
      name: "Telephone & Internet",
      group: "Administrative Expenses",
      opening: 0n,
    },
    { id: "salary", name: "Staff Salaries", group: "Employee Costs", opening: 0n },
    { id: "depn", name: "Depreciation", group: "Indirect Expenses", opening: 0n },
    { id: "intinc", name: "Interest on Savings", group: "Indirect Incomes", opening: 0n },
    ...parties(
      "d",
      [
        ["Aurora Retail Ventures", "27", "AAJCA1122T"],
        ["Brightpath Education Trust", "07", "AAKTB2233U"],
        ["Cobalt Health Clinics", "29", "AALCC3344V"],
        ["Delta Agro Processors", "27", "AAMCD4455W"],
      ],
      "Sundry Debtors",
    ),
    ...parties(
      "c",
      [
        ["Freelance Design Collective", "27", "AANFF5566X"],
        ["Cloudstack Hosting", "29", "AAPCC6677Y"],
      ],
      "Sundry Creditors",
    ),
  ];
  return {
    id: "services",
    kind: "services",
    name: "Synthetic Advisory Services LLP",
    address: "4th Floor, Sample Chambers, Mumbai 400001",
    stateCode: "27",
    booksStart: "2025-04-01",
    months: 14,
    groups: COMMON_GROUPS,
    ledgers: balanceOpenings(ledgers, "cap"),
    items: [],
    employees: EMPLOYEES("S", 6),
    seed: 20250402,
  };
}

export function manufacturingCompany(): CompanySpec {
  const groups: GroupDef[] = [
    ...COMMON_GROUPS,
    { name: "Manufacturing Expenses", parent: "Direct Expenses", nature: "expense" },
  ];
  const ledgers: LedgerDef[] = [
    { id: "cap", name: "Share Capital", group: "Capital Account", opening: 0n },
    {
      id: "res",
      name: "General Reserve",
      group: "Reserves & Surplus",
      opening: rs(-400000),
    },
    {
      id: "bank",
      name: "Synthetic Bank Cash Credit",
      group: "Bank Accounts",
      opening: rs(700000),
    },
    { id: "cash", name: "Cash", group: "Cash-in-hand", opening: rs(15000) },
    {
      id: "plant",
      name: "Plant & Machinery",
      group: "Fixed Assets",
      opening: rs(2400000),
    },
    { id: "stock", name: "Closing Stock", group: "Stock-in-hand", opening: rs(900000) },
    {
      id: "term",
      name: "Term Loan - Example Bank",
      group: "Secured Loans",
      opening: rs(-1500000),
    },
    { id: "ocgst", name: "Output CGST", group: "Duties & Taxes", opening: 0n },
    { id: "osgst", name: "Output SGST", group: "Duties & Taxes", opening: 0n },
    { id: "oigst", name: "Output IGST", group: "Duties & Taxes", opening: 0n },
    { id: "icgst", name: "Input CGST", group: "Duties & Taxes", opening: 0n },
    { id: "isgst", name: "Input SGST", group: "Duties & Taxes", opening: 0n },
    { id: "iigst", name: "Input IGST", group: "Duties & Taxes", opening: 0n },
    { id: "tds", name: "TDS Payable", group: "Duties & Taxes", opening: 0n },
    { id: "salpay", name: "Wages Payable", group: "Provisions", opening: 0n },
    { id: "sales", name: "Sales - Finished Goods", group: "Sales Accounts", opening: 0n },
    {
      id: "purch",
      name: "Purchase - Raw Material",
      group: "Purchase Accounts",
      opening: 0n,
    },
    { id: "freight", name: "Power & Fuel", group: "Manufacturing Expenses", opening: 0n },
    {
      id: "inv_change",
      name: "Changes in Inventory",
      group: "Manufacturing Expenses",
      opening: 0n,
    },
    { id: "rent", name: "Factory Rent", group: "Manufacturing Expenses", opening: 0n },
    {
      id: "print",
      name: "Printing & Stationery",
      group: "Administrative Expenses",
      opening: 0n,
    },
    {
      id: "phone",
      name: "Telephone & Internet",
      group: "Administrative Expenses",
      opening: 0n,
    },
    { id: "salary", name: "Factory Wages", group: "Employee Costs", opening: 0n },
    { id: "depn", name: "Depreciation", group: "Indirect Expenses", opening: 0n },
    {
      id: "intinc",
      name: "Interest on Fixed Deposit",
      group: "Indirect Incomes",
      opening: 0n,
    },
    ...parties(
      "d",
      [
        ["Kestrel Appliances", "27", "AAQCK7788Z"],
        ["Larkspur Distributors", "36", "AARCL8899A"],
        ["Meridian Exports", "27", "AASCM9900B"],
      ],
      "Sundry Debtors",
    ),
    ...parties(
      "c",
      [
        ["Nimbus Polymers", "27", "AATCN1011C"],
        ["Orion Steel Rolling", "20", "AAUCO1112D"],
        ["Pinecrest Packaging", "27", "AAVCP1213E"],
      ],
      "Sundry Creditors",
    ),
  ];
  return {
    id: "manufacturing",
    kind: "manufacturing",
    name: "Synthetic Components Manufacturing Ltd",
    address: "Plot 21, Sample MIDC, Nashik 422001",
    stateCode: "27",
    booksStart: "2025-04-01",
    months: 14,
    groups,
    ledgers: balanceOpenings(ledgers, "cap"),
    items: [
      { name: "Moulded Housing A1", unit: "Nos", rate: rs(145) },
      { name: "Moulded Housing B2", unit: "Nos", rate: rs(210) },
      { name: "PP Granules (Raw)", unit: "Kg", rate: rs(118) },
    ],
    employees: EMPLOYEES("M", 6),
    seed: 20250403,
  };
}

export const COMPANIES = (): CompanySpec[] => [
  tradingCompany(),
  servicesCompany(),
  manufacturingCompany(),
];
