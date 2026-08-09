import { describe, expect, it } from "vitest";
import { PLAN_DEFINITIONS, PRICES } from "./plan-allowances.js";

describe("commercial plan matrix", () => {
  it("exposes the exact approved cents and allowances without capability tiers", () => {
    expect(PRICES).toEqual({ particular: 999, professional: 4_999, inmobiliaria: 9_999 });
    expect(PLAN_DEFINITIONS).toEqual({
      particular: { name: "Particular", priceCents: 999, listingLimit: 2, accountLimit: 1 },
      professional: { name: "Profesional", priceCents: 4_999, listingLimit: 15, accountLimit: 3 },
      inmobiliaria: { name: "Inmobiliaria", priceCents: 9_999, listingLimit: 100, accountLimit: null },
    });
  });
});
