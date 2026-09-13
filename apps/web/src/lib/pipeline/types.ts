/**
 * Messages between the job page and the pipeline worker. Before payment only file names, sizes,
 * sheet counts and row counts cross to the page (SPEC §2.3); recognition, mappings, findings and
 * outputs cross only once the job is reserved.
 */

import type { SizeDescriptors } from "@magicmis/ai/estimator";
import type { CheckResult, SnapshotPayload } from "@magicmis/engine";
import type { IngestLimits } from "@magicmis/ingest";
import type { Confidence, MappingRules, ReviewRow } from "@magicmis/semantic";
import type { ReferenceLayout, RowBinding } from "@magicmis/templates";

import type { JobSession } from "../server/companies";

export interface PipelineFileSummary {
  readonly name: string;
  readonly size: number;
  readonly sheets: number;
  readonly rows: number;
}

export interface PricingInputs {
  readonly size: SizeDescriptors;
  /** Sheet signature hashes, matched against the blueprint on the server. Not shown to the user. */
  readonly fingerprints: Readonly<Record<string, string>>;
}

export interface MapResult {
  readonly reviewRows: readonly ReviewRow[];
  readonly unmatched: readonly {
    ref: string;
    name: string;
    group_path: readonly string[];
  }[];
}

export interface ComputeResult {
  readonly checks: readonly CheckResult[];
  readonly blocking: readonly CheckResult[];
  readonly failureClass: "data_fault" | "platform_fault" | null;
  readonly period: string;
  readonly fileName: string;
  readonly workbookBase64: string;
  readonly snapshot: SnapshotPayload;
  readonly blueprint: {
    readonly templateSpec: unknown;
    readonly recipe: unknown;
    readonly mappingRules: MappingRules;
    readonly sourceFingerprints: Readonly<Record<string, string>>;
  } | null;
  readonly accountRules: readonly { pattern: string; head: string }[];
}

/** A reference MIS row for binding review, with names rehydrated for this session only. */
export interface ReferenceReviewRow {
  readonly ref: string;
  readonly sheet: string;
  readonly label: string;
  readonly bold: boolean;
  readonly indent: number;
  readonly hasValues: boolean;
  readonly binding: RowBinding;
  /** Labels of subtotal terms, for display. */
  readonly termLabels: readonly string[];
}

export interface PipelineApi {
  start(session: JobSession, limits: IngestLimits): Promise<void>;
  addFiles(
    files: File[],
  ): Promise<{ added: PipelineFileSummary[]; refused: string | null }>;
  /** A reference MIS to recreate (SPEC §22): only its name, size and sheet count before payment. */
  addReference(
    file: File,
  ): Promise<{ summary: PipelineFileSummary | null; refused: string | null }>;
  pricingInputs(): Promise<PricingInputs>;
  /** After reservation: the reference layout with labels redacted, for the server. */
  referenceLayout(): Promise<ReferenceLayout | null>;
  referenceReview(bindings: readonly RowBinding[]): Promise<readonly ReferenceReviewRow[]>;
  /** The reviewed bindings become this job's template. */
  useReferenceBindings(bindings: readonly RowBinding[]): Promise<void>;
  /** After reservation: redacted structures for sheets deterministic detection could not read. */
  unrecognisedSheets(): Promise<number>;
  map(): Promise<MapResult>;
  applyAi(
    answers: readonly { ref: string; head: string | null; confidence: Confidence }[],
  ): Promise<MapResult>;
  compute(input: {
    confirmed: readonly {
      ledgerKey: string;
      head: string;
      applyToAllCompanies: boolean;
    }[];
    unmappedAccepted: boolean;
    tierLabel: string;
  }): Promise<ComputeResult>;
  clear(): Promise<void>;
}
