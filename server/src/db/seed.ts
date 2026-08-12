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

// Extra catalogue that makes the workspace look like a mid-size agency. IDs stay deterministic so the seed remains re-runnable.
const EXTRA_PROPERTIES = [
  { id: "55555555-5555-4555-8555-555555555561", reference: "MAD-LA-057", title: "Piso reformado en Lavapiés", address: "Calle de Argumosa, 15", city: "Madrid", province: "Madrid", postalCode: "28012", type: "Piso", bedrooms: 2, bathrooms: 1, area: 70, rentCents: 120_000, state: "published" as const, publicLocation: "Lavapiés, Madrid", availableFrom: "2026-09-15", description: "Reforma integral con cocina abierta a dos minutos del Reina Sofía.", responsible: "collaborator" as const, link: "demo-lavapies-public-link" },
  { id: "55555555-5555-4555-8555-555555555562", reference: "MAD-SA-060", title: "Ático señorial en Salamanca", address: "Calle de Ayala, 34", city: "Madrid", province: "Madrid", postalCode: "28001", type: "Ático", bedrooms: 3, bathrooms: 2, area: 140, rentCents: 240_000, state: "published" as const, publicLocation: "Salamanca, Madrid", availableFrom: "2026-10-01", description: "Ático de techos altos con dos terrazas y portero físico.", responsible: "admin" as const, link: "demo-salamanca-public-link" },
  { id: "55555555-5555-4555-8555-555555555563", reference: "MAD-LT-063", title: "Estudio acogedor en La Latina", address: "Calle de la Cava Baja, 9", city: "Madrid", province: "Madrid", postalCode: "28005", type: "Estudio", bedrooms: 1, bathrooms: 1, area: 38, rentCents: 89_000, state: "published" as const, publicLocation: "La Latina, Madrid", availableFrom: "2026-09-01", description: "Estudio con mucho encanto en pleno casco histórico.", responsible: "collaborator" as const, link: "demo-la-latina-public-link" },
  { id: "55555555-5555-4555-8555-555555555564", reference: "MAD-TE-066", title: "Piso con balcón en Tetuán", address: "Calle de Bravo Murillo, 210", city: "Madrid", province: "Madrid", postalCode: "28020", type: "Piso", bedrooms: 2, bathrooms: 1, area: 68, rentCents: 115_000, state: "published" as const, publicLocation: "Tetuán, Madrid", availableFrom: "2026-09-01", description: "Exterior con balcón a calle tranquila y metro a un paso.", responsible: "admin" as const, link: "demo-tetuan-public-link" },
  { id: "55555555-5555-4555-8555-555555555565", reference: "MAD-US-071", title: "Bajo con patio en Usera", address: "Calle de Marcelo Usera, 51", city: "Madrid", province: "Madrid", postalCode: "28026", type: "Bajo", bedrooms: 2, bathrooms: 1, area: 75, rentCents: 99_000, state: "paused" as const, publicLocation: "Usera, Madrid", availableFrom: "2026-11-01", description: "Bajo con patio privado de 20 m², ideal para teletrabajo.", responsible: "collaborator" as const, link: "demo-usera-public-link" },
  { id: "55555555-5555-4555-8555-555555555566", reference: "BCN-EX-104", title: "Piso modernista en el Eixample", address: "Carrer de València, 245", city: "Barcelona", province: "Barcelona", postalCode: "08007", type: "Piso", bedrooms: 3, bathrooms: 2, area: 110, rentCents: 175_000, state: "published" as const, publicLocation: "Eixample, Barcelona", availableFrom: "2026-09-15", description: "Finca regia con suelos hidráulicos y galería interior.", responsible: "admin" as const, link: "demo-eixample-public-link" },
  { id: "55555555-5555-4555-8555-555555555567", reference: "BCN-BT-108", title: "Estudio junto al mar en la Barceloneta", address: "Carrer del Baluard, 18", city: "Barcelona", province: "Barcelona", postalCode: "08003", type: "Estudio", bedrooms: 1, bathrooms: 1, area: 40, rentCents: 105_000, state: "published" as const, publicLocation: "Barceloneta, Barcelona", availableFrom: "2026-09-01", description: "Estudio reformado a 100 metros de la playa.", responsible: "collaborator" as const, link: "demo-barceloneta-public-link" },
  { id: "55555555-5555-4555-8555-555555555568", reference: "BCN-GR-112", title: "Ático con terraza en Gràcia", address: "Carrer de Verdi, 72", city: "Barcelona", province: "Barcelona", postalCode: "08012", type: "Ático", bedrooms: 2, bathrooms: 1, area: 85, rentCents: 160_000, state: "published" as const, publicLocation: "Gràcia, Barcelona", availableFrom: "2026-10-01", description: "Terraza de 30 m² con vistas a los tejados de Gràcia.", responsible: "admin" as const, link: "demo-gracia-public-link" },
];

type ExtraApplicantSeed = {
  tenantId: string; applicationId: string; name: string; email: string; phone: string;
  propertyId: string; link: string; status: "new" | "preselected" | "selected" | "final_tenant" | "rejected" | "withdrawn";
  documentState: "complete" | "missing" | "not_requested"; daysAgo: number; adults: number; minors: number;
  incomeCents: number; employment: string; employer: string; message: string; responsible: "admin" | "collaborator" | undefined;
};

const P = {
  chamberi: "55555555-5555-4555-8555-555555555555",
  retiro: "55555555-5555-4555-8555-555555555556",
  arganzuela: "55555555-5555-4555-8555-555555555558",
  lavapies: "55555555-5555-4555-8555-555555555561",
  salamanca: "55555555-5555-4555-8555-555555555562",
  latina: "55555555-5555-4555-8555-555555555563",
  tetuan: "55555555-5555-4555-8555-555555555564",
  eixample: "55555555-5555-4555-8555-555555555566",
  barceloneta: "55555555-5555-4555-8555-555555555567",
  gracia: "55555555-5555-4555-8555-555555555568",
} as const;

const tenantId = (index: number) => `33333333-3333-4333-8333-3333333333${(64 + index).toString(16).padStart(2, "0")}`;
const applicationId = (index: number) => `77777777-7777-4777-8777-7777777777${(128 + index).toString(16).padStart(2, "0")}`;

const EXTRA_APPLICANTS: ExtraApplicantSeed[] = [
  { tenantId: tenantId(1), applicationId: applicationId(1), name: "Carmen Iglesias", email: "carmen.iglesias.demo@inquilink.es", phone: "+34655201948", propertyId: P.chamberi, link: PUBLIC_LINKS.property, status: "rejected", documentState: "complete", daysAgo: 18, adults: 2, minors: 0, incomeCents: 310_000, employment: "Cuenta ajena", employer: "Mapfre", message: "Buscamos mudanza tranquila para octubre.", responsible: "collaborator" },
  { tenantId: tenantId(2), applicationId: applicationId(2), name: "Javier Peña", email: "javier.pena.demo@inquilink.es", phone: "+34677340221", propertyId: P.retiro, link: PUBLIC_LINKS.propertyRetiro, status: "new", documentState: "missing", daysAgo: 2, adults: 2, minors: 1, incomeCents: 640_000, employment: "Cuenta ajena", employer: "Iberdrola", message: "Nos encantaría vivir cerca del parque.", responsible: "admin" },
  { tenantId: tenantId(3), applicationId: applicationId(3), name: "Sofía Camacho", email: "sofia.camacho.demo@inquilink.es", phone: "+34688115402", propertyId: P.retiro, link: PUBLIC_LINKS.propertyRetiro, status: "preselected", documentState: "complete", daysAgo: 6, adults: 1, minors: 0, incomeCents: 420_000, employment: "Cuenta ajena", employer: "Deloitte", message: "Puedo firmar en cuanto haya visita.", responsible: "collaborator" },
  { tenantId: tenantId(4), applicationId: applicationId(4), name: "Hugo Navarro", email: "hugo.navarro.demo@inquilink.es", phone: "+34699482017", propertyId: P.retiro, link: PUBLIC_LINKS.propertyRetiro, status: "withdrawn", documentState: "missing", daysAgo: 12, adults: 2, minors: 0, incomeCents: 380_000, employment: "Autónomo", employer: "Consultoría HN", message: "Al final nos quedamos en nuestro barrio.", responsible: undefined },
  { tenantId: tenantId(5), applicationId: applicationId(5), name: "Paula Ferrer", email: "paula.ferrer.demo@inquilink.es", phone: "+34611203984", propertyId: P.arganzuela, link: PUBLIC_LINKS.propertyArganzuela, status: "selected", documentState: "complete", daysAgo: 15, adults: 2, minors: 2, incomeCents: 560_000, employment: "Cuenta ajena", employer: "Renfe", message: "Necesitamos tres habitaciones y cole cerca.", responsible: "admin" },
  { tenantId: tenantId(6), applicationId: applicationId(6), name: "Iván Castaño", email: "ivan.castano.demo@inquilink.es", phone: "+34622748305", propertyId: P.arganzuela, link: PUBLIC_LINKS.propertyArganzuela, status: "rejected", documentState: "missing", daysAgo: 20, adults: 1, minors: 0, incomeCents: 210_000, employment: "Cuenta ajena", employer: "Decathlon", message: "Me interesa el dúplex por Madrid Río.", responsible: undefined },
  { tenantId: tenantId(7), applicationId: applicationId(7), name: "Alba Robles", email: "alba.robles.demo@inquilink.es", phone: "+34633921740", propertyId: P.lavapies, link: "demo-lavapies-public-link", status: "new", documentState: "complete", daysAgo: 1, adults: 1, minors: 0, incomeCents: 265_000, employment: "Cuenta ajena", employer: "Museo Reina Sofía", message: "Trabajo a cinco minutos andando.", responsible: "collaborator" },
  { tenantId: tenantId(8), applicationId: applicationId(8), name: "Daniel Quintana", email: "daniel.quintana.demo@inquilink.es", phone: "+34644385920", propertyId: P.lavapies, link: "demo-lavapies-public-link", status: "new", documentState: "missing", daysAgo: 3, adults: 2, minors: 0, incomeCents: 340_000, employment: "Autónomo", employer: "Estudio DQ", message: "Buscamos piso reformado con buena luz.", responsible: undefined },
  { tenantId: tenantId(9), applicationId: applicationId(9), name: "Rocío Salgado", email: "rocio.salgado.demo@inquilink.es", phone: "+34655049283", propertyId: P.lavapies, link: "demo-lavapies-public-link", status: "preselected", documentState: "complete", daysAgo: 7, adults: 2, minors: 1, incomeCents: 470_000, employment: "Cuenta ajena", employer: "Correos", message: "Nos encaja el barrio y el precio.", responsible: "collaborator" },
  { tenantId: tenantId(10), applicationId: applicationId(10), name: "Gonzalo Prieto", email: "gonzalo.prieto.demo@inquilink.es", phone: "+34666102938", propertyId: P.salamanca, link: "demo-salamanca-public-link", status: "new", documentState: "complete", daysAgo: 4, adults: 2, minors: 0, incomeCents: 890_000, employment: "Cuenta ajena", employer: "Banco Santander", message: "Buscamos un ático amplio y bien ubicado.", responsible: "admin" },
  { tenantId: tenantId(11), applicationId: applicationId(11), name: "Beatriz Lozano", email: "beatriz.lozano.demo@inquilink.es", phone: "+34677584930", propertyId: P.salamanca, link: "demo-salamanca-public-link", status: "preselected", documentState: "complete", daysAgo: 9, adults: 2, minors: 1, incomeCents: 920_000, employment: "Cuenta ajena", employer: "Clínica Ruber", message: "Nos interesa un contrato de larga duración.", responsible: "admin" },
  { tenantId: tenantId(12), applicationId: applicationId(12), name: "Marc Vilanova", email: "marc.vilanova.demo@inquilink.es", phone: "+34688273049", propertyId: P.eixample, link: "demo-eixample-public-link", status: "new", documentState: "missing", daysAgo: 2, adults: 2, minors: 0, incomeCents: 610_000, employment: "Cuenta ajena", employer: "Seat", message: "Ens encanta la finca modernista.", responsible: "collaborator" },
  { tenantId: tenantId(13), applicationId: applicationId(13), name: "Núria Bosch", email: "nuria.bosch.demo@inquilink.es", phone: "+34699301827", propertyId: P.eixample, link: "demo-eixample-public-link", status: "final_tenant", documentState: "complete", daysAgo: 22, adults: 2, minors: 1, incomeCents: 720_000, employment: "Cuenta ajena", employer: "Hospital Clínic", message: "Familia estable buscando piso definitivo.", responsible: "admin" },
  { tenantId: tenantId(14), applicationId: applicationId(14), name: "Pol Serrat", email: "pol.serrat.demo@inquilink.es", phone: "+34611874029", propertyId: P.eixample, link: "demo-eixample-public-link", status: "rejected", documentState: "not_requested", daysAgo: 16, adults: 1, minors: 0, incomeCents: 190_000, employment: "Estudiante", employer: "UB", message: "Compartiría el piso con dos compañeros.", responsible: undefined },
  { tenantId: tenantId(15), applicationId: applicationId(15), name: "Laia Puig", email: "laia.puig.demo@inquilink.es", phone: "+34622930184", propertyId: P.barceloneta, link: "demo-barceloneta-public-link", status: "new", documentState: "complete", daysAgo: 1, adults: 1, minors: 0, incomeCents: 285_000, employment: "Cuenta ajena", employer: "Port de Barcelona", message: "Vivir frente al mar es mi sueño.", responsible: "collaborator" },
  { tenantId: tenantId(16), applicationId: applicationId(16), name: "Óscar Millán", email: "oscar.millan.demo@inquilink.es", phone: "+34633485960", propertyId: P.barceloneta, link: "demo-barceloneta-public-link", status: "new", documentState: "missing", daysAgo: 5, adults: 1, minors: 0, incomeCents: 240_000, employment: "Autónomo", employer: "Fotografía OM", message: "Busco estudio luminoso para vivir y trabajar.", responsible: undefined },
  { tenantId: tenantId(17), applicationId: applicationId(17), name: "Ariadna Costa", email: "ariadna.costa.demo@inquilink.es", phone: "+34644059382", propertyId: P.gracia, link: "demo-gracia-public-link", status: "preselected", documentState: "complete", daysAgo: 8, adults: 2, minors: 0, incomeCents: 530_000, employment: "Cuenta ajena", employer: "Glovo", message: "La terraza nos ha enamorado.", responsible: "admin" },
  { tenantId: tenantId(18), applicationId: applicationId(18), name: "Teo Ramírez", email: "teo.ramirez.demo@inquilink.es", phone: "+34655672013", propertyId: P.gracia, link: "demo-gracia-public-link", status: "new", documentState: "missing", daysAgo: 3, adults: 1, minors: 0, incomeCents: 300_000, employment: "Cuenta ajena", employer: "Typeform", message: "Teletrabajo y busco un ático tranquilo.", responsible: undefined },
  { tenantId: tenantId(19), applicationId: applicationId(19), name: "Vera Molina", email: "vera.molina.demo@inquilink.es", phone: "+34666820394", propertyId: P.latina, link: "demo-la-latina-public-link", status: "new", documentState: "complete", daysAgo: 2, adults: 1, minors: 0, incomeCents: 230_000, employment: "Cuenta ajena", employer: "Teatro La Latina", message: "Busco algo pequeño en el centro.", responsible: "collaborator" },
  { tenantId: tenantId(20), applicationId: applicationId(20), name: "Adrián Bermejo", email: "adrian.bermejo.demo@inquilink.es", phone: "+34677948302", propertyId: P.latina, link: "demo-la-latina-public-link", status: "withdrawn", documentState: "not_requested", daysAgo: 14, adults: 1, minors: 0, incomeCents: 260_000, employment: "Cuenta ajena", employer: "Cabify", message: "He encontrado otra opción, gracias.", responsible: undefined },
  { tenantId: tenantId(21), applicationId: applicationId(21), name: "Inés Valdés", email: "ines.valdes.demo@inquilink.es", phone: "+34688503917", propertyId: P.tetuan, link: "demo-tetuan-public-link", status: "new", documentState: "missing", daysAgo: 1, adults: 2, minors: 0, incomeCents: 360_000, employment: "Cuenta ajena", employer: "El Corte Inglés", message: "Queremos entrar antes de octubre.", responsible: "collaborator" },
  { tenantId: tenantId(22), applicationId: applicationId(22), name: "Bruno Aguirre", email: "bruno.aguirre.demo@inquilink.es", phone: "+34699274850", propertyId: P.tetuan, link: "demo-tetuan-public-link", status: "preselected", documentState: "complete", daysAgo: 6, adults: 1, minors: 0, incomeCents: 295_000, employment: "Cuenta ajena", employer: "Telefónica", message: "El balcón y el metro cerca me convencen.", responsible: "admin" },
  { tenantId: tenantId(23), applicationId: applicationId(23), name: "Claudia Reyes", email: "claudia.reyes.demo@inquilink.es", phone: "+34611459283", propertyId: P.chamberi, link: PUBLIC_LINKS.property, status: "new", documentState: "missing", daysAgo: 2, adults: 2, minors: 0, incomeCents: 450_000, employment: "Cuenta ajena", employer: "PwC", message: "Chamberí es nuestra primera opción.", responsible: undefined },
  { tenantId: tenantId(24), applicationId: applicationId(24), name: "Mateo Herranz", email: "mateo.herranz.demo@inquilink.es", phone: "+34622039481", propertyId: P.salamanca, link: "demo-salamanca-public-link", status: "rejected", documentState: "missing", daysAgo: 19, adults: 1, minors: 0, incomeCents: 320_000, employment: "Autónomo", employer: "MH Legal", message: "Me interesa aunque sea algo justo de precio.", responsible: undefined },
];

const EXTRA_APPOINTMENTS = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1", propertyId: P.lavapies, applicationId: applicationId(9), responsible: "collaborator" as const, day: 1, hour: 11, state: "scheduled" as const, instructions: "Llamar al timbre del 2ºB.", note: null },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2", propertyId: P.salamanca, applicationId: applicationId(11), responsible: "admin" as const, day: 2, hour: 17, state: "scheduled" as const, instructions: "Portero físico, preguntar por la agencia.", note: "Segunda visita: quieren medir el salón." },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab3", propertyId: P.gracia, applicationId: applicationId(17), responsible: "collaborator" as const, day: 3, hour: 18, state: "scheduled" as const, instructions: "Esperar en el portal de Verdi 72.", note: null },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab4", propertyId: P.eixample, applicationId: applicationId(13), responsible: "admin" as const, day: -6, hour: 12, state: "completed" as const, instructions: "Entrada por la escalera principal.", note: "Familia decidida: pasan a inquilino final." },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab5", propertyId: P.arganzuela, applicationId: applicationId(5), responsible: "admin" as const, day: -8, hour: 10, state: "completed" as const, instructions: "Llaves en la oficina.", note: "Muy buena impresión, revisar nóminas." },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab6", propertyId: P.tetuan, applicationId: applicationId(22), responsible: "collaborator" as const, day: -3, hour: 18, state: "completed" as const, instructions: "Portal junto a la farmacia.", note: null },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab7", propertyId: P.retiro, applicationId: applicationId(4), responsible: "collaborator" as const, day: -5, hour: 17, state: "cancelled" as const, instructions: "Encontrarse en el portal.", note: "El interesado retiró la solicitud." },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab8", propertyId: P.salamanca, applicationId: applicationId(24), responsible: "admin" as const, day: -4, hour: 13, state: "cancelled" as const, instructions: "Portero físico.", note: null },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab9", propertyId: P.latina, applicationId: applicationId(20), responsible: "collaborator" as const, day: -7, hour: 19, state: "no_show" as const, instructions: "Timbre del ático.", note: "No respondió al teléfono." },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaba", propertyId: P.eixample, applicationId: applicationId(14), responsible: "admin" as const, day: -10, hour: 16, state: "no_show" as const, instructions: "Escalera principal.", note: null },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaabb", propertyId: P.barceloneta, applicationId: applicationId(16), responsible: "collaborator" as const, day: -15, hour: 12, state: "completed" as const, instructions: "Frente a la playa.", note: "Visita antigua ya gestionada.", archivedDaysAgo: 12 },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaabc", propertyId: P.chamberi, applicationId: applicationId(1), responsible: "admin" as const, day: -16, hour: 11, state: "cancelled" as const, instructions: "Portal principal.", note: null, archivedDaysAgo: 13 },
] satisfies Array<{ id: string; propertyId: string; applicationId: string; responsible: "admin" | "collaborator"; day: number; hour: number; state: "scheduled" | "completed" | "cancelled" | "no_show"; instructions: string | null; note: string | null; archivedDaysAgo?: number }>;

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
    ...EXTRA_APPLICANTS.map((applicant) => ({ id: applicant.tenantId, kind: "tenant" as const, email: applicant.email, fullName: applicant.name, passwordHash, emailVerifiedAt: now, createdAt: daysFromNow(-applicant.daysAgo), updatedAt: now })),
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
    ...EXTRA_PROPERTIES.map((property) => ({
      id: property.id, agencyId: IDS.agency, responsibleUserId: property.responsible === "admin" ? IDS.agencyAdmin : IDS.agencyCollaborator,
      internalReference: property.reference, title: property.title, address: property.address, city: property.city, province: property.province,
      postalCode: property.postalCode, propertyType: property.type, bedrooms: property.bedrooms, bathrooms: property.bathrooms,
      floorAreaSqm: property.area, availableFrom: property.availableFrom, description: property.description, publicLocation: property.publicLocation,
      requestedDocumentCategories: ["payslips", "employment_contract"], monthlyRentCents: property.rentCents, state: property.state,
      publicLinkTokenHash: hashSecret(property.link), publicLinkTokenCiphertext: publicLinkVault.seal(property.id, property.link), publicLinkIssuedAt: now,
      createdAt: now, updatedAt: now,
    })),
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
    ...EXTRA_APPLICANTS.map((applicant) => ({
      id: applicant.applicationId, agencyId: IDS.agency, propertyId: applicant.propertyId, tenantUserId: applicant.tenantId,
      responsibleUserId: applicant.responsible === "admin" ? IDS.agencyAdmin : applicant.responsible === "collaborator" ? IDS.agencyCollaborator : null,
      status: applicant.status, documentState: applicant.documentState, submittedAt: daysFromNow(-applicant.daysAgo, 9 + (applicant.daysAgo % 9)),
      ...submittedFields(demoApplication({ phone: applicant.phone, adults: applicant.adults, minors: applicant.minors, income: applicant.incomeCents, employment: applicant.employment, employer: applicant.employer, message: applicant.message })),
      consentVersion: "prototype-v1", consentedAt: daysFromNow(-applicant.daysAgo, 9 + (applicant.daysAgo % 9)), sourceLinkTokenHash: hashSecret(applicant.link),
      createdAt: daysFromNow(-applicant.daysAgo, 9 + (applicant.daysAgo % 9)), updatedAt: now,
    })),
  ]).onConflictDoNothing();
  await database.db.insert(appointments).values([
    { id: IDS.appointmentLucia, agencyId: IDS.agency, propertyId: IDS.property, applicationId: IDS.application, responsibleUserId: IDS.agencyAdmin, startsAt: daysFromNow(1, 16), durationMinutes: 30, state: "scheduled", instructions: "Portal principal. Preguntar por Pablo.", internalNote: "Llevar ficha impresa.", createdAt: now, updatedAt: now },
    { id: IDS.appointmentMarina, agencyId: IDS.agency, propertyId: IDS.propertyRetiro, applicationId: IDS.applicationMarina, responsibleUserId: IDS.agencyAdmin, startsAt: daysFromNow(2, 10, 30), durationMinutes: 45, state: "scheduled", instructions: "Encontrarse en el portal.", internalNote: null, createdAt: now, updatedAt: now },
    { id: IDS.appointmentElena, agencyId: IDS.agency, propertyId: IDS.property, applicationId: IDS.applicationElena, responsibleUserId: IDS.agencyAdmin, startsAt: daysFromNow(3, 15, 30), durationMinutes: 30, state: "scheduled", instructions: "Confirmar por teléfono el mismo día.", internalNote: null, createdAt: now, updatedAt: now },
    { id: IDS.appointmentNora, agencyId: IDS.agency, propertyId: IDS.property, applicationId: IDS.applicationNora, responsibleUserId: IDS.agencyAdmin, startsAt: daysFromNow(-2, 17), durationMinutes: 30, state: "completed", instructions: "Portal principal.", internalNote: "Visita realizada con interés alto.", createdAt: daysFromNow(-3), updatedAt: now },
    ...EXTRA_APPOINTMENTS.map((appointment) => ({
      id: appointment.id, agencyId: IDS.agency, propertyId: appointment.propertyId, applicationId: appointment.applicationId,
      responsibleUserId: appointment.responsible === "admin" ? IDS.agencyAdmin : IDS.agencyCollaborator,
      startsAt: daysFromNow(appointment.day, appointment.hour), durationMinutes: 30, state: appointment.state,
      archivedAt: appointment.archivedDaysAgo === undefined ? null : daysFromNow(-appointment.archivedDaysAgo, 9),
      instructions: appointment.instructions, internalNote: appointment.note,
      createdAt: daysFromNow(Math.min(appointment.day, 0) - 2, 9), updatedAt: now,
    })),
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
