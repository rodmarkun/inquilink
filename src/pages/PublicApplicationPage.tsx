import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bathtub,
  Bed,
  Buildings,
  CalendarBlank,
  Check,
  CheckCircle,
  Clock,
  FileArrowUp,
  FilePdf,
  HouseLine,
  LockKey,
  MapPin,
  ShieldCheck,
  Trash,
  UserCircle,
} from '@phosphor-icons/react'
import './PublicApplicationPage.css'

type AdditionalAdult = {
  id: string
  fullName: string
  email: string
  phone: string
  employmentStatus: string
  employerOrActivity: string
  contractType: string
  netMonthlyIncome: string
}

type FormData = {
  fullName: string
  email: string
  phone: string
  contactChannel: string
  adults: string
  minors: string
  moveInDate: string
  pets: string
  petDetails: string
  message: string
  employmentStatus: string
  employer: string
  contractType: string
  individualIncome: string
  householdIncome: string
  guarantor: string
  availability: string[]
  availabilityNote: string
  privacyConsent: boolean
  marketingConsent: boolean
  additionalAdults: AdditionalAdult[]
}

type DocumentKey = 'payslips' | 'contract' | 'selfEmployed' | 'irpf' | 'employmentHistory' | 'pension' | 'guarantorProof' | 'supporting'
type DocumentCategory = 'payslips' | 'employment_contract' | 'self_employed_income' | 'irpf_tax_return' | 'employment_history' | 'pension_proof' | 'guarantor_proof' | 'supporting'

type UploadedDocument = {
  id: string
  name: string
  size: string
  progress: number
}

type Documents = Record<string, UploadedDocument | null>

type PublicProperty = {
  id: string
  agencyName: string
  internalReference: string
  title: string
  publicLocation: string
  monthlyRentCents: number
  propertyType: string
  bedrooms: number
  bathrooms: number
  floorAreaSqm: number
  availableFrom: string
  description: string
  coverImageUrl: string | null
  requestedDocumentCategories: DocumentCategory[]
  consentVersion: string
}

type ApiErrorPayload = { error?: { code?: string; message?: string } }

const categoryByKey: Record<DocumentKey, DocumentCategory> = {
  payslips: 'payslips',
  contract: 'employment_contract',
  selfEmployed: 'self_employed_income',
  irpf: 'irpf_tax_return',
  employmentHistory: 'employment_history',
  pension: 'pension_proof',
  guarantorProof: 'guarantor_proof',
  supporting: 'supporting',
}
const keyByCategory = Object.fromEntries(Object.entries(categoryByKey).map(([key, category]) => [category, key])) as Record<DocumentCategory, DocumentKey>
const documentCopy: Record<DocumentKey, { title: string; description: string }> = {
  payslips: { title: 'Nóminas recientes', description: 'Añade las nóminas solicitadas por la agencia en un único archivo.' },
  contract: { title: 'Contrato de trabajo', description: 'Documento que acredita tu relación laboral actual.' },
  selfEmployed: { title: 'Justificante para autónomos', description: 'Modelo trimestral, certificado de ingresos u otro justificante.' },
  irpf: { title: 'Declaración de la renta (IRPF)', description: 'Última declaración presentada o certificado tributario equivalente.' },
  employmentHistory: { title: 'Vida laboral', description: 'Informe actualizado emitido por la Seguridad Social.' },
  pension: { title: 'Justificante de pensión', description: 'Certificado o carta de revalorización de la pensión.' },
  guarantorProof: { title: 'Documentación del avalista', description: 'Aval, garantía o documentación económica de la persona avalista.' },
  supporting: { title: 'Otro justificante', description: 'Beca u otro documento que acredite tus recursos.' },
}

const initialData: FormData = {
  fullName: '',
  email: '',
  phone: '',
  contactChannel: '',
  adults: '1',
  minors: '0',
  moveInDate: '',
  pets: '',
  petDetails: '',
  message: '',
  employmentStatus: '',
  employer: '',
  contractType: '',
  individualIncome: '',
  householdIncome: '',
  guarantor: '',
  availability: [],
  availabilityNote: '',
  privacyConsent: false,
  marketingConsent: false,
  additionalAdults: [],
}

const initialDocuments: Documents = {
  'primary:payslips': null,
  'primary:contract': null,
  'primary:selfEmployed': null,
  'primary:irpf': null,
  'primary:employmentHistory': null,
  'primary:pension': null,
  'primary:guarantorProof': null,
  'primary:supporting': null,
}

const documentSlot = (adultProfileId: string, key: DocumentKey) => `${adultProfileId}:${key}`

const steps = [
  { label: 'Contacto', shortLabel: 'Datos' },
  { label: 'Hogar y fechas', shortLabel: 'Hogar' },
  { label: 'Situación económica', shortLabel: 'Economía' },
  { label: 'Documentación', shortLabel: 'Archivos' },
  { label: 'Disponibilidad y privacidad', shortLabel: 'Finalizar' },
]

const availabilityOptions = [
  'Entre semana por la mañana',
  'Entre semana por la tarde',
  'Sábados por la mañana',
]

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

function apiError(payload: ApiErrorPayload, fallback: string) {
  return payload.error?.message ?? fallback
}

function formToApi(data: FormData) {
  const contactChannels: Record<string, 'whatsapp' | 'phone' | 'email'> = { WhatsApp: 'whatsapp', 'Teléfono': 'phone', 'Correo electrónico': 'email' }
  const yesNo: Record<string, 'yes' | 'no'> = { 'Sí': 'yes', No: 'no' }
  const guarantors: Record<string, 'yes' | 'no' | 'unsure'> = { 'Sí': 'yes', No: 'no', 'No estoy seguro': 'unsure' }
  return {
    fullName: data.fullName.trim(), email: data.email.trim().toLowerCase(), phone: data.phone.replace(/\s/g, ''),
    preferredContactChannel: contactChannels[data.contactChannel], adultOccupants: data.adults === '' ? undefined : Number(data.adults), minorOccupants: data.minors === '' ? undefined : Number(data.minors),
    intendedMoveInDate: data.moveInDate, pets: yesNo[data.pets], petDetails: data.petDetails.trim() || null,
    message: data.message.trim() || null, employmentStatus: data.employmentStatus, employerOrActivity: data.employer.trim(),
    contractType: data.contractType, individualNetMonthlyIncomeCents: data.individualIncome === '' ? undefined : Math.round(Number(data.individualIncome) * 100),
    householdNetMonthlyIncomeCents: data.householdIncome === '' ? undefined : Math.round(Number(data.householdIncome) * 100), guarantorAvailability: guarantors[data.guarantor],
    additionalAdults: data.additionalAdults.map((adult) => ({ id: adult.id, fullName: adult.fullName.trim(), email: adult.email.trim().toLowerCase() || null, phone: adult.phone.replace(/\s/g, '') || null, employmentStatus: adult.employmentStatus, employerOrActivity: adult.employerOrActivity.trim(), contractType: adult.contractType, netMonthlyIncomeCents: Math.round(Number(adult.netMonthlyIncome) * 100) })),
    viewingAvailability: data.availability, availabilityNote: data.availabilityNote.trim() || null, marketingConsent: data.marketingConsent,
  }
}

function apiDraftToForm(draft: Record<string, unknown>): Partial<FormData> {
  const contactChannels: Record<string, string> = { whatsapp: 'WhatsApp', phone: 'Teléfono', email: 'Correo electrónico' }
  const yesNo: Record<string, string> = { yes: 'Sí', no: 'No' }
  const guarantors: Record<string, string> = { yes: 'Sí', no: 'No', unsure: 'No estoy seguro' }
  const mapped: Partial<FormData> = {
    fullName: typeof draft.fullName === 'string' ? draft.fullName : undefined,
    email: typeof draft.email === 'string' ? draft.email : undefined,
    phone: typeof draft.phone === 'string' ? draft.phone : undefined,
    contactChannel: typeof draft.preferredContactChannel === 'string' ? contactChannels[draft.preferredContactChannel] : undefined,
    adults: typeof draft.adultOccupants === 'number' ? String(draft.adultOccupants) : undefined,
    minors: typeof draft.minorOccupants === 'number' ? String(draft.minorOccupants) : undefined,
    moveInDate: typeof draft.intendedMoveInDate === 'string' ? draft.intendedMoveInDate : undefined,
    pets: typeof draft.pets === 'string' ? yesNo[draft.pets] : undefined,
    petDetails: typeof draft.petDetails === 'string' ? draft.petDetails : undefined,
    message: typeof draft.message === 'string' ? draft.message : undefined,
    employmentStatus: typeof draft.employmentStatus === 'string' ? draft.employmentStatus : undefined,
    employer: typeof draft.employerOrActivity === 'string' ? draft.employerOrActivity : undefined,
    contractType: typeof draft.contractType === 'string' ? draft.contractType : undefined,
    individualIncome: typeof draft.individualNetMonthlyIncomeCents === 'number' ? String(draft.individualNetMonthlyIncomeCents / 100) : undefined,
    householdIncome: typeof draft.householdNetMonthlyIncomeCents === 'number' ? String(draft.householdNetMonthlyIncomeCents / 100) : undefined,
    guarantor: typeof draft.guarantorAvailability === 'string' ? guarantors[draft.guarantorAvailability] : undefined,
    availability: Array.isArray(draft.viewingAvailability) ? draft.viewingAvailability.filter((value): value is string => typeof value === 'string') : undefined,
    availabilityNote: typeof draft.availabilityNote === 'string' ? draft.availabilityNote : undefined,
    marketingConsent: typeof draft.marketingConsent === 'boolean' ? draft.marketingConsent : undefined,
    additionalAdults: Array.isArray(draft.additionalAdults) ? draft.additionalAdults.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const adult = value as Record<string, unknown>
      if (typeof adult.id !== 'string') return []
      return [{ id: adult.id, fullName: typeof adult.fullName === 'string' ? adult.fullName : '', email: typeof adult.email === 'string' ? adult.email : '', phone: typeof adult.phone === 'string' ? adult.phone : '', employmentStatus: typeof adult.employmentStatus === 'string' ? adult.employmentStatus : '', employerOrActivity: typeof adult.employerOrActivity === 'string' ? adult.employerOrActivity : '', contractType: typeof adult.contractType === 'string' ? adult.contractType : '', netMonthlyIncome: typeof adult.netMonthlyIncomeCents === 'number' ? String(adult.netMonthlyIncomeCents / 100) : '' }]
    }) : undefined,
  }
  return Object.fromEntries(Object.entries(mapped).filter(([, value]) => value !== undefined)) as Partial<FormData>
}

function completeDraft(apiData: ReturnType<typeof formToApi>) {
  return Object.fromEntries(Object.entries(apiData).filter(([, value]) => value !== undefined && value !== ''))
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return window.btoa(binary)
}

function FieldError({ children, id }: { children?: string; id?: string }) {
  if (!children) return null
  return <p className="public-application__field-error" id={id}>{children}</p>
}

function RequiredMark() {
  return <span className="public-application__required" aria-hidden="true">*</span>
}

export function PublicApplicationPage() {
  const token = window.location.pathname.split('/').filter(Boolean).at(-1) ?? ''
  const [step, setStep] = useState(0)
  const [data, setData] = useState<FormData>(initialData)
  const [documents, setDocuments] = useState<Documents>(initialDocuments)
  const [property, setProperty] = useState<PublicProperty | null>(null)
  const [propertyState, setPropertyState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pageError, setPageError] = useState('')
  const [applicationId, setApplicationId] = useState<string | null>(null)
  const [draftReady, setDraftReady] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [fileError, setFileError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [restored, setRestored] = useState(false)
  const [accountReady, setAccountReady] = useState(false)
  const [accountMode, setAccountMode] = useState<'register' | 'login'>('register')
  const [accountName, setAccountName] = useState('')
  const [accountEmail, setAccountEmail] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({})
  const [accountSubmitting, setAccountSubmitting] = useState(false)
  const [verificationSent, setVerificationSent] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)
  const errorSummaryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setPropertyState('loading')
      try {
        const response = await fetch(`/api/v1/public/properties/${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' }, signal: controller.signal })
        const payload = await response.json().catch(() => ({})) as { data?: { property?: PublicProperty } } & ApiErrorPayload
        if (!response.ok || !payload.data?.property) throw new Error(apiError(payload, 'Este enlace no está disponible.'))
        setProperty(payload.data.property)
        setPropertyState('ready')

        const meResponse = await fetch('/api/v1/auth/me', { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal })
        if (!meResponse.ok) return
        const mePayload = await meResponse.json() as { data?: { user?: { kind?: string; email?: string; fullName?: string } } }
        if (mePayload.data?.user?.kind !== 'tenant') {
          setAccountErrors({ form: 'Cierra la sesión de agencia e inicia sesión con una cuenta de inquilino.' })
          return
        }
        setAccountEmail(mePayload.data.user.email ?? '')
        setData((current) => ({ ...current, email: mePayload.data?.user?.email ?? current.email, fullName: mePayload.data?.user?.fullName ?? current.fullName }))
        setAccountReady(true)
      } catch (caught) {
        if (controller.signal.aborted) return
        setPageError(caught instanceof Error ? caught.message : 'No hemos podido cargar este anuncio.')
        setPropertyState('error')
      }
    }
    void load()
    return () => controller.abort()
  }, [token])

  useEffect(() => {
    if (!accountReady || !property || submitted) return
    const controller = new AbortController()
    const loadDraft = async () => {
      setDraftReady(false)
      try {
        const response = await fetch(`/api/v1/tenant/application-drafts/by-link/${encodeURIComponent(token)}`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal })
        const payload = await response.json().catch(() => ({})) as { data?: { application?: { id: string; draftData?: Record<string, unknown>; submittedAt?: string | null } | null } } & ApiErrorPayload
        if (!response.ok) throw new Error(apiError(payload, 'No hemos podido recuperar tu borrador.'))
        const application = payload.data?.application
        if (application) {
          setApplicationId(application.id)
          setData((current) => ({ ...current, ...apiDraftToForm(application.draftData ?? {}) } as FormData))
          if (application.submittedAt) { setSubmitted(true); return }
          setRestored(Object.keys(application.draftData ?? {}).length > 0)
          const documentsResponse = await fetch(`/api/v1/tenant/applications/${encodeURIComponent(application.id)}/documents`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal })
          if (documentsResponse.ok) {
            const documentsPayload = await documentsResponse.json() as { data?: { documents?: Array<{ id: string; adultProfileId: string; category: DocumentCategory; originalName: string; byteSize: number; deletionState: string }> } }
            setDocuments((current) => {
              const next = { ...current }
              for (const item of documentsPayload.data?.documents ?? []) {
                const key = documentSlot(item.adultProfileId ?? 'primary', keyByCategory[item.category])
                if (item.deletionState === 'active' && !next[key]) next[key] = { id: item.id, name: item.originalName, size: formatFileSize(item.byteSize), progress: 100 }
              }
              return next
            })
          }
        }
        setDraftReady(true)
      } catch (caught) {
        if (!controller.signal.aborted) setPageError(caught instanceof Error ? caught.message : 'No hemos podido recuperar tu borrador.')
      }
    }
    void loadDraft()
    return () => controller.abort()
  }, [accountReady, property, submitted, token])

  useEffect(() => {
    if (!accountReady || !property || !draftReady || submitted) return
    const timer = window.setTimeout(async () => {
      setSaveState('saving')
      try {
        const response = await fetch(`/api/v1/tenant/application-drafts/by-link/${encodeURIComponent(token)}`, { method: 'PUT', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(completeDraft(formToApi(data))) })
        const payload = await response.json().catch(() => ({})) as { data?: { applicationId?: string } } & ApiErrorPayload
        if (!response.ok || !payload.data?.applicationId) throw new Error(apiError(payload, 'No hemos podido guardar el progreso.'))
        setApplicationId(payload.data.applicationId)
        setSaveState('saved')
      } catch (caught) {
        setSaveState('error')
        setPageError(caught instanceof Error ? caught.message : 'No hemos podido guardar el progreso.')
      }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [accountReady, data, draftReady, property, step, submitted, token])

  useEffect(() => {
    if (!submitted) headingRef.current?.focus()
  }, [step, submitted])

  useEffect(() => {
    if (submitted) successHeadingRef.current?.focus()
  }, [submitted])

  useEffect(() => {
    if (Object.keys(errors).length > 0 || fileError) errorSummaryRef.current?.focus()
  }, [errors, fileError])

  const updateField = (field: keyof FormData, value: string | boolean | string[]) => {
    setData((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const updateAdultCount = (value: string) => {
    const count = Math.max(1, Math.min(20, Number(value) || 1))
    setData((current) => {
      const needed = count - 1
      const removed = current.additionalAdults.slice(needed)
      if (removed.some((adult) => Object.entries(documents).some(([slot, document]) => slot.startsWith(`${adult.id}:`) && Boolean(document)))) {
        setErrors((currentErrors) => ({ ...currentErrors, adults: 'Elimina primero los documentos de la persona adulta que quieres quitar.' }))
        return current
      }
      const additionalAdults = current.additionalAdults.slice(0, needed)
      while (additionalAdults.length < needed) additionalAdults.push({ id: crypto.randomUUID(), fullName: '', email: '', phone: '', employmentStatus: '', employerOrActivity: '', contractType: '', netMonthlyIncome: '' })
      return { ...current, adults: value, additionalAdults }
    })
  }

  const updateAdditionalAdult = (id: string, field: keyof Omit<AdditionalAdult, 'id'>, value: string) => {
    setData((current) => ({ ...current, additionalAdults: current.additionalAdults.map((adult) => adult.id === id ? { ...adult, [field]: value } : adult) }))
  }

  const validateStep = () => {
    const nextErrors: Record<string, string> = {}

    if (step === 0) {
      if (!data.fullName.trim()) nextErrors.fullName = 'Escribe tu nombre y apellidos.'
      if (!data.email.trim()) nextErrors.email = 'Escribe tu correo electrónico.'
      else if (!/^\S+@\S+\.\S+$/.test(data.email)) nextErrors.email = 'Introduce un correo electrónico válido.'
      if (!data.phone.trim()) nextErrors.phone = 'Escribe tu número de teléfono.'
      else if (!/^\+[1-9]\d{7,14}$/.test(data.phone.replace(/\s/g, ''))) nextErrors.phone = 'Incluye un teléfono válido con el prefijo del país.'
      if (!data.contactChannel) nextErrors.contactChannel = 'Elige cómo prefieres que te contactemos.'
    }

    if (step === 1) {
      if (!data.adults || !Number.isInteger(Number(data.adults)) || Number(data.adults) < 1) nextErrors.adults = 'Indica un número entero de personas adultas.'
      if (data.minors === '' || !Number.isInteger(Number(data.minors)) || Number(data.minors) < 0) nextErrors.minors = 'Indica un número entero de personas menores.'
      if (!data.moveInDate) nextErrors.moveInDate = 'Selecciona tu fecha prevista de entrada.'
      if (!data.pets) nextErrors.pets = 'Indica si convivirán mascotas en la vivienda.'
      if (data.pets === 'Sí' && !data.petDetails.trim()) nextErrors.petDetails = 'Cuéntanos qué mascota convivirá contigo.'
    }

    if (step === 2) {
      if (!data.employmentStatus) nextErrors.employmentStatus = 'Selecciona tu situación laboral.'
      if (!data.employer.trim()) nextErrors.employer = 'Escribe la empresa o actividad profesional.'
      if (!data.contractType) nextErrors.contractType = 'Selecciona tu tipo de contrato o situación.'
      if (!data.individualIncome || Number(data.individualIncome) <= 0) nextErrors.individualIncome = 'Indica tus ingresos netos mensuales.'
      if (!data.householdIncome || Number(data.householdIncome) <= 0) nextErrors.householdIncome = 'Indica los ingresos netos mensuales del hogar.'
      if (!data.guarantor) nextErrors.guarantor = 'Indica si dispones de avalista.'
      for (const adult of data.additionalAdults) {
        if (!adult.fullName.trim() || !adult.employmentStatus || !adult.employerOrActivity.trim() || !adult.contractType || !adult.netMonthlyIncome || Number(adult.netMonthlyIncome) < 0) nextErrors[`adult-${adult.id}`] = 'Completa la identidad y situación económica de esta persona adulta.'
        if (adult.email && !/^\S+@\S+\.\S+$/.test(adult.email)) nextErrors[`adult-${adult.id}`] = 'Revisa el correo de esta persona adulta.'
        if (adult.phone && !/^\+[1-9]\d{7,14}$/.test(adult.phone.replace(/\s/g, ''))) nextErrors[`adult-${adult.id}`] = 'Revisa el teléfono de esta persona adulta.'
      }
    }

    if (step === 3) {
      for (const category of property?.requestedDocumentCategories ?? []) {
        const key = keyByCategory[category]
        for (const adultProfileId of ['primary', ...data.additionalAdults.map((adult) => adult.id)]) {
          const slot = documentSlot(adultProfileId, key)
          if (!documents[slot]) nextErrors[slot] = `Añade ${documentCopy[key].title.toLowerCase()} para cada persona adulta.`
          else if (documents[slot]!.progress < 100) nextErrors[slot] = `Espera a que termine de subirse ${documentCopy[key].title.toLowerCase()}.`
        }
      }
    }

    if (step === 4) {
      if (data.availability.length === 0) nextErrors.availability = 'Selecciona al menos una franja para visitar la vivienda.'
      if (!data.privacyConsent) nextErrors.privacyConsent = 'Debes aceptar el tratamiento de tus datos para enviar la solicitud.'
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const nextStep = () => {
    setFileError('')
    if (!validateStep()) return
    setStep((current) => Math.min(current + 1, steps.length - 1))
  }

  const previousStep = () => {
    setErrors({})
    setFileError('')
    setStep((current) => Math.max(current - 1, 0))
  }

  const saveDraftNow = async () => {
    const response = await fetch(`/api/v1/tenant/application-drafts/by-link/${encodeURIComponent(token)}`, { method: 'PUT', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(completeDraft(formToApi(data))) })
    const payload = await response.json().catch(() => ({})) as { data?: { applicationId?: string } } & ApiErrorPayload
    if (!response.ok || !payload.data?.applicationId) throw new Error(apiError(payload, 'No hemos podido guardar el borrador antes de subir el archivo.'))
    setApplicationId(payload.data.applicationId)
    return payload.data.applicationId
  }

  const handleFile = async (adultProfileId: string, key: DocumentKey, event: ChangeEvent<HTMLInputElement>) => {
    const slot = documentSlot(adultProfileId, key)
    const file = event.target.files?.[0]
    setFileError('')
    setErrors((current) => {
      const next = { ...current }
      delete next[slot]
      return next
    })
    if (!file) return

    const acceptedTypes = ['application/pdf', 'image/jpeg', 'image/png']
    const acceptedExtensions = ['pdf', 'jpg', 'jpeg', 'png']
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if ((!file.type || !acceptedTypes.includes(file.type)) && !acceptedExtensions.includes(extension)) {
      setFileError(`No hemos podido añadir ${file.name}. Usa un archivo PDF, JPG o PNG.`)
      event.target.value = ''
      return
    }
    if (file.size === 0) {
      setFileError(`${file.name} está vacío o no se ha podido leer. Comprueba el archivo e inténtalo de nuevo.`)
      event.target.value = ''
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileError(`${file.name} supera el máximo permitido de 10 MB.`)
      event.target.value = ''
      return
    }

    setDocuments((current) => ({ ...current, [slot]: { id: '', name: file.name, size: formatFileSize(file.size), progress: 15 } }))
    try {
      const draftId = applicationId ?? await saveDraftNow()
      setDocuments((current) => ({ ...current, [slot]: current[slot] ? { ...current[slot]!, progress: 55 } : null }))
      const response = await fetch(`/api/v1/tenant/applications/${encodeURIComponent(draftId)}/documents`, {
        method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ adultProfileId, category: categoryByKey[key], originalName: file.name, contentType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'), dataBase64: await fileToBase64(file) }),
      })
      const payload = await response.json().catch(() => ({})) as { data?: { document?: { id?: string } } } & ApiErrorPayload
      if (!response.ok || !payload.data?.document?.id) throw new Error(apiError(payload, 'No hemos podido subir el archivo.'))
      setDocuments((current) => ({ ...current, [slot]: { id: payload.data!.document!.id!, name: file.name, size: formatFileSize(file.size), progress: 100 } }))
    } catch (caught) {
      setDocuments((current) => ({ ...current, [slot]: null }))
      setFileError(caught instanceof Error ? caught.message : 'No hemos podido subir el archivo.')
      event.target.value = ''
    }
  }

  const removeFile = async (adultProfileId: string, key: DocumentKey) => {
    const slot = documentSlot(adultProfileId, key)
    const document = documents[slot]
    if (!document || !applicationId || !document.id) return
    setFileError('')
    try {
      const response = await fetch(`/api/v1/tenant/applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(document.id)}`, { method: 'DELETE', credentials: 'include', headers: { Accept: 'application/json' } })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as ApiErrorPayload
        throw new Error(apiError(payload, 'No hemos podido eliminar el archivo.'))
      }
      setDocuments((current) => ({ ...current, [slot]: null }))
    } catch (caught) { setFileError(caught instanceof Error ? caught.message : 'No hemos podido eliminar el archivo.') }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!validateStep() || isSubmitting || !property) return
    setIsSubmitting(true)
    setPageError('')
    try {
      const submissionStorageKey = `inquilink-submission:${property.id}`
      const submissionKey = window.sessionStorage.getItem(submissionStorageKey) ?? crypto.randomUUID()
      window.sessionStorage.setItem(submissionStorageKey, submissionKey)
      const response = await fetch(`/api/v1/tenant/applications/by-link/${encodeURIComponent(token)}/submit`, {
        method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': submissionKey },
        body: JSON.stringify({ application: formToApi(data), consentVersion: property.consentVersion, privacyConsent: true, submissionKey }),
      })
      const payload = await response.json().catch(() => ({})) as ApiErrorPayload
      if (!response.ok) throw new Error(apiError(payload, 'No hemos podido enviar la solicitud.'))
      setIsSubmitting(false)
      setSubmitted(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (caught) {
      setIsSubmitting(false)
      setPageError(caught instanceof Error ? caught.message : 'No hemos podido enviar la solicitud.')
      errorSummaryRef.current?.focus()
    }
  }

  const handleAccountSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: Record<string, string> = {}

    if (accountMode === 'register' && !accountName.trim()) nextErrors.name = 'Escribe tu nombre y apellidos.'
    if (!/^\S+@\S+\.\S+$/.test(accountEmail)) nextErrors.email = 'Introduce un correo electrónico válido.'
    if (accountPassword.length < 10) nextErrors.password = 'La contraseña debe tener al menos 10 caracteres.'

    setAccountErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setAccountSubmitting(true)
    try {
      const endpoint = accountMode === 'register' ? '/api/v1/auth/tenant/register' : '/api/v1/auth/login'
      const body = accountMode === 'register'
        ? { fullName: accountName.trim(), email: accountEmail.trim(), password: accountPassword, termsAccepted: true, termsVersion: 'terms-2026-08-v1', returnPath: `/solicitud/${token}` }
        : { email: accountEmail.trim(), password: accountPassword, accountType: 'tenant', returnPath: `/solicitud/${token}` }
      const response = await fetch(endpoint, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const payload = await response.json().catch(() => ({})) as ApiErrorPayload
      if (!response.ok) throw new Error(apiError(payload, 'No hemos podido acceder a tu cuenta.'))
      if (accountMode === 'register') { setVerificationSent(true); return }
      setData((current) => ({ ...current, email: accountEmail.trim().toLowerCase() }))
      setAccountReady(true)
    } catch (caught) {
      setAccountErrors({ form: caught instanceof Error ? caught.message : 'No hemos podido acceder a tu cuenta.' })
    } finally { setAccountSubmitting(false) }
  }

  if (propertyState === 'loading') return <main className="public-application public-application--success"><section className="public-application__success" aria-live="polite"><div className="public-application__loading" aria-hidden="true" /><h1>Cargando la vivienda</h1><p>Estamos comprobando el enlace seguro.</p></section></main>

  if (propertyState === 'error' || !property) {
    return (
      <main className="public-application public-application--success">
        <section className="public-application__success" aria-labelledby="invalid-link-title">
          <span className="public-application__success-icon public-application__success-icon--muted" aria-hidden="true"><HouseLine weight="fill" /></span>
          <p className="public-application__success-kicker">Enlace no disponible</p>
          <h1 id="invalid-link-title">Esta solicitud ya no está activa.</h1>
          <p>{pageError || 'El enlace puede haber caducado, estar pausado o haber sido sustituido. Pide a la inmobiliaria un enlace actualizado.'}</p>
          <a className="public-application__button public-application__button--primary" href="/">Ir a Inquilink</a>
        </section>
      </main>
    )
  }

  const toggleAvailability = (value: string) => {
    const next = data.availability.includes(value)
      ? data.availability.filter((item) => item !== value)
      : [...data.availability, value]
    updateField('availability', next)
  }

  if (submitted) {
    return (
      <main className="public-application public-application--success">
        <section className="public-application__success" aria-labelledby="application-success-title" aria-live="polite">
          <span className="public-application__success-icon" aria-hidden="true"><CheckCircle weight="fill" /></span>
          <p className="public-application__success-kicker">Solicitud enviada</p>
          <h1 id="application-success-title" ref={successHeadingRef} tabIndex={-1}>Gracias, {data.fullName.split(' ')[0]}.</h1>
          <p>Hemos enviado tu solicitud a {property.agencyName}. Recibirás una copia en <strong>{data.email}</strong>.</p>
          <div className="public-application__success-property">
            <HouseLine aria-hidden="true" />
            <span><strong>{property.title}</strong><small>Referencia {property.internalReference}</small></span>
          </div>
          <div className="public-application__success-note">
            <Clock aria-hidden="true" />
            <p><strong>¿Qué ocurre ahora?</strong><br />La agencia revisará tu información y te contactará por {data.contactChannel.toLowerCase()}.</p>
          </div>
          <p className="public-application__success-help">Puedes consultar esta candidatura desde tu cuenta. Tus documentos solo son accesibles para ti y para el equipo responsable de esta vivienda.</p>
        </section>
      </main>
    )
  }

  return (
    <div className="public-application">
      <a className="public-application__skip" href="#formulario-solicitud">Saltar al formulario</a>
      <header className="public-application__header">
        <a className="public-application__brand" href="/" aria-label="Inquilink, página de inicio">
          <span aria-hidden="true">i</span> Inquilink
        </a>
        <div className="public-application__agency">
          <span className="public-application__agency-mark" aria-hidden="true">A</span>
          <span><small>Gestionado por</small><strong>{property.agencyName}</strong></span>
        </div>
      </header>

      <main className="public-application__layout">
        <aside className="public-application__property" aria-labelledby="property-title">
          <div className="public-application__property-image">
            <img
              src={property.coverImageUrl ?? '/assets/inquilink-hero.webp'}
              alt={`Imagen de ${property.title}`}
              width="1200"
              height="800"
            />
          </div>
          <div className="public-application__property-copy">
            <span className="public-application__reference">Referencia {property.internalReference}</span>
            <h1 id="property-title">{property.title}</h1>
            <p className="public-application__location"><MapPin aria-hidden="true" /> {property.publicLocation}</p>
            <div className="public-application__property-facts" aria-label="Características principales">
              <strong>{new Intl.NumberFormat('es-ES').format(property.monthlyRentCents / 100)} €<small>/ mes</small></strong>
              <span><Bed aria-hidden="true" /> {property.bedrooms} habitaciones</span>
              <span><Bathtub aria-hidden="true" /> {property.bathrooms} baños</span>
              <span><Buildings aria-hidden="true" /> {property.floorAreaSqm} m²</span>
            </div>
            <p className="public-application__description">{property.description}</p>
            <div className="public-application__property-meta">
              <span><CalendarBlank aria-hidden="true" /><small>Disponible</small><strong>{new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC' }).format(new Date(`${property.availableFrom}T00:00:00Z`))}</strong></span>
              <span><Clock aria-hidden="true" /><small>Tiempo estimado</small><strong>8 minutos</strong></span>
            </div>
          </div>
        </aside>

        <section className="public-application__form-card" id="formulario-solicitud" aria-labelledby="step-heading">
          {!accountReady ? (
            <div className="public-application__account-gate">
              <span className="public-application__account-icon" aria-hidden="true"><UserCircle weight="fill" /></span>
              <p className="public-application__step-count">Cuenta de interesado</p>
              <h2 id="step-heading">{verificationSent ? 'Verifica tu correo para continuar.' : accountMode === 'register' ? 'Crea tu cuenta para solicitar la vivienda.' : 'Inicia sesión para continuar.'}</h2>
              <p>{verificationSent ? `Hemos enviado un enlace seguro a ${accountEmail}. Al abrirlo volverás a esta solicitud.` : 'Tu cuenta protege la documentación, guarda el progreso y reúne tus candidaturas en un solo lugar.'}</p>

              {!verificationSent && <><div className="public-application__account-switch" aria-label="Tipo de acceso">
                <button className={accountMode === 'register' ? 'is-active' : ''} type="button" onClick={() => { setAccountMode('register'); setAccountErrors({}) }}>Crear cuenta</button>
                <button className={accountMode === 'login' ? 'is-active' : ''} type="button" onClick={() => { setAccountMode('login'); setAccountErrors({}) }}>Ya tengo cuenta</button>
              </div>

              {Object.keys(accountErrors).length > 0 && (
                <div className="public-application__error-summary" role="alert">
                  <strong>Revisa los datos de acceso</strong>
                  <p>Hay campos pendientes antes de continuar.</p>
                </div>
              )}

              <form className="public-application__account-form" onSubmit={handleAccountSubmit} noValidate>
                {accountErrors.form && <div className="public-application__error-summary" role="alert"><strong>No hemos podido continuar</strong><p>{accountErrors.form}</p></div>}
                {accountMode === 'register' && (
                  <label className="public-application__field">
                    <span>Nombre y apellidos <RequiredMark /></span>
                    <input autoComplete="name" value={accountName} onChange={(event) => setAccountName(event.target.value)} aria-invalid={Boolean(accountErrors.name)} aria-describedby="account-name-error" />
                    <FieldError id="account-name-error">{accountErrors.name}</FieldError>
                  </label>
                )}
                <label className="public-application__field">
                  <span>Correo electrónico <RequiredMark /></span>
                  <input type="email" autoComplete="email" inputMode="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} aria-invalid={Boolean(accountErrors.email)} aria-describedby="account-email-error" />
                  <FieldError id="account-email-error">{accountErrors.email}</FieldError>
                </label>
                <label className="public-application__field">
                  <span>Contraseña <RequiredMark /></span>
                  <input type="password" autoComplete={accountMode === 'register' ? 'new-password' : 'current-password'} value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} aria-invalid={Boolean(accountErrors.password)} aria-describedby="account-password-help account-password-error" />
                  <small id="account-password-help">Mínimo 10 caracteres.</small>
                  <FieldError id="account-password-error">{accountErrors.password}</FieldError>
                </label>
                {accountMode === 'register' && <p className="public-application__account-terms">Al crear la cuenta aceptas los <a href="/legal/terminos" target="_blank" rel="noreferrer">términos de servicio</a> y la <a href="/legal/privacidad" target="_blank" rel="noreferrer">política de privacidad</a>.</p>}
                <button className="public-application__button public-application__button--primary" type="submit">
                  {accountSubmitting ? 'Conectando...' : accountMode === 'register' ? 'Crear cuenta y continuar' : 'Iniciar sesión'} {!accountSubmitting && <ArrowRight aria-hidden="true" />}
                </button>
              </form>
              </>}

              {verificationSent && <div className="public-application__account-security"><ShieldCheck aria-hidden="true" /><p><strong>Revisa también la carpeta de correo no deseado.</strong><br />Puedes cerrar esta pestaña. El enlace del correo recuperará esta vivienda.</p></div>}

              <div className="public-application__account-security">
                <LockKey aria-hidden="true" />
                <p><strong>Acceso protegido</strong><br />La agencia no verá tu contraseña. Solo recibirá los datos que envíes con la solicitud.</p>
              </div>
            </div>
          ) : (
          <>
          <div className="public-application__form-top">
            <div>
              <p className="public-application__step-count">Paso {step + 1} de {steps.length}</p>
              <h2 id="step-heading" ref={headingRef} tabIndex={-1}>{steps[step].label}</h2>
            </div>
            <span className={`public-application__saved ${saveState === 'error' ? 'is-error' : ''}`}><Check aria-hidden="true" /> {saveState === 'saving' ? 'Guardando...' : saveState === 'error' ? 'Sin guardar' : 'Progreso guardado'}</span>
          </div>

          <nav className="public-application__progress" aria-label="Progreso de la solicitud">
            <ol>
              {steps.map((item, index) => (
                <li className={index === step ? 'is-current' : index < step ? 'is-complete' : ''} key={item.label}>
                  <span aria-current={index === step ? 'step' : undefined}>
                    {index < step ? <Check aria-hidden="true" /> : index + 1}
                  </span>
                  <small>{item.shortLabel}</small>
                </li>
              ))}
            </ol>
          </nav>

          {restored && (
            <div className="public-application__restored" role="status">
              <CheckCircle aria-hidden="true" /> Hemos recuperado el progreso guardado en este dispositivo.
              <button type="button" onClick={() => setRestored(false)} aria-label="Cerrar aviso de progreso recuperado">Cerrar</button>
            </div>
          )}

          {(Object.keys(errors).length > 0 || fileError || pageError) && (
            <div className="public-application__error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef}>
              <strong>Revisa la información marcada</strong>
              <p>{fileError || pageError || `Hay ${Object.keys(errors).length} ${Object.keys(errors).length === 1 ? 'campo pendiente' : 'campos pendientes'} antes de continuar.`}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
            {step === 0 && (
              <div className="public-application__step-fields">
                <p className="public-application__intro">La agencia utilizará estos datos para informarte sobre esta vivienda.</p>
                <label className="public-application__field">
                  <span>Nombre y apellidos <RequiredMark /></span>
                  <input required autoComplete="name" value={data.fullName} onChange={(event) => updateField('fullName', event.target.value)} aria-invalid={Boolean(errors.fullName)} aria-describedby={errors.fullName ? 'fullName-error' : undefined} />
                  <FieldError id="fullName-error">{errors.fullName}</FieldError>
                </label>
                <div className="public-application__field-grid">
                  <label className="public-application__field">
                    <span>Correo electrónico <RequiredMark /></span>
                    <input required type="email" autoComplete="email" inputMode="email" value={data.email} onChange={(event) => updateField('email', event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined} />
                    <FieldError id="email-error">{errors.email}</FieldError>
                  </label>
                  <label className="public-application__field">
                    <span>Teléfono con prefijo <RequiredMark /></span>
                    <input required type="tel" autoComplete="tel" inputMode="tel" placeholder="+34 612 345 678" value={data.phone} onChange={(event) => updateField('phone', event.target.value)} aria-invalid={Boolean(errors.phone)} aria-describedby="phone-help phone-error" />
                    <small id="phone-help">Incluye el prefijo del país.</small>
                    <FieldError id="phone-error">{errors.phone}</FieldError>
                  </label>
                </div>
                <fieldset className="public-application__fieldset" aria-required="true" aria-invalid={Boolean(errors.contactChannel)} aria-describedby={errors.contactChannel ? 'contact-error' : undefined}>
                  <legend>¿Cómo prefieres que te contactemos? <RequiredMark /></legend>
                  <div className="public-application__choice-row">
                    {['WhatsApp', 'Teléfono', 'Correo electrónico'].map((channel) => (
                      <label className="public-application__choice" key={channel}>
                        <input required type="radio" name="contactChannel" value={channel} checked={data.contactChannel === channel} onChange={(event) => updateField('contactChannel', event.target.value)} />
                        <span>{channel}</span>
                      </label>
                    ))}
                  </div>
                  <FieldError id="contact-error">{errors.contactChannel}</FieldError>
                </fieldset>
              </div>
            )}

            {step === 1 && (
              <div className="public-application__step-fields">
                <p className="public-application__intro">Solo necesitamos saber quién vivirá en la vivienda y cuándo os gustaría entrar.</p>
                <div className="public-application__field-grid">
                  <label className="public-application__field">
                    <span>Personas adultas <RequiredMark /></span>
                    <input required type="number" min="1" max="20" step="1" inputMode="numeric" value={data.adults} onChange={(event) => updateAdultCount(event.target.value)} aria-invalid={Boolean(errors.adults)} aria-describedby="adults-error" />
                    <FieldError id="adults-error">{errors.adults}</FieldError>
                  </label>
                  <label className="public-application__field">
                    <span>Personas menores <RequiredMark /></span>
                    <input required type="number" min="0" step="1" inputMode="numeric" value={data.minors} onChange={(event) => updateField('minors', event.target.value)} aria-invalid={Boolean(errors.minors)} aria-describedby="minors-error" />
                    <FieldError id="minors-error">{errors.minors}</FieldError>
                  </label>
                </div>
                <label className="public-application__field">
                  <span>Fecha prevista de entrada <RequiredMark /></span>
                  <input required type="date" value={data.moveInDate} onChange={(event) => updateField('moveInDate', event.target.value)} aria-invalid={Boolean(errors.moveInDate)} aria-describedby="moveInDate-error" />
                  <FieldError id="moveInDate-error">{errors.moveInDate}</FieldError>
                </label>
                <fieldset className="public-application__fieldset" aria-required="true" aria-invalid={Boolean(errors.pets)} aria-describedby="pets-error">
                  <legend>¿Convivirán mascotas en la vivienda? <RequiredMark /></legend>
                  <div className="public-application__choice-row">
                    {['Sí', 'No'].map((answer) => (
                      <label className="public-application__choice" key={answer}>
                        <input required type="radio" name="pets" value={answer} checked={data.pets === answer} onChange={(event) => updateField('pets', event.target.value)} />
                        <span>{answer}</span>
                      </label>
                    ))}
                  </div>
                  <FieldError id="pets-error">{errors.pets}</FieldError>
                </fieldset>
                {data.pets === 'Sí' && (
                  <label className="public-application__field">
                    <span>Cuéntanos qué mascota</span>
                    <input required value={data.petDetails} onChange={(event) => updateField('petDetails', event.target.value)} aria-invalid={Boolean(errors.petDetails)} aria-describedby="petDetails-error" placeholder="Por ejemplo, un perro mestizo de tamaño mediano" />
                    <FieldError id="petDetails-error">{errors.petDetails}</FieldError>
                  </label>
                )}
                <label className="public-application__field">
                  <span>Mensaje para la agencia <small>Opcional</small></span>
                  <textarea rows={3} value={data.message} onChange={(event) => updateField('message', event.target.value)} placeholder="Añade cualquier información que pueda ayudar a valorar tu solicitud" />
                </label>
              </div>
            )}

            {step === 2 && (
              <div className="public-application__step-fields">
                <p className="public-application__intro">Estos datos ayudan a la agencia a conocer la capacidad económica del hogar. No se usan para tomar decisiones automáticas.</p>
                <label className="public-application__field">
                  <span>Situación laboral <RequiredMark /></span>
                  <select required value={data.employmentStatus} onChange={(event) => updateField('employmentStatus', event.target.value)} aria-invalid={Boolean(errors.employmentStatus)} aria-describedby="employmentStatus-error">
                    <option value="">Selecciona una opción</option>
                    <option>Trabajo por cuenta ajena</option>
                    <option>Trabajo por cuenta propia</option>
                    <option>Estudiante</option>
                    <option>Pensionista</option>
                    <option>Otra situación</option>
                  </select>
                  <FieldError id="employmentStatus-error">{errors.employmentStatus}</FieldError>
                </label>
                <div className="public-application__field-grid">
                  <label className="public-application__field">
                    <span>Empresa o actividad <RequiredMark /></span>
                    <input required value={data.employer} onChange={(event) => updateField('employer', event.target.value)} aria-invalid={Boolean(errors.employer)} aria-describedby="employer-error" />
                    <FieldError id="employer-error">{errors.employer}</FieldError>
                  </label>
                  <label className="public-application__field">
                    <span>Tipo de contrato <RequiredMark /></span>
                    <select required value={data.contractType} onChange={(event) => updateField('contractType', event.target.value)} aria-invalid={Boolean(errors.contractType)} aria-describedby="contractType-error">
                      <option value="">Selecciona una opción</option>
                      <option>Indefinido</option>
                      <option>Temporal</option>
                      <option>Autónomo</option>
                      <option>Beca o prácticas</option>
                      <option>No aplica</option>
                    </select>
                    <FieldError id="contractType-error">{errors.contractType}</FieldError>
                  </label>
                </div>
                <div className="public-application__field-grid">
                  <label className="public-application__field">
                    <span>Ingresos netos mensuales <RequiredMark /></span>
                    <div className="public-application__input-suffix"><input required type="number" min="0" step="50" inputMode="numeric" value={data.individualIncome} onChange={(event) => updateField('individualIncome', event.target.value)} aria-invalid={Boolean(errors.individualIncome)} aria-describedby="individualIncome-help individualIncome-error" /><span>€</span></div>
                    <small id="individualIncome-help">Solo tus ingresos.</small>
                    <FieldError id="individualIncome-error">{errors.individualIncome}</FieldError>
                  </label>
                  <label className="public-application__field">
                    <span>Ingresos netos del hogar <RequiredMark /></span>
                    <div className="public-application__input-suffix"><input required type="number" min="0" step="50" inputMode="numeric" value={data.householdIncome} onChange={(event) => updateField('householdIncome', event.target.value)} aria-invalid={Boolean(errors.householdIncome)} aria-describedby="householdIncome-help householdIncome-error" /><span>€</span></div>
                    <small id="householdIncome-help">Suma de todas las personas adultas.</small>
                    <FieldError id="householdIncome-error">{errors.householdIncome}</FieldError>
                  </label>
                </div>
                {data.additionalAdults.map((adult, index) => (
                  <fieldset className="public-application__adult-card" key={adult.id} aria-describedby={`adult-${adult.id}-error`}>
                    <legend>Persona adulta {index + 2}</legend>
                    <p>Sus datos se guardan dentro de esta solicitud; no necesita crear otra cuenta.</p>
                    <div className="public-application__field-grid">
                      <label className="public-application__field"><span>Nombre y apellidos <RequiredMark /></span><input required value={adult.fullName} onChange={(event) => updateAdditionalAdult(adult.id, 'fullName', event.target.value)} /></label>
                      <label className="public-application__field"><span>Correo <small>Opcional</small></span><input type="email" value={adult.email} onChange={(event) => updateAdditionalAdult(adult.id, 'email', event.target.value)} /></label>
                      <label className="public-application__field"><span>Teléfono <small>Opcional</small></span><input type="tel" placeholder="+34 612 345 678" value={adult.phone} onChange={(event) => updateAdditionalAdult(adult.id, 'phone', event.target.value)} /></label>
                      <label className="public-application__field"><span>Situación laboral <RequiredMark /></span><select required value={adult.employmentStatus} onChange={(event) => updateAdditionalAdult(adult.id, 'employmentStatus', event.target.value)}><option value="">Selecciona una opción</option><option>Trabajo por cuenta ajena</option><option>Trabajo por cuenta propia</option><option>Estudiante</option><option>Pensionista</option><option>Otra situación</option></select></label>
                      <label className="public-application__field"><span>Empresa o actividad <RequiredMark /></span><input required value={adult.employerOrActivity} onChange={(event) => updateAdditionalAdult(adult.id, 'employerOrActivity', event.target.value)} /></label>
                      <label className="public-application__field"><span>Tipo de contrato <RequiredMark /></span><select required value={adult.contractType} onChange={(event) => updateAdditionalAdult(adult.id, 'contractType', event.target.value)}><option value="">Selecciona una opción</option><option>Indefinido</option><option>Temporal</option><option>Autónomo</option><option>Beca o prácticas</option><option>No aplica</option></select></label>
                      <label className="public-application__field"><span>Ingresos netos mensuales <RequiredMark /></span><div className="public-application__input-suffix"><input required type="number" min="0" step="50" value={adult.netMonthlyIncome} onChange={(event) => updateAdditionalAdult(adult.id, 'netMonthlyIncome', event.target.value)} /><span>€</span></div></label>
                    </div>
                    <FieldError id={`adult-${adult.id}-error`}>{errors[`adult-${adult.id}`]}</FieldError>
                  </fieldset>
                ))}
                <fieldset className="public-application__fieldset" aria-required="true" aria-invalid={Boolean(errors.guarantor)} aria-describedby="guarantor-error">
                  <legend>¿Dispones de avalista? <RequiredMark /></legend>
                  <div className="public-application__choice-row">
                    {['Sí', 'No', 'No estoy seguro'].map((answer) => (
                      <label className="public-application__choice" key={answer}>
                        <input required type="radio" name="guarantor" value={answer} checked={data.guarantor === answer} onChange={(event) => updateField('guarantor', event.target.value)} />
                        <span>{answer}</span>
                      </label>
                    ))}
                  </div>
                  <FieldError id="guarantor-error">{errors.guarantor}</FieldError>
                </fieldset>
              </div>
            )}

            {step === 3 && (
              <div className="public-application__step-fields">
                <div className="public-application__privacy-note">
                  <ShieldCheck aria-hidden="true" />
                  <p><strong>Documentos privados</strong><br />Solo el equipo responsable de {property.agencyName} puede acceder a ellos para revisar tu solvencia.</p>
                </div>
                <p className="public-application__format-note">Formatos permitidos: PDF, JPG y PNG. Tamaño máximo: 10 MB por archivo. Inquilink vuelve a validar cada archivo de forma segura al enviarlo.</p>
                {property.requestedDocumentCategories.length === 0 && <div className="public-application__privacy-note"><CheckCircle aria-hidden="true" /><p><strong>No se solicita documentación</strong><br />Puedes continuar al último paso.</p></div>}
                {([{ id: 'primary', fullName: data.fullName || 'Solicitante principal' }, ...data.additionalAdults] as Array<{ id: string; fullName: string }>).map((adult, adultIndex) => (
                  <section className="public-application__adult-documents" key={adult.id} aria-labelledby={`documents-${adult.id}`}>
                    <h3 id={`documents-${adult.id}`}>{adultIndex === 0 ? 'Tu documentación' : `Documentación de ${adult.fullName}`}</h3>
                    {property.requestedDocumentCategories.map((category) => {
                      const key = keyByCategory[category]
                      const slot = documentSlot(adult.id, key)
                      const { title, description } = documentCopy[key]
                      const file = documents[slot]
                      return (
                        <div className="public-application__upload" key={slot} role="group" aria-labelledby={`${slot}-title`} aria-describedby={`${slot}-description ${slot}-error`}>
                          <div className="public-application__upload-copy"><FilePdf aria-hidden="true" /><span><strong id={`${slot}-title`}>{title} <RequiredMark /></strong><small id={`${slot}-description`}>{description}</small></span></div>
                          {file ? <div className="public-application__file" role="status"><span><strong>{file.name}</strong><small>{file.progress < 100 ? `Subiendo ${file.progress}%` : `${file.size} · Archivo listo`}</small>{file.progress < 100 && <progress max="100" value={file.progress} aria-label={`Progreso de subida de ${file.name}`} />}</span><button type="button" onClick={() => void removeFile(adult.id, key)} aria-label={`Eliminar ${file.name}`}><Trash aria-hidden="true" /></button></div>
                            : <label className="public-application__upload-button"><FileArrowUp aria-hidden="true" /> Añadir archivo<input required type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => void handleFile(adult.id, key, event)} /></label>}
                          <FieldError id={`${slot}-error`}>{errors[slot]}</FieldError>
                        </div>
                      )
                    })}
                  </section>
                ))}
              </div>
            )}

            {step === 4 && (
              <div className="public-application__step-fields">
                <p className="public-application__intro">Elige cuándo podrías visitar el piso. La agencia acordará contigo la fecha exacta.</p>
                <fieldset className="public-application__fieldset" aria-required="true" aria-invalid={Boolean(errors.availability)} aria-describedby="availability-error">
                  <legend>Franjas disponibles <RequiredMark /></legend>
                  <div className="public-application__check-list">
                    {availabilityOptions.map((option) => (
                      <label className="public-application__check" key={option}>
                        <input type="checkbox" checked={data.availability.includes(option)} onChange={() => toggleAvailability(option)} />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                  <FieldError id="availability-error">{errors.availability}</FieldError>
                </fieldset>
                <label className="public-application__field">
                  <span>Notas sobre tu disponibilidad <small>Opcional</small></span>
                  <textarea rows={3} value={data.availabilityNote} onChange={(event) => updateField('availabilityNote', event.target.value)} placeholder="Por ejemplo, puedo llegar a partir de las 18:30" />
                </label>
                <div className="public-application__consents">
                  <div className="public-application__consent-row">
                    <input required id="privacy-consent" type="checkbox" checked={data.privacyConsent} onChange={(event) => updateField('privacyConsent', event.target.checked)} aria-invalid={Boolean(errors.privacyConsent)} aria-describedby="privacy-copy privacyConsent-error" />
                    <p id="privacy-copy"><label htmlFor="privacy-consent">Acepto que {property.agencyName} trate mis datos para gestionar esta solicitud.</label> He leído la <a href="/legal/privacidad" target="_blank" rel="noreferrer">política de privacidad<span className="public-application__sr-only">, se abre en una nueva pestaña</span></a>. <RequiredMark /></p>
                  </div>
                  <FieldError id="privacyConsent-error">{errors.privacyConsent}</FieldError>
                  <label className="public-application__check">
                    <input type="checkbox" checked={data.marketingConsent} onChange={(event) => updateField('marketingConsent', event.target.checked)} />
                    <span>Quiero recibir información sobre inmuebles similares. <small>Opcional</small></span>
                  </label>
                </div>
              </div>
            )}

            <div className="public-application__actions">
              {step > 0 ? (
                <button className="public-application__button public-application__button--secondary" type="button" onClick={previousStep}>
                  <ArrowLeft aria-hidden="true" /> Atrás
                </button>
              ) : <span />}
              {step < steps.length - 1 ? (
                <button className="public-application__button public-application__button--primary" type="button" onClick={nextStep}>
                  Continuar <ArrowRight aria-hidden="true" />
                </button>
              ) : (
                <button className="public-application__button public-application__button--primary" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Enviando solicitud...' : 'Enviar solicitud'} {!isSubmitting && <ArrowRight aria-hidden="true" />}
                </button>
              )}
            </div>
          </form>
          <p className="public-application__required-note"><RequiredMark /> Campos obligatorios</p>
          </>
          )}
        </section>
      </main>
      <footer className="public-application__footer">
        <span><ShieldCheck aria-hidden="true" /> Tus datos están protegidos</span>
        <a href="/legal/privacidad">Privacidad</a>
        <a href="/legal/terminos">Términos</a>
        <span>Solicitud gestionada con Inquilink</span>
      </footer>
    </div>
  )
}
