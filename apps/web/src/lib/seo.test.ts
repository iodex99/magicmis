import { DEVICE_AGNOSTIC_PATHS, isDeviceAgnosticPath } from "@magicmis/accounts/desktop";
import { describe, expect, it } from "vitest";

import { PUBLIC_PAGES, absoluteUrl, publicPage } from "./seo";

/**
 * The public site's invariants (plan: docs/plans/seo-marketing.md).
 *
 * Each of these has a specific failure in mind. They are cheap to assert and expensive to
 * notice in production, because every one of them fails silently: a page that is not in the
 * sitemap is simply never crawled, and a page missing from the device list simply shows the
 * wrong screen to a visitor who came from search on a phone.
 */

describe("public pages", () => {
  it("is reachable on a phone — the desktop gate must not swallow a search result", () => {
    // The whole cost of ranking for "MIS report format in excel" is paid at this bounce:
    // a reader arrives on a phone, meets "desktop required", and leaves.
    for (const page of PUBLIC_PAGES) {
      expect(isDeviceAgnosticPath(page.path), `${page.path} shows the desktop gate`).toBe(
        true,
      );
    }
  });

  it("keeps the app itself desktop-only", () => {
    // The mirror of the rule above: opening the gate too wide is the other failure.
    for (const path of ["/app", "/app/companies", "/wallet", "/settings/profile"]) {
      expect(isDeviceAgnosticPath(path), path).toBe(false);
    }
  });

  it("lists no device-agnostic marketing path that has no page", () => {
    // `DEVICE_AGNOSTIC_PATHS` also carries help, legal and webhook prefixes, which are
    // directories rather than pages; the marketing entries must all resolve.
    // `/samples` serves the downloadable sample workbook and `/og` the share cards (ADR
    // 0038): files a phone must be able to fetch, not pages.
    const prefixes = [
      "/help",
      "/legal",
      "/desktop-required",
      "/api/webhooks",
      "/samples",
      "/og",
      "/llms.txt",
      "/llms-full.txt",
      "/.well-known",
    ];
    const known = new Set(PUBLIC_PAGES.map((p) => p.path));
    for (const path of DEVICE_AGNOSTIC_PATHS) {
      if (prefixes.includes(path)) continue;
      expect(known.has(path), `${path} is device-agnostic but has no PublicPage`).toBe(
        true,
      );
    }
  });

  it("gives every page a title and description within what a search result shows", () => {
    for (const page of PUBLIC_PAGES) {
      // Google truncates around 60 characters of title and 160 of description. Over that
      // is not an error, but it means the end of the sentence is never read.
      expect(page.title.length, `${page.path} title`).toBeLessThanOrEqual(75);
      expect(page.title.length, `${page.path} title`).toBeGreaterThan(5);
      expect(page.description.length, `${page.path} description`).toBeLessThanOrEqual(
        190,
      );
      expect(page.description.length, `${page.path} description`).toBeGreaterThan(50);
    }
  });

  it("has no duplicate path, title or description", () => {
    // Duplicates are how two pages compete for one query and neither wins.
    for (const key of ["path", "title", "description"] as const) {
      const values = PUBLIC_PAGES.map((p) => p[key]);
      expect(new Set(values).size, `duplicate ${key}`).toBe(values.length);
    }
  });

  it("throws rather than guessing when a page is missing", () => {
    // A silent fallback here would put the wrong canonical on a page, which tells a
    // crawler the real content lives somewhere else.
    expect(() => publicPage("/not-a-page")).toThrow(/no PublicPage/u);
  });
});

describe("absolute URLs", () => {
  it("does not double the slash on the home page", () => {
    // `${origin}/` + "/" is the classic way a canonical ends up pointing at `//`.
    const origin = process.env["NEXT_PUBLIC_APP_URL"] ?? "";
    expect(absoluteUrl("/")).toBe(origin.replace(/\/+$/u, ""));
    expect(absoluteUrl("/pricing").endsWith("//pricing")).toBe(false);
  });

  it("keeps one slash between origin and path", () => {
    for (const page of PUBLIC_PAGES) {
      const url = absoluteUrl(page.path);
      expect(url.includes("//") ? url.indexOf("//") : 0, page.path).toBeLessThan(8);
    }
  });
});
