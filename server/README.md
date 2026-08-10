# Inquilink API

Production-oriented TypeScript backend for the Inquilink MVP. User-facing API messages are Spanish (`es-ES`); internal identifiers and code are English.

## Runtime

- Fastify 5 on Node.js 22
- PostgreSQL 16 through Drizzle ORM
- Opaque, server-side sessions. Only a SHA-256 digest is persisted; the browser receives an `HttpOnly`, `SameSite=Lax` cookie.
- Argon2id password hashing
- Provider-neutral billing and email contracts with deterministic local adapters and configurable HTTPS production gateways
- Durable email outbox with claim leases, bounded retries, terminal failure state, scheduled notifications, and a separately runnable worker
- Swagger UI at `/api/docs`; OpenAPI JSON at `/api/docs/json`

Run the entire app from the repository root:

```sh
docker compose --profile demo up -d --build
```

The explicit `demo` profile binds only to `127.0.0.1`. The API is available through `http://localhost:8080/api/v1` and directly on port `3001`; captured verification and recovery emails are visible in Mailpit at `http://localhost:8025`. Compose also runs the email worker as a separate healthy service. Migrations run before the API starts; the known demo seed and local providers are never started unless this profile is selected. The local agency account is `demo@inquilink.es` / `demo1234`; the tenant account is `inquilino@inquilink.es` / `demo1234`. The seeded tenant intake path is `/solicitud/demo-chamberi-public-link`.

For backend-only development:

```sh
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Run one email reconciliation/delivery pass with `EMAIL_TRANSPORT=smtp EMAIL_SMTP_HOST=127.0.0.1 npm run email:dispatch`, or use the continuous worker. The test-only sink is accepted only when `ALLOW_LOCAL_PROVIDERS=true`; the Docker demo uses real SMTP delivery into Mailpit without printing recipients or message content.

Required configuration is parsed in `src/config.ts`. Production must provide `DATABASE_URL`, `APP_ORIGIN`, and HTTPS with `COOKIE_SECURE=true`. `COOKIE_SECURE=false` exists only in local Compose because it uses plain HTTP.

Production providers fail closed. Configure billing with `BILLING_PROVIDER_URL` and `BILLING_PROVIDER_TOKEN`. Gateway base URLs may include a path prefix with or without a trailing slash; Inquilink preserves that prefix. Configure email delivery with `EMAIL_TRANSPORT=webhook`, `EMAIL_PROVIDER_URL`, and `EMAIL_PROVIDER_TOKEN`; the configured endpoint receives rendered Spanish email over HTTPS. `ALLOW_LOCAL_PROVIDERS=true` is exclusively for explicit local/demo deployments.

Production also requires an HTTPS `APP_ORIGIN`, `COOKIE_SECURE=true`, and encrypted email delivery. SMTP must use implicit TLS (`EMAIL_SMTP_SECURE=true`) or require STARTTLS (`EMAIL_SMTP_REQUIRE_TLS=true`); webhook delivery requires an HTTPS URL. `TRUSTED_PROXY_RANGES` is empty by default and accepts a comma-separated allowlist of proxy IPs/CIDRs. Never trust an entire public or shared network: authentication throttling uses the resolved client IP. The Docker demo assigns nginx the deterministic address `172.30.0.10` and trusts only `172.30.0.10/32`; direct access to port 3001 therefore ignores spoofed forwarding headers.

`DATABASE_URL` must require TLS in production with `sslmode=require`, `verify-ca`, or preferably `verify-full`. Production rejects every local provider mode even if `ALLOW_LOCAL_PROVIDERS` is set; the localhost-only Docker demo deliberately runs with `NODE_ENV=development`.

### Production gateway HTTP contracts

Every gateway request uses `Authorization: Bearer <configured token>` and fails after 10 seconds for billing/email or 30 seconds for document services. Production URLs must use HTTPS. JSON contracts reject unknown fields and invalid enum/range values.

The billing URL is a base URL; the following paths are appended while preserving any configured prefix. All calls are `POST` with `Content-Type: application/json`:

| Path | Idempotency-Key | Request JSON | Successful response |
| --- | --- | --- | --- |
| `subscriptions/trial` | required; stable `billing-operation:<uuid>` | `{agencyId, plan: "particular"|"professional"|"inmobiliaria", paymentMethodToken, activationRequestedAt: ISO-8601, fiscalProfile: {fiscalId, billingName, billingAddress}}` | `{customerRef, subscriptionRef, paymentMethodDisplay: "Tarjeta terminada en 1234", trialEndsAt: ISO-8601}` |
| `subscriptions/trial/reconcile` | required; the original trial key | `{agencyId}` | the same trial object, or JSON `null` when that key definitely created no trial |
| `subscriptions/cancel` | required | `{subscriptionRef}` | any 2xx; a body is ignored |
| `subscriptions/reactivate` | required | `{subscriptionRef}` | any 2xx; a body is ignored |
| `subscriptions/change-plan` | required | `{subscriptionRef, plan: "particular"|"professional"|"inmobiliaria"}` | any 2xx; a body is ignored |
| `payment-methods/update` | required | `{customerRef, paymentMethodToken}` | `{paymentMethodDisplay: "Tarjeta terminada en 1234"}` |
| `customers/fiscal-profile` | required; stable `billing-operation:<uuid>` | `{customerRef, fiscalProfile: {fiscalId, billingName, billingAddress}}` | any 2xx; a body is ignored |
| `subscriptions/sync` | omitted | `{subscriptionRef}` | `{state, trialEndsAt, currentPeriodEndsAt, cancelAtPeriodEnd, paymentMethodDisplay, invoices}` |

`state` is `trialing`, `active`, `past_due`, or `cancelled`; the two dates and payment display may be `null`. `invoices` contains at most 100 items shaped as `{providerInvoiceRef, amountCents, currency, status, issuedAt, hostedUrl}`. Amounts are non-negative signed 32-bit integers, currency is a three-letter uppercase code, status is `open`, `paid`, `past_due`, `void`, or `uncollectible`, and `hostedUrl` may be `null`. Trial creation and reconciliation must return the provider-authoritative `trialEndsAt`; Inquilink never recalculates it after a delayed response. For mutation calls only, HTTP 402 or 422 is a definitive decline. Network/timeout errors and every other non-2xx status are ambiguous/retryable, so the gateway must deduplicate the stable key. Sync non-2xx responses are retried with persisted backoff.

The email webhook uses the configured URL exactly. It receives `POST` with `Idempotency-Key: email-outbox:<uuid>` and `{idempotencyKey, recipient, content: {subject, preview, text}}`. Any 2xx is success; any other status or transport failure is retried with the identical key. The gateway must deduplicate that key and must not require HTML content.

The document-storage URL is a base URL. Inquilink calls `objects?key=<percent-encoded-key>` using `PUT` with raw bytes and their allowlisted `Content-Type`, `GET` with no body, and `DELETE` with no body. GET must return raw bytes with an allowlisted content type; GET 404 means absent. DELETE 404 is idempotent success. Other non-2xx statuses fail the operation and are retried where a cleanup tombstone exists. The malware-scanner URL is used exactly: `POST` raw bytes with the file content type and `X-Inquilink-Filename: <percent-encoded-original-name>`, returning `{state: "clean"|"infected"|"error", provider}`. Only `clean` permits storage; non-2xx or malformed responses fail closed.

## Contracts and boundaries

All routes are prefixed `/api/v1`. Successful resources use `{ "data": ... }`. Errors use:

```json
{
  "error": { "code": "STABLE_MACHINE_CODE", "message": "Mensaje en español.", "details": null },
  "requestId": "request-id"
}
```

Agency list endpoints for properties, property applicants, appointments, team members, and pending invitations accept `page` (default `1`) and `pageSize` (default `25`, maximum `100`). Their existing array key is unchanged and `data.pagination` reports `{page, pageSize, total, totalPages, hasMore}`. Ordering includes an immutable ID tie-breaker so adjacent pages are deterministic.

Submitted application phone, individual/household monthly income, household counts, and intended move-in date are also stored in typed columns for indexed search, sorting, and reporting. `draft_data` remains the canonical compatible draft/submission snapshot. Schema migrations `0026`/`0028` add nullable columns without rewriting existing rows; `0029` installs a compatibility trigger so old application instances remain safe throughout a rolling deployment. The supported `npm run db:migrate` runner then backfills submitted rows in independently committed marker-driven batches and builds the five supporting indexes concurrently, repairing interrupted invalid builds before retrying. A persisted promotion marker makes the backfill resumable and prevents repeat rewrites; malformed legacy values remain `NULL` rather than aborting the migration.

Authentication routes are split by account type because the same email may own an agency account and a tenant account. Login therefore requires `accountType: "agency" | "tenant"`. Tenant `returnPath` values preserve a property-link flow and accept only same-origin relative paths.

Every agency-owned SQL read/write must include `agencyId` in its predicate. Every tenant-owned read/write must include `tenantUserId`. Missing or foreign records return the same `404` response to avoid resource discovery. Billing uses `requireAdmin`; collaborators cannot view or mutate billing.

Billing endpoints accept only a PCI provider token shaped like `pm_*`. Trial activation and payment-method updates require an `Idempotency-Key` header. Raw card numbers, CVC, provider tokens, and raw idempotency keys are never persisted. Particular is exactly 999 EUR cents/month with 2 simultaneous listings and 1 administrator. Profesional is exactly 4,999 cents with 15 listings and 3 total accounts. Inmobiliaria is exactly 9,999 cents with 100 listings and unlimited accounts. All plans have the same capabilities and a 30-day trial. Published and paused listings count; pending invitations reserve seats. Allowances are enforced under the agency-first lock at publish/reactivation and invitation creation/acceptance. Migration `0023` explicitly maps legacy `pro` to `professional` and legacy `business` to `inmobiliaria`; it never moves existing customers to Particular or deletes workspace data.

The email API adapter only enqueues. The worker claims due rows, recovers expired claims, retries with exponential backoff, and stores only stable failure codes. Every provider retry reuses an outbox-derived idempotency key. Sent, expired, and terminally failed rows have their recipient and template variables scrubbed; account closure also expires and scrubs every pending message in the affected user or agency scope. Time-driven reconciliation covers agency viewing reminders, trial-ending notices, and payment failures, and revalidates their source state immediately before delivery; event-driven routes enqueue tenant verification, password recovery, application receipts, viewing changes, new-applicant alerts, and team invitations. Subject lines and previews contain no applicant PII.

The same worker polls authoritative provider subscription and invoice state, then reconciles durable agency-closure billing cleanup before account purging. Mutations and cleanup use operation-derived provider idempotency keys; ambiguous outcomes retain their reservation for same-key reconciliation. An agency remains disabled but locally retained until external subscription cancellation is confirmed. Retryable operational queues use persisted due times and bounded exponential backoff. Application and account retention stay disabled until their approved legal periods are configured explicitly with `APPLICATION_RETENTION_DAYS` and `ACCOUNT_CLOSURE_RETENTION_DAYS`; no retention duration is silently assumed.

Analytics uses a fixed event-name union and fixed scalar columns, never an arbitrary payload. Requests with extra fields are rejected. Agency summaries are always filtered by the authenticated workspace.

Document bytes are kept behind `PrivateDocumentStorage`; metadata alone is stored in PostgreSQL. Downloads require both an authenticated owner/workspace member and a short-lived subject-bound bearer token in the `Authorization` header. Tokens never enter request URLs. Failed deletion retains a retryable database tombstone and the only cleanup key. The local storage adapter is deterministic development infrastructure, not a production object store or malware scanner.

Spanish-market applications keep one verified tenant account while `adultProfiles` records the primary applicant and co-applicants/adult occupants with separate identity, employment, income, and document ownership. Every category requested by a property is required for each recorded adult. Supported categories include nóminas, contrato, autónomo, declaración IRPF, vida laboral, pensión, aval and general supporting documents. Migration `0027_nappy_vision` backfills legacy applications and documents to the `primary` adult profile.

Agency registration accepts fiscal ID, billing name, and billing address. Trial activation sends that complete profile to the provider customer. Administrators can later update it through idempotent `PATCH /api/v1/billing/fiscal-profile`; when a provider customer exists, the external update succeeds before the local profile is committed, while ambiguous outcomes remain reserved for a same-key retry. `GET /api/v1/billing/status` returns the current fiscal profile. Submitted applications also persist normalized email/phone comparison keys. Agency applicant list and detail responses expose an informational `possibleDuplicate` signal only for matches within the same property; records are never merged, rejected, or status-changed automatically.

## Main endpoint groups

- `GET /api/v1/health`
- `GET /api/v1/ready` (database-backed readiness used by Docker)
- `/auth`: agency/tenant registration, verification, login, logout, recovery, current session
- `/billing`: trial activation, status, invoices, payment-method update, cancellation, reactivation
- `/agency/dashboard`: only the retained `Nuevos interesados` and `Próximas visitas` blocks
- `/agency/team`: members, hashed expiring invitations, role changes, and removal with last-admin protection
- `/account/profile` and `/agency/settings`: personal profile and admin-bounded agency identity updates
- `/analytics/events` and `/agency/analytics/summary`: privacy-safe allowlisted activation analytics
- `/agency/properties`: property lifecycle, public-link rotation, applicant workspace
- `/public/properties/:token`: minimal published property view
- `/tenant`: saved drafts, idempotent submission, own applications and documents
- `/agency/appointments`: viewing creation, overlap warnings, rescheduling and final states

Run `npm test`, `npm run typecheck`, and `npm run build` before merging. Integration tests use PGlite to execute the real SQL migrations and prove cross-agency/cross-tenant denial without requiring a developer-installed PostgreSQL server.
