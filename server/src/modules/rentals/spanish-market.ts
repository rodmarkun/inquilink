export const DOCUMENT_CATEGORIES = [
  "payslips",
  "employment_contract",
  "self_employed_income",
  "irpf_tax_return",
  "employment_history",
  "pension_proof",
  "guarantor_proof",
  "supporting",
] as const;

export type DocumentCategory = typeof DOCUMENT_CATEGORIES[number];

export type AdultProfile = {
  id: string;
  isPrimary: boolean;
  fullName: string;
  email: string | null;
  phone: string | null;
  employmentStatus: string;
  employerOrActivity: string;
  contractType: string;
  netMonthlyIncomeCents: number;
};

export function normalizeCandidateEmail(value: string): string {
  return value.trim().toLocaleLowerCase("es");
}

/** E.164-shaped comparison key; formatting punctuation never creates a new identity. */
export function normalizeCandidatePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export function adultProfilesFromApplication(input: {
  fullName: string;
  email: string;
  phone: string;
  employmentStatus: string;
  employerOrActivity: string;
  contractType: string;
  individualNetMonthlyIncomeCents: number;
  additionalAdults?: Array<Omit<AdultProfile, "isPrimary">>;
}): AdultProfile[] {
  return [{
    id: "primary",
    isPrimary: true,
    fullName: input.fullName,
    email: normalizeCandidateEmail(input.email),
    phone: input.phone,
    employmentStatus: input.employmentStatus,
    employerOrActivity: input.employerOrActivity,
    contractType: input.contractType,
    netMonthlyIncomeCents: input.individualNetMonthlyIncomeCents,
  }, ...(input.additionalAdults ?? []).map((adult) => ({ ...adult, isPrimary: false }))];
}

export function missingDocumentsByAdult(
  requested: readonly string[],
  adults: readonly Pick<AdultProfile, "id">[],
  uploaded: readonly { category: string; adultProfileId: string }[],
): Array<{ adultProfileId: string; categories: string[] }> {
  const present = new Set(uploaded.map((document) => `${document.adultProfileId}:${document.category}`));
  return adults.map((adult) => ({
    adultProfileId: adult.id,
    categories: requested.filter((category) => !present.has(`${adult.id}:${category}`)),
  })).filter((item) => item.categories.length > 0);
}
