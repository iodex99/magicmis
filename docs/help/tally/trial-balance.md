# Trial Balance

The ledger balances every MIS is built from. Needed for company setup and every monthly refresh.

## Where to find it

**TODO(review): R-07** — TallyPrime menu path to be verified and added.

## Settings that work best

- Period: the full month (or the financial year to date for setup).
- Detail: ledger level, with groups shown, so every ledger sits under its group.
- Columns: Opening Balance, Transactions (Debit and Credit) and Closing Balance.
- Keep Debit and Credit as separate columns if the option is offered.

## Export

- Export to Excel (.xlsx). CSV also works.
- Export the report as shown; do not edit, re-sort or delete rows afterwards.
- One report per file is simplest; a workbook with several sheets is also read.

## What we handle for you

- Title rows (company name, period) above the header are expected.
- Groups may be shown by indentation, by a level or group column, or with subtotal rows.
- Grand Total rows are recognised and never counted as data.

## If a file is refused

- Only .xlsx, .xlsm, .xls and .csv files are accepted. Macros are never run.
- Very large files: split the period into smaller exports.
