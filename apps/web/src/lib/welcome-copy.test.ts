import { describe, expect, it } from "vitest";

import {
  trialAnswer,
  welcomeBand,
  welcomeClosing,
  welcomeConditions,
  welcomeCreditsLabel,
  welcomeLine,
} from "./welcome-copy";

// ADR 0068, ADR 0072: the site's claims about welcome credits are built from the live offer, so
// each must say exactly what holds — its conditions beside it — and nothing at all about free
// credits once the offer is off.
describe("welcome credit copy", () => {
  const covers = { credits: 1500n, coversFirstCompany: true };
  const short = { credits: 500n, coversFirstCompany: false };
  const off = { credits: 0n, coversFirstCompany: false };

  it("names the configured grant, grouped as credits are everywhere else", () => {
    expect(welcomeCreditsLabel(covers)).toBe("1,500 free credits");
    expect(welcomeBand(covers)).toBe("1,500 free credits to start. No card needed.");
    expect(welcomeLine(covers)).toBe(
      "Start with 1,500 free credits, enough to set up your first company at its standard price. No card needed.",
    );
    expect(trialAnswer(covers)).toMatch(
      /^New accounts start with 1,500 free credits, enough to set up one company on your own books at its standard price/u,
    );
  });

  it("puts who it is for, and what is paid after it, beside every claim", () => {
    for (const text of [
      welcomeConditions(covers),
      trialAnswer(covers),
      welcomeClosing(covers),
    ]) {
      expect(text).toContain("per person or business");
      expect(text).toContain("monthly memory fee");
    }
    expect(welcomeConditions(covers)).toContain("not for throwaway email addresses");
  });

  it("claims a first company only while the price book makes it true", () => {
    expect(welcomeLine(short)).toBe("Start with 500 free credits. No card needed.");
    expect(trialAnswer(short)).not.toContain("enough");
    expect(welcomeClosing(short)).not.toContain("enough");
  });

  it("says plainly that it is paid when the offer is off", () => {
    expect(welcomeCreditsLabel(off)).toBeNull();
    expect(welcomeLine(off)).toBeNull();
    expect(welcomeBand(off)).toBeNull();
    expect(welcomeConditions(off)).toBeNull();
    expect(welcomeClosing(off)).toBeNull();
    expect(trialAnswer(off)).toMatch(/^No\./u);
    expect(trialAnswer(off)).not.toContain("free credits");
  });
});
