import { describe, expect, it } from "vitest";
import { inviteAmountToBaseUnits, validateFundedInviteAmount } from "./inviteValidation";

describe("funded invite amount validation", () => {
  it("rejects empty, zero, and invalid amounts", () => {
    expect(validateFundedInviteAmount("", "1000000")).toMatchObject({ amountOk: false, insufficient: false, message: null });
    expect(validateFundedInviteAmount("0", "1000000")).toMatchObject({ amountOk: false, insufficient: false, message: "Enter an amount above $0." });
    expect(validateFundedInviteAmount("abc", "1000000")).toMatchObject({ amountOk: false, insufficient: false, message: "Enter an amount above $0." });
  });

  it("rejects amounts above the gift-link funding balance", () => {
    expect(validateFundedInviteAmount("5", "1000000")).toMatchObject({
      amountOk: true,
      amountBaseUnits: "5000000",
      insufficient: true,
      message: "Not enough USDC available for a gift link. Receive money or use a smaller amount.",
    });
  });

  it("accepts amounts within the gift-link funding balance", () => {
    expect(inviteAmountToBaseUnits("1.25")).toBe("1250000");
    expect(validateFundedInviteAmount("1.25", "1250000")).toMatchObject({
      amountOk: true,
      amountBaseUnits: "1250000",
      insufficient: false,
      message: null,
    });
  });
});
