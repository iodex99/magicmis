"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { Alert, Button } from "@/components/ui";
import { checkLogo, LOGO_ACCEPT, megabytes, type LogoLimits } from "@/lib/logo";

/**
 * A company's own logo beside its name: on the workspace header, in Present, on the company list.
 *
 * Contained, never cropped or stretched — a wide wordmark and a square mark both sit whole in the
 * same box — on a white tile with a hairline, because a logo is drawn for a white page and the
 * workspace may be dark (ADR 0034).
 */
export function CompanyLogo({
  src,
  name,
  size = 40,
  className = "",
}: {
  src: string;
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200/80 bg-white p-1 ${className}`}
      style={{ width: size * 1.6, height: size }}
      data-testid="company-logo"
    >
      {/* A signed-in, same-origin image of unknown proportions: the optimiser has nothing to add. */}
      <img
        src={src}
        alt={`${name} logo`}
        className="max-h-full max-w-full object-contain"
      />
    </span>
  );
}

/** Sends a logo. The server reads the bytes again and decides; this only reports what it said. */
export async function uploadLogo(
  companyId: string,
  file: Blob,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  try {
    const response = await fetch(`/api/companies/${companyId}/logo`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: file,
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as {
      url?: string;
      message?: string;
    } | null;
    if (response.ok && typeof body?.url === "string") return { ok: true, url: body.url };
    return {
      ok: false,
      message: body?.message ?? "The logo could not be saved. Try again.",
    };
  } catch {
    return {
      ok: false,
      message: "Could not reach the server. Check your connection and try again.",
    };
  }
}

/** Takes the logo off; true when the server did. */
async function removeLogo(companyId: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/companies/${companyId}/logo`, {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Reads a chosen file and runs the same check the server will, so a refusal is immediate. */
async function checked(
  file: File,
  limits: LogoLimits,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (file.size > limits.maxBytes)
    return {
      ok: false,
      message: `A logo can be at most ${megabytes(limits.maxBytes)}. Save it smaller and try again.`,
    };
  const r = checkLogo(new Uint8Array(await file.arrayBuffer()), limits);
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}

function hint(limits: LogoLimits): string {
  return `JPG, PNG or WebP, up to ${megabytes(limits.maxBytes)}. A transparent PNG looks best.`;
}

/**
 * Choosing a logo while adding a company. Nothing is sent here: the company does not exist yet,
 * so the form keeps the file and uploads it once the company is created.
 */
export function LogoPicker({
  limits,
  onChange,
  name,
}: {
  limits: LogoLimits;
  onChange: (file: File | null) => void;
  name: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (preview !== null) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  return (
    <div className="flex flex-col gap-2" data-testid="logo-picker">
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-neutral-900">
        Logo <span className="font-normal text-neutral-500">(optional)</span>
      </label>
      <div className="flex items-center gap-3">
        {preview === null ? null : <CompanyLogo src={preview} name={name || "Company"} />}
        <input
          ref={input}
          id={id}
          type="file"
          accept={LOGO_ACCEPT}
          className="block w-full text-[0.8125rem] text-neutral-600 file:mr-3 file:rounded-lg file:border file:border-neutral-200 file:bg-surface file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-medium file:text-neutral-800 hover:file:bg-neutral-25"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setError(null);
            setPreview(null);
            onChange(null);
            if (file === null) return;
            void checked(file, limits).then((r) => {
              if (!r.ok) {
                setError(r.message);
                if (input.current !== null) input.current.value = "";
                return;
              }
              setPreview(URL.createObjectURL(file));
              onChange(file);
            });
          }}
        />
        {preview === null ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setPreview(null);
              onChange(null);
              if (input.current !== null) input.current.value = "";
            }}
          >
            Remove
          </Button>
        )}
      </div>
      {error === null ? (
        <p className="text-[0.75rem] text-neutral-500">{hint(limits)}</p>
      ) : (
        <p className="text-[0.75rem] font-medium text-negative" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The logo on Files and settings: shown, replaced or taken off, each saved at once. */
export function CompanyLogoSettings({
  companyId,
  name,
  current,
  limits,
}: {
  companyId: string;
  name: string;
  current: string | null;
  limits: LogoLimits;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const done = (message: string) => {
    setBusy(false);
    setNotice(message);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3" data-testid="logo-settings">
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      {notice === null ? null : <Alert tone="success">{notice}</Alert>}
      <div className="flex flex-wrap items-center gap-4">
        {current === null ? (
          <span className="inline-flex h-12 w-[4.8rem] items-center justify-center rounded-lg border border-dashed border-neutral-300 text-[0.6875rem] text-neutral-400">
            No logo
          </span>
        ) : (
          <CompanyLogo src={current} name={name} size={48} />
        )}
        <input
          ref={input}
          type="file"
          accept={LOGO_ACCEPT}
          className="hidden"
          data-testid="logo-input"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (file === null) return;
            setError(null);
            setNotice(null);
            setBusy(true);
            void checked(file, limits)
              .then((r) => (r.ok ? uploadLogo(companyId, file) : r))
              .then((r) => {
                if (!r.ok) {
                  setBusy(false);
                  setError(r.message);
                  return;
                }
                done("Logo saved. It is on the dashboard and in Present.");
              });
          }}
        />
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon="upload"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {current === null ? "Add a logo" : "Replace"}
          </Button>
          {current === null ? null : (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setError(null);
                setNotice(null);
                setBusy(true);
                void removeLogo(companyId).then((removed) => {
                  if (removed) {
                    done("Logo removed.");
                    return;
                  }
                  setBusy(false);
                  setError("The logo could not be removed. Try again.");
                });
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      <p className="text-[0.75rem] text-neutral-500">{hint(limits)}</p>
    </div>
  );
}
