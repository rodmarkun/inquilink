# Guest application flow — design spec (to implement)

## Problem
Today, clicking a public listing link (`/solicitud/:token`, page `src/pages/PublicApplicationPage.tsx`)
forces the visitor to register or log in as a verified tenant BEFORE they can fill the application
form (`accountMode: 'register' | 'login'`; server draft/submit routes call `requireTenant`). That is
bad UX — a prospective tenant just wants to apply to an anuncio, not create an account.

Goal: link → a plain forms page where the visitor enters all their info with NO account required.
After submitting, optionally let them create an account (set a password) to retain data across anuncios.
Email AND phone must be mandatory. Must resist duplicates, spammers, and junk that pollutes the
inmobiliaria's pipeline.

## Chosen approach: passwordless verified-guest via email OTP + auto-provisioned tenant

Keep the existing invariant that every `applications` row has a real `tenantUserId` (NOT NULL, unique
`(propertyId, tenantUserId)` dedup, retention/documents all keyed on it). Do NOT make `tenantUserId`
nullable — instead make becoming a "tenant" frictionless and transparent:

### Flow
1. **Open form immediately.** Public property view is already unauthenticated
   (`GET /api/v1/public/properties/:token`). Render the full application form to anonymous visitors —
   remove the register/login gate. Draft autosave for anonymous users goes to **localStorage** (keyed by
   token), NOT the server (no server rows for unverified traffic). If the visitor IS already a logged-in
   tenant, keep the current server-draft behavior.
2. **Email + phone mandatory.** Make phone a required, validated field (Spanish/E.164, reuse existing
   `normalizeCandidatePhone`). Email already required.
3. **Verify on submit.** When the anonymous visitor clicks "Enviar solicitud", require a **6-digit email
   OTP** sent to the email they typed. Nothing is persisted to `applications` until the OTP is verified —
   this is the anti-spam / anti-duplicate keystone (proves the email is real and controlled by the sender).
4. **Auto-provision on verify.** On correct OTP, in one transaction: find-or-create a tenant `users` row
   for that normalized email (userKind=tenant, accountState=active, passwordHash NULL = passwordless,
   emailVerifiedAt=now), establish a tenant session cookie, then run the existing submit logic under that
   tenantUserId. Reusing an existing tenant email is transparent (no account-existence leak). The unique
   `(propertyId, tenantUserId)` index now naturally dedupes repeat applications to the same property from
   the same verified email (return the existing application idempotently, as submit already does).
5. **Optional account upgrade after submit.** On the success screen, offer "Guarda tus datos para futuros
   anuncios" → sets a password on the already-created passwordless user (new endpoint or reuse
   set-password), converting it into a normal login account. Their submitted + future applications persist.

## Anti-abuse / security layers (all required)
- **Email OTP before any persistence.** 6 digits, TTL 10 min, single-use, max 5 attempts then invalidate,
  constant-time compare. Reuse the `oneTimeTokens` infra (add a new `tokenKind` value e.g.
  `guest_application_otp`, scoped to email+propertyToken) or a dedicated small table — implementer's call,
  follow existing one-time-token patterns in `server/src/modules/auth/routes.ts`.
- **Rate limiting** (reuse the existing `authRateLimits` table + limiter used by auth routes):
  per-IP and per-email limits on OTP *send* (e.g. ≤5/hour/email, ≤15/hour/IP) and per-IP cap on
  applications/day. Never reveal whether the email already had an account (always 200 on send).
- **Phone mandatory + normalized**; on submit, if a DIFFERENT verified email already applied to this
  property with the SAME `normalizedPhone`, do NOT hard-block, but flag it for the agency (a soft
  "posible duplicado" signal on the application) and count it toward IP rate limits.
- **Cheap bot defenses, no external deps / no CAPTCHA:** a hidden honeypot field that must stay empty,
  and a minimum form-fill time check (reject sub-2s submissions). Privacy-friendly, no new dependencies.
- **GDPR consent** unchanged: keep requiring `privacyConsent` + `consentVersion` (CURRENT_CONSENT_VERSION),
  store consentedAt.
- Do not weaken any existing tenancy/IDOR checks. Public endpoints stay scoped by the link token hash.

## Explicit constraints for the implementer
- Backend: `server/` (Fastify + Drizzle). Follow existing route/module conventions in
  `server/src/modules/rentals/routes.ts` and `server/src/modules/auth/routes.ts`. Any schema change needs a
  new drizzle migration following `server/drizzle/0032_*` (journal + snapshot). Update `server/src/openapi.ts`
  and add/extend vitest tests (routes.test.ts) covering: anonymous submit requires OTP; OTP happy path
  provisions tenant + creates application; wrong/expired/too-many-attempts OTP; rate limiting; duplicate
  email → idempotent; duplicate phone different email → flagged; honeypot/too-fast rejected; upgrade to
  password account.
- Frontend: `src/pages/PublicApplicationPage.tsx` (+ its CSS). Add the OTP step and the post-submit
  "create account" upsell. Keep the shadcn-style visual language / coral accent.
- **OFF-LIMITS:** `src/pages/AuthBillingPage.tsx` and `AuthBillingPage.css` — another agent owns those right
  now. Touch `src/App.tsx` only additively if routing must change.
- Keep the whole server test suite green (currently 198 passing, 1 postgres-only skipped).
