import { describe, expect, it } from "vitest";
import { dateInTimeZone } from "./routine-date";

describe("routine start date", () => {
  it("uses the recipient timezone instead of the browser UTC date", () => {
    const instant = new Date("2026-08-20T00:30:00.000Z");

    expect(dateInTimeZone(instant, "Asia/Shanghai")).toBe("2026-08-20");
    expect(dateInTimeZone(instant, "America/Los_Angeles")).toBe(
      "2026-08-19",
    );
  });

  it("rolls forward when the recipient has already entered the next day", () => {
    expect(
      dateInTimeZone(new Date("2026-08-20T23:30:00.000Z"), "Asia/Shanghai"),
    ).toBe("2026-08-21");
  });
});
