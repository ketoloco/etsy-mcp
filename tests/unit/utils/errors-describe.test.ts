import { describe, it, expect } from "vitest";
import { EtsyApiError } from "../../../src/utils/errors.js";

describe("EtsyApiError message", () => {
  it("includes Etsy's error text", () => {
    expect(new EtsyApiError(400, { error: "Listing requires a return policy" }).message)
      .toBe("Etsy API error (400): Listing requires a return policy");
  });
  it("stays short without a body", () => {
    expect(new EtsyApiError(500, null).message).toBe("Etsy API error (500)");
  });
});
