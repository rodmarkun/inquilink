import { type FormEvent, useEffect, useRef, useState } from 'react'
import { CheckCircle, Plus, SignOut, SpinnerGap, UserPlus, Warning } from '@phosphor-icons/react'
import './FunnelControls.css'

type ApiErrorPayload = { error?: { code?: string; message?: string } }

async function responseError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as ApiErrorPayload
  return new Error(payload.error?.message ?? fallback)
}

function operationKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export function WorkspaceLogoutButton({ className = 'agency-nav-item' }: { className?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const logout = async () => {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error('No hemos podido cerrar la sesión.')
      window.location.assign('/iniciar-sesion')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No hemos podido cerrar la sesión.'); setBusy(false) }
  }
  return <><button className={className} type="button" disabled={busy} onClick={() => void logout()}><SignOut size={19} />{busy ? 'Cerrando sesión…' : 'Cerrar sesión'}</button>{error && <span className="funnel-logout-error" role="alert">{error}</span>}</>
}

export function VerificationResend({ initialEmail = '', accountType = 'agency', returnPath, compact = false }: { initialEmail?: string; accountType?: 'agency' | 'tenant'; returnPath?: string; compact?: boolean }) {
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { if (initialEmail) setEmail(initialEmail) }, [initialEmail])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/v1/auth/resend-verification', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email, accountType, returnPath: returnPath ?? (accountType === 'agency' ? '/registro?verificado=1' : undefined) }) })
      if (!response.ok) throw await responseError(response, 'No hemos podido reenviar el correo.')
      const payload = await response.json() as { data?: { message?: string } }
      setMessage(payload.data?.message ?? 'Revisa tu bandeja de entrada.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No hemos podido reenviar el correo.') } finally { setBusy(false) }
  }
  return <form className={`funnel-resend ${compact ? 'funnel-resend--compact' : ''}`} onSubmit={submit}>
    {!compact && <label htmlFor="resend-verification-email">Correo de la cuenta</label>}
    <div><input id="resend-verification-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@inmobiliaria.es" aria-label={compact ? 'Correo de la cuenta' : undefined} /><button type="submit" disabled={busy || !email.trim()}>{busy ? 'Enviando…' : 'Reenviar verificación'}</button></div>
    {message && <p className="funnel-feedback funnel-feedback--success" role="status"><CheckCircle size={17} weight="fill" />{message}</p>}
    {error && <p className="funnel-feedback funnel-feedback--error" role="alert"><Warning size={17} weight="fill" />{error}</p>}
  </form>
}

type PlanCode = 'particular' | 'professional' | 'inmobiliaria'
type BillingStatus = {
  subscription: { plan: PlanCode; state: 'incomplete' | 'trialing' | 'active' | 'past_due' | 'cancelled'; cancelAtPeriodEnd: boolean; currentPeriodEndsAt: string | null } | null
  prices: Record<PlanCode, number>
  allowances: Record<PlanCode, { name: string; priceCents: number; listingLimit: number; accountLimit: number | null }>
  currency: string
  fiscalProfile: { fiscalId: string | null; billingName: string | null; billingAddress: string | null } | null
}

export function PlanManager() {
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [selected, setSelected] = useState<PlanCode | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [fiscal, setFiscal] = useState({ fiscalId: '', billingName: '', billingAddress: '' })
  const [fiscalBusy, setFiscalBusy] = useState(false)
  const operationKeysRef = useRef(new Map<PlanCode, string>())
  const fiscalOperationRef = useRef<{ fingerprint: string; key: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/v1/billing/status', { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw await responseError(response, 'No hemos podido cargar tu plan.'); return response.json() as Promise<{ data?: BillingStatus }> })
      .then((payload) => { if (payload.data) { setStatus(payload.data); setSelected(payload.data.subscription?.plan ?? null); setFiscal({ fiscalId: payload.data.fiscalProfile?.fiscalId ?? '', billingName: payload.data.fiscalProfile?.billingName ?? '', billingAddress: payload.data.fiscalProfile?.billingAddress ?? '' }) } })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'No hemos podido cargar tu plan.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])
  const changePlan = async () => {
    if (!selected || !status?.subscription || selected === status.subscription.plan) return
    setBusy(true); setError(''); setMessage('')
    try {
      const key = operationKeysRef.current.get(selected) ?? operationKey('plan')
      operationKeysRef.current.set(selected, key)
      const response = await fetch('/api/v1/billing/plan', { method: 'PATCH', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ plan: selected }) })
      if (!response.ok) throw await responseError(response, 'No hemos podido cambiar el plan.')
      setStatus((current) => current ? { ...current, subscription: current.subscription ? { ...current.subscription, plan: selected } : null } : current)
      setMessage(`Plan ${status.allowances[selected].name} activado.`)
      operationKeysRef.current.delete(selected)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No hemos podido cambiar el plan.') } finally { setBusy(false) }
  }
  const saveFiscalProfile = async (event: FormEvent) => {
    event.preventDefault(); setFiscalBusy(true); setError(''); setMessage('')
    try {
      const fingerprint = JSON.stringify(fiscal)
      if (fiscalOperationRef.current?.fingerprint !== fingerprint) fiscalOperationRef.current = { fingerprint, key: operationKey('fiscal') }
      const response = await fetch('/api/v1/billing/fiscal-profile', { method: 'PATCH', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': fiscalOperationRef.current.key }, body: fingerprint })
      if (!response.ok) throw await responseError(response, 'No hemos podido guardar los datos fiscales.')
      fiscalOperationRef.current = null
      setMessage('Datos fiscales guardados y sincronizados para las próximas facturas.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No hemos podido guardar los datos fiscales.') } finally { setFiscalBusy(false) }
  }
  if (loading) return <div className="funnel-loading" role="status"><SpinnerGap size={20} />Cargando plan…</div>
  if (!status?.subscription) return <div className="funnel-empty"><strong>No hay una suscripción activa</strong><p>Activa primero la prueba para poder gestionar el plan.</p>{error && <p className="funnel-feedback funnel-feedback--error">{error}</p>}</div>
  return <section className="funnel-plan" aria-labelledby="funnel-plan-title">
    <header><div><h2 id="funnel-plan-title">Cambiar de plan</h2><p>El cambio se aplica al momento. Para bajar de plan, tu uso actual debe caber en sus límites.</p></div></header>
    <div className="funnel-plan__options">{(Object.keys(status.allowances) as PlanCode[]).map((plan) => { const item = status.allowances[plan]; const current = status.subscription?.plan === plan; return <label className={`${selected === plan ? 'is-selected' : ''} ${current ? 'is-current' : ''}`} key={plan}><input type="radio" name="billing-plan" value={plan} checked={selected === plan} onChange={() => { setSelected(plan); setError(''); setMessage('') }} /><span><strong>{item.name}</strong><small>{(item.priceCents / 100).toLocaleString('es-ES', { style: 'currency', currency: status.currency })} / mes</small></span><em>{item.listingLimit} anuncios · {item.accountLimit ?? 'Cuentas ilimitadas'}{typeof item.accountLimit === 'number' ? ` cuentas` : ''}</em>{current && <b>Plan actual</b>}</label> })}</div>
    <button className="funnel-primary" type="button" disabled={busy || !selected || selected === status.subscription.plan} onClick={() => void changePlan()}>{busy ? 'Aplicando cambio…' : 'Confirmar cambio'}</button>
    <form className="funnel-fiscal" onSubmit={saveFiscalProfile}>
      <div><h2>Datos fiscales</h2><p>Se sincronizan con el emisor y se usarán en las próximas facturas.</p></div>
      <label>NIF / NIE / CIF<input required value={fiscal.fiscalId} onChange={(event) => setFiscal((current) => ({ ...current, fiscalId: event.target.value.toUpperCase() }))} /></label>
      <label>Nombre o razón social<input required value={fiscal.billingName} onChange={(event) => setFiscal((current) => ({ ...current, billingName: event.target.value }))} /></label>
      <label>Dirección fiscal<textarea required rows={2} value={fiscal.billingAddress} onChange={(event) => setFiscal((current) => ({ ...current, billingAddress: event.target.value }))} /></label>
      <button className="funnel-primary" disabled={fiscalBusy}>{fiscalBusy ? 'Guardando…' : 'Guardar datos fiscales'}</button>
    </form>
    {message && <p className="funnel-feedback funnel-feedback--success" role="status"><CheckCircle size={17} weight="fill" />{message}</p>}
    {error && <p className="funnel-feedback funnel-feedback--error" role="alert"><Warning size={17} weight="fill" />{error}</p>}
  </section>
}

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No hemos podido leer la imagen.'))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(file)
  })
}

export async function uploadPropertyCoverImage(propertyId: string, file: File): Promise<{ coverImageUrl: string; version: number }> {
  if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Selecciona una imagen JPG o PNG.')
  const dataBase64 = await fileAsBase64(file)
  const response = await fetch(`/api/v1/agency/properties/${encodeURIComponent(propertyId)}/cover-image`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ originalName: file.name, contentType: file.type, dataBase64 }) })
  if (!response.ok) throw await responseError(response, 'No hemos podido subir la imagen.')
  const payload = await response.json() as { data?: { coverImageUrl?: string; version?: number } }
  if (!payload.data?.coverImageUrl || !payload.data.version) throw new Error('No hemos podido confirmar la imagen.')
  return { coverImageUrl: payload.data.coverImageUrl, version: payload.data.version }
}

type TeamMember = { userId: string; fullName: string; email: string; role: 'admin' | 'collaborator'; joinedAt: string }
type Invitation = { id: string; email: string; role: 'admin' | 'collaborator'; expiresAt: string; createdAt: string }
type PaginationMetadata = { page: number; pageSize: number; total: number; totalPages: number; hasMore: boolean }

async function fetchAllTeamMembers(): Promise<TeamMember[]> {
  const members: TeamMember[] = []
  let page = 1
  let hasMore = true
  while (hasMore) {
    const response = await fetch(`/api/v1/agency/team?page=${page}&pageSize=100`, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!response.ok) throw await responseError(response, 'No hemos podido cargar el equipo.')
    const payload = await response.json() as { data?: { members?: TeamMember[]; pagination?: PaginationMetadata } }
    members.push(...(payload.data?.members ?? []))
    hasMore = payload.data?.pagination?.hasMore ?? false
    page += 1
  }
  return members
}

export function TeamManager({ canInvite }: { canInvite: boolean }) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [memberPagination, setMemberPagination] = useState<PaginationMetadata | null>(null)
  const [invitationPagination, setInvitationPagination] = useState<PaginationMetadata | null>(null)
  const [loadingMore, setLoadingMore] = useState<'members' | 'invitations' | null>(null)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const invitationOperationKeysRef = useRef(new Map<string, string>())
  const load = async () => {
    setLoading(true); setError('')
    try {
      const [teamResponse, invitationsResponse] = await Promise.all([fetch('/api/v1/agency/team?page=1&pageSize=25', { credentials: 'include', headers: { Accept: 'application/json' } }), canInvite ? fetch('/api/v1/agency/team/invitations?page=1&pageSize=25', { credentials: 'include', headers: { Accept: 'application/json' } }) : Promise.resolve(null)])
      if (!teamResponse.ok) throw await responseError(teamResponse, 'No hemos podido cargar el equipo.')
      const teamPayload = await teamResponse.json() as { data?: { members?: TeamMember[]; pagination?: PaginationMetadata } }
      setMembers(teamPayload.data?.members ?? [])
      setMemberPagination(teamPayload.data?.pagination ?? null)
      if (invitationsResponse) { if (!invitationsResponse.ok) throw await responseError(invitationsResponse, 'No hemos podido cargar las invitaciones.'); const payload = await invitationsResponse.json() as { data?: { invitations?: Invitation[]; pagination?: PaginationMetadata } }; setInvitations(payload.data?.invitations ?? []); setInvitationPagination(payload.data?.pagination ?? null) }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No hemos podido cargar el equipo.') } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [canInvite])
  const loadMoreItems = async (kind: 'members' | 'invitations') => {
    const current = kind === 'members' ? memberPagination : invitationPagination
    if (!current?.hasMore || loadingMore) return
    setLoadingMore(kind); setError('')
    try {
      const path = kind === 'members' ? '/api/v1/agency/team' : '/api/v1/agency/team/invitations'
      const response = await fetch(`${path}?page=${current.page + 1}&pageSize=${current.pageSize}`, { credentials: 'include', headers: { Accept: 'application/json' } })
      if (!response.ok) throw await responseError(response, 'No hemos podido cargar más resultados.')
      const payload = await response.json() as { data?: { members?: TeamMember[]; invitations?: Invitation[]; pagination?: PaginationMetadata } }
      if (kind === 'members') { setMembers((items) => [...items, ...(payload.data?.members ?? [])]); setMemberPagination(payload.data?.pagination ?? null) }
      else { setInvitations((items) => [...items, ...(payload.data?.invitations ?? [])]); setInvitationPagination(payload.data?.pagination ?? null) }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No hemos podido cargar más resultados.') } finally { setLoadingMore(null) }
  }
  const invite = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const normalizedEmail = email.trim().toLowerCase()
      const key = invitationOperationKeysRef.current.get(normalizedEmail) ?? operationKey('invite')
      invitationOperationKeysRef.current.set(normalizedEmail, key)
      const response = await fetch('/api/v1/agency/team/invitations', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ email: normalizedEmail }) })
      if (!response.ok) throw await responseError(response, 'No hemos podido enviar la invitación.')
      invitationOperationKeysRef.current.delete(normalizedEmail); setEmail(''); await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No hemos podido enviar la invitación.') } finally { setBusy(false) }
  }
  return <section className="funnel-team"><header><div><h1>Equipo</h1><p>Reparte anuncios e interesados entre las personas de tu agencia.</p></div>{canInvite && <form onSubmit={invite}><label htmlFor="team-invitation-email">Correo del colaborador</label><div><input id="team-invitation-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="persona@agencia.es" /><button className="funnel-primary" disabled={busy}><UserPlus size={18} />{busy ? 'Enviando…' : 'Invitar'}</button></div></form>}</header>
    {error && <p className="funnel-feedback funnel-feedback--error" role="alert"><Warning size={17} weight="fill" />{error}</p>}
    {loading ? <div className="funnel-loading"><SpinnerGap size={20} />Cargando equipo…</div> : <><div className="funnel-team__list">{members.map((member) => <article key={member.userId}><span>{member.fullName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span><div><strong>{member.fullName}</strong><small>{member.email}</small></div><em>{member.role === 'admin' ? 'Administración' : 'Colaboración'}</em></article>)}{memberPagination?.hasMore && <button className="funnel-primary" type="button" disabled={Boolean(loadingMore)} onClick={() => void loadMoreItems('members')}>{loadingMore === 'members' ? 'Cargando…' : `Cargar más miembros (${members.length} de ${memberPagination.total})`}</button>}{invitations.map((invitation) => <article className="is-pending" key={invitation.id}><span>?</span><div><strong>{invitation.email}</strong><small>Caduca el {new Date(invitation.expiresAt).toLocaleDateString('es-ES')}</small></div><em>Invitación pendiente</em></article>)}{invitationPagination?.hasMore && <button className="funnel-primary" type="button" disabled={Boolean(loadingMore)} onClick={() => void loadMoreItems('invitations')}>{loadingMore === 'invitations' ? 'Cargando…' : `Cargar más invitaciones (${invitations.length} de ${invitationPagination.total})`}</button>}</div></>}
  </section>
}

type Note = { note: { id: string; body: string; createdAt: string }; authorName: string }

export function ApplicantCollaborationControls({ applicationId, initialResponsibleUserId, initialNotes, onResponsibleChanged }: { applicationId: string; initialResponsibleUserId: string | null; initialNotes: Note[]; onResponsibleChanged?: (user: { id: string; fullName: string } | null) => void }) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [responsibleUserId, setResponsibleUserId] = useState(initialResponsibleUserId ?? '')
  const [notes, setNotes] = useState(initialNotes)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<'assignee' | 'note' | null>(null)
  const [error, setError] = useState('')
  useEffect(() => setNotes(initialNotes), [initialNotes])
  useEffect(() => setResponsibleUserId(initialResponsibleUserId ?? ''), [initialResponsibleUserId])
  useEffect(() => { void fetchAllTeamMembers().then(setMembers).catch(() => undefined) }, [])
  const assign = async (next: string) => {
    const previous = responsibleUserId; setResponsibleUserId(next); setBusy('assignee'); setError('')
    try {
      const response = await fetch(`/api/v1/agency/applications/${encodeURIComponent(applicationId)}/responsible-user`, { method: 'PATCH', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ responsibleUserId: next || null }) })
      if (!response.ok) throw await responseError(response, 'No hemos podido cambiar la persona responsable.')
      const user = members.find((member) => member.userId === next); onResponsibleChanged?.(user ? { id: user.userId, fullName: user.fullName } : null)
    } catch (caught) { setResponsibleUserId(previous); setError(caught instanceof Error ? caught.message : 'No hemos podido cambiar la persona responsable.') } finally { setBusy(null) }
  }
  const addNote = async (event: FormEvent) => {
    event.preventDefault(); if (!body.trim()) return; setBusy('note'); setError('')
    try {
      const response = await fetch(`/api/v1/agency/applications/${encodeURIComponent(applicationId)}/notes`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) })
      if (!response.ok) throw await responseError(response, 'No hemos podido guardar la nota.')
      const payload = await response.json() as { data?: { note?: { id: string; body: string; createdAt: string; authorName: string } } }
      const note = payload.data?.note
      if (!note) throw new Error('No hemos podido confirmar la nota.')
      setNotes((current) => [{ note: { id: note.id, body: note.body, createdAt: note.createdAt }, authorName: note.authorName }, ...current]); setBody('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No hemos podido guardar la nota.') } finally { setBusy(null) }
  }
  return <div className="funnel-collaboration"><section><label htmlFor={`responsible-${applicationId}`}>Responsable</label><select id={`responsible-${applicationId}`} value={responsibleUserId} disabled={busy === 'assignee'} onChange={(event) => void assign(event.target.value)}><option value="">Sin asignar</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.fullName}</option>)}</select></section><section><h2>Notas internas</h2><form onSubmit={addNote}><label className="funnel-sr-only" htmlFor={`note-${applicationId}`}>Nueva nota interna</label><textarea id={`note-${applicationId}`} rows={3} maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Añade contexto útil para el equipo" /><button className="funnel-primary" disabled={busy === 'note' || !body.trim()}><Plus size={17} />{busy === 'note' ? 'Guardando…' : 'Añadir nota'}</button></form>{notes.length ? <ul>{notes.map((item) => <li key={item.note.id}><strong>{item.authorName}</strong><p>{item.note.body}</p><small>{new Date(item.note.createdAt).toLocaleString('es-ES')}</small></li>)}</ul> : <p className="funnel-muted">Todavía no hay notas internas.</p>}</section>{error && <p className="funnel-feedback funnel-feedback--error" role="alert"><Warning size={17} weight="fill" />{error}</p>}</div>
}
