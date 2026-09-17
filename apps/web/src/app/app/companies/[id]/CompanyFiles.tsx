"use client";

import { useState } from "react";

import { Alert, Button, DataTable, EmptyState, Td, Th, Tr } from "@/components/ui";
import { removeUpload } from "@/lib/uploads";

export interface CompanyFileRow {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly usable: boolean;
  readonly uploadedAt: string;
  readonly deletesAt: string;
}

const bytes = (n: number): string =>
  n >= 1_048_576
    ? `${(n / 1_048_576).toFixed(1)} MB`
    : n >= 1024
      ? `${(n / 1024).toFixed(0)} KB`
      : `${n.toString()} B`;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * The files this company still keeps on our servers (ADR 0032), each with its automatic deletion
 * date and a way to delete it sooner. Names and sizes only.
 */
export function CompanyFiles({ files }: { files: readonly CompanyFileRow[] }) {
  const [list, setList] = useState(files);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const remove = async (id: string) => {
    setError(null);
    setDeleting(id);
    try {
      await removeUpload(id);
      setList((l) => l.filter((f) => f.id !== id));
    } catch {
      setError("That file could not be deleted. Try again.");
    } finally {
      setDeleting(null);
    }
  };

  if (list.length === 0)
    return (
      <EmptyState icon="lock" title="No files kept">
        Files you upload for this company appear here until they are deleted.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-3">
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      <DataTable
        testId="uploaded-files"
        className="px-2 pb-2"
        maxHeight="20rem"
        head={
          <>
            <Th>File</Th>
            <Th numeric>Size</Th>
            <Th>Deleted on</Th>
            <Th />
          </>
        }
      >
        {list.map((f) => (
          <Tr key={f.id}>
            <Td className="font-medium text-neutral-900">
              {f.name}
              <span className="block text-[0.75rem] font-normal text-neutral-500">
                {f.usable
                  ? `Uploaded ${day(f.uploadedAt)}`
                  : `Could not be read · ${day(f.uploadedAt)}`}
              </span>
            </Td>
            <Td numeric>{bytes(f.size)}</Td>
            <Td className="whitespace-nowrap">{day(f.deletesAt)}</Td>
            <Td className="text-right">
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                disabled={deleting !== null}
                onClick={() => void remove(f.id)}
              >
                {deleting === f.id ? "Deleting…" : "Delete now"}
              </Button>
            </Td>
          </Tr>
        ))}
      </DataTable>
    </div>
  );
}
