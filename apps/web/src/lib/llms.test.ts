import { describe, expect, it } from "vitest";

import { llmsTxt } from "./llms";
import { PUBLIC_PAGES } from "./seo";

const OFFER = { credits: 1500n, coversFirstCompany: true };

describe("llms.txt (https://llmstxt.org)", () => {
  it("opens with the H1 and the blockquote summary the format requires", () => {
    const lines = llmsTxt(false, OFFER).split("\n");
    expect(lines[0]).toMatch(/^# \S/u);
    expect(lines[2]).toMatch(/^> \S/u);
  });

  it("uses only H2 sections after the H1, each a list of markdown links", () => {
    const body = llmsTxt(true, OFFER);
    expect(body.match(/^#{1} /gmu)).toHaveLength(1);
    expect(body).not.toMatch(/^#{3,} /mu);
    for (const heading of ["## Product", "## Solutions", "## Guides", "## Optional"])
      expect(body).toContain(heading);
    const links = body.split("\n").filter((l) => l.startsWith("- ["));
    for (const l of links) expect(l).toMatch(/^- \[[^\]]+\]\([^)]+\): \S/u);
  });

  it("lists every public page in the full form, so a new page cannot miss it", () => {
    const body = llmsTxt(true, OFFER);
    for (const page of PUBLIC_PAGES.filter((p) => p.path !== "/"))
      expect(body, page.path).toContain(`(${page.path})`);
  });

  it("names no vendor and no part of the stack (ADR 0042)", () => {
    expect(llmsTxt(true, OFFER)).not.toMatch(
      /anthropic|claude|openai|supabase|vercel|postgres|razorpay/iu,
    );
  });

  it("states the welcome offer as it stands, and says plainly when it is off (ADR 0068)", () => {
    expect(llmsTxt(true, OFFER)).toContain("New accounts start with 1,500 free credits");
    const off = llmsTxt(true, { credits: 0n, coversFirstCompany: false });
    expect(off).not.toContain("free credits");
    expect(off).toContain(
      "anything that analyses your own data is paid from prepaid credits",
    );
    expect(off).not.toMatch(/quote first\. No\./u);
  });
});
