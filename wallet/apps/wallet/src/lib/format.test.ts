import { describe, expect, it } from "vitest";
import { dayBucket, fmtSigned, fmtUsd, initials, relativeTime, splitAmount, usdFromBaseUnits, usdcToBaseUnits } from "./format";

describe("money formatting (USDC base units ⇄ dollars)", () => {
  it("formats USDC base units to grouped dollars with ≥2 decimals", () => {
    expect(usdFromBaseUnits("1240500000")).toBe("1,240.50");
    expect(usdFromBaseUnits("1950000")).toBe("1.95");
    expect(usdFromBaseUnits("0")).toBe("0.00");
    expect(usdFromBaseUnits("10000000000")).toBe("10,000.00");
  });

  it("trims trailing precision past cents but keeps real precision", () => {
    expect(usdFromBaseUnits("1234567")).toBe("1.234567");
    expect(usdFromBaseUnits("1000000")).toBe("1.00");
  });

  it("fmtUsd adds the $ and handles negatives", () => {
    expect(fmtUsd("1240500000")).toBe("$1,240.50");
    expect(fmtUsd("-50000")).toBe("-$0.05");
  });

  it("fmtSigned signs by direction with a true minus glyph", () => {
    expect(fmtSigned("200000000", "in")).toBe("+$200.00");
    expect(fmtSigned("50000", "out")).toBe("−$0.05");
  });

  it("usdcToBaseUnits round-trips and rejects precision beyond USDC decimals", () => {
    expect(usdcToBaseUnits("1240.50")).toBe(1240500000n);
    expect(usdcToBaseUnits("$1,240.50")).toBe(1240500000n);
    expect(usdcToBaseUnits("0.000001")).toBe(1n);
    expect(() => usdcToBaseUnits("1.0000001")).toThrow();
  });

  it("splitAmount separates dollars and cents", () => {
    expect(splitAmount("1240500000")).toEqual({ dollars: "1,240", cents: "50" });
  });
});

describe("time + identity helpers", () => {
  const now = 1_700_000_000_000; // fixed clock
  it("relativeTime buckets correctly", () => {
    expect(relativeTime(now / 1000 - 10, now)).toBe("now");
    expect(relativeTime(now / 1000 - 120, now)).toBe("2 min ago");
    expect(relativeTime(now / 1000 - 7200, now)).toBe("2h ago");
    expect(relativeTime(now / 1000 - 3 * 86400, now)).toBe("3d ago");
  });
  it("dayBucket labels today/yesterday", () => {
    expect(dayBucket(now / 1000, now)).toBe("Today");
    expect(dayBucket(now / 1000 - 86400, now)).toBe("Yesterday");
  });
  it("initials derive from names + handles", () => {
    expect(initials("Ravi Mehta")).toBe("RM");
    expect(initials("@mara")).toBe("MA");
    expect(initials("")).toBe("?");
  });
});
