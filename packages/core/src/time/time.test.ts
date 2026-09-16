import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { calendarDate, daysInMonth, formatIso, isLeapYear } from "./calendar-date";
import { checkDateOrder, detectDateOrder } from "./detect-date-order";
import {
  formatIstDate,
  formatIstDateTime,
  formatIstIso,
  fromIstParts,
  istCalendarDate,
  IST_OFFSET_MINUTES,
  toIstParts,
} from "./ist";
import {
  calendarDateToExcelSerial,
  excelSerialToCalendarDate,
  expandTwoDigitYear,
  parseCellDate,
  parseDate,
  parseDayFirst,
} from "./parse-date";
import {
  addMonths,
  financialYearLabel,
  financialYearOf,
  isInFinancialYear,
  periodDiff,
  periodEndDate,
  periodId,
  periodOf,
  periodRange,
  periodsInFinancialYear,
  parsePeriodId,
  sameMonthLastYear,
  yearToDate,
} from "./period";

describe("day-first parsing (SPEC §2.14 — never month-first)", () => {
  it("reads an ambiguous numeric date as day-first", () => {
    // The whole point. In a US locale Date.parse() calls this 4 January.
    expect(parseDayFirst("01/04/2025")).toEqual({ year: 2025, month: 4, day: 1 });
    expect(parseDayFirst("01-04-2025")).toEqual({ year: 2025, month: 4, day: 1 });
    expect(parseDayFirst("01.04.2025")).toEqual({ year: 2025, month: 4, day: 1 });
  });

  it("reads every ambiguous day-month pair as day-first, with no value-based heuristic", () => {
    // A heuristic that flips when it sees a value above 12 gets these wrong silently.
    for (let day = 1; day <= 12; day++) {
      for (let month = 1; month <= 12; month++) {
        const s = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/2025`;
        expect(parseDayFirst(s), s).toEqual({ year: 2025, month, day });
      }
    }
  });

  it("parses the Tally export formats from SPEC §15", () => {
    expect(parseDayFirst("1-Apr-25")).toEqual({ year: 2025, month: 4, day: 1 });
    expect(parseDayFirst("01-04-2025")).toEqual({ year: 2025, month: 4, day: 1 });
    expect(parseDayFirst("01/04/2025")).toEqual({ year: 2025, month: 4, day: 1 });
    expect(parseDayFirst("31-Mar-26")).toEqual({ year: 2026, month: 3, day: 31 });
  });

  it("parses named months in long and short form, any case", () => {
    for (const s of ["1 April 2025", "1-apr-2025", "01.APR.2025", "1-Apr-2025"]) {
      expect(parseDayFirst(s), s).toEqual({ year: 2025, month: 4, day: 1 });
    }
    expect(parseDayFirst("15-Sept-2025")).toEqual({ year: 2025, month: 9, day: 15 });
  });

  it("treats a 4-digit leading group as ISO, which is unambiguous", () => {
    expect(parseDayFirst("2025-04-01")).toEqual({ year: 2025, month: 4, day: 1 });
  });

  it("returns null rather than guessing on invalid or unrecognised input", () => {
    for (const bad of [
      "13/13/2025", // no 13th month
      "32/01/2025", // no 32nd day
      "29/02/2025", // 2025 is not a leap year
      "31/04/2025", // April has 30 days
      "01/04/25/06",
      "April 2025",
      "not a date",
      "",
      "   ",
    ]) {
      expect(parseDayFirst(bad), bad).toBeNull();
    }
  });

  it("accepts 29 February only in a leap year", () => {
    expect(parseDayFirst("29/02/2024")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseDayFirst("29/02/2025")).toBeNull();
    expect(parseDayFirst("29/02/2000")).not.toBeNull(); // divisible by 400
    expect(parseDayFirst("29/02/1900")).toBeNull(); // divisible by 100, not 400
  });

  it("expands two-digit years around the configured pivot", () => {
    expect(expandTwoDigitYear(25)).toBe(2025);
    expect(expandTwoDigitYear(69)).toBe(2069);
    expect(expandTwoDigitYear(70)).toBe(1970);
    expect(expandTwoDigitYear(99)).toBe(1999);
    expect(expandTwoDigitYear(70, 80)).toBe(2070); // pivot is configurable
  });

  it("property: a day-first render always round-trips day-first", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2099 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }), // 28 is safe in every month
        (year, month, day) => {
          const s = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${String(year)}`;
          const parsed = parseDayFirst(s);
          return parsed?.year === year && parsed.month === month && parsed.day === day;
        },
      ),
    );
  });
});

describe("Excel serial dates", () => {
  it("converts known serials correctly, allowing for the phantom 1900 leap day", () => {
    // 1 April 2025 is serial 45748.
    expect(excelSerialToCalendarDate(45748)).toEqual({ year: 2025, month: 4, day: 1 });
    expect(calendarDateToExcelSerial(calendarDate(2025, 4, 1))).toBe(45748);
    // 1 March 1900, the first date after the phantom leap day.
    expect(excelSerialToCalendarDate(61)).toEqual({ year: 1900, month: 3, day: 1 });
  });

  it("rejects serials inside the phantom leap day instead of shifting them a day", () => {
    for (const serial of [0, 1, 59, 60, -5]) {
      expect(excelSerialToCalendarDate(serial), String(serial)).toBeNull();
    }
  });

  it("truncates a datetime serial to its date", () => {
    expect(excelSerialToCalendarDate(45748.75)).toEqual({ year: 2025, month: 4, day: 1 });
  });

  it("property: serial -> date -> serial round-trips above the phantom day", () => {
    fc.assert(
      fc.property(fc.integer({ min: 61, max: 80_000 }), (serial) => {
        const d = excelSerialToCalendarDate(serial);
        return d !== null && calendarDateToExcelSerial(d) === serial;
      }),
    );
  });

  it("parseCellDate handles both the string and the number SheetJS may hand back", () => {
    expect(parseCellDate(45748)).toEqual({ year: 2025, month: 4, day: 1 });
    expect(parseCellDate("01/04/2025")).toEqual({ year: 2025, month: 4, day: 1 });
  });
});

describe("calendar dates", () => {
  it("knows leap years", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
  });

  it("knows month lengths, February included", () => {
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 12)).toBe(31);
  });

  it("formats ISO", () => {
    expect(formatIso(calendarDate(2025, 4, 1))).toBe("2025-04-01");
  });

  it("refuses to construct an impossible date", () => {
    expect(() => calendarDate(2025, 2, 29)).toThrow(RangeError);
    expect(() => calendarDate(2025, 13, 1)).toThrow(RangeError);
  });
});

describe("periods", () => {
  it("builds and parses period ids", () => {
    expect(periodId(2025, 4)).toBe("2025-04");
    expect(parsePeriodId("2025-04")).toBe("2025-04");
    expect(parsePeriodId("2025-13")).toBeNull();
    expect(parsePeriodId("2025-4")).toBeNull();
    expect(parsePeriodId("nonsense")).toBeNull();
  });

  it("adds months across a year boundary in both directions", () => {
    expect(addMonths(periodId(2025, 12), 1)).toBe("2026-01");
    expect(addMonths(periodId(2025, 1), -1)).toBe("2024-12");
    expect(addMonths(periodId(2025, 4), 24)).toBe("2027-04");
    expect(addMonths(periodId(2025, 4), -24)).toBe("2023-04");
  });

  it("gives the same month last year", () => {
    expect(sameMonthLastYear(periodId(2025, 4))).toBe("2024-04");
    expect(sameMonthLastYear(periodId(2025, 1))).toBe("2024-01");
  });

  it("finds the last day of a period, leap years included", () => {
    expect(periodEndDate(periodId(2025, 2))).toEqual({ year: 2025, month: 2, day: 28 });
    expect(periodEndDate(periodId(2024, 2))).toEqual({ year: 2024, month: 2, day: 29 });
    expect(periodEndDate(periodId(2025, 4))).toEqual({ year: 2025, month: 4, day: 30 });
  });

  it("builds inclusive ranges and returns empty when reversed", () => {
    expect(periodRange(periodId(2025, 4), periodId(2025, 6))).toEqual([
      "2025-04",
      "2025-05",
      "2025-06",
    ]);
    expect(periodRange(periodId(2025, 6), periodId(2025, 4))).toEqual([]);
    expect(periodRange(periodId(2025, 4), periodId(2025, 4))).toEqual(["2025-04"]);
  });

  it("property: addMonths and periodDiff are inverse", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2090 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: -120, max: 120 }),
        (year, month, delta) => {
          const p = periodId(year, month);
          return periodDiff(p, addMonths(p, delta)) === delta;
        },
      ),
    );
  });
});

describe("financial year (SPEC §2.14 — April–March by default, configurable)", () => {
  it("places a month in the right Indian FY", () => {
    // April 2025 starts FY 2025-26; March 2026 ends it.
    expect(financialYearOf(periodId(2025, 4), 4).start).toBe("2025-04");
    expect(financialYearOf(periodId(2026, 3), 4).start).toBe("2025-04");
    expect(financialYearOf(periodId(2026, 3), 4).end).toBe("2026-03");
    // March 2025 belongs to the *previous* FY.
    expect(financialYearOf(periodId(2025, 3), 4).start).toBe("2024-04");
  });

  it("labels the FY the way invoices need it (SPEC §13)", () => {
    expect(financialYearLabel(financialYearOf(periodId(2026, 4), 4))).toBe("2026-27");
    expect(financialYearLabel(financialYearOf(periodId(2025, 4), 4))).toBe("2025-26");
    // Crossing a century boundary keeps the two-digit end short.
    expect(financialYearLabel(financialYearOf(periodId(2099, 4), 4))).toBe("2099-00");
  });

  it("does not hardcode April — a January FY works and labels as one year", () => {
    const fy = financialYearOf(periodId(2025, 6), 1);
    expect(fy.start).toBe("2025-01");
    expect(fy.end).toBe("2025-12");
    expect(financialYearLabel(fy)).toBe("2025");
  });

  it("handles a July FY start", () => {
    expect(financialYearOf(periodId(2025, 6), 7).start).toBe("2024-07");
    expect(financialYearOf(periodId(2025, 7), 7).start).toBe("2025-07");
  });

  it("always yields exactly 12 periods", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2090 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month, fyStart) => {
          const fy = financialYearOf(periodId(year, month), fyStart);
          const periods = periodsInFinancialYear(fy);
          return (
            periods.length === 12 && periods[0] === fy.start && periods[11] === fy.end
          );
        },
      ),
    );
  });

  it("property: the containing FY always contains the period", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2090 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month, fyStart) => {
          const p = periodId(year, month);
          return periodsInFinancialYear(financialYearOf(p, fyStart)).includes(p);
        },
      ),
    );
  });

  it("computes year-to-date from the FY start", () => {
    expect(yearToDate(periodId(2025, 6), 4)).toEqual(["2025-04", "2025-05", "2025-06"]);
    expect(yearToDate(periodId(2025, 4), 4)).toEqual(["2025-04"]);
    expect(yearToDate(periodId(2026, 3), 4)).toHaveLength(12);
  });

  it("tests date containment in an FY", () => {
    const fy = financialYearOf(periodId(2025, 4), 4);
    expect(isInFinancialYear(calendarDate(2025, 4, 1), fy)).toBe(true);
    expect(isInFinancialYear(calendarDate(2026, 3, 31), fy)).toBe(true);
    expect(isInFinancialYear(calendarDate(2025, 3, 31), fy)).toBe(false);
    expect(isInFinancialYear(calendarDate(2026, 4, 1), fy)).toBe(false);
  });

  it("periodOf maps a parsed source date to its period", () => {
    const d = parseDayFirst("15-Apr-25");
    expect(d).not.toBeNull();
    if (d) expect(periodOf(d)).toBe("2025-04");
  });
});

describe("IST display (SPEC §2.14 — store UTC, display IST)", () => {
  it("offsets by a fixed +05:30", () => {
    expect(IST_OFFSET_MINUTES).toBe(330);
    const utc = new Date("2026-09-11T14:00:42Z");
    expect(toIstParts(utc)).toEqual({
      year: 2026,
      month: 9,
      day: 11,
      hour: 19,
      minute: 30,
      second: 42,
    });
  });

  it("rolls the IST date forward when UTC is late in the evening", () => {
    // 18:45 UTC is 00:15 IST the next day.
    const utc = new Date("2026-09-11T18:45:00Z");
    expect(istCalendarDate(utc)).toEqual({ year: 2026, month: 9, day: 12 });
  });

  it("formats for the Excel cover and the UI", () => {
    const utc = new Date("2026-09-11T14:00:42Z");
    expect(formatIstDateTime(utc)).toBe("2026-09-11 19:30:42 IST");
    expect(formatIstDate(utc)).toBe("11-09-2026"); // day-first for display too
    expect(formatIstIso(utc)).toBe("2026-09-11T19:30:42+05:30");
  });

  it("has no daylight saving — the offset is identical in January and July", () => {
    const jan = toIstParts(new Date("2026-01-15T12:00:00Z"));
    const jul = toIstParts(new Date("2026-07-15T12:00:00Z"));
    expect(jan.hour).toBe(17);
    expect(jan.minute).toBe(30);
    expect(jul.hour).toBe(17);
    expect(jul.minute).toBe(30);
  });

  it("property: toIstParts and fromIstParts round-trip to the second", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), (epochSeconds) => {
        const instant = new Date(epochSeconds * 1000);
        return fromIstParts(toIstParts(instant)).getTime() === instant.getTime();
      }),
    );
  });
});

describe("date order as a stated setting (ADR 0030)", () => {
  it("reads the same string differently in each order", () => {
    // The whole reason this is a setting: 03/04 is two different months.
    expect(parseDate("03/04/2025", { order: "day_first" })).toEqual(
      calendarDate(2025, 4, 3),
    );
    expect(parseDate("03/04/2025", { order: "month_first" })).toEqual(
      calendarDate(2025, 3, 4),
    );
  });

  it("defaults to day-first, which is SPEC §2.14 and every Tally export", () => {
    expect(parseDate("03/04/2025")).toEqual(calendarDate(2025, 4, 3));
    expect(parseDayFirst("03/04/2025")).toEqual(calendarDate(2025, 4, 3));
  });

  it("refuses an impossible month rather than reinterpreting it", () => {
    // 13/01 read month-first is not "obviously 13 January" — it is not a date, and
    // saying so is what stops a silent reinterpretation.
    expect(parseDate("13/01/2025", { order: "month_first" })).toBeNull();
    expect(parseDate("13/01/2025", { order: "day_first" })).toEqual(
      calendarDate(2025, 1, 13),
    );
  });

  it("leaves unambiguous formats alone whichever order is set", () => {
    for (const order of ["day_first", "month_first"] as const) {
      expect(parseDate("2025-04-03", { order }), order).toEqual(calendarDate(2025, 4, 3));
      expect(parseDate("3-Apr-25", { order }), order).toEqual(calendarDate(2025, 4, 3));
    }
  });
});

describe("detecting the date order of a column", () => {
  it("proves day-first from a day above twelve", () => {
    const e = detectDateOrder(["01/02/2025", "31/03/2025", "05/04/2025"]);
    expect(e.order).toBe("day_first");
    expect(e.dayFirstExample).toBe("31/03/2025");
  });

  it("proves month-first from a day above twelve in the second position", () => {
    const e = detectDateOrder(["01/02/2025", "03/31/2025"]);
    expect(e.order).toBe("month_first");
    expect(e.monthFirstExample).toBe("03/31/2025");
  });

  it("says ambiguous rather than guessing when every value works both ways", () => {
    // A fortnight of early-month dates genuinely cannot be resolved, and pretending
    // otherwise is how a heuristic gets it wrong silently.
    const e = detectDateOrder(["01/02/2025", "03/04/2025", "05/06/2025"]);
    expect(e.order).toBe("ambiguous");
    expect(e.ambiguous).toBe(3);
  });

  it("says inconsistent when rows prove both, never a majority verdict", () => {
    const e = detectDateOrder(["31/01/2025", "01/31/2025"]);
    expect(e.order).toBe("inconsistent");
  });

  it("ignores what is not a two-number date at all", () => {
    expect(detectDateOrder(["2025-04-03", "3-Apr-25", "", "not a date"]).order).toBe(
      "ambiguous",
    );
  });
});

describe("checking a column against the company's setting", () => {
  it("passes when the data agrees, and when it cannot say", () => {
    expect(checkDateOrder("day_first", ["31/03/2025"]).ok).toBe(true);
    expect(checkDateOrder("month_first", ["03/31/2025"]).ok).toBe(true);
    expect(checkDateOrder("month_first", ["01/02/2025"]).ok).toBe(true);
  });

  it("fails with the value that proves it, not a vague complaint", () => {
    const check = checkDateOrder("month_first", ["01/02/2025", "31/03/2025"]);
    expect(check.ok).toBe(false);
    if (check.ok) throw new Error("expected a contradiction");
    // A person can act on "31/03/2025"; they cannot act on "dates look wrong".
    expect(check.message).toContain("31/03/2025");
    expect(check.message).toContain("wrong month");
  });

  it("fails a file that mixes orders, which no setting can rescue", () => {
    const check = checkDateOrder("day_first", ["31/01/2025", "01/31/2025"]);
    expect(check.ok).toBe(false);
    if (check.ok) throw new Error("expected a contradiction");
    expect(check.message).toContain("mixes date orders");
  });
});
