"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import { Icon } from "./Icon";

/**
 * The one place a file enters the app (ADR 0031).
 *
 * Dropping a file used to change nothing on screen until parsing finished, so it was easy to
 * believe the drop had missed. The zone now answers each moment: it lifts and changes colour
 * while a file is over it, says "Drop to add", shows that it is reading, and confirms with the
 * number of files added. The whole zone is a button, so a click or Enter opens the file picker
 * too; the input stays in the page for assistive technology and tests.
 *
 * Any file type is offered. What a file is gets decided from its contents, and a file that
 * cannot be read comes back with a reason rather than being greyed out in the picker.
 */
export function FileDropZone({
  onFiles,
  inputLabel,
  title,
  hint,
  disabled = false,
  busy = false,
  multiple = true,
  compact = false,
  testId,
}: {
  onFiles: (files: File[]) => void | Promise<void>;
  /** The file input's accessible name. */
  inputLabel: string;
  title: string;
  hint?: string;
  disabled?: boolean;
  /** Files are being read: the zone shows progress and still accepts more. */
  busy?: boolean;
  multiple?: boolean;
  compact?: boolean;
  testId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire for every child element; a depth count keeps the state steady.
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const [added, setAdded] = useState<number | null>(null);
  // Busy changes what the zone shows, never whether it accepts: a second drop while the
  // first is still being read is queued by the worker, not silently ignored.
  const inactive = disabled;

  const take = async (list: FileList | null) => {
    const files = list === null ? [] : [...list];
    if (files.length === 0 || inactive) return;
    setAdded(null);
    await onFiles(multiple ? files : files.slice(0, 1));
    setAdded(multiple ? files.length : 1);
    window.setTimeout(() => {
      setAdded(null);
    }, 2400);
    if (input.current) input.current.value = "";
  };

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    if (inactive) return;
    depth.current += 1;
    setOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    void take(e.dataTransfer.files);
  };
  const onKey = (e: KeyboardEvent) => {
    if (inactive) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.current?.click();
    }
  };

  const tone = over
    ? "border-accent-500 bg-accent-50 ring-4 ring-accent-100 scale-[1.015] shadow-md"
    : added !== null
      ? "border-positive bg-positive-subtle"
      : "border-neutral-200 bg-neutral-25 hover:border-accent-300 hover:bg-accent-50/40";

  return (
    <div
      role="button"
      tabIndex={inactive ? -1 : 0}
      aria-disabled={inactive}
      aria-label={title}
      data-testid={testId}
      data-dragging={over ? "true" : undefined}
      onClick={() => {
        if (!inactive) input.current?.click();
      }}
      onKeyDown={onKey}
      onDragEnter={onDragEnter}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = inactive ? "none" : "copy";
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-center transition-all duration-200 ease-out outline-none focus-visible:ring-4 focus-visible:ring-accent-200 motion-reduce:transition-none motion-reduce:hover:scale-100 ${
        compact ? "px-4 py-4" : "px-6 py-8"
      } ${tone} ${inactive ? "cursor-not-allowed opacity-70" : ""}`}
    >
      <span
        className={`flex items-center justify-center rounded-full transition-all duration-200 ${
          compact ? "h-9 w-9" : "h-12 w-12"
        } ${
          over
            ? "-translate-y-1 bg-accent-600 text-white motion-reduce:translate-y-0"
            : added !== null
              ? "bg-positive text-white"
              : "bg-accent-50 text-accent-600"
        }`}
      >
        <Icon
          name={busy ? "loader" : added !== null ? "check" : "upload"}
          size={compact ? 17 : 21}
          className={busy ? "animate-spin [animation-duration:1.6s]" : ""}
        />
      </span>
      <p
        className={`font-semibold text-neutral-900 ${compact ? "text-[0.8125rem]" : "text-[0.9375rem]"}`}
        aria-live="polite"
      >
        {over
          ? "Drop to add"
          : busy
            ? "Reading your files…"
            : added !== null
              ? `${added.toString()} ${added === 1 ? "file" : "files"} added`
              : title}
      </p>
      {hint === undefined || over || busy ? null : (
        <p className="max-w-md text-[0.75rem] leading-relaxed text-neutral-500">{hint}</p>
      )}
      {over || busy ? null : (
        <span className="mt-1 inline-flex h-8 items-center rounded-md bg-accent-600 px-3 text-[0.8125rem] font-medium text-white shadow-sm">
          Choose {multiple ? "files" : "a file"}
        </span>
      )}
      <input
        ref={input}
        type="file"
        multiple={multiple}
        aria-label={inputLabel}
        disabled={inactive}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
        }}
        onChange={(e) => void take(e.target.files)}
        className="sr-only"
      />
    </div>
  );
}
