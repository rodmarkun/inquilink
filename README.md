# Inquilink MVP

Inquilink includes a Spanish React interface and a production-oriented Fastify/PostgreSQL backend for the rental-applicant workflow. Docker Compose runs the web app, API, database, durable email worker, and local Mailpit inbox for the explicit demo profile.

## Run locally

```bash
npm install
npm run dev
```

Run the integrated demo instead with:

```bash
docker compose --profile demo up -d --build
```

Open `http://localhost:8080`. API documentation is available at `http://localhost:3001/api/docs`, and captured demo email at `http://localhost:8025`.

Production build:

```bash
npm run build
npm run preview
```

## Demo routes

- `/` - marketing homepage
- `/precios` - pricing and trial details
- `/registro?plan=professional` - signup and card-required trial flow
- `/iniciar-sesion` - login with a demo-account shortcut
- `/facturacion/demo` - billing and cancellation mockup
- `/solicitud/demo` - public tenant application
- `/app` - agency dashboard, properties, applicants, appointments, team, and settings

Any public application token other than `demo` intentionally displays an unavailable-link state.

## Current boundaries

The backend provides account/session authentication, tenant isolation, property and application workflows, private-document abstractions, provider-neutral billing, durable email delivery, account-closure cleanup, and Spanish API errors. The Docker demo uses deterministic local billing/document providers and Mailpit; production requires configured HTTPS billing, email, object-storage, and malware-scanning providers. WhatsApp contact remains a generated editable link with audited initiation, not delivery tracking.

Spanish-market workflow support includes one-account household applications with per-adult employment and document ownership, IRPF/vida laboral/pension/aval categories, agency NIF/NIE/CIF billing details, and informational same-property duplicate flags based on normalized email or phone.

Pricing has three capability-equivalent plans. Particular costs 999 EUR cents/month for 2 simultaneous listings and 1 administrator, Profesional costs 4,999 cents for 15 listings and 3 total accounts, and Inmobiliaria costs 9,999 cents for 100 listings and unlimited accounts. Published and paused listings consume capacity; pending invitations reserve account seats. The server serializes and enforces both limits. Migration `0023` maps legacy `pro` subscriptions to `professional` and legacy `business` subscriptions to `inmobiliaria`, so existing workspaces are never silently moved to the lower Particular tier.

See `server/README.md` for backend configuration, security boundaries, migrations, workers, and test commands.
