/**
 * A large synthetic Day Book workbook for the SPEC §33 performance target (50 MB xlsx parsed
 * and loaded into DuckDB in under 60 seconds). Deterministic; roughly 136 bytes per row once
 * compressed, so ~370,000 rows make ~50 MB.
 */

import * as XLSX from "xlsx";

export function largeDayBookXlsx(rows: number): Uint8Array {
  const types = ["Sales", "Purchase", "Receipt", "Payment", "Journal"];
  const data: (XLSX.CellObject | undefined)[][] = [
    [{ t: "s", v: "Synthetic Hardware Traders Pvt Ltd" }],
    [{ t: "s", v: "Day Book" }],
    [{ t: "s", v: "1-Apr-25 to 31-Mar-26" }],
    [],
    [
      "Date",
      "Particulars",
      "Vch Type",
      "Vch No.",
      "Debit Amount",
      "Credit Amount",
      "Narration",
    ].map((v): XLSX.CellObject => ({ t: "s", v })),
  ];
  for (let i = 0; i < rows; i += 1) {
    data.push([
      { t: "n", v: 45748 + (i % 365), z: "d-mmm-yy" },
      {
        t: "s",
        v: `Ledger ${((i * 7919) % 5000).toString()} ${((i * 104729) % 99991).toString(36)}`,
      },
      { t: "s", v: types[i % 5] ?? "Journal" },
      { t: "s", v: `V/${i.toString()}` },
      { t: "n", v: ((i * 2654435761) % 10000000) / 100, z: "#,##0.00" },
      { t: "n", v: ((i * 40503) % 9000000) / 100, z: "#,##0.00" },
      {
        t: "s",
        v: `Being entry ${(i * 6700417).toString(36)} ref ${(i * 31).toString(16)}`,
      },
    ]);
  }
  const ws = {
    "!data": data,
    "!ref": XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: data.length - 1, c: 6 },
    }),
  } as unknown as XLSX.WorkSheet;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Day Book");
  return new Uint8Array(
    XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer,
  );
}
