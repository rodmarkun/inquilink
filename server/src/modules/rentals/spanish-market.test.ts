import { describe, expect, it } from "vitest";
import { adultProfilesFromApplication, missingDocumentsByAdult, normalizeCandidateEmail, normalizeCandidatePhone } from "./spanish-market.js";

describe("Spanish-market applicant helpers", () => {
  it("normalizes candidate identifiers without deciding that records are the same", () => {
    expect(normalizeCandidateEmail("  ANA@Example.ES ")).toBe("ana@example.es");
    expect(normalizeCandidatePhone("+34 612 345 678")).toBe("34612345678");
  });

  it("models the account holder and co-applicants as document-owning adults", () => {
    const profiles = adultProfilesFromApplication({
      fullName: "Ana García", email: "ANA@example.es", phone: "+34612345678",
      employmentStatus: "employed", employerOrActivity: "Acme", contractType: "indefinite",
      individualNetMonthlyIncomeCents: 200_000,
      additionalAdults: [{ id: "adult-2", fullName: "Luis Pérez", email: null, phone: null, employmentStatus: "retired", employerOrActivity: "Pensión", contractType: "not_applicable", netMonthlyIncomeCents: 120_000 }],
    });
    expect(profiles.map((profile) => [profile.id, profile.isPrimary])).toEqual([["primary", true], ["adult-2", false]]);
  });

  it("requires every requested category for every adult", () => {
    expect(missingDocumentsByAdult(["payslips", "employment_history"], [{ id: "primary" }, { id: "adult-2" }], [
      { adultProfileId: "primary", category: "payslips" },
      { adultProfileId: "primary", category: "employment_history" },
      { adultProfileId: "adult-2", category: "payslips" },
    ])).toEqual([{ adultProfileId: "adult-2", categories: ["employment_history"] }]);
  });
});
