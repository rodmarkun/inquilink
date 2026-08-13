# Inquilink Security Audit — 2026-08-12

Branch: `codex/dashboard-shadcn-light`
Scope: React/Vite frontend (`src/`), Fastify/Drizzle backend (`server/`), Docker stack (web `:8080`, API `:3001`).
Method: source review + live curl probes against `http://localhost:3001` (unauthenticated, cross-agency IDOR, role escalation) using seeded accounts (`demo@inquilink.es`, `otra-agencia@inquilink.es`, `equipo@inquilink.es`, `inquilino@inquilink.es`, all `demo1234`).

Overall: the **backend authorization model is strong** — every `/api/v1/agency/*` and `/api/v1/tenant/*` endpoint is guarded by `requireAgency`/`requireAdmin`/`requireTenant`, all queries are tenancy-scoped by `agencyId`/`tenantUserId`, IDOR probes return 404/403, secrets/config are production-hardened, and inputs are strictly validated. The **material problem is on the frontend**: an unauthenticated visitor to `/app` is served the full agency workspace shell instead of being redirected to login. Secondary hardening gaps (missing HTTP security headers, unauthenticated analytics with no rate limit, always-on Swagger UI) are lower severity.

---

## HIGH

### H1 — Unauthenticated `/app` renders the agency workspace shell (no redirect to login)
Files: `src/App.tsx` (routing), `src/pages/AgencyWorkspacePage.tsx` (lines ~762-810 load effect, ~1076-1200 render).

`App.tsx` renders `<AgencyWorkspacePage/>` for any `/app*` path with **no auth gate**. The workspace component always renders its full chrome (sidebar nav "Panel / Mis anuncios / Citas / Configuración / Equipo / Facturación", topbar, agency/user pills, "Buenos días…" dashboard) *before and regardless of* the result of the `/api/v1/agency/dashboard` fetch.

When unauthenticated on the deployed app (`:8080`), the dashboard request returns `401` JSON, so `dashboardLoadState` becomes `'error'`; the main content area shows an error with an "Iniciar sesión" link, but the **entire workspace layout stays on screen**. There is no redirect. To a visitor this reads as a real, broken dashboard and needlessly exposes the app's internal structure/labels.

A "demo mode" exists but is implicit and dev-only: `isStandaloneDemo = hostname∈{localhost,127.0.0.1} && port===5173` (the Vite dev server). It is not reachable in production and is not an "explicit, clearly labeled demo entry point."

Reproduction:
```
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/v1/agency/dashboard   # 401
# Browser: open http://localhost:8080/app with no session cookie ->
#   full workspace chrome renders; no redirect to /iniciar-sesion
```

Fix: gate the workspace on auth. When `/api/v1/agency/dashboard` (or `/api/v1/auth/me`) returns 401/403 and it is **not** the standalone dev demo, redirect the browser to `/iniciar-sesion?volver=<current path>` and render only a minimal "redirecting" placeholder — never the workspace chrome. The login page already honours `?volver=` (`safeAuthContinuation` in `AuthBillingPage.tsx`) and returns the user to `/app` after sign-in. Keep the demo strictly behind the existing `:5173` dev-only condition (or a future explicit `/app?demo=1`-style labeled entry). This also fixes mid-session token expiry, which should likewise bounce to login rather than leaving the shell visible.

---

## MEDIUM

### M1 — No HTTP security headers served for the web app (clickjacking / MIME / referrer)
File: `nginx.conf`.

The nginx server block sets no `X-Frame-Options`/`Content-Security-Policy` (clickjacking — the SPA including `/app` can be framed), no `X-Content-Type-Options: nosniff`, no `Referrer-Policy`, no `Permissions-Policy`. Confirmed:
```
curl -s -D - -o /dev/null http://localhost:8080/     # none of X-Frame-Options/CSP/X-Content-Type-Options present
curl -s -D - -o /dev/null http://localhost:8080/app  # same
```
(The API sets `X-Content-Type-Options: nosniff` only on the image route.)

Fix: add response headers in `nginx.conf` for HTML/app responses: `X-Frame-Options: DENY` (or a `frame-ancestors 'none'` CSP), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a conservative `Permissions-Policy`, and — behind TLS in production — HSTS. A baseline `Content-Security-Policy` (`default-src 'self'`; allow the inline styles the app needs) is recommended. Note: changes are source-level only; the running container is not rebuilt per instructions.

---

## LOW

### L1 — Unauthenticated analytics endpoint has no rate limit
File: `server/src/modules/analytics/routes.ts` (`POST /api/v1/analytics/events`).
Anonymous callers may post events (by design, for marketing funnel). Payload is tightly enum-validated (`additionalProperties:false`, name/placement/plan enums, extra `preValidation` key check) so there is no injection or PII vector, but there is **no rate limit**, allowing unbounded row insertion into the analytics table from anonymous clients.
Reproduction: `for i in $(seq 1 1000); do curl -s -X POST http://localhost:3001/api/v1/analytics/events -H 'Content-Type: application/json' -d '{"name":"marketing_cta_clicked"}'>/dev/null; done` → all `202`.
Fix: apply a per-IP fixed-window limit (reuse `enforceAuthRateLimits`-style bucketing) for anonymous analytics writes.

### L2 — Swagger UI / OpenAPI JSON exposed unauthenticated in all environments
File: `server/src/app.ts` (Swagger UI registered unconditionally at `/api/docs`).
`GET /api/docs` and `/api/docs/json` return `200` with no auth. Fine for local dev; in production this discloses the full API surface. Fix: gate docs behind an env flag (e.g. only when `NODE_ENV !== 'production'`) or behind auth.

---

## Verified NOT vulnerable (probed)

- **Cross-agency IDOR** — agency `otra-agencia` requesting agency `Casa Barrio`'s property / applications / application detail / status PATCH / appointment / archive / public-link all return **404** (queries scoped by `agencyId`); owner returns 200. Tenant→agency endpoints return **403**; tenant→other tenant's application returns **404**.
- **Unauthenticated agency/tenant/billing/account/analytics-summary endpoints** — all return **401**.
- **Role authorization** — collaborator (non-admin) hitting admin-only billing status/invoices/team-invitations/settings returns **403**; legitimate dashboard access 200.
- **Public link tokens** (`/api/v1/public/properties/:token`) — 256-bit `randomBytes(32)` base64url, stored/looked-up as SHA-256 hash; not enumerable. Min length 20 enforced.
- **Cover-image upload** (`POST …/cover-image`) — content-type enum (jpeg/png), filename-extension/content-type match check, base64 decode bounded by `DOCUMENT_MAX_BYTES` (10 MB) under `BODY_LIMIT_BYTES` (15 MB, accommodates ~33% base64 inflation), full `sharp` re-decode/re-encode strips payloads, dimension/pixel caps, malware scan, single-frame check. Public image serve is scoped to the active agency's *current* cover URL only and rejects PDFs.
- **Document access** — private docs served only via short-lived scoped access tokens (`DOCUMENT_ACCESS_TTL_SECONDS`), tenant- or agency-scoped; `/documents/:id/content` requires auth (401 unauth).
- **Auth rate limiting** — login/register/recover/verify/invitation-accept all call `enforceAuthRateLimits` (per-IP + per-account fixed windows). Passwords hashed with argon2; login uses a dummy-hash compare to avoid user-enumeration timing.
- **Injection in filters/sort** — all `orderBy`/filters use hardcoded Drizzle column expressions and parameterized values; no raw SQL from user input.
- **Error leakage** — central handler maps Zod/Fastify/DB errors to stable Spanish messages; unhandled errors log only whitelisted stable fields and return a generic `INTERNAL_ERROR` (DB messages that may embed PII are never returned).
- **Config/secrets** — `server/src/config.ts` forces, in `NODE_ENV=production`: `COOKIE_SECURE`, HTTPS `APP_ORIGIN`, TLS Postgres, rotated vault/access secrets, HTTPS provider URLs, no local providers. `COOKIE_SECURE` defaults true and is only forced false for non-production. Session cookie is `httpOnly`, `sameSite=lax`. No secrets in the frontend bundle (same-origin cookie auth; bundle scan clean). Compose hardcoded secrets are local-only.
- **CSV "export"** — client-side only (built from already-authorized, agency-scoped data in `AgencyWorkspacePage.tsx`); no server endpoint.

---

## Fix priority
1. **H1** (frontend redirect) — implement via Codex.
2. **M1** (nginx headers) — source fix via Codex.
3. **L1 / L2** — optional hardening (deferred unless in scope).
