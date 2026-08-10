import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
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
  UserCircle,
  Users,
  Warning,
  WhatsappLogo,
  X,
} from '@phosphor-icons/react'
import { ApplicantCollaborationControls, PlanManager, PropertyCoverUpload, TeamManager, WorkspaceLogoutButton } from '../features/funnel/FunnelControls'
import './AgencyWorkspacePage.css'

type View = 'panel' | 'properties' | 'property' | 'appointments' | 'linkedApplicant' | 'linkedAppointment' | 'team' | 'settings' | 'billing'
type ApplicantStatus = 'Nuevo' | 'Preseleccionado' | 'Seleccionado' | 'Descartado' | 'Retirado'
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
  duration: string
  assignee: string
  status: 'Confirmada' | 'Pendiente' | 'Completada' | 'Cancelada' | 'No se presentó'
  instructions: string
  note: string
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

type DashboardLoadState = 'loading' | 'remote' | 'demo' | 'error'
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
  application: { id: string; responsibleUserId: string | null; status: 'new' | 'preselected' | 'selected' | 'rejected' | 'withdrawn'; documentState: 'complete' | 'missing' | 'not_requested'; submittedAt: string | null; draftData: Record<string, unknown>; adultProfiles: Array<{ id: string; isPrimary: boolean; fullName: string; email: string | null; phone: string | null; employmentStatus: string; employerOrActivity: string; contractType: string; netMonthlyIncomeCents: number }> }
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
  { id: 1, reference: 'MAD-042', title: 'Piso luminoso en Chamberí', address: 'Calle de Galileo, 41', city: 'Madrid', rent: 1450, rooms: 2, applicants: 24, newApplicants: 7, status: 'Publicado', nextViewing: 'Hoy, 18:00', accent: 'coral', publicUrl: 'https://inquilink.es/solicitud/mad-042-9vp3k2' },
  { id: 2, reference: 'MAD-038', title: 'Ático con terraza en Retiro', address: 'Calle del Doce de Octubre, 8', city: 'Madrid', rent: 1890, rooms: 3, applicants: 16, newApplicants: 3, status: 'Publicado', nextViewing: 'Mañana, 12:30', accent: 'blue', publicUrl: 'https://inquilink.es/solicitud/mad-038-5fh8lz' },
  { id: 3, reference: 'MAD-051', title: 'Estudio reformado en Malasaña', address: 'Calle de la Palma, 22', city: 'Madrid', rent: 980, rooms: 1, applicants: 0, newApplicants: 0, status: 'Borrador', nextViewing: null, accent: 'sand', publicUrl: '' },
  { id: 4, reference: 'MAD-029', title: 'Dúplex familiar en Arganzuela', address: 'Paseo de las Delicias, 77', city: 'Madrid', rent: 1650, rooms: 3, applicants: 31, newApplicants: 0, status: 'Pausado', nextViewing: null, accent: 'sage', publicUrl: 'https://inquilink.es/solicitud/mad-029-j8m4pr' },
]

const initialApplicants: Applicant[] = [
  { id: 1, propertyId: 1, name: 'Lucía Martín', email: 'lucia.martin@email.es', phone: '+34612144309', submitted: 'Hoy, 09:42', submittedIso: '2026-08-07T09:42:00+02:00', household: '2 adultos', moveIn: '01/09/2026', employment: 'Cuenta ajena', contract: 'Indefinido', employer: 'Cobalto Studio', income: 4200, ratio: 35, documents: 'Completa', viewing: 'Agendada', viewingDate: 'Hoy, 18:00', assignee: 'Sin asignar', initials: 'LM', status: 'Preseleccionado', note: 'Prefiere una visita a última hora. Tiene flexibilidad para entrar unos días antes.', preferredContact: 'WhatsApp', pets: 'No', guarantor: 'No es necesario', individualIncome: 2500, message: 'Buscamos un piso tranquilo y nos gusta mucho la zona.', availability: 'Entre semana a partir de las 18:00' },
  { id: 2, propertyId: 1, name: 'Andrés Ruiz', email: 'andres.ruiz@email.es', phone: '+34680776211', submitted: 'Hoy, 08:16', submittedIso: '2026-08-07T08:16:00+02:00', household: '1 adulto', moveIn: '15/09/2026', employment: 'Autónomo', contract: 'Más de 3 años', employer: 'Arquitectura AR', income: 3350, ratio: 43, documents: 'Faltan documentos', viewing: 'Sin visita', assignee: 'Sin asignar', initials: 'AR', status: 'Nuevo', note: 'Pendiente de adjuntar la declaración trimestral más reciente.', preferredContact: 'Correo', pets: 'Un gato', guarantor: 'Sí', individualIncome: 3350, message: 'Trabajo desde casa y busco una vivienda estable.', availability: 'Martes y jueves por la tarde' },
  { id: 3, propertyId: 1, name: 'Elena Sanz', email: 'elena.sanz@email.es', phone: '+34655610428', submitted: '06/08/2026', submittedIso: '2026-08-06T12:00:00+02:00', household: '2 adultos, 1 menor', moveIn: '01/10/2026', employment: 'Cuenta ajena', contract: 'Indefinido', employer: 'Hospital La Paz', income: 5100, ratio: 28, documents: 'Completa', viewing: 'Por confirmar', viewingDate: '10/08, 17:30', assignee: 'Sin asignar', initials: 'ES', status: 'Preseleccionado', note: 'La familia busca contrato de larga duración.', preferredContact: 'Teléfono', pets: 'No', guarantor: 'No', individualIncome: 2900, message: 'Nos interesa especialmente la cercanía al colegio.', availability: 'Fines de semana por la mañana' },
  { id: 4, propertyId: 1, name: 'Samuel Ortega', email: 'samuel.ortega@email.es', phone: '+34622994871', submitted: '05/08/2026', submittedIso: '2026-08-05T12:00:00+02:00', household: '1 adulto', moveIn: '01/09/2026', employment: 'Cuenta ajena', contract: 'Temporal', employer: 'Brava Foods', income: 2600, ratio: 56, documents: 'Completa', viewing: 'Sin visita', assignee: 'Sin asignar', initials: 'SO', status: 'Nuevo', note: 'Ha incluido avalista en la solicitud.', preferredContact: 'WhatsApp', pets: 'No', guarantor: 'Sí', individualIncome: 2600, message: 'Puedo aportar avalista si es necesario.', availability: 'Lunes, miércoles y viernes por la tarde' },
  { id: 5, propertyId: 1, name: 'Nora Vidal', email: 'nora.vidal@email.es', phone: '+34630127449', submitted: '04/08/2026', submittedIso: '2026-08-04T12:00:00+02:00', household: '2 adultos', moveIn: '15/08/2026', employment: 'Cuenta ajena', contract: 'Indefinido', employer: 'Lumen Tech', income: 4750, ratio: 31, documents: 'Faltan documentos', viewing: 'Realizada', viewingDate: '05/08, 19:00', assignee: 'Sin asignar', initials: 'NV', status: 'Preseleccionado', note: 'Muy interesada. Solicita confirmación antes del lunes.', preferredContact: 'Correo', pets: 'Perro pequeño', guarantor: 'No', individualIncome: 3100, message: 'La vivienda encaja con lo que buscamos.', availability: 'Flexibilidad completa esta semana' },
  { id: 6, propertyId: 1, name: 'Miguel Costa', email: 'miguel.costa@email.es', phone: '+34673990512', submitted: '02/08/2026', submittedIso: '2026-08-02T12:00:00+02:00', household: '1 adulto', moveIn: '01/10/2026', employment: 'Estudiante', contract: 'Con avalista', employer: 'IE University', income: 0, ratio: 0, documents: 'Sin solicitar', viewing: 'Sin visita', assignee: 'Sin asignar', initials: 'MC', status: 'Nuevo', note: 'Cuenta con avalista. Falta revisar la información aportada.', preferredContact: 'WhatsApp', pets: 'No', guarantor: 'Sí', individualIncome: 0, message: 'Mi padre sería el avalista de la operación.', availability: 'Viernes por la tarde' },
  { id: 7, propertyId: 2, name: 'Marina López', email: 'marina.lopez@email.es', phone: '+34611478120', submitted: 'Hoy, 10:05', submittedIso: '2026-08-07T10:05:00+02:00', household: '2 adultos', moveIn: '01/09/2026', employment: 'Cuenta ajena', contract: 'Indefinido', employer: 'Kiro Labs', income: 5900, ratio: 32, documents: 'Completa', viewing: 'Agendada', viewingDate: 'Mañana, 12:30', assignee: 'Sin asignar', initials: 'ML', status: 'Preseleccionado', note: 'Interesada en la terraza y en plaza de garaje cercana.', preferredContact: 'Teléfono', pets: 'No', guarantor: 'No', individualIncome: 3500, message: 'La terraza es justo lo que estábamos buscando.', availability: 'Mañanas de lunes a sábado' },
]

const initialAppointments: Appointment[] = [
  { id: 1, applicantId: 1, applicant: 'Lucía Martín', propertyId: 1, property: 'Piso luminoso en Chamberí', date: '07/08/2026', time: '18:00', duration: '30 min', assignee: 'Marta Soler', status: 'Confirmada', instructions: 'Portal principal. Preguntar por Marta.', note: 'Llevar ficha impresa.' },
  { id: 2, applicantId: 7, applicant: 'Marina López', propertyId: 2, property: 'Ático con terraza en Retiro', date: '08/08/2026', time: '12:30', duration: '45 min', assignee: 'Marta Soler', status: 'Confirmada', instructions: 'Encontrarse en el portal.', note: '' },
  { id: 3, applicantId: 3, applicant: 'Elena Sanz', propertyId: 1, property: 'Piso luminoso en Chamberí', date: '10/08/2026', time: '17:30', duration: '30 min', assignee: 'Marta Soler', status: 'Pendiente', instructions: 'Confirmar por teléfono el mismo día.', note: '' },
  { id: 4, applicantId: 5, applicant: 'Nora Vidal', propertyId: 1, property: 'Piso luminoso en Chamberí', date: '05/08/2026', time: '19:00', duration: '30 min', assignee: 'Marta Soler', status: 'Completada', instructions: 'Portal principal.', note: 'Visita realizada con interés alto.' },
]

const statuses: ApplicantStatus[] = ['Nuevo', 'Preseleccionado', 'Seleccionado', 'Descartado', 'Retirado']
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
  const labels: Record<string, string> = { new: 'Nuevo', preselected: 'Preseleccionado', selected: 'Seleccionado', rejected: 'Descartado', withdrawn: 'Retirado' }
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
  }
  return labels[event.type] ?? 'Actividad actualizada'
}

function PropertyVisual({ property }: { property: Property }) {
  return (
    <div className={`agency-property-visual agency-property-visual--${property.accent}`} aria-hidden="true">
      <span className="agency-property-visual__sun" />
      <span className="agency-property-visual__building agency-property-visual__building--back" />
      <span className="agency-property-visual__building agency-property-visual__building--front" />
      <HouseLine size={25} weight="duotone" />
    </div>
  )
}

function StatusBadge({ status }: { status: ApplicantStatus | PropertyStatus | DocumentStatus | ViewingStatus | Appointment['status'] }) {
  const key = status.toLowerCase().replaceAll(' ', '-').replaceAll('ó', 'o').replaceAll('í', 'i')
  return <span className={`agency-status agency-status--${key}`}>{status}</span>
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
  const [appointmentTab, setAppointmentTab] = useState<'Próximas' | 'Anteriores'>('Próximas')
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
      const matchesDate = submittedFilter === 'Cualquier fecha' || (submittedFilter === 'Hoy' ? applicant.submittedIso.startsWith('2026-08-07') : applicant.submittedIso >= '2026-08-01')
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

  const openApplicantFromDashboard = (id: number) => {
    const applicant = applicants.find((item) => item.id === id)
    if (!applicant) return
    openProperty(applicant.propertyId)
    setSelectedApplicantId(id)
    window.history.replaceState({}, '', `/app/anuncios/${applicant.propertyId}/interesados/${id}`)
  }

  const openNewApplicants = () => {
    setPropertySearch('')
    setPropertyStatus('Todos')
    setOnlyPropertiesWithNewApplicants(true)
    navigate('properties', '/app/anuncios?estado=Nuevo')
  }

  const clearNewApplicantPropertyFilter = () => {
    setOnlyPropertiesWithNewApplicants(false)
    if (window.location.pathname === '/app/anuncios') window.history.replaceState({}, '', '/app/anuncios')
  }

  const openAppointmentFromDashboard = (id: number) => {
    setFocusedAppointmentId(id)
    setAppointmentTab('Próximas')
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
    const nextAppointment: Appointment = {
      id: Date.now(),
      applicantId: appointmentApplicant.id,
      applicant: appointmentApplicant.name,
      propertyId: appointmentApplicant.propertyId,
      property: workspaceProperties.find((property) => property.id === appointmentApplicant.propertyId)?.title ?? '',
      date: date.split('-').reverse().join('/'),
      time,
      duration: String(form.get('duration') || '30 min'),
      assignee: String(form.get('assignee') || 'Indefinido'),
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
      setActivities((current) => [{ id: Date.now(), applicantId: target.applicantId, title: status === 'Completada' ? 'Visita completada' : status === 'Cancelada' ? 'Visita cancelada' : 'No se presentó a la visita', detail: 'Marta Soler', timestamp: 'Ahora' }, ...current])
    }
    setToast(status === 'Completada' ? 'Visita marcada como completada.' : status === 'Cancelada' ? 'Cita cancelada.' : 'Ausencia registrada.')
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
            {view === 'property' && dashboardLoadState === 'demo' && <><span>/</span><strong>{selectedProperty.reference}</strong></>}
          </div>
          <div className="agency-topbar__actions">
            <button className="agency-icon-button" aria-label="Notificaciones"><Bell size={20} /><span className="agency-notification-dot" /></button>
            <button className="agency-user-pill"><span>{userInitials}</span><b>{userFirstName}</b><CaretDown size={14} /></button>
          </div>
        </header>

        <main className="agency-main" id="agency-main">
          {view === 'panel' && <DashboardView userFirstName={userFirstName} properties={workspaceProperties} appointments={appointments} applicants={applicants} dashboardData={dashboardData} loadState={dashboardLoadState} loadError={dashboardLoadError} onRetry={() => setDashboardReloadKey((key) => key + 1)} onNewProperty={createDraftProperty} onOpenProperties={() => { clearNewApplicantPropertyFilter(); navigate('properties') }} onOpenProperty={openProperty} onOpenApplicant={openApplicantFromDashboard} onOpenNewApplicants={openNewApplicants} onOpenAppointment={openAppointmentFromDashboard} onOpenAppointments={() => { setFocusedAppointmentId(null); setAppointmentTab('Próximas'); navigate('appointments', '/app/citas?vista=proximas') }} />}
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
              tab={appointmentTab}
              onTab={setAppointmentTab}
              onOpenApplicant={setSelectedApplicantId}
              onUpdate={updateAppointment}
              onNew={() => { setEditingAppointmentId(null); setAppointmentApplicantId(applicants[0]?.id ?? null) }}
              onReschedule={(appointment) => { setEditingAppointmentId(appointment.id); setAppointmentApplicantId(appointment.applicantId) }}
              focusedAppointmentId={focusedAppointmentId}
            />
          )}
          {view === 'appointments' && (dashboardLoadState === 'loading' || dashboardLoadState === 'error') && <AgencyDestinationGate title="Citas" loadState={dashboardLoadState} loadError={dashboardLoadError} onRetry={() => setDashboardReloadKey((key) => key + 1)} />}
          {view === 'team' && <TeamView remote={dashboardLoadState === 'remote'} canInvite={identity?.agency?.role === 'admin'} />}
          {view === 'settings' && <SimpleSettingsView />}
          {view === 'billing' && <BillingView remote={dashboardLoadState === 'remote'} />}
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

function DashboardView({ userFirstName, properties, appointments, applicants, dashboardData, loadState, loadError, onRetry, onNewProperty, onOpenProperties, onOpenProperty, onOpenApplicant, onOpenNewApplicants, onOpenAppointment, onOpenAppointments }: { userFirstName: string; properties: Property[]; appointments: Appointment[]; applicants: Applicant[]; dashboardData: DashboardApiData | null; loadState: DashboardLoadState; loadError: string; onRetry: () => void; onNewProperty: () => void; onOpenProperties: () => void; onOpenProperty: (id: number) => void; onOpenApplicant: (id: number) => void; onOpenNewApplicants: () => void; onOpenAppointment: (id: number) => void; onOpenAppointments: () => void }) {
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
  const demoTopProperties = [...properties]
    .filter((property) => property.applicants > 0)
    .sort((left, right) => right.applicants - left.applicants || left.title.localeCompare(right.title, 'es'))
    .slice(0, 3)
  const propertyFor = (propertyId: number) => properties.find((property) => property.id === propertyId)
  const remote = loadState === 'remote' ? dashboardData : null
  const isDemo = loadState === 'demo'
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
      <div className="agency-dashboard-focus">
        <section className="agency-panel-card agency-new-applicants-card">
          <div className="agency-card-heading">
            <div><p className="agency-eyebrow">ÚLTIMOS 30 DÍAS</p><h2>Nuevos interesados</h2></div>
            <span className="agency-dashboard-count"><strong>{applicantCount ?? '-'}</strong><small>nuevos</small></span>
          </div>
          {showPending ? <DashboardLoadMessage message="Cargando nuevos interesados..." /> : showError ? <DashboardLoadMessage message={loadError} error onRetry={onRetry} loginRequired={isSessionError(loadError)} /> : remote ? (remote.newApplicants.items.length ? <div className="agency-dashboard-applicant-list">
            {remote.newApplicants.items.map((applicant) => <a className="agency-dashboard-applicant-row" key={applicant.applicationId} href={applicant.href} aria-label={`Abrir la solicitud de ${applicant.applicantName} para ${applicant.propertyTitle}`}>
              <span className="agency-avatar">{applicant.applicantName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span>
              <span className="agency-dashboard-applicant-row__person"><strong>{applicant.applicantName}</strong><small>{applicant.propertyTitle}</small></span>
              <span className="agency-dashboard-applicant-row__date">{apiRelativeDateTime(applicant.submittedAt, now)}</span>
              <ArrowRight size={16} />
            </a>)}
          </div> : <DashboardEmptyState title="No hay nuevos interesados" description="Las solicitudes nuevas de los últimos 30 días aparecerán aquí." action="Ver mis anuncios" href="/app/anuncios" />) : demoNewApplicants.length ? <div className="agency-dashboard-applicant-list">
            {demoNewApplicants.slice(0, 5).map((applicant) => {
              const property = propertyFor(applicant.propertyId)
              return <button className="agency-dashboard-applicant-row" key={applicant.id} onClick={() => onOpenApplicant(applicant.id)} aria-label={`Abrir la solicitud de ${applicant.name} para ${property?.title ?? 'el anuncio'}`}>
                <span className={`agency-avatar agency-avatar--${applicant.id % 3}`}>{applicant.initials}</span>
                <span className="agency-dashboard-applicant-row__person"><strong>{applicant.name}</strong><small>{property?.reference} · {property?.title}</small></span>
                <span className="agency-dashboard-applicant-row__date">{apiRelativeDateTime(applicant.submittedIso, now)}</span>
                <ArrowRight size={16} />
              </button>
            })}
          </div> : <DashboardEmptyState title="No hay nuevos interesados" description="Las solicitudes nuevas de los últimos 30 días aparecerán aquí." action={properties.length ? 'Ver mis anuncios' : 'Crear mi primer anuncio'} onAction={properties.length ? onOpenProperties : onNewProperty} />}
          {!showPending && !showError && (remote ? remote.newApplicants.items.length > 0 : demoNewApplicants.length > 0) && (remote ? <a className="agency-dashboard-card-link" href={remote.newApplicants.href}>Ver todos los nuevos <ArrowRight size={16} /></a> : <button className="agency-dashboard-card-link" onClick={onOpenNewApplicants}>Ver todos los nuevos <ArrowRight size={16} /></button>)}
        </section>
        <section className="agency-panel-card agency-schedule-card">
          <div className="agency-card-heading"><div><p className="agency-eyebrow">AGENDA</p><h2>Próximas visitas</h2></div>{remote ? <a className="agency-text-button" href={remote.upcomingViewings.href}>Abrir agenda <ArrowRight size={16} /></a> : isDemo ? <button className="agency-text-button" onClick={onOpenAppointments}>Abrir agenda <ArrowRight size={16} /></button> : null}</div>
          {showPending ? <DashboardLoadMessage message="Cargando próximas visitas..." /> : showError ? <DashboardLoadMessage message={loadError} error onRetry={onRetry} loginRequired={isSessionError(loadError)} /> : remote ? (remote.upcomingViewings.items.length ? remote.upcomingViewings.items.map((appointment) => {
            const parts = apiDateParts(appointment.startsAt)
            return <a className="agency-schedule-row" key={appointment.appointmentId} href={appointment.href} aria-label={`Abrir la visita de ${appointment.applicantName} el ${parts.date} a las ${parts.time}`}>
              <span className="agency-date-tile"><strong>{parts.day}</strong><span>{parts.month}</span></span>
              <span><strong>{apiRelativeDateTime(appointment.startsAt, now)} · {appointment.applicantName}</strong><small>{appointment.propertyTitle} · {appointment.durationMinutes} min</small></span>
              <ArrowRight size={16} />
            </a>
          }) : <DashboardEmptyState title="No hay visitas programadas" description="Las próximas citas del equipo aparecerán aquí por orden cronológico." action="Abrir citas" href={remote.upcomingViewings.href} />) : demoUpcomingAppointments.length ? demoUpcomingAppointments.map((appointment) => (
            <button className="agency-schedule-row" key={appointment.id} onClick={() => onOpenAppointment(appointment.id)} aria-label={`Abrir la visita de ${appointment.applicant} el ${appointment.date} a las ${appointment.time}`}>
              <span className="agency-date-tile"><strong>{appointment.date.slice(0, 2)}</strong><span>{dashboardMonthLabel(appointment.date)}</span></span>
              <span><strong>{dashboardDateLabel(appointment.date, now)}, {appointment.time} · {appointment.applicant}</strong><small>{appointment.property} · {appointment.duration}</small></span>
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
      <section className="agency-panel-card agency-recent-properties">
        <div className="agency-card-heading">
          <h2>Anuncios con más interesados</h2>
          {remote ? <a className="agency-text-button" href={remote.topProperties.href}>Ver anuncios <ArrowRight size={16} /></a> : isDemo ? <button className="agency-text-button" onClick={onOpenProperties}>Ver anuncios <ArrowRight size={16} /></button> : null}
        </div>
        {showPending ? <DashboardLoadMessage message="Cargando anuncios destacados..." /> : showError ? <DashboardLoadMessage message={loadError} error onRetry={onRetry} loginRequired={isSessionError(loadError)} /> : remote ? (remote.topProperties.items.length ? <div className="agency-recent-properties__grid">
          {remote.topProperties.items.map((property) => <a className="agency-property-mini" href={property.href} key={property.propertyId} aria-label={`Abrir ${property.title}, ${applicantCountLabel(property.applicantCount)}`}>
            {property.coverImageUrl ? <img className="agency-property-api-cover" src={property.coverImageUrl} alt="" /> : <span className="agency-property-visual agency-property-visual--blue" aria-hidden="true"><HouseLine size={25} weight="duotone" /></span>}
            <span><small>{property.internalReference}</small><strong>{property.title}</strong><em>{property.city} · {applicantCountLabel(property.applicantCount)}</em></span>
            <ArrowRight size={16} />
          </a>)}
        </div> : <DashboardEmptyState icon={<HouseLine size={22} />} title="Todavía no hay anuncios con interesados" description="Los anuncios aparecerán aquí cuando reciban su primera solicitud." action="Ver mis anuncios" href={remote.topProperties.href} />) : demoTopProperties.length ? <div className="agency-recent-properties__grid">
          {demoTopProperties.map((property) => <button className="agency-property-mini" key={property.id} onClick={() => onOpenProperty(property.id)} aria-label={`Abrir ${property.title}, ${applicantCountLabel(property.applicants)}`}>
            <PropertyVisual property={property} />
            <span><small>{property.reference}</small><strong>{property.title}</strong><em>{property.city} · {applicantCountLabel(property.applicants)}</em></span>
            <ArrowRight size={16} />
          </button>)}
        </div> : <DashboardEmptyState icon={<HouseLine size={22} />} title="Todavía no hay anuncios con interesados" description="Los anuncios aparecerán aquí cuando reciban su primera solicitud." action={properties.length ? 'Ver mis anuncios' : 'Crear mi primer anuncio'} onAction={properties.length ? onOpenProperties : onNewProperty} />}
      </section>
    </section>
  )
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
  const changeRemoteApplicantStatus = async (status: 'new' | 'preselected' | 'selected' | 'rejected') => {
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
      const response = await fetch(`/api/v1/agency/appointments/${encodeURIComponent(route.id)}`, { method: 'PATCH', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reschedule', expectedUpdatedAt: remoteRecord.updatedAt, startsAt: madridLocalToIso(String(form.get('startsAt'))), durationMinutes: Number(form.get('durationMinutes')), responsibleUserId }) })
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
      const statusLabel: Record<AgencyApplicantDetailApi['application']['status'], ApplicantStatus> = { new: 'Nuevo', preselected: 'Preseleccionado', selected: 'Seleccionado', rejected: 'Descartado', withdrawn: 'Retirado' }
      const documentLabel: Record<AgencyApplicantDetailApi['application']['documentState'], DocumentStatus> = { complete: 'Completa', missing: 'Faltan documentos', not_requested: 'Sin solicitar' }
      const details = remoteApplicant.application.draftData
      return <section className="agency-view agency-linked-record"><button className="agency-back" onClick={onBack}><ArrowLeft size={17} />Panel</button><PageHeading eyebrow="INTERESADO" title={name} description={`${remoteApplicant.property.internalReference} · ${propertyTitle}`} actions={<label className="agency-select"><span className="agency-sr-only">Cambiar estado</span><select value={remoteApplicant.application.status} disabled={mutating || remoteApplicant.application.status === 'withdrawn'} onChange={(event) => void changeRemoteApplicantStatus(event.target.value as 'new' | 'preselected' | 'selected' | 'rejected')}><option value="new">Nuevo</option><option value="preselected">Preseleccionado</option><option value="selected">Seleccionado</option><option value="rejected">Descartado</option>{remoteApplicant.application.status === 'withdrawn' && <option value="withdrawn">Retirado</option>}</select><CaretDown size={14} /></label>} />
        {mutationError && <p className="agency-inline-error" role="alert">{mutationError}</p>}
        {remoteApplicant.possibleDuplicate && <div className="agency-duplicate-note" role="status"><Warning size={18} weight="fill" /><span><strong>Posible solicitud duplicada</strong><small>Coincide por {remoteApplicant.possibleDuplicate.matchedOn.map((value) => value === 'email' ? 'correo' : 'teléfono').join(' y ')} con {remoteApplicant.possibleDuplicate.applicationIds.length} solicitud(es) de este anuncio. Revísalas por separado; no se han fusionado ni descartado.</small></span></div>}
        <div className="agency-linked-detail-grid"><section className="agency-panel-card"><h2>Resumen</h2><dl><div><dt>Solicitud recibida</dt><dd>{submitted}</dd></div><div><dt>Estado</dt><dd><StatusBadge status={statusLabel[remoteApplicant.application.status]} /></dd></div><div><dt>Documentación</dt><dd><StatusBadge status={documentLabel[remoteApplicant.application.documentState]} /></dd></div><div><dt>Responsable</dt><dd>{remoteApplicant.responsibleUser?.fullName ?? 'Sin asignar'}</dd></div><div><dt>Correo</dt><dd>{remoteApplicant.applicant?.email ?? 'No disponible'}</dd></div><div><dt>Ubicación</dt><dd>{remoteApplicant.property.address ? `${remoteApplicant.property.address}, ` : ''}{remoteApplicant.property.city}</dd></div></dl></section>
          <section className="agency-panel-card"><h2>Solicitud</h2><dl><div><dt>Teléfono</dt><dd>{formatPhoneDisplay(typeof details.phone === 'string' ? details.phone : null)}</dd></div><div><dt>Contacto preferido</dt><dd>{contactChannelCopy(details.preferredContactChannel)}</dd></div><div><dt>Adultos / menores</dt><dd>{detailValue(details.adultOccupants)} / {detailValue(details.minorOccupants)}</dd></div><div><dt>Entrada prevista</dt><dd>{detailValue(details.intendedMoveInDate)}</dd></div><div><dt>Situación laboral</dt><dd>{detailValue(details.employmentStatus)}</dd></div><div><dt>Contrato</dt><dd>{detailValue(details.contractType)}</dd></div><div><dt>Actividad o empresa</dt><dd>{detailValue(details.employerOrActivity)}</dd></div><div><dt>Ingresos individuales</dt><dd>{typeof details.individualNetMonthlyIncomeCents === 'number' ? formatMoney(details.individualNetMonthlyIncomeCents / 100) : 'No indicado'}</dd></div><div><dt>Ingresos del hogar</dt><dd>{typeof details.householdNetMonthlyIncomeCents === 'number' ? formatMoney(details.householdNetMonthlyIncomeCents / 100) : 'No indicado'}</dd></div><div><dt>Mascotas</dt><dd>{yesNoCopy(details.pets)}</dd></div><div><dt>Detalles de mascotas</dt><dd>{detailValue(details.petDetails)}</dd></div><div><dt>Avalista</dt><dd>{yesNoCopy(details.guarantorAvailability)}</dd></div><div><dt>Disponibilidad</dt><dd>{detailValue(details.viewingAvailability)}</dd></div><div><dt>Nota de disponibilidad</dt><dd>{detailValue(details.availabilityNote)}</dd></div><div><dt>Mensaje</dt><dd>{detailValue(details.message)}</dd></div><div><dt>Consentimiento comercial</dt><dd>{detailValue(details.marketingConsent)}</dd></div></dl></section>
          <section className="agency-panel-card"><h2>Personas adultas</h2><ul className="agency-linked-list">{remoteApplicant.application.adultProfiles.map((adult) => <li key={adult.id}><span><strong>{adult.fullName}{adult.isPrimary ? ' · solicitante principal' : ''}</strong><small>{adult.employmentStatus} · {adult.contractType} · {formatMoney(adult.netMonthlyIncomeCents / 100)}{adult.email ? ` · ${adult.email}` : ''}</small></span></li>)}</ul></section>
          <section className="agency-panel-card"><h2>Documentos</h2>{remoteApplicant.documents.length ? <ul className="agency-linked-list">{remoteApplicant.documents.map((document) => { const owner = remoteApplicant.application.adultProfiles.find((adult) => adult.id === document.adultProfileId); return <li key={document.id}><span><strong>{document.originalName}</strong><small>{documentCategoryCopy(document.category)} · {owner?.fullName ?? 'Solicitante principal'}</small></span><button className="agency-text-button" disabled={documentOpeningId === document.id} onClick={() => void openSecureDocument(document.id, document.originalName)}>{documentOpeningId === document.id ? 'Abriendo...' : 'Abrir'} <ArrowRight size={15} /></button></li> })}</ul> : <p className="agency-muted-copy">No hay documentos disponibles.</p>}</section>
          <section className="agency-panel-card"><ApplicantCollaborationControls applicationId={remoteApplicant.application.id} initialResponsibleUserId={remoteApplicant.application.responsibleUserId} initialNotes={remoteApplicant.notes} onResponsibleChanged={(responsibleUser) => setRemoteRecord((current) => current && 'application' in current ? { ...current, responsibleUser, application: { ...current.application, responsibleUserId: responsibleUser?.id ?? null } } : current)} /></section>
          <section className="agency-panel-card"><h2>Historial de citas</h2>{remoteApplicant.appointments.length ? <ul className="agency-linked-list">{remoteApplicant.appointments.map((appointment) => <li key={appointment.id}><span><strong>{apiRelativeDateTime(appointment.startsAt)}</strong><small>{appointment.durationMinutes} min · {appointmentStateCopy(appointment.state)}</small></span><a className="agency-text-button" href={`/app/citas/${encodeURIComponent(appointment.id)}`}>Abrir <ArrowRight size={15} /></a></li>)}</ul> : <p className="agency-muted-copy">No hay citas registradas.</p>}</section>
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
    const duration = remoteAppointment ? `${remoteAppointment.durationMinutes} min` : demoAppointment?.duration
    return <section className="agency-view agency-linked-record"><button className="agency-back" onClick={onBack}><ArrowLeft size={17} />Panel</button><PageHeading eyebrow="VISITA" title={name} description={propertyTitle} actions={remoteAppointment?.state === 'scheduled' ? <div className="agency-inline-actions"><button className="agency-button agency-button--secondary" disabled={mutating} onClick={() => setRescheduleOpen((open) => !open)}><Clock size={17} />Reprogramar</button><button className="agency-button agency-button--secondary" disabled={mutating} onClick={() => void updateRemoteAppointment('complete')}><Check size={17} />Completar</button><button className="agency-button agency-button--secondary" disabled={mutating} onClick={() => void updateRemoteAppointment('no_show')}><UserCircle size={17} />No se presentó</button><button className="agency-button agency-button--secondary" disabled={mutating} onClick={() => void updateRemoteAppointment('cancel')}><X size={17} />Cancelar</button></div> : undefined} />{mutationError && <p className="agency-inline-error" role="alert">{mutationError}</p>}{appointmentWarnings.length > 0 && <div className="agency-overlap-warning" role="status"><Clock size={18} /><span><strong>Posible solapamiento</strong><small>{appointmentWarnings.map((warning) => `${apiRelativeDateTime(warning.startsAt)}-${apiDateParts(new Date(new Date(warning.startsAt).getTime() + warning.durationMinutes * 60_000).toISOString()).time}`).join(', ')}</small></span></div>}{remoteAppointment && rescheduleOpen && <form className="agency-panel-card agency-reschedule-form" onSubmit={rescheduleRemoteAppointment}><label className="agency-form-field"><span>Nueva fecha y hora</span><input name="startsAt" type="datetime-local" required defaultValue={madridDateTimeLocal(remoteAppointment.startsAt)} /></label><label className="agency-form-field"><span>Duración</span><select name="durationMinutes" defaultValue={remoteAppointment.durationMinutes}><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option></select></label><label className="agency-form-field"><span>Trabajador asociado</span><select name="responsibleUserId" defaultValue={remoteAppointment.responsibleUserId ?? ''}><option value="">Indefinido</option>{teamMembers.map((member) => <option key={member.userId} value={member.userId}>{member.fullName}</option>)}</select></label><button className="agency-button agency-button--primary" type="submit" disabled={mutating}>Guardar cambios</button></form>}<section className="agency-panel-card"><dl><div><dt>Fecha y hora</dt><dd>{date}</dd></div><div><dt>Duración</dt><dd>{duration}</dd></div><div><dt>Anuncio</dt><dd>{propertyTitle}</dd></div>{remoteAppointment && <><div><dt>Estado</dt><dd>{appointmentStateCopy(remoteAppointment.state)}</dd></div><div><dt>Trabajador asociado</dt><dd>{remoteAppointment.responsibleUserName ?? 'Indefinido'}</dd></div><div><dt>Instrucciones</dt><dd>{remoteAppointment.instructions ?? 'Sin instrucciones'}</dd></div><div><dt>Nota interna</dt><dd>{remoteAppointment.internalNote ?? 'Sin nota'}</dd></div></>}</dl></section></section>
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
  const applicantStatusLabel: Record<AgencyApplicantDetailApi['application']['status'], ApplicantStatus> = { new: 'Nuevo', preselected: 'Preseleccionado', selected: 'Seleccionado', rejected: 'Descartado', withdrawn: 'Retirado' }
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
      const response = await fetch('/api/v1/agency/appointments', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ applicationId: scheduling.application.id, startsAt: madridLocalToIso(String(form.get('startsAt'))), durationMinutes: Number(form.get('durationMinutes')), responsibleUserId, instructions: String(form.get('instructions') || '').trim() || null, internalNote: String(form.get('internalNote') || '').trim() || null }) })
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
      {property.property.coverImageUrl ? <img className="agency-property-api-cover" src={property.property.coverImageUrl} alt="" /> : <div className="agency-property-visual agency-property-visual--blue" aria-hidden="true"><HouseLine size={28} weight="duotone" /></div>}
      <div className="agency-property-header__identity"><div><span>{property.property.internalReference}</span><StatusBadge status={({ draft: 'Borrador', published: 'Publicado', paused: 'Pausado', archived: 'Archivado' } as const)[property.property.state]} /></div><h1>{property.property.title}</h1><p><MapPin size={15} />{property.property.address ? `${property.property.address}, ` : ''}{property.property.city} · {formatMoney(property.property.monthlyRentCents / 100)} / mes</p></div>
      <div className="agency-property-header__stats"><span><strong>{property.applicantCount}</strong><small>interesados</small></span><span><strong>{property.newApplicantCount}</strong><small>por revisar</small></span><span><strong>{property.recentNewApplicantCount}</strong><small>nuevos · 30 días</small></span></div>
      <div className="agency-property-header__actions"><button className="agency-icon-button agency-icon-button--border" onClick={() => onEdit(property)} aria-label="Editar anuncio"><NotePencil size={18} /></button><button className="agency-button agency-button--secondary" disabled={property.property.state !== 'published'} onClick={() => void copyPublicLink()}>{copied ? <Check size={18} weight="bold" /> : <Copy size={18} />}{copied ? 'Copiado' : 'Copiar enlace'}</button></div>
    </header>
    <PropertyCoverUpload propertyId={property.property.id} currentUrl={property.property.coverImageUrl} onUploaded={({ coverImageUrl, version }) => setProperty((current) => current ? { ...current, property: { ...current.property, coverImageUrl, version } } : current)} />
    <div className="agency-section-heading"><div><h2>Interesados</h2><p>{visible.length} resultados visibles</p></div><button className="agency-button agency-button--secondary agency-button--compact" onClick={exportApplications}><DownloadSimple size={17} />Exportar</button></div>
    <div className="agency-applicant-toolbar">
      <label className="agency-search agency-search--applicants"><MagnifyingGlass size={18} /><span className="agency-sr-only">Buscar interesados</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, correo o teléfono" /></label>
      <FilterSelect label="Estado" value={applicantStatus} onChange={(value) => setApplicantStatus(value as typeof applicantStatus)} options={['all', 'new', 'preselected', 'selected', 'rejected', 'withdrawn']} optionLabels={{ all: 'Todos', new: 'Nuevo', preselected: 'Preseleccionado', selected: 'Seleccionado', rejected: 'Descartado', withdrawn: 'Retirado' }} />
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
    {scheduling && <RemoteAppointmentModal item={scheduling} property={property} teamMembers={teamMembers} busy={mutatingApplicationId === scheduling.application.id} onClose={() => setScheduling(null)} onSubmit={submitAppointment} />}
  </section>
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
  return <>
    <div className="agency-applicant-table-wrap">
      <table className="agency-applicant-table">
        <thead><tr><th>Interesado</th><th>Solicitud</th><th>Perfil</th><th>Solvencia</th><th>Seguimiento</th><th>Teléfono</th><th>Estado</th><th><span className="agency-sr-only">Acciones</span></th></tr></thead>
        <tbody>{applications.map((item, index) => {
          const data = remoteApplicantPresentation(item, property.property.monthlyRentCents)
          return <tr key={item.application.id}>
            <td><a className="agency-person" href={detailHref(item)}><span className={`agency-avatar agency-avatar--${index % 3}`}>{data.initials}</span><span><strong>{item.tenantName}</strong><small>{item.tenantEmail}</small>{item.possibleDuplicate && <em className="agency-duplicate-badge">Posible duplicado</em>}</span></a></td>
            <td><div className="agency-cell-stack"><strong className="agency-cell-strong">{item.application.submittedAt ? apiRelativeDateTime(item.application.submittedAt) : 'Sin enviar'}</strong><small>Entrada {data.moveIn}</small></div></td>
            <td><div className="agency-cell-stack"><strong className="agency-cell-strong">{data.employment}</strong><small>{data.contract} · {data.household}</small></div></td>
            <td><div className="agency-cell-stack"><strong className="agency-income">{data.income}</strong><small>{data.ratio}</small><StatusBadge status={documentStatusLabel[item.application.documentState]} /></div></td>
            <td><div className="agency-cell-stack"><StatusBadge status={data.viewing} />{data.viewingDate && <small className="agency-viewing-date">{data.viewingDate}</small>}</div></td>
            <td>{data.phone === 'Sin teléfono' ? <span className="agency-phone agency-phone--empty">Sin teléfono</span> : <a className="agency-phone" href={`tel:${data.phone.replace(/\s/g, '')}`}>{data.phone}</a>}</td>
            <td><label className="agency-inline-status"><span className="agency-sr-only">Cambiar estado de {item.tenantName}</span><select value={item.application.status} disabled={mutatingApplicationId === item.application.id || item.application.status === 'withdrawn'} onChange={(event) => onStatusChange(item, event.target.value as Exclude<AgencyApplicantDetailApi['application']['status'], 'withdrawn'>)}><option value="new">Nuevo</option><option value="preselected">Preseleccionado</option><option value="selected">Seleccionado</option><option value="rejected">Descartado</option>{item.application.status === 'withdrawn' && <option value="withdrawn">Retirado</option>}</select><CaretDown size={13} /></label></td>
            <td><div className="agency-table-actions"><button className="agency-icon-button agency-icon-button--whatsapp" disabled={data.phone === 'Sin teléfono'} onClick={() => onWhatsApp(item)} aria-label={`Contactar a ${item.tenantName} por WhatsApp`}><WhatsappLogo size={18} weight="fill" /></button><button className="agency-icon-button agency-icon-button--border" onClick={() => onSchedule(item)} aria-label={`Agendar visita con ${item.tenantName}`}><CalendarBlank size={18} /></button><a className="agency-icon-button" href={detailHref(item)} aria-label={`Ver detalle de ${item.tenantName}`}><DotsThree size={20} weight="bold" /></a></div></td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <div className="agency-applicant-cards">
      {applications.map((item, index) => {
        const data = remoteApplicantPresentation(item, property.property.monthlyRentCents)
        return <article className="agency-applicant-card" key={item.application.id}>
          <a className="agency-person" href={detailHref(item)}><span className={`agency-avatar agency-avatar--${index % 3}`}>{data.initials}</span><span><strong>{item.tenantName}</strong><small>{item.tenantEmail}</small><em>{data.phone}</em>{item.possibleDuplicate && <b className="agency-duplicate-badge">Posible duplicado</b>}</span><ArrowRight size={17} /></a>
          <div className="agency-applicant-card__statuses"><StatusBadge status={documentStatusLabel[item.application.documentState]} /><StatusBadge status={data.viewing} /></div>
          <dl><div><dt>Solicitud</dt><dd>{item.application.submittedAt ? apiRelativeDateTime(item.application.submittedAt) : 'Sin enviar'}<small>Entrada {data.moveIn}</small></dd></div><div><dt>Perfil</dt><dd>{data.employment}<small>{data.contract} · {data.household}</small></dd></div><div><dt>Ingresos</dt><dd>{data.income}<small>{data.ratio}</small></dd></div><div><dt>Seguimiento</dt><dd>{data.viewing}<small>{data.viewingDate ?? 'Sin fecha'}</small></dd></div></dl>
          <label className="agency-card-status"><span>Responsable <strong>{data.assignee}</strong></span><span>Estado <select value={item.application.status} disabled={mutatingApplicationId === item.application.id || item.application.status === 'withdrawn'} onChange={(event) => onStatusChange(item, event.target.value as Exclude<AgencyApplicantDetailApi['application']['status'], 'withdrawn'>)}><option value="new">Nuevo</option><option value="preselected">Preseleccionado</option><option value="selected">Seleccionado</option><option value="rejected">Descartado</option>{item.application.status === 'withdrawn' && <option value="withdrawn">Retirado</option>}</select></span></label>
          <div className="agency-applicant-card__actions"><button className="agency-button agency-button--secondary" disabled={data.phone === 'Sin teléfono'} onClick={() => onWhatsApp(item)}><WhatsappLogo size={18} weight="fill" />WhatsApp</button><button className="agency-button agency-button--primary" onClick={() => onSchedule(item)}><CalendarBlank size={18} />Agendar</button></div>
        </article>
      })}
    </div>
  </>
}

function RemoteAppointmentModal({ item, property, teamMembers, busy, onClose, onSubmit }: { item: AgencyApplicationListItem; property: AgencyPropertyApi; teamMembers: AgencyTeamMember[]; busy: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const modalRef = useRef<HTMLElement>(null)
  const [startsAt, setStartsAt] = useState(defaultRemoteAppointmentLocal)
  useDialogAccessibility(modalRef, onClose)
  return <div className="agency-overlay agency-overlay--center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="agency-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="remote-appointment-title">
      <header><div><p className="agency-eyebrow">NUEVA CITA</p><h2 id="remote-appointment-title">Agendar visita</h2><p>Con {item.tenantName} para {property.property.internalReference}</p></div><button className="agency-icon-button" disabled={busy} onClick={onClose} aria-label="Cerrar"><X size={21} /></button></header>
      <form onSubmit={onSubmit}>
        <div className="agency-modal__context"><CalendarBlank size={21} /><span><strong>{property.property.title}</strong><small>{property.property.address ? `${property.property.address}, ` : ''}{property.property.city}</small></span></div>
        <div className="agency-form-grid"><label><span>Fecha y hora</span><input name="startsAt" type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label><span>Duración</span><select name="durationMinutes" defaultValue="30"><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option></select></label><label><span>Trabajador asociado</span><select name="responsibleUserId" defaultValue=""><option value="">Indefinido</option>{teamMembers.map((member) => <option key={member.userId} value={member.userId}>{member.fullName}</option>)}</select></label></div>
        <label className="agency-form-field"><span>Dirección o instrucciones</span><input name="instructions" defaultValue={`${property.property.address ?? ''}${property.property.address ? ', ' : ''}${property.property.city}`} /></label>
        <label className="agency-form-field"><span>Nota interna <small>Opcional</small></span><textarea name="internalNote" rows={3} placeholder="Añade una indicación para el equipo" /></label>
        <footer><button type="button" className="agency-button agency-button--secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="agency-button agency-button--primary" type="submit" disabled={busy}><Check size={18} weight="bold" />{busy ? 'Guardando...' : 'Confirmar visita'}</button></footer>
      </form>
    </section>
  </div>
}

function AuthenticatedAppointmentsView() {
  const [records, setRecords] = useState<AgencyAppointmentApi[]>([])
  const [pagination, setPagination] = useState<PaginationMetadata | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [tab, setTab] = useState<'Próximas' | 'Anteriores'>(() => new URLSearchParams(window.location.search).get('vista') === 'anteriores' ? 'Anteriores' : 'Próximas')
  const [loadState, setLoadState] = useState<RemoteLoadState>('loading')
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const requestScope = `${tab}:${reloadKey}`
  const requestScopeRef = useRef(requestScope)
  requestScopeRef.current = requestScope
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoadingMore(false)
      setLoadState('loading')
      setError('')
      try {
        const scope = tab === 'Próximas' ? 'upcoming' : 'past'
        const response = await fetch(`/api/v1/agency/appointments?scope=${scope}&page=1&pageSize=25`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal })
        if (!response.ok) throw new Error(agencyRequestError(response))
        const payload = await response.json() as { data?: { appointments?: AgencyAppointmentApi[]; pagination?: PaginationMetadata } }
        setRecords(payload.data?.appointments ?? [])
        setPagination(payload.data?.pagination ?? null)
        setLoadState('loaded')
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'No hemos podido cargar las citas.')
        setLoadState('error')
      }
    }
    void load()
    return () => controller.abort()
  }, [reloadKey, tab])
  const loadMore = async () => {
    if (!pagination?.hasMore || loadingMore) return
    const requestedScope = requestScopeRef.current
    setLoadingMore(true); setError('')
    try {
      const scope = tab === 'Próximas' ? 'upcoming' : 'past'
      const response = await fetch(`/api/v1/agency/appointments?scope=${scope}&page=${pagination.page + 1}&pageSize=${pagination.pageSize}`, { credentials: 'include', headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(await agencyResponseError(response))
      const payload = await response.json() as { data?: { appointments?: AgencyAppointmentApi[]; pagination?: PaginationMetadata } }
      if (requestScopeRef.current !== requestedScope) return
      setRecords((current) => [...current, ...(payload.data?.appointments ?? [])]); setPagination(payload.data?.pagination ?? null)
    } catch (caught) {
      if (requestScopeRef.current === requestedScope) setError(caught instanceof Error ? caught.message : 'No hemos podido cargar más citas.')
    } finally {
      if (requestScopeRef.current === requestedScope) setLoadingMore(false)
    }
  }
  const now = Date.now()
  const upcoming = records.filter((record) => record.state === 'scheduled' && new Date(record.startsAt).getTime() >= now)
  const past = records.filter((record) => record.state !== 'scheduled' || new Date(record.startsAt).getTime() < now)
  const visible = (tab === 'Próximas' ? upcoming : past).sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
  return <section className="agency-view"><PageHeading eyebrow="AGENDA DEL EQUIPO" title="Citas" description="Consulta las visitas de todos tus anuncios con el contexto del interesado." />
    <div className="agency-tabs" role="tablist" aria-label="Filtrar citas"><button role="tab" aria-selected={tab === 'Próximas'} onClick={() => setTab('Próximas')}>Próximas <span>{upcoming.length}</span></button><button role="tab" aria-selected={tab === 'Anteriores'} onClick={() => setTab('Anteriores')}>Anteriores <span>{past.length}</span></button></div>
    {loadState === 'loading' ? <DashboardLoadMessage message="Cargando citas..." /> : loadState === 'error' ? <DashboardLoadMessage message={error} error loginRequired={isSessionError(error)} onRetry={() => setReloadKey((key) => key + 1)} /> : <><div className="agency-panel-card agency-authenticated-appointments">{visible.length ? visible.map((record) => { const parts = apiDateParts(record.startsAt); return <a className="agency-schedule-row" href={record.href} key={record.id}><span className="agency-date-tile"><strong>{parts.day}</strong><span>{parts.month}</span></span><span><strong>{apiRelativeDateTime(record.startsAt)} · {record.applicantName}</strong><small>{record.propertyTitle}, {record.durationMinutes} min, {record.responsibleUserName ?? 'Indefinido'}</small></span><ArrowRight size={16} /></a> }) : <DashboardEmptyState title="No hay citas en esta vista" description="Las visitas aparecerán aquí cuando se programen o cambien de estado." action="Volver al panel" href="/app" />}</div>{pagination?.hasMore && <button className="agency-button agency-button--secondary" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Cargando…' : `Cargar más citas (${records.length} de ${pagination.total})`}</button>}</>}
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
        <FilterSelect label="Responsable" value={assigneeFilter} onChange={onAssigneeFilter} options={['Todos', 'Marta', 'Diego', 'Sin asignar']} />
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
  return (
    <>
      <div className="agency-applicant-table-wrap">
        <table className="agency-applicant-table">
          <thead><tr><th>Interesado</th><th>Solicitud</th><th>Perfil</th><th>Solvencia</th><th>Seguimiento</th><th>Teléfono</th><th>Estado</th><th><span className="agency-sr-only">Acciones</span></th></tr></thead>
          <tbody>
            {applicants.map((applicant) => (
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
        </table>
      </div>
      <div className="agency-applicant-cards">
        {applicants.map((applicant) => (
          <article className="agency-applicant-card" key={applicant.id}>
            <button className="agency-person" onClick={() => onOpenApplicant(applicant.id)}><span className={`agency-avatar agency-avatar--${applicant.id % 3}`}>{applicant.initials}</span><span><strong>{applicant.name}</strong><small>{applicant.email}</small><em>{formatPhoneDisplay(applicant.phone)}</em></span><ArrowRight size={17} /></button>
            <div className="agency-applicant-card__statuses"><StatusBadge status={applicant.documents} /><StatusBadge status={applicant.viewing} /></div>
            <dl><div><dt>Solicitud</dt><dd>{applicant.submitted}<small>Entrada {applicant.moveIn}</small></dd></div><div><dt>Perfil</dt><dd>{applicant.employment}<small>{applicant.contract} · {applicant.household}</small></dd></div><div><dt>Ingresos</dt><dd>{applicant.income ? formatMoney(applicant.income) : 'Con avalista'}<small>{applicant.ratio ? `${applicant.ratio}% del ingreso` : 'Sin ratio'}</small></dd></div><div><dt>Seguimiento</dt><dd>{applicant.viewing}<small>{applicant.viewingDate ?? 'Sin fecha'}</small></dd></div></dl>
            <label className="agency-card-status"><span>Responsable <strong>{applicant.assignee}</strong></span><span>Estado <select value={applicant.status} onChange={(event) => onStatusChange(applicant.id, event.target.value as ApplicantStatus)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></span></label>
            <div className="agency-applicant-card__actions"><a className="agency-button agency-button--secondary" href={whatsappUrl(applicant)} target="_blank" rel="noreferrer" onClick={() => onWhatsapp(applicant.id)}><WhatsappLogo size={18} weight="fill" />WhatsApp</a><button className="agency-button agency-button--primary" onClick={() => onSchedule(applicant.id)}><CalendarBlank size={18} />Agendar</button></div>
          </article>
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
          <section className="agency-detail-section"><h3>Visitas</h3>{appointments.length ? appointments.map((appointment) => <div className="agency-drawer-appointment" key={appointment.id}><CalendarBlank size={20} /><span><strong>{appointment.date} a las {appointment.time}</strong><small>{appointment.duration} · {appointment.assignee}</small></span><StatusBadge status={appointment.status} /></div>) : <div className="agency-inline-empty">No hay visitas para esta candidatura.</div>}</section>
          <section className="agency-detail-section"><h3>Actividad</h3><div className="agency-timeline">{activities.map((activity) => <div key={activity.id}><span /><p><strong>{activity.title}</strong><small>{activity.timestamp} · {activity.detail}</small></p></div>)}{!activities.some((activity) => activity.title === 'Solicitud recibida') && <div><span /><p><strong>Solicitud recibida</strong><small>{applicant.submitted} · Formulario web</small></p></div>}</div></section>
        </div>
      </aside>
    </div>
  )
}

function PropertyEditorModal({ property, suggestedReference, onClose, onSubmit }: { property?: Property; suggestedReference: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const modalRef = useRef<HTMLElement>(null)
  useDialogAccessibility(modalRef, onClose)
  return <div className="agency-overlay agency-overlay--center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="agency-modal agency-modal--property" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="property-editor-title">
      <header><div><p className="agency-eyebrow">{property ? 'EDITAR ANUNCIO' : 'NUEVO ANUNCIO'}</p><h2 id="property-editor-title">{property ? property.title : 'Añadir inmueble'}</h2><p>Completa la ficha que verá tu equipo y la información pública.</p></div><button className="agency-icon-button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button></header>
      <form onSubmit={onSubmit}>
        <div className="agency-form-grid"><label><span>Referencia interna</span><input name="reference" required defaultValue={property?.reference ?? suggestedReference} /></label><label><span>Estado</span><select name="status" defaultValue={property?.status ?? 'Borrador'}><option>Borrador</option><option>Publicado</option><option>Pausado</option><option>Archivado</option></select></label></div>
        <label className="agency-form-field"><span>Título público</span><input name="title" required defaultValue={property?.title ?? ''} placeholder="Piso luminoso en Chamberí" /></label>
        <div className="agency-form-grid agency-form-grid--three"><label><span>Dirección</span><input name="address" required defaultValue={property?.address ?? ''} /></label><label><span>Ciudad</span><input name="city" required defaultValue={property?.city ?? 'Madrid'} /></label><label><span>Provincia</span><input name="province" required defaultValue={property?.province ?? 'Madrid'} /></label><label><span>Código postal</span><input name="postalCode" required defaultValue={property?.postalCode ?? ''} inputMode="numeric" /></label><label><span>Tipo de inmueble</span><select name="type" defaultValue={property?.type ?? 'Piso'}><option>Piso</option><option>Ático</option><option>Estudio</option><option>Dúplex</option><option>Casa</option></select></label><label><span>Alquiler mensual</span><input name="rent" type="number" required min="1" defaultValue={property?.rent || ''} /></label><label><span>Habitaciones</span><input name="rooms" type="number" required min="0" defaultValue={property?.rooms ?? 1} /></label><label><span>Baños</span><input name="bathrooms" type="number" required min="1" defaultValue={property?.bathrooms ?? 1} /></label><label><span>Superficie en m²</span><input name="area" type="number" required min="1" defaultValue={property?.area ?? ''} /></label><label><span>Disponible desde</span><input name="available" type="date" required defaultValue={property?.available ?? '2026-09-01'} /></label><label><span>Responsable</span><select name="assignee" defaultValue={property?.assignee ?? 'Marta Soler'}><option>Marta Soler</option><option>Diego García</option></select></label></div>
        <label className="agency-form-field"><span>Descripción</span><textarea name="description" required rows={4} defaultValue={property?.description ?? ''} placeholder="Describe brevemente el inmueble y sus puntos clave." /></label>
        <fieldset className="agency-document-request"><legend>Documentación solicitada</legend><label><input type="checkbox" defaultChecked /> Nóminas recientes</label><label><input type="checkbox" defaultChecked /> Contrato laboral</label><label><input type="checkbox" /> Declaración de la renta (IRPF)</label><label><input type="checkbox" /> Vida laboral</label><label><input type="checkbox" /> Justificante de pensión</label><label><input type="checkbox" /> Documentación del avalista</label><label><input type="checkbox" /> Otros justificantes</label></fieldset>
        <div className="agency-cover-field"><span className="agency-property-visual agency-property-visual--blue"><HouseLine size={24} /></span><div><strong>Imagen de portada</strong><small>JPG o PNG. En este prototipo se mantiene la ilustración de muestra.</small></div><button type="button" className="agency-button agency-button--secondary agency-button--compact">Cambiar imagen</button></div>
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
        <p className="agency-form-note">Guarda el anuncio y podrás subir la imagen de portada desde su ficha.</p>
        <footer><button type="button" className="agency-button agency-button--secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="agency-button agency-button--primary" type="submit" disabled={busy}><Check size={18} weight="bold" />{busy ? 'Guardando...' : 'Guardar anuncio'}</button></footer>
      </form>
    </section>
  </div>
}

function AppointmentModal({ applicant, property, appointments, existing, onClose, onSubmit }: { applicant: Applicant; property: Property; appointments: Appointment[]; existing?: Appointment; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const modalRef = useRef<HTMLElement>(null)
  const [date, setDate] = useState(existing ? existing.date.split('/').reverse().join('-') : '2026-08-12')
  const [time, setTime] = useState(existing?.time ?? '17:00')
  const [assignee, setAssignee] = useState(existing?.assignee ?? 'Indefinido')
  const [duration, setDuration] = useState(existing?.duration ?? '30 min')
  useDialogAccessibility(modalRef, onClose)
  const selectedStart = appointmentToTimestamp({ date: date.split('-').reverse().join('/'), time })
  const selectedDuration = Number(duration.split(' ')[0])
  const selectedEnd = selectedStart + selectedDuration * 60_000
  const hasOverlap = appointments.some((appointment) => {
    if (appointment.id === existing?.id || appointment.assignee !== assignee || ['Cancelada', 'Completada', 'No se presentó'].includes(appointment.status)) return false
    const start = appointmentToTimestamp(appointment)
    const end = start + Number(appointment.duration.split(' ')[0]) * 60_000
    return selectedStart < end && selectedEnd > start
  })
  return (
    <div className="agency-overlay agency-overlay--center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="agency-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="appointment-title">
        <header><div><p className="agency-eyebrow">{existing ? 'ACTUALIZAR CITA' : 'NUEVA CITA'}</p><h2 id="appointment-title">{existing ? 'Reprogramar visita' : 'Agendar visita'}</h2><p>Con {applicant.name} para {property.reference}</p></div><button className="agency-icon-button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button></header>
        <form onSubmit={onSubmit}>
          <div className="agency-modal__context"><CalendarBlank size={21} /><span><strong>{property.title}</strong><small>{property.address}, {property.city}</small></span></div>
          <div className="agency-form-grid"><label><span>Fecha</span><input name="date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label><span>Hora</span><input name="time" type="time" required value={time} onChange={(event) => setTime(event.target.value)} /></label><label><span>Duración</span><select name="duration" value={duration} onChange={(event) => setDuration(event.target.value)}><option>30 min</option><option>45 min</option><option>60 min</option></select></label><label><span>Trabajador asociado</span><select name="assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)}><option>Indefinido</option><option>Marta Soler</option><option>Diego García</option></select></label></div>
          {hasOverlap && <div className="agency-overlap-warning" role="alert"><Clock size={18} /><span><strong>Posible solapamiento</strong><small>{assignee} ya tiene una visita a esa hora.</small></span></div>}
          <label className="agency-form-field"><span>Dirección o instrucciones</span><input name="instructions" defaultValue={existing?.instructions ?? `${property.address}, ${property.city}`} /></label>
          <label className="agency-form-field"><span>Nota interna <small>Opcional</small></span><textarea name="note" rows={3} defaultValue={existing?.note} placeholder="Añade una indicación para el equipo" /></label>
          <div className="agency-form-note"><Bell size={17} /><span>Se enviará una confirmación en español a {applicant.email}.</span></div>
          <footer><button type="button" className="agency-button agency-button--secondary" onClick={onClose}>Cancelar</button><button className="agency-button agency-button--primary" type="submit"><Check size={18} weight="bold" />{existing ? 'Guardar cambios' : 'Confirmar visita'}</button></footer>
        </form>
      </section>
    </div>
  )
}

function AppointmentsView({ appointments, tab, onTab, onOpenApplicant, onUpdate, onNew, onReschedule, focusedAppointmentId }: { appointments: Appointment[]; tab: 'Próximas' | 'Anteriores'; onTab: (value: 'Próximas' | 'Anteriores') => void; onOpenApplicant: (id: number) => void; onUpdate: (id: number, status: Appointment['status']) => void; onNew: () => void; onReschedule: (appointment: Appointment) => void; focusedAppointmentId: number | null }) {
  const today = Date.now()
  const upcoming = appointments.filter((appointment) => appointmentToTimestamp(appointment) >= today && !['Cancelada', 'Completada', 'No se presentó'].includes(appointment.status))
  const past = appointments.filter((appointment) => appointmentToTimestamp(appointment) < today || ['Cancelada', 'Completada', 'No se presentó'].includes(appointment.status))
  const visible = (tab === 'Próximas' ? upcoming : past).sort((a, b) => appointmentToTimestamp(a) - appointmentToTimestamp(b))
  const monthLabel = (date: string) => new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'Europe/Madrid' }).format(new Date(date.split('/').reverse().join('-'))).replace('.', '').toUpperCase()
  useEffect(() => {
    if (!focusedAppointmentId) return
    const target = document.getElementById(`agency-appointment-${focusedAppointmentId}`)
    target?.focus()
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusedAppointmentId, tab])
  return (
    <section className="agency-view">
      <PageHeading eyebrow="AGENDA DEL EQUIPO" title="Citas" description="Coordina las visitas de todos tus anuncios sin perder el contexto del interesado." actions={<button className="agency-button agency-button--primary" onClick={onNew}><Plus size={18} />Nueva cita</button>} />
      <div className="agency-tabs" role="tablist" aria-label="Filtrar citas"><button role="tab" aria-selected={tab === 'Próximas'} onClick={() => onTab('Próximas')}>Próximas <span>{upcoming.length}</span></button><button role="tab" aria-selected={tab === 'Anteriores'} onClick={() => onTab('Anteriores')}>Anteriores <span>{past.length}</span></button></div>
      <div className="agency-appointments-list">
        {visible.length ? visible.map((appointment) => (
          <article id={`agency-appointment-${appointment.id}`} tabIndex={-1} className={`agency-appointment-row ${focusedAppointmentId === appointment.id ? 'agency-appointment-row--focused' : ''}`} key={appointment.id}>
            <div className="agency-appointment-date"><strong>{appointment.date.slice(0, 2)}</strong><span>{monthLabel(appointment.date)}</span><small>{appointment.time}</small></div>
            <div className="agency-appointment-main"><StatusBadge status={appointment.status} /><h2>{appointment.applicant}</h2><button onClick={() => onOpenApplicant(appointment.applicantId)}>{appointment.property}<ArrowRight size={15} /></button></div>
            <dl><div><dt>Duración</dt><dd>{appointment.duration}</dd></div><div><dt>Responsable</dt><dd>{appointment.assignee}</dd></div></dl>
            {tab === 'Próximas' ? <div className="agency-row-actions"><button className="agency-button agency-button--secondary agency-button--compact" onClick={() => onReschedule(appointment)}>Reprogramar</button><button className="agency-icon-button agency-icon-button--border" onClick={() => onUpdate(appointment.id, 'Completada')} aria-label="Marcar como completada"><Check size={18} /></button><button className="agency-icon-button agency-icon-button--border" onClick={() => onUpdate(appointment.id, 'No se presentó')} aria-label="Marcar que no se presentó"><UserCircle size={18} /></button><button className="agency-icon-button" onClick={() => onUpdate(appointment.id, 'Cancelada')} aria-label="Cancelar cita"><X size={18} /></button></div> : <span className="agency-appointment-complete"><CheckCircle size={18} />{appointment.status}</span>}
          </article>
        )) : <EmptyState title="No hay citas en esta vista" description="Las citas cambiarán de sección cuando actualices su estado." />}
      </div>
    </section>
  )
}

function SimpleSettingsView() {
  return <section className="agency-view"><PageHeading eyebrow="ESPACIO DE TRABAJO" title="Configuración" description="Datos básicos y preferencias de Casa Barrio." /><div className="agency-settings-grid"><section className="agency-panel-card"><h2>Datos de la agencia</h2><label className="agency-form-field"><span>Nombre comercial</span><input defaultValue="Casa Barrio" /></label><label className="agency-form-field"><span>Correo de contacto</span><input type="email" defaultValue="hola@casabarrio.es" /></label><button className="agency-button agency-button--primary">Guardar cambios</button></section><section className="agency-panel-card agency-team-card"><h2>Equipo</h2><div><span className="agency-avatar">MS</span><span><strong>Marta Soler</strong><small>Administradora</small></span></div><div><span className="agency-avatar agency-avatar--1">DG</span><span><strong>Diego García</strong><small>Colaborador</small></span></div><button className="agency-button agency-button--secondary"><Plus size={17} />Invitar colaborador</button></section></div></section>
}

function TeamView({ remote, canInvite }: { remote: boolean; canInvite: boolean }) {
  if (remote) return <section className="agency-view"><TeamManager canInvite={canInvite} /></section>
  return <section className="agency-view"><PageHeading eyebrow="PLAN INMOBILIARIA" title="Equipo" description="Reparte anuncios e interesados entre las personas de tu agencia." actions={<button className="agency-button agency-button--primary"><Plus size={18} />Invitar colaborador</button>} /><div className="agency-team-list"><article><span className="agency-avatar">MS</span><div><strong>Marta Soler</strong><small>marta@casabarrio.es</small></div><StatusBadge status="Seleccionado" /><span>Administradora</span><button className="agency-icon-button" aria-label="Más acciones para Marta Soler"><DotsThree size={20} /></button></article><article><span className="agency-avatar agency-avatar--1">DG</span><div><strong>Diego García</strong><small>diego@casabarrio.es</small></div><StatusBadge status="Publicado" /><span>Colaborador</span><button className="agency-icon-button" aria-label="Más acciones para Diego García"><DotsThree size={20} /></button></article></div></section>
}

function BillingView({ remote }: { remote: boolean }) {
  if (remote) return <section className="agency-view"><PageHeading eyebrow="PLAN Y PAGOS" title="Facturación" description="Consulta tu plan actual y cambia sus límites cuando tu cartera lo necesite." /><PlanManager /></section>
  return <section className="agency-view"><PageHeading eyebrow="PLAN Y PAGOS" title="Facturación" description="Consulta tu prueba, método de pago y próximas facturas." /><section className="agency-billing-hero"><div><span className="agency-billing-badge"><Sparkle size={15} weight="fill" />PRUEBA GRATUITA</span><h2>Inmobiliaria</h2><p>99,99 € / mes después de la prueba</p></div><div><small>Próximo cargo</small><strong>99,99 €</strong><span>06/09/2026</span></div><button className="agency-button agency-button--secondary">Gestionar plan</button></section><div className="agency-settings-grid"><section className="agency-panel-card"><h2>Método de pago</h2><div className="agency-payment-method"><CreditCard size={25} /><span><strong>Visa terminada en 4242</strong><small>Caduca 08/29</small></span><button className="agency-text-button">Actualizar</button></div></section><section className="agency-panel-card"><h2>Tu prueba</h2><p>Te quedan 29 días. Cancela antes del 06/09/2026 para evitar el primer cargo.</p><div className="agency-trial-progress"><span /></div><small>Primer mes gratis. Se requiere tarjeta.</small></section></div></section>
}

function EmptyState({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="agency-empty"><span><MagnifyingGlass size={25} /></span><h2>{title}</h2><p>{description}</p>{action && onAction && <button className="agency-button agency-button--secondary" onClick={onAction}>{action}</button>}</div>
}
