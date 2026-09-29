import { describe, expect, it } from "vitest";

import {
  trialAnswer,
  welcomeBand,
  welcomeCreditsLabel,
  welcomeLine,
} from "./welcome-copy";

// ADR 0068: the site's claims about welcome credits are built from the live offer, so each must
// say exactly what holds — and nothing at all about free credits once the offer is off.
describe("welcome credit copy", () => {
  const covers = { credits: 1500n, coversFirstCompany: true };
  const short = { credits: 500n, coversFirstCompany: false };
  const off = { credits: 0n, coversFirstCompany: false };

  it("names the configured grant, grouped as credits are everywhere else", () => {
    expect(welcomeCreditsLabel(covers)).toBe("1,500 free credits");
    expect(welcomeBand(covers)).toBe("1,500 free credits to start. No card needed.");
    expect(welcomeLine(covers)).toBe(
      "Start with 1,500 free credits, enough to set up your first company on your own books. No card needed.",
    );
    expect(trialAnswer(covers)).toMatch(
      /^New accounts start with 1,500 free credits, enough/u,
    );
  });

  it("claims a first company only while the price book makes it true", () => {
    expect(welcomeLine(short)).toBe("Start with 500 free credits. No card needed.");
    expect(trialAnswer(short)).not.toContain("enough");
  });

  it("says plainly that it is paid when the offer is off", () => {
    expect(welcomeCreditsLabel(off)).toBeNull();
    expect(welcomeLine(off)).toBeNull();
    expect(welcomeBand(off)).toBeNull();
    expect(trialAnswer(off)).toMatch(/^No\./u);
    expect(trialAnswer(off)).not.toContain("free credits");
  });
});
