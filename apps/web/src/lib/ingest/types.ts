/**
 * Messages between the page and the ingestion worker. Summaries carry only what SPEC §2.3
 * allows before payment: file name, size, sheet count and row counts.
 */

import type { DateOrder } from "@magicmis/core/time";
import type { IngestLimits } from "@magicmis/ingest";

export interface FileSummary {
  readonly fileId: string;
  readonly name: string;
  readonly size: number;
  readonly sheets: readonly { readonly rows: number }[];
}

export type IngestStage = "queued" | "reading" | "parsing" | "loading" | "done" | "error";

export interface IngestProgress {
  readonly name: string;
  readonly stage: IngestStage;
  /** 0–100 within the file. */
  readonly percent: number;
  /** A plain reason for `error`, never cell content. */
  readonly message?: string;
}

export interface IngestApi {
  configure(
    limits: IngestLimits,
    caps: { sampleRowsPerSheet: number; distinctValuesPerColumn: number },
    /**
     * How this company's exports write ambiguous numeric dates (ADR 0030). Every date
     * column is checked against it as the file loads, and a contradiction refuses the
     * file — reading 03/04 the wrong way round moves a month of entries and leaves
     * every total still balancing.
     */
    dateOrder: DateOrder,
  ): Promise<void>;
  addFiles(
    files: File[],
    onProgress: (p: IngestProgress) => void,
  ): Promise<FileSummary[]>;
  summaries(): Promise<FileSummary[]>;
  clear(): Promise<void>;
}
