import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Buildings,
  CalendarBlank,
  CaretDown,
  ChartLineUp,
  Check,
  CheckCircle,
  Clock,
  Copy,
  CreditCard,
  DotsThree,
  DownloadSimple,
  FilePdf,
  Funnel,
  Gear,
  HouseLine,
  LinkSimple,
  List,
  MagnifyingGlass,
  MapPin,
  NotePencil,
  Plus,
  SidebarSimple,
  SlidersHorizontal,
  Sparkle,
  UploadSimple,
  UserCircle,
  Users,
  Warning,
  WhatsappLogo,
  X,
} from '@phosphor-icons/react'
import { ApplicantCollaborationControls, PlanManager, TeamManager, WorkspaceLogoutButton, uploadPropertyCoverImage } from '../features/funnel/FunnelControls'
import './AgencyWorkspacePage.css'

type View = 'panel' | 'properties' | 'property' | 'appointments' | 'linkedApplicant' | 'linkedAppointment' | 'team' | 'settings' | 'billing'
type ApplicantStatus = 'Nuevo' | 'Preseleccionado' | 'Seleccionado' | 'Inquilino final' | 'Descartado' | 'Retirado'
type PropertyStatus = 'Publicado' | 'Borrador' | 'Pausado' | 'Archivado'
type DocumentStatus = 'Completa' | 'Faltan documentos' | 'Sin solicitar'
type ViewingStatus = 'Sin visita' | 'Por confirmar' | 'Agendada' | 'Realizada'

type Property = {
  id: number
  reference: string
  title: string
  address: string
  city: string
  rent: number
  rooms: number
  applicants: number
  newApplicants: number
  status: PropertyStatus
  nextViewing: string | null
  accent: string
  publicUrl: string
  coverImage?: string
  bathrooms?: number
  area?: number
  type?: string
  province?: string
  postalCode?: string
  available?: string
  description?: string
  assignee?: string
}

type Applicant = {
  id: number
  propertyId: number
  name: string
  email: string
  phone: string
  submitted: string
  submittedIso: string
  household: string
  moveIn: string
  employment: string
  contract: string
  employer: string
  income: number
  ratio: number
  documents: DocumentStatus
  viewing: ViewingStatus
  viewingDate?: string
  assignee: string
  initials: string
  status: ApplicantStatus
  note: string
  preferredContact: string
  pets: string
  guarantor: string
  individualIncome: number
  message: string
  availability: string
}

type Appointment = {
  id: number
  applicantId: number
  applicant: string
  propertyId: number
  property: string
  date: string
  time: string
  assignees: string[]
  status: 'Confirmada' | 'Pendiente' | 'Completada' | 'Cancelada' | 'No se presentó'
  instructions: string
  note: string
  archived?: boolean
}

type ActivityEvent = { id: number; applicantId: number; title: string; detail: string; timestamp: string }

type DashboardApiApplicant = {
  applicationId: string
  propertyId: string
  applicantName: string
  propertyTitle: string
  submittedAt: string
  href: string
}

type DashboardApiViewing = {
  appointmentId: string
  applicationId: string
  propertyId: string
  applicantName: string
  propertyTitle: string
  startsAt: string
  durationMinutes: number
  responsibleUserName: string | null
  href: string
}

type DashboardApiProperty = {
  propertyId: string
  internalReference: string
  title: string
  city: string
  coverImageUrl: string | null
  applicantCount: number
  href: string
}

type DashboardTrendRange = '7d' | '30d' | '90d'
type DashboardTrendProperty = {
  propertyId: string
  internalReference: string
  title: string
  count: number
  href: string
}
type DashboardTrendDay = {
  date: string
  total: number
  properties: DashboardTrendProperty[]
}
type DashboardTrendData = {
  range: DashboardTrendRange
  periodDays: number
  items: DashboardTrendDay[]
}

type DashboardApiData = {
  newApplicants: { count: number; periodDays: 30; href: string; items: DashboardApiApplicant[] }
  upcomingViewings: { href: string; items: DashboardApiViewing[] }
  topProperties: { href: string; items: DashboardApiProperty[] }
}

type DashboardLoadState = 'loading' | 'remote' | 'demo' | 'error' | 'unauthorized'
type LinkedRoute = { kind: 'applicant'; id: string } | { kind: 'appointment'; id: string } | null

type AgencyPropertyApi = {
  property: {
    id: string
    responsibleUserId: string | null
    internalReference: string
    title: string
    address: string | null
    city: string
    province: string
    postalCode: string | null
    publicLocation?: string | null
    propertyType: string | null
    monthlyRentCents: number
    bedrooms: number | null
    bathrooms: number | null
    floorAreaSqm: number | null
    availableFrom: string | null
    description: string | null
    coverImageUrl: string | null
    galleryUrls?: string[]
    requestedDocumentCategories: string[]
    state: 'draft' | 'published' | 'paused' | 'archived'
    version: number
  }
  applicantCount: number
  newApplicantCount: number
  recentNewApplicantCount: number
  nextViewing: { startsAt: string } | null
}

type AgencyAppointmentApi = {
  id: string
  applicationId: string
  propertyId: string
  applicantName: string
  propertyTitle: string
  startsAt: string
  durationMinutes: number
  state: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  archivedAt: string | null
  responsibleUserId: string | null
  responsibleUserName?: string | null
  instructions: string | null
  internalNote: string | null
  updatedAt: string
  href: string
}
type AgencyAppointmentWarning = { code: 'RESPONSIBLE_USER_OVERLAP'; appointmentId: string; startsAt: string; durationMinutes: number }
type AgencyTeamMember = { userId: string; fullName: string; email: string; role: 'admin' | 'collaborator'; joinedAt: string }

type AgencyApplicantDetailApi = {
  application: { id: string; responsibleUserId: string | null; status: 'new' | 'preselected' | 'selected' | 'final_tenant' | 'rejected' | 'withdrawn'; documentState: 'complete' | 'missing' | 'not_requested'; submittedAt: string | null; draftData: Record<string, unknown>; adultProfiles: Array<{ id: string; isPrimary: boolean; fullName: string; email: string | null; phone: string | null; employmentStatus: string; employerOrActivity: string; contractType: string; netMonthlyIncomeCents: number }> }
  applicant: { fullName: string; email: string } | null
  responsibleUser: { id: string; fullName: string } | null
  property: { id: string; internalReference: string; title: string; address: string | null; city: string }
  documents: Array<{ id: string; adultProfileId: string; category: string; originalName: string; createdAt: string }>
  possibleDuplicate: { matchedOn: Array<'email' | 'phone'>; applicationIds: string[] } | null
  notes: Array<{ note: { id: string; body: string; createdAt: string }; authorName: string }>
  appointments: Array<{ id: string; startsAt: string; durationMinutes: number; state: AgencyAppointmentApi['state'] }>
  activity: Array<{ id: string; type: string; createdAt: string; metadata: Record<string, unknown> }>
}

type AgencyIdentity = { user: { fullName: string; email: string }; agency: { name: string; role: 'admin' | 'collaborator' } | null }

type AgencyApplicationListItem = {
  application: AgencyApplicantDetailApi['application']
  tenantName: string
  tenantEmail: string
  responsibleUserName: string | null
  nextViewing: { startsAt: string } | null
  possibleDuplicate: { matchedOn: Array<'email' | 'phone'>; applicationIds: string[] } | null
}

type RemoteLoadState = 'loading' | 'loaded' | 'error'
type PaginationMetadata = { page: number; pageSize: number; total: number; totalPages: number; hasMore: boolean }

const properties: Property[] = [
  { id: 1, reference: 'MAD-042', title: 'Piso luminoso en Chamberí', address: 'Calle de Galileo, 41', city: 'Madrid', rent: 1450, rooms: 2, applicants: 8, newApplicants: 4, status: 'Publicado', nextViewing: 'Mañana, 18:00', accent: 'coral', publicUrl: 'https://inquilink.es/solicitud/mad-042-9vp3k2' },
  { id: 2, reference: 'MAD-038', title: 'Ático con terraza en Retiro', address: 'Calle del Doce de Octubre, 8', city: 'Madrid', rent: 1890, rooms: 3, applicants: 4, newApplicants: 1, status: 'Publicado', nextViewing: '13/08, 12:30', accent: 'blue', publicUrl: 'https://inquilink.es/solicitud/mad-038-5fh8lz' },
  { id: 3, reference: 'MAD-051', title: 'Estudio reformado en Malasaña', address: 'Calle de la Palma, 22', city: 'Madrid', rent: 980, rooms: 1, applicants: 0, newApplicants: 0, status: 'Borrador', nextViewing: null, accent: 'sand', publicUrl: '' },
  { id: 4, reference: 'MAD-029', title: 'Dúplex familiar en Arganzuela', address: 'Paseo de las Delicias, 77', city: 'Madrid', rent: 1650, rooms: 3, applicants: 3, newApplicants: 1, status: 'Pausado', nextViewing: null, accent: 'sage', publicUrl: 'https://inquilink.es/solicitud/mad-029-j8m4pr' },
  { id: 5, reference: 'MAD-057', title: 'Piso reformado en Lavapiés', address: 'Calle de Argumosa, 15', city: 'Madrid', rent: 1200, rooms: 2, applicants: 4, newApplicants: 3, status: 'Publicado', nextViewing: '14/08, 11:00', accent: 'coral', publicUrl: 'https://inquilink.es/solicitud/mad-057-2kd9mq' },
  { id: 6, reference: 'MAD-060', title: 'Ático señorial en Salamanca', address: 'Calle de Ayala, 34', city: 'Madrid', rent: 2400, rooms: 3, applicants: 3, newApplicants: 1, status: 'Publicado', nextViewing: '13/08, 17:00', accent: 'blue', publicUrl: 'https://inquilink.es/solicitud/mad-060-8rt3vx' },
  { id: 7, reference: 'MAD-063', title: 'Estudio acogedor en La Latina', address: 'Calle de la Cava Baja, 9', city: 'Madrid', rent: 890, rooms: 1, applicants: 3, newApplicants: 2, status: 'Publicado', nextViewing: null, accent: 'sand', publicUrl: 'https://inquilink.es/solicitud/mad-063-6pl1wz' },
  { id: 8, reference: 'MAD-066', title: 'Piso con balcón en Tetuán', address: 'Calle de Bravo Murillo, 210', city: 'Madrid', rent: 1150, rooms: 2, applicants: 3, newApplicants: 1, status: 'Publicado', nextViewing: null, accent: 'sage', publicUrl: 'https://inquilink.es/solicitud/mad-066-4hn7ks' },
  { id: 9, reference: 'MAD-071', title: 'Bajo con patio en Usera', address: 'Calle de Marcelo Usera, 51', city: 'Madrid', rent: 990, rooms: 2, applicants: 0, newApplicants: 0, status: 'Pausado', nextViewing: null, accent: 'coral', publicUrl: 'https://inquilink.es/solicitud/mad-071-9sb2fd' },
  { id: 10, reference: 'BCN-104', title: 'Piso modernista en el Eixample', address: 'Carrer de València, 245', city: 'Barcelona', rent: 1750, rooms: 3, applicants: 3, newApplicants: 1, status: 'Publicado', nextViewing: null, accent: 'blue', publicUrl: 'https://inquilink.es/solicitud/bcn-104-3mv8qt' },
  { id: 11, reference: 'BCN-108', title: 'Estudio junto al mar en la Barceloneta', address: 'Carrer del Baluard, 18', city: 'Barcelona', rent: 1050, rooms: 1, applicants: 2, newApplicants: 2, status: 'Publicado', nextViewing: null, accent: 'sand', publicUrl: 'https://inquilink.es/solicitud/bcn-108-7jc5rn' },
  { id: 12, reference: 'BCN-112', title: 'Ático con terraza en Gràcia', address: 'Carrer de Verdi, 72', city: 'Barcelona', rent: 1600, rooms: 2, applicants: 2, newApplicants: 1, status: 'Publicado', nextViewing: '15/08, 18:00', accent: 'sage', publicUrl: 'https://inquilink.es/solicitud/bcn-112-1gx4pb' },
]

function stripAccents(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Compact factory so the demo roster stays readable: anything not provided falls back to a sensible profile. */
function demoApplicant(input: { id: number; propertyId: number; name: string; status: ApplicantStatus; submitted: string; submittedIso: string; income: number } & Partial<Omit<Applicant, 'id' | 'propertyId' | 'name' | 'status' | 'submitted' | 'submittedIso' | 'income'>>): Applicant {
  const rent = properties.find((property) => property.id === input.propertyId)?.rent ?? 0
  return {
    email: `${stripAccents(input.name).toLowerCase().replace(/\s+/g, '.')}@email.es`,
    phone: `+346${String(11000000 + (input.id * 731557) % 88000000).padStart(8, '0')}`,
    household: '1 adulto',
    moveIn: '01/10/2026',
    employment: 'Cuenta ajena',
    contract: 'Indefinido',
    employer: 'Empresa local',
    documents: 'Completa',
    viewing: 'Sin visita',
    assignee: 'Sin asignar',
    initials: applicantInitials(input.name),
    ratio: input.income > 0 ? Math.round((rent / input.income) * 100) : 0,
    individualIncome: input.income,
    note: '',
    preferredContact: 'WhatsApp',
    pets: 'No',
    guarantor: 'No',
    message: 'Nos interesa mucho la vivienda y podemos ajustarnos a las fechas.',
    availability: 'Tardes entre semana',
    ...input,
  }
}

const initialApplicants: Applicant[] = [
  { id: 1, propertyId: 1, name: 'Lucía Martín', email: 'lucia.martin@email.es', phone: '+34612144309', submitted: 'Hoy, 09:42', submittedIso: '2026-08-11T09:42:00+02:00', household: '2 adultos', moveIn: '01/09/2026', employment: 'Cuenta ajena', contract: 'Indefinido', employer: 'Cobalto Studio', income: 4200, ratio: 35, documents: 'Completa', viewing: 'Agendada', viewingDate: '12/08, 18:00', assignee: 'Marta', initials: 'LM', status: 'Preseleccionado', note: 'Prefiere una visita a última hora. Tiene flexibilidad para entrar unos días antes.', preferredContact: 'WhatsApp', pets: 'No', guarantor: 'No es necesario', individualIncome: 2500, message: 'Buscamos un piso tranquilo y nos gusta mucho la zona.', availability: 'Entre semana a partir de las 18:00' },
  { id: 2, propertyId: 1, name: 'Andrés Ruiz', email: 'andres.ruiz@email.es', phone: '+34680776211', submitted: 'Hoy, 08:16', submittedIso: '2026-08-11T08:16:00+02:00', household: '1 adulto', moveIn: '15/09/2026', employment: 'Autónomo', contract: 'Más de 3 años', employer: 'Arquitectura AR', income: 3350, ratio: 43, documents: 'Faltan documentos', viewing: 'Sin visita', assignee: 'Sin asignar', initials: 'AR', status: 'Nuevo', note: 'Pendiente de adjuntar la declaración trimestral más reciente.', preferredContact: 'Correo', pets: 'Un gato', guarantor: 'Sí', individualIncome: 3350, message: 'Trabajo desde casa y busco una vivienda estable.', availability: 'Martes y jueves por la tarde' },
  { id: 3, propertyId: 1, name: 'Elena Sanz', email: 'elena.sanz@email.es', phone: '+34655610428', submitted: '06/08/2026', submittedIso: '2026-08-06T12:00:00+02:00', household: '2 adultos, 1 menor', moveIn: '01/10/2026', employment: 'Cuenta ajena', contract: 'Indefinido', employer: 'Hospital La Paz', income: 5100, ratio: 28, documents: 'Completa', viewing: 'Por confirmar', viewingDate: '12/08, 17:30', assignee: 'Diego', initials: 'ES', status: 'Preseleccionado', note: 'La familia busca contrato de larga duración.', preferredContact: 'Teléfono', pets: 'No', guarantor: 'No', individualIncome: 2900, message: 'Nos interesa especialmente la cercanía al colegio.', availability: 'Fines de semana por la mañana' },
  { id: 4, propertyId: 1, name: 'Samuel Ortega', email: 'samuel.ortega@email.es', phone: '+34622994871', submitted: '05/08/2026', submittedIso: '2026-08-05T12:00:00+02:00', household: '1 adulto', moveIn: '01/09/2026', employment: 'Cuenta ajena', contract: 'Temporal', employer: 'Brava Foods', income: 2600, ratio: 56, documents: 'Completa', viewing: 'Sin visita', assignee: 'Sin asignar', initials: 'SO', status: 'Nuevo', note: 'Ha incluido avalista en la solicitud.', preferredContact: 'WhatsApp', pets: 'No', guarantor: 'Sí', individualIncome: 2600, message: 'Puedo aportar avalista si es necesario.', availability: 'Lunes, miércoles y viernes por la tarde' },
  { id: 5, propertyId: 1, name: 'Nora Vidal', email: 'nora.vidal@email.es', phone: '+34630127449', submitted: '04/08/2026', submittedIso: '2026-08-04T12:00:00+02:00', household: '2 adultos', moveIn: '15/08/2026', employment: 'Cuenta ajena', contract: 'Indefinido', employer: 'Lumen Tech', income: 4750, ratio: 31, documents: 'Faltan documentos', viewing: 'Realizada', viewingDate: '05/08, 19:00', assignee: 'Marta', initials: 'NV', status: 'Inquilino final', note: 'Elegida como inquilina final tras la visita. Pendiente de firmar el contrato.', preferredContact: 'Correo', pets: 'Perro pequeño', guarantor: 'No', individualIncome: 3100, message: 'La vivienda encaja con lo que buscamos.', availability: 'Flexibilidad completa esta semana' },
  { id: 6, propertyId: 1, name: 'Miguel Costa', email: 'miguel.costa@email.es', phone: '+34673990512', submitted: '02/08/2026', submittedIso: '2026-08-02T12:00:00+02:00', household: '1 adulto', moveIn: '01/10/2026', employment: 'Estudiante', contract: 'Con avalista', employer: 'IE University', income: 0, ratio: 0, documents: 'Sin solicitar', viewing: 'Sin visita', assignee: 'Sin asignar', initials: 'MC', status: 'Nuevo', note: 'Cuenta con avalista. Falta revisar la información aportada.', preferredContact: 'WhatsApp', pets: 'No', guarantor: 'Sí', individualIncome: 0, message: 'Mi padre sería el avalista de la operación.', availability: 'Viernes por la tarde' },
  { id: 7, propertyId: 2, name: 'Marina López', email: 'marina.lopez@email.es', phone: '+34611478120', submitted: 'Hoy, 10:05', submittedIso: '2026-08-11T10:05:00+02:00', household: '2 adultos', moveIn: '01/09/2026', employment: 'Cuenta ajena', contract: 'Indefinido', employer: 'Kiro Labs', income: 5900, ratio: 32, documents: 'Completa', viewing: 'Agendada', viewingDate: '13/08, 12:30', assignee: 'Marta', initials: 'ML', status: 'Preseleccionado', note: 'Interesada en la terraza y en plaza de garaje cercana.', preferredContact: 'Teléfono', pets: 'No', guarantor: 'No', individualIncome: 3500, message: 'La terraza es justo lo que estábamos buscando.', availability: 'Mañanas de lunes a sábado' },
  demoApplicant({ id: 8, propertyId: 1, name: 'Claudia Reyes', status: 'Nuevo', submitted: 'Hoy, 11:20', submittedIso: '2026-08-11T11:20:00+02:00', income: 4500, household: '2 adultos', employer: 'PwC', documents: 'Faltan documentos', message: 'Chamberí es nuestra primera opción, trabajamos los dos en la zona.' }),
  demoApplicant({ id: 9, propertyId: 1, name: 'Carmen Iglesias', status: 'Descartado', submitted: '24/07/2026', submittedIso: '2026-07-24T10:15:00+02:00', income: 3100, household: '2 adultos', employer: 'Mapfre', assignee: 'Diego', note: 'Descartada: la fecha de entrada no encajaba con la propiedad.' }),
  demoApplicant({ id: 10, propertyId: 2, name: 'Javier Peña', status: 'Nuevo', submitted: '09/08/2026', submittedIso: '2026-08-09T09:30:00+02:00', income: 6400, household: '2 adultos, 1 menor', employer: 'Iberdrola', documents: 'Faltan documentos', message: 'Nos encantaría vivir cerca del parque con nuestra hija.' }),
  demoApplicant({ id: 11, propertyId: 2, name: 'Sofía Camacho', status: 'Preseleccionado', submitted: '05/08/2026', submittedIso: '2026-08-05T16:40:00+02:00', income: 4200, employer: 'Deloitte', viewing: 'Por confirmar', viewingDate: '13/08, 12:00', assignee: 'Marta', note: 'Puede firmar en cuanto haya visita. Perfil muy sólido.' }),
  demoApplicant({ id: 12, propertyId: 2, name: 'Hugo Navarro', status: 'Retirado', submitted: '30/07/2026', submittedIso: '2026-07-30T13:05:00+02:00', income: 3800, household: '2 adultos', employment: 'Autónomo', contract: 'Más de 3 años', employer: 'Consultoría HN', documents: 'Faltan documentos', note: 'Se retiró: se quedan en su barrio actual.' }),
  demoApplicant({ id: 13, propertyId: 4, name: 'Paula Ferrer', status: 'Seleccionado', submitted: '27/07/2026', submittedIso: '2026-07-27T10:00:00+02:00', income: 5600, household: '2 adultos, 2 menores', employer: 'Renfe', viewing: 'Realizada', viewingDate: '03/08, 10:00', assignee: 'Marta', note: 'Visita muy buena. Pendiente de decidir entre dos candidaturas.' }),
  demoApplicant({ id: 14, propertyId: 4, name: 'Iván Castaño', status: 'Descartado', submitted: '22/07/2026', submittedIso: '2026-07-22T18:25:00+02:00', income: 2100, employer: 'Decathlon', documents: 'Faltan documentos', note: 'Ingresos por debajo del ratio recomendado para este dúplex.' }),
  demoApplicant({ id: 15, propertyId: 4, name: 'Óliver Cano', status: 'Nuevo', submitted: '08/08/2026', submittedIso: '2026-08-08T12:10:00+02:00', income: 4900, household: '2 adultos, 1 menor', employer: 'Airbus', message: 'Buscamos espacio para una familia con teletrabajo.' }),
  demoApplicant({ id: 16, propertyId: 5, name: 'Alba Robles', status: 'Nuevo', submitted: 'Ayer, 18:05', submittedIso: '2026-08-10T18:05:00+02:00', income: 2650, employer: 'Museo Reina Sofía', message: 'Trabajo a cinco minutos andando del piso.' }),
  demoApplicant({ id: 17, propertyId: 5, name: 'Daniel Quintana', status: 'Nuevo', submitted: '08/08/2026', submittedIso: '2026-08-08T09:55:00+02:00', income: 3400, household: '2 adultos', employment: 'Autónomo', contract: 'Más de 3 años', employer: 'Estudio DQ', documents: 'Faltan documentos' }),
  demoApplicant({ id: 18, propertyId: 5, name: 'Rocío Salgado', status: 'Preseleccionado', submitted: '04/08/2026', submittedIso: '2026-08-04T11:35:00+02:00', income: 4700, household: '2 adultos, 1 menor', employer: 'Correos', viewing: 'Por confirmar', viewingDate: '14/08, 11:00', assignee: 'Carlos', note: 'Muy interesados; confirmar la visita del viernes por teléfono.' }),
  demoApplicant({ id: 19, propertyId: 5, name: 'Emma Garrido', status: 'Nuevo', submitted: '06/08/2026', submittedIso: '2026-08-06T20:15:00+02:00', income: 2900, employer: 'Vodafone', preferredContact: 'Correo' }),
  demoApplicant({ id: 20, propertyId: 6, name: 'Gonzalo Prieto', status: 'Nuevo', submitted: '07/08/2026', submittedIso: '2026-08-07T10:45:00+02:00', income: 8900, household: '2 adultos', employer: 'Banco Santander', message: 'Buscamos un ático amplio y bien ubicado.' }),
  demoApplicant({ id: 21, propertyId: 6, name: 'Beatriz Lozano', status: 'Preseleccionado', submitted: '02/08/2026', submittedIso: '2026-08-02T17:20:00+02:00', income: 9200, household: '2 adultos, 1 menor', employer: 'Clínica Ruber', viewing: 'Agendada', viewingDate: '13/08, 17:00', assignee: 'Marta', note: 'Segunda visita para medir el salón. Perfil excelente.' }),
  demoApplicant({ id: 22, propertyId: 6, name: 'Mateo Herranz', status: 'Descartado', submitted: '23/07/2026', submittedIso: '2026-07-23T12:30:00+02:00', income: 3200, employment: 'Autónomo', contract: 'Menos de 1 año', employer: 'MH Legal', documents: 'Faltan documentos', assignee: 'Diego', note: 'El ratio de esfuerzo superaba el 70 % de sus ingresos.' }),
  demoApplicant({ id: 23, propertyId: 7, name: 'Vera Molina', status: 'Nuevo', submitted: '09/08/2026', submittedIso: '2026-08-09T19:00:00+02:00', income: 2300, employer: 'Teatro La Latina', message: 'Busco algo pequeño y con encanto en el centro.' }),
  demoApplicant({ id: 24, propertyId: 7, name: 'Adrián Bermejo', status: 'Retirado', submitted: '28/07/2026', submittedIso: '2026-07-28T09:10:00+02:00', income: 2600, employer: 'Cabify', documents: 'Sin solicitar', note: 'No se presentó a la visita y avisó de que encontró otro piso.' }),
  demoApplicant({ id: 25, propertyId: 7, name: 'Irene Sastre', status: 'Nuevo', submitted: '05/08/2026', submittedIso: '2026-08-05T15:50:00+02:00', income: 2500, employer: 'Ilunion', preferredContact: 'Teléfono' }),
  demoApplicant({ id: 26, propertyId: 8, name: 'Inés Valdés', status: 'Nuevo', submitted: 'Ayer, 10:30', submittedIso: '2026-08-10T10:30:00+02:00', income: 3600, household: '2 adultos', employer: 'El Corte Inglés', documents: 'Faltan documentos', message: 'Queremos entrar antes de octubre.' }),
  demoApplicant({ id: 27, propertyId: 8, name: 'Bruno Aguirre', status: 'Preseleccionado', submitted: '05/08/2026', submittedIso: '2026-08-05T13:15:00+02:00', income: 2950, employer: 'Telefónica', viewing: 'Realizada', viewingDate: '08/08, 18:30', assignee: 'Diego', note: 'Visita realizada con buena impresión. Pedir vida laboral.' }),
  demoApplicant({ id: 28, propertyId: 8, name: 'Nacho Ibáñez', status: 'Seleccionado', submitted: '30/07/2026', submittedIso: '2026-07-30T11:00:00+02:00', income: 4100, household: '2 adultos', employer: 'Indra', viewing: 'Realizada', viewingDate: '02/08, 12:00', assignee: 'Marta', note: 'Seleccionado a falta de contrastar referencias del anterior casero.' }),
  demoApplicant({ id: 29, propertyId: 10, name: 'Marc Vilanova', status: 'Nuevo', submitted: '09/08/2026', submittedIso: '2026-08-09T12:40:00+02:00', income: 6100, household: '2 adultos', employer: 'Seat', message: 'Ens encanta la finca modernista i el barri.' }),
  demoApplicant({ id: 30, propertyId: 10, name: 'Núria Bosch', status: 'Inquilino final', submitted: '20/07/2026', submittedIso: '2026-07-20T09:00:00+02:00', income: 7200, household: '2 adultos, 1 menor', employer: 'Hospital Clínic', viewing: 'Realizada', viewingDate: '05/08, 12:00', assignee: 'Marta', note: 'Inquilina final. Contrato en preparación para firmar esta semana.' }),
  demoApplicant({ id: 31, propertyId: 10, name: 'Pol Serrat', status: 'Descartado', submitted: '26/07/2026', submittedIso: '2026-07-26T16:05:00+02:00', income: 1900, employment: 'Estudiante', contract: 'Con avalista', employer: 'Universitat de Barcelona', documents: 'Sin solicitar', guarantor: 'Sí', note: 'No se presentó a la visita programada.' }),
  demoApplicant({ id: 32, propertyId: 11, name: 'Laia Puig', status: 'Nuevo', submitted: 'Ayer, 09:20', submittedIso: '2026-08-10T09:20:00+02:00', income: 2850, employer: 'Port de Barcelona', message: 'Vivir frente al mar es mi sueño desde siempre.' }),
  demoApplicant({ id: 33, propertyId: 11, name: 'Óscar Millán', status: 'Nuevo', submitted: '06/08/2026', submittedIso: '2026-08-06T14:30:00+02:00', income: 2400, employment: 'Autónomo', contract: 'Más de 3 años', employer: 'Fotografía OM', documents: 'Faltan documentos', viewing: 'Realizada', viewingDate: '27/07, 12:00' }),
  demoApplicant({ id: 34, propertyId: 12, name: 'Ariadna Costa', status: 'Preseleccionado', submitted: '03/08/2026', submittedIso: '2026-08-03T18:45:00+02:00', income: 5300, household: '2 adultos', employer: 'Glovo', viewing: 'Agendada', viewingDate: '15/08, 18:00', assignee: 'Carlos', note: 'La terraza les ha enamorado. Visita confirmada.' }),
  demoApplicant({ id: 35, propertyId: 12, name: 'Teo Ramírez', status: 'Nuevo', submitted: '08/08/2026', submittedIso: '2026-08-08T08:50:00+02:00', income: 3000, employer: 'Typeform', message: 'Teletrabajo y busco un ático tranquilo con exterior.' }),
]

const initialAppointments: Appointment[] = [
  { id: 1, applicantId: 1, applicant: 'Lucía Martín', propertyId: 1, property: 'Piso luminoso en Chamberí', date: '12/08/2026', time: '18:00', assignees: ['Marta Soler'], status: 'Confirmada', instructions: 'Portal principal. Preguntar por Marta.', note: 'Llevar ficha impresa.' },
  { id: 2, applicantId: 7, applicant: 'Marina López', propertyId: 2, property: 'Ático con terraza en Retiro', date: '13/08/2026', time: '12:30', assignees: ['Marta Soler', 'Diego García'], status: 'Confirmada', instructions: 'Encontrarse en el portal.', note: '' },
  { id: 3, applicantId: 3, applicant: 'Elena Sanz', propertyId: 1, property: 'Piso luminoso en Chamberí', date: '12/08/2026', time: '17:30', assignees: ['Diego García'], status: 'Pendiente', instructions: 'Confirmar por teléfono el mismo día.', note: '' },
  { id: 4, applicantId: 5, applicant: 'Nora Vidal', propertyId: 1, property: 'Piso luminoso en Chamberí', date: '05/08/2026', time: '19:00', assignees: ['Marta Soler'], status: 'Completada', instructions: 'Portal principal.', note: 'Visita realizada con interés alto.' },
  { id: 5, applicantId: 11, applicant: 'Sofía Camacho', propertyId: 2, property: 'Ático con terraza en Retiro', date: '13/08/2026', time: '12:00', assignees: ['Marta Soler'], status: 'Pendiente', instructions: 'Encontrarse en el portal.', note: 'Puede firmar en cuanto vea el piso.' },
  { id: 6, applicantId: 18, applicant: 'Rocío Salgado', propertyId: 5, property: 'Piso reformado en Lavapiés', date: '14/08/2026', time: '11:00', assignees: ['Carlos Jiménez'], status: 'Pendiente', instructions: 'Llamar al timbre del 2ºB.', note: '' },
  { id: 7, applicantId: 21, applicant: 'Beatriz Lozano', propertyId: 6, property: 'Ático señorial en Salamanca', date: '13/08/2026', time: '17:00', assignees: ['Marta Soler'], status: 'Confirmada', instructions: 'Portero físico, preguntar por la agencia.', note: 'Segunda visita: quieren medir el salón.' },
  { id: 8, applicantId: 34, applicant: 'Ariadna Costa', propertyId: 12, property: 'Ático con terraza en Gràcia', date: '15/08/2026', time: '18:00', assignees: ['Carlos Jiménez', 'Diego García'], status: 'Confirmada', instructions: 'Esperar en el portal de Verdi 72.', note: '' },
  { id: 9, applicantId: 13, applicant: 'Paula Ferrer', propertyId: 4, property: 'Dúplex familiar en Arganzuela', date: '03/08/2026', time: '10:00', assignees: ['Marta Soler', 'Diego García'], status: 'Completada', instructions: 'Llaves en la oficina.', note: 'Muy buena impresión, revisar nóminas.' },
  { id: 10, applicantId: 30, applicant: 'Núria Bosch', propertyId: 10, property: 'Piso modernista en el Eixample', date: '05/08/2026', time: '12:00', assignees: ['Marta Soler'], status: 'Completada', instructions: 'Entrada por la escalera principal.', note: 'Familia decidida: pasa a inquilina final.' },
  { id: 11, applicantId: 27, applicant: 'Bruno Aguirre', propertyId: 8, property: 'Piso con balcón en Tetuán', date: '08/08/2026', time: '18:30', assignees: ['Diego García'], status: 'Completada', instructions: 'Portal junto a la farmacia.', note: '' },
  { id: 12, applicantId: 12, applicant: 'Hugo Navarro', propertyId: 2, property: 'Ático con terraza en Retiro', date: '06/08/2026', time: '17:00', assignees: ['Diego García'], status: 'Cancelada', instructions: 'Encontrarse en el portal.', note: 'El interesado retiró la solicitud.' },
  { id: 13, applicantId: 22, applicant: 'Mateo Herranz', propertyId: 6, property: 'Ático señorial en Salamanca', date: '07/08/2026', time: '13:00', assignees: ['Marta Soler'], status: 'Cancelada', instructions: 'Portero físico.', note: '' },
  { id: 14, applicantId: 24, applicant: 'Adrián Bermejo', propertyId: 7, property: 'Estudio acogedor en La Latina', date: '04/08/2026', time: '19:00', assignees: ['Diego García'], status: 'No se presentó', instructions: 'Timbre del ático.', note: 'No respondió al teléfono.' },
  { id: 15, applicantId: 31, applicant: 'Pol Serrat', propertyId: 10, property: 'Piso modernista en el Eixample', date: '01/08/2026', time: '16:00', assignees: ['Marta Soler'], status: 'No se presentó', instructions: 'Escalera principal.', note: '' },
  { id: 16, applicantId: 33, applicant: 'Óscar Millán', propertyId: 11, property: 'Estudio junto al mar en la Barceloneta', date: '27/07/2026', time: '12:00', assignees: ['Carlos Jiménez'], status: 'Completada', instructions: 'Frente a la playa.', note: 'Visita antigua ya gestionada.', archived: true },
  { id: 17, applicantId: 9, applicant: 'Carmen Iglesias', propertyId: 1, property: 'Piso luminoso en Chamberí', date: '26/07/2026', time: '11:00', assignees: ['Marta Soler'], status: 'Cancelada', instructions: 'Portal principal.', note: '', archived: true },
]

const statuses: ApplicantStatus[] = ['Nuevo', 'Preseleccionado', 'Seleccionado', 'Inquilino final', 'Descartado', 'Retirado']
const remoteApplicantStatusLabels: Record<AgencyApplicantDetailApi['application']['status'], ApplicantStatus> = { new: 'Nuevo', preselected: 'Preseleccionado', selected: 'Seleccionado', final_tenant: 'Inquilino final', rejected: 'Descartado', withdrawn: 'Retirado' }
const remoteApplicantStatusOrder: Array<AgencyApplicantDetailApi['application']['status']> = ['new', 'preselected', 'selected', 'final_tenant', 'rejected', 'withdrawn']
const demoTeamMembers = [
  { name: 'Marta Soler', email: 'marta@casabarrio.es', role: 'Administradora' as const, joined: 'Enero de 2026' },
  { name: 'Diego García', email: 'diego@casabarrio.es', role: 'Colaborador' as const, joined: 'Febrero de 2026' },
  { name: 'Carlos Jiménez', email: 'carlos@casabarrio.es', role: 'Colaborador' as const, joined: 'Mayo de 2026' },
]
const demoTeam = demoTeamMembers.map((member) => member.name)
const demoAgencyProfile = { name: 'Casa Barrio', email: 'hola@casabarrio.es', phone: '+34 910 555 214', city: 'Madrid' }
/** Catálogo de planes: debe coincidir con el modelo de facturación real (AuthBillingPage / billing API). */
const billingPlanCatalog = [
  { code: 'particular' as const, name: 'Particular', price: '9,99 €', listingLimit: 2, accountLimit: 1 },
  { code: 'professional' as const, name: 'Profesional', price: '49,99 €', listingLimit: 15, accountLimit: 3 },
  { code: 'inmobiliaria' as const, name: 'Inmobiliaria', price: '99,99 €', listingLimit: 100, accountLimit: null },
]
const demoBilling = { plan: 'inmobiliaria' as const, trialEndsOn: '06/09/2026', card: 'Visa terminada en 4242', cardExpiry: '08/29' }
const appointmentKanbanStatuses: Appointment['status'][] = ['Pendiente', 'Confirmada', 'Completada', 'Cancelada', 'No se presentó']
const defaultVisitDurationMinutes = 30
type BillingPlanCode = 'particular' | 'professional' | 'inmobiliaria'
const dayInMilliseconds = 86_400_000

function formatMoney(amount: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount)
}

function applicantCountLabel(count: number) {
  return `${count} ${count === 1 ? 'interesado' : 'interesados'}`
}

function madridDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Madrid' }).format(date)
}

function chartDateLabel(date: string, long = false) {
  const label = new Intl.DateTimeFormat('es-ES', long
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'short' })
    .format(new Date(`${date}T12:00:00`))
    .replace('.', '')
  return long ? `${label[0].toUpperCase()}${label.slice(1)}` : label
}

function demoTrendDays(range: DashboardTrendRange, applicants: Applicant[], propertyList: Property[], now = new Date()): DashboardTrendDay[] {
  const periodDays = ({ '7d': 7, '30d': 30, '90d': 90 } as const)[range]
  const days = Array.from({ length: periodDays }, (_, index) => madridDateKey(new Date(now.getTime() - (periodDays - index - 1) * dayInMilliseconds)))
  const daySet = new Set(days)
  const counts = new Map<string, Map<number, number>>()
  for (const applicant of applicants) {
    const date = madridDateKey(new Date(applicant.submittedIso))
    if (!daySet.has(date)) continue
    const propertiesForDay = counts.get(date) ?? new Map<number, number>()
    propertiesForDay.set(applicant.propertyId, (propertiesForDay.get(applicant.propertyId) ?? 0) + 1)
    counts.set(date, propertiesForDay)
  }
  return days.map((date) => {
    const propertiesForDay = counts.get(date) ?? new Map<number, number>()
    const breakdown = [...propertiesForDay.entries()].map(([propertyId, count]) => {
      const property = propertyList.find((item) => item.id === propertyId)
      return {
        propertyId: String(propertyId),
        internalReference: property?.reference ?? 'Anuncio',
        title: property?.title ?? 'Anuncio no disponible',
        count,
        href: `/app/anuncios/${propertyId}`,
      }
    }).sort((left, right) => right.count - left.count || left.title.localeCompare(right.title, 'es'))
    return { date, total: breakdown.reduce((total, property) => total + property.count, 0), properties: breakdown }
  })
}

function appointmentToTimestamp(appointment: Pick<Appointment, 'date' | 'time'>) {
  const [day, month, year] = appointment.date.split('/').map(Number)
  const [hour, minute] = appointment.time.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute).getTime()
}

function isNewInLast30Days(applicant: Applicant, now = new Date()) {
  if (applicant.status !== 'Nuevo') return false
  const submittedAt = new Date(applicant.submittedIso).getTime()
  return submittedAt >= now.getTime() - (30 * dayInMilliseconds) && submittedAt <= now.getTime()
}

function dashboardDateLabel(date: string, now = new Date()) {
  const [day, month, year] = date.split('/').map(Number)
  const value = new Date(year, month - 1, day)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const difference = Math.round((value.getTime() - today.getTime()) / dayInMilliseconds)
  if (difference === 0) return 'Hoy'
  if (difference === 1) return 'Mañana'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', timeZone: 'Europe/Madrid' }).format(value).replace('.', '')
}

function dashboardMonthLabel(date: string) {
  const [day, month, year] = date.split('/').map(Number)
  return new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'Europe/Madrid' })
    .format(new Date(year, month - 1, day))
    .replace('.', '')
    .toUpperCase()
}

function linkedRouteFromPath(pathname: string): LinkedRoute {
  const applicant = pathname.match(/^\/app\/anuncios\/[^/]+\/interesados\/([^/]+)$/)
  if (applicant) return { kind: 'applicant', id: decodeURIComponent(applicant[1]) }
  const appointment = pathname.match(/^\/app\/citas\/([^/]+)$/)
  if (appointment) return { kind: 'appointment', id: decodeURIComponent(appointment[1]) }
  return null
}

function initialViewFromLocation(): View {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  const linked = linkedRouteFromPath(path)
  if (linked?.kind === 'applicant') return 'linkedApplicant'
  if (linked?.kind === 'appointment') return 'linkedAppointment'
  if (/^\/app\/anuncios\/[^/]+$/.test(path)) return 'property'
  if (path.startsWith('/app/anuncios')) return 'properties'
  if (path.startsWith('/app/citas')) return 'appointments'
  return 'panel'
}

function propertyIdFromPath(pathname = window.location.pathname) {
  const match = pathname.match(/^\/app\/anuncios\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

function apiDateParts(iso: string) {
  const value = new Date(iso)
  return {
    day: new Intl.DateTimeFormat('es-ES', { day: '2-digit', timeZone: 'Europe/Madrid' }).format(value),
    month: new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'Europe/Madrid' }).format(value).replace('.', '').toUpperCase(),
    date: new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Madrid' }).format(value),
    time: new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }).format(value),
  }
}

function apiRelativeDateTime(iso: string, now = new Date()) {
  const value = new Date(iso)
  const inMadrid = (date: Date) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Madrid' }).format(date)
  const today = inMadrid(now)
  const target = inMadrid(value)
  const tomorrow = inMadrid(new Date(now.getTime() + dayInMilliseconds))
  const yesterday = inMadrid(new Date(now.getTime() - dayInMilliseconds))
  const parts = apiDateParts(iso)
  if (target === today) return `Hoy, ${parts.time}`
  if (target === tomorrow) return `Mañana, ${parts.time}`
  if (target === yesterday) return `Ayer, ${parts.time}`
  return `${parts.date}, ${parts.time}`
}

function agencyRequestError(response: Response) {
  return response.status === 401 || response.status === 403
    ? 'Tu sesión ha caducado. Inicia sesión de nuevo para continuar.'
    : 'No hemos podido cargar esta información. Inténtalo de nuevo.'
}

async function agencyResponseError(response: Response) {
  try {
    const payload = await response.clone().json() as { error?: { message?: string } }
    if (payload.error?.message) return payload.error.message
  } catch { /* Fall back to a stable client-side message. */ }
  return agencyRequestError(response)
}

async function fetchAllAgencyTeamMembers(signal?: AbortSignal): Promise<AgencyTeamMember[]> {
  const members: AgencyTeamMember[] = []
  let page = 1
  let hasMore = true
  while (hasMore) {
    const response = await fetch(`/api/v1/agency/team?page=${page}&pageSize=100`, { credentials: 'include', headers: { Accept: 'application/json' }, signal })
    if (!response.ok) throw new Error(agencyRequestError(response))
    const payload = await response.json() as { data?: { members?: AgencyTeamMember[]; pagination?: PaginationMetadata } }
    members.push(...(payload.data?.members ?? []))
    hasMore = payload.data?.pagination?.hasMore ?? false
    page += 1
  }
  return members
}

function isSessionError(message: string) {
  return message.toLowerCase().includes('sesión')
}

function useBillingPlan(enabled: boolean) {
  const [plan, setPlan] = useState<BillingPlanCode | null>(null)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await fetch('/api/v1/billing/status', { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal })
        if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/json')) return
        const payload = await response.json() as { data?: { subscription?: { plan?: BillingPlanCode } | null } }
        const loaded = payload.data?.subscription?.plan
        if (loaded === 'particular' || loaded === 'professional' || loaded === 'inmobiliaria') setPlan(loaded)
      } catch { /* The worker picker simply stays visible if the plan cannot be loaded. */ }
    }
    void load()
    return () => controller.abort()
  }, [enabled])
  return plan
}

function hideWorkerPicker(teamMembers: AgencyTeamMember[], plan: BillingPlanCode | null) {
  return plan === 'particular' || teamMembers.length <= 1
}

function detailValue(value: unknown) {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (value === null || value === undefined || value === '') return 'No indicado'
  return String(value)
}

function madridDateTimeLocal(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }).formatToParts(new Date(iso))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

function madridLocalToIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) throw new Error('Introduce una fecha y hora válidas.')
  const [, year, month, day, hour, minute] = match.map(Number)
  const desired = Date.UTC(year, month - 1, day, hour, minute)
  let instant = desired
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }).formatToParts(new Date(instant))
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
    const represented = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
    instant += desired - represented
  }
  const iso = new Date(instant).toISOString()
  if (madridDateTimeLocal(iso) !== value) throw new Error('Esa hora no existe en Madrid por el cambio horario. Elige otra hora.')
  return iso
}

function applicantStatusCopy(status: unknown) {
  const labels: Record<string, string> = { new: 'Nuevo', preselected: 'Preseleccionado', selected: 'Seleccionado', final_tenant: 'Inquilino final', rejected: 'Descartado', withdrawn: 'Retirado' }
  return labels[String(status)] ?? String(status ?? '')
}

function contactChannelCopy(value: unknown) {
  return ({ whatsapp: 'WhatsApp', phone: 'Teléfono', email: 'Correo electrónico' } as Record<string, string>)[String(value)] ?? detailValue(value)
}

function yesNoCopy(value: unknown) {
  return ({ yes: 'Sí', no: 'No', unsure: 'No está seguro' } as Record<string, string>)[String(value)] ?? detailValue(value)
}

function documentCategoryCopy(value: unknown) {
  return ({ payslips: 'Nóminas', employment_contract: 'Contrato de trabajo', self_employed_income: 'Ingresos de autónomo', irpf_tax_return: 'Declaración de la renta (IRPF)', employment_history: 'Vida laboral', pension_proof: 'Justificante de pensión', guarantor_proof: 'Documentación del avalista', supporting: 'Documentación adicional' } as Record<string, string>)[String(value)] ?? detailValue(value)
}

function applicationText(item: AgencyApplicationListItem, key: string) {
  const value = item.application.draftData[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function applicationNumber(item: AgencyApplicationListItem, key: string) {
  const value = item.application.draftData[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function applicantInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'IN'
}

function formatPhoneDisplay(phone: string | null) {
  if (!phone) return 'Sin teléfono'
  return phone.trim().replace(/^(\+34)\s*/, '$1 ')
}

function employmentStatusCopy(value: string | null) {
  if (!value) return 'No indicado'
  const labels: Record<string, string> = { employed: 'Cuenta ajena', self_employed: 'Autónomo', unemployed: 'Desempleado', student: 'Estudiante', retired: 'Jubilado' }
  return labels[value] ?? value
}

function contractTypeCopy(value: string | null) {
  if (!value) return 'Contrato no indicado'
  const labels: Record<string, string> = { indefinite: 'Indefinido', temporary: 'Temporal', freelance: 'Autónomo', student: 'Estudiante', guarantor: 'Con avalista' }
  return labels[value] ?? value
}

function dateOnlyCopy(value: string | null) {
  if (!value) return 'No indicada'
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

function householdCopy(item: AgencyApplicationListItem) {
  const adults = applicationNumber(item, 'adultOccupants')
  const minors = applicationNumber(item, 'minorOccupants')
  if (adults === null && minors === null) return 'Hogar no indicado'
  const parts = [`${adults ?? 0} ${(adults ?? 0) === 1 ? 'adulto' : 'adultos'}`]
  if ((minors ?? 0) > 0) parts.push(`${minors} ${(minors ?? 0) === 1 ? 'menor' : 'menores'}`)
  return parts.join(', ')
}

function defaultRemoteAppointmentLocal() {
  const tomorrow = new Date(Date.now() + dayInMilliseconds)
  return `${madridDateTimeLocal(tomorrow.toISOString()).slice(0, 10)}T17:00`
}

function remoteApplicantPresentation(item: AgencyApplicationListItem, monthlyRentCents: number) {
  const incomeCents = applicationNumber(item, 'householdNetMonthlyIncomeCents') ?? 0
  return {
    initials: applicantInitials(item.tenantName),
    phone: formatPhoneDisplay(applicationText(item, 'phone')),
    moveIn: dateOnlyCopy(applicationText(item, 'intendedMoveInDate')),
    employment: employmentStatusCopy(applicationText(item, 'employmentStatus')),
    contract: contractTypeCopy(applicationText(item, 'contractType')),
    household: householdCopy(item),
    income: incomeCents > 0 ? formatMoney(incomeCents / 100) : 'Con avalista',
    ratio: incomeCents > 0 ? `${Math.round((monthlyRentCents / incomeCents) * 100)}% del ingreso` : 'Sin ratio disponible',
    viewing: item.nextViewing ? 'Agendada' as const : 'Sin visita' as const,
    viewingDate: item.nextViewing ? apiRelativeDateTime(item.nextViewing.startsAt) : null,
    assignee: item.responsibleUserName ?? 'Sin asignar',
  }
}

function appointmentStateCopy(value: AgencyAppointmentApi['state']) {
  return ({ scheduled: 'Programada', completed: 'Completada', cancelled: 'Cancelada', no_show: 'No se presentó' } as const)[value]
}

function activityCopy(event: AgencyApplicantDetailApi['activity'][number]) {
  if (event.type === 'application_submitted') return 'Solicitud enviada'
  if (event.type === 'status_changed') return `Estado actualizado: ${applicantStatusCopy(event.metadata.fromStatus)} → ${applicantStatusCopy(event.metadata.toStatus)}`
  const labels: Record<string, string> = {
    note_added: 'Nota interna añadida',
    whatsapp_contact_initiated: 'Contacto por WhatsApp iniciado',
    document_accessed: 'Documento consultado',
    appointment_scheduled: 'Visita programada',
    appointment_reschedule: 'Visita reprogramada',
    appointment_cancel: 'Visita cancelada',
    appointment_complete: 'Visita completada',
    appointment_no_show: 'Ausencia registrada',
    appointment_archive: 'Visita archivada',
    appointment_unarchive: 'Visita restaurada',
  }
  return labels[event.type] ?? 'Actividad actualizada'
}

function PropertyVisual({ property }: { property: Property }) {
  if (property.coverImage) return <img className="agency-property-api-cover" src={property.coverImage} alt="" />
  return (
    <div className={`agency-property-visual agency-property-visual--${property.accent}`} aria-hidden="true">
      <HouseLine size={25} weight="duotone" />
    </div>
  )
}

function statusSlug(status: string) {
  return status.toLowerCase().replaceAll(' ', '-').replaceAll('ó', 'o').replaceAll('í', 'i')
}

function StatusBadge({ status }: { status: ApplicantStatus | PropertyStatus | DocumentStatus | ViewingStatus | Appointment['status'] }) {
  return <span className={`agency-status agency-status--${statusSlug(status)}`}>{status}</span>
}

function AppLogo() {
  return (
    <span className="agency-logo" aria-label="Inquilink">
      <span className="agency-logo__mark" aria-hidden="true">i</span>
      <span>inquilink</span>
    </span>
  )
}

export function AgencyWorkspacePage() {
  const [view, setView] = useState<View>(initialViewFromLocation)
  const [workspaceProperties, setWorkspaceProperties] = useState(properties)
  const [selectedPropertyId, setSelectedPropertyId] = useState(1)
  const [applicants, setApplicants] = useState(initialApplicants)
  const [appointments, setAppointments] = useState(initialAppointments)
  const [activities, setActivities] = useState<ActivityEvent[]>([
    { id: 1, applicantId: 1, title: 'Solicitud recibida', detail: 'Formulario web', timestamp: 'Hoy, 09:42' },
    { id: 2, applicantId: 2, title: 'Documentación solicitada', detail: 'Marta Soler', timestamp: 'Hoy, 09:05' },
  ])
  const [propertySearch, setPropertySearch] = useState('')
  const [propertyStatus, setPropertyStatus] = useState<'Todos' | PropertyStatus>('Todos')
  const [onlyPropertiesWithNewApplicants, setOnlyPropertiesWithNewApplicants] = useState(() => new URLSearchParams(window.location.search).get('estado') === 'Nuevo')
  const [applicantSearch, setApplicantSearch] = useState('')
  const [applicantStatus, setApplicantStatus] = useState<'Todos' | ApplicantStatus>('Todos')
  const [documentStatus, setDocumentStatus] = useState<'Todos' | DocumentStatus>('Todos')
  const [viewingFilter, setViewingFilter] = useState<'Todas' | ViewingStatus>('Todas')
  const [submittedFilter, setSubmittedFilter] = useState<'Cualquier fecha' | 'Hoy' | 'Últimos 7 días'>('Cualquier fecha')
  const [assigneeFilter, setAssigneeFilter] = useState('Todos')
  const [sort, setSort] = useState('Más recientes')
  const [selectedApplicantId, setSelectedApplicantId] = useState<number | null>(null)
  const [appointmentApplicantId, setAppointmentApplicantId] = useState<number | null>(null)
  const [editingAppointmentId, setEditingAppointmentId] = useState<number | null>(null)
  const [propertyEditorId, setPropertyEditorId] = useState<number | 'new' | null>(null)
  const [remotePropertyEditor, setRemotePropertyEditor] = useState<'new' | AgencyPropertyApi | null>(null)
  const [focusedAppointmentId, setFocusedAppointmentId] = useState<number | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [copiedPropertyId, setCopiedPropertyId] = useState<number | null>(null)
  const [toast, setToast] = useState('')
  const [dashboardData, setDashboardData] = useState<DashboardApiData | null>(null)
  const [dashboardLoadState, setDashboardLoadState] = useState<DashboardLoadState>('loading')
  const [dashboardLoadError, setDashboardLoadError] = useState('')
  const [dashboardReloadKey, setDashboardReloadKey] = useState(0)
  const [identity, setIdentity] = useState<AgencyIdentity | null>(null)
  const [remotePropertyId, setRemotePropertyId] = useState<string | null>(propertyIdFromPath)
  const unauthorizedRedirectStarted = useRef(false)

  useEffect(() => {
    let cancelled = false
    const isStandaloneDemo = ['127.0.0.1', 'localhost'].includes(window.location.hostname) && window.location.port === '5173'
    const loadDashboard = async () => {
      setDashboardData(null)
      setDashboardLoadError('')
      setDashboardLoadState('loading')
      try {
        const response = await fetch('/api/v1/agency/dashboard', { credentials: 'include', headers: { Accept: 'application/json' } })
        const contentType = response.headers.get('content-type') ?? ''
        if (response.status === 401 || response.status === 403) {
          if (!cancelled) {
            if (isStandaloneDemo) setDashboardLoadState('demo')
            else setDashboardLoadState('unauthorized')
          }
          return
        }
        if (!contentType.includes('application/json')) {
          if (!cancelled) {
            if (isStandaloneDemo) setDashboardLoadState('demo')
            else { setDashboardLoadError('No hemos podido cargar el panel. Inténtalo de nuevo.'); setDashboardLoadState('error') }
          }
          return
        }
        if (!response.ok) {
          const message = agencyRequestError(response)
          if (!cancelled) { setDashboardLoadError(message); setDashboardLoadState('error') }
          return
        }
        const payload = await response.json() as { data?: DashboardApiData }
        if (!payload.data) throw new Error('DASHBOARD_RESPONSE_INVALID')
        if (!cancelled) { setDashboardData(payload.data); setDashboardLoadState('remote') }
      } catch {
        if (!cancelled) {
          if (isStandaloneDemo) setDashboardLoadState('demo')
          else { setDashboardLoadError('No hemos podido cargar el panel. Inténtalo de nuevo.'); setDashboardLoadState('error') }
        }
      }
    }
    void loadDashboard()
    return () => { cancelled = true }
  }, [dashboardReloadKey])

  useEffect(() => {
    if (dashboardLoadState !== 'unauthorized' || unauthorizedRedirectStarted.current) return
    unauthorizedRedirectStarted.current = true
    window.location.replace('/iniciar-sesion?volver=' + encodeURIComponent(window.location.pathname + window.location.search))
  }, [dashboardLoadState])

  useEffect(() => {
    let cancelled = false
    const loadIdentity = async () => {
      try {
        const response = await fetch('/api/v1/auth/me', { credentials: 'include', headers: { Accept: 'application/json' } })
        if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/json')) return
        const payload = await response.json() as { data?: AgencyIdentity }
        if (!cancelled && payload.data?.user && payload.data.agency) setIdentity(payload.data)
      } catch { /* The dashboard request owns the visible recovery state. */ }
    }
    void loadIdentity()
    return () => { cancelled = true }
  }, [dashboardReloadKey])

  useEffect(() => {
    const restoreLocation = () => {
      setView(initialViewFromLocation())
      setSelectedApplicantId(null)
      setFocusedAppointmentId(null)
      setOnlyPropertiesWithNewApplicants(new URLSearchParams(window.location.search).get('estado') === 'Nuevo')
      setRemotePropertyId(propertyIdFromPath())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('popstate', restoreLocation)
    return () => window.removeEventListener('popstate', restoreLocation)
  }, [])

  const selectedProperty = workspaceProperties.find((property) => property.id === selectedPropertyId) ?? workspaceProperties[0]
  const selectedApplicant = applicants.find((applicant) => applicant.id === selectedApplicantId) ?? null
  const appointmentApplicant = applicants.find((applicant) => applicant.id === appointmentApplicantId) ?? null

  const filteredProperties = useMemo(() => {
    const query = propertySearch.trim().toLowerCase()
    return workspaceProperties.filter((property) => {
      const matchesQuery = !query || `${property.title} ${property.address} ${property.reference}`.toLowerCase().includes(query)
      const matchesStatus = propertyStatus === 'Todos' || property.status === propertyStatus
      const matchesNewApplicants = !onlyPropertiesWithNewApplicants || applicants.some((applicant) => applicant.propertyId === property.id && isNewInLast30Days(applicant))
      return matchesQuery && matchesStatus && matchesNewApplicants
    })
  }, [propertySearch, propertyStatus, onlyPropertiesWithNewApplicants, workspaceProperties, applicants])

  const filteredApplicants = useMemo(() => {
    const query = applicantSearch.trim().toLowerCase()
    const candidates = applicants.filter((applicant) => {
      const matchesProperty = applicant.propertyId === selectedProperty.id
      const matchesQuery = !query || `${applicant.name} ${applicant.email} ${applicant.phone}`.toLowerCase().includes(query)
      const matchesStatus = applicantStatus === 'Todos' || applicant.status === applicantStatus
      const matchesDocuments = documentStatus === 'Todos' || applicant.documents === documentStatus
      const matchesViewing = viewingFilter === 'Todas' || applicant.viewing === viewingFilter
      const matchesDate = submittedFilter === 'Cualquier fecha' || (submittedFilter === 'Hoy' ? applicant.submittedIso.startsWith('2026-08-11') : applicant.submittedIso >= '2026-08-05')
      const matchesAssignee = assigneeFilter === 'Todos' || applicant.assignee === assigneeFilter
      return matchesProperty && matchesQuery && matchesStatus && matchesDocuments && matchesViewing && matchesDate && matchesAssignee
    })
    return candidates.sort((a, b) => {
      if (sort === 'Mayor ingreso') return b.income - a.income
      if (sort === 'Menor ingreso') return a.income - b.income
      if (sort === 'Más antiguos') return a.submittedIso.localeCompare(b.submittedIso)
      if (sort === 'Estado') return a.status.localeCompare(b.status, 'es')
      if (sort === 'Próxima visita') {
        const nextTime = (applicantId: number) => appointments
          .filter((appointment) => appointment.applicantId === applicantId && ['Confirmada', 'Pendiente'].includes(appointment.status))
          .map((appointment) => appointmentToTimestamp(appointment))
          .sort((left, right) => left - right)[0] ?? Number.MAX_SAFE_INTEGER
        return nextTime(a.id) - nextTime(b.id)
      }
      return b.submittedIso.localeCompare(a.submittedIso)
    })
  }, [applicants, applicantSearch, applicantStatus, documentStatus, viewingFilter, submittedFilter, assigneeFilter, sort, selectedProperty.id, appointments])

  const navigate = (next: View, path?: string) => {
    setView(next)
    setMobileNavOpen(false)
    const defaultPath = next === 'properties' ? '/app/anuncios' : next === 'appointments' ? '/app/citas' : '/app'
    window.history.pushState({}, '', path ?? defaultPath)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openProperty = (id: number) => {
    setSelectedPropertyId(id)
    setApplicantSearch('')
    setApplicantStatus('Todos')
    setDocumentStatus('Todos')
    setViewingFilter('Todas')
    setSubmittedFilter('Cualquier fecha')
    setAssigneeFilter('Todos')
    navigate('property', `/app/anuncios/${id}`)
  }

  const openRemoteProperty = (id: string) => {
    setRemotePropertyId(id)
    navigate('property', `/app/anuncios/${encodeURIComponent(id)}`)
  }

  const clearNewApplicantPropertyFilter = () => {
    setOnlyPropertiesWithNewApplicants(false)
    if (window.location.pathname === '/app/anuncios') window.history.replaceState({}, '', '/app/anuncios')
  }

  const openAppointmentFromDashboard = (id: number) => {
    setFocusedAppointmentId(id)
    navigate('appointments', `/app/citas/${id}`)
  }

  const copyLink = async (property: Property) => {
    try {
      await navigator.clipboard.writeText(property.publicUrl)
      setCopiedPropertyId(property.id)
      setToast('Enlace copiado. Ya puedes compartirlo.')
    } catch {
      setToast('No hemos podido copiar el enlace. Inténtalo de nuevo.')
    }
    window.setTimeout(() => {
      setCopiedPropertyId(null)
      setToast('')
    }, 2600)
  }

  const updateApplicantStatus = (id: number, status: ApplicantStatus) => {
    const previous = applicants.find((applicant) => applicant.id === id)?.status
    setApplicants((current) => current.map((applicant) => applicant.id === id ? { ...applicant, status } : applicant))
    setActivities((current) => [{ id: Date.now(), applicantId: id, title: `Estado actualizado de ${previous} a ${status}`, detail: 'Marta Soler', timestamp: 'Ahora' }, ...current])
    setToast(`Estado actualizado a ${status}.`)
    window.setTimeout(() => setToast(''), 2200)
  }

  const createAppointment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!appointmentApplicant) return
    const form = new FormData(event.currentTarget)
    const date = String(form.get('date') || '12/08/2026')
    const time = String(form.get('time') || '17:00')
    const assignees = demoTeam.length === 1 ? [...demoTeam] : form.getAll('assignees').map(String).filter(Boolean)
    const nextAppointment: Appointment = {
      id: Date.now(),
      applicantId: appointmentApplicant.id,
      applicant: appointmentApplicant.name,
      propertyId: appointmentApplicant.propertyId,
      property: workspaceProperties.find((property) => property.id === appointmentApplicant.propertyId)?.title ?? '',
      date: date.split('-').reverse().join('/'),
      time,
      assignees,
      status: 'Confirmada',
      instructions: String(form.get('instructions') || ''),
      note: String(form.get('note') || ''),
    }
    setAppointments((current) => editingAppointmentId
      ? current.map((appointment) => appointment.id === editingAppointmentId ? { ...nextAppointment, id: editingAppointmentId } : appointment)
      : [nextAppointment, ...current])
    setApplicants((current) => current.map((applicant) => applicant.id === appointmentApplicant.id
      ? { ...applicant, viewing: 'Agendada', viewingDate: `${nextAppointment.date}, ${time}` }
      : applicant))
    setAppointmentApplicantId(null)
    setEditingAppointmentId(null)
    setActivities((current) => [{ id: Date.now(), applicantId: appointmentApplicant.id, title: editingAppointmentId ? 'Visita reprogramada' : 'Visita agendada', detail: 'Marta Soler', timestamp: 'Ahora' }, ...current])
    setToast(`${editingAppointmentId ? 'Visita reprogramada' : 'Visita agendada'} con ${appointmentApplicant.name}.`)
    window.setTimeout(() => setToast(''), 2500)
  }

  const updateAppointment = (id: number, status: Appointment['status']) => {
    const target = appointments.find((appointment) => appointment.id === id)
    if (target?.status === status) return
    const nextAppointments = appointments.map((appointment) => appointment.id === id ? { ...appointment, status } : appointment)
    setAppointments(nextAppointments)
    if (target) {
      const remainingActive = nextAppointments
        .filter((appointment) => appointment.applicantId === target.applicantId && ['Confirmada', 'Pendiente'].includes(appointment.status))
        .sort((left, right) => appointmentToTimestamp(left) - appointmentToTimestamp(right))
      setApplicants((current) => current.map((applicant) => {
        if (applicant.id !== target.applicantId) return applicant
        if (status === 'Completada') return { ...applicant, viewing: 'Realizada', viewingDate: `${target.date}, ${target.time}` }
        if (remainingActive[0]) return { ...applicant, viewing: remainingActive[0].status === 'Confirmada' ? 'Agendada' : 'Por confirmar', viewingDate: `${remainingActive[0].date}, ${remainingActive[0].time}` }
        return { ...applicant, viewing: 'Sin visita', viewingDate: undefined }
      }))
      setActivities((current) => [{ id: Date.now(), applicantId: target.applicantId, title: status === 'Completada' ? 'Visita completada' : status === 'Cancelada' ? 'Visita cancelada' : status === 'No se presentó' ? 'No se presentó a la visita' : status === 'Confirmada' ? 'Visita confirmada' : 'Visita pendiente de confirmar', detail: 'Marta Soler', timestamp: 'Ahora' }, ...current])
    }
    setToast(status === 'Completada' ? 'Visita marcada como completada.' : status === 'Cancelada' ? 'Cita cancelada.' : status === 'No se presentó' ? 'Ausencia registrada.' : status === 'Confirmada' ? 'Cita confirmada.' : 'Cita marcada como pendiente.')
    window.setTimeout(() => setToast(''), 2200)
  }

  const archiveAppointmentsByStatus = (status: Appointment['status']) => {
    const count = appointments.filter((appointment) => appointment.status === status && !appointment.archived).length
    if (!count) return
    setAppointments((current) => current.map((appointment) => appointment.status === status && !appointment.archived ? { ...appointment, archived: true } : appointment))
    setToast(count === 1 ? '1 cita archivada.' : `${count} citas archivadas.`)
    window.setTimeout(() => setToast(''), 2200)
  }

  const unarchiveAppointment = (id: number) => {
    setAppointments((current) => current.map((appointment) => appointment.id === id ? { ...appointment, archived: false } : appointment))
    setToast('Cita restaurada en el tablero.')
    window.setTimeout(() => setToast(''), 2200)
  }

  const clearApplicantFilters = () => {
    setApplicantSearch('')
    setApplicantStatus('Todos')
    setDocumentStatus('Todos')
    setViewingFilter('Todas')
    setSubmittedFilter('Cualquier fecha')
    setAssigneeFilter('Todos')
  }

  const recordWhatsapp = (id: number) => {
    setActivities((current) => [{ id: Date.now(), applicantId: id, title: 'Contacto por WhatsApp iniciado', detail: 'Marta Soler', timestamp: 'Ahora' }, ...current])
  }

  const saveNote = (id: number, note: string) => {
    setApplicants((current) => current.map((applicant) => applicant.id === id ? { ...applicant, note } : applicant))
    setActivities((current) => [{ id: Date.now(), applicantId: id, title: 'Nota interna actualizada', detail: 'Marta Soler', timestamp: 'Ahora' }, ...current])
    setToast('Nota interna guardada.')
    window.setTimeout(() => setToast(''), 2200)
  }

  const createDraftProperty = () => dashboardLoadState === 'remote' ? setRemotePropertyEditor('new') : setPropertyEditorId('new')

  const saveProperty = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const existing = typeof propertyEditorId === 'number' ? workspaceProperties.find((property) => property.id === propertyEditorId) : undefined
    const id = existing?.id ?? Date.now()
    const status = String(form.get('status')) as PropertyStatus
    const reference = String(form.get('reference'))
    const nextProperty: Property = {
      id,
      reference,
      title: String(form.get('title')),
      address: String(form.get('address')),
      city: String(form.get('city')),
      province: String(form.get('province')),
      postalCode: String(form.get('postalCode')),
      rent: Number(form.get('rent')),
      type: String(form.get('type')),
      rooms: Number(form.get('rooms')),
      bathrooms: Number(form.get('bathrooms')),
      area: Number(form.get('area')),
      available: String(form.get('available')),
      description: String(form.get('description')),
      assignee: String(form.get('assignee')),
      applicants: existing?.applicants ?? 0,
      newApplicants: existing?.newApplicants ?? 0,
      status,
      nextViewing: existing?.nextViewing ?? null,
      accent: existing?.accent ?? 'blue',
      publicUrl: status === 'Publicado' ? existing?.publicUrl || `https://inquilink.es/solicitud/${reference.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}` : '',
      coverImage: String(form.get('coverImage') || '') || existing?.coverImage,
    }
    setWorkspaceProperties((current) => existing ? current.map((property) => property.id === id ? nextProperty : property) : [nextProperty, ...current])
    setPropertyEditorId(null)
    setToast(existing ? 'Anuncio actualizado.' : 'Anuncio creado.')
    window.setTimeout(() => setToast(''), 2200)
  }

  const hasApplicantFilters = Boolean(applicantSearch || applicantStatus !== 'Todos' || documentStatus !== 'Todos' || viewingFilter !== 'Todas' || submittedFilter !== 'Cualquier fecha' || assigneeFilter !== 'Todos')

  const navigation = [
    { id: 'panel' as const, label: 'Panel', icon: ChartLineUp },
    { id: 'properties' as const, label: 'Mis anuncios', icon: Buildings, count: dashboardLoadState === 'demo' ? workspaceProperties.length : undefined },
    { id: 'appointments' as const, label: 'Citas', icon: CalendarBlank, count: dashboardLoadState === 'demo' ? appointments.filter((appointment) => ['Confirmada', 'Pendiente'].includes(appointment.status) && appointmentToTimestamp(appointment) >= Date.now()).length : undefined },
  ]
  const isDemoWorkspace = dashboardLoadState === 'demo'
  const agencyName = identity?.agency?.name ?? (isDemoWorkspace ? 'Casa Barrio' : 'Inquilink')
  const userName = identity?.user.fullName ?? (isDemoWorkspace ? 'Marta Soler' : 'Tu cuenta')
  const userFirstName = identity?.user.fullName.split(/\s+/)[0] ?? (isDemoWorkspace ? 'Marta' : 'Cuenta')
  const userInitials = identity?.user.fullName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() ?? (isDemoWorkspace ? 'MS' : 'TU')
  const agencyInitials = agencyName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const roleLabel = identity?.agency?.role === 'admin' ? 'Administración' : identity?.agency?.role === 'collaborator' ? 'Colaboración' : isDemoWorkspace ? 'Administradora' : 'Espacio de trabajo'
  const currentSection = view === 'panel'
    ? 'Resumen'
    : view === 'properties' || view === 'property' || view === 'linkedApplicant'
      ? 'Mis anuncios'
      : view === 'appointments' || view === 'linkedAppointment'
        ? 'Citas'
        : view === 'settings'
          ? 'Configuración'
          : view === 'team'
            ? 'Equipo'
            : 'Facturación'

  if (dashboardLoadState === 'unauthorized') {
    return <div className="agency-workspace" role="status" style={{ display: 'grid', placeItems: 'center' }}><p>Redirigiendo a inicio de sesión…</p></div>
  }

  return (
    <div className="agency-workspace">
      <a className="agency-skip-link" href="#agency-main">Ir al contenido</a>
      {mobileNavOpen && <button className="agency-nav-scrim" aria-label="Cerrar menú" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`agency-sidebar ${mobileNavOpen ? 'agency-sidebar--open' : ''}`} aria-label="Navegación principal">
        <div className="agency-sidebar__brand">
          <AppLogo />
          <button className="agency-icon-button agency-sidebar__close" onClick={() => setMobileNavOpen(false)} aria-label="Cerrar menú"><X size={20} /></button>
        </div>
        <div className="agency-workspace-switcher">
          <span className="agency-workspace-switcher__avatar">{agencyInitials}</span>
          <span><strong>{agencyName}</strong><small>{roleLabel}</small></span>
          <CaretDown size={15} aria-hidden="true" />
        </div>
        <nav className="agency-sidebar__nav">
          <p className="agency-nav-label">ESPACIO DE TRABAJO</p>
          {navigation.map((item) => {
            const Icon = item.icon
            const active = view === item.id || (item.id === 'properties' && (view === 'property' || view === 'linkedApplicant')) || (item.id === 'appointments' && view === 'linkedAppointment')
            return (
              <button key={item.id} className={`agency-nav-item ${active ? 'agency-nav-item--active' : ''}`} onClick={() => navigate(item.id)} aria-current={active ? 'page' : undefined}>
                <Icon size={19} weight={active ? 'fill' : 'regular'} />
                <span>{item.label}</span>
                {item.count && <span className="agency-nav-item__count">{item.count}</span>}
              </button>
            )
          })}
          <p className="agency-nav-label agency-nav-label--second">ADMINISTRACIÓN</p>
          <button className={`agency-nav-item ${view === 'settings' ? 'agency-nav-item--active' : ''}`} onClick={() => navigate('settings')}><Gear size={19} />Configuración</button>
          <button className={`agency-nav-item ${view === 'team' ? 'agency-nav-item--active' : ''}`} onClick={() => navigate('team')}><Users size={19} />Equipo</button>
          <button className={`agency-nav-item ${view === 'billing' ? 'agency-nav-item--active' : ''}`} onClick={() => navigate('billing')}><CreditCard size={19} />Facturación</button>
          <WorkspaceLogoutButton />
        </nav>
        <button className="agency-profile-mini">
          <span className="agency-profile-mini__avatar">{userInitials}</span>
          <span><strong>{userName}</strong><small>{roleLabel}</small></span>
          <DotsThree size={20} weight="bold" />
        </button>
      </aside>

      <div className="agency-shell">
        <header className="agency-topbar">
          <button className="agency-icon-button agency-topbar__menu" onClick={() => setMobileNavOpen(true)} aria-label="Abrir menú"><SidebarSimple size={21} /></button>
          <div className="agency-topbar__trail">
            <span>{agencyName}</span>
            <span>/</span>
            <strong>{view === 'property' && dashboardLoadState === 'demo' ? selectedProperty.reference : currentSection}</strong>
          </div>
          <div className="agency-topbar__actions">
            <button className="agency-icon-button" aria-label="Notificaciones"><Bell size={20} /><span className="agency-notification-dot" /></button>
            <button className="agency-user-pill"><span>{userInitials}</span><b>{userFirstName}</b><CaretDown size={14} /></button>
          </div>
        </header>

        <main className="agency-main" id="agency-main">
          {view === 'panel' && <DashboardView userFirstName={userFirstName} properties={workspaceProperties} appointments={appointments} applicants={applicants} dashboardData={dashboardData} loadState={dashboardLoadState} loadError={dashboardLoadError} onRetry={() => setDashboardReloadKey((key) => key + 1)} onNewProperty={createDraftProperty} onOpenProperties={() => { clearNewApplicantPropertyFilter(); navigate('properties') }} onOpenAppointment={openAppointmentFromDashboard} onOpenAppointments={() => { setFocusedAppointmentId(null); navigate('appointments') }} />}
          {view === 'linkedApplicant' && <LinkedDashboardRecordView route={linkedRouteFromPath(window.location.pathname)} loadState={dashboardLoadState} loadError={dashboardLoadError} properties={workspaceProperties} applicants={applicants} appointments={appointments} onDashboardInvalidated={() => setDashboardReloadKey((key) => key + 1)} onBack={() => navigate('panel')} />}
          {view === 'linkedAppointment' && <LinkedDashboardRecordView route={linkedRouteFromPath(window.location.pathname)} loadState={dashboardLoadState} loadError={dashboardLoadError} properties={workspaceProperties} applicants={applicants} appointments={appointments} onDashboardInvalidated={() => setDashboardReloadKey((key) => key + 1)} onBack={() => navigate('panel')} />}
          {view === 'properties' && dashboardLoadState === 'remote' && <AuthenticatedPropertiesView onlyWithNewApplicants={onlyPropertiesWithNewApplicants} onClearNewApplicants={clearNewApplicantPropertyFilter} onOpen={openRemoteProperty} onNew={() => setRemotePropertyEditor('new')} onEdit={setRemotePropertyEditor} />}
          {view === 'properties' && dashboardLoadState === 'demo' && (
            <PropertiesView
              filteredProperties={filteredProperties}
              query={propertySearch}
              status={propertyStatus}
              onlyWithNewApplicants={onlyPropertiesWithNewApplicants}
              copiedPropertyId={copiedPropertyId}
              onQuery={setPropertySearch}
              onStatus={setPropertyStatus}
              onClearNewApplicants={clearNewApplicantPropertyFilter}
              onOpen={openProperty}
              onCopy={copyLink}
              onNew={createDraftProperty}
              onEdit={setPropertyEditorId}
            />
          )}
          {view === 'properties' && (dashboardLoadState === 'loading' || dashboardLoadState === 'error') && <AgencyDestinationGate title="Mis anuncios" loadState={dashboardLoadState} loadError={dashboardLoadError} onRetry={() => setDashboardReloadKey((key) => key + 1)} />}
          {view === 'property' && dashboardLoadState === 'remote' && remotePropertyId && <AuthenticatedPropertyView propertyId={remotePropertyId} onBack={() => navigate('properties')} onEdit={setRemotePropertyEditor} />}
          {view === 'property' && dashboardLoadState === 'demo' && (
            <PropertyView
              property={selectedProperty}
              applicants={filteredApplicants}
              applicantSearch={applicantSearch}
              applicantStatus={applicantStatus}
              documentStatus={documentStatus}
              viewingFilter={viewingFilter}
              submittedFilter={submittedFilter}
              assigneeFilter={assigneeFilter}
              sort={sort}
              copied={copiedPropertyId === selectedProperty.id}
              hasFilters={hasApplicantFilters}
              onBack={() => navigate('properties')}
              onCopy={() => copyLink(selectedProperty)}
              onSearch={setApplicantSearch}
              onStatusFilter={setApplicantStatus}
              onDocumentFilter={setDocumentStatus}
              onViewingFilter={setViewingFilter}
              onSubmittedFilter={setSubmittedFilter}
              onAssigneeFilter={setAssigneeFilter}
              onSort={setSort}
              onClear={clearApplicantFilters}
              onStatusChange={updateApplicantStatus}
              onOpenApplicant={setSelectedApplicantId}
              onSchedule={setAppointmentApplicantId}
              onWhatsapp={recordWhatsapp}
              onEditProperty={() => setPropertyEditorId(selectedProperty.id)}
            />
          )}
          {view === 'property' && (dashboardLoadState === 'loading' || dashboardLoadState === 'error') && <AgencyDestinationGate title="Anuncio" loadState={dashboardLoadState} loadError={dashboardLoadError} onRetry={() => setDashboardReloadKey((key) => key + 1)} />}
          {view === 'appointments' && dashboardLoadState === 'remote' && <AuthenticatedAppointmentsView />}
          {view === 'appointments' && dashboardLoadState === 'demo' && (
            <AppointmentsView
              appointments={appointments}
              onOpenApplicant={setSelectedApplicantId}
              onUpdate={updateAppointment}
              onNew={() => { setEditingAppointmentId(null); setAppointmentApplicantId(applicants[0]?.id ?? null) }}
              onReschedule={(appointment) => { setEditingAppointmentId(appointment.id); setAppointmentApplicantId(appointment.applicantId) }}
              onArchiveColumn={archiveAppointmentsByStatus}
              onUnarchive={unarchiveAppointment}
              focusedAppointmentId={focusedAppointmentId}
            />
          )}
          {view === 'appointments' && (dashboardLoadState === 'loading' || dashboardLoadState === 'error') && <AgencyDestinationGate title="Citas" loadState={dashboardLoadState} loadError={dashboardLoadError} onRetry={() => setDashboardReloadKey((key) => key + 1)} />}
          {view === 'team' && <TeamView remote={dashboardLoadState === 'remote'} canInvite={identity?.agency?.role === 'admin'} applicants={applicants} appointments={appointments} />}
          {view === 'settings' && <SettingsView isDemo={dashboardLoadState === 'demo'} identity={identity} properties={workspaceProperties} applicants={applicants} appointments={appointments} />}
          {view === 'billing' && <BillingView remote={dashboardLoadState === 'remote'} properties={workspaceProperties} />}
        </main>
      </div>

      {selectedApplicant && (
        <ApplicantDrawer
          applicant={selectedApplicant}
          property={workspaceProperties.find((property) => property.id === selectedApplicant.propertyId) ?? selectedProperty}
          appointments={appointments.filter((appointment) => appointment.applicantId === selectedApplicant.id)}
          activities={activities.filter((activity) => activity.applicantId === selectedApplicant.id)}
          onClose={() => setSelectedApplicantId(null)}
          onStatusChange={updateApplicantStatus}
          onSchedule={() => { setSelectedApplicantId(null); setAppointmentApplicantId(selectedApplicant.id) }}
          onWhatsapp={() => recordWhatsapp(selectedApplicant.id)}
          onSaveNote={(note) => saveNote(selectedApplicant.id, note)}
        />
      )}
      {appointmentApplicant && (
        <AppointmentModal applicant={appointmentApplicant} property={workspaceProperties.find((property) => property.id === appointmentApplicant.propertyId) ?? selectedProperty} appointments={appointments} existing={appointments.find((appointment) => appointment.id === editingAppointmentId)} onClose={() => { setAppointmentApplicantId(null); setEditingAppointmentId(null) }} onSubmit={createAppointment} />
      )}
      {propertyEditorId !== null && <PropertyEditorModal property={typeof propertyEditorId === 'number' ? workspaceProperties.find((property) => property.id === propertyEditorId) : undefined} suggestedReference={`MAD-${String(workspaceProperties.length + 52).padStart(3, '0')}`} onClose={() => setPropertyEditorId(null)} onSubmit={saveProperty} />}
      {remotePropertyEditor && <AuthenticatedPropertyEditorModal property={remotePropertyEditor === 'new' ? undefined : remotePropertyEditor} onClose={() => setRemotePropertyEditor(null)} onSaved={(saved, publicLink) => {
        setRemotePropertyEditor(null)
        setDashboardReloadKey((key) => key + 1)
        setRemotePropertyId(saved.property.id)
        navigate('property', `/app/anuncios/${encodeURIComponent(saved.property.id)}`)
        if (publicLink) {
          void navigator.clipboard.writeText(publicLink)
            .then(() => setToast('Anuncio publicado. Enlace copiado.'))
            .catch(() => setToast('Anuncio publicado. Puedes copiar el enlace desde su ficha.'))
        } else {
          setToast('Anuncio guardado.')
        }
        window.setTimeout(() => setToast(''), 2600)
      }} />}
      {toast && <div className="agency-toast" role="status"><CheckCircle size={19} weight="fill" />{toast}</div>}
    </div>
  )
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="agency-page-heading">
      <div>{eyebrow && <p className="agency-eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{description}</p></div>
      {actions && <div className="agency-page-heading__actions">{actions}</div>}
    </header>
  )
}

/* Cada anuncio activo tiene su propio sector; solo agregamos en «Otros» con carteras enormes. */
const DASHBOARD_PIE_MAX_SLICES = 20
const DASHBOARD_PIE_REST_COLOR = '#cfcec7'

/**
 * Genera colores distinguibles alrededor de la paleta de la app: parte del tono coral (#dc7359 ≈ 12°)
 * y rota el matiz con el ángulo áureo, alternando la luminosidad para separar tonos vecinos.
 */
function dashboardPieColor(index: number) {
  const hue = (12 + index * 137.508) % 360
  const saturation = index === 0 ? 65 : 46 + (index % 3) * 6
  const lightness = index === 0 ? 61 : index % 2 === 0 ? 57 : 67
  return `hsl(${Math.round(hue)} ${saturation}% ${lightness}%)`
}

type DashboardPieSlice = { key: string; label: string; reference?: string; count: number; color: string }

function buildListingShares(listings: { key: string; label: string; reference?: string; count: number }[]): DashboardPieSlice[] {
  const ranked = listings
    .filter((listing) => listing.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'es'))
  const capped = ranked.length > DASHBOARD_PIE_MAX_SLICES
  const visible = capped ? ranked.slice(0, DASHBOARD_PIE_MAX_SLICES) : ranked
  const slices: DashboardPieSlice[] = visible.map((listing, index) => ({ ...listing, color: dashboardPieColor(index) }))
  if (capped) {
    const rest = ranked.slice(DASHBOARD_PIE_MAX_SLICES)
    slices.push({ key: 'otros', label: `Otros (${rest.length} ${rest.length === 1 ? 'anuncio' : 'anuncios'})`, count: rest.reduce((total, listing) => total + listing.count, 0), color: DASHBOARD_PIE_REST_COLOR })
  }
  return slices
}

function DashboardListingsPie({ slices, activeListingCount }: { slices: DashboardPieSlice[]; activeListingCount: number }) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0)
  // Separador fino entre sectores para que muchos anuncios sigan siendo legibles.
  const separator = slices.length > 1 ? 0.6 : 0
  let cumulative = 0
  return (
    <div className="agency-listings-share">
      <div className="agency-listings-share__chart">
        <svg viewBox="0 0 42 42" role="img" aria-label={`Distribución de ${applicantCountLabel(total)} entre los anuncios activos`}>
          {slices.map((slice) => {
            const fraction = (slice.count / total) * 100
            const dashoffset = 25 - cumulative
            cumulative += fraction
            const visibleFraction = Math.max(fraction - separator, 0.35)
            return (
              <circle key={slice.key} cx="21" cy="21" r="15.915" fill="none" stroke={slice.color} strokeWidth="6.2" strokeDasharray={`${visibleFraction} ${100 - visibleFraction}`} strokeDashoffset={dashoffset}>
                <title>{`${slice.label}: ${applicantCountLabel(slice.count)}`}</title>
              </circle>
            )
          })}
          <text className="agency-listings-share__value" x="21" y="20.6" textAnchor="middle">{total}</text>
          <text className="agency-listings-share__caption" x="21" y="25.6" textAnchor="middle">{total === 1 ? 'interesado' : 'interesados'}</text>
        </svg>
      </div>
      <div className="agency-listings-share__side">
        <p className="agency-listings-share__meta">{activeListingCount} {activeListingCount === 1 ? 'anuncio activo' : 'anuncios activos'} con interesados</p>
        <ul className="agency-listings-share__legend">
          {slices.map((slice) => (
            <li key={slice.key} title={`${slice.label}: ${applicantCountLabel(slice.count)}`}>
              <span className="agency-listings-share__dot" style={{ background: slice.color }} aria-hidden="true" />
              <span className="agency-listings-share__label"><strong>{slice.label}</strong>{slice.reference && <small>{slice.reference}</small>}</span>
              <em>{slice.count}</em>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function DashboardView({ userFirstName, properties, appointments, applicants, dashboardData, loadState, loadError, onRetry, onNewProperty, onOpenProperties, onOpenAppointment, onOpenAppointments }: { userFirstName: string; properties: Property[]; appointments: Appointment[]; applicants: Applicant[]; dashboardData: DashboardApiData | null; loadState: DashboardLoadState; loadError: string; onRetry: () => void; onNewProperty: () => void; onOpenProperties: () => void; onOpenAppointment: (id: number) => void; onOpenAppointments: () => void }) {
  const now = new Date()
  const [trendRange, setTrendRange] = useState<DashboardTrendRange>('30d')
  const [trendData, setTrendData] = useState<DashboardTrendData | null>(null)
  const [trendState, setTrendState] = useState<RemoteLoadState>('loading')
  const [trendError, setTrendError] = useState('')
  const [trendReloadKey, setTrendReloadKey] = useState(0)
  const [activeTrendDate, setActiveTrendDate] = useState<string | null>(null)
  const demoNewApplicants = applicants
    .filter((applicant) => isNewInLast30Days(applicant, now))
    .sort((left, right) => right.submittedIso.localeCompare(left.submittedIso))
  const demoUpcomingAppointments = appointments
    .filter((appointment) => ['Confirmada', 'Pendiente'].includes(appointment.status) && appointmentToTimestamp(appointment) >= now.getTime())
    .sort((left, right) => appointmentToTimestamp(left) - appointmentToTimestamp(right))
    .slice(0, 3)
  const remote = loadState === 'remote' ? dashboardData : null
  const isDemo = loadState === 'demo'
  const demoActiveListings = properties.filter((property) => property.status === 'Publicado')
  const listingShares = remote
    ? buildListingShares(remote.topProperties.items.map((item) => ({ key: item.propertyId, label: item.title, reference: item.internalReference, count: item.applicantCount })))
    : isDemo
      ? buildListingShares(demoActiveListings.map((property) => ({ key: String(property.id), label: property.title, reference: property.reference, count: property.applicants })))
      : []
  const activeListingWithInterestCount = remote
    ? remote.topProperties.items.filter((item) => item.applicantCount > 0).length
    : demoActiveListings.filter((property) => property.applicants > 0).length
  const applicantCount = remote?.newApplicants.count ?? (isDemo ? demoNewApplicants.length : null)
  const showPending = loadState === 'loading'
  const showError = loadState === 'error'
  const chartDays = isDemo ? demoTrendDays(trendRange, applicants, properties, now) : trendData?.items ?? []
  const activeChartDay = chartDays.find((day) => day.date === activeTrendDate)
    ?? [...chartDays].reverse().find((day) => day.total > 0)
    ?? chartDays.at(-1)
  const chartMaximum = Math.max(1, ...chartDays.map((day) => day.total))
  const chartTotal = chartDays.reduce((total, day) => total + day.total, 0)
  const chartLoading = showPending || (!isDemo && loadState === 'remote' && trendState === 'loading')
  const chartError = showError ? loadError : trendState === 'error' ? trendError : ''
  const upcomingViewingCount = remote?.upcomingViewings.items.length ?? (isDemo ? appointments.filter((appointment) => ['Confirmada', 'Pendiente'].includes(appointment.status) && appointmentToTimestamp(appointment) >= now.getTime()).length : null)
  const highlightedPropertyCount = remote || isDemo ? activeListingWithInterestCount : null
  const todayViewingCount = remote
    ? remote.upcomingViewings.items.filter((appointment) => madridDateKey(new Date(appointment.startsAt)) === madridDateKey(now)).length
    : isDemo
      ? appointments.filter((appointment) => ['Confirmada', 'Pendiente'].includes(appointment.status) && dashboardDateLabel(appointment.date, now) === 'Hoy').length
      : null

  useEffect(() => {
    if (loadState !== 'remote') return
    let cancelled = false
    const loadTrend = async () => {
      setTrendState('loading')
      setTrendError('')
      try {
        const response = await fetch(`/api/v1/agency/dashboard/applicant-trend?range=${trendRange}`, { credentials: 'include', headers: { Accept: 'application/json' } })
        if (!response.ok) throw new Error(await agencyRequestError(response))
        const payload = await response.json() as { data?: DashboardTrendData }
        if (!payload.data) throw new Error('La respuesta del gráfico no es válida.')
        if (!cancelled) { setTrendData(payload.data); setTrendState('loaded') }
      } catch (error) {
        if (!cancelled) { setTrendError(error instanceof Error ? error.message : 'No hemos podido cargar el gráfico.'); setTrendState('error') }
      }
    }
    void loadTrend()
    return () => { cancelled = true }
  }, [loadState, trendRange, trendReloadKey])

  return (
    <section className="agency-view agency-dashboard">
      <PageHeading title={`Buenos días, ${userFirstName}`} description="Aquí tienes lo importante para mover tus alquileres hoy." actions={isDemo || remote ? <button className="agency-button agency-button--primary" onClick={onNewProperty}><Plus size={18} weight="bold" />Nuevo anuncio</button> : undefined} />
      <div className="agency-dashboard-metrics" aria-label="Resumen del espacio de trabajo">
        <article className="agency-metric-card">
          <span className="agency-metric-card__icon"><Users size={18} /></span>
          <div><small>Solicitudes nuevas</small><strong>{applicantCount ?? '-'}</strong><span>Últimos 30 días</span></div>
        </article>
        <article className="agency-metric-card">
          <span className="agency-metric-card__icon"><CalendarBlank size={18} /></span>
          <div><small>Próximas visitas</small><strong>{upcomingViewingCount ?? '-'}</strong><span>En agenda</span></div>
        </article>
        <article className="agency-metric-card">
          <span className="agency-metric-card__icon"><Buildings size={18} /></span>
          <div><small>Anuncios destacados</small><strong>{highlightedPropertyCount ?? '-'}</strong><span>Con interesados</span></div>
        </article>
        <article className="agency-metric-card">
          <span className="agency-metric-card__icon"><Clock size={18} /></span>
          <div><small>Visitas hoy</small><strong>{todayViewingCount ?? '-'}</strong><span>Del equipo</span></div>
        </article>
      </div>
      <div className="agency-dashboard-focus">
        <section className="agency-panel-card agency-listings-share-card">
          <div className="agency-card-heading">
            <div><p className="agency-eyebrow">ANUNCIOS ACTIVOS</p><h2>Interesados por anuncio</h2></div>
            {remote ? <a className="agency-text-button" href={remote.topProperties.href}>Ver anuncios <ArrowRight size={16} /></a> : isDemo ? <button className="agency-text-button" onClick={onOpenProperties}>Ver anuncios <ArrowRight size={16} /></button> : null}
          </div>
          {showPending ? <DashboardLoadMessage message="Cargando interesados por anuncio..." /> : showError ? <DashboardLoadMessage message={loadError} error onRetry={onRetry} loginRequired={isSessionError(loadError)} /> : listingShares.length ? <DashboardListingsPie slices={listingShares} activeListingCount={activeListingWithInterestCount} /> : remote ? <DashboardEmptyState icon={<HouseLine size={22} />} title="Sin interesados todavía" description="Cuando tus anuncios activos reciban solicitudes verás aquí cómo se reparten." action="Ver mis anuncios" href={remote.topProperties.href} /> : <DashboardEmptyState icon={<HouseLine size={22} />} title="Sin interesados todavía" description="Cuando tus anuncios activos reciban solicitudes verás aquí cómo se reparten." action={properties.length ? 'Ver mis anuncios' : 'Crear mi primer anuncio'} onAction={properties.length ? onOpenProperties : onNewProperty} />}
        </section>
        <section className="agency-panel-card agency-schedule-card">
          <div className="agency-card-heading"><div><p className="agency-eyebrow">AGENDA</p><h2>Próximas visitas</h2></div>{remote ? <a className="agency-text-button" href={remote.upcomingViewings.href}>Abrir agenda <ArrowRight size={16} /></a> : isDemo ? <button className="agency-text-button" onClick={onOpenAppointments}>Abrir agenda <ArrowRight size={16} /></button> : null}</div>
          {showPending ? <DashboardLoadMessage message="Cargando próximas visitas..." /> : showError ? <DashboardLoadMessage message={loadError} error onRetry={onRetry} loginRequired={isSessionError(loadError)} /> : remote ? (remote.upcomingViewings.items.length ? remote.upcomingViewings.items.map((appointment) => {
            const parts = apiDateParts(appointment.startsAt)
            return <a className="agency-schedule-row" key={appointment.appointmentId} href={appointment.href} aria-label={`Abrir la visita de ${appointment.applicantName} el ${parts.date} a las ${parts.time}`}>
              <span className="agency-date-tile"><strong>{parts.day}</strong><span>{parts.month}</span></span>
              <ScheduleRowAvatars applicant={appointment.applicantName} workers={appointment.responsibleUserName ? [appointment.responsibleUserName] : []} />
              <span><strong>{apiRelativeDateTime(appointment.startsAt, now)} · {appointment.applicantName}</strong><small>{appointment.propertyTitle}{appointment.responsibleUserName ? ` · ${appointment.responsibleUserName}` : ''}</small></span>
              <ArrowRight size={16} />
            </a>
          }) : <DashboardEmptyState title="No hay visitas programadas" description="Las próximas citas del equipo aparecerán aquí por orden cronológico." action="Abrir citas" href={remote.upcomingViewings.href} />) : demoUpcomingAppointments.length ? demoUpcomingAppointments.map((appointment) => (
            <button className="agency-schedule-row" key={appointment.id} onClick={() => onOpenAppointment(appointment.id)} aria-label={`Abrir la visita de ${appointment.applicant} el ${appointment.date} a las ${appointment.time}`}>
              <span className="agency-date-tile"><strong>{appointment.date.slice(0, 2)}</strong><span>{dashboardMonthLabel(appointment.date)}</span></span>
              <ScheduleRowAvatars applicant={appointment.applicant} workers={appointment.assignees} />
              <span><strong>{dashboardDateLabel(appointment.date, now)}, {appointment.time} · {appointment.applicant}</strong><small>{appointment.property}{appointment.assignees.length ? ` · ${appointment.assignees.join(', ')}` : ''}</small></span>
              <ArrowRight size={16} />
            </button>
          )) : <DashboardEmptyState title="No hay visitas programadas" description="Las próximas citas del equipo aparecerán aquí por orden cronológico." action="Abrir citas" onAction={onOpenAppointments} />}
        </section>
      </div>
      <section className="agency-panel-card agency-interest-trend">
        <div className="agency-card-heading agency-interest-trend__heading">
          <div><h2>Interesados por día</h2><p>Solicitudes enviadas durante el periodo seleccionado.</p></div>
          <div className="agency-interest-trend__ranges" aria-label="Periodo del gráfico">
            {([['7d', '1 sem'], ['30d', '1 mes'], ['90d', '3 meses']] as const).map(([value, label]) => <button key={value} className={trendRange === value ? 'is-active' : ''} aria-pressed={trendRange === value} onClick={() => { setTrendRange(value); setActiveTrendDate(null) }}>{label}</button>)}
          </div>
        </div>
        {chartLoading ? <DashboardLoadMessage message="Cargando evolución de interesados..." /> : chartError ? <DashboardLoadMessage message={chartError} error loginRequired={isSessionError(chartError)} onRetry={() => showError ? onRetry() : setTrendReloadKey((key) => key + 1)} /> : <div className="agency-interest-trend__content">
          <div className="agency-interest-trend__visual">
            <div className="agency-interest-trend__summary"><strong>{chartTotal}</strong><span>{chartTotal === 1 ? 'interesado en el periodo' : 'interesados en el periodo'}</span></div>
            <div className="agency-interest-trend__scroller">
              <div className="agency-interest-trend__plot" style={{ minWidth: chartDays.length > 30 ? `${chartDays.length * 8}px` : '100%' }}>
                {chartDays.map((day) => <button className={`agency-interest-trend__bar ${activeChartDay?.date === day.date ? 'is-active' : ''}`} key={day.date} onMouseEnter={() => setActiveTrendDate(day.date)} onFocus={() => setActiveTrendDate(day.date)} aria-label={`${chartDateLabel(day.date, true)}: ${applicantCountLabel(day.total)}`}>
                  <span style={{ height: day.total ? `${Math.max(8, (day.total / chartMaximum) * 100)}%` : '3px' }} />
                </button>)}
              </div>
            </div>
            {chartDays.length > 0 && <div className="agency-interest-trend__axis"><span>{chartDateLabel(chartDays[0].date)}</span><span>{chartDateLabel(chartDays.at(-1)!.date)}</span></div>}
          </div>
          <aside className="agency-interest-trend__detail" aria-live="polite">
            <span>{activeChartDay ? chartDateLabel(activeChartDay.date, true) : 'Día seleccionado'}</span>
            <strong>{applicantCountLabel(activeChartDay?.total ?? 0)}</strong>
            {activeChartDay?.properties.length ? <ul>{activeChartDay.properties.map((property) => <li key={property.propertyId}><a href={property.href}><span><small>{property.internalReference}</small><b>{property.title}</b></span><em>{property.count}</em></a></li>)}</ul> : <p>No se recibieron solicitudes este día.</p>}
          </aside>
        </div>}
      </section>
    </section>
  )
}

/** Avatares de una visita: el interesado en coral sólido y el equipo asignado en tonos pastel, igual que en el Kanban. */
function ScheduleRowAvatars({ applicant, workers }: { applicant: string; workers: string[] }) {
  return <span className="agency-schedule-row__avatars" aria-hidden="true">
    <span className="agency-avatar agency-avatar--applicant" title={`${applicant} (interesado)`}>{applicantInitials(applicant)}</span>
    {workers.slice(0, 3).map((name, index) => <span key={name} className={`agency-avatar agency-avatar--${index % 3}`} title={`${name} (equipo)`}>{applicantInitials(name)}</span>)}
    {workers.length > 3 && <span className="agency-avatar agency-avatar--rest" title={workers.slice(3).join(', ')}>+{workers.length - 3}</span>}
  </span>
}

function DashboardLoadMessage({ message, error = false, onRetry, loginRequired = false }: { message: string; error?: boolean; onRetry?: () => void; loginRequired?: boolean }) {
  return <div className={`agency-dashboard-load ${error ? 'agency-dashboard-load--error' : ''}`} role={error ? 'alert' : 'status'}><span /><div><p>{message}</p>{error && (loginRequired ? <a className="agency-text-button" href="/iniciar-sesion">Iniciar sesión <ArrowRight size={15} /></a> : onRetry ? <button className="agency-text-button" onClick={onRetry}>Reintentar <ArrowRight size={15} /></button> : null)}</div></div>
}

function DashboardEmptyState({ icon, title, description, action, onAction, href }: { icon?: ReactNode; title: string; description: string; action: string; onAction?: () => void; href?: string }) {
  return <div className="agency-dashboard-empty">{icon ?? <CalendarBlank size={22} />}<div><strong>{title}</strong><p>{description}</p></div>{href ? <a className="agency-text-button" href={href}>{action}<ArrowRight size={15} /></a> : <button className="agency-text-button" onClick={onAction}>{action}<ArrowRight size={15} /></button>}</div>
}

function LinkedDashboardRecordView({ route, loadState, loadError, properties, applicants, appointments, onDashboardInvalidated, onBack }: { route: LinkedRoute; loadState: DashboardLoadState; loadError: string; properties: Property[]; applicants: Applicant[]; appointments: Appointment[]; onDashboardInvalidated: () => void; onBack: () => void }) {
  const [remoteRecord, setRemoteRecord] = useState<AgencyApplicantDetailApi | AgencyAppointmentApi | null>(null)
  const [teamMembers, setTeamMembers] = useState<AgencyTeamMember[]>([])
  const [remoteState, setRemoteState] = useState<RemoteLoadState>('loading')
  const [remoteError, setRemoteError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [mutationError, setMutationError] = useState('')
  const [mutating, setMutating] = useState(false)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [documentOpeningId, setDocumentOpeningId] = useState<string | null>(null)
  const [appointmentWarnings, setAppointmentWarnings] = useState<AgencyAppointmentWarning[]>([])
  const billingPlan = useBillingPlan(loadState === 'remote' && route?.kind === 'appointment')
  const numericId = route ? Number(route.id) : Number.NaN
  const demoApplicant = route?.kind === 'applicant' && Number.isFinite(numericId) ? applicants.find((item) => item.id === numericId) : undefined
  const demoAppointment = route?.kind === 'appointment' && Number.isFinite(numericId) ? appointments.find((item) => item.id === numericId) : undefined
  useEffect(() => {
    if (loadState !== 'remote' || !route) return
    const controller = new AbortController()
    const load = async () => {
      setRemoteRecord(null)
      setRemoteError('')
      setRemoteState('loading')
      const endpoint = route.kind === 'applicant' ? `/api/v1/agency/applications/${encodeURIComponent(route.id)}` : `/api/v1/agency/appointments/${encodeURIComponent(route.id)}`
      try {
        const response = await fetch(endpoint, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal })
        if (!response.ok) throw new Error(agencyRequestError(response))
        const payload = await response.json() as { data?: AgencyApplicantDetailApi | { appointment: AgencyAppointmentApi } }
        const record = route.kind === 'applicant' ? payload.data as AgencyApplicantDetailApi | undefined : (payload.data as { appointment?: AgencyAppointmentApi } | undefined)?.appointment
        if (!record) throw new Error('No se ha encontrado el registro solicitado.')
        setRemoteRecord(record)
        setRemoteState('loaded')
      } catch (error) {
        if (controller.signal.aborted) return
        setRemoteError(error instanceof Error ? error.message : 'No hemos podido cargar este registro.')
        setRemoteState('error')
      }
    }
    void load()
    return () => controller.abort()
  }, [loadState, route?.kind, route?.id, reloadKey])
  useEffect(() => {
    if (loadState !== 'remote' || route?.kind !== 'appointment') return
    const controller = new AbortController()
    const loadTeam = async () => {
      try {
        setTeamMembers(await fetchAllAgencyTeamMembers(controller.signal))
      } catch { /* The appointment detail remains usable if the team list cannot be loaded. */ }
    }
    void loadTeam()
    return () => controller.abort()
  }, [loadState, route?.kind])
  const changeRemoteApplicantStatus = async (status: Exclude<AgencyApplicantDetailApi['application']['status'], 'withdrawn'>) => {
    if (!route || route.kind !== 'applicant' || !remoteRecord || !('application' in remoteRecord)) return
    setMutating(true)
    setMutationError('')
    try {
      const response = await fetch(`/api/v1/agency/applications/${encodeURIComponent(route.id)}/status`, { method: 'PATCH', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ status, expectedStatus: remoteRecord.application.status }) })
      if (!response.ok) {
        const message = await agencyResponseError(response)
        if (response.status === 409) setReloadKey((key) => key + 1)
        throw new Error(message)
      }
      const payload = await response.json() as { data?: { application?: AgencyApplicantDetailApi['application'] } }
      if (!payload.data?.application) throw new Error('No hemos podido confirmar el cambio de estado.')
      setRemoteRecord({ ...remoteRecord, application: { ...remoteRecord.application, ...payload.data.application } })
      onDashboardInvalidated()
    } catch (caught) { setMutationError(caught instanceof Error ? caught.message : 'No hemos podido actualizar el estado.') }
    finally { setMutating(false) }
  }
  const updateRemoteAppointment = async (action: 'cancel' | 'complete' | 'no_show') => {
    if (!route || route.kind !== 'appointment' || !remoteRecord || !('startsAt' in remoteRecord)) return
    setMutating(true)
    setMutationError('')
    try {
      const response = await fetch(`/api/v1/agency/appointments/${encodeURIComponent(route.id)}`, { method: 'PATCH', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, expectedUpdatedAt: remoteRecord.updatedAt }) })
      if (!response.ok) {
        const message = await agencyResponseError(response)
        if (response.status === 409) setReloadKey((key) => key + 1)
        throw new Error(message)
      }
      const payload = await response.json() as { data?: { appointment?: Partial<AgencyAppointmentApi>; warnings?: AgencyAppointmentWarning[] } }
      if (!payload.data?.appointment) throw new Error('No hemos podido confirmar el cambio de la cita.')
      setRemoteRecord({ ...remoteRecord, ...payload.data.appointment })
      setAppointmentWarnings(payload.data.warnings ?? [])
      onDashboardInvalidated()
    } catch (caught) { setMutationError(caught instanceof Error ? caught.message : 'No hemos podido actualizar la cita.') }
    finally { setMutating(false) }
  }
  const rescheduleRemoteAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!route || route.kind !== 'appointment' || !remoteRecord || !('startsAt' in remoteRecord)) return
    const form = new FormData(event.currentTarget)
    const responsibleUserId = String(form.get('responsibleUserId') || '') || null
    setMutating(true)
    setMutationError('')
    try {
      const response = await fetch(`/api/v1/agency/appointments/${encodeURIComponent(route.id)}`, { method: 'PATCH', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reschedule', expectedUpdatedAt: remoteRecord.updatedAt, startsAt: madridLocalToIso(String(form.get('startsAt'))), durationMinutes: remoteRecord.durationMinutes || defaultVisitDurationMinutes, responsibleUserId }) })
      if (!response.ok) {
        const message = await agencyResponseError(response)
        if (response.status === 409) setReloadKey((key) => key + 1)
        throw new Error(message)
      }
      const payload = await response.json() as { data?: { appointment?: Partial<AgencyAppointmentApi>; warnings?: AgencyAppointmentWarning[] } }
      if (!payload.data?.appointment) throw new Error('No hemos podido confirmar la nueva fecha.')
      setRemoteRecord({ ...remoteRecord, ...payload.data.appointment, responsibleUserName: teamMembers.find((member) => member.userId === responsibleUserId)?.fullName ?? null })
      setAppointmentWarnings(payload.data.warnings ?? [])
      setRescheduleOpen(false)
      onDashboardInvalidated()
    } catch (caught) { setMutationError(caught instanceof Error ? caught.message : 'No hemos podido reprogramar la cita.') }
    finally { setMutating(false) }
  }
  const openSecureDocument = async (documentId: string, filename: string) => {
    if (!route || route.kind !== 'applicant') return
    setDocumentOpeningId(documentId)
    setMutationError('')
    try {
      const accessResponse = await fetch(`/api/v1/agency/applications/${encodeURIComponent(route.id)}/documents/${encodeURIComponent(documentId)}/access`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } })
      if (!accessResponse.ok) throw new Error(await agencyResponseError(accessResponse))
      const accessPayload = await accessResponse.json() as { data?: { accessUrl?: string; accessToken?: string } }
      if (!accessPayload.data?.accessUrl || !accessPayload.data.accessToken) throw new Error('No hemos podido crear el acceso temporal.')
      const contentResponse = await fetch(accessPayload.data.accessUrl, { credentials: 'include', headers: { Authorization: `Bearer ${accessPayload.data.accessToken}` } })
      if (!contentResponse.ok) throw new Error(await agencyResponseError(contentResponse))
      const objectUrl = URL.createObjectURL(await contentResponse.blob())
      const link = document.createElement('a')
      link.href = objectUrl
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (caught) { setMutationError(caught instanceof Error ? caught.message : 'No hemos podido abrir el documento.') }
    finally { setDocumentOpeningId(null) }
  }
  if (loadState === 'loading') return <section className="agency-view"><PageHeading title="Cargando registro" description="Estamos recuperando el contexto del panel." /><DashboardLoadMessage message="Cargando información..." /></section>
  if (loadState === 'error') return <section className="agency-view"><PageHeading title="No se ha podido abrir el registro" description={loadError} /><DashboardLoadMessage message={loadError} error loginRequired={isSessionError(loadError)} onRetry={() => window.location.reload()} /></section>
  if (loadState === 'remote' && remoteState === 'loading') return <section className="agency-view"><PageHeading title="Cargando registro" description="Estamos recuperando el detalle actualizado." /><DashboardLoadMessage message="Cargando información..." /></section>
  if (loadState === 'remote' && remoteState === 'error') return <section className="agency-view"><PageHeading title="No se ha podido abrir el registro" description={remoteError} /><DashboardLoadMessage message={remoteError} error loginRequired={isSessionError(remoteError)} onRetry={() => setReloadKey((key) => key + 1)} /></section>
  const remoteApplicant = route?.kind === 'applicant' ? remoteRecord as AgencyApplicantDetailApi | null : null
  const remoteAppointment = route?.kind === 'appointment' ? remoteRecord as AgencyAppointmentApi | null : null
  if (remoteApplicant || demoApplicant) {
    const property = demoApplicant ? properties.find((item) => item.id === demoApplicant.propertyId) : undefined
    const name = remoteApplicant?.applicant?.fullName ?? demoApplicant?.name ?? 'Interesado'
    const propertyTitle = remoteApplicant?.property.title ?? property?.title ?? 'Anuncio'
    const submitted = remoteApplicant?.application.submittedAt ? apiRelativeDateTime(remoteApplicant.application.submittedAt) : demoApplicant ? apiRelativeDateTime(demoApplicant.submittedIso) : 'Sin fecha de envío'
    if (remoteApplicant) {
      const statusLabel = remoteApplicantStatusLabels
      const documentLabel: Record<AgencyApplicantDetailApi['application']['documentState'], DocumentStatus> = { complete: 'Completa', missing: 'Faltan documentos', not_requested: 'Sin solicitar' }
      const details = remoteApplicant.application.draftData
      return <section className="agency-view agency-linked-record"><button className="agency-back" onClick={onBack}><ArrowLeft size={17} />Panel</button><PageHeading eyebrow="INTERESADO" title={name} description={`${remoteApplicant.property.internalReference} · ${propertyTitle}`} actions={<label className="agency-select"><span className="agency-sr-only">Cambiar estado</span><select value={remoteApplicant.application.status} disabled={mutating || remoteApplicant.application.status === 'withdrawn'} onChange={(event) => void changeRemoteApplicantStatus(event.target.value as Exclude<AgencyApplicantDetailApi['application']['status'], 'withdrawn'>)}><option value="new">Nuevo</option><option value="preselected">Preseleccionado</option><option value="selected">Seleccionado</option><option value="final_tenant">Inquilino final</option><option value="rejected">Descartado</option>{remoteApplicant.application.status === 'withdrawn' && <option value="withdrawn">Retirado</option>}</select><CaretDown size={14} /></label>} />
        {mutationError && <p className="agency-inline-error" role="alert">{mutationError}</p>}
        {remoteApplicant.possibleDuplicate && <div className="agency-duplicate-note" role="status"><Warning size={18} weight="fill" /><span><strong>Posible solicitud duplicada</strong><small>Coincide por {remoteApplicant.possibleDuplicate.matchedOn.map((value) => value === 'email' ? 'correo' : 'teléfono').join(' y ')} con {remoteApplicant.possibleDuplicate.applicationIds.length} solicitud(es) de este anuncio. Revísalas por separado; no se han fusionado ni descartado.</small></span></div>}
        <div className="agency-linked-detail-grid"><section className="agency-panel-card"><h2>Resumen</h2><dl><div><dt>Solicitud recibida</dt><dd>{submitted}</dd></div><div><dt>Estado</dt><dd><StatusBadge status={statusLabel[remoteApplicant.application.status]} /></dd></div><div><dt>Documentación</dt><dd><StatusBadge status={documentLabel[remoteApplicant.application.documentState]} /></dd></div><div><dt>Responsable</dt><dd>{remoteApplicant.responsibleUser?.fullName ?? 'Sin asignar'}</dd></div><div><dt>Correo</dt><dd>{remoteApplicant.applicant?.email ?? 'No disponible'}</dd></div><div><dt>Ubicación</dt><dd>{remoteApplicant.property.address ? `${remoteApplicant.property.address}, ` : ''}{remoteApplicant.property.city}</dd></div></dl></section>
          <section className="agency-panel-card"><h2>Solicitud</h2><dl><div><dt>Teléfono</dt><dd>{formatPhoneDisplay(typeof details.phone === 'string' ? details.phone : null)}</dd></div><div><dt>Contacto preferido</dt><dd>{contactChannelCopy(details.preferredContactChannel)}</dd></div><div><dt>Adultos / menores</dt><dd>{detailValue(details.adultOccupants)} / {detailValue(details.minorOccupants)}</dd></div><div><dt>Entrada prevista</dt><dd>{detailValue(details.intendedMoveInDate)}</dd></div><div><dt>Situación laboral</dt><dd>{detailValue(details.employmentStatus)}</dd></div><div><dt>Contrato</dt><dd>{detailValue(details.contractType)}</dd></div><div><dt>Actividad o empresa</dt><dd>{detailValue(details.employerOrActivity)}</dd></div><div><dt>Ingresos individuales</dt><dd>{typeof details.individualNetMonthlyIncomeCents === 'number' ? formatMoney(details.individualNetMonthlyIncomeCents / 100) : 'No indicado'}</dd></div><div><dt>Ingresos del hogar</dt><dd>{typeof details.householdNetMonthlyIncomeCents === 'number' ? formatMoney(details.householdNetMonthlyIncomeCents / 100) : 'No indicado'}</dd></div><div><dt>Mascotas</dt><dd>{yesNoCopy(details.pets)}</dd></div><div><dt>Detalles de mascotas</dt><dd>{detailValue(details.petDetails)}</dd></div><div><dt>Avalista</dt><dd>{yesNoCopy(details.guarantorAvailability)}</dd></div><div><dt>Disponibilidad</dt><dd>{detailValue(details.viewingAvailability)}</dd></div><div><dt>Nota de disponibilidad</dt><dd>{detailValue(details.availabilityNote)}</dd></div><div><dt>Mensaje</dt><dd>{detailValue(details.message)}</dd></div><div><dt>Consentimiento comercial</dt><dd>{detailValue(details.marketingConsent)}</dd></div></dl></section>
          <section className="agency-panel-card"><h2>Personas adultas</h2><ul className="agency-linked-list">{remoteApplicant.application.adultProfiles.map((adult) => <li key={adult.id}><span><strong>{adult.fullName}{adult.isPrimary ? ' · solicitante principal' : ''}</strong><small>{adult.employmentStatus} · {adult.contractType} · {formatMoney(adult.netMonthlyIncomeCents / 100)}{adult.email ? ` · ${adult.email}` : ''}</small></span></li>)}</ul></section>
          <section className="agency-panel-card"><h2>Documentos</h2>{remoteApplicant.documents.length ? <ul className="agency-linked-list">{remoteApplicant.documents.map((document) => { const owner = remoteApplicant.application.adultProfiles.find((adult) => adult.id === document.adultProfileId); return <li key={document.id}><span><strong>{document.originalName}</strong><small>{documentCategoryCopy(document.category)} · {owner?.fullName ?? 'Solicitante principal'}</small></span><button className="agency-text-button" disabled={documentOpeningId === document.id} onClick={() => void openSecureDocument(document.id, document.originalName)}>{documentOpeningId === document.id ? 'Abriendo...' : 'Abrir'} <ArrowRight size={15} /></button></li> })}</ul> : <p className="agency-muted-copy">No hay documentos disponibles.</p>}</section>
          <section className="agency-panel-card"><ApplicantCollaborationControls applicationId={remoteApplicant.application.id} initialResponsibleUserId={remoteApplicant.application.responsibleUserId} initialNotes={remoteApplicant.notes} onResponsibleChanged={(responsibleUser) => setRemoteRecord((current) => current && 'application' in current ? { ...current, responsibleUser, application: { ...current.application, responsibleUserId: responsibleUser?.id ?? null } } : current)} /></section>
          <section className="agency-panel-card"><h2>Historial de citas</h2>{remoteApplicant.appointments.length ? <ul className="agency-linked-list">{remoteApplicant.appointments.map((appointment) => <li key={appointment.id}><span><strong>{apiRelativeDateTime(appointment.startsAt)}</strong><small>{appointmentStateCopy(appointment.state)}</small></span><a className="agency-text-button" href={`/app/citas/${encodeURIComponent(appointment.id)}`}>Abrir <ArrowRight size={15} /></a></li>)}</ul> : <p className="agency-muted-copy">No hay citas registradas.</p>}</section>
          <section className="agency-panel-card"><h2>Actividad</h2>{remoteApplicant.activity.length ? <ul className="agency-linked-list">{remoteApplicant.activity.map((event) => <li key={event.id}><span><strong>{activityCopy(event)}</strong><small>{apiRelativeDateTime(event.createdAt)}</small></span></li>)}</ul> : <p className="agency-muted-copy">Todavía no hay actividad registrada.</p>}</section>
        </div></section>
    }
    return <section className="agency-view agency-linked-record"><button className="agency-back" onClick={onBack}><ArrowLeft size={17} />Panel</button><PageHeading eyebrow="NUEVO INTERESADO" title={name} description={propertyTitle} /><section className="agency-panel-card"><dl><div><dt>Solicitud recibida</dt><dd>{submitted}</dd></div><div><dt>Anuncio</dt><dd>{propertyTitle}</dd></div><div><dt>Estado</dt><dd>{demoApplicant?.status}</dd></div><div><dt>Responsable</dt><dd>{demoApplicant?.assignee}</dd></div></dl></section></section>
  }
  if (remoteAppointment || demoAppointment) {
    const parts = remoteAppointment ? apiDateParts(remoteAppointment.startsAt) : null
    const name = remoteAppointment?.applicantName ?? demoAppointment?.applicant ?? 'Interesado'
    const propertyTitle = remoteAppointment?.propertyTitle ?? demoAppointment?.property ?? 'Anuncio'
    const date = remoteAppointment ? `${parts?.date} a las ${parts?.time}` : `${demoAppointment?.date} a las ${demoAppointment?.time}`
    const workerPickerHidden = hideWorkerPicker(teamMembers, billingPlan)
    const autoAssignedUserId = teamMembers.length === 1 ? teamMembers[0].userId : remoteAppointment?.responsibleUserId ?? ''
    return <section className="agency-view agency-linked-record"><button className="agency-back" onClick={onBack}><ArrowLeft size={17} />Panel</button><PageHeading eyebrow="VISITA" title={name} description={propertyTitle} actions={remoteAppointment?.state === 'scheduled' ? <div className="agency-inline-actions"><button className="agency-button agency-button--secondary" disabled={mutating} onClick={() => setRescheduleOpen((open) => !open)}><Clock size={17} />Reprogramar</button><button className="agency-button agency-button--secondary" disabled={mutating} onClick={() => void updateRemoteAppointment('complete')}><Check size={17} />Completar</button><button className="agency-button agency-button--secondary" disabled={mutating} onClick={() => void updateRemoteAppointment('no_show')}><UserCircle size={17} />No se presentó</button><button className="agency-button agency-button--secondary" disabled={mutating} onClick={() => void updateRemoteAppointment('cancel')}><X size={17} />Cancelar</button></div> : undefined} />{mutationError && <p className="agency-inline-error" role="alert">{mutationError}</p>}{appointmentWarnings.length > 0 && <div className="agency-overlap-warning" role="status"><Clock size={18} /><span><strong>Posible solapamiento</strong><small>{appointmentWarnings.map((warning) => apiRelativeDateTime(warning.startsAt)).join(', ')}</small></span></div>}{remoteAppointment && rescheduleOpen && <form className="agency-panel-card agency-reschedule-form" onSubmit={rescheduleRemoteAppointment}><label className="agency-form-field"><span>Nueva fecha y hora</span><input name="startsAt" type="datetime-local" required defaultValue={madridDateTimeLocal(remoteAppointment.startsAt)} /></label>{workerPickerHidden ? <input type="hidden" name="responsibleUserId" value={autoAssignedUserId} /> : <label className="agency-form-field"><span>Trabajador asociado</span><select name="responsibleUserId" defaultValue={remoteAppointment.responsibleUserId ?? ''}><option value="">Indefinido</option>{teamMembers.map((member) => <option key={member.userId} value={member.userId}>{member.fullName}</option>)}</select></label>}<button className="agency-button agency-button--primary" type="submit" disabled={mutating}>Guardar cambios</button></form>}<section className="agency-panel-card"><dl><div><dt>Fecha y hora</dt><dd>{date}</dd></div><div><dt>Anuncio</dt><dd>{propertyTitle}</dd></div>{demoAppointment && <div><dt>Trabajadores asociados</dt><dd>{demoAppointment.assignees.length ? demoAppointment.assignees.join(', ') : 'Sin asignar'}</dd></div>}{remoteAppointment && <><div><dt>Estado</dt><dd>{appointmentStateCopy(remoteAppointment.state)}</dd></div><div><dt>Trabajador asociado</dt><dd>{remoteAppointment.responsibleUserName ?? 'Indefinido'}</dd></div><div><dt>Instrucciones</dt><dd>{remoteAppointment.instructions ?? 'Sin instrucciones'}</dd></div><div><dt>Nota interna</dt><dd>{remoteAppointment.internalNote ?? 'Sin nota'}</dd></div></>}</dl></section></section>
  }
  return <section className="agency-view"><PageHeading title="Registro no disponible" description="Este elemento ya no forma parte del resumen operativo del panel." /><button className="agency-button agency-button--secondary" onClick={onBack}><ArrowLeft size={17} />Volver al panel</button></section>
}

function AgencyDestinationGate({ title, loadState, loadError, onRetry }: { title: string; loadState: DashboardLoadState; loadError: string; onRetry: () => void }) {
  return <section className="agency-view"><PageHeading title={title} description={loadState === 'loading' ? 'Estamos preparando tu espacio de trabajo.' : loadError} /><DashboardLoadMessage message={loadState === 'loading' ? 'Cargando información...' : loadError} error={loadState === 'error'} loginRequired={isSessionError(loadError)} onRetry={onRetry} /></section>
}

function AuthenticatedPropertiesView({ onlyWithNewApplicants, onClearNewApplicants, onOpen, onNew, onEdit }: { onlyWithNewApplicants: boolean; onClearNewApplicants: () => void; onOpen: (id: string) => void; onNew: () => void; onEdit: (property: AgencyPropertyApi) => void }) {
  const [records, setRecords] = useState<AgencyPropertyApi[]>([])
  const [pagination, setPagination] = useState<PaginationMetadata | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'all' | AgencyPropertyApi['property']['state']>('all')
  const [loadState, setLoadState] = useState<RemoteLoadState>('loading')
  const [error, setError] = useState('')
  const [rowError, setRowError] = useState('')
  const [copiedPropertyId, setCopiedPropertyId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const requestScope = JSON.stringify([query, state, onlyWithNewApplicants, reloadKey])
  const requestScopeRef = useRef(requestScope)
  requestScopeRef.current = requestScope
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoadingMore(false)
      setRowError('')
      setLoadState('loading')
      setError('')
      try {
        const parameters = new URLSearchParams({ page: '1', pageSize: '25' })
        if (query.trim()) parameters.set('search', query.trim())
        if (state !== 'all') parameters.set('state', state)
        if (onlyWithNewApplicants) parameters.set('hasRecentNewApplicants', 'true')
        const response = await fetch(`/api/v1/agency/properties?${parameters}`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal })
        if (!response.ok) throw new Error(agencyRequestError(response))
        const payload = await response.json() as { data?: { properties?: AgencyPropertyApi[]; pagination?: PaginationMetadata } }
        setRecords(payload.data?.properties ?? [])
        setPagination(payload.data?.pagination ?? null)
        setLoadState('loaded')
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'No hemos podido cargar tus anuncios.')
        setLoadState('error')
      }
    }
    void load()
    return () => controller.abort()
  }, [onlyWithNewApplicants, query, reloadKey, state])
  const loadMore = async () => {
    if (!pagination?.hasMore || loadingMore) return
    const requestedScope = requestScopeRef.current
    setLoadingMore(true); setRowError('')
    try {
      const parameters = new URLSearchParams({ page: String(pagination.page + 1), pageSize: String(pagination.pageSize) })
      if (query.trim()) parameters.set('search', query.trim())
      if (state !== 'all') parameters.set('state', state)
      if (onlyWithNewApplicants) parameters.set('hasRecentNewApplicants', 'true')
      const response = await fetch(`/api/v1/agency/properties?${parameters}`, { credentials: 'include', headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(await agencyResponseError(response))
      const payload = await response.json() as { data?: { properties?: AgencyPropertyApi[]; pagination?: PaginationMetadata } }
      if (requestScopeRef.current !== requestedScope) return
      setRecords((current) => [...current, ...(payload.data?.properties ?? [])]); setPagination(payload.data?.pagination ?? null)
    } catch (caught) {
      if (requestScopeRef.current === requestedScope) setRowError(caught instanceof Error ? caught.message : 'No hemos podido cargar más anuncios.')
    } finally {
      if (requestScopeRef.current === requestedScope) setLoadingMore(false)
    }
  }
  const visible = records.filter((record) => {
    const searchValue = `${record.property.title} ${record.property.address ?? ''} ${record.property.internalReference}`.toLowerCase()
    return (!query.trim() || searchValue.includes(query.trim().toLowerCase())) && (state === 'all' || record.property.state === state) && (!onlyWithNewApplicants || record.recentNewApplicantCount > 0)
  })
  const stateLabel: Record<AgencyPropertyApi['property']['state'], PropertyStatus> = { draft: 'Borrador', published: 'Publicado', paused: 'Pausado', archived: 'Archivado' }
  const copyPropertyLink = async (record: AgencyPropertyApi) => {
    setRowError('')
    try {
      const response = await fetch(`/api/v1/agency/properties/${encodeURIComponent(record.property.id)}/public-link`, { credentials: 'include', headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(await agencyResponseError(response))
      const payload = await response.json() as { data?: { publicLink?: string } }
      if (!payload.data?.publicLink) throw new Error('Este anuncio no tiene un enlace público disponible.')
      await navigator.clipboard.writeText(payload.data.publicLink)
      setCopiedPropertyId(record.property.id)
      window.setTimeout(() => setCopiedPropertyId((current) => current === record.property.id ? null : current), 1800)
    } catch (caught) {
      setRowError(caught instanceof Error ? caught.message : 'No hemos podido copiar el enlace público.')
    }
  }
  return <section className="agency-view">
    <PageHeading eyebrow="ANUNCIOS DE LA AGENCIA" title="Mis anuncios" description="Gestiona cada inmueble y a todas las personas interesadas desde un mismo lugar." actions={<button className="agency-button agency-button--primary" onClick={onNew}><Plus size={18} weight="bold" />Nuevo anuncio</button>} />
    <div className="agency-toolbar"><label className="agency-search"><MagnifyingGlass size={18} /><span className="agency-sr-only">Buscar anuncios</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por título, dirección o referencia" /></label><label className="agency-select"><SlidersHorizontal size={17} /><span className="agency-sr-only">Filtrar por estado</span><select value={state} onChange={(event) => setState(event.target.value as typeof state)}><option value="all">Todos</option><option value="published">Publicado</option><option value="draft">Borrador</option><option value="paused">Pausado</option><option value="archived">Archivado</option></select><CaretDown size={14} /></label></div>
    {onlyWithNewApplicants && <div className="agency-filter-summary"><Funnel size={15} /><span>Anuncios con interesados nuevos en los últimos 30 días</span><button onClick={onClearNewApplicants}>Quitar filtro <X size={13} /></button></div>}
    {rowError && <p className="agency-inline-error" role="alert">{rowError}</p>}
    {loadState === 'loading' ? <DashboardLoadMessage message="Cargando anuncios..." /> : loadState === 'error' ? <DashboardLoadMessage message={error} error loginRequired={isSessionError(error)} onRetry={() => setReloadKey((key) => key + 1)} /> : visible.length ? <><div className="agency-property-list agency-property-list--authenticated">{visible.map((record) => <article className="agency-property-row" key={record.property.id}>
      {record.property.coverImageUrl ? <img className="agency-property-api-cover" src={record.property.coverImageUrl} alt="" /> : <div className="agency-property-visual agency-property-visual--blue" aria-hidden="true"><HouseLine size={25} weight="duotone" /></div>}
      <div className="agency-property-row__identity"><small>{record.property.internalReference}</small><button className="agency-property-row__title" onClick={() => onOpen(record.property.id)}>{record.property.title}</button><em><MapPin size={14} />{record.property.address ? `${record.property.address}, ` : ''}{record.property.city}</em></div>
      <div className="agency-property-row__price"><strong>{formatMoney(record.property.monthlyRentCents / 100)}</strong><small>al mes{record.property.bedrooms === null ? '' : ` · ${record.property.bedrooms} hab.`}</small></div>
      <div className="agency-property-row__interest"><strong>{record.applicantCount}</strong><small>interesados</small>{record.recentNewApplicantCount > 0 && <span>{record.recentNewApplicantCount} nuevos</span>}</div>
      <div className="agency-property-row__next"><small>Próxima visita</small><strong>{record.nextViewing ? apiRelativeDateTime(record.nextViewing.startsAt) : 'Sin visitas'}</strong></div><StatusBadge status={stateLabel[record.property.state]} />
      <div className="agency-row-actions"><button className="agency-icon-button agency-icon-button--border" disabled={record.property.state !== 'published'} title={record.property.state === 'published' ? 'Copiar enlace público' : 'Publica el anuncio para compartir su enlace'} onClick={() => void copyPropertyLink(record)} aria-label={`Copiar enlace de ${record.property.title}`}>{copiedPropertyId === record.property.id ? <Check size={18} weight="bold" /> : <LinkSimple size={18} />}</button><button className="agency-icon-button agency-icon-button--border" onClick={() => onEdit(record)} aria-label={`Editar ${record.property.title}`} title="Editar anuncio"><NotePencil size={18} /></button><button className="agency-icon-button" onClick={() => onOpen(record.property.id)} aria-label={`Abrir la ficha de ${record.property.title}`} title="Abrir ficha"><ArrowRight size={18} /></button></div>
    </article>)}</div>{pagination?.hasMore && <button className="agency-button agency-button--secondary" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Cargando…' : `Cargar más anuncios (${records.length} de ${pagination.total})`}</button>}</> : <EmptyState title="No hay anuncios que coincidan" description="Prueba con otra búsqueda o elimina los filtros activos." action="Limpiar filtros" onAction={() => { setQuery(''); setState('all'); onClearNewApplicants() }} />}
  </section>
}

function AuthenticatedPropertyView({ propertyId, onBack, onEdit }: { propertyId: string; onBack: () => void; onEdit: (property: AgencyPropertyApi) => void }) {
  const [property, setProperty] = useState<AgencyPropertyApi | null>(null)
  const [applications, setApplications] = useState<AgencyApplicationListItem[]>([])
  const [applicationsPagination, setApplicationsPagination] = useState<PaginationMetadata | null>(null)
  const [loadingMoreApplications, setLoadingMoreApplications] = useState(false)
  const [teamMembers, setTeamMembers] = useState<AgencyTeamMember[]>([])
  const billingPlan = useBillingPlan(true)
  const [query, setQuery] = useState('')
  const [applicantStatus, setApplicantStatus] = useState<'all' | AgencyApplicantDetailApi['application']['status']>('all')
  const [documentStatus, setDocumentStatus] = useState<'all' | AgencyApplicantDetailApi['application']['documentState']>('all')
  const [viewingStatus, setViewingStatus] = useState<'all' | 'none' | 'scheduled'>('all')
  const [submittedFilter, setSubmittedFilter] = useState<'all' | 'today' | 'week'>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'income' | 'status' | 'next_viewing'>('newest')
  const [loadState, setLoadState] = useState<RemoteLoadState>('loading')
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [mutatingApplicationId, setMutatingApplicationId] = useState<string | null>(null)
  const [scheduling, setScheduling] = useState<AgencyApplicationListItem | null>(null)
  const [copied, setCopied] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const requestScope = JSON.stringify([propertyId, query, applicantStatus, documentStatus, viewingStatus, submittedFilter, assigneeFilter, sort, reloadKey])
  const requestScopeRef = useRef(requestScope)
  requestScopeRef.current = requestScope
  const applicationParameters = (page: number, pageSize = 25) => {
    const parameters = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort })
    if (query.trim()) parameters.set('search', query.trim())
    if (applicantStatus !== 'all') parameters.set('status', applicantStatus)
    if (documentStatus !== 'all') parameters.set('documentState', documentStatus)
    if (viewingStatus !== 'all') parameters.set('viewingState', viewingStatus)
    if (assigneeFilter === 'unassigned') parameters.set('responsibility', 'unassigned')
    else if (assigneeFilter !== 'all') parameters.set('responsibleUserId', assigneeFilter)
    if (submittedFilter !== 'all') {
      const from = submittedFilter === 'today' ? new Date(new Date().setHours(0, 0, 0, 0)) : new Date(Date.now() - 7 * dayInMilliseconds)
      parameters.set('submittedFrom', from.toISOString())
    }
    return parameters
  }
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoadingMoreApplications(false)
      setActionError('')
      setLoadState('loading')
      setError('')
      try {
        const [propertyResponse, applicationsResponse, loadedTeamMembers] = await Promise.all([
          fetch(`/api/v1/agency/properties?propertyId=${encodeURIComponent(propertyId)}&pageSize=1`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal }),
          fetch(`/api/v1/agency/properties/${encodeURIComponent(propertyId)}/applications?${applicationParameters(1)}`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal }),
          fetchAllAgencyTeamMembers(controller.signal),
        ])
        if (!propertyResponse.ok) throw new Error(agencyRequestError(propertyResponse))
        if (!applicationsResponse.ok) throw new Error(agencyRequestError(applicationsResponse))
        const propertyPayload = await propertyResponse.json() as { data?: { properties?: AgencyPropertyApi[] } }
        const applicationsPayload = await applicationsResponse.json() as { data?: { applications?: AgencyApplicationListItem[]; pagination?: PaginationMetadata } }
        const selected = propertyPayload.data?.properties?.find((record) => record.property.id === propertyId)
        if (!selected) throw new Error('No se ha encontrado el anuncio solicitado.')
        setProperty(selected)
        setApplications(applicationsPayload.data?.applications ?? [])
        setApplicationsPagination(applicationsPayload.data?.pagination ?? null)
        setTeamMembers(loadedTeamMembers)
        setLoadState('loaded')
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'No hemos podido cargar este anuncio.')
        setLoadState('error')
      }
    }
    void load()
    return () => controller.abort()
  }, [applicantStatus, assigneeFilter, documentStatus, propertyId, query, reloadKey, sort, submittedFilter, viewingStatus])
  const loadMoreApplications = async () => {
    if (!applicationsPagination?.hasMore || loadingMoreApplications) return
    const requestedScope = requestScopeRef.current
    setLoadingMoreApplications(true); setActionError('')
    try {
      const response = await fetch(`/api/v1/agency/properties/${encodeURIComponent(propertyId)}/applications?${applicationParameters(applicationsPagination.page + 1, applicationsPagination.pageSize)}`, { credentials: 'include', headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(await agencyResponseError(response))
      const payload = await response.json() as { data?: { applications?: AgencyApplicationListItem[]; pagination?: PaginationMetadata } }
      if (requestScopeRef.current !== requestedScope) return
      setApplications((current) => [...current, ...(payload.data?.applications ?? [])]); setApplicationsPagination(payload.data?.pagination ?? null)
    } catch (caught) {
      if (requestScopeRef.current === requestedScope) setActionError(caught instanceof Error ? caught.message : 'No hemos podido cargar más interesados.')
    } finally {
      if (requestScopeRef.current === requestedScope) setLoadingMoreApplications(false)
    }
  }
  if (loadState === 'loading') return <section className="agency-view"><PageHeading title="Cargando anuncio" description="Estamos recuperando sus interesados." /><DashboardLoadMessage message="Cargando información..." /></section>
  if (loadState === 'error' || !property) return <section className="agency-view"><PageHeading title="No se ha podido abrir el anuncio" description={error} /><DashboardLoadMessage message={error} error loginRequired={isSessionError(error)} onRetry={() => setReloadKey((key) => key + 1)} /></section>
  const applicantStatusLabel = remoteApplicantStatusLabels
  const documentStatusLabel: Record<AgencyApplicantDetailApi['application']['documentState'], DocumentStatus> = { complete: 'Completa', missing: 'Faltan documentos', not_requested: 'Sin solicitar' }
  const search = query.trim().toLowerCase()
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const assignees = teamMembers.map((member) => member.userId)
  const visible = applications.filter((item) => {
    const phone = applicationText(item, 'phone') ?? ''
    const submittedAt = item.application.submittedAt ? new Date(item.application.submittedAt).getTime() : 0
    const matchesSearch = !search || `${item.tenantName} ${item.tenantEmail} ${phone}`.toLowerCase().includes(search)
    const matchesStatus = applicantStatus === 'all' || item.application.status === applicantStatus
    const matchesDocuments = documentStatus === 'all' || item.application.documentState === documentStatus
    const matchesViewing = viewingStatus === 'all' || (viewingStatus === 'scheduled' ? Boolean(item.nextViewing) : !item.nextViewing)
    const matchesDate = submittedFilter === 'all' || (submittedFilter === 'today' ? submittedAt >= startOfToday.getTime() : submittedAt >= Date.now() - 7 * dayInMilliseconds)
    const matchesAssignee = assigneeFilter === 'all' || (assigneeFilter === 'unassigned' ? !item.application.responsibleUserId : item.application.responsibleUserId === assigneeFilter)
    return matchesSearch && matchesStatus && matchesDocuments && matchesViewing && matchesDate && matchesAssignee
  }).sort((left, right) => {
    if (sort === 'oldest') return new Date(left.application.submittedAt ?? 0).getTime() - new Date(right.application.submittedAt ?? 0).getTime()
    if (sort === 'income') return (applicationNumber(right, 'householdNetMonthlyIncomeCents') ?? 0) - (applicationNumber(left, 'householdNetMonthlyIncomeCents') ?? 0)
    if (sort === 'status') return applicantStatusLabel[left.application.status].localeCompare(applicantStatusLabel[right.application.status], 'es')
    if (sort === 'next_viewing') return new Date(left.nextViewing?.startsAt ?? '9999-12-31').getTime() - new Date(right.nextViewing?.startsAt ?? '9999-12-31').getTime()
    return new Date(right.application.submittedAt ?? 0).getTime() - new Date(left.application.submittedAt ?? 0).getTime()
  })
  const clearFilters = () => { setQuery(''); setApplicantStatus('all'); setDocumentStatus('all'); setViewingStatus('all'); setSubmittedFilter('all'); setAssigneeFilter('all'); setSort('newest') }
  const hasFilters = Boolean(query) || applicantStatus !== 'all' || documentStatus !== 'all' || viewingStatus !== 'all' || submittedFilter !== 'all' || assigneeFilter !== 'all' || sort !== 'newest'
  const copyPublicLink = async () => {
    setActionError('')
    try {
      const response = await fetch(`/api/v1/agency/properties/${encodeURIComponent(propertyId)}/public-link`, { credentials: 'include', headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(await agencyResponseError(response))
      const payload = await response.json() as { data?: { publicLink?: string } }
      if (!payload.data?.publicLink) throw new Error('Este anuncio no tiene un enlace público disponible.')
      await navigator.clipboard.writeText(payload.data.publicLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'No hemos podido copiar el enlace.') }
  }
  const changeApplicantStatus = async (item: AgencyApplicationListItem, status: Exclude<AgencyApplicantDetailApi['application']['status'], 'withdrawn'>) => {
    setActionError(''); setMutatingApplicationId(item.application.id)
    try {
      const response = await fetch(`/api/v1/agency/applications/${encodeURIComponent(item.application.id)}/status`, { method: 'PATCH', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ status, expectedStatus: item.application.status }) })
      if (!response.ok) throw new Error(await agencyResponseError(response))
      const payload = await response.json() as { data?: { application?: AgencyApplicantDetailApi['application'] } }
      if (!payload.data?.application) throw new Error('No hemos podido confirmar el nuevo estado.')
      setApplications((current) => current.map((candidate) => candidate.application.id === item.application.id ? { ...candidate, application: { ...candidate.application, ...payload.data!.application! } } : candidate))
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'No hemos podido cambiar el estado.') } finally { setMutatingApplicationId(null) }
  }
  const openWhatsApp = async (item: AgencyApplicationListItem) => {
    setActionError('')
    const popup = window.open('about:blank', '_blank')
    if (popup) popup.opener = null
    try {
      const response = await fetch(`/api/v1/agency/applications/${encodeURIComponent(item.application.id)}/whatsapp`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' })
      if (!response.ok) throw new Error(await agencyResponseError(response))
      const payload = await response.json() as { data?: { deepLink?: string } }
      if (!payload.data?.deepLink) throw new Error('No hemos podido preparar el contacto por WhatsApp.')
      if (popup) popup.location.href = payload.data.deepLink
      else window.location.href = payload.data.deepLink
    } catch (caught) { popup?.close(); setActionError(caught instanceof Error ? caught.message : 'No hemos podido abrir WhatsApp.') }
  }
  const submitAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!scheduling) return
    const form = new FormData(event.currentTarget)
    const responsibleUserId = String(form.get('responsibleUserId') || '') || null
    setActionError(''); setMutatingApplicationId(scheduling.application.id)
    try {
      const response = await fetch('/api/v1/agency/appointments', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ applicationId: scheduling.application.id, startsAt: madridLocalToIso(String(form.get('startsAt'))), durationMinutes: defaultVisitDurationMinutes, responsibleUserId, instructions: String(form.get('instructions') || '').trim() || null, internalNote: String(form.get('internalNote') || '').trim() || null }) })
      if (!response.ok) throw new Error(await agencyResponseError(response))
      const payload = await response.json() as { data?: { appointment?: { startsAt: string } } }
      if (!payload.data?.appointment) throw new Error('No hemos podido confirmar la visita.')
      setApplications((current) => current.map((candidate) => candidate.application.id === scheduling.application.id ? { ...candidate, nextViewing: { startsAt: payload.data!.appointment!.startsAt } } : candidate))
      setScheduling(null)
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'No hemos podido agendar la visita.') } finally { setMutatingApplicationId(null) }
  }
  const exportApplications = () => {
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const rows = visible.map((item) => [item.tenantName, item.tenantEmail, applicationText(item, 'phone'), item.application.submittedAt, householdCopy(item), applicationText(item, 'intendedMoveInDate'), employmentStatusCopy(applicationText(item, 'employmentStatus')), applicationNumber(item, 'householdNetMonthlyIncomeCents') ?? '', documentStatusLabel[item.application.documentState], item.nextViewing?.startsAt ?? '', item.responsibleUserName ?? 'Sin asignar', applicantStatusLabel[item.application.status]])
    const csv = [['Nombre', 'Correo', 'Teléfono', 'Solicitud', 'Hogar', 'Entrada', 'Situación laboral', 'Ingresos del hogar', 'Documentación', 'Próxima visita', 'Responsable', 'Estado'], ...rows].map((row) => row.map(quote).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `${property.property.internalReference}-interesados.csv`; link.click(); URL.revokeObjectURL(url)
  }
  return <section className="agency-view agency-property-detail"><button className="agency-back" onClick={onBack}><ArrowLeft size={17} />Mis anuncios</button>
    <header className="agency-property-header">
      <PropertyCoverMedia propertyId={property.property.id} coverImageUrl={property.property.coverImageUrl} onUploaded={({ coverImageUrl, version }) => setProperty((current) => current ? { ...current, property: { ...current.property, coverImageUrl, version } } : current)} />
      <div className="agency-property-header__identity"><div><span>{property.property.internalReference}</span><StatusBadge status={({ draft: 'Borrador', published: 'Publicado', paused: 'Pausado', archived: 'Archivado' } as const)[property.property.state]} /></div><h1>{property.property.title}</h1><p><MapPin size={15} />{property.property.address ? `${property.property.address}, ` : ''}{property.property.city} · {formatMoney(property.property.monthlyRentCents / 100)} / mes</p></div>
      <div className="agency-property-header__stats"><span><strong>{property.applicantCount}</strong><small>interesados</small></span><span><strong>{property.newApplicantCount}</strong><small>por revisar</small></span><span><strong>{property.recentNewApplicantCount}</strong><small>nuevos · 30 días</small></span></div>
      <div className="agency-property-header__actions"><button className="agency-icon-button agency-icon-button--border" onClick={() => onEdit(property)} aria-label="Editar anuncio"><NotePencil size={18} /></button><button className="agency-button agency-button--secondary" disabled={property.property.state !== 'published'} onClick={() => void copyPublicLink()}>{copied ? <Check size={18} weight="bold" /> : <Copy size={18} />}{copied ? 'Copiado' : 'Copiar enlace'}</button></div>
    </header>
    <div className="agency-section-heading"><div><h2>Interesados</h2><p>{visible.length} resultados visibles</p></div><button className="agency-button agency-button--secondary agency-button--compact" onClick={exportApplications}><DownloadSimple size={17} />Exportar</button></div>
    <div className="agency-applicant-toolbar">
      <label className="agency-search agency-search--applicants"><MagnifyingGlass size={18} /><span className="agency-sr-only">Buscar interesados</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, correo o teléfono" /></label>
      <FilterSelect label="Estado" value={applicantStatus} onChange={(value) => setApplicantStatus(value as typeof applicantStatus)} options={['all', ...remoteApplicantStatusOrder]} optionLabels={{ all: 'Todos', ...remoteApplicantStatusLabels }} />
      <FilterSelect label="Documentación" value={documentStatus} onChange={(value) => setDocumentStatus(value as typeof documentStatus)} options={['all', 'complete', 'missing', 'not_requested']} optionLabels={{ all: 'Todos', complete: 'Completa', missing: 'Faltan documentos', not_requested: 'Sin solicitar' }} />
      <FilterSelect label="Visita" value={viewingStatus} onChange={(value) => setViewingStatus(value as typeof viewingStatus)} options={['all', 'none', 'scheduled']} optionLabels={{ all: 'Todas', none: 'Sin visita', scheduled: 'Agendada' }} />
      <FilterSelect label="Fecha" value={submittedFilter} onChange={(value) => setSubmittedFilter(value as typeof submittedFilter)} options={['all', 'today', 'week']} optionLabels={{ all: 'Cualquier fecha', today: 'Hoy', week: 'Últimos 7 días' }} />
      <FilterSelect label="Responsable" value={assigneeFilter} onChange={setAssigneeFilter} options={['all', ...assignees, 'unassigned']} optionLabels={{ all: 'Todos', unassigned: 'Sin asignar', ...Object.fromEntries(teamMembers.map((member) => [member.userId, member.fullName])) }} />
      <FilterSelect label="Ordenar" value={sort} onChange={(value) => setSort(value as typeof sort)} options={['newest', 'oldest', 'income', 'status', 'next_viewing']} optionLabels={{ newest: 'Más recientes', oldest: 'Más antiguos', income: 'Mayor ingreso', status: 'Estado', next_viewing: 'Próxima visita' }} sort />
    </div>
    {hasFilters && <div className="agency-filter-summary"><Funnel size={15} /><span>Filtros activos</span><button onClick={clearFilters}>Quitar todos <X size={13} /></button></div>}
    {actionError && <p className="agency-inline-error" role="alert">{actionError}</p>}
    {visible.length ? <RemoteApplicantTable applications={visible} property={property} documentStatusLabel={documentStatusLabel} mutatingApplicationId={mutatingApplicationId} onStatusChange={changeApplicantStatus} onWhatsApp={openWhatsApp} onSchedule={setScheduling} /> : <EmptyState title="Ningún interesado coincide" description="Cambia la búsqueda o quita los filtros para volver a ver todas las solicitudes." action="Quitar filtros" onAction={clearFilters} />}
    {applicationsPagination?.hasMore && <button className="agency-button agency-button--secondary" type="button" disabled={loadingMoreApplications} onClick={() => void loadMoreApplications()}>{loadingMoreApplications ? 'Cargando…' : `Cargar más interesados (${applications.length} de ${applicationsPagination.total})`}</button>}
    {scheduling && <RemoteAppointmentModal item={scheduling} property={property} teamMembers={teamMembers} billingPlan={billingPlan} busy={mutatingApplicationId === scheduling.application.id} onClose={() => setScheduling(null)} onSubmit={submitAppointment} />}
  </section>
}

function PropertyCoverMedia({ propertyId, coverImageUrl, onUploaded }: { propertyId: string; coverImageUrl: string | null; onUploaded: (result: { coverImageUrl: string; version: number }) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError('')
    try {
      onUploaded(await uploadPropertyCoverImage(propertyId, file))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No hemos podido subir la imagen.') } finally { setBusy(false) }
  }
  return <div className="agency-cover-media">
    {coverImageUrl ? <img src={coverImageUrl} alt="Imagen de portada del anuncio" /> : <span className="agency-cover-media__placeholder" aria-hidden="true"><HouseLine size={28} weight="duotone" /></span>}
    <label className="agency-cover-media__change"><UploadSimple size={13} weight="bold" /><span>{busy ? 'Subiendo…' : coverImageUrl ? 'Cambiar' : 'Subir portada'}</span><input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>
    {error && <em className="agency-cover-media__error" role="alert">{error}</em>}
  </div>
}

function RemoteApplicantTable({ applications, property, documentStatusLabel, mutatingApplicationId, onStatusChange, onWhatsApp, onSchedule }: {
  applications: AgencyApplicationListItem[]
  property: AgencyPropertyApi
  documentStatusLabel: Record<AgencyApplicantDetailApi['application']['documentState'], DocumentStatus>
  mutatingApplicationId: string | null
  onStatusChange: (item: AgencyApplicationListItem, status: Exclude<AgencyApplicantDetailApi['application']['status'], 'withdrawn'>) => void
  onWhatsApp: (item: AgencyApplicationListItem) => void
  onSchedule: (item: AgencyApplicationListItem) => void
}) {
  const detailHref = (item: AgencyApplicationListItem) => `/app/anuncios/${encodeURIComponent(property.property.id)}/interesados/${encodeURIComponent(item.application.id)}`
  const segments = remoteApplicantStatusOrder
    .map((status) => ({ status, label: remoteApplicantStatusLabels[status], items: applications.filter((item) => item.application.status === status) }))
    .filter((segment) => segment.items.length > 0)
  const statusOptions = (item: AgencyApplicationListItem) => <>
    <option value="new">Nuevo</option><option value="preselected">Preseleccionado</option><option value="selected">Seleccionado</option><option value="final_tenant">Inquilino final</option><option value="rejected">Descartado</option>{item.application.status === 'withdrawn' && <option value="withdrawn">Retirado</option>}
  </>
  return <>
    <div className="agency-applicant-table-wrap">
      <table className="agency-applicant-table">
        <thead><tr><th>Interesado</th><th>Solicitud</th><th>Perfil</th><th>Solvencia</th><th>Seguimiento</th><th>Teléfono</th><th>Estado</th><th><span className="agency-sr-only">Acciones</span></th></tr></thead>
        {segments.map((segment) => <tbody key={segment.status} className={`agency-segment agency-segment--${statusSlug(segment.label)}`}>
          <tr className="agency-segment__row"><th colSpan={8} scope="colgroup"><span className="agency-segment__title">{segment.label}<em>{segment.items.length}</em></span></th></tr>
          {segment.items.map((item, index) => {
            const data = remoteApplicantPresentation(item, property.property.monthlyRentCents)
            return <tr key={item.application.id}>
              <td><a className="agency-person" href={detailHref(item)}><span className={`agency-avatar agency-avatar--${index % 3}`}>{data.initials}</span><span><strong>{item.tenantName}</strong><small>{item.tenantEmail}</small>{item.possibleDuplicate && <em className="agency-duplicate-badge">Posible duplicado</em>}</span></a></td>
              <td><div className="agency-cell-stack"><strong className="agency-cell-strong">{item.application.submittedAt ? apiRelativeDateTime(item.application.submittedAt) : 'Sin enviar'}</strong><small>Entrada {data.moveIn}</small></div></td>
              <td><div className="agency-cell-stack"><strong className="agency-cell-strong">{data.employment}</strong><small>{data.contract} · {data.household}</small></div></td>
              <td><div className="agency-cell-stack"><strong className="agency-income">{data.income}</strong><small>{data.ratio}</small><StatusBadge status={documentStatusLabel[item.application.documentState]} /></div></td>
              <td><div className="agency-cell-stack"><StatusBadge status={data.viewing} />{data.viewingDate && <small className="agency-viewing-date">{data.viewingDate}</small>}</div></td>
              <td>{data.phone === 'Sin teléfono' ? <span className="agency-phone agency-phone--empty">Sin teléfono</span> : <a className="agency-phone" href={`tel:${data.phone.replace(/\s/g, '')}`}>{data.phone}</a>}</td>
              <td><label className="agency-inline-status"><span className="agency-sr-only">Cambiar estado de {item.tenantName}</span><select value={item.application.status} disabled={mutatingApplicationId === item.application.id || item.application.status === 'withdrawn'} onChange={(event) => onStatusChange(item, event.target.value as Exclude<AgencyApplicantDetailApi['application']['status'], 'withdrawn'>)}>{statusOptions(item)}</select><CaretDown size={13} /></label></td>
              <td><div className="agency-table-actions"><button className="agency-icon-button agency-icon-button--whatsapp" disabled={data.phone === 'Sin teléfono'} onClick={() => onWhatsApp(item)} aria-label={`Contactar a ${item.tenantName} por WhatsApp`}><WhatsappLogo size={18} weight="fill" /></button><button className="agency-icon-button agency-icon-button--border" onClick={() => onSchedule(item)} aria-label={`Agendar visita con ${item.tenantName}`}><CalendarBlank size={18} /></button><a className="agency-icon-button" href={detailHref(item)} aria-label={`Ver detalle de ${item.tenantName}`}><DotsThree size={20} weight="bold" /></a></div></td>
            </tr>
          })}
        </tbody>)}
      </table>
    </div>
    <div className="agency-applicant-cards">
      {segments.map((segment) => <section key={segment.status} className={`agency-segment-cards agency-segment--${statusSlug(segment.label)}`} aria-label={`${segment.label} (${segment.items.length})`}>
        <header className="agency-segment__heading"><span className="agency-segment__title">{segment.label}<em>{segment.items.length}</em></span></header>
        {segment.items.map((item, index) => {
          const data = remoteApplicantPresentation(item, property.property.monthlyRentCents)
          return <article className="agency-applicant-card" key={item.application.id}>
            <a className="agency-person" href={detailHref(item)}><span className={`agency-avatar agency-avatar--${index % 3}`}>{data.initials}</span><span><strong>{item.tenantName}</strong><small>{item.tenantEmail}</small><em>{data.phone}</em>{item.possibleDuplicate && <b className="agency-duplicate-badge">Posible duplicado</b>}</span><ArrowRight size={17} /></a>
            <div className="agency-applicant-card__statuses"><StatusBadge status={documentStatusLabel[item.application.documentState]} /><StatusBadge status={data.viewing} /></div>
            <dl><div><dt>Solicitud</dt><dd>{item.application.submittedAt ? apiRelativeDateTime(item.application.submittedAt) : 'Sin enviar'}<small>Entrada {data.moveIn}</small></dd></div><div><dt>Perfil</dt><dd>{data.employment}<small>{data.contract} · {data.household}</small></dd></div><div><dt>Ingresos</dt><dd>{data.income}<small>{data.ratio}</small></dd></div><div><dt>Seguimiento</dt><dd>{data.viewing}<small>{data.viewingDate ?? 'Sin fecha'}</small></dd></div></dl>
            <label className="agency-card-status"><span>Responsable <strong>{data.assignee}</strong></span><span>Estado <select value={item.application.status} disabled={mutatingApplicationId === item.application.id || item.application.status === 'withdrawn'} onChange={(event) => onStatusChange(item, event.target.value as Exclude<AgencyApplicantDetailApi['application']['status'], 'withdrawn'>)}>{statusOptions(item)}</select></span></label>
            <div className="agency-applicant-card__actions"><button className="agency-button agency-button--secondary" disabled={data.phone === 'Sin teléfono'} onClick={() => onWhatsApp(item)}><WhatsappLogo size={18} weight="fill" />WhatsApp</button><button className="agency-button agency-button--primary" onClick={() => onSchedule(item)}><CalendarBlank size={18} />Agendar</button></div>
          </article>
        })}
      </section>)}
    </div>
  </>
}

function RemoteAppointmentModal({ item, property, teamMembers, billingPlan, busy, onClose, onSubmit }: { item: AgencyApplicationListItem; property: AgencyPropertyApi; teamMembers: AgencyTeamMember[]; billingPlan: BillingPlanCode | null; busy: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const modalRef = useRef<HTMLElement>(null)
  const [startsAt, setStartsAt] = useState(defaultRemoteAppointmentLocal)
  useDialogAccessibility(modalRef, onClose)
  const workerPickerHidden = hideWorkerPicker(teamMembers, billingPlan)
  const autoAssignedUserId = teamMembers.length === 1 ? teamMembers[0].userId : ''
  return <div className="agency-overlay agency-overlay--center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="agency-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="remote-appointment-title">
      <header><div><p className="agency-eyebrow">NUEVA CITA</p><h2 id="remote-appointment-title">Agendar visita</h2><p>Con {item.tenantName} para {property.property.internalReference}</p></div><button className="agency-icon-button" disabled={busy} onClick={onClose} aria-label="Cerrar"><X size={21} /></button></header>
      <form onSubmit={onSubmit}>
        <div className="agency-modal__context"><CalendarBlank size={21} /><span><strong>{property.property.title}</strong><small>{property.property.address ? `${property.property.address}, ` : ''}{property.property.city}</small></span></div>
        <div className="agency-form-grid"><label><span>Fecha y hora</span><input name="startsAt" type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>{workerPickerHidden ? <input type="hidden" name="responsibleUserId" value={autoAssignedUserId} /> : <label><span>Trabajador asociado</span><select name="responsibleUserId" defaultValue=""><option value="">Indefinido</option>{teamMembers.map((member) => <option key={member.userId} value={member.userId}>{member.fullName}</option>)}</select></label>}</div>
        <label className="agency-form-field"><span>Dirección o instrucciones</span><input name="instructions" defaultValue={`${property.property.address ?? ''}${property.property.address ? ', ' : ''}${property.property.city}`} /></label>
        <label className="agency-form-field"><span>Nota interna <small>Opcional</small></span><textarea name="internalNote" rows={3} placeholder="Añade una indicación para el equipo" /></label>
        <footer><button type="button" className="agency-button agency-button--secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="agency-button agency-button--primary" type="submit" disabled={busy}><Check size={18} weight="bold" />{busy ? 'Guardando...' : 'Confirmar visita'}</button></footer>
      </form>
    </section>
  </div>
}

type KanbanCard<S extends string> = { key: string; column: S; draggable: boolean; staticReason?: string; focused?: boolean; domId?: string; content: ReactNode }
type KanbanColumn<S extends string> = { id: S; label: string; headerAction?: ReactNode }

function KanbanBoard<S extends string>({ columns, cards, onMove, boardLabel }: { columns: Array<KanbanColumn<S>>; cards: Array<KanbanCard<S>>; onMove: (key: string, target: S) => void; boardLabel: string }) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<S | null>(null)
  // The key travels in a ref: reading state inside dragover would miss the deferred update below,
  // and Chrome cancels a native drag when React mutates the board synchronously inside dragstart.
  const draggingKeyRef = useRef<string | null>(null)
  const draggingCard = cards.find((card) => card.key === draggingKey) ?? null
  const endDrag = () => {
    draggingKeyRef.current = null
    setDraggingKey(null)
    setDropTarget(null)
  }
  return <div className="agency-kanban" role="group" aria-label={boardLabel} style={{ '--agency-kanban-columns': columns.length } as CSSProperties}>
    {columns.map((column) => {
      const items = cards.filter((card) => card.column === column.id)
      const isTarget = dropTarget === column.id && draggingCard !== null && draggingCard.column !== column.id
      return <section
        key={column.id}
        className={`agency-kanban__column${isTarget ? ' agency-kanban__column--over' : ''}`}
        aria-label={`${column.label} (${items.length})`}
        onDragEnter={(event) => { if (draggingKeyRef.current) event.preventDefault() }}
        onDragOver={(event) => { if (!draggingKeyRef.current) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (dropTarget !== column.id) setDropTarget(column.id) }}
        onDragLeave={(event) => { if (event.currentTarget.contains(event.relatedTarget as Node | null)) return; setDropTarget((current) => current === column.id ? null : current) }}
        onDrop={(event) => {
          event.preventDefault()
          const key = event.dataTransfer.getData('text/plain') || draggingKeyRef.current
          endDrag()
          if (!key) return
          const card = cards.find((candidate) => candidate.key === key)
          if (card && card.draggable && card.column !== column.id) onMove(key, column.id)
        }}
      >
        <header><h2>{column.label}</h2><div className="agency-kanban__column-tools">{column.headerAction}<span>{items.length}</span></div></header>
        <div className="agency-kanban__cards">
          {items.map((card) => <article
            key={card.key}
            id={card.domId}
            tabIndex={-1}
            draggable={card.draggable}
            aria-grabbed={draggingKey === card.key}
            title={card.draggable ? undefined : card.staticReason}
            className={`agency-kanban-card${draggingKey === card.key ? ' agency-kanban-card--dragging' : ''}${card.focused ? ' agency-kanban-card--focused' : ''}${card.draggable ? '' : ' agency-kanban-card--static'}`}
            onDragStart={(event) => {
              // setData is mandatory for the drag to start in Firefox and Safari.
              event.dataTransfer.setData('text/plain', card.key)
              event.dataTransfer.effectAllowed = 'move'
              draggingKeyRef.current = card.key
              // Deferred on purpose: re-rendering the card during dragstart makes Chrome abort the drag immediately.
              window.setTimeout(() => { if (draggingKeyRef.current === card.key) setDraggingKey(card.key) }, 0)
            }}
            onDragEnd={endDrag}
          >
            {card.content}
            {card.draggable && <label className="agency-kanban-card__move" draggable={false} onMouseDown={(event) => event.stopPropagation()}>
              <span className="agency-sr-only">Mover la cita a otra columna</span>
              <select
                value=""
                onChange={(event) => {
                  const target = event.target.value as S
                  if (target && target !== card.column) onMove(card.key, target)
                }}
              >
                <option value="" disabled>Mover a…</option>
                {columns.filter((candidate) => candidate.id !== card.column).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
              </select>
              <CaretDown size={11} aria-hidden="true" />
            </label>}
          </article>)}
          {!items.length && <div className="agency-kanban__empty">{isTarget ? 'Suelta aquí la cita' : 'Sin citas'}</div>}
        </div>
      </section>
    })}
  </div>
}

function KanbanApplicant({ name, children }: { name: string; children?: ReactNode }) {
  return <div className="agency-kanban-card__person">
    <span className="agency-avatar agency-kanban-card__person-avatar" aria-hidden="true">{applicantInitials(name)}</span>
    <div className="agency-kanban-card__person-copy"><h3>{name}</h3>{children}</div>
  </div>
}

function WorkerAvatarStack({ names }: { names: string[] }) {
  if (!names.length) return <small className="agency-kanban-card__unassigned">Sin asignar</small>
  return <>
    <span className="agency-avatar-stack">{names.map((name, index) => <span key={name} className={`agency-avatar agency-avatar--${index % 3}`} title={name}>{applicantInitials(name)}</span>)}</span>
    <small>{names.length === 1 ? names[0] : `${names.length} trabajadores`}</small>
  </>
}

const remoteKanbanColumns: Array<{ id: AgencyAppointmentApi['state']; label: string }> = [
  { id: 'scheduled', label: 'Programada' },
  { id: 'completed', label: 'Completada' },
  { id: 'cancelled', label: 'Cancelada' },
  { id: 'no_show', label: 'No se presentó' },
]

function AuthenticatedAppointmentsView() {
  const [records, setRecords] = useState<AgencyAppointmentApi[]>([])
  const [paginations, setPaginations] = useState<{ upcoming: PaginationMetadata | null; past: PaginationMetadata | null }>({ upcoming: null, past: null })
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadState, setLoadState] = useState<RemoteLoadState>('loading')
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [mutatingId, setMutatingId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [tab, setTab] = useState<'activas' | 'archivadas'>('activas')
  const [archivedRecords, setArchivedRecords] = useState<AgencyAppointmentApi[]>([])
  const [archivedPagination, setArchivedPagination] = useState<PaginationMetadata | null>(null)
  const [archivedLoadState, setArchivedLoadState] = useState<RemoteLoadState>('loading')
  const [archivedError, setArchivedError] = useState('')
  const [archivedReloadKey, setArchivedReloadKey] = useState(0)
  const [archivingColumn, setArchivingColumn] = useState<AgencyAppointmentApi['state'] | null>(null)
  const fetchScopePage = async (scope: 'upcoming' | 'past', page: number, signal?: AbortSignal) => {
    const response = await fetch(`/api/v1/agency/appointments?scope=${scope}&archived=false&page=${page}&pageSize=50`, { credentials: 'include', headers: { Accept: 'application/json' }, signal })
    if (!response.ok) throw new Error(await agencyResponseError(response))
    const payload = await response.json() as { data?: { appointments?: AgencyAppointmentApi[]; pagination?: PaginationMetadata } }
    return { appointments: payload.data?.appointments ?? [], pagination: payload.data?.pagination ?? null }
  }
  const fetchArchivedPage = async (page: number, signal?: AbortSignal) => {
    const response = await fetch(`/api/v1/agency/appointments?archived=true&page=${page}&pageSize=50`, { credentials: 'include', headers: { Accept: 'application/json' }, signal })
    if (!response.ok) throw new Error(await agencyResponseError(response))
    const payload = await response.json() as { data?: { appointments?: AgencyAppointmentApi[]; pagination?: PaginationMetadata } }
    return { appointments: payload.data?.appointments ?? [], pagination: payload.data?.pagination ?? null }
  }
  const mergeRecords = (base: AgencyAppointmentApi[], incoming: AgencyAppointmentApi[]) => {
    const seen = new Set(base.map((record) => record.id))
    return [...base, ...incoming.filter((record) => !seen.has(record.id))]
  }
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoadingMore(false)
      setLoadState('loading')
      setError('')
      setActionError('')
      try {
        const [upcoming, past] = await Promise.all([fetchScopePage('upcoming', 1, controller.signal), fetchScopePage('past', 1, controller.signal)])
        setRecords(mergeRecords(upcoming.appointments, past.appointments))
        setPaginations({ upcoming: upcoming.pagination, past: past.pagination })
        setLoadState('loaded')
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'No hemos podido cargar las citas.')
        setLoadState('error')
      }
    }
    void load()
    return () => controller.abort()
  }, [reloadKey])
  useEffect(() => {
    if (tab !== 'archivadas') return
    const controller = new AbortController()
    const load = async () => {
      setArchivedLoadState('loading')
      setArchivedError('')
      try {
        const result = await fetchArchivedPage(1, controller.signal)
        setArchivedRecords(result.appointments)
        setArchivedPagination(result.pagination)
        setArchivedLoadState('loaded')
      } catch (caught) {
        if (controller.signal.aborted) return
        setArchivedError(caught instanceof Error ? caught.message : 'No hemos podido cargar las citas archivadas.')
        setArchivedLoadState('error')
      }
    }
    void load()
    return () => controller.abort()
  }, [tab, archivedReloadKey])
  const hasMore = Boolean(paginations.upcoming?.hasMore || paginations.past?.hasMore)
  const loadMore = async () => {
    if (!hasMore || loadingMore) return
    setLoadingMore(true); setActionError('')
    try {
      const scopes = (['upcoming', 'past'] as const).filter((scope) => paginations[scope]?.hasMore)
      const results = await Promise.all(scopes.map((scope) => fetchScopePage(scope, (paginations[scope]?.page ?? 1) + 1)))
      setRecords((current) => results.reduce((merged, result) => mergeRecords(merged, result.appointments), current))
      setPaginations((current) => scopes.reduce((next, scope, index) => ({ ...next, [scope]: results[index].pagination }), current))
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'No hemos podido cargar más citas.')
    } finally {
      setLoadingMore(false)
    }
  }
  const moveAppointment = async (id: string, target: AgencyAppointmentApi['state']) => {
    const record = records.find((candidate) => candidate.id === id)
    if (!record || mutatingId || record.state !== 'scheduled' || target === 'scheduled') return
    const action = target === 'completed' ? 'complete' : target === 'cancelled' ? 'cancel' : 'no_show'
    setMutatingId(id)
    setActionError('')
    try {
      const response = await fetch(`/api/v1/agency/appointments/${encodeURIComponent(id)}`, { method: 'PATCH', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, expectedUpdatedAt: record.updatedAt }) })
      if (!response.ok) {
        const message = await agencyResponseError(response)
        if (response.status === 409) setReloadKey((key) => key + 1)
        throw new Error(message)
      }
      const payload = await response.json() as { data?: { appointment?: Partial<AgencyAppointmentApi> } }
      if (!payload.data?.appointment) throw new Error('No hemos podido confirmar el cambio de la cita.')
      setRecords((current) => current.map((candidate) => candidate.id === id ? { ...candidate, ...payload.data!.appointment! } : candidate))
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'No hemos podido actualizar la cita.')
    } finally {
      setMutatingId(null)
    }
  }
  const archiveColumn = async (state: AgencyAppointmentApi['state']) => {
    if (archivingColumn || mutatingId) return
    const targets = records.filter((record) => record.state === state && !record.archivedAt)
    if (!targets.length) return
    setArchivingColumn(state)
    setActionError('')
    try {
      for (const record of targets) {
        const response = await fetch(`/api/v1/agency/appointments/${encodeURIComponent(record.id)}`, { method: 'PATCH', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive', expectedUpdatedAt: record.updatedAt }) })
        if (!response.ok) throw new Error(await agencyResponseError(response))
      }
      setRecords((current) => current.filter((record) => !targets.some((target) => target.id === record.id)))
      setArchivedReloadKey((key) => key + 1)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'No hemos podido archivar las citas.')
      setReloadKey((key) => key + 1)
    } finally {
      setArchivingColumn(null)
    }
  }
  const unarchiveAppointment = async (record: AgencyAppointmentApi) => {
    if (mutatingId) return
    setMutatingId(record.id)
    setActionError('')
    try {
      const response = await fetch(`/api/v1/agency/appointments/${encodeURIComponent(record.id)}`, { method: 'PATCH', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unarchive', expectedUpdatedAt: record.updatedAt }) })
      if (!response.ok) {
        const message = await agencyResponseError(response)
        if (response.status === 409) setArchivedReloadKey((key) => key + 1)
        throw new Error(message)
      }
      setArchivedRecords((current) => current.filter((candidate) => candidate.id !== record.id))
      setReloadKey((key) => key + 1)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'No hemos podido restaurar la cita.')
    } finally {
      setMutatingId(null)
    }
  }
  const sorted = [...records].sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
  const cards: Array<KanbanCard<AgencyAppointmentApi['state']>> = sorted.map((record) => ({
    key: record.id,
    column: record.state,
    draggable: record.state === 'scheduled' && mutatingId !== record.id,
    staticReason: record.state === 'scheduled' ? undefined : 'Una cita completada, cancelada o no presentada ya no puede cambiar de estado; solo se puede archivar.',
    content: <>
      <div className="agency-kanban-card__when"><CalendarBlank size={14} />{apiRelativeDateTime(record.startsAt)}</div>
      <KanbanApplicant name={record.applicantName}>
        <a className="agency-kanban-card__property" draggable={false} href={record.href}>{record.propertyTitle}<ArrowRight size={13} /></a>
      </KanbanApplicant>
      <div className="agency-kanban-card__footer">
        <div className="agency-kanban-card__workers"><span className="agency-kanban-card__workers-label">Equipo</span><WorkerAvatarStack names={record.responsibleUserName ? [record.responsibleUserName] : []} /></div>
        {mutatingId === record.id && <small className="agency-kanban-card__saving">Guardando…</small>}
      </div>
    </>,
  }))
  const archivableStates: Array<AgencyAppointmentApi['state']> = ['completed', 'cancelled', 'no_show']
  const columns = remoteKanbanColumns.map((column) => ({
    ...column,
    headerAction: archivableStates.includes(column.id) && cards.some((card) => card.column === column.id)
      ? <button className="agency-kanban__archive-all" type="button" disabled={archivingColumn !== null} onClick={() => void archiveColumn(column.id)} title={`Archivar todas las citas de ${column.label.toLowerCase()}`}>{archivingColumn === column.id ? 'Archivando…' : 'Archivar todas'}</button>
      : undefined,
  }))
  const sortedArchived = [...archivedRecords].sort((left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime())
  return <section className="agency-view"><PageHeading eyebrow="AGENDA DEL EQUIPO" title="Citas" description="Arrastra cada cita programada a su nueva columna para actualizar su estado." />
    <div className="agency-citas-tabs" role="tablist" aria-label="Vistas de citas">
      <button role="tab" aria-selected={tab === 'activas'} className={tab === 'activas' ? 'is-active' : ''} onClick={() => setTab('activas')}>Activas</button>
      <button role="tab" aria-selected={tab === 'archivadas'} className={tab === 'archivadas' ? 'is-active' : ''} onClick={() => setTab('archivadas')}>Archivadas</button>
    </div>
    {actionError && <p className="agency-inline-error" role="alert">{actionError}</p>}
    {tab === 'activas' && (loadState === 'loading' ? <DashboardLoadMessage message="Cargando citas..." /> : loadState === 'error' ? <DashboardLoadMessage message={error} error loginRequired={isSessionError(error)} onRetry={() => setReloadKey((key) => key + 1)} /> : <>
      <KanbanBoard columns={columns} cards={cards} onMove={(key, target) => void moveAppointment(key, target)} boardLabel="Tablero de citas por estado" />
      {hasMore && <button className="agency-button agency-button--secondary" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Cargando…' : 'Cargar más citas'}</button>}
    </>)}
    {tab === 'archivadas' && (archivedLoadState === 'loading' ? <DashboardLoadMessage message="Cargando citas archivadas..." /> : archivedLoadState === 'error' ? <DashboardLoadMessage message={archivedError} error loginRequired={isSessionError(archivedError)} onRetry={() => setArchivedReloadKey((key) => key + 1)} /> : sortedArchived.length ? <>
      <div className="agency-kanban-archive" aria-label="Citas archivadas">
        {sortedArchived.map((record) => <article className="agency-kanban-card agency-kanban-card--static" key={record.id}>
          <div className="agency-kanban-card__archive-top">
            <StatusBadge status={appointmentStateCopy(record.state) as Appointment['status']} />
            <button className="agency-text-button" type="button" disabled={mutatingId === record.id} onClick={() => void unarchiveAppointment(record)}>{mutatingId === record.id ? 'Restaurando…' : 'Restaurar'}</button>
          </div>
          <div className="agency-kanban-card__when"><CalendarBlank size={14} />{apiRelativeDateTime(record.startsAt)}</div>
          <KanbanApplicant name={record.applicantName}>
            <a className="agency-kanban-card__property" draggable={false} href={record.href}>{record.propertyTitle}<ArrowRight size={13} /></a>
          </KanbanApplicant>
          <div className="agency-kanban-card__footer">
            <div className="agency-kanban-card__workers"><span className="agency-kanban-card__workers-label">Equipo</span><WorkerAvatarStack names={record.responsibleUserName ? [record.responsibleUserName] : []} /></div>
          </div>
        </article>)}
      </div>
      {archivedPagination?.hasMore && <button className="agency-button agency-button--secondary" type="button" onClick={() => void (async () => {
        try {
          const result = await fetchArchivedPage((archivedPagination?.page ?? 1) + 1)
          setArchivedRecords((current) => {
            const seen = new Set(current.map((record) => record.id))
            return [...current, ...result.appointments.filter((record) => !seen.has(record.id))]
          })
          setArchivedPagination(result.pagination)
        } catch (caught) {
          setActionError(caught instanceof Error ? caught.message : 'No hemos podido cargar más citas archivadas.')
        }
      })()}>Cargar más citas archivadas</button>}
    </> : <div className="agency-kanban__empty agency-kanban__empty--archive">Aún no hay citas archivadas. Archiva columnas completas desde el tablero.</div>)}
  </section>
}

function PropertiesView({ filteredProperties, query, status, onlyWithNewApplicants, copiedPropertyId, onQuery, onStatus, onClearNewApplicants, onOpen, onCopy, onNew, onEdit }: { filteredProperties: Property[]; query: string; status: 'Todos' | PropertyStatus; onlyWithNewApplicants: boolean; copiedPropertyId: number | null; onQuery: (value: string) => void; onStatus: (value: 'Todos' | PropertyStatus) => void; onClearNewApplicants: () => void; onOpen: (id: number) => void; onCopy: (property: Property) => void; onNew: () => void; onEdit: (id: number) => void }) {
  return (
    <section className="agency-view">
      <PageHeading eyebrow="ANUNCIOS DE LA AGENCIA" title="Mis anuncios" description="Gestiona cada inmueble y a todas las personas interesadas desde un mismo lugar." actions={<button className="agency-button agency-button--primary" onClick={onNew}><Plus size={18} weight="bold" />Nuevo anuncio</button>} />
      <div className="agency-toolbar">
        <label className="agency-search"><MagnifyingGlass size={18} /><span className="agency-sr-only">Buscar anuncios</span><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Buscar por título, dirección o referencia" /></label>
        <label className="agency-select"><SlidersHorizontal size={17} /><span className="agency-sr-only">Filtrar por estado</span><select value={status} onChange={(event) => onStatus(event.target.value as 'Todos' | PropertyStatus)}><option>Todos</option><option>Publicado</option><option>Borrador</option><option>Pausado</option><option>Archivado</option></select><CaretDown size={14} /></label>
      </div>
      {onlyWithNewApplicants && <div className="agency-filter-summary"><Funnel size={15} /><span>Anuncios con interesados nuevos en los últimos 30 días</span><button onClick={onClearNewApplicants}>Quitar filtro <X size={13} /></button></div>}
      {filteredProperties.length ? (
        <div className="agency-property-list">
          {filteredProperties.map((property) => (
            <article className="agency-property-row" key={property.id}>
              <PropertyVisual property={property} />
              <div className="agency-property-row__identity"><small>{property.reference}</small><button className="agency-property-row__title" onClick={() => onOpen(property.id)}>{property.title}</button><em><MapPin size={14} />{property.address}, {property.city}</em></div>
              <div className="agency-property-row__price"><strong>{formatMoney(property.rent)}</strong><small>al mes · {property.rooms} hab.</small></div>
              <div className="agency-property-row__interest"><strong>{property.applicants}</strong><small>interesados</small>{property.newApplicants > 0 && <span>{property.newApplicants} nuevos</span>}</div>
              <div className="agency-property-row__next"><small>Próxima visita</small><strong>{property.nextViewing ?? 'Sin visitas'}</strong></div>
              <StatusBadge status={property.status} />
              <div className="agency-row-actions"><button className="agency-icon-button agency-icon-button--border" disabled={property.status !== 'Publicado'} title={property.status === 'Publicado' ? 'Copiar enlace público' : 'Publica el anuncio para generar un enlace'} onClick={() => onCopy(property)} aria-label={`Copiar enlace de ${property.title}`}>{copiedPropertyId === property.id ? <Check size={18} weight="bold" /> : <LinkSimple size={18} />}</button><button className="agency-icon-button agency-icon-button--border" onClick={() => onEdit(property.id)} aria-label={`Editar ${property.title}`} title="Editar"><NotePencil size={18} /></button></div>
            </article>
          ))}
        </div>
      ) : <EmptyState title="No hay anuncios que coincidan" description="Prueba con otra búsqueda o elimina los filtros activos." onAction={() => { onQuery(''); onStatus('Todos'); onClearNewApplicants() }} action="Limpiar filtros" />}
    </section>
  )
}

function PropertyView({ property, applicants, applicantSearch, applicantStatus, documentStatus, viewingFilter, submittedFilter, assigneeFilter, sort, copied, hasFilters, onBack, onCopy, onSearch, onStatusFilter, onDocumentFilter, onViewingFilter, onSubmittedFilter, onAssigneeFilter, onSort, onClear, onStatusChange, onOpenApplicant, onSchedule, onWhatsapp, onEditProperty }: {
  property: Property; applicants: Applicant[]; applicantSearch: string; applicantStatus: 'Todos' | ApplicantStatus; documentStatus: 'Todos' | DocumentStatus; viewingFilter: 'Todas' | ViewingStatus; submittedFilter: 'Cualquier fecha' | 'Hoy' | 'Últimos 7 días'; assigneeFilter: string; sort: string; copied: boolean; hasFilters: boolean; onBack: () => void; onCopy: () => void; onSearch: (value: string) => void; onStatusFilter: (value: 'Todos' | ApplicantStatus) => void; onDocumentFilter: (value: 'Todos' | DocumentStatus) => void; onViewingFilter: (value: 'Todas' | ViewingStatus) => void; onSubmittedFilter: (value: 'Cualquier fecha' | 'Hoy' | 'Últimos 7 días') => void; onAssigneeFilter: (value: string) => void; onSort: (value: string) => void; onClear: () => void; onStatusChange: (id: number, status: ApplicantStatus) => void; onOpenApplicant: (id: number) => void; onSchedule: (id: number) => void; onWhatsapp: (id: number) => void; onEditProperty: () => void
}) {
  return (
    <section className="agency-view agency-property-detail">
      <button className="agency-back" onClick={onBack}><ArrowLeft size={17} />Mis anuncios</button>
      <header className="agency-property-header">
        <PropertyVisual property={property} />
        <div className="agency-property-header__identity"><div><span>{property.reference}</span><StatusBadge status={property.status} /></div><h1>{property.title}</h1><p><MapPin size={15} />{property.address}, {property.city} · {formatMoney(property.rent)} / mes</p></div>
        <div className="agency-property-header__stats"><span><strong>{property.applicants}</strong><small>interesados</small></span><span><strong>{property.newApplicants}</strong><small>nuevos</small></span><span><strong>5</strong><small>por revisar</small></span></div>
        <div className="agency-property-header__actions"><button className="agency-icon-button agency-icon-button--border" onClick={onEditProperty} aria-label="Editar anuncio"><NotePencil size={18} /></button><button className="agency-button agency-button--secondary" disabled={property.status !== 'Publicado'} onClick={onCopy}>{copied ? <Check size={18} weight="bold" /> : <Copy size={18} />}{copied ? 'Copiado' : property.status === 'Publicado' ? 'Copiar enlace' : 'Enlace no disponible'}</button>{property.status === 'Publicado' && <a className="agency-button agency-button--primary" href={property.publicUrl} target="_blank" rel="noreferrer"><LinkSimple size={18} />Abrir enlace</a>}</div>
      </header>
      <div className="agency-section-heading"><div><h2>Interesados</h2><p>{applicants.length} resultados visibles</p></div><button className="agency-button agency-button--secondary agency-button--compact"><DownloadSimple size={17} />Exportar</button></div>
      <div className="agency-applicant-toolbar">
        <label className="agency-search agency-search--applicants"><MagnifyingGlass size={18} /><span className="agency-sr-only">Buscar interesados</span><input value={applicantSearch} onChange={(event) => onSearch(event.target.value)} placeholder="Nombre, correo o teléfono" /></label>
        <FilterSelect label="Estado" value={applicantStatus} onChange={(value) => onStatusFilter(value as 'Todos' | ApplicantStatus)} options={['Todos', ...statuses]} />
        <FilterSelect label="Documentación" value={documentStatus} onChange={(value) => onDocumentFilter(value as 'Todos' | DocumentStatus)} options={['Todos', 'Completa', 'Faltan documentos', 'Sin solicitar']} />
        <FilterSelect label="Visita" value={viewingFilter} onChange={(value) => onViewingFilter(value as 'Todas' | ViewingStatus)} options={['Todas', 'Sin visita', 'Por confirmar', 'Agendada', 'Realizada']} />
        <FilterSelect label="Fecha" value={submittedFilter} onChange={(value) => onSubmittedFilter(value as 'Cualquier fecha' | 'Hoy' | 'Últimos 7 días')} options={['Cualquier fecha', 'Hoy', 'Últimos 7 días']} />
        <FilterSelect label="Responsable" value={assigneeFilter} onChange={onAssigneeFilter} options={['Todos', 'Marta', 'Diego', 'Carlos', 'Sin asignar']} />
        <FilterSelect label="Ordenar" value={sort} onChange={onSort} options={['Más recientes', 'Más antiguos', 'Mayor ingreso', 'Menor ingreso', 'Estado', 'Próxima visita']} sort />
      </div>
      {hasFilters && <div className="agency-filter-summary"><Funnel size={15} /><span>Filtros activos</span><button onClick={onClear}>Quitar todos <X size={13} /></button></div>}
      {applicants.length ? <ApplicantTable applicants={applicants} rent={property.rent} onStatusChange={onStatusChange} onOpenApplicant={onOpenApplicant} onSchedule={onSchedule} onWhatsapp={onWhatsapp} property={property} /> : <EmptyState title="Ningún interesado coincide" description="Cambia la búsqueda o quita los filtros para volver a ver todas las solicitudes." action="Quitar filtros" onAction={onClear} />}
    </section>
  )
}

function FilterSelect({ label, value, options, optionLabels = {}, onChange, sort = false }: { label: string; value: string; options: string[]; optionLabels?: Record<string, string>; onChange: (value: string) => void; sort?: boolean }) {
  const defaultValues = ['Todos', 'Todas', 'Cualquier fecha', 'all']
  return <label className={`agency-filter-select ${!defaultValues.includes(value) && !sort ? 'agency-filter-select--active' : ''}`}>
    {sort ? <List size={16} /> : <Funnel size={15} />}
    <span className="agency-filter-select__field">
      <span className="agency-filter-select__label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{optionLabels[option] ?? option}</option>)}</select>
    </span>
    <CaretDown size={13} />
  </label>
}

function ApplicantTable({ applicants, rent: _rent, onStatusChange, onOpenApplicant, onSchedule, onWhatsapp, property }: { applicants: Applicant[]; rent: number; onStatusChange: (id: number, status: ApplicantStatus) => void; onOpenApplicant: (id: number) => void; onSchedule: (id: number) => void; onWhatsapp: (id: number) => void; property: Property }) {
  const whatsappUrl = (applicant: Applicant) => `https://wa.me/${applicant.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, ${applicant.name.split(' ')[0]}. Soy Marta de Casa Barrio. Te contacto por tu interés en el inmueble ${property.reference}.`)}`
  const segments = statuses
    .map((status) => ({ status, items: applicants.filter((applicant) => applicant.status === status) }))
    .filter((segment) => segment.items.length > 0)
  return (
    <>
      <div className="agency-applicant-table-wrap">
        <table className="agency-applicant-table">
          <thead><tr><th>Interesado</th><th>Solicitud</th><th>Perfil</th><th>Solvencia</th><th>Seguimiento</th><th>Teléfono</th><th>Estado</th><th><span className="agency-sr-only">Acciones</span></th></tr></thead>
          {segments.map((segment) => (
            <tbody key={segment.status} className={`agency-segment agency-segment--${statusSlug(segment.status)}`}>
              <tr className="agency-segment__row"><th colSpan={8} scope="colgroup"><span className="agency-segment__title">{segment.status}<em>{segment.items.length}</em></span></th></tr>
              {segment.items.map((applicant) => (
                <tr key={applicant.id}>
                  <td><button className="agency-person" onClick={() => onOpenApplicant(applicant.id)}><span className={`agency-avatar agency-avatar--${applicant.id % 3}`}>{applicant.initials}</span><span><strong>{applicant.name}</strong><small>{applicant.email}</small></span></button></td>
                  <td><div className="agency-cell-stack"><strong className="agency-cell-strong">{applicant.submitted}</strong><small>Entrada {applicant.moveIn}</small></div></td>
                  <td><div className="agency-cell-stack"><strong className="agency-cell-strong">{applicant.employment}</strong><small>{applicant.contract} · {applicant.household}</small></div></td>
                  <td><div className="agency-cell-stack"><strong className="agency-income">{applicant.income ? formatMoney(applicant.income) : 'Con avalista'}</strong><small>{applicant.ratio ? `${applicant.ratio}% del ingreso` : 'Sin ratio disponible'}</small><StatusBadge status={applicant.documents} /></div></td>
                  <td><div className="agency-cell-stack"><StatusBadge status={applicant.viewing} />{applicant.viewingDate && <small className="agency-viewing-date">{applicant.viewingDate}</small>}</div></td>
                  <td><a className="agency-phone" href={`tel:${applicant.phone}`}>{formatPhoneDisplay(applicant.phone)}</a></td>
                  <td><label className="agency-inline-status"><span className="agency-sr-only">Cambiar estado de {applicant.name}</span><select value={applicant.status} onChange={(event) => onStatusChange(applicant.id, event.target.value as ApplicantStatus)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select><CaretDown size={13} /></label></td>
                  <td><div className="agency-table-actions"><a className="agency-icon-button agency-icon-button--whatsapp" href={whatsappUrl(applicant)} target="_blank" rel="noreferrer" onClick={() => onWhatsapp(applicant.id)} aria-label={`Contactar a ${applicant.name} por WhatsApp`}><WhatsappLogo size={18} weight="fill" /></a><button className="agency-icon-button agency-icon-button--border" onClick={() => onSchedule(applicant.id)} aria-label={`Agendar visita con ${applicant.name}`}><CalendarBlank size={18} /></button><button className="agency-icon-button" onClick={() => onOpenApplicant(applicant.id)} aria-label={`Ver detalle de ${applicant.name}`}><DotsThree size={20} weight="bold" /></button></div></td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <div className="agency-applicant-cards">
        {segments.map((segment) => (
          <section key={segment.status} className={`agency-segment-cards agency-segment--${statusSlug(segment.status)}`} aria-label={`${segment.status} (${segment.items.length})`}>
            <header className="agency-segment__heading"><span className="agency-segment__title">{segment.status}<em>{segment.items.length}</em></span></header>
            {segment.items.map((applicant) => (
              <article className="agency-applicant-card" key={applicant.id}>
                <button className="agency-person" onClick={() => onOpenApplicant(applicant.id)}><span className={`agency-avatar agency-avatar--${applicant.id % 3}`}>{applicant.initials}</span><span><strong>{applicant.name}</strong><small>{applicant.email}</small><em>{formatPhoneDisplay(applicant.phone)}</em></span><ArrowRight size={17} /></button>
                <div className="agency-applicant-card__statuses"><StatusBadge status={applicant.documents} /><StatusBadge status={applicant.viewing} /></div>
                <dl><div><dt>Solicitud</dt><dd>{applicant.submitted}<small>Entrada {applicant.moveIn}</small></dd></div><div><dt>Perfil</dt><dd>{applicant.employment}<small>{applicant.contract} · {applicant.household}</small></dd></div><div><dt>Ingresos</dt><dd>{applicant.income ? formatMoney(applicant.income) : 'Con avalista'}<small>{applicant.ratio ? `${applicant.ratio}% del ingreso` : 'Sin ratio'}</small></dd></div><div><dt>Seguimiento</dt><dd>{applicant.viewing}<small>{applicant.viewingDate ?? 'Sin fecha'}</small></dd></div></dl>
                <label className="agency-card-status"><span>Responsable <strong>{applicant.assignee}</strong></span><span>Estado <select value={applicant.status} onChange={(event) => onStatusChange(applicant.id, event.target.value as ApplicantStatus)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></span></label>
                <div className="agency-applicant-card__actions"><a className="agency-button agency-button--secondary" href={whatsappUrl(applicant)} target="_blank" rel="noreferrer" onClick={() => onWhatsapp(applicant.id)}><WhatsappLogo size={18} weight="fill" />WhatsApp</a><button className="agency-button agency-button--primary" onClick={() => onSchedule(applicant.id)}><CalendarBlank size={18} />Agendar</button></div>
              </article>
            ))}
          </section>
        ))}
      </div>
    </>
  )
}

function useDialogAccessibility(containerRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const container = containerRef.current
    const background = Array.from(document.querySelectorAll<HTMLElement>('.agency-shell, .agency-sidebar')).filter((element) => !container || !element.contains(container))
    background.forEach((element) => { element.inert = true })
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    container?.querySelector<HTMLElement>(focusableSelector)?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !container) return
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      background.forEach((element) => { element.inert = false })
      previousFocus?.focus()
    }
  }, [containerRef, onClose])
}

function ApplicantDrawer({ applicant, property, appointments, activities, onClose, onStatusChange, onSchedule, onWhatsapp, onSaveNote }: { applicant: Applicant; property: Property; appointments: Appointment[]; activities: ActivityEvent[]; onClose: () => void; onStatusChange: (id: number, status: ApplicantStatus) => void; onSchedule: () => void; onWhatsapp: () => void; onSaveNote: (note: string) => void }) {
  const whatsapp = `https://wa.me/${applicant.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, ${applicant.name.split(' ')[0]}. Soy Marta de Casa Barrio. Te contacto por tu interés en el inmueble ${property.reference}.`)}`
  const drawerRef = useRef<HTMLElement>(null)
  const [editingNote, setEditingNote] = useState(false)
  const [note, setNote] = useState(applicant.note)
  useDialogAccessibility(drawerRef, onClose)
  return (
    <div className="agency-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="agency-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="applicant-title">
        <header className="agency-drawer__header"><div><p className="agency-eyebrow">DETALLE DEL INTERESADO</p><h2 id="applicant-title">{applicant.name}</h2><p>{property.reference} · {property.title}</p></div><button className="agency-icon-button" onClick={onClose} aria-label="Cerrar detalle"><X size={21} /></button></header>
        <div className="agency-drawer__actionbar"><a className="agency-button agency-button--primary" href={whatsapp} target="_blank" rel="noreferrer" onClick={onWhatsapp}><WhatsappLogo size={18} weight="fill" />Contactar</a><button className="agency-button agency-button--secondary" onClick={onSchedule}><CalendarBlank size={18} />Agendar visita</button></div>
        <div className="agency-drawer__body">
          <section className="agency-detail-section agency-detail-summary"><div className="agency-person agency-person--static"><span className={`agency-avatar agency-avatar--${applicant.id % 3}`}>{applicant.initials}</span><span><strong>{applicant.email}</strong><small>{formatPhoneDisplay(applicant.phone)}</small></span></div><label><span>Estado actual</span><select value={applicant.status} onChange={(event) => onStatusChange(applicant.id, event.target.value as ApplicantStatus)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label></section>
          <section className="agency-detail-section"><h3>Solicitud</h3><dl className="agency-detail-grid"><div><dt>Enviada</dt><dd>{applicant.submitted}</dd></div><div><dt>Responsable</dt><dd>{applicant.assignee}</dd></div><div><dt>Contacto preferido</dt><dd>{applicant.preferredContact}</dd></div><div><dt>Hogar</dt><dd>{applicant.household}</dd></div><div><dt>Mascotas</dt><dd>{applicant.pets}</dd></div><div><dt>Entrada prevista</dt><dd>{applicant.moveIn}</dd></div><div><dt>Situación laboral</dt><dd>{applicant.employment}</dd></div><div><dt>Contrato</dt><dd>{applicant.contract}</dd></div><div><dt>Empresa o actividad</dt><dd>{applicant.employer}</dd></div><div><dt>Ingreso individual</dt><dd>{applicant.individualIncome ? formatMoney(applicant.individualIncome) : 'No indicado'}</dd></div><div><dt>Ingresos del hogar</dt><dd>{applicant.income ? formatMoney(applicant.income) : 'No indicado'}</dd></div><div><dt>Avalista</dt><dd>{applicant.guarantor}</dd></div><div><dt>Disponibilidad</dt><dd>{applicant.availability}</dd></div><div><dt>Mensaje</dt><dd>{applicant.message}</dd></div></dl><div className="agency-ratio-note"><ChartLineUp size={18} /><span><strong>Referencia del alquiler: {applicant.ratio || 'Sin dato'}{applicant.ratio ? '%' : ''}</strong><small>Dato informativo. No determina la idoneidad de la solicitud.</small></span></div></section>
          <section className="agency-detail-section"><div className="agency-detail-section__heading"><h3>Documentación</h3><StatusBadge status={applicant.documents} /></div>{applicant.documents === 'Sin solicitar' ? <p className="agency-inline-empty">No se solicitaron documentos para esta candidatura.</p> : <div className="agency-document-list"><button onClick={() => window.open('data:text/plain;charset=utf-8,Vista%20previa%20segura%20de%20nóminas', '_blank')}><FilePdf size={22} weight="duotone" /><span><strong>Nóminas_últimos_3_meses.pdf</strong><small>PDF · 1,8 MB · Abrir vista previa</small></span><DownloadSimple size={18} /></button>{applicant.documents === 'Completa' && <button onClick={() => window.open('data:text/plain;charset=utf-8,Vista%20previa%20segura%20del%20contrato', '_blank')}><FilePdf size={22} weight="duotone" /><span><strong>Contrato_laboral.pdf</strong><small>PDF · 740 KB · Abrir vista previa</small></span><DownloadSimple size={18} /></button>}</div>}</section>
          <section className="agency-detail-section"><div className="agency-detail-section__heading"><h3>Nota interna</h3><button className="agency-text-button" onClick={() => setEditingNote((current) => !current)}><NotePencil size={16} />{editingNote ? 'Cancelar' : 'Editar'}</button></div>{editingNote ? <div className="agency-note-editor"><label className="agency-sr-only" htmlFor="agency-note">Nota interna</label><textarea id="agency-note" value={note} onChange={(event) => setNote(event.target.value)} rows={4} /><button className="agency-button agency-button--primary agency-button--compact" onClick={() => { onSaveNote(note); setEditingNote(false) }}>Guardar nota</button></div> : <blockquote>{applicant.note}</blockquote>}<p className="agency-note-meta">Marta Soler · Ahora</p></section>
          <section className="agency-detail-section"><h3>Visitas</h3>{appointments.length ? appointments.map((appointment) => <div className="agency-drawer-appointment" key={appointment.id}><CalendarBlank size={20} /><span><strong>{appointment.date} a las {appointment.time}</strong><small>{appointment.assignees.length ? appointment.assignees.join(', ') : 'Sin asignar'}</small></span><StatusBadge status={appointment.status} /></div>) : <div className="agency-inline-empty">No hay visitas para esta candidatura.</div>}</section>
          <section className="agency-detail-section"><h3>Actividad</h3><div className="agency-timeline">{activities.map((activity) => <div key={activity.id}><span /><p><strong>{activity.title}</strong><small>{activity.timestamp} · {activity.detail}</small></p></div>)}{!activities.some((activity) => activity.title === 'Solicitud recibida') && <div><span /><p><strong>Solicitud recibida</strong><small>{applicant.submitted} · Formulario web</small></p></div>}</div></section>
        </div>
      </aside>
    </div>
  )
}

function PropertyEditorModal({ property, suggestedReference, onClose, onSubmit }: { property?: Property; suggestedReference: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const modalRef = useRef<HTMLElement>(null)
  const [coverPreview, setCoverPreview] = useState(property?.coverImage ?? '')
  const [coverError, setCoverError] = useState('')
  useDialogAccessibility(modalRef, onClose)
  const selectCover = (file: File | undefined) => {
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setCoverError('Selecciona una imagen JPG o PNG.'); return }
    setCoverError('')
    const reader = new FileReader()
    reader.onerror = () => setCoverError('No hemos podido leer la imagen.')
    reader.onload = () => setCoverPreview(String(reader.result))
    reader.readAsDataURL(file)
  }
  return <div className="agency-overlay agency-overlay--center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="agency-modal agency-modal--property" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="property-editor-title">
      <header><div><p className="agency-eyebrow">{property ? 'EDITAR ANUNCIO' : 'NUEVO ANUNCIO'}</p><h2 id="property-editor-title">{property ? property.title : 'Añadir inmueble'}</h2><p>Completa la ficha que verá tu equipo y la información pública.</p></div><button className="agency-icon-button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button></header>
      <form onSubmit={onSubmit}>
        <div className="agency-form-grid"><label><span>Referencia interna</span><input name="reference" required defaultValue={property?.reference ?? suggestedReference} /></label><label><span>Estado</span><select name="status" defaultValue={property?.status ?? 'Borrador'}><option>Borrador</option><option>Publicado</option><option>Pausado</option><option>Archivado</option></select></label></div>
        <label className="agency-form-field"><span>Título público</span><input name="title" required defaultValue={property?.title ?? ''} placeholder="Piso luminoso en Chamberí" /></label>
        <div className="agency-form-grid agency-form-grid--three"><label><span>Dirección</span><input name="address" required defaultValue={property?.address ?? ''} /></label><label><span>Ciudad</span><input name="city" required defaultValue={property?.city ?? 'Madrid'} /></label><label><span>Provincia</span><input name="province" required defaultValue={property?.province ?? 'Madrid'} /></label><label><span>Código postal</span><input name="postalCode" required defaultValue={property?.postalCode ?? ''} inputMode="numeric" /></label><label><span>Tipo de inmueble</span><select name="type" defaultValue={property?.type ?? 'Piso'}><option>Piso</option><option>Ático</option><option>Estudio</option><option>Dúplex</option><option>Casa</option></select></label><label><span>Alquiler mensual</span><input name="rent" type="number" required min="1" defaultValue={property?.rent || ''} /></label><label><span>Habitaciones</span><input name="rooms" type="number" required min="0" defaultValue={property?.rooms ?? 1} /></label><label><span>Baños</span><input name="bathrooms" type="number" required min="1" defaultValue={property?.bathrooms ?? 1} /></label><label><span>Superficie en m²</span><input name="area" type="number" required min="1" defaultValue={property?.area ?? ''} /></label><label><span>Disponible desde</span><input name="available" type="date" required defaultValue={property?.available ?? '2026-09-01'} /></label><label><span>Responsable</span><select name="assignee" defaultValue={property?.assignee ?? 'Marta Soler'}><option>Marta Soler</option><option>Diego García</option></select></label></div>
        <label className="agency-form-field"><span>Descripción</span><textarea name="description" required rows={4} defaultValue={property?.description ?? ''} placeholder="Describe brevemente el inmueble y sus puntos clave." /></label>
        <fieldset className="agency-document-request"><legend>Documentación solicitada</legend><label><input type="checkbox" defaultChecked /> Nóminas recientes</label><label><input type="checkbox" defaultChecked /> Contrato laboral</label><label><input type="checkbox" /> Declaración de la renta (IRPF)</label><label><input type="checkbox" /> Vida laboral</label><label><input type="checkbox" /> Justificante de pensión</label><label><input type="checkbox" /> Documentación del avalista</label><label><input type="checkbox" /> Otros justificantes</label></fieldset>
        <div className="agency-cover-field">
          <span className="agency-cover-field__preview">{coverPreview ? <img src={coverPreview} alt="Vista previa de la portada" /> : <span className="agency-property-visual agency-property-visual--blue" aria-hidden="true"><HouseLine size={24} /></span>}</span>
          <div><strong>Imagen de portada</strong><small>JPG o PNG. {coverPreview ? 'Se guardará junto con el anuncio.' : 'Opcional: dale una cara a tu anuncio.'}</small>{coverError && <em className="agency-cover-field__error" role="alert">{coverError}</em>}</div>
          <label className="agency-button agency-button--secondary agency-button--compact agency-upload-field"><UploadSimple size={16} />{coverPreview ? 'Cambiar imagen' : 'Subir imagen'}<input type="file" accept="image/jpeg,image/png" onChange={(event) => { selectCover(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>
          <input type="hidden" name="coverImage" value={coverPreview} />
        </div>
        <footer><button type="button" className="agency-button agency-button--secondary" onClick={onClose}>Cancelar</button><button className="agency-button agency-button--primary" type="submit"><Check size={18} weight="bold" />Guardar anuncio</button></footer>
      </form>
    </section>
  </div>
}

function AuthenticatedPropertyEditorModal({ property, onClose, onSaved }: { property?: AgencyPropertyApi; onClose: () => void; onSaved: (property: AgencyPropertyApi, publicLink?: string) => void }) {
  const modalRef = useRef<HTMLElement>(null)
  const publishKeyRef = useRef(crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [persistedProperty, setPersistedProperty] = useState<AgencyPropertyApi['property'] | null>(property?.property ?? null)
  const coverImageUrl = property?.property.coverImageUrl ?? null
  const [cover, setCover] = useState<{ file: File; previewUrl: string } | null>(null)
  const coverRef = useRef<typeof cover>(null)
  coverRef.current = cover
  useEffect(() => () => { if (coverRef.current) URL.revokeObjectURL(coverRef.current.previewUrl) }, [])
  const selectCover = (file: File | undefined) => {
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setError('Selecciona una imagen JPG o PNG para la portada.'); return }
    setError('')
    setCover((current) => { if (current) URL.revokeObjectURL(current.previewUrl); return { file, previewUrl: URL.createObjectURL(file) } })
  }
  useDialogAccessibility(modalRef, onClose)
  const currentState = property?.property.state ?? 'draft'
  const loadCurrentRecord = async (propertyId: string) => {
    const response = await fetch(`/api/v1/agency/properties?propertyId=${encodeURIComponent(propertyId)}&pageSize=1`, { credentials: 'include', headers: { Accept: 'application/json' } })
    const payload = await response.json().catch(() => ({})) as { data?: { properties?: AgencyPropertyApi[] }; error?: { message?: string } }
    const record = payload.data?.properties?.find((item) => item.property.id === propertyId)
    if (!response.ok || !record) throw new Error(payload.error?.message ?? 'No hemos podido comprobar el estado actual del anuncio.')
    return record
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const desiredState = String(form.get('state')) as AgencyPropertyApi['property']['state']
    if (desiredState === 'archived' && currentState !== 'archived' && !window.confirm('Archivar revoca el enlace público y no se puede deshacer. ¿Quieres continuar?')) { setBusy(false); return }
    const body = {
      internalReference: String(form.get('internalReference')).trim(), title: String(form.get('title')).trim(),
      address: String(form.get('address')).trim(), city: String(form.get('city')).trim(), province: String(form.get('province')).trim(), postalCode: String(form.get('postalCode')).trim(),
      propertyType: String(form.get('propertyType')).trim(), bedrooms: Number(form.get('bedrooms')), bathrooms: Number(form.get('bathrooms')), floorAreaSqm: Number(form.get('floorAreaSqm')),
      availableFrom: String(form.get('availableFrom')), description: String(form.get('description')).trim(), publicLocation: String(form.get('publicLocation')).trim(),
      coverImageUrl, galleryUrls: property?.property.galleryUrls ?? [], monthlyRentCents: Math.round(Number(form.get('monthlyRent')) * 100), responsibleUserId: property?.property.responsibleUserId ?? null,
      requestedDocumentCategories: form.getAll('requestedDocumentCategories').map(String),
    }
    try {
      const response = await fetch(persistedProperty ? `/api/v1/agency/properties/${encodeURIComponent(persistedProperty.id)}` : '/api/v1/agency/properties', {
        method: persistedProperty ? 'PATCH' : 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...(persistedProperty ? { expectedVersion: persistedProperty.version } : {}) }),
      })
      const payload = await response.json().catch(() => ({})) as { data?: { property?: AgencyPropertyApi['property'] }; error?: { message?: string } }
      if (!response.ok || !payload.data?.property) throw new Error(payload.error?.message ?? 'No hemos podido guardar el anuncio.')
      let savedProperty = payload.data.property
      let reconciledRecord: AgencyPropertyApi | null = null
      setPersistedProperty(savedProperty)
      if (cover) {
        try {
          const uploaded = await uploadPropertyCoverImage(savedProperty.id, cover.file)
          savedProperty = { ...savedProperty, coverImageUrl: uploaded.coverImageUrl, version: uploaded.version }
          setPersistedProperty(savedProperty)
          setCover((current) => { if (current) URL.revokeObjectURL(current.previewUrl); return null })
        } catch (coverCaught) {
          throw new Error(coverCaught instanceof Error ? `El anuncio se ha guardado, pero la portada no se ha podido subir: ${coverCaught.message}` : 'El anuncio se ha guardado, pero no hemos podido subir la portada.')
        }
      }
      let publicLink: string | undefined
      if (desiredState !== savedProperty.state) {
        if (savedProperty.state === 'archived' || desiredState === 'draft') throw new Error('Este cambio de estado no está permitido.')
        const operation = desiredState === 'published' ? 'publish' : desiredState === 'paused' ? 'pause' : 'archive'
        try {
          const lifecycleResponse = await fetch(`/api/v1/agency/properties/${encodeURIComponent(savedProperty.id)}/${operation}`, {
            method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(operation === 'publish' ? { 'Idempotency-Key': publishKeyRef.current } : {}) }, body: JSON.stringify({ expectedVersion: savedProperty.version }),
          })
          const lifecyclePayload = await lifecycleResponse.json().catch(() => ({})) as { data?: { property?: AgencyPropertyApi['property']; publicLink?: string }; error?: { message?: string } }
          if (!lifecycleResponse.ok || !lifecyclePayload.data?.property) throw new Error(lifecyclePayload.error?.message ?? 'El anuncio se ha guardado, pero no hemos podido cambiar su estado.')
          savedProperty = lifecyclePayload.data.property
          setPersistedProperty(savedProperty)
          publicLink = lifecyclePayload.data.publicLink
        } catch (lifecycleError) {
          try {
            reconciledRecord = await loadCurrentRecord(savedProperty.id)
            savedProperty = reconciledRecord.property
            setPersistedProperty(savedProperty)
          } catch {
            throw lifecycleError
          }
          if (savedProperty.state !== desiredState) throw lifecycleError
        }
      }
      if (desiredState === 'published' && savedProperty.state === 'published' && !publicLink) {
        const linkResponse = await fetch(`/api/v1/agency/properties/${encodeURIComponent(savedProperty.id)}/public-link`, { credentials: 'include', headers: { Accept: 'application/json' } })
        const linkPayload = await linkResponse.json().catch(() => ({})) as { data?: { publicLink?: string }; error?: { message?: string } }
        if (!linkResponse.ok || !linkPayload.data?.publicLink) throw new Error(linkPayload.error?.message ?? 'El anuncio está publicado, pero no hemos podido recuperar su enlace.')
        publicLink = linkPayload.data.publicLink
      }
      onSaved(reconciledRecord ?? { property: savedProperty, applicantCount: property?.applicantCount ?? 0, newApplicantCount: property?.newApplicantCount ?? 0, recentNewApplicantCount: property?.recentNewApplicantCount ?? 0, nextViewing: property?.nextViewing ?? null }, publicLink)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No hemos podido guardar el anuncio.') } finally { setBusy(false) }
  }
  const stateOptions: Array<{ value: AgencyPropertyApi['property']['state']; label: string }> = currentState === 'archived'
    ? [{ value: 'archived', label: 'Archivado' }]
    : currentState === 'published'
      ? [{ value: 'published', label: 'Publicado' }, { value: 'paused', label: 'Pausado' }, { value: 'archived', label: 'Archivado' }]
      : currentState === 'paused'
        ? [{ value: 'paused', label: 'Pausado' }, { value: 'published', label: 'Publicado' }, { value: 'archived', label: 'Archivado' }]
        : [{ value: 'draft', label: 'Borrador' }, { value: 'published', label: 'Publicado' }, { value: 'archived', label: 'Archivado' }]
  return <div className="agency-overlay agency-overlay--center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="agency-modal agency-modal--property" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="authenticated-property-editor-title">
      <header><div><p className="agency-eyebrow">{property ? 'EDITAR ANUNCIO' : 'NUEVO ANUNCIO'}</p><h2 id="authenticated-property-editor-title">{property?.property.title ?? 'Añadir inmueble'}</h2><p>Guarda un borrador o publica y copia el enlace en la misma operación.</p></div><button className="agency-icon-button" disabled={busy} onClick={onClose} aria-label="Cerrar"><X size={21} /></button></header>
      <form onSubmit={submit}>
        {error && <p className="agency-inline-error" role="alert">{error}</p>}
        <div className="agency-form-grid"><label><span>Referencia interna</span><input name="internalReference" required maxLength={100} defaultValue={property?.property.internalReference ?? ''} placeholder="MAD-052" /></label><label><span>Estado al guardar</span><select name="state" defaultValue={currentState}>{stateOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
        <label className="agency-form-field"><span>Título público</span><input name="title" required minLength={2} maxLength={240} defaultValue={property?.property.title ?? ''} placeholder="Piso luminoso en Chamberí" /></label>
        <div className="agency-form-grid agency-form-grid--three"><label><span>Dirección</span><input name="address" required defaultValue={property?.property.address ?? ''} /></label><label><span>Ciudad</span><input name="city" required defaultValue={property?.property.city ?? 'Madrid'} /></label><label><span>Provincia</span><input name="province" required defaultValue={property?.property.province ?? 'Madrid'} /></label><label><span>Código postal</span><input name="postalCode" required defaultValue={property?.property.postalCode ?? ''} inputMode="numeric" /></label><label><span>Zona pública</span><input name="publicLocation" required defaultValue={property?.property.publicLocation ?? property?.property.city ?? 'Madrid'} placeholder="Chamberí, Madrid" /></label><label><span>Tipo de inmueble</span><select name="propertyType" defaultValue={property?.property.propertyType ?? 'Piso'}><option>Piso</option><option>Ático</option><option>Estudio</option><option>Dúplex</option><option>Casa</option></select></label><label><span>Alquiler mensual (€)</span><input name="monthlyRent" type="number" required min="1" step="0.01" defaultValue={property ? property.property.monthlyRentCents / 100 : ''} /></label><label><span>Habitaciones</span><input name="bedrooms" type="number" required min="0" defaultValue={property?.property.bedrooms ?? 1} /></label><label><span>Baños</span><input name="bathrooms" type="number" required min="0" defaultValue={property?.property.bathrooms ?? 1} /></label><label><span>Superficie en m²</span><input name="floorAreaSqm" type="number" required min="1" defaultValue={property?.property.floorAreaSqm ?? ''} /></label><label><span>Disponible desde</span><input name="availableFrom" type="date" required defaultValue={property?.property.availableFrom ?? ''} /></label></div>
        <label className="agency-form-field"><span>Descripción</span><textarea name="description" required minLength={2} maxLength={5000} rows={4} defaultValue={property?.property.description ?? ''} placeholder="Describe brevemente el inmueble y sus puntos clave." /></label>
        <fieldset className="agency-document-request"><legend>Documentación solicitada por cada adulto</legend><label><input name="requestedDocumentCategories" value="payslips" type="checkbox" defaultChecked={property?.property.requestedDocumentCategories.includes('payslips') ?? true} /> Nóminas recientes</label><label><input name="requestedDocumentCategories" value="employment_contract" type="checkbox" defaultChecked={property?.property.requestedDocumentCategories.includes('employment_contract') ?? true} /> Contrato laboral</label><label><input name="requestedDocumentCategories" value="self_employed_income" type="checkbox" defaultChecked={property?.property.requestedDocumentCategories.includes('self_employed_income') ?? false} /> Ingresos de autónomo</label><label><input name="requestedDocumentCategories" value="irpf_tax_return" type="checkbox" defaultChecked={property?.property.requestedDocumentCategories.includes('irpf_tax_return') ?? false} /> Declaración de la renta (IRPF)</label><label><input name="requestedDocumentCategories" value="employment_history" type="checkbox" defaultChecked={property?.property.requestedDocumentCategories.includes('employment_history') ?? false} /> Vida laboral</label><label><input name="requestedDocumentCategories" value="pension_proof" type="checkbox" defaultChecked={property?.property.requestedDocumentCategories.includes('pension_proof') ?? false} /> Justificante de pensión</label><label><input name="requestedDocumentCategories" value="guarantor_proof" type="checkbox" defaultChecked={property?.property.requestedDocumentCategories.includes('guarantor_proof') ?? false} /> Documentación del avalista</label><label><input name="requestedDocumentCategories" value="supporting" type="checkbox" defaultChecked={property?.property.requestedDocumentCategories.includes('supporting') ?? false} /> Otros justificantes</label></fieldset>
        <div className="agency-cover-field">
          <span className="agency-cover-field__preview">{(cover?.previewUrl ?? coverImageUrl) ? <img src={cover?.previewUrl ?? coverImageUrl ?? undefined} alt="Vista previa de la portada" /> : <span className="agency-property-visual agency-property-visual--blue" aria-hidden="true"><HouseLine size={24} /></span>}</span>
          <div><strong>Imagen de portada</strong><small>JPG o PNG. {cover ? 'Se subirá al guardar el anuncio.' : 'La comprobamos antes de publicarla.'}</small></div>
          <label className="agency-button agency-button--secondary agency-button--compact agency-upload-field"><UploadSimple size={16} />{cover || coverImageUrl ? 'Cambiar imagen' : 'Subir imagen'}<input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(event) => { selectCover(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>
        </div>
        <footer><button type="button" className="agency-button agency-button--secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="agency-button agency-button--primary" type="submit" disabled={busy}><Check size={18} weight="bold" />{busy ? 'Guardando...' : 'Guardar anuncio'}</button></footer>
      </form>
    </section>
  </div>
}

function AppointmentModal({ applicant, property, appointments, existing, onClose, onSubmit }: { applicant: Applicant; property: Property; appointments: Appointment[]; existing?: Appointment; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const modalRef = useRef<HTMLElement>(null)
  const [date, setDate] = useState(existing ? existing.date.split('/').reverse().join('-') : '2026-08-12')
  const [time, setTime] = useState(existing?.time ?? '17:00')
  const [assignees, setAssignees] = useState<string[]>(existing?.assignees ?? (demoTeam.length === 1 ? [...demoTeam] : []))
  useDialogAccessibility(modalRef, onClose)
  const toggleAssignee = (name: string) => setAssignees((current) => current.includes(name) ? current.filter((candidate) => candidate !== name) : [...current, name])
  const selectedStart = appointmentToTimestamp({ date: date.split('-').reverse().join('/'), time })
  const visitWindow = defaultVisitDurationMinutes * 60_000
  const selectedEnd = selectedStart + visitWindow
  const overlappingWorkers = [...new Set(appointments.flatMap((appointment) => {
    if (appointment.id === existing?.id || ['Cancelada', 'Completada', 'No se presentó'].includes(appointment.status)) return []
    const shared = appointment.assignees.filter((name) => assignees.includes(name))
    if (!shared.length) return []
    const start = appointmentToTimestamp(appointment)
    const end = start + visitWindow
    return selectedStart < end && selectedEnd > start ? shared : []
  }))]
  return (
    <div className="agency-overlay agency-overlay--center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="agency-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="appointment-title">
        <header><div><p className="agency-eyebrow">{existing ? 'ACTUALIZAR CITA' : 'NUEVA CITA'}</p><h2 id="appointment-title">{existing ? 'Reprogramar visita' : 'Agendar visita'}</h2><p>Con {applicant.name} para {property.reference}</p></div><button className="agency-icon-button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button></header>
        <form onSubmit={onSubmit}>
          <div className="agency-modal__context"><CalendarBlank size={21} /><span><strong>{property.title}</strong><small>{property.address}, {property.city}</small></span></div>
          <div className="agency-form-grid"><label><span>Fecha</span><input name="date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label><span>Hora</span><input name="time" type="time" required value={time} onChange={(event) => setTime(event.target.value)} /></label></div>
          {demoTeam.length > 1 && (
            <div className="agency-form-field">
              <span id="appointment-workers-label">Trabajadores asociados <small>Selecciona uno o varios</small></span>
              <div className="agency-worker-chips" role="group" aria-labelledby="appointment-workers-label">
                {demoTeam.map((name, index) => (
                  <button key={name} type="button" aria-pressed={assignees.includes(name)} onClick={() => toggleAssignee(name)}>
                    <span className={`agency-avatar agency-avatar--${index % 3}`} aria-hidden="true">{applicantInitials(name)}</span>
                    {name}
                    {assignees.includes(name) && <Check size={13} weight="bold" />}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(demoTeam.length === 1 ? demoTeam : assignees).map((name) => <input key={name} type="hidden" name="assignees" value={name} />)}
          {overlappingWorkers.length > 0 && <div className="agency-overlap-warning" role="alert"><Clock size={18} /><span><strong>Posible solapamiento</strong><small>{overlappingWorkers.join(' y ')} ya tiene una visita a esa hora.</small></span></div>}
          <label className="agency-form-field"><span>Dirección o instrucciones</span><input name="instructions" defaultValue={existing?.instructions ?? `${property.address}, ${property.city}`} /></label>
          <label className="agency-form-field"><span>Nota interna <small>Opcional</small></span><textarea name="note" rows={3} defaultValue={existing?.note} placeholder="Añade una indicación para el equipo" /></label>
          <div className="agency-form-note"><Bell size={17} /><span>Se enviará una confirmación en español a {applicant.email}.</span></div>
          <footer><button type="button" className="agency-button agency-button--secondary" onClick={onClose}>Cancelar</button><button className="agency-button agency-button--primary" type="submit"><Check size={18} weight="bold" />{existing ? 'Guardar cambios' : 'Confirmar visita'}</button></footer>
        </form>
      </section>
    </div>
  )
}

const archivableDemoStatuses: Appointment['status'][] = ['Completada', 'Cancelada', 'No se presentó']

function AppointmentsView({ appointments, onOpenApplicant, onUpdate, onNew, onReschedule, onArchiveColumn, onUnarchive, focusedAppointmentId }: { appointments: Appointment[]; onOpenApplicant: (id: number) => void; onUpdate: (id: number, status: Appointment['status']) => void; onNew: () => void; onReschedule: (appointment: Appointment) => void; onArchiveColumn: (status: Appointment['status']) => void; onUnarchive: (id: number) => void; focusedAppointmentId: number | null }) {
  const [tab, setTab] = useState<'activas' | 'archivadas'>('activas')
  useEffect(() => {
    if (!focusedAppointmentId) return
    const target = document.getElementById(`agency-appointment-${focusedAppointmentId}`)
    target?.focus()
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusedAppointmentId])
  const sorted = [...appointments].sort((a, b) => appointmentToTimestamp(a) - appointmentToTimestamp(b))
  const active = sorted.filter((appointment) => !appointment.archived)
  const archived = [...appointments].filter((appointment) => appointment.archived).sort((a, b) => appointmentToTimestamp(b) - appointmentToTimestamp(a))
  const cards: Array<KanbanCard<Appointment['status']>> = active.map((appointment) => ({
    key: String(appointment.id),
    column: appointment.status,
    draggable: true,
    focused: focusedAppointmentId === appointment.id,
    domId: `agency-appointment-${appointment.id}`,
    content: <>
      <div className="agency-kanban-card__when"><CalendarBlank size={14} />{appointment.date} · {appointment.time}</div>
      <KanbanApplicant name={appointment.applicant}>
        <button className="agency-kanban-card__property" draggable={false} onClick={() => onOpenApplicant(appointment.applicantId)}>{appointment.property}<ArrowRight size={13} /></button>
      </KanbanApplicant>
      <div className="agency-kanban-card__footer">
        <div className="agency-kanban-card__workers"><span className="agency-kanban-card__workers-label">Equipo</span><WorkerAvatarStack names={appointment.assignees} /></div>
        {['Pendiente', 'Confirmada'].includes(appointment.status) && <button className="agency-text-button" draggable={false} onClick={() => onReschedule(appointment)}>Reprogramar</button>}
      </div>
    </>,
  }))
  const columns = appointmentKanbanStatuses.map((status) => ({
    id: status,
    label: status,
    headerAction: archivableDemoStatuses.includes(status) && cards.some((card) => card.column === status)
      ? <button className="agency-kanban__archive-all" type="button" onClick={() => onArchiveColumn(status)} title={`Archivar todas las citas de ${status.toLowerCase()}`}>Archivar todas</button>
      : undefined,
  }))
  return (
    <section className="agency-view">
      <PageHeading eyebrow="AGENDA DEL EQUIPO" title="Citas" description="Arrastra cada cita a su nueva columna para actualizar su estado sin perder el contexto del interesado." actions={<button className="agency-button agency-button--primary" onClick={onNew}><Plus size={18} />Nueva cita</button>} />
      <div className="agency-citas-tabs" role="tablist" aria-label="Vistas de citas">
        <button role="tab" aria-selected={tab === 'activas'} className={tab === 'activas' ? 'is-active' : ''} onClick={() => setTab('activas')}>Activas <em>{active.length}</em></button>
        <button role="tab" aria-selected={tab === 'archivadas'} className={tab === 'archivadas' ? 'is-active' : ''} onClick={() => setTab('archivadas')}>Archivadas <em>{archived.length}</em></button>
      </div>
      {tab === 'activas' && <KanbanBoard
        columns={columns}
        cards={cards}
        onMove={(key, target) => onUpdate(Number(key), target)}
        boardLabel="Tablero de citas por estado"
      />}
      {tab === 'archivadas' && (archived.length ? <div className="agency-kanban-archive" aria-label="Citas archivadas">
        {archived.map((appointment) => <article className="agency-kanban-card agency-kanban-card--static" key={appointment.id}>
          <div className="agency-kanban-card__archive-top">
            <StatusBadge status={appointment.status} />
            <button className="agency-text-button" type="button" onClick={() => onUnarchive(appointment.id)}>Restaurar</button>
          </div>
          <div className="agency-kanban-card__when"><CalendarBlank size={14} />{appointment.date} · {appointment.time}</div>
          <KanbanApplicant name={appointment.applicant}>
            <button className="agency-kanban-card__property" onClick={() => onOpenApplicant(appointment.applicantId)}>{appointment.property}<ArrowRight size={13} /></button>
          </KanbanApplicant>
          <div className="agency-kanban-card__footer">
            <div className="agency-kanban-card__workers"><span className="agency-kanban-card__workers-label">Equipo</span><WorkerAvatarStack names={appointment.assignees} /></div>
          </div>
        </article>)}
      </div> : <div className="agency-kanban__empty agency-kanban__empty--archive">Aún no hay citas archivadas. Usa «Archivar todas» en las columnas finalizadas del tablero.</div>)}
    </section>
  )
}

/** Estadísticas reales del espacio demo, calculadas sobre los mismos datos que ven el panel, los anuncios y las citas. */
function demoWorkspaceStats(properties: Property[], applicants: Applicant[], appointments: Appointment[]) {
  const upcoming = appointments.filter((appointment) => !appointment.archived && ['Confirmada', 'Pendiente'].includes(appointment.status) && appointmentToTimestamp(appointment) >= Date.now())
  return {
    publishedListings: properties.filter((property) => property.status === 'Publicado').length,
    draftListings: properties.filter((property) => property.status === 'Borrador').length,
    pausedListings: properties.filter((property) => property.status === 'Pausado').length,
    totalListings: properties.filter((property) => property.status !== 'Archivado').length,
    applicantCount: applicants.length,
    newApplicantCount: applicants.filter((applicant) => isNewInLast30Days(applicant)).length,
    upcomingViewingCount: upcoming.length,
  }
}

function SettingsView({ isDemo, identity, properties, applicants, appointments }: { isDemo: boolean; identity: AgencyIdentity | null; properties: Property[]; applicants: Applicant[]; appointments: Appointment[] }) {
  const [agencyName, setAgencyName] = useState(identity?.agency?.name ?? demoAgencyProfile.name)
  const [contactEmail, setContactEmail] = useState(identity?.user.email ?? demoAgencyProfile.email)
  const [phone, setPhone] = useState(demoAgencyProfile.phone)
  const [saved, setSaved] = useState(false)
  const stats = demoWorkspaceStats(properties, applicants, appointments)
  const plan = billingPlanCatalog.find((item) => item.code === demoBilling.plan)!
  return <section className="agency-view">
    <PageHeading eyebrow="ESPACIO DE TRABAJO" title="Configuración" description={`Datos y estado actual de ${isDemo ? demoAgencyProfile.name : identity?.agency?.name ?? 'tu espacio de trabajo'}.`} />
    <div className="agency-settings-grid">
      {isDemo ? (
        <section className="agency-panel-card">
          <h2>Datos del espacio de trabajo</h2>
          <form onSubmit={(event) => { event.preventDefault(); setSaved(true) }} onChange={() => setSaved(false)}>
            <label className="agency-form-field"><span>Nombre comercial</span><input value={agencyName} onChange={(event) => setAgencyName(event.target.value)} required /></label>
            <label className="agency-form-field"><span>Correo de contacto</span><input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} required /></label>
            <label className="agency-form-field"><span>Teléfono</span><input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <button className="agency-button agency-button--primary" type="submit"><Check size={17} weight="bold" />{saved ? 'Cambios guardados' : 'Guardar cambios'}</button>
          </form>
        </section>
      ) : (
        <section className="agency-panel-card">
          <h2>Datos del espacio de trabajo</h2>
          <dl className="agency-detail-grid">
            <div><dt>Nombre del espacio</dt><dd>{identity?.agency?.name ?? 'Sin nombre'}</dd></div>
            <div><dt>Tu cuenta</dt><dd>{identity?.user.fullName ?? 'Sin datos'}</dd></div>
            <div><dt>Correo</dt><dd>{identity?.user.email ?? 'Sin datos'}</dd></div>
            <div><dt>Rol</dt><dd>{identity?.agency?.role === 'admin' ? 'Administración' : 'Colaboración'}</dd></div>
          </dl>
          <p className="agency-settings-note">El equipo se gestiona en <strong>Equipo</strong> y el plan en <strong>Facturación</strong>.</p>
        </section>
      )}
      {isDemo && <section className="agency-panel-card">
        <h2>Estado del espacio</h2>
        <ul className="agency-settings-stats">
          <li><strong>{stats.publishedListings}</strong><span>anuncios publicados</span></li>
          <li><strong>{stats.draftListings + stats.pausedListings}</strong><span>en borrador o pausados</span></li>
          <li><strong>{stats.applicantCount}</strong><span>interesados en cartera</span></li>
          <li><strong>{stats.upcomingViewingCount}</strong><span>visitas próximas</span></li>
          <li><strong>{demoTeamMembers.length}</strong><span>personas en el equipo</span></li>
        </ul>
        <p className="agency-settings-note">Plan <strong>{plan.name}</strong> · {stats.publishedListings} de {plan.listingLimit} anuncios activos usados.</p>
      </section>}
    </div>
  </section>
}

function TeamView({ remote, canInvite, applicants, appointments }: { remote: boolean; canInvite: boolean; applicants: Applicant[]; appointments: Appointment[] }) {
  if (remote) return <section className="agency-view"><TeamManager canInvite={canInvite} /></section>
  const memberStats = demoTeamMembers.map((member, index) => {
    const firstName = member.name.split(/\s+/)[0]
    const upcomingViewings = appointments.filter((appointment) => !appointment.archived && appointment.assignees.includes(member.name) && ['Confirmada', 'Pendiente'].includes(appointment.status) && appointmentToTimestamp(appointment) >= Date.now()).length
    const completedViewings = appointments.filter((appointment) => appointment.assignees.includes(member.name) && appointment.status === 'Completada').length
    const assignedApplicants = applicants.filter((applicant) => applicant.assignee === firstName).length
    return { ...member, index, upcomingViewings, completedViewings, assignedApplicants }
  })
  const plan = billingPlanCatalog.find((item) => item.code === demoBilling.plan)!
  return <section className="agency-view">
    <PageHeading eyebrow={`PLAN ${plan.name.toUpperCase()}`} title="Equipo" description="Quién es quién en tu agencia y qué carga de trabajo tiene cada persona." actions={<button className="agency-button agency-button--primary"><Plus size={18} />Invitar colaborador</button>} />
    <div className="agency-team-list">
      {memberStats.map((member) => <article key={member.name}>
        <span className={`agency-avatar agency-avatar--${member.index % 3}`}>{applicantInitials(member.name)}</span>
        <div><strong>{member.name}</strong><small>{member.email}</small></div>
        <div className="agency-team-list__load"><strong>{member.assignedApplicants}</strong><small>{member.assignedApplicants === 1 ? 'interesado asignado' : 'interesados asignados'}</small></div>
        <div className="agency-team-list__load"><strong>{member.upcomingViewings}</strong><small>{member.upcomingViewings === 1 ? 'visita próxima' : 'visitas próximas'}</small></div>
        <span className={`agency-role-badge${member.role === 'Administradora' ? ' agency-role-badge--admin' : ''}`}>{member.role}</span>
        <button className="agency-icon-button" aria-label={`Más acciones para ${member.name}`}><DotsThree size={20} /></button>
      </article>)}
    </div>
    <p className="agency-settings-note">El plan {plan.name} admite {plan.accountLimit === null ? 'cuentas ilimitadas' : `hasta ${plan.accountLimit} cuentas`}; ahora usas {demoTeamMembers.length}. Los interesados se asignan desde su ficha y las visitas al agendarlas.</p>
  </section>
}

function BillingView({ remote, properties }: { remote: boolean; properties: Property[] }) {
  if (remote) return <section className="agency-view"><PageHeading eyebrow="PLAN Y PAGOS" title="Facturación" description="Consulta tu plan actual y cambia sus límites cuando tu cartera lo necesite." /><PlanManager /></section>
  const plan = billingPlanCatalog.find((item) => item.code === demoBilling.plan)!
  const publishedListings = properties.filter((property) => property.status === 'Publicado').length
  const [day, month, year] = demoBilling.trialEndsOn.split('/').map(Number)
  const trialDaysLeft = Math.max(0, Math.ceil((new Date(year, month - 1, day).getTime() - Date.now()) / dayInMilliseconds))
  return <section className="agency-view">
    <PageHeading eyebrow="PLAN Y PAGOS" title="Facturación" description="Tu plan, su uso real y el método de pago del espacio de trabajo." />
    <section className="agency-billing-hero">
      <div><span className="agency-billing-badge"><Sparkle size={15} weight="fill" />PLAN ACTIVO</span><h2>{plan.name}</h2><p>{plan.price} / mes</p></div>
      <div><small>Próximo cargo</small><strong>{plan.price}</strong><span>{demoBilling.trialEndsOn}</span></div>
      <button className="agency-button agency-button--secondary">Gestionar plan</button>
    </section>
    <div className="agency-settings-grid">
      <section className="agency-panel-card">
        <h2>Uso del plan</h2>
        <div className="agency-plan-usage">
          <div><span>Anuncios activos</span><strong>{publishedListings} de {plan.listingLimit}</strong><div className="agency-trial-progress"><span style={{ width: `${Math.min(100, Math.round((publishedListings / plan.listingLimit) * 100))}%` }} /></div></div>
          <div><span>Cuentas del equipo</span><strong>{demoTeamMembers.length}{plan.accountLimit === null ? ' (sin límite)' : ` de ${plan.accountLimit}`}</strong></div>
        </div>
        <p className="agency-settings-note">Los otros planes: {billingPlanCatalog.filter((item) => item.code !== demoBilling.plan).map((item) => `${item.name} (${item.price}/mes, ${item.listingLimit} anuncios)`).join(' · ')}.</p>
      </section>
      <section className="agency-panel-card">
        <h2>Método de pago</h2>
        <div className="agency-payment-method"><CreditCard size={25} /><span><strong>{demoBilling.card}</strong><small>Caduca {demoBilling.cardExpiry}</small></span><button className="agency-text-button">Actualizar</button></div>
        <h2 className="agency-panel-card__second-heading">Tu plan</h2>
        <p>Tu plan se renueva el {demoBilling.trialEndsOn}. {trialDaysLeft === 1 ? 'Queda 1 día' : `Quedan ${trialDaysLeft} días`} para el próximo cargo. Puedes cancelar cuando quieras desde aquí.</p>
        <div className="agency-trial-progress"><span style={{ width: `${Math.min(100, Math.round(((30 - trialDaysLeft) / 30) * 100))}%` }} /></div>
        <small>Renovación mensual automática. Se requiere tarjeta.</small>
      </section>
    </div>
  </section>
}

function EmptyState({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="agency-empty"><span><MagnifyingGlass size={25} /></span><h2>{title}</h2><p>{description}</p>{action && onAction && <button className="agency-button agency-button--secondary" onClick={onAction}>{action}</button>}</div>
}
