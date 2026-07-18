import { describe, expect, it } from "vitest";
import { mapError } from "./errors";

describe("mapError", () => {
  it("maps rejected wallet requests", () => {
    expect(mapError({ shortMessage: "User rejected the request." })).toBe("Request cancelled.");
    expect(mapError({ code: 4001 })).toBe("Request cancelled.");
  });

  it("maps network and proving failures to human-safe copy", () => {
    expect(mapError(new Error("RPC timeout"))).toBe("Couldn't reach Avalanche right now. Please try again.");
    expect(mapError(new Error("groth16 proof failed"))).toBe("Couldn't build the private proof on this device. Please try again.");
  });

  it("keeps safe application messages", () => {
    expect(mapError(new Error("handle_not_found"))).toBe("handle_not_found");
  });
});
