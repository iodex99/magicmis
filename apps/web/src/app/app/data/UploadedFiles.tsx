"use client";

import { useState } from "react";

import { Alert, Button, DataTable, EmptyState, Panel, Td, Th, Tr } from "@/components/ui";
import { removeUpload } from "@/lib/uploads";

export interface UploadedFileRow {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly company: string;
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

export function UploadedFiles({ files }: { files: readonly UploadedFileRow[] }) {
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

  return (
    <div className="flex flex-col gap-4">
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      <Panel title="Kept on our servers" icon="lock" padding="none">
        {list.length === 0 ? (
          <EmptyState icon="file" title="No files kept">
            Files appear here when you upload them on a company&rsquo;s Run page.
          </EmptyState>
        ) : (
          <DataTable
            testId="uploaded-files"
            className="px-2 pb-2"
            head={
              <>
                <Th>File</Th>
                <Th>Company</Th>
                <Th numeric>Size</Th>
                <Th>Uploaded</Th>
                <Th>Deleted on</Th>
                <Th />
              </>
            }
          >
            {list.map((f) => (
              <Tr key={f.id}>
                <Td className="font-medium text-neutral-900">
                  {f.name}
                  {f.usable ? null : (
                    <span className="block text-[0.75rem] font-normal text-neutral-500">
                      Could not be read
                    </span>
                  )}
                </Td>
                <Td>{f.company}</Td>
                <Td numeric>{bytes(f.size)}</Td>
                <Td>{day(f.uploadedAt)}</Td>
                <Td>{day(f.deletesAt)}</Td>
                <Td className="text-right">
                  <Button
                    variant="secondary"
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
        )}
      </Panel>
    </div>
  );
}
