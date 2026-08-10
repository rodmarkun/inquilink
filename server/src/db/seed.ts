import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { hashSecret } from "../lib/ids.js";
import { AesGcmPublicLinkTokenVault } from "../modules/rentals/public-link-vault.js";
import { createDatabase } from "./client.js";
import { agencies, agencyMemberships, applicationNotes, applications, appointments, properties, subscriptions, users } from "./schema.js";

const IDS = {
  agency: "11111111-1111-4111-8111-111111111111",
  agencyAdmin: "11111111-1111-4111-8111-111111111112",
  agencyCollaborator: "11111111-1111-4111-8111-111111111113",
  otherAgency: "22222222-2222-4222-8222-222222222222",
  otherAdmin: "22222222-2222-4222-8222-222222222223",
  tenant: "33333333-3333-4333-8333-333333333333",
  tenantAndres: "33333333-3333-4333-8333-333333333334",
  tenantSamuel: "33333333-3333-4333-8333-333333333335",
  tenantMiguel: "33333333-3333-4333-8333-333333333336",
  tenantElena: "33333333-3333-4333-8333-333333333337",
  tenantNora: "33333333-3333-4333-8333-333333333338",
  tenantMarina: "33333333-3333-4333-8333-333333333339",
  otherTenant: "44444444-4444-4444-8444-444444444444",
  property: "55555555-5555-4555-8555-555555555555",
  propertyRetiro: "55555555-5555-4555-8555-555555555556",
  propertyMalasana: "55555555-5555-4555-8555-555555555557",
  propertyArganzuela: "55555555-5555-4555-8555-555555555558",
  otherProperty: "66666666-6666-4666-8666-666666666666",
  application: "77777777-7777-4777-8777-777777777777",
  applicationAndres: "77777777-7777-4777-8777-777777777778",
  applicationSamuel: "77777777-7777-4777-8777-777777777779",
  applicationMiguel: "77777777-7777-4777-8777-777777777780",
  applicationElena: "77777777-7777-4777-8777-777777777781",
  applicationNora: "77777777-7777-4777-8777-777777777782",
  applicationMarina: "77777777-7777-4777-8777-777777777783",
  otherApplication: "88888888-8888-4888-8888-888888888888",
  subscription: "99999999-9999-4999-8999-999999999999",
  appointmentLucia: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  appointmentMarina: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  appointmentElena: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  appointmentNora: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
  noteAndres: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
} as const;
const PUBLIC_LINKS = {
  property: "demo-chamberi-public-link",
  propertyRetiro: "demo-retiro-public-link",
  propertyArganzuela: "demo-arganzuela-public-link",
  otherProperty: "other-agency-public-link",
} as const;

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const publicLinkVault = new AesGcmPublicLinkTokenVault(config.PUBLIC_LINK_VAULT_SECRET);
const now = new Date();
const passwordHash = await argon2.hash("demo1234");
const daysFromNow = (days: number, hour = 10, minute = 0) => {
  const value = new Date(now);
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hour, minute, 0, 0);
  return value;
};
const demoApplication = (input: { phone: string; adults: number; minors: number; income: number; employment: string; employer: string; message: string }) => ({
  phone: input.phone, preferredContactChannel: "whatsapp", adultOccupants: input.adults, minorOccupants: input.minors,
  intendedMoveInDate: "2026-10-01", pets: "no", petDetails: null, message: input.message,
  employmentStatus: input.employment, employerOrActivity: input.employer, contractType: "Indefinido",
  individualNetMonthlyIncomeCents: input.income, householdNetMonthlyIncomeCents: input.income,
  guarantorAvailability: "unsure", viewingAvailability: ["Tardes entre semana"], availabilityNote: "A partir de las 18:00", marketingConsent: false,
});
const submittedFields = (draft: ReturnType<typeof demoApplication>) => ({
  draftData: draft,
  phone: draft.phone,
  individualNetMonthlyIncomeCents: draft.individualNetMonthlyIncomeCents,
  householdNetMonthlyIncomeCents: draft.householdNetMonthlyIncomeCents,
  adultOccupants: draft.adultOccupants,
  minorOccupants: draft.minorOccupants,
  intendedMoveInDate: draft.intendedMoveInDate,
  applicationDataPromotedAt: now,
});

try {
  await database.db.insert(users).values([
    { id: IDS.agencyAdmin, kind: "agency", email: "demo@inquilink.es", fullName: "Pablo García", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: IDS.agencyCollaborator, kind: "agency", email: "equipo@inquilink.es", fullName: "Marta Soler", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: IDS.otherAdmin, kind: "agency", email: "otra-agencia@inquilink.es", fullName: "Laura Torres", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: IDS.tenant, kind: "tenant", email: "inquilino@inquilink.es", fullName: "Lucía Martín", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: IDS.tenantAndres, kind: "tenant", email: "andres.demo@inquilink.es", fullName: "Andrés Ruiz", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: IDS.tenantSamuel, kind: "tenant", email: "samuel.demo@inquilink.es", fullName: "Samuel Ortega", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: IDS.tenantMiguel, kind: "tenant", email: "miguel.demo@inquilink.es", fullName: "Miguel Costa", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: IDS.tenantElena, kind: "tenant", email: "elena.demo@inquilink.es", fullName: "Elena Sanz", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: IDS.tenantNora, kind: "tenant", email: "nora.demo@inquilink.es", fullName: "Nora Vidal", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: IDS.tenantMarina, kind: "tenant", email: "marina.demo@inquilink.es", fullName: "Marina López", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: IDS.otherTenant, kind: "tenant", email: "otro-inquilino@inquilink.es", fullName: "Mario López", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
  ]).onConflictDoNothing();
  await database.db.insert(agencies).values([
    { id: IDS.agency, name: "Inmobiliaria Horizonte", phone: "+34910000000", createdAt: now, updatedAt: now },
    { id: IDS.otherAgency, name: "Agencia Norte", phone: "+34910000001", createdAt: now, updatedAt: now },
  ]).onConflictDoNothing();
  await database.db.insert(agencyMemberships).values([
    { agencyId: IDS.agency, userId: IDS.agencyAdmin, role: "admin", createdAt: now },
    { agencyId: IDS.agency, userId: IDS.agencyCollaborator, role: "collaborator", createdAt: now },
    { agencyId: IDS.otherAgency, userId: IDS.otherAdmin, role: "admin", createdAt: now },
  ]).onConflictDoNothing();
  await database.db.insert(properties).values([
    {
      id: IDS.property, agencyId: IDS.agency, responsibleUserId: IDS.agencyAdmin,
      internalReference: "MAD-CH-001", title: "Piso luminoso en Chamberí", address: "Calle de Santa Engracia, 82",
      city: "Madrid", province: "Madrid", postalCode: "28010", propertyType: "Piso", bedrooms: 2, bathrooms: 1,
      floorAreaSqm: 78, availableFrom: "2026-09-01", description: "Vivienda luminosa y bien comunicada en el corazón de Chamberí.",
      publicLocation: "Chamberí, Madrid", requestedDocumentCategories: ["payslips", "employment_contract"],
      monthlyRentCents: 145_000, state: "published", publicLinkTokenHash: hashSecret(PUBLIC_LINKS.property), publicLinkTokenCiphertext: publicLinkVault.seal(IDS.property, PUBLIC_LINKS.property), publicLinkIssuedAt: now,
      createdAt: now, updatedAt: now,
    },
    {
      id: IDS.propertyRetiro, agencyId: IDS.agency, responsibleUserId: IDS.agencyCollaborator,
      internalReference: "MAD-RE-038", title: "Ático con terraza en Retiro", address: "Calle del Doce de Octubre, 8",
      city: "Madrid", province: "Madrid", postalCode: "28009", propertyType: "Ático", bedrooms: 3, bathrooms: 2,
      floorAreaSqm: 105, availableFrom: "2026-09-15", description: "Ático exterior con terraza y mucha luz natural.",
      publicLocation: "Retiro, Madrid", requestedDocumentCategories: ["payslips", "employment_contract"],
      monthlyRentCents: 189_000, state: "published", publicLinkTokenHash: hashSecret(PUBLIC_LINKS.propertyRetiro), publicLinkTokenCiphertext: publicLinkVault.seal(IDS.propertyRetiro, PUBLIC_LINKS.propertyRetiro), publicLinkIssuedAt: now,
      createdAt: now, updatedAt: now,
    },
    {
      id: IDS.propertyMalasana, agencyId: IDS.agency, responsibleUserId: IDS.agencyAdmin,
      internalReference: "MAD-MA-051", title: "Estudio reformado en Malasaña", address: "Calle de la Palma, 22",
      city: "Madrid", province: "Madrid", postalCode: "28004", propertyType: "Estudio", bedrooms: 1, bathrooms: 1,
      floorAreaSqm: 42, availableFrom: "2026-10-01", description: "Estudio reformado listo para publicar.", publicLocation: "Malasaña, Madrid",
      monthlyRentCents: 98_000, state: "draft", createdAt: now, updatedAt: now,
    },
    {
      id: IDS.propertyArganzuela, agencyId: IDS.agency, responsibleUserId: IDS.agencyCollaborator,
      internalReference: "MAD-AR-029", title: "Dúplex familiar en Arganzuela", address: "Paseo de las Delicias, 77",
      city: "Madrid", province: "Madrid", postalCode: "28045", propertyType: "Dúplex", bedrooms: 3, bathrooms: 2,
      floorAreaSqm: 118, availableFrom: "2026-11-01", description: "Dúplex amplio para familias junto a Madrid Río.", publicLocation: "Arganzuela, Madrid",
      monthlyRentCents: 165_000, state: "paused", publicLinkTokenHash: hashSecret(PUBLIC_LINKS.propertyArganzuela), publicLinkTokenCiphertext: publicLinkVault.seal(IDS.propertyArganzuela, PUBLIC_LINKS.propertyArganzuela), publicLinkIssuedAt: now,
      createdAt: now, updatedAt: now,
    },
    { id: IDS.otherProperty, agencyId: IDS.otherAgency, responsibleUserId: IDS.otherAdmin, internalReference: "MAD-NO-001", title: "Vivienda de otra agencia", city: "Madrid", province: "Madrid", monthlyRentCents: 125_000, state: "published", publicLinkTokenHash: hashSecret(PUBLIC_LINKS.otherProperty), publicLinkTokenCiphertext: publicLinkVault.seal(IDS.otherProperty, PUBLIC_LINKS.otherProperty), publicLinkIssuedAt: now, createdAt: now, updatedAt: now },
  ]).onConflictDoNothing();
  await database.db.insert(applications).values([
    {
      id: IDS.application, agencyId: IDS.agency, propertyId: IDS.property, tenantUserId: IDS.tenant, responsibleUserId: null,
      status: "new", documentState: "missing", submittedAt: now,
      phone: "+34600000000", individualNetMonthlyIncomeCents: 240_000, householdNetMonthlyIncomeCents: 390_000,
      adultOccupants: 2, minorOccupants: 0, intendedMoveInDate: "2026-09-01", applicationDataPromotedAt: now,
      draftData: {
        fullName: "Lucía Martín", email: "inquilino@inquilink.es", phone: "+34600000000", preferredContactChannel: "whatsapp",
        adultOccupants: 2, minorOccupants: 0, intendedMoveInDate: "2026-09-01", pets: "no", petDetails: null,
        message: "Nos interesa visitar el piso esta semana.", employmentStatus: "employed", employerOrActivity: "Estudio Norte",
        contractType: "indefinite", individualNetMonthlyIncomeCents: 240_000, householdNetMonthlyIncomeCents: 390_000,
        guarantorAvailability: "unsure", viewingAvailability: ["Tardes entre semana"], availabilityNote: "A partir de las 18:00",
        marketingConsent: false,
      },
      consentVersion: "prototype-v1", consentedAt: now, sourceLinkTokenHash: hashSecret(PUBLIC_LINKS.property),
      createdAt: now, updatedAt: now,
    },
    {
      id: IDS.applicationAndres, agencyId: IDS.agency, propertyId: IDS.property, tenantUserId: IDS.tenantAndres, responsibleUserId: null,
      status: "new", documentState: "missing", submittedAt: daysFromNow(-1, 8, 16),
      ...submittedFields(demoApplication({ phone: "+34680776211", adults: 1, minors: 0, income: 335_000, employment: "Autónomo", employer: "Arquitectura AR", message: "Trabajo desde casa y busco una vivienda estable." })),
      consentVersion: "prototype-v1", consentedAt: daysFromNow(-1, 8, 16), sourceLinkTokenHash: hashSecret(PUBLIC_LINKS.property), createdAt: daysFromNow(-1, 8, 16), updatedAt: now,
    },
    {
      id: IDS.applicationSamuel, agencyId: IDS.agency, propertyId: IDS.property, tenantUserId: IDS.tenantSamuel, responsibleUserId: null,
      status: "new", documentState: "complete", submittedAt: daysFromNow(-4),
      ...submittedFields(demoApplication({ phone: "+34622994871", adults: 1, minors: 0, income: 260_000, employment: "Cuenta ajena", employer: "Brava Foods", message: "Puedo aportar avalista si es necesario." })),
      consentVersion: "prototype-v1", consentedAt: daysFromNow(-4), sourceLinkTokenHash: hashSecret(PUBLIC_LINKS.property), createdAt: daysFromNow(-4), updatedAt: now,
    },
    {
      id: IDS.applicationMiguel, agencyId: IDS.agency, propertyId: IDS.property, tenantUserId: IDS.tenantMiguel,
      status: "new", documentState: "not_requested", submittedAt: daysFromNow(-6),
      ...submittedFields(demoApplication({ phone: "+34673990512", adults: 1, minors: 0, income: 0, employment: "Estudiante", employer: "IE University", message: "Mi padre sería el avalista de la operación." })),
      consentVersion: "prototype-v1", consentedAt: daysFromNow(-6), sourceLinkTokenHash: hashSecret(PUBLIC_LINKS.property), createdAt: daysFromNow(-6), updatedAt: now,
    },
    {
      id: IDS.applicationElena, agencyId: IDS.agency, propertyId: IDS.property, tenantUserId: IDS.tenantElena, responsibleUserId: null,
      status: "preselected", documentState: "complete", submittedAt: daysFromNow(-3),
      ...submittedFields(demoApplication({ phone: "+34655610428", adults: 2, minors: 1, income: 510_000, employment: "Cuenta ajena", employer: "Hospital La Paz", message: "Nos interesa especialmente la cercanía al colegio." })),
      consentVersion: "prototype-v1", consentedAt: daysFromNow(-3), sourceLinkTokenHash: hashSecret(PUBLIC_LINKS.property), createdAt: daysFromNow(-3), updatedAt: now,
    },
    {
      id: IDS.applicationNora, agencyId: IDS.agency, propertyId: IDS.property, tenantUserId: IDS.tenantNora, responsibleUserId: null,
      status: "preselected", documentState: "missing", submittedAt: daysFromNow(-5),
      ...submittedFields(demoApplication({ phone: "+34630127449", adults: 2, minors: 0, income: 475_000, employment: "Cuenta ajena", employer: "Lumen Tech", message: "La vivienda encaja con lo que buscamos." })),
      consentVersion: "prototype-v1", consentedAt: daysFromNow(-5), sourceLinkTokenHash: hashSecret(PUBLIC_LINKS.property), createdAt: daysFromNow(-5), updatedAt: now,
    },
    {
      id: IDS.applicationMarina, agencyId: IDS.agency, propertyId: IDS.propertyRetiro, tenantUserId: IDS.tenantMarina, responsibleUserId: null,
      status: "new", documentState: "complete", submittedAt: daysFromNow(-1, 10, 5),
      ...submittedFields(demoApplication({ phone: "+34611478120", adults: 2, minors: 0, income: 590_000, employment: "Cuenta ajena", employer: "Kiro Labs", message: "La terraza es justo lo que estábamos buscando." })),
      consentVersion: "prototype-v1", consentedAt: daysFromNow(-1, 10, 5), sourceLinkTokenHash: hashSecret(PUBLIC_LINKS.propertyRetiro), createdAt: daysFromNow(-1, 10, 5), updatedAt: now,
    },
    { id: IDS.otherApplication, agencyId: IDS.otherAgency, propertyId: IDS.otherProperty, tenantUserId: IDS.otherTenant, status: "new", documentState: "missing", submittedAt: now, phone: "+34600000001", applicationDataPromotedAt: now, draftData: { phone: "+34600000001" }, consentVersion: "prototype-v1", consentedAt: now, sourceLinkTokenHash: hashSecret(PUBLIC_LINKS.otherProperty), createdAt: now, updatedAt: now },
  ]).onConflictDoNothing();
  await database.db.insert(appointments).values([
    { id: IDS.appointmentLucia, agencyId: IDS.agency, propertyId: IDS.property, applicationId: IDS.application, responsibleUserId: IDS.agencyAdmin, startsAt: daysFromNow(1, 16), durationMinutes: 30, state: "scheduled", instructions: "Portal principal. Preguntar por Pablo.", internalNote: "Llevar ficha impresa.", createdAt: now, updatedAt: now },
    { id: IDS.appointmentMarina, agencyId: IDS.agency, propertyId: IDS.propertyRetiro, applicationId: IDS.applicationMarina, responsibleUserId: IDS.agencyAdmin, startsAt: daysFromNow(2, 10, 30), durationMinutes: 45, state: "scheduled", instructions: "Encontrarse en el portal.", internalNote: null, createdAt: now, updatedAt: now },
    { id: IDS.appointmentElena, agencyId: IDS.agency, propertyId: IDS.property, applicationId: IDS.applicationElena, responsibleUserId: IDS.agencyAdmin, startsAt: daysFromNow(3, 15, 30), durationMinutes: 30, state: "scheduled", instructions: "Confirmar por teléfono el mismo día.", internalNote: null, createdAt: now, updatedAt: now },
    { id: IDS.appointmentNora, agencyId: IDS.agency, propertyId: IDS.property, applicationId: IDS.applicationNora, responsibleUserId: IDS.agencyAdmin, startsAt: daysFromNow(-2, 17), durationMinutes: 30, state: "completed", instructions: "Portal principal.", internalNote: "Visita realizada con interés alto.", createdAt: daysFromNow(-3), updatedAt: now },
  ]).onConflictDoNothing();
  await database.db.insert(applicationNotes).values({
    id: IDS.noteAndres, agencyId: IDS.agency, applicationId: IDS.applicationAndres, authorUserId: IDS.agencyCollaborator,
    body: "Pendiente de adjuntar la declaración trimestral más reciente.", createdAt: now,
  }).onConflictDoNothing();
  // Keep deterministic demo rows current when an existing local volume is reused.
  await database.db.update(properties).set({
    responsibleUserId: IDS.agencyAdmin, address: "Calle de Santa Engracia, 82", postalCode: "28010", propertyType: "Piso",
    bedrooms: 2, bathrooms: 1, floorAreaSqm: 78, availableFrom: "2026-09-01",
    description: "Vivienda luminosa y bien comunicada en el corazón de Chamberí.", publicLocation: "Chamberí, Madrid",
    requestedDocumentCategories: ["payslips", "employment_contract"], publicLinkTokenHash: hashSecret(PUBLIC_LINKS.property),
    publicLinkTokenCiphertext: publicLinkVault.seal(IDS.property, PUBLIC_LINKS.property), publicLinkIssuedAt: now, updatedAt: now,
  }).where(eq(properties.id, IDS.property));
  await database.db.update(properties).set({
    publicLinkTokenHash: hashSecret(PUBLIC_LINKS.otherProperty),
    publicLinkTokenCiphertext: publicLinkVault.seal(IDS.otherProperty, PUBLIC_LINKS.otherProperty), publicLinkIssuedAt: now, updatedAt: now,
  }).where(eq(properties.id, IDS.otherProperty));
  await database.db.update(applications).set({
    responsibleUserId: IDS.agencyAdmin,
    draftData: {
      fullName: "Lucía Martín", email: "inquilino@inquilink.es", phone: "+34600000000", preferredContactChannel: "whatsapp",
      adultOccupants: 2, minorOccupants: 0, intendedMoveInDate: "2026-09-01", pets: "no", petDetails: null,
      message: "Nos interesa visitar el piso esta semana.", employmentStatus: "employed", employerOrActivity: "Estudio Norte",
      contractType: "indefinite", individualNetMonthlyIncomeCents: 240_000, householdNetMonthlyIncomeCents: 390_000,
      guarantorAvailability: "unsure", viewingAvailability: ["Tardes entre semana"], availabilityNote: "A partir de las 18:00",
      marketingConsent: false,
    },
    sourceLinkTokenHash: hashSecret(PUBLIC_LINKS.property), updatedAt: now,
  }).where(eq(applications.id, IDS.application));
  const trialEndsAt = new Date(now.getTime() + 30 * 86_400_000);
  await database.db.insert(subscriptions).values({
    id: IDS.subscription, agencyId: IDS.agency, plan: "inmobiliaria", state: "trialing", trialEndsAt,
    currentPeriodEndsAt: trialEndsAt, cancelAtPeriodEnd: false, providerCustomerRef: "local_customer_demo",
    providerSubscriptionRef: "local_subscription_demo", paymentMethodDisplay: "Tarjeta terminada en 4242", createdAt: now, updatedAt: now,
  }).onConflictDoNothing();
  console.info("Demo data is ready. Use the documented local demo credentials and routes. IDs are deterministic for local development.");
} finally {
  await database.close();
}
