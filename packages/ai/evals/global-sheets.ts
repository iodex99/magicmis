/**
 * Sheets as other markets' accounting software exports them (ADR 0087): synthetic, in the
 * general shape of a US or UK small business's reports rather than a copy of any product's file,
 * and labelled by construction — each is written as the report it is said to be.
 *
 * The fixture generator writes Indian books in TallyPrime's layouts, so until these every sheet
 * the classification stage was measured on came from one country and one program. The product is
 * sold everywhere, and a sheet the rules cannot place is exactly the case that reaches the model.
 */

import type { ClassifySheetsOutput } from "../src/stages";

type ReportType = ClassifySheetsOutput["sheets"][number]["report_type"];

export interface GlobalSheet {
  readonly id: string;
  readonly report: ReportType;
  readonly csv: string;
}

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

export const GLOBAL_SHEETS: readonly GlobalSheet[] = [
  {
    id: "us-trial-balance",
    report: "trial_balance",
    csv: lines(
      "Account,Debit,Credit",
      "Checking,48210.55,",
      "Savings,120000.00,",
      "Accounts Receivable (A/R),35640.20,",
      "Inventory Asset,22100.00,",
      "Furniture and Equipment,18400.00,",
      "Accounts Payable (A/P),,15230.75",
      "Sales Tax Payable,,2890.40",
      "Opening Balance Equity,,150000.00",
      "Owner's Equity,,20000.00",
      "Sales,,98765.43",
      "Cost of Goods Sold,41200.10,",
      "Payroll Expenses,22300.00,",
      "Rent Expense,6000.00,",
      "Utilities,1250.33,",
      "Advertising,1784.40,",
    ),
  },
  {
    id: "uk-trial-balance-with-codes",
    report: "trial_balance",
    csv: lines(
      "Account Code,Account,Account Type,Debit,Credit",
      "090,Business Bank Account,Bank,25410.00,",
      "610,Accounts Receivable,Current Asset,18250.40,",
      "630,Inventory,Inventory,9800.00,",
      "710,Office Equipment,Fixed Asset,6400.00,",
      "800,Accounts Payable,Current Liability,,12340.10",
      "820,VAT,Current Liability,,4120.00",
      "825,PAYE Payable,Current Liability,,2210.55",
      "970,Funds Introduced,Equity,,30000.00",
      "200,Sales,Revenue,,64230.70",
      "310,Cost of Goods Sold,Direct Costs,28400.20,",
      "477,Wages and Salaries,Expense,17800.00,",
      "469,Rent,Expense,4500.00,",
      "404,Bank Fees,Expense,140.75,",
    ),
  },
  {
    id: "us-profit-and-loss",
    report: "profit_and_loss",
    csv: lines(
      "Account,Total",
      "Income,",
      "Sales,98765.43",
      "Services,12400.00",
      "Total Income,111165.43",
      "Cost of Goods Sold,41200.10",
      "Gross Profit,69965.33",
      "Expenses,",
      "Payroll Expenses,22300.00",
      "Rent Expense,6000.00",
      "Utilities,1250.33",
      "Total Expenses,29550.33",
      "Net Income,40415.00",
    ),
  },
  {
    id: "uk-balance-sheet",
    report: "balance_sheet",
    csv: lines(
      "Account,31 Mar 2026",
      "Fixed Assets,",
      "Office Equipment,6400.00",
      "Current Assets,",
      "Business Bank Account,25410.00",
      "Accounts Receivable,18250.40",
      "Total Current Assets,43660.40",
      "Current Liabilities,",
      "Accounts Payable,12340.10",
      "VAT,4120.00",
      "Net Current Assets,27200.30",
      "Net Assets,33600.30",
      "Equity,",
      "Funds Introduced,30000.00",
      "Current Year Earnings,3600.30",
      "Total Equity,33600.30",
    ),
  },
  {
    id: "aged-receivables",
    report: "bills_receivable",
    csv: lines(
      "Customer,Current,1 - 30 Days,31 - 60 Days,61 - 90 Days,Older,Total",
      "Harbourside Cafe,4200.00,1300.00,,,,5500.00",
      "Meadow Lane Florists,,2150.00,980.00,,,3130.00",
      "Northgate Builders,7600.00,,,1200.00,,8800.00",
      "Pine Street Dental,1850.00,640.00,,,,2490.00",
      "Riverbend Motors,,,3200.00,,4100.00,7300.00",
      "Total,13650.00,4090.00,4180.00,1200.00,4100.00,27220.00",
    ),
  },
  {
    id: "aged-payables",
    report: "bills_payable",
    csv: lines(
      "Supplier,Current,< 1 Month,1 Month,2 Months,Older,Total",
      "Coastal Paper Supplies,1250.00,,,,,1250.00",
      "Greenline Logistics,,3400.00,1100.00,,,4500.00",
      "Metro Office Lease,2500.00,,,,,2500.00",
      "Summit Packaging,,980.00,,760.00,,1740.00",
      "Total,3750.00,4380.00,1100.00,760.00,,9990.00",
    ),
  },
  {
    id: "us-payroll-summary",
    report: "pay_sheet",
    csv: lines(
      "Employee,Job Title,Gross Pay,Federal Tax,Social Security,Medicare,Net Pay",
      "Employee A,Store Manager,5200.00,624.00,322.40,75.40,4178.20",
      "Employee B,Sales Associate,3100.00,310.00,192.20,44.95,2552.85",
      "Employee C,Sales Associate,3050.00,305.00,189.10,44.23,2511.67",
      "Employee D,Bookkeeper,3800.00,418.00,235.60,55.10,3091.30",
      "Employee E,Warehouse Lead,3400.00,357.00,210.80,49.30,2782.90",
    ),
  },
  {
    id: "us-sales-by-invoice",
    report: "sales_register",
    csv: lines(
      "Date,Invoice No.,Customer,Amount,Sales Tax,Total",
      "03/02/2026,1041,Harbourside Cafe,1200.00,99.00,1299.00",
      "03/05/2026,1042,Northgate Builders,4800.00,396.00,5196.00",
      "03/09/2026,1043,Pine Street Dental,640.00,52.80,692.80",
      "03/14/2026,1044,Riverbend Motors,2300.00,189.75,2489.75",
      "03/21/2026,1045,Meadow Lane Florists,980.00,80.85,1060.85",
      "03/28/2026,1046,Harbourside Cafe,1500.00,123.75,1623.75",
    ),
  },
];
