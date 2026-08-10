import { FormEvent, ReactNode, RefObject, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Buildings,
  CalendarBlank,
  Check,
  CheckCircle,
  CreditCard,
  Eye,
  EyeSlash,
  FileText,
  Info,
  LockKey,
  Receipt,
  ShieldCheck,
  Sparkle,
  UsersThree,
  Warning,
} from '@phosphor-icons/react'
import { VerificationResend } from '../features/funnel/FunnelControls'
import './AuthBillingPage.css'

type PlanId = 'particular' | 'professional' | 'inmobiliaria'
type SignupStage = 'agency' | 'verify' | 'plan' | 'payment' | 'success'

const plans = {
  particular: {
    name: 'Particular',
    price: '9,99 €',
    description: 'Para propietarios que gestionan uno o dos alquileres.',
    features: [
      'Hasta 2 anuncios simultáneos',
      '1 cuenta de administrador',
      'Todas las funciones de Inquilink',
    ],
  },
  professional: {
    name: 'Profesional',
    price: '49,99 €',
    description: 'Para profesionales y pequeñas agencias.',
    features: [
      'Hasta 15 anuncios simultáneos',
      'Hasta 3 cuentas en total',
      'Todas las funciones de Inquilink',
    ],
  },
  inmobiliaria: {
    name: 'Inmobiliaria',
    price: '99,99 €',
    description: 'Para inmobiliarias con una cartera y un equipo amplios.',
    features: [
      'Hasta 100 anuncios simultáneos',
      'Cuentas ilimitadas',
      'Todas las funciones de Inquilink',
    ],
  },
} satisfies Record<PlanId, { name: string; price: string; description: string; features: string[] }>

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  }).format(date)

const getTrialEndDate = () => {
  const result = new Date()
  result.setDate(result.getDate() + 30)
  return formatDate(result)
}

const navigate = (path: string) => {
  window.location.assign(path)
}

const canonicalLocalPath = (value: string | undefined | null) => {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value) || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return null
  try {
    const base = new URL('https://inquilink.local')
    const parsed = new URL(value, base)
    if (parsed.origin !== base.origin) return null
    const pathname = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '')
    return `${pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}

const safeReturnPath = (value: string | undefined | null, fallback: string) => canonicalLocalPath(value) ?? fallback

const authSelfPaths = new Set(['/iniciar-sesion', '/recuperar-contrasena', '/restablecer-contrasena', '/verificar-correo'])

const safeAuthContinuation = (value: string | undefined | null) => {
  const path = canonicalLocalPath(value)
  if (!path) return null
  const pathname = path.split(/[?#]/, 1)[0]
  return !authSelfPaths.has(pathname) ? path : null
}

const loginHrefForContinuation = (value: string | undefined | null) => {
  const continuation = safeAuthContinuation(value)
  return continuation ? `/iniciar-sesion?volver=${encodeURIComponent(continuation)}` : '/iniciar-sesion'
}

const focusField = (id: string) => {
  window.requestAnimationFrame(() => document.getElementById(id)?.focus())
}

const isFutureExpiry = (value: string) => {
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(value)) return false
  const [month, shortYear] = value.split('/').map(Number)
  const now = new Date()
  const year = 2000 + shortYear
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1)
}

const formatCard = (value: string) => value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim()

const formatExpiry = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
}

function ManagedDialog({
  open,
  onClose,
  triggerRef,
  children,
  labelledBy,
  describedBy,
}: {
  open: boolean
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  children: ReactNode
  labelledBy: string
  describedBy: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !open) return
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus())

    return () => {
      document.body.style.overflow = previousOverflow
      if (dialog.open) dialog.close()
      triggerRef.current?.focus()
    }
  }, [open, triggerRef])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      className="ab-dialog"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.currentTarget === event.target) onClose() }}
    >
      {children}
    </dialog>
  )
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className="ab-brand" href="/" aria-label="Inquilink, página de inicio">
      <span className="ab-brand-mark" aria-hidden="true">i</span>
      {!compact && <span>inquilink</span>}
    </a>
  )
}

function PublicHeader() {
  return (
    <header className="ab-header">
      <div className="ab-header-inner">
        <Brand />
        <nav className="ab-header-nav" aria-label="Navegación principal">
          <a href="/">Cómo funciona</a>
          <a href="/#funciones">Funciones</a>
          <a href="/precios" aria-current={window.location.pathname === '/precios' ? 'page' : undefined}>Precios</a>
          <a href="/#preguntas">Preguntas frecuentes</a>
        </nav>
        <div className="ab-header-actions">
          <a className="ab-link-button" href="/iniciar-sesion">Iniciar sesión</a>
          <a className="ab-button ab-button-dark ab-button-small" href="/registro">Pruébalo ahora</a>
        </div>
      </div>
    </header>
  )
}

function LegalPriceNote({ trialEnd }: { trialEnd: string }) {
  return (
    <div className="ab-terms-note">
      <Info size={20} weight="fill" aria-hidden="true" />
      <div>
        <strong>Condiciones del periodo gratuito</strong>
        <p>
          El primer mes son 30 días consecutivos desde la activación. Se requiere tarjeta. Cancela antes del {trialEnd} para evitar el primer cargo.
        </p>
        <p>
          Después, el plan se renueva cada mes hasta que lo canceles. Los precios mostrados incluyen IVA en este prototipo. La política fiscal definitiva se confirmará antes del lanzamiento.
        </p>
      </div>
    </div>
  )
}

function PricingPage() {
  const trialEnd = useMemo(getTrialEndDate, [])
  const [selected, setSelected] = useState<PlanId>('professional')

  return (
    <div className="ab-page ab-pricing-page">
      <a className="ab-skip-link" href="#contenido">Saltar al contenido</a>
      <PublicHeader />
      <main id="contenido" className="ab-pricing-main">
        <section className="ab-pricing-intro">
          <span className="ab-eyebrow">Precios claros desde el principio</span>
          <h1>Un plan para ordenar cada alquiler.</h1>
          <p>Prueba todas las funciones durante 30 días. Añade tu tarjeta ahora y no pagarás nada hoy.</p>
        </section>

        <section className="ab-plan-grid" aria-label="Planes disponibles">
          {(Object.keys(plans) as PlanId[]).map((planId) => {
            const plan = plans[planId]
            const active = selected === planId
            return (
              <article className={`ab-plan-card ${active ? 'is-selected' : ''}`} key={planId}>
                <button
                  className="ab-plan-select"
                  type="button"
                  onClick={() => setSelected(planId)}
                  aria-pressed={active}
                  aria-label={`Seleccionar plan ${plan.name}`}
                >
                  <span className="ab-radio" aria-hidden="true">{active && <Check size={13} weight="bold" />}</span>
                  {active ? 'Seleccionado' : 'Seleccionar'}
                </button>
                <div className="ab-plan-title-row">
                  <h2>{plan.name}</h2>
                  {planId === 'professional' && <span className="ab-plan-badge">Más elegido</span>}
                </div>
                <p className="ab-plan-description">{plan.description}</p>
                <p className="ab-price"><strong>{plan.price}</strong><span>/ mes</span></p>
                <p className="ab-free-line"><Sparkle size={18} weight="fill" aria-hidden="true" /> Primer mes gratis (30 días)</p>
                <ul className="ab-feature-list">
                  {plan.features.map((feature) => (
                    <li key={feature}><CheckCircle size={20} weight="fill" aria-hidden="true" />{feature}</li>
                  ))}
                </ul>
                <button
                  className={`ab-button ${active ? 'ab-button-dark' : 'ab-button-outline'} ab-button-wide`}
                  type="button"
                  onClick={() => navigate(`/registro?plan=${planId}`)}
                >
                  Probar {plan.name} gratis <ArrowRight size={18} aria-hidden="true" />
                </button>
              </article>
            )
          })}
        </section>

        <p className="ab-pricing-contact">¿Tu empresa tiene necesidades más allá de estos planes? <a href="mailto:hola@inquilink.es">Contacta con nosotros</a>.</p>

        <LegalPriceNote trialEnd={trialEnd} />

        <section className="ab-price-footer" aria-labelledby="price-question">
          <div>
            <h2 id="price-question">Empieza sin sorpresas.</h2>
            <p>No hay permanencia. Si cancelas durante la prueba, conservas el acceso hasta que terminen los 30 días y no se realiza ningún cargo.</p>
          </div>
          <a className="ab-text-link" href="/iniciar-sesion">¿Ya tienes una cuenta? Inicia sesión <ArrowRight size={17} aria-hidden="true" /></a>
        </section>
      </main>
    </div>
  )
}

type AgencyForm = {
  name: string
  agency: string
  email: string
  phone: string
  fiscalId: string
  billingName: string
  billingAddress: string
  password: string
  consent: boolean
}

type SignupSnapshot = { agency: Omit<AgencyForm, 'password'>; plan: PlanId }
type BillingTokenizer = { createPaymentMethod: (input: { cardholderName: string; cardNumber: string; expiry: string; cvc: string }) => Promise<{ paymentMethodToken: string }> }
type PaymentAttempt = { fingerprint: string; paymentMethodToken: string; idempotencyKey: string }

declare global {
  interface Window { InquilinkBilling?: BillingTokenizer }
}

const signupStorageKey = 'inquilink-agency-signup'

function readSignupSnapshot(): SignupSnapshot | null {
  try {
    const value = window.sessionStorage.getItem(signupStorageKey)
    if (!value) return null
    const parsed = JSON.parse(value) as { agency?: Partial<AgencyForm>; plan?: PlanId }
    if (!parsed.agency || !parsed.plan) return null
    const { password: _password, ...safeAgency } = { ...initialAgency, ...parsed.agency }
    return { agency: safeAgency, plan: parsed.plan }
  } catch { return null }
}

async function tokenizeSignupPayment(input: { cardholderName: string; cardNumber: string; expiry: string; cvc: string }) {
  if (window.InquilinkBilling) return window.InquilinkBilling.createPaymentMethod(input)
  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return { paymentMethodToken: `pm_local_${input.cardNumber.replace(/\D/g, '').slice(-4)}` }
  }
  throw new Error('El proveedor de pagos no está disponible. Inténtalo de nuevo más tarde.')
}

const initialAgency: AgencyForm = {
  name: '',
  agency: '',
  email: '',
  phone: '',
  fiscalId: '',
  billingName: '',
  billingAddress: '',
  password: '',
  consent: false,
}

function SignupSteps({ stage }: { stage: SignupStage }) {
  const stages: Array<{ id: Exclude<SignupStage, 'success'>; label: string }> = [
    { id: 'agency', label: 'Tu agencia' },
    { id: 'verify', label: 'Verificación' },
    { id: 'plan', label: 'Tu plan' },
    { id: 'payment', label: 'Activación' },
  ]
  const order = ['agency', 'verify', 'plan', 'payment', 'success']
  const currentIndex = order.indexOf(stage)

  return (
    <ol className="ab-steps" aria-label="Progreso del registro">
      {stages.map((item, index) => {
        const complete = index < currentIndex
        const current = item.id === stage
        return (
          <li className={current ? 'is-current' : complete ? 'is-complete' : ''} key={item.id} aria-current={current ? 'step' : undefined}>
            <span className="ab-step-number">{complete ? <Check size={14} weight="bold" /> : index + 1}</span>
            <span>{item.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null
  return <p className="ab-field-error" id={id} role="alert"><Warning size={15} weight="fill" aria-hidden="true" />{children}</p>
}

function SignupPage() {
  const params = new URLSearchParams(window.location.search)
  const requestedPlan = params.get('plan')
  const startingPlan: PlanId = requestedPlan === 'particular' || requestedPlan === 'professional' || requestedPlan === 'inmobiliaria'
    ? requestedPlan
    : 'professional'
  const trialEnd = useMemo(getTrialEndDate, [])
  const snapshot = useMemo(readSignupSnapshot, [])
  const returningVerified = params.get('verificado') === '1'
  const [stage, setStage] = useState<SignupStage>(returningVerified ? 'plan' : 'agency')
  const [agency, setAgency] = useState<AgencyForm>({ ...initialAgency, ...snapshot?.agency })
  const [plan, setPlan] = useState<PlanId>(returningVerified ? startingPlan : snapshot?.plan ?? startingPlan)
  const [showPassword, setShowPassword] = useState(false)
  const [verificationMessage, setVerificationMessage] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [cardName, setCardName] = useState('')
  const [showCardNumber, setShowCardNumber] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [activation, setActivation] = useState<{ trialEndsAt: string; paymentMethodDisplay: string } | null>(null)
  const paymentAttemptRef = useRef<PaymentAttempt | null>(null)
  const selectedPlan = plans[plan]
  const stageHeadingRef = useRef<HTMLHeadingElement>(null)
  const initialStageRender = useRef(true)

  useEffect(() => {
    if (initialStageRender.current) {
      initialStageRender.current = false
      return
    }
    stageHeadingRef.current?.focus()
  }, [stage])

  useEffect(() => {
    const { password: _password, ...safeAgency } = agency
    window.sessionStorage.setItem(signupStorageKey, JSON.stringify({ agency: safeAgency, plan }))
  }, [agency, plan])

  useEffect(() => {
    if (!returningVerified) return
    void fetch('/api/v1/auth/me', { credentials: 'include', headers: { Accept: 'application/json' } }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as { data?: { user?: { kind?: string; email?: string; fullName?: string }; agency?: { name?: string } }; error?: { message?: string } }
      if (!response.ok || payload.data?.user?.kind !== 'agency') {
        setStage('agency')
        setErrors({ form: payload.error?.message ?? 'Inicia sesión con la cuenta que acabas de verificar.' })
        return
      }
      setAgency((current) => ({ ...current, name: payload.data?.user?.fullName ?? current.name, email: payload.data?.user?.email ?? current.email, agency: payload.data?.agency?.name ?? current.agency }))
      setStage('plan')
    })
  }, [returningVerified])

  const updateAgency = (field: keyof AgencyForm, value: string | boolean) => {
    setAgency((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: '' }))
  }

  const validateAgency = () => {
    const next: Record<string, string> = {}
    if (!agency.name.trim()) next.name = 'Escribe tu nombre y apellidos.'
    if (!agency.agency.trim()) next.agency = 'Escribe el nombre de la inmobiliaria.'
    if (!/^\S+@\S+\.\S+$/.test(agency.email)) next.email = 'Introduce un correo profesional válido.'
    if (!/^\+?[0-9 ()-]{9,}$/.test(agency.phone)) next.phone = 'Introduce un teléfono válido.'
    if (!/^(?:[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])$/.test(agency.fiscalId.replace(/[\s-]/g, '').toUpperCase())) next.fiscalId = 'Introduce un NIF, NIE o CIF válido.'
    if (!agency.billingName.trim()) next.billingName = 'Escribe el nombre fiscal de la agencia.'
    if (agency.billingAddress.trim().length < 5) next.billingAddress = 'Escribe la dirección fiscal completa.'
    if (agency.password.length < 10) next.password = 'La contraseña debe tener al menos 10 caracteres.'
    if (!agency.consent) next.consent = 'Debes aceptar los términos y la política de privacidad.'
    setErrors(next)
    const firstError = ['name', 'agency', 'email', 'phone', 'fiscalId', 'billingName', 'billingAddress', 'password', 'consent'].find((field) => next[field])
    if (firstError) focusField(`signup-${firstError}`)
    return Object.keys(next).length === 0
  }

  const submitAgency = async (event: FormEvent) => {
    event.preventDefault()
    if (validateAgency()) {
      setSubmitting(true)
      setErrors({})
      try {
        const response = await fetch('/api/v1/auth/agency/register', {
          method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName: agency.name.trim(), agencyName: agency.agency.trim(), email: agency.email.trim().toLowerCase(), phone: agency.phone.trim(), fiscalId: agency.fiscalId, billingName: agency.billingName, billingAddress: agency.billingAddress, password: agency.password, termsAccepted: true, termsVersion: 'terms-2026-08-v1', returnPath: `/registro?verificado=1&plan=${plan}` }),
        })
        const payload = await response.json().catch(() => ({})) as { data?: { message?: string }; error?: { message?: string } }
        if (!response.ok) throw new Error(payload.error?.message ?? 'No hemos podido crear el espacio de trabajo.')
        setVerificationMessage(payload.data?.message ?? 'Revisa tu correo para verificar la cuenta.')
      setStage('verify')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch (caught) {
        setErrors({ form: caught instanceof Error ? caught.message : 'No hemos podido crear el espacio de trabajo.' })
        focusField('signup-form-error')
      } finally { setSubmitting(false) }
    }
  }

  const submitPayment = async (event: FormEvent) => {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!/^\d{12,19}$/.test(cardNumber.replace(/\s/g, ''))) next.cardNumber = 'Introduce un número de tarjeta válido.'
    if (!isFutureExpiry(expiry)) next.expiry = 'Introduce una fecha futura con formato MM/AA.'
    if (!/^\d{3}$/.test(cvc)) next.cvc = 'Introduce los 3 dígitos del CVC.'
    if (!cardName.trim()) next.cardName = 'Escribe el nombre que figura en la tarjeta.'
    setErrors(next)
    const firstError = ['cardName', 'cardNumber', 'expiry', 'cvc'].find((field) => next[field])
    const inputIds: Record<string, string> = { cardName: 'card-name', cardNumber: 'card-number', expiry: 'card-expiry', cvc: 'card-cvc' }
    if (firstError) focusField(inputIds[firstError])
    if (Object.keys(next).length === 0) {
      setSubmitting(true)
      try {
        const fingerprint = `${plan}:${cardName.trim()}:${cardNumber.replace(/\D/g, '')}:${expiry}`
        let attempt = paymentAttemptRef.current
        if (!attempt || attempt.fingerprint !== fingerprint) {
          const { paymentMethodToken } = await tokenizeSignupPayment({ cardholderName: cardName.trim(), cardNumber, expiry, cvc })
          attempt = { fingerprint, paymentMethodToken, idempotencyKey: crypto.randomUUID() }
          paymentAttemptRef.current = attempt
        }
        const response = await fetch('/api/v1/billing/trial', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': attempt.idempotencyKey }, body: JSON.stringify({ plan, paymentMethodToken: attempt.paymentMethodToken }) })
        const payload = await response.json().catch(() => ({})) as { data?: { subscription?: { trialEndsAt?: string; paymentMethodDisplay?: string } }; error?: { code?: string; message?: string } }
        if (!response.ok || !payload.data?.subscription) {
          const retryableCodes = new Set(['BILLING_OPERATION_IN_PROGRESS', 'BILLING_TRANSITION_IN_PROGRESS', 'BILLING_RECONCILIATION_REQUIRED'])
          if (response.status !== 503 && !retryableCodes.has(payload.error?.code ?? '')) paymentAttemptRef.current = null
          throw new Error(payload.error?.message ?? 'No hemos podido activar la prueba.')
        }
        setActivation({ trialEndsAt: payload.data.subscription.trialEndsAt ?? '', paymentMethodDisplay: payload.data.subscription.paymentMethodDisplay ?? maskCard })
        paymentAttemptRef.current = null
        window.sessionStorage.removeItem(signupStorageKey)
      setStage('success')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch (caught) {
        setErrors({ form: caught instanceof Error ? caught.message : 'No hemos podido activar la prueba.' })
        focusField('payment-form-error')
      } finally { setSubmitting(false) }
    }
  }

  const maskCard = cardNumber ? `•••• ${cardNumber.replace(/\s/g, '').slice(-4)}` : '•••• 4242'

  return (
    <div className="ab-page ab-auth-page">
      <a className="ab-skip-link" href="#contenido">Saltar al contenido</a>
      <header className="ab-auth-header">
        <Brand />
        <span>¿Ya tienes cuenta? <a href="/iniciar-sesion">Inicia sesión</a></span>
      </header>
      <main id="contenido" className="ab-signup-layout">
        <aside className="ab-signup-aside" aria-label="Resumen de la prueba">
          <div className="ab-aside-content">
            <span className="ab-eyebrow">30 días para probarlo todo</span>
            <h1>Tus alquileres, organizados desde hoy.</h1>
            <p>Crea anuncios, recibe candidatos y coordina visitas desde un único portal.</p>
            <div className="ab-aside-promise">
              <ShieldCheck size={25} weight="fill" aria-hidden="true" />
              <div><strong>No pagas nada hoy</strong><span>Te avisaremos antes de que termine la prueba.</span></div>
            </div>
            <div className="ab-aside-promise">
              <CalendarBlank size={25} weight="fill" aria-hidden="true" />
              <div><strong>Primera factura el {trialEnd}</strong><span>Puedes cancelar antes desde Facturación.</span></div>
            </div>
          </div>
        </aside>

        <section className="ab-signup-workspace" aria-live="polite">
          {stage !== 'success' && <SignupSteps stage={stage} />}

          {stage === 'agency' && (
            <form className="ab-form" onSubmit={submitAgency} noValidate>
              <div className="ab-form-heading">
                <p>Empieza tu prueba gratis</p>
                <h2 ref={stageHeadingRef} tabIndex={-1}>Crea tu espacio de trabajo</h2>
                <span>Usaremos estos datos para preparar tu cuenta de administrador.</span>
              </div>
              {errors.form && <div className="ab-form-error" id="signup-form-error" role="alert" tabIndex={-1}><Warning size={18} weight="fill" aria-hidden="true" />{errors.form}</div>}
              <div className="ab-form-grid">
                <div className="ab-field">
                  <label htmlFor="signup-name">Nombre y apellidos</label>
                  <input id="signup-name" name="name" autoComplete="name" value={agency.name} onChange={(event) => updateAgency('name', event.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'signup-name-error' : undefined} />
                  <FieldError id="signup-name-error">{errors.name}</FieldError>
                </div>
                <div className="ab-field">
                  <label htmlFor="signup-agency">Nombre del espacio</label>
                  <input id="signup-agency" name="organization" autoComplete="organization" value={agency.agency} onChange={(event) => updateAgency('agency', event.target.value)} aria-invalid={Boolean(errors.agency)} aria-describedby={errors.agency ? 'signup-agency-error' : undefined} />
                  <FieldError id="signup-agency-error">{errors.agency}</FieldError>
                </div>
                <div className="ab-field">
                  <label htmlFor="signup-email">Correo profesional</label>
                  <input id="signup-email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="tu@inmobiliaria.es" value={agency.email} onChange={(event) => updateAgency('email', event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'signup-email-error' : 'signup-email-help'} />
                  <span className="ab-field-help" id="signup-email-help">Te enviaremos un enlace de verificación.</span>
                  <FieldError id="signup-email-error">{errors.email}</FieldError>
                </div>
                <div className="ab-field">
                  <label htmlFor="signup-phone">Teléfono</label>
                  <input id="signup-phone" name="tel" type="tel" autoComplete="tel" inputMode="tel" placeholder="+34 600 000 000" value={agency.phone} onChange={(event) => updateAgency('phone', event.target.value)} aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'signup-phone-error' : undefined} />
                  <FieldError id="signup-phone-error">{errors.phone}</FieldError>
                </div>
                <div className="ab-field">
                  <label htmlFor="signup-fiscalId">NIF / NIE / CIF</label>
                  <input id="signup-fiscalId" autoComplete="off" placeholder="B12345678" value={agency.fiscalId} onChange={(event) => updateAgency('fiscalId', event.target.value.toUpperCase())} aria-invalid={Boolean(errors.fiscalId)} aria-describedby={errors.fiscalId ? 'signup-fiscalId-error' : undefined} />
                  <FieldError id="signup-fiscalId-error">{errors.fiscalId}</FieldError>
                </div>
                <div className="ab-field">
                  <label htmlFor="signup-billingName">Nombre o razón social</label>
                  <input id="signup-billingName" autoComplete="organization" value={agency.billingName} onChange={(event) => updateAgency('billingName', event.target.value)} aria-invalid={Boolean(errors.billingName)} aria-describedby={errors.billingName ? 'signup-billingName-error' : undefined} />
                  <FieldError id="signup-billingName-error">{errors.billingName}</FieldError>
                </div>
                <div className="ab-field ab-field-wide">
                  <label htmlFor="signup-billingAddress">Dirección fiscal</label>
                  <input id="signup-billingAddress" autoComplete="street-address" placeholder="Calle, número, código postal y localidad" value={agency.billingAddress} onChange={(event) => updateAgency('billingAddress', event.target.value)} aria-invalid={Boolean(errors.billingAddress)} aria-describedby={errors.billingAddress ? 'signup-billingAddress-error' : 'signup-billingAddress-help'} />
                  <span className="ab-field-help" id="signup-billingAddress-help">Estos datos se enviarán al emisor al activar la prueba y podrás sincronizar cambios desde Facturación.</span>
                  <FieldError id="signup-billingAddress-error">{errors.billingAddress}</FieldError>
                </div>
                <div className="ab-field ab-field-wide">
                  <label htmlFor="signup-password">Contraseña</label>
                  <div className="ab-password-input">
                    <input id="signup-password" name="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={10} maxLength={200} value={agency.password} onChange={(event) => updateAgency('password', event.target.value)} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'signup-password-error' : 'signup-password-help'} />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}</button>
                  </div>
                  <span className="ab-field-help" id="signup-password-help">Mínimo 10 caracteres.</span>
                  <FieldError id="signup-password-error">{errors.password}</FieldError>
                </div>
              </div>
              <label className="ab-check-row">
                <input id="signup-consent" type="checkbox" checked={agency.consent} onChange={(event) => updateAgency('consent', event.target.checked)} aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? 'signup-consent-error' : undefined} />
                <span>Acepto los <a href="/legal/terminos">términos de servicio</a> y la <a href="/legal/privacidad">política de privacidad</a>.</span>
              </label>
              <FieldError id="signup-consent-error">{errors.consent}</FieldError>
              <button className="ab-button ab-button-dark ab-button-wide" type="submit" disabled={submitting}>{submitting ? 'Creando espacio...' : 'Crear espacio'} {!submitting && <ArrowRight size={18} aria-hidden="true" />}</button>
            </form>
          )}

          {stage === 'verify' && (
            <div className="ab-form ab-verify-form">
              <div className="ab-form-heading">
                <p>Protegemos el acceso a tu agencia</p>
                <h2 ref={stageHeadingRef} tabIndex={-1}>Revisa tu correo</h2>
                <span>{verificationMessage || `Hemos enviado un enlace seguro a ${agency.email}.`}</span>
              </div>
              <div className="ab-verify-symbol" aria-hidden="true"><ShieldCheck size={32} weight="fill" /></div>
              <div className="ab-auth-result" role="status"><CheckCircle size={27} weight="fill" aria-hidden="true" /><strong>Enlace enviado</strong><p>Abre el enlace del correo. Verificaremos la cuenta y volverás directamente a elegir el plan.</p></div>
              <VerificationResend initialEmail={agency.email} accountType="agency" returnPath={`/registro?verificado=1&plan=${plan}`} compact />
              <div className="ab-form-actions">
                <button className="ab-button ab-button-plain" type="button" onClick={() => setStage('agency')}><ArrowLeft size={18} aria-hidden="true" /> Corregir datos</button>
                <a className="ab-button ab-button-dark" href={`/iniciar-sesion?volver=${encodeURIComponent(`/registro?verificado=1&plan=${plan}`)}`}>Ya lo he verificado <ArrowRight size={18} aria-hidden="true" /></a>
              </div>
            </div>
          )}

          {stage === 'plan' && (
            <div className="ab-form">
              <div className="ab-form-heading">
                <p>Elige cómo quieres empezar</p>
                <h2 ref={stageHeadingRef} tabIndex={-1}>Selecciona tu plan</h2>
                <span>Puedes cambiarlo más adelante desde Facturación.</span>
              </div>
              <fieldset className="ab-compact-plan-list">
                <legend className="ab-visually-hidden">Selecciona un plan</legend>
                {(Object.keys(plans) as PlanId[]).map((planId) => {
                  const item = plans[planId]
                  return (
                    <label className={plan === planId ? 'is-selected' : ''} key={planId}>
                      <input className="ab-native-radio" type="radio" name="signup-plan" value={planId} checked={plan === planId} onChange={() => setPlan(planId)} />
                      <span className="ab-radio" aria-hidden="true">{plan === planId && <Check size={13} weight="bold" />}</span>
                      <span className="ab-compact-plan-copy"><strong>{item.name}</strong><small>{item.description}</small></span>
                      <span className="ab-compact-price"><strong>{item.price}</strong><small>/ mes</small></span>
                    </label>
                  )
                })}
              </fieldset>
              <div className="ab-trial-summary">
                <Sparkle size={21} weight="fill" aria-hidden="true" />
                <div><strong>Primer mes gratis (30 días)</strong><span>Hoy: 0,00 €. Primer cargo: {selectedPlan.price} el {trialEnd}.</span></div>
              </div>
              <div className="ab-form-actions">
                <button className="ab-button ab-button-plain" type="button" onClick={() => setStage('verify')}><ArrowLeft size={18} aria-hidden="true" /> Atrás</button>
                <button className="ab-button ab-button-dark" type="button" onClick={() => setStage('payment')}>Añadir tarjeta <ArrowRight size={18} aria-hidden="true" /></button>
              </div>
            </div>
          )}

          {stage === 'payment' && (
            <form className="ab-form" onSubmit={submitPayment} noValidate>
              <div className="ab-form-heading">
                <p>Activa tus 30 días gratis</p>
                <h2 ref={stageHeadingRef} tabIndex={-1}>Añade una tarjeta</h2>
                <span>La tarjeta es obligatoria, pero hoy no realizaremos ningún cargo.</span>
              </div>
              {errors.form && <div className="ab-form-error" id="payment-form-error" role="alert" tabIndex={-1}><Warning size={18} weight="fill" aria-hidden="true" />{errors.form}</div>}
              <div className="ab-secure-banner"><LockKey size={19} weight="fill" aria-hidden="true" />El proveedor de pagos tokeniza la tarjeta. Inquilink nunca envía sus datos completos a la API.</div>
              <div className="ab-field">
                <label htmlFor="card-name">Nombre en la tarjeta</label>
                <input id="card-name" autoComplete="cc-name" value={cardName} onChange={(event) => { setCardName(event.target.value); setErrors((current) => ({ ...current, cardName: '' })) }} aria-invalid={Boolean(errors.cardName)} aria-describedby={errors.cardName ? 'card-name-error' : undefined} />
                <FieldError id="card-name-error">{errors.cardName}</FieldError>
              </div>
              <div className="ab-field">
                <label htmlFor="card-number">Número de tarjeta</label>
                <div className="ab-card-input">
                  <CreditCard size={20} aria-hidden="true" />
                  <input id="card-number" type={showCardNumber ? 'text' : 'password'} autoComplete="cc-number" inputMode="numeric" placeholder="4242 4242 4242 4242" value={cardNumber} maxLength={19} onChange={(event) => { setCardNumber(formatCard(event.target.value)); setErrors((current) => ({ ...current, cardNumber: '' })) }} aria-invalid={Boolean(errors.cardNumber)} aria-describedby={errors.cardNumber ? 'card-number-error' : 'card-number-help'} />
                  <button type="button" onClick={() => setShowCardNumber((value) => !value)} aria-label={showCardNumber ? 'Ocultar número de tarjeta' : 'Mostrar número de tarjeta'}>{showCardNumber ? <EyeSlash size={19} /> : <Eye size={19} />}</button>
                </div>
                <span className="ab-field-help" id="card-number-help">Los datos se tokenizan en el navegador con el proveedor configurado.</span>
                <FieldError id="card-number-error">{errors.cardNumber}</FieldError>
              </div>
              <div className="ab-form-grid">
                <div className="ab-field">
                  <label htmlFor="card-expiry">Caducidad</label>
                  <input id="card-expiry" autoComplete="cc-exp" inputMode="numeric" placeholder="MM/AA" value={expiry} maxLength={5} onChange={(event) => { setExpiry(formatExpiry(event.target.value)); setErrors((current) => ({ ...current, expiry: '' })) }} aria-invalid={Boolean(errors.expiry)} aria-describedby={errors.expiry ? 'card-expiry-error' : undefined} />
                  <FieldError id="card-expiry-error">{errors.expiry}</FieldError>
                </div>
                <div className="ab-field">
                  <label htmlFor="card-cvc">CVC</label>
                  <input id="card-cvc" type="password" autoComplete="cc-csc" inputMode="numeric" placeholder="•••" value={cvc} maxLength={3} onChange={(event) => { setCvc(event.target.value.replace(/\D/g, '')); setErrors((current) => ({ ...current, cvc: '' })) }} aria-invalid={Boolean(errors.cvc)} aria-describedby={errors.cvc ? 'card-cvc-error' : undefined} />
                  <FieldError id="card-cvc-error">{errors.cvc}</FieldError>
                </div>
              </div>
              <section className="ab-order-summary" aria-labelledby="order-title">
                <div className="ab-order-heading"><div><span id="order-title">Resumen</span><strong>Plan {selectedPlan.name}</strong></div><button type="button" onClick={() => setStage('plan')}>Cambiar</button></div>
                <dl>
                  <div><dt>Hoy</dt><dd>0,00 €</dd></div>
                  <div><dt>Primer cargo, {trialEnd}</dt><dd>{selectedPlan.price}</dd></div>
                  <div><dt>Renovación posterior</dt><dd>{selectedPlan.price} / mes</dd></div>
                  <div><dt>Impuestos</dt><dd>Se detallarán antes del primer cargo</dd></div>
                </dl>
              </section>
              <p className="ab-confirm-copy">Al activar la prueba autorizas la renovación mensual automática desde el {trialEnd}. Puedes cancelar antes de esa fecha desde Facturación y no se realizará el primer cargo.</p>
              <div className="ab-form-actions">
                <button className="ab-button ab-button-plain" type="button" onClick={() => setStage('plan')}><ArrowLeft size={18} aria-hidden="true" /> Atrás</button>
                <button className="ab-button ab-button-dark" type="submit" disabled={submitting}>{submitting ? 'Activando...' : 'Activar prueba gratis'} {!submitting && <ArrowRight size={18} aria-hidden="true" />}</button>
              </div>
            </form>
          )}

          {stage === 'success' && (
            <div className="ab-success" role="status">
              <span className="ab-success-icon"><Check size={34} weight="bold" aria-hidden="true" /></span>
              <p>Prueba activada</p>
              <h1 ref={stageHeadingRef} tabIndex={-1}>Tu espacio está listo.</h1>
              <span>Hemos preparado {agency.agency || 'tu espacio'} con el plan {selectedPlan.name}.</span>
              <div className="ab-success-details">
                <div><CalendarBlank size={21} aria-hidden="true" /><span><small>Prueba hasta</small><strong>{activation?.trialEndsAt ? new Intl.DateTimeFormat('es-ES').format(new Date(activation.trialEndsAt)) : trialEnd}</strong></span></div>
                <div><CreditCard size={21} aria-hidden="true" /><span><small>Tarjeta</small><strong>{activation?.paymentMethodDisplay ?? maskCard}</strong></span></div>
              </div>
              <button className="ab-button ab-button-dark ab-button-wide" type="button" onClick={() => navigate('/app')}>Entrar en mi panel <ArrowRight size={18} aria-hidden="true" /></button>
              <small>Correo verificado: {agency.email || 'tu correo'}.</small>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

type LoginResponse = {
  data?: { user?: { kind?: 'agency' | 'tenant' }; returnPath?: string }
  error?: { code?: string; message?: string }
}

function LoginPage() {
  const requestedReturnPath = safeAuthContinuation(new URLSearchParams(window.location.search).get('volver'))
  const recoveryHref = requestedReturnPath
    ? `/recuperar-contrasena?volver=${encodeURIComponent(requestedReturnPath)}`
    : '/recuperar-contrasena'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accountType, setAccountType] = useState<'agency' | 'tenant'>('agency')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [verificationNeeded, setVerificationNeeded] = useState(false)

  const fillDemo = () => {
    setEmail('demo@inquilink.es')
    setPassword('demo1234')
    setAccountType('agency')
    setErrors({})
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = 'Introduce un correo válido.'
    if (!password) next.password = 'Introduce tu contraseña.'
    setErrors(next)
    if (next.email) focusField('login-email')
    else if (next.password) focusField('login-password')
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          accountType,
          ...(requestedReturnPath ? { returnPath: requestedReturnPath } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({})) as LoginResponse
      if (!response.ok) {
        setVerificationNeeded(payload.error?.code === 'EMAIL_NOT_VERIFIED')
        throw new Error(payload.error?.message ?? 'No hemos podido iniciar sesión. Inténtalo de nuevo.')
      }
      navigate(safeReturnPath(payload.data?.returnPath, payload.data?.user?.kind === 'tenant' ? '/mis-solicitudes' : '/app'))
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : 'No hemos podido conectar con Inquilink. Inténtalo de nuevo.' })
      setSubmitting(false)
      focusField('login-form-error')
    }
  }

  return (
    <div className="ab-page ab-login-page">
      <a className="ab-skip-link" href="#contenido">Saltar al contenido</a>
      <header className="ab-auth-header">
        <Brand />
        <span>¿Aún no tienes cuenta? <a href="/registro">Prueba 30 días gratis</a></span>
      </header>
      <main id="contenido" className="ab-login-main">
        <section className="ab-login-panel">
          <div className="ab-form-heading">
            <p>Bienvenido de nuevo</p>
            <h1>Inicia sesión</h1>
            <span>Accede al portal de tu inmobiliaria.</span>
          </div>
          <button className="ab-demo-box" type="button" onClick={fillDemo}>
            <span className="ab-demo-icon"><Buildings size={22} weight="fill" aria-hidden="true" /></span>
            <span><strong>Rellenar cuenta de demostración</strong><small>demo@inquilink.es<br />Contraseña: demo1234</small></span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          <div className="ab-divider"><span>o introduce tus datos</span></div>
          <form className="ab-form ab-login-form" onSubmit={submit} noValidate>
            {errors.form && <div className="ab-form-error" id="login-form-error" role="alert" tabIndex={-1}><Warning size={18} weight="fill" aria-hidden="true" />{errors.form}</div>}
            <fieldset className="ab-account-type">
              <legend>Tipo de cuenta</legend>
              <label><input type="radio" name="account-type" value="agency" checked={accountType === 'agency'} onChange={() => { setAccountType('agency'); setVerificationNeeded(false); setErrors((current) => ({ ...current, form: '' })) }} /><span>Agencia o propietario</span></label>
              <label><input type="radio" name="account-type" value="tenant" checked={accountType === 'tenant'} onChange={() => { setAccountType('tenant'); setVerificationNeeded(false); setErrors((current) => ({ ...current, form: '' })) }} /><span>Inquilino</span></label>
            </fieldset>
            <div className="ab-field">
              <label htmlFor="login-email">Correo profesional</label>
              <input id="login-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => { setEmail(event.target.value); setVerificationNeeded(false); setErrors((current) => ({ ...current, email: '', form: '' })) }} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'login-email-error' : undefined} />
              <FieldError id="login-email-error">{errors.email}</FieldError>
            </div>
            <div className="ab-field">
              <div className="ab-label-row"><label htmlFor="login-password">Contraseña</label><a href={recoveryHref}>¿La has olvidado?</a></div>
              <div className="ab-password-input">
                <input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); setErrors((current) => ({ ...current, password: '', form: '' })) }} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'login-password-error' : undefined} />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}</button>
              </div>
              <FieldError id="login-password-error">{errors.password}</FieldError>
            </div>
            <label className="ab-check-row"><input type="checkbox" defaultChecked /><span>Mantener la sesión iniciada</span></label>
            <button className="ab-button ab-button-dark ab-button-wide" type="submit" disabled={submitting}>{submitting ? 'Entrando...' : 'Entrar en mi cuenta'} {!submitting && <ArrowRight size={18} aria-hidden="true" />}</button>
          </form>
          {verificationNeeded && <VerificationResend initialEmail={email} accountType={accountType} returnPath={requestedReturnPath ?? undefined} compact />}
          <p className="ab-login-security"><ShieldCheck size={17} weight="fill" aria-hidden="true" />Acceso protegido para tu equipo inmobiliario.</p>
        </section>
      </main>
    </div>
  )
}

type AuthActionResponse = {
  data?: { message?: string; returnPath?: string; verified?: boolean }
  error?: { message?: string }
}

function ForgotPasswordPage() {
  const returnPath = safeAuthContinuation(new URLSearchParams(window.location.search).get('volver'))
  const loginHref = loginHrefForContinuation(returnPath)
  const [email, setEmail] = useState('')
  const [accountType, setAccountType] = useState<'agency' | 'tenant'>('agency')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setErrors({ email: 'Introduce un correo válido.' })
      focusField('recovery-email')
      return
    }
    setSubmitting(true)
    setErrors({})
    try {
      const response = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), accountType, ...(returnPath ? { returnPath } : {}) }),
      })
      const payload = await response.json().catch(() => ({})) as AuthActionResponse
      if (!response.ok) throw new Error(payload.error?.message ?? 'No hemos podido solicitar el enlace. Inténtalo de nuevo.')
      setMessage(payload.data?.message ?? 'Si existe una cuenta, recibirás un correo para restablecer la contraseña.')
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : 'No hemos podido conectar con Inquilink. Inténtalo de nuevo.' })
      focusField('recovery-form-error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ab-page ab-login-page">
      <a className="ab-skip-link" href="#contenido">Saltar al contenido</a>
      <header className="ab-auth-header"><Brand /><span><a href={loginHref}>Volver a iniciar sesión</a></span></header>
      <main id="contenido" className="ab-login-main">
        <section className="ab-login-panel">
          <div className="ab-form-heading"><p>Recupera el acceso</p><h1>Restablece tu contraseña</h1><span>Te enviaremos un enlace seguro si encontramos una cuenta activa.</span></div>
          {message ? (
            <div className="ab-auth-result" role="status"><CheckCircle size={27} weight="fill" aria-hidden="true" /><strong>Revisa tu correo</strong><p>{message}</p><a className="ab-button ab-button-outline ab-button-wide" href={loginHref}>Volver a iniciar sesión</a></div>
          ) : (
            <form className="ab-form ab-login-form" onSubmit={submit} noValidate>
              {errors.form && <div className="ab-form-error" id="recovery-form-error" role="alert" tabIndex={-1}><Warning size={18} weight="fill" aria-hidden="true" />{errors.form}</div>}
              <fieldset className="ab-account-type">
                <legend>Tipo de cuenta</legend>
                <label><input type="radio" name="recovery-account-type" value="agency" checked={accountType === 'agency'} onChange={() => setAccountType('agency')} /><span>Agencia o propietario</span></label>
                <label><input type="radio" name="recovery-account-type" value="tenant" checked={accountType === 'tenant'} onChange={() => setAccountType('tenant')} /><span>Inquilino</span></label>
              </fieldset>
              <div className="ab-field"><label htmlFor="recovery-email">Correo electrónico</label><input id="recovery-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => { setEmail(event.target.value); setErrors({}) }} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'recovery-email-error' : undefined} /><FieldError id="recovery-email-error">{errors.email}</FieldError></div>
              <button className="ab-button ab-button-dark ab-button-wide" type="submit" disabled={submitting}>{submitting ? 'Enviando...' : 'Enviar enlace seguro'} {!submitting && <ArrowRight size={18} aria-hidden="true" />}</button>
            </form>
          )}
        </section>
      </main>
    </div>
  )
}

function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ message: string; returnPath: string } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (token.length < 20) next.form = 'El enlace de recuperación no es válido o está incompleto.'
    if (password.length < 10) next.password = 'La contraseña debe tener al menos 10 caracteres.'
    if (confirmation !== password) next.confirmation = 'Las contraseñas no coinciden.'
    setErrors(next)
    if (Object.keys(next).length > 0) {
      focusField(next.password ? 'reset-password' : next.confirmation ? 'reset-confirmation' : 'reset-form-error')
      return
    }
    setSubmitting(true)
    try {
      const response = await fetch('/api/v1/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) })
      const payload = await response.json().catch(() => ({})) as AuthActionResponse
      if (!response.ok) throw new Error(payload.error?.message ?? 'No hemos podido actualizar la contraseña. Inténtalo de nuevo.')
      setResult({ message: payload.data?.message ?? 'Contraseña actualizada. Ya puedes iniciar sesión.', returnPath: safeReturnPath(payload.data?.returnPath, '/iniciar-sesion') })
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : 'No hemos podido conectar con Inquilink. Inténtalo de nuevo.' })
      focusField('reset-form-error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ab-page ab-login-page"><a className="ab-skip-link" href="#contenido">Saltar al contenido</a><header className="ab-auth-header"><Brand /><span><a href="/iniciar-sesion">Volver a iniciar sesión</a></span></header><main id="contenido" className="ab-login-main"><section className="ab-login-panel">
      <div className="ab-form-heading"><p>Enlace de recuperación</p><h1>Crea una contraseña nueva</h1><span>Usa al menos 10 caracteres y no reutilices una contraseña anterior.</span></div>
      {result ? <div className="ab-auth-result" role="status"><CheckCircle size={27} weight="fill" aria-hidden="true" /><strong>Contraseña actualizada</strong><p>{result.message}</p><a className="ab-button ab-button-dark ab-button-wide" href={loginHrefForContinuation(result.returnPath)}>Iniciar sesión y continuar <ArrowRight size={18} aria-hidden="true" /></a></div> : <form className="ab-form ab-login-form" onSubmit={submit} noValidate>
        {errors.form && <div className="ab-form-error" id="reset-form-error" role="alert" tabIndex={-1}><Warning size={18} weight="fill" aria-hidden="true" />{errors.form}</div>}
        <div className="ab-field"><label htmlFor="reset-password">Nueva contraseña</label><div className="ab-password-input"><input id="reset-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={10} maxLength={200} value={password} onChange={(event) => { setPassword(event.target.value); setErrors((current) => ({ ...current, password: '', form: '' })) }} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'reset-password-error' : 'reset-password-help'} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}</button></div><span className="ab-field-help" id="reset-password-help">Mínimo 10 caracteres.</span><FieldError id="reset-password-error">{errors.password}</FieldError></div>
        <div className="ab-field"><label htmlFor="reset-confirmation">Repite la contraseña</label><input id="reset-confirmation" type="password" autoComplete="new-password" minLength={10} maxLength={200} value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setErrors((current) => ({ ...current, confirmation: '', form: '' })) }} aria-invalid={Boolean(errors.confirmation)} aria-describedby={errors.confirmation ? 'reset-confirmation-error' : undefined} /><FieldError id="reset-confirmation-error">{errors.confirmation}</FieldError></div>
        <button className="ab-button ab-button-dark ab-button-wide" type="submit" disabled={submitting}>{submitting ? 'Actualizando...' : 'Guardar contraseña'} {!submitting && <ArrowRight size={18} aria-hidden="true" />}</button>
      </form>}
    </section></main></div>
  )
}

function VerifyEmailPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const started = useRef(false)
  const [state, setState] = useState<{ kind: 'loading' | 'success' | 'error'; message: string; returnPath: string }>({ kind: 'loading', message: 'Estamos verificando tu correo.', returnPath: '/' })

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (token.length < 20) {
      setState({ kind: 'error', message: 'El enlace de verificación no es válido o está incompleto.', returnPath: '/iniciar-sesion' })
      return
    }
    void fetch('/api/v1/auth/verify-email', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as AuthActionResponse
        if (!response.ok) throw new Error(payload.error?.message ?? 'No hemos podido verificar el correo.')
        setState({ kind: 'success', message: 'Correo verificado. Tu cuenta ya está activa.', returnPath: safeReturnPath(payload.data?.returnPath, '/') })
      })
      .catch((error) => setState({ kind: 'error', message: error instanceof Error ? error.message : 'No hemos podido verificar el correo.', returnPath: '/iniciar-sesion' }))
  }, [token])

  return (
    <div className="ab-page ab-login-page"><a className="ab-skip-link" href="#contenido">Saltar al contenido</a><header className="ab-auth-header"><Brand /></header><main id="contenido" className="ab-login-main"><section className="ab-login-panel"><div className="ab-form-heading"><p>Verificación de cuenta</p><h1>{state.kind === 'loading' ? 'Verificando tu correo' : state.kind === 'success' ? 'Correo verificado' : 'No se pudo verificar'}</h1><span role={state.kind === 'error' ? 'alert' : 'status'}>{state.message}</span></div>{state.kind === 'loading' ? <div className="ab-auth-loading" aria-hidden="true" /> : <a className="ab-button ab-button-dark ab-button-wide" href={state.returnPath}>{state.kind === 'success' ? 'Continuar' : 'Volver a iniciar sesión'} <ArrowRight size={18} aria-hidden="true" /></a>}</section></main></div>
  )
}

type InvitationResponse = {
  data?: { accepted?: boolean; message?: string }
  error?: { message?: string }
}

function InvitationAcceptancePage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [hasAccount, setHasAccount] = useState(false)
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (token.length < 20) next.form = 'El enlace de invitación no es válido o está incompleto.'
    if (!hasAccount && fullName.trim().length < 2) next.fullName = 'Escribe tu nombre y apellidos.'
    if (!hasAccount && password.length < 10) next.password = 'La contraseña debe tener al menos 10 caracteres.'
    if (!hasAccount && !termsAccepted) next.terms = 'Debes aceptar los términos para crear tu cuenta.'
    setErrors(next)
    if (Object.keys(next).length > 0) {
      const first = ['form', 'fullName', 'password', 'terms'].find((field) => next[field])
      focusField(first === 'fullName' ? 'invitation-name' : first === 'password' ? 'invitation-password' : first === 'terms' ? 'invitation-terms' : 'invitation-form-error')
      return
    }

    setSubmitting(true)
    setMessage('')
    try {
      const body = hasAccount
        ? { token }
        : { token, fullName: fullName.trim(), password, termsAccepted: true }
      const response = await fetch('/api/v1/team/invitations/accept', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({})) as InvitationResponse
      if (!response.ok) {
        throw new Error(payload.error?.message ?? 'No hemos podido aceptar la invitación. Comprueba el enlace e inténtalo de nuevo.')
      }
      setAccepted(true)
      setMessage(payload.data?.message ?? 'Ya formas parte del equipo. Inicia sesión para continuar.')
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : 'No hemos podido conectar con Inquilink. Inténtalo de nuevo.' })
      focusField('invitation-form-error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ab-page ab-login-page">
      <a className="ab-skip-link" href="#contenido">Saltar al contenido</a>
      <header className="ab-auth-header">
        <Brand />
        <span>¿Necesitas volver? <a href="/">Ir al inicio</a></span>
      </header>
      <main id="contenido" className="ab-login-main">
        <section className="ab-login-panel ab-invitation-panel">
          <div className="ab-form-heading">
            <p>Invitación de equipo</p>
            <h1>{accepted ? 'Ya formas parte del equipo' : 'Acepta tu invitación'}</h1>
            <span>{accepted ? message : 'Confirma tus datos para acceder al espacio de trabajo.'}</span>
          </div>

          {accepted ? (
            <a className="ab-button ab-button-dark ab-button-wide" href="/iniciar-sesion?volver=%2Fapp">Iniciar sesión <ArrowRight size={18} aria-hidden="true" /></a>
          ) : (
            <form className="ab-form ab-login-form" onSubmit={submit} noValidate>
              {errors.form && <div className="ab-form-error" id="invitation-form-error" role="alert" tabIndex={-1}><Warning size={18} weight="fill" aria-hidden="true" />{errors.form}</div>}

              {!hasAccount && <>
                <div className="ab-field">
                  <label htmlFor="invitation-name">Nombre y apellidos</label>
                  <input id="invitation-name" autoComplete="name" minLength={2} maxLength={200} value={fullName} onChange={(event) => { setFullName(event.target.value); setErrors((current) => ({ ...current, fullName: '', form: '' })) }} aria-invalid={Boolean(errors.fullName)} aria-describedby={errors.fullName ? 'invitation-name-error' : undefined} />
                  <FieldError id="invitation-name-error">{errors.fullName}</FieldError>
                </div>
                <div className="ab-field">
                  <label htmlFor="invitation-password">Crea una contraseña</label>
                  <div className="ab-password-input">
                    <input id="invitation-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={10} maxLength={200} value={password} onChange={(event) => { setPassword(event.target.value); setErrors((current) => ({ ...current, password: '', form: '' })) }} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'invitation-password-error' : 'invitation-password-help'} />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}</button>
                  </div>
                  <span className="ab-field-help" id="invitation-password-help">Mínimo 10 caracteres.</span>
                  <FieldError id="invitation-password-error">{errors.password}</FieldError>
                </div>
                <label className="ab-check-row" id="invitation-terms">
                  <input type="checkbox" checked={termsAccepted} onChange={(event) => { setTermsAccepted(event.target.checked); setErrors((current) => ({ ...current, terms: '', form: '' })) }} aria-invalid={Boolean(errors.terms)} aria-describedby={errors.terms ? 'invitation-terms-error' : undefined} />
                  <span>Acepto los <a href="/legal/terminos" target="_blank" rel="noreferrer">términos de servicio</a>.</span>
                </label>
                <FieldError id="invitation-terms-error">{errors.terms}</FieldError>
              </>}

              {hasAccount && <p className="ab-invitation-note"><LockKey size={19} weight="fill" aria-hidden="true" /><span>Inicia sesión antes de aceptar. Usaremos tu sesión actual y no crearemos otra cuenta. <a href={`/iniciar-sesion?volver=${encodeURIComponent(`/aceptar-invitacion?token=${token}`)}`}>Iniciar sesión</a></span></p>}

              <button className="ab-button ab-button-dark ab-button-wide" type="submit" disabled={submitting}>{submitting ? 'Aceptando...' : 'Aceptar invitación'} {!submitting && <ArrowRight size={18} aria-hidden="true" />}</button>
              <button className="ab-invitation-toggle" type="button" onClick={() => { setHasAccount((value) => !value); setErrors({}) }}>
                {hasAccount ? 'Necesito crear una cuenta' : 'Ya tengo una cuenta de Inquilink'}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  )
}

type TenantApplicationItem = {
  application: {
    id: string
    status: 'new' | 'preselected' | 'selected' | 'rejected' | 'withdrawn'
    documentState: 'complete' | 'missing' | 'not_requested'
    submittedAt: string | null
    updatedAt: string
  }
  property: { id: string; title: string; publicLocation: string | null; coverImageUrl: string | null }
}

type TenantApplicationsResponse = {
  data?: { applications?: TenantApplicationItem[] }
  error?: { message?: string }
}

const tenantStatusLabels: Record<TenantApplicationItem['application']['status'], string> = {
  new: 'Nueva',
  preselected: 'Preseleccionada',
  selected: 'Seleccionada',
  rejected: 'No seleccionada',
  withdrawn: 'Retirada',
}

function TenantApplicationsPage() {
  const started = useRef(false)
  const [state, setState] = useState<{ loading: boolean; applications: TenantApplicationItem[]; error: string }>({ loading: true, applications: [], error: '' })

  useEffect(() => {
    if (started.current) return
    started.current = true
    void fetch('/api/v1/tenant/applications', { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as TenantApplicationsResponse
        if (!response.ok) throw new Error(payload.error?.message ?? 'No hemos podido cargar tus solicitudes.')
        setState({ loading: false, applications: payload.data?.applications ?? [], error: '' })
      })
      .catch((error) => setState({ loading: false, applications: [], error: error instanceof Error ? error.message : 'No hemos podido cargar tus solicitudes.' }))
  }, [])

  return (
    <div className="ab-page ab-tenant-page">
      <a className="ab-skip-link" href="#contenido">Saltar al contenido</a>
      <header className="ab-auth-header"><Brand /><span><a href="/">Ir al inicio</a></span></header>
      <main id="contenido" className="ab-tenant-main">
        <div className="ab-form-heading"><p>Portal del inquilino</p><h1>Mis solicitudes</h1><span>Consulta en un solo lugar el estado de los inmuebles que te interesan.</span></div>
        {state.loading && <div className="ab-tenant-loading" role="status"><span className="ab-auth-loading" aria-hidden="true" />Cargando tus solicitudes...</div>}
        {state.error && <div className="ab-tenant-error" role="alert"><Warning size={22} weight="fill" aria-hidden="true" /><div><strong>No se pudieron cargar tus solicitudes</strong><p>{state.error}</p><a href="/iniciar-sesion?volver=%2Fmis-solicitudes">Iniciar sesión de nuevo</a></div></div>}
        {!state.loading && !state.error && state.applications.length === 0 && <section className="ab-tenant-empty"><FileText size={32} aria-hidden="true" /><h2>Todavía no tienes solicitudes</h2><p>Cuando completes la solicitud de un inmueble, aparecerá aquí con su estado y documentación.</p><a className="ab-button ab-button-outline" href="/">Volver al inicio</a></section>}
        {!state.loading && !state.error && state.applications.length > 0 && <section className="ab-tenant-applications" aria-label="Tus solicitudes de alquiler">{state.applications.map(({ application, property }) => <article key={application.id}>
          {property.coverImageUrl ? <img src={property.coverImageUrl} alt="" /> : <span className="ab-tenant-property-placeholder" aria-hidden="true"><Buildings size={28} /></span>}
          <div><span className={`ab-tenant-status is-${application.status}`}>{application.submittedAt ? tenantStatusLabels[application.status] : 'Borrador'}</span><h2>{property.title}</h2><p>{property.publicLocation ?? 'Ubicación disponible en la solicitud'}</p><dl><div><dt>Última actualización</dt><dd>{formatDate(new Date(application.updatedAt))}</dd></div><div><dt>Documentación</dt><dd>{application.documentState === 'complete' ? 'Completa' : application.documentState === 'missing' ? 'Pendiente' : 'No solicitada'}</dd></div></dl></div>
        </article>)}</section>}
      </main>
    </div>
  )
}

function BillingPage() {
  const trialEnd = useMemo(getTrialEndDate, [])
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [reason, setReason] = useState('')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentMessage, setPaymentMessage] = useState('')
  const [paymentCard, setPaymentCard] = useState('')
  const [paymentExpiry, setPaymentExpiry] = useState('')
  const [paymentCvc, setPaymentCvc] = useState('')
  const [paymentName, setPaymentName] = useState('')
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({})
  const [lastFour, setLastFour] = useState('4242')
  const [showPaymentCard, setShowPaymentCard] = useState(false)
  const cancelTriggerRef = useRef<HTMLButtonElement>(null)
  const paymentTriggerRef = useRef<HTMLButtonElement>(null)

  const confirmCancellation = () => {
    setCancelled(true)
    setCancelOpen(false)
  }

  const submitPaymentUpdate = (event: FormEvent) => {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (paymentCard.replace(/\s/g, '') !== '4242424242424242') next.card = 'Para esta demo, usa 4242 4242 4242 4242.'
    if (!isFutureExpiry(paymentExpiry)) next.expiry = 'Introduce una fecha futura con formato MM/AA.'
    if (!/^\d{3}$/.test(paymentCvc)) next.cvc = 'Introduce los 3 dígitos del CVC.'
    if (!paymentName.trim()) next.name = 'Escribe el nombre que figura en la tarjeta.'
    setPaymentErrors(next)
    const firstError = ['name', 'card', 'expiry', 'cvc'].find((field) => next[field])
    const inputIds: Record<string, string> = { name: 'update-card-name', card: 'update-card-number', expiry: 'update-card-expiry', cvc: 'update-card-cvc' }
    if (firstError) focusField(inputIds[firstError])
    if (Object.keys(next).length === 0) {
      setLastFour(paymentCard.replace(/\s/g, '').slice(-4))
      setPaymentMessage(`Método de pago actualizado. Visa terminada en ${paymentCard.replace(/\s/g, '').slice(-4)}.`)
      setPaymentOpen(false)
    }
  }

  return (
    <div className="ab-page ab-billing-page">
      <a className="ab-skip-link" href="#contenido">Saltar al contenido</a>
      <header className="ab-app-header">
        <div className="ab-app-header-inner">
          <Brand />
          <div className="ab-app-account"><span>LM</span><div><strong>Lucía Martín</strong><small>Inmobiliaria Horizonte</small></div></div>
        </div>
      </header>
      <div className="ab-app-shell">
        <aside className="ab-app-nav" aria-label="Navegación de la aplicación">
          <a href="/app">Panel</a>
          <a href="/app/anuncios">Mis anuncios</a>
          <a href="/app/citas">Citas</a>
          <a href="/app/configuracion">Configuración</a>
          <a className="is-active" href="/facturacion/demo" aria-current="page">Facturación</a>
        </aside>
        <main id="contenido" className="ab-billing-main">
          <div className="ab-page-heading">
            <div><p>Configuración de la cuenta</p><h1>Facturación</h1><span>Consulta tu plan, tus pagos y el estado de la prueba.</span></div>
            <button ref={paymentTriggerRef} className="ab-button ab-button-outline" type="button" onClick={() => { setPaymentOpen(true); setPaymentErrors({}); setPaymentMessage('') }}>Actualizar tarjeta</button>
          </div>

          {paymentMessage && <div className="ab-action-success" role="status"><CheckCircle size={19} weight="fill" aria-hidden="true" />{paymentMessage}</div>}

          <section className={`ab-billing-hero ${cancelled ? 'is-cancelled' : ''}`} aria-labelledby="billing-plan-title">
            <div className="ab-billing-plan-copy">
              <span className="ab-status-badge">{cancelled ? 'Cancelación programada' : 'Prueba gratuita activa'}</span>
              <h2 id="billing-plan-title">Plan Inmobiliaria</h2>
              <p>{cancelled ? `Tu acceso termina el ${trialEnd}. No se realizará ningún cargo.` : `Te quedan 30 días de prueba. El primer cargo será el ${trialEnd}.`}</p>
            </div>
            <div className="ab-billing-price"><strong>99,99 €</strong><span>/ mes, IVA incluido en este prototipo</span></div>
          </section>

          <section className="ab-billing-grid" aria-label="Resumen de facturación">
            <article>
              <span className="ab-summary-icon"><CalendarBlank size={23} weight="fill" aria-hidden="true" /></span>
              <small>Próximo cobro</small>
              <strong>{cancelled ? 'No habrá cobro' : '99,99 €'}</strong>
              <p>{cancelled ? `Acceso disponible hasta el ${trialEnd}` : `${trialEnd}, después cada mes`}</p>
            </article>
            <article>
              <span className="ab-summary-icon"><CreditCard size={23} weight="fill" aria-hidden="true" /></span>
              <small>Método de pago</small>
              <strong>Visa •••• {lastFour}</strong>
              <p>Método protegido por el proveedor de pagos</p>
            </article>
            <article>
              <span className="ab-summary-icon"><Receipt size={23} weight="fill" aria-hidden="true" /></span>
              <small>Última factura</small>
              <strong>Sin facturas todavía</strong>
              <p>La prueba comenzó hoy</p>
            </article>
          </section>

          <section className="ab-invoices" aria-labelledby="invoices-title">
            <div className="ab-section-heading"><div><h2 id="invoices-title">Facturas</h2><p>Tus facturas aparecerán aquí cuando comience el plan de pago.</p></div></div>
            <div className="ab-empty-invoice"><FileText size={28} aria-hidden="true" /><div><strong>Aún no hay facturas</strong><span>Tu primer recibo estará disponible después del cobro del {trialEnd}.</span></div></div>
          </section>

          <section className="ab-cancel-zone" aria-labelledby="cancel-title">
            <div>
              <h2 id="cancel-title">{cancelled ? 'La suscripción está cancelada' : 'Cancelar suscripción'}</h2>
              <p>{cancelled ? `Puedes reactivar el plan antes del ${trialEnd} y conservar tu configuración.` : `Si cancelas ahora, mantendrás el acceso hasta el ${trialEnd}. Después finalizará el acceso y no se realizará ningún cargo.`}</p>
            </div>
            {cancelled ? (
              <button ref={cancelTriggerRef} className="ab-button ab-button-outline" type="button" onClick={() => setCancelled(false)}>Reactivar plan</button>
            ) : (
              <button ref={cancelTriggerRef} className="ab-danger-link" type="button" onClick={() => setCancelOpen(true)}>Cancelar suscripción</button>
            )}
          </section>
        </main>
      </div>

      <ManagedDialog open={paymentOpen} onClose={() => setPaymentOpen(false)} triggerRef={paymentTriggerRef} labelledBy="payment-dialog-title" describedBy="payment-dialog-description">
        <form className="ab-modal" onSubmit={submitPaymentUpdate} noValidate>
          <span className="ab-modal-icon ab-modal-icon-payment"><CreditCard size={25} weight="fill" aria-hidden="true" /></span>
          <h2 id="payment-dialog-title">Actualiza tu tarjeta</h2>
          <p id="payment-dialog-description">La nueva tarjeta se usará para el primer cargo del {trialEnd}. No realizaremos ningún cargo hoy.</p>
          <div className="ab-modal-form">
            <div className="ab-field">
              <label htmlFor="update-card-name">Nombre en la tarjeta</label>
              <input id="update-card-name" data-autofocus autoComplete="cc-name" value={paymentName} onChange={(event) => { setPaymentName(event.target.value); setPaymentErrors((current) => ({ ...current, name: '' })) }} aria-invalid={Boolean(paymentErrors.name)} aria-describedby={paymentErrors.name ? 'update-name-error' : undefined} />
              <FieldError id="update-name-error">{paymentErrors.name}</FieldError>
            </div>
            <div className="ab-field">
              <label htmlFor="update-card-number">Número de tarjeta</label>
              <div className="ab-card-input">
                <CreditCard size={20} aria-hidden="true" />
                <input id="update-card-number" type={showPaymentCard ? 'text' : 'password'} autoComplete="cc-number" inputMode="numeric" placeholder="4242 4242 4242 4242" value={paymentCard} maxLength={19} onChange={(event) => { setPaymentCard(formatCard(event.target.value)); setPaymentErrors((current) => ({ ...current, card: '' })) }} aria-invalid={Boolean(paymentErrors.card)} aria-describedby={paymentErrors.card ? 'update-card-error' : 'update-card-help'} />
                <button type="button" onClick={() => setShowPaymentCard((value) => !value)} aria-label={showPaymentCard ? 'Ocultar número de tarjeta' : 'Mostrar número de tarjeta'}>{showPaymentCard ? <EyeSlash size={19} /> : <Eye size={19} />}</button>
              </div>
              <span className="ab-field-help" id="update-card-help">Para esta demo, usa 4242 4242 4242 4242.</span>
              <FieldError id="update-card-error">{paymentErrors.card}</FieldError>
            </div>
            <div className="ab-form-grid">
              <div className="ab-field">
                <label htmlFor="update-card-expiry">Caducidad</label>
                <input id="update-card-expiry" autoComplete="cc-exp" inputMode="numeric" placeholder="MM/AA" value={paymentExpiry} maxLength={5} onChange={(event) => { setPaymentExpiry(formatExpiry(event.target.value)); setPaymentErrors((current) => ({ ...current, expiry: '' })) }} aria-invalid={Boolean(paymentErrors.expiry)} aria-describedby={paymentErrors.expiry ? 'update-expiry-error' : undefined} />
                <FieldError id="update-expiry-error">{paymentErrors.expiry}</FieldError>
              </div>
              <div className="ab-field">
                <label htmlFor="update-card-cvc">CVC</label>
                <input id="update-card-cvc" type="password" autoComplete="cc-csc" inputMode="numeric" placeholder="•••" value={paymentCvc} maxLength={3} onChange={(event) => { setPaymentCvc(event.target.value.replace(/\D/g, '')); setPaymentErrors((current) => ({ ...current, cvc: '' })) }} aria-invalid={Boolean(paymentErrors.cvc)} aria-describedby={paymentErrors.cvc ? 'update-cvc-error' : undefined} />
                <FieldError id="update-cvc-error">{paymentErrors.cvc}</FieldError>
              </div>
            </div>
          </div>
          <div className="ab-modal-actions">
            <button className="ab-button ab-button-plain" type="button" onClick={() => setPaymentOpen(false)}>Volver</button>
            <button className="ab-button ab-button-dark" type="submit">Guardar tarjeta</button>
          </div>
        </form>
      </ManagedDialog>

      <ManagedDialog open={cancelOpen} onClose={() => setCancelOpen(false)} triggerRef={cancelTriggerRef} labelledBy="cancel-dialog-title" describedBy="cancel-dialog-description">
          <section className="ab-modal">
            <span className="ab-modal-icon"><Warning size={25} weight="fill" aria-hidden="true" /></span>
            <h2 id="cancel-dialog-title">¿Quieres cancelar tu prueba?</h2>
            <p id="cancel-dialog-description">Seguirás teniendo acceso hasta el {trialEnd}. Después finalizará el acceso y no se cobrará la tarjeta.</p>
            <div className="ab-field">
              <label htmlFor="cancel-reason">¿Por qué quieres cancelar? <span>Opcional</span></label>
              <select id="cancel-reason" value={reason} onChange={(event) => setReason(event.target.value)}>
                <option value="">Selecciona un motivo</option>
                <option value="price">El precio no encaja</option>
                <option value="time">Necesito más tiempo</option>
                <option value="features">Me falta alguna función</option>
                <option value="other">Otro motivo</option>
              </select>
            </div>
            <div className="ab-modal-actions">
              <button className="ab-button ab-button-plain" data-autofocus type="button" onClick={() => setCancelOpen(false)}>Volver</button>
              <button className="ab-button ab-button-danger" type="button" onClick={confirmCancellation}>Confirmar cancelación</button>
            </div>
          </section>
      </ManagedDialog>
    </div>
  )
}

export function AuthBillingPage() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'

  if (path === '/precios') return <PricingPage />
  if (path === '/registro') return <SignupPage />
  if (path === '/iniciar-sesion') return <LoginPage />
  if (path === '/recuperar-contrasena') return <ForgotPasswordPage />
  if (path === '/restablecer-contrasena') return <ResetPasswordPage />
  if (path === '/verificar-correo') return <VerifyEmailPage />
  if (path === '/aceptar-invitacion') return <InvitationAcceptancePage />
  if (path === '/mis-solicitudes') return <TenantApplicationsPage />
  if (path === '/facturacion/demo') return <BillingPage />

  return (
    <div className="ab-page ab-not-found">
      <Brand />
      <h1>Página no disponible</h1>
      <a className="ab-button ab-button-dark" href="/">Volver al inicio</a>
    </div>
  )
}
