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
}

type UploadedDocument = {
  name: string
  size: string
  progress: number
}

type Documents = Record<'payslips' | 'contract' | 'selfEmployed' | 'supporting', UploadedDocument | null>

const STORAGE_KEY = 'inquilink-demo-application'

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
}

const initialDocuments: Documents = {
  payslips: null,
  contract: null,
  selfEmployed: null,
  supporting: null,
}

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

function FieldError({ children, id }: { children?: string; id?: string }) {
  if (!children) return null
  return <p className="public-application__field-error" id={id}>{children}</p>
}

function RequiredMark() {
  return <span className="public-application__required" aria-hidden="true">*</span>
}

export function PublicApplicationPage() {
  const token = window.location.pathname.split('/').filter(Boolean).at(-1) ?? ''
  const draftStorageKey = `${STORAGE_KEY}:${token}`
  const [step, setStep] = useState(0)
  const [data, setData] = useState<FormData>(initialData)
  const [documents, setDocuments] = useState<Documents>(initialDocuments)
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
  const headingRef = useRef<HTMLHeadingElement>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)
  const errorSummaryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(draftStorageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as { data?: FormData; step?: number }
        if (parsed.data) setData({ ...initialData, ...parsed.data })
        if (typeof parsed.step === 'number' && parsed.step >= 0 && parsed.step < steps.length) {
          setStep(Math.min(parsed.step, 3))
        }
        setRestored(true)
      }
    } catch {
      window.sessionStorage.removeItem(draftStorageKey)
    }
  }, [draftStorageKey])

  useEffect(() => {
    if (submitted) return
    window.sessionStorage.setItem(draftStorageKey, JSON.stringify({ data, step }))
  }, [data, draftStorageKey, step, submitted])

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
    }

    if (step === 3) {
      if (data.employmentStatus === 'Trabajo por cuenta ajena') {
        if (!documents.payslips) nextErrors.payslips = 'Añade tus dos últimas nóminas en un único archivo.'
        else if (documents.payslips.progress < 100) nextErrors.payslips = 'Espera a que terminen de subirse tus dos últimas nóminas.'
        if (!documents.contract) nextErrors.contract = 'Añade tu contrato de trabajo.'
        else if (documents.contract.progress < 100) nextErrors.contract = 'Espera a que termine de subirse tu contrato de trabajo.'
      } else if (data.employmentStatus === 'Trabajo por cuenta propia') {
        if (!documents.selfEmployed) nextErrors.selfEmployed = 'Añade un justificante de ingresos como profesional autónomo.'
        else if (documents.selfEmployed.progress < 100) nextErrors.selfEmployed = 'Espera a que termine de subirse tu justificante de ingresos.'
      } else {
        if (!documents.supporting) nextErrors.supporting = 'Añade un justificante de ingresos o recursos económicos.'
        else if (documents.supporting.progress < 100) nextErrors.supporting = 'Espera a que termine de subirse tu justificante.'
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

  const handleFile = (key: keyof Documents, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setFileError('')
    setErrors((current) => {
      const next = { ...current }
      delete next[key]
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

    setDocuments((current) => ({
      ...current,
      [key]: { name: file.name, size: formatFileSize(file.size), progress: 35 },
    }))
    window.setTimeout(() => {
      setDocuments((current) => {
        const currentFile = current[key]
        if (!currentFile || currentFile.name !== file.name) return current
        return { ...current, [key]: { ...currentFile, progress: 100 } }
      })
    }, 650)
  }

  const removeFile = (key: keyof Documents) => {
    setDocuments((current) => ({ ...current, [key]: null }))
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!validateStep() || isSubmitting) return
    setIsSubmitting(true)
    window.setTimeout(() => {
      setIsSubmitting(false)
      setSubmitted(true)
      window.sessionStorage.removeItem(draftStorageKey)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }, 900)
  }

  const handleAccountSubmit = (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: Record<string, string> = {}

    if (accountMode === 'register' && !accountName.trim()) nextErrors.name = 'Escribe tu nombre y apellidos.'
    if (!/^\S+@\S+\.\S+$/.test(accountEmail)) nextErrors.email = 'Introduce un correo electrónico válido.'
    if (accountPassword.length < 8) nextErrors.password = 'La contraseña debe tener al menos 8 caracteres.'

    setAccountErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setData((current) => ({
      ...current,
      fullName: accountMode === 'register' ? accountName.trim() : current.fullName,
      email: accountEmail.trim(),
    }))
    setAccountReady(true)
  }

  if (token !== 'demo') {
    return (
      <main className="public-application public-application--success">
        <section className="public-application__success" aria-labelledby="invalid-link-title">
          <span className="public-application__success-icon public-application__success-icon--muted" aria-hidden="true"><HouseLine weight="fill" /></span>
          <p className="public-application__success-kicker">Enlace no disponible</p>
          <h1 id="invalid-link-title">Esta solicitud ya no está activa.</h1>
          <p>El enlace puede haber caducado, estar pausado o haber sido sustituido. Pide a la inmobiliaria un enlace actualizado.</p>
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
          <p>Hemos enviado tu solicitud a Albor Inmobiliaria. Recibirás una copia en <strong>{data.email}</strong>.</p>
          <div className="public-application__success-property">
            <HouseLine aria-hidden="true" />
            <span><strong>Piso luminoso en Chamberí</strong><small>Referencia CHB-184</small></span>
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
          <span><small>Gestionado por</small><strong>Albor Inmobiliaria</strong></span>
        </div>
      </header>

      <main className="public-application__layout">
        <aside className="public-application__property" aria-labelledby="property-title">
          <div className="public-application__property-image">
            <img
              src="https://picsum.photos/seed/chamberi-bright-apartment/1200/800"
              alt="Salón luminoso del piso de alquiler en Chamberí"
              width="1200"
              height="800"
            />
          </div>
          <div className="public-application__property-copy">
            <span className="public-application__reference">Referencia CHB-184</span>
            <h1 id="property-title">Piso luminoso en Chamberí</h1>
            <p className="public-application__location"><MapPin aria-hidden="true" /> Trafalgar, Madrid</p>
            <div className="public-application__property-facts" aria-label="Características principales">
              <strong>1.480 €<small>/ mes</small></strong>
              <span><Bed aria-hidden="true" /> 2 habitaciones</span>
              <span><Bathtub aria-hidden="true" /> 1 baño</span>
              <span><Buildings aria-hidden="true" /> 68 m²</span>
            </div>
            <p className="public-application__description">Vivienda exterior reformada, con salón amplio, cocina equipada y balcón. Disponible a partir del 1 de octubre.</p>
            <div className="public-application__property-meta">
              <span><CalendarBlank aria-hidden="true" /><small>Disponible</small><strong>01/10/2026</strong></span>
              <span><Clock aria-hidden="true" /><small>Tiempo estimado</small><strong>8 minutos</strong></span>
            </div>
          </div>
        </aside>

        <section className="public-application__form-card" id="formulario-solicitud" aria-labelledby="step-heading">
          {!accountReady ? (
            <div className="public-application__account-gate">
              <span className="public-application__account-icon" aria-hidden="true"><UserCircle weight="fill" /></span>
              <p className="public-application__step-count">Cuenta de interesado</p>
              <h2 id="step-heading">{accountMode === 'register' ? 'Crea tu cuenta para solicitar la vivienda.' : 'Inicia sesión para continuar.'}</h2>
              <p>Tu cuenta protege la documentación, guarda el progreso y reúne tus candidaturas en un solo lugar.</p>

              <div className="public-application__account-switch" aria-label="Tipo de acceso">
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
                  <small id="account-password-help">Mínimo 8 caracteres.</small>
                  <FieldError id="account-password-error">{accountErrors.password}</FieldError>
                </label>
                <button className="public-application__button public-application__button--primary" type="submit">
                  {accountMode === 'register' ? 'Crear cuenta y continuar' : 'Iniciar sesión'} <ArrowRight aria-hidden="true" />
                </button>
              </form>

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
            <span className="public-application__saved"><Check aria-hidden="true" /> Progreso guardado</span>
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

          {(Object.keys(errors).length > 0 || fileError) && (
            <div className="public-application__error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef}>
              <strong>Revisa la información marcada</strong>
              <p>{fileError || `Hay ${Object.keys(errors).length} ${Object.keys(errors).length === 1 ? 'campo pendiente' : 'campos pendientes'} antes de continuar.`}</p>
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
                    <input required type="number" min="1" step="1" inputMode="numeric" value={data.adults} onChange={(event) => updateField('adults', event.target.value)} aria-invalid={Boolean(errors.adults)} aria-describedby="adults-error" />
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
                  <p><strong>Documentos privados</strong><br />Solo el equipo responsable de Albor Inmobiliaria puede acceder a ellos para revisar tu solvencia.</p>
                </div>
                <p className="public-application__format-note">Formatos permitidos: PDF, JPG y PNG. Tamaño máximo: 10 MB por archivo. Inquilink vuelve a validar cada archivo de forma segura al enviarlo.</p>
                {([
                  ...(data.employmentStatus === 'Trabajo por cuenta ajena'
                    ? [
                        ['payslips', 'Dos últimas nóminas', 'Necesarias para comprobar los ingresos declarados.', true] as const,
                        ['contract', 'Contrato de trabajo', 'Ayuda a verificar tu situación laboral actual.', true] as const,
                      ]
                    : []),
                  ...(data.employmentStatus === 'Trabajo por cuenta propia'
                    ? [['selfEmployed', 'Justificante para autónomos', 'Puede ser el último modelo trimestral o un certificado de ingresos.', true] as const]
                    : []),
                  ...(data.employmentStatus !== 'Trabajo por cuenta ajena' && data.employmentStatus !== 'Trabajo por cuenta propia'
                    ? [['supporting', 'Justificante de ingresos', 'Pensión, beca u otro documento que acredite tus recursos.', true] as const]
                    : [['supporting', 'Documento adicional', 'Declaración de la renta u otro justificante.', false] as const]),
                ] as const).map(([key, title, description, required]) => {
                  const file = documents[key]
                  return (
                    <div className="public-application__upload" key={key} role="group" aria-labelledby={`${key}-title`} aria-describedby={`${key}-description ${key}-error`}>
                      <div className="public-application__upload-copy">
                        <FilePdf aria-hidden="true" />
                        <span><strong id={`${key}-title`}>{title} {required && <RequiredMark />}</strong><small id={`${key}-description`}>{description}</small></span>
                      </div>
                      {file ? (
                        <div className="public-application__file" role="status">
                          <span><strong>{file.name}</strong><small>{file.progress < 100 ? `Subiendo ${file.progress}%` : `${file.size} · Archivo listo`}</small>{file.progress < 100 && <progress max="100" value={file.progress} aria-label={`Progreso de subida de ${file.name}`} />}</span>
                          <button type="button" onClick={() => removeFile(key)} aria-label={`Eliminar ${file.name}`}><Trash aria-hidden="true" /></button>
                        </div>
                      ) : (
                        <label className="public-application__upload-button">
                          <FileArrowUp aria-hidden="true" /> Añadir archivo
                          <input required={required} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => handleFile(key, event)} />
                        </label>
                      )}
                      <FieldError id={`${key}-error`}>{errors[key]}</FieldError>
                    </div>
                  )
                })}
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
                    <p id="privacy-copy"><label htmlFor="privacy-consent">Acepto que Albor Inmobiliaria trate mis datos para gestionar esta solicitud.</label> He leído la <a href="/legal/privacidad" target="_blank" rel="noreferrer">política de privacidad<span className="public-application__sr-only">, se abre en una nueva pestaña</span></a>. <RequiredMark /></p>
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
