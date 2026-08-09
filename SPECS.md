# Inquilink — Product Specification

**Version:** 2.1 — three-plan pricing and allowance specification  
**Product:** SaaS for Spanish rental-property owners and real-estate agencies  
**Specification language:** English  
**Required product language:** Spanish (`es-ES`)  

> This document is written in English for the product and engineering teams. Every user-facing screen, message, form, email, validation error, and piece of marketing copy must be in Spanish for the MVP.

## 1. Product definition

Inquilink gives a private rental-property owner or real-estate agency one organized place to manage everyone interested in each rental property.

For every property listing, Inquilink automatically generates a unique public link. The agency places that link in the property's advertisement or shares it directly. A prospective tenant opens the link, sees the relevant property, creates an Inquilink account or signs in, submits their details and salary-solvency documentation, and is automatically attached to that property inside the agency's workspace.

The agency can then see all interested applicants at a glance, move them through clear statuses, inspect their documentation, schedule a viewing, and open a WhatsApp conversation directly from the applicant record.

### Core promise

> **Miles de inquilinos. Un solo portal.**

### The problem it solves

Rental leads currently arrive through listing portals, email, calls, spreadsheets, and WhatsApp. Applicant details and financial documents are separated from the property they relate to, making comparison, follow-up, and viewing coordination slow and error-prone.

Inquilink replaces that fragmented workflow with one property-specific applicant pipeline.

### Core product rules

- The property is the primary organizing unit: every public link, application, document request, status, and viewing is understood in a property context.
- One submitted application belongs to exactly one agency and one property.
- The same person may apply to several properties; each interest remains a separate application with its own status and appointments.
- Every application belongs to an authenticated tenant account. One tenant account may hold several separate property applications.
- A repeated email or phone number for the same property may be flagged as a possible duplicate, but submissions are never silently merged or discarded.
- Agencies see only their own applicants. Inquilink does not provide a shared or searchable tenant database.

## 2. Product goals

The MVP must:

1. Let an agency create a rental listing and obtain its public applicant link in minutes.
2. Let a prospective tenant create or access an account and submit a complete application from a phone.
3. Associate every submission reliably with the correct agency and property.
4. Give the agency a genuinely scannable view of every applicant for a property.
5. Support the essential follow-up actions: status management, internal notes, document review, WhatsApp contact, and viewing scheduling.
6. Convert Spanish private owners and real-estate agencies through a clear marketing site and a card-required free trial.

### MVP success criteria

- A new agency can create and publish its first property in under five minutes.
- A tenant can complete the application on mobile without assistance.
- An agent can decide who needs attention next without opening each applicant individually.
- An agent can initiate a WhatsApp conversation or schedule a viewing in no more than two actions from the applicant list.
- No applicant, document, or property can be accessed by another agency.

## 3. Scope boundary

### Included in the MVP

- Spanish public marketing website.
- Agency registration, login, password reset, and card-required trial activation.
- Tenant registration, email verification, login, password reset, saved application drafts, and access to their own submitted applications.
- Authenticated `Panel` and `Mis anuncios` areas.
- Property creation, editing, publication, pausing, and archiving.
- One automatically generated public application link per published property.
- Mobile-first tenant application form available only after tenant authentication.
- Secure upload and review of salary-solvency documents.
- Property-specific applicant table and applicant detail view.
- Applicant statuses, filters, assignment, and internal notes.
- Direct WhatsApp deep link with an editable prefilled message.
- Viewing creation, rescheduling, cancellation, and completion.
- Essential Spanish transactional emails.
- Particular, Profesional, and Inmobiliaria monthly subscriptions with a free first month.

### Explicitly not included in the MVP

- A public property marketplace or property search engine.
- Publishing listings directly to Idealista, Fotocasa, or other portals.
- Rent collection, accounting, deposits, contracts, or electronic signatures.
- Credit checks, background checks, or automatic tenant approval/rejection.
- Automated applicant scoring or ranking.
- WhatsApp Business API delivery, inbox synchronization, or delivery receipts.
- Google or Outlook calendar synchronization.
- A broad tenant marketplace or self-service area beyond the tenant's own application drafts and submitted applications.
- Native iOS or Android apps.
- Custom workflows or custom applicant form builders.

These exclusions are deliberate. The first release is a focused applicant-intake and follow-up product, not a complete property-management suite.

## 4. Users and permissions

### Workspace administrator

The primary authenticated user. They can manage the workspace, billing, listings, applicants, documents, statuses, notes, and viewings. A Particular workspace has exactly one administrator account and cannot add collaborators.

### Agency collaborator

An authenticated user invited into the same agency workspace. They can work with listings and applicants but cannot manage billing or transfer ownership. Collaborators are available on Profesional and Inmobiliaria within each plan's total account allowance.

### Prospective tenant

An authenticated user who opens a property link, creates an account or signs in, and submits an application. They can access only their own drafts and submitted applications. They never see other applicants or internal agency information.

### Tenant isolation

Every agency-owned record belongs to one agency, and every tenant-owned application is linked to one tenant account. Server-side authorization must enforce both boundaries on every property, application, file, appointment, note, and billing request. Changing a URL or identifier must never expose another agency's information or another tenant's application.

## 5. Required language and regional behavior

- The complete product experience must use Spain-specific Spanish (`es-ES`).
- Internal code, routes, and this specification may use English.
- Prefer clear Spanish interface labels: `Panel`, `Mis anuncios`, `Interesados`, `Citas`, `Configuración`, and `Facturación`.
- Dates are displayed as `DD/MM/YYYY` and times use the 24-hour format.
- Currency is displayed as `49,99 € / mes`, not `$49.99` or `€49.99/month`.
- The default timezone is `Europe/Madrid`.
- Tone is concise, professional, reassuring, and free of unnecessary jargon.

## 6. End-to-end experience

### 6.1 Agency signup and trial

1. A visitor clicks `Pruébalo ahora` or chooses a pricing plan.
2. They provide their name, workspace or agency name, email, phone number, and password.
3. They verify their email.
4. They select Particular, Profesional, or Inmobiliaria and add a valid payment card.
5. A 30-day free trial starts immediately. The checkout shows the exact trial end date and exact post-trial price before confirmation.
6. Unless cancelled, the selected monthly plan is charged automatically when the trial ends.
7. The administrator enters `Panel` and sees `Crear mi primer anuncio` as the primary onboarding action.

The interface must say plainly: `Primer mes gratis. Se requiere tarjeta. Cancela antes del [fecha] para evitar el primer cargo.` For billing purposes, “first month” means 30 consecutive days from activation, not the remainder of the current calendar month.

### 6.2 Create and share a property

1. The administrator opens `Mis anuncios` and clicks `Nuevo anuncio`.
2. They add the property details, cover photo, and documents they want applicants to provide.
3. They save a draft or select `Publicar y generar enlace`.
4. Publishing creates a unique, non-sequential, hard-to-guess URL.
5. A success state displays the link with `Copiar enlace`, `Abrir enlace`, and `Compartir por WhatsApp` actions.
6. Every valid submission through that link appears under that property.

A paused or archived property keeps its existing data but its public page stops accepting new applications. An administrator may regenerate the link after a clear warning that the previous link will stop working.

The public link shows only the information needed to identify the opportunity: agency identity, property title, cover image, published location, monthly rent, bedrooms, bathrooms, floor area, availability date, and short description. The application form follows immediately. Public application pages use `noindex, nofollow`; SEO acquisition belongs to the marketing site, not to private intake links.

### 6.3 Tenant application

1. The prospective tenant opens the link, normally on mobile.
2. They see the agency name/logo, property summary, expected completion time, and privacy explanation.
3. Before the form becomes available, they create an account and verify their email, or sign in to an existing account. The property-link context must survive registration, verification, login, and password recovery.
4. They complete a short multi-step form. Their verified name and email are prefilled from the account and remain reviewable.
5. They upload the requested proof-of-income documents.
6. They accept the required privacy terms and submit.
7. They see a Spanish confirmation, receive a confirmation email, and can open the submitted application from their account.
8. The new application appears immediately in the correct property's applicant list with status `Nuevo`.

The form requires an authenticated tenant account. Draft progress is stored against that account so it can be resumed safely across devices. Repeated clicks or safe retries must not create duplicate submissions.

### 6.4 Review and follow up

1. The administrator opens `Mis anuncios` and selects a property.
2. They see all interested applicants in one dense but readable table.
3. They search, filter, sort, or scan the default columns.
4. From the row, they can change status, open WhatsApp, or schedule a viewing.
5. Opening the applicant reveals all submitted data, secure files, notes, appointments, and activity history.

### 6.5 Schedule a viewing

1. From an applicant row or detail view, the agent selects `Agendar visita`.
2. They choose date, time, duration, responsible collaborator, and optional instructions.
3. The appointment is stored against both the applicant and property.
4. The applicant receives a Spanish email confirmation.
5. The agent can later reschedule, cancel, mark as completed, or mark as `No se presentó`.

## 7. Public marketing website

### 7.1 Visual direction

The website must feel clean, confident, and spacious, with the clarity associated with Cloudflare's public site while retaining an original identity.

- White is the dominant page and surface color.
- Primary buttons are black with elegant white text.
- Typography is a modern, highly legible sans serif with a restrained scale.
- Borders are light; shadows are minimal or absent.
- One warm accent color may be used sparingly for highlights and illustration.
- Corporate Memphis illustrations use simplified people, property shapes, geometric forms, flat color, and friendly proportions.
- Illustration supports the product story; it must not make the product feel childish.
- Motion is subtle and functional, and respects `prefers-reduced-motion`.
- The complete site is responsive and meets WCAG 2.2 AA contrast and keyboard requirements.

This direction is inspiration, not imitation: do not reproduce Cloudflare layouts, illustrations, wording, or proprietary assets.

### 7.2 Header

- Inquilink logo.
- Links: `Cómo funciona`, `Funciones`, `Precios`, `Preguntas frecuentes`.
- Secondary action: `Iniciar sesión`.
- Primary action: `Pruébalo ahora`.

### 7.3 Hero: first viewport

The hero occupies approximately the first viewport on desktop and communicates the entire product without requiring a scroll.

Required Spanish copy:

- Eyebrow: `El portal de inquilinos para inmobiliarias`
- Headline: `Miles de inquilinos. Un solo portal.`
- Supporting message: `Centraliza los interesados, la documentación y las visitas de cada inmueble en un único lugar.`
- Primary CTA: `Pruébalo ahora`
- Trial note: `Primer mes gratis. Se requiere tarjeta.`

The visual should combine a Corporate Memphis property/applicant illustration with a restrained product preview that reinforces the property-to-applicant relationship.

### 7.4 Homepage SEO sections

The homepage includes the following crawlable HTML sections in this order:

1. **The fragmented problem** — applicants scattered across portals, email, spreadsheets, and WhatsApp.
2. **How it works** — `Crea el anuncio`, `Comparte el enlace`, `Recibe candidatos`, `Gestiona el proceso`.
3. **Everything per property** — the property-level applicant overview and filters.
4. **Solvency documents** — collect requested files safely in the correct application.
5. **Faster follow-up** — statuses, WhatsApp, notes, and viewings.
6. **Designed for owners and agencies** — clear benefits for individual owners and teams managing rental demand.
7. **Pricing** — Particular, Profesional, Inmobiliaria, the card-required trial, and the contact path for larger requirements.
8. **Security and privacy** — controlled access, private documents, and responsible data handling.
9. **FAQ** — trial, cancellation, links, applicant accounts, documents, and team access.
10. **Final CTA** — repeat the main promise and `Pruébalo ahora`.

Initial Spanish search themes should appear naturally, never as repetitive keyword stuffing:

- gestión de inquilinos para inmobiliarias
- organizar interesados de un inmueble
- portal de candidatos para alquiler
- documentación de solvencia de inquilinos
- gestión de visitas de alquiler

The page requires one semantic `h1`, logical heading order, descriptive metadata, canonical URL, Open Graph data, and `Organization`, `SoftwareApplication`, and `FAQPage` structured data where the visible content supports it.

### 7.5 Minimum public routes

- `/` — marketing homepage
- `/precios` — full pricing and trial terms
- `/iniciar-sesion` — login
- `/registro` — signup and trial activation
- `/aceptar-invitacion` — token-based invitation acceptance for an authenticated agency user or a new collaborator who supplies their name, password, and current terms acceptance
- `/recuperar-contrasena` — account-type-aware password recovery request
- `/restablecer-contrasena` — token-based password reset with the same password contract as registration
- `/verificar-correo` — token-based email verification that starts the authenticated session and returns safely to the originating flow
- `/mis-solicitudes` — authenticated tenant view of their own rental applications, statuses, property summaries, and document state
- `/solicitud/{token}` — public property summary followed by tenant account access and the authenticated application form
- `/legal/privacidad` — privacy policy
- `/legal/terminos` — terms of service
- `/legal/cookies` — cookie policy

SEO sections may later become dedicated pages, but separate feature pages are not required for the MVP.

## 8. Authenticated product

### 8.1 Main navigation

The application shell contains:

- `Panel`
- `Mis anuncios`
- `Citas`
- `Configuración`
- `Facturación` for administrators

Profesional and Inmobiliaria workspaces with collaborators also show `Equipo`.

### 8.2 `Panel`

The dashboard is a deliberately focused operational summary. It displays:

- `Nuevos interesados`: applicants with status `Nuevo` received during the last 30 days, with a direct route to the relevant property and applicant;
- `Próximas visitas`: the next scheduled viewings, ordered chronologically, with direct access to the appointment;
- `Interesados por día`: a bar chart of submitted applications with 1-week, 1-month, and 3-month ranges and a per-property breakdown for each day;
- `Anuncios con más interesados`: the three properties with the highest number of submitted applications, with direct access to each property.

Do not add active-property, attention-priority, missing-document, agenda-duplicate, help-center, or recent-activity containers to this screen. Each retained block links to its corresponding filtered working view.

### 8.3 `Mis anuncios`

The listing index shows one row or card per property with:

- cover image;
- internal reference and title;
- location and monthly rent;
- state: `Borrador`, `Publicado`, `Pausado`, or `Archivado`;
- total and new applicant counts;
- next viewing, if any;
- actions: open, copy link, edit, pause/publish, archive.

Users can search by title, address, or reference and filter by state.

### 8.4 Create or edit a property

Required fields:

- internal reference;
- public title;
- address, city, province, and postal code;
- monthly rent;
- property type;
- bedrooms, bathrooms, and floor area;
- availability date;
- description;
- cover image and optional gallery;
- responsible agency user;
- documents requested from applicants.

The public application page must never expose internal notes or a more precise address than the agency has chosen to publish.

## 9. Tenant application form

The form is mobile-first and divided into short steps with a visible progress indicator.

### Account access before the form

- The property summary remains visible before authentication.
- The primary action is `Crear cuenta y continuar`; existing tenants can choose `Ya tengo cuenta`.
- Registration requires full name, email, password, acceptance of the account terms, and email verification.
- Login and password recovery return the tenant to the same property link.
- The application form and document upload controls must not render or accept data until the tenant is authenticated.
- A tenant can access only their own drafts, submissions, and documents.

### Step 1 — Contact

- Full name, prefilled from the tenant account and reviewable.
- Verified email address, prefilled from the tenant account.
- Phone number with country code.
- Preferred contact channel.

### Step 2 — Household and timing

- Number of adult occupants.
- Number of minor occupants; do not collect minors' names or unnecessary details.
- Intended move-in date.
- Pets and optional detail.
- Optional message to the agency.

### Step 3 — Employment and affordability

- Employment situation.
- Employer or professional activity.
- Contract type, when applicable.
- Individual net monthly income.
- Combined household net monthly income.
- Guarantor availability: yes, no, or not sure.

### Step 4 — Salary-solvency documents

The agency can request these categories:

- recent payslips;
- employment contract;
- proof of income for self-employed applicants;
- other supporting document.

Accepted formats are PDF, JPG, JPEG, and PNG. The interface shows the maximum file size, upload progress, and a specific error for rejected files. Each request explains why the file is needed and that only the responsible agency can access it.

### Step 5 — Viewing availability and consent

- Preferred days or time ranges.
- Optional availability note.
- Required consent to process the application, with a link to the privacy policy.
- Separate optional marketing consent, unchecked by default.

The system records the property, consent text version, timestamp, and source link. The server determines the agency and property from the valid link token; it never trusts an agency or property ID supplied by the browser.

## 10. Property applicant workspace

This is the core product screen. Selecting a property opens a header with its key details, public-link actions, applicant counts, and a table of interested tenants.

### Default at-a-glance columns

All of the following are visible without opening the applicant. At 1440 CSS pixels wide, the table must show the full default set or use tightly grouped two-line cells while keeping every value and action in the same view:

1. Applicant name and contact details.
2. Submission date.
3. Household size and intended move-in date.
4. Employment situation.
5. Combined net monthly income.
6. Rent-to-income reference, shown as neutral information rather than an approval score.
7. Document state: `Completa`, `Faltan documentos`, or `Sin solicitar`.
8. Viewing state or next viewing.
9. Responsible agent.
10. Current status.
11. Quick actions: WhatsApp, schedule viewing, and more menu.

The table may scroll horizontally below the desktop target, but name, status, and primary actions remain pinned or otherwise immediately accessible. Mobile uses applicant cards with the same priority hierarchy. The default view must not hide core information behind configurable columns, hover-only interactions, or separate comparison screens.

### Search, filter, and sorting

- Search by name, email, or phone.
- Filter by applicant status, document state, viewing state, responsible agent, and submission date.
- Sort by newest, oldest, income, status, or next viewing.
- Active filters are always visible and removable in one action.

### Default statuses

- `Nuevo`
- `Preseleccionado`
- `Seleccionado`
- `Descartado`
- `Retirado`

These five values represent only the agency's overall decision stage. Document completeness remains in the separate document state, and appointments remain in the separate viewing state. Neither a document request nor a scheduled or completed viewing changes the applicant status automatically.

`Descartado` means the agency has closed the application. `Retirado` means the prospective tenant has withdrawn it. Every status change records the previous status, new status, user, and timestamp. Status is conveyed with text, not color alone.

### Applicant detail

The detail view contains:

- all submitted contact, household, timing, and affordability data;
- property context;
- secure document preview/download;
- current status and responsible agent;
- internal notes with author and timestamp;
- appointment history;
- activity timeline.

### WhatsApp action

For a valid phone number, `Contactar por WhatsApp` opens a `wa.me` link with an editable Spanish draft containing the agency name and property reference. The product records `Contacto por WhatsApp iniciado`; it must not claim a message was delivered or read.

Default draft:

> Hola, [nombre]. Soy [agente] de [agencia]. Te contacto por tu interés en el inmueble [referencia].

## 11. Appointments

The `Citas` area provides upcoming and past list views. An appointment always belongs to one property, one applicant, and one responsible agency user.

Required fields and actions:

- date, start time, and duration;
- meeting address or instructions;
- responsible user;
- optional internal note;
- create, reschedule, cancel, mark completed, or mark no-show;
- warn about overlapping appointments for the same responsible user;
- send Spanish confirmation, rescheduling, and cancellation emails.

Times are stored consistently and displayed in `Europe/Madrid` for the MVP.

## 12. Pricing and billing

| Plan | Public price | Simultaneous listings | Workspace accounts | Positioning |
| --- | ---: | ---: | ---: | --- |
| Particular | `9,99 € / mes` | Up to 2 | 1 administrator | A private owner managing a small number of rental listings |
| Profesional | `49,99 € / mes` | Up to 15 | Up to 3 total accounts | An independent professional or small agency working with collaborators |
| Inmobiliaria | `99,99 € / mes` | Up to 100 | Unlimited | An established real-estate agency with a larger portfolio and team |

All three plans include the same product capabilities. They differ only in simultaneous-listing allowance and the number of workspace accounts. All three plans receive the first 30 days free and require a valid card. The selected paid plan begins automatically on day 31 unless cancelled beforehand.

For allowance enforcement, listings in `Publicado` or `Pausado` state count toward the simultaneous-listing limit. `Borrador` and `Archivado` listings do not count. An account that reaches its limit keeps access to all existing records but cannot publish or reactivate another listing until it archives one or upgrades. A downgrade never deletes or hides existing data; if the workspace is above the destination allowance, new publishing and invitation actions remain blocked until usage is reduced or the plan is upgraded.

The account allowance counts active administrators and collaborators. Pending invitations reserve an account place so concurrent invitations cannot exceed the plan. Every workspace must retain at least one administrator. Particular cannot create invitations; Profesional permits at most three total workspace accounts; Inmobiliaria has no account-count limit.

Immediately below the plan cards on both the homepage pricing section and `/precios`, show the Spanish sentence `¿Tu empresa tiene necesidades más allá de estos planes? Contacta con nosotros.` The words `Contacta con nosotros` are a standard accessible email link to `mailto:hola@inquilink.es`. It is visually secondary to plan-selection actions, remains keyboard accessible, and must not be rendered as a fourth plan.

The checkout, pricing page, and billing area must show:

- selected plan;
- `Primer mes gratis (30 días)`;
- exact trial end date;
- exact first charge and renewal cadence;
- whether IVA is included or added;
- how and when cancellation takes effect.

The MVP billing area supports plan display, trial status, invoices, payment method update, cancellation, and reactivation. Inquilink uses a PCI-compliant payment provider and never stores raw card details.

Plan allowances must be enforced server-side at every relevant mutation boundary, including publishing or reactivating a listing, creating an invitation, and accepting an invitation. Client-side disabled states and messages are explanatory only and are never the authorization boundary. A request rejected because of a plan allowance uses a stable machine-readable error and a concise Spanish message that identifies the reached allowance and offers the appropriate upgrade path.

## 13. Essential notifications

Spanish email is the only required automated channel in the MVP.

Agency emails:

- new applicant received;
- upcoming viewing reminder;
- trial ending and payment failure.

Applicant emails:

- tenant account verification and password reset;
- application received;
- viewing created, rescheduled, or cancelled.

Email previews and subject lines must not expose income values or document contents.

## 14. Privacy, security, and accessibility

Inquilink handles personal and financial information. The following are release requirements, not future enhancements:

- GDPR-aware data collection and qualified legal review before launch.
- Clear controller/processor responsibilities between the agency and Inquilink.
- Data minimization: request only information relevant to the application.
- Encryption in transit and at rest.
- Private document storage; no permanent public file URLs.
- Short-lived authorized document links, file-type validation, size limits, and malware scanning.
- Server-side agency isolation and role checks on every request.
- Audit history for document access and material applicant changes.
- Defined retention and deletion process for unsuccessful applications and closed accounts.
- No personal, income, document, or free-text content in analytics or general logs.
- Keyboard operation, visible focus, labelled controls, useful validation errors, and WCAG 2.2 AA contrast.

No rent-to-income value or other data may automatically accept, reject, or rank an applicant in the MVP.

## 15. Essential analytics

Measure only the events required to understand acquisition and activation:

- marketing CTA clicked;
- agency registration completed;
- tenant account created;
- trial activated;
- first property published;
- public link copied;
- application started and completed;
- first applicant reviewed;
- WhatsApp contact initiated;
- viewing scheduled;
- trial converted to paid.

Analytics must not contain names, emails, phone numbers, income values, filenames, documents, or notes.

## 16. MVP acceptance criteria

The MVP is acceptable when all statements below are true.

### Marketing and conversion

- The Spanish homepage shows `Miles de inquilinos. Un solo portal.` and `Pruébalo ahora` in the first viewport.
- The homepage contains all defined SEO sections as semantic, crawlable Spanish HTML.
- Pricing displays Particular at `9,99 € / mes`, Profesional at `49,99 € / mes`, and Inmobiliaria at `99,99 € / mes`.
- Pricing states the limits as 2 listings and 1 administrator for Particular, 15 listings and 3 total accounts for Profesional, and 100 listings with unlimited accounts for Inmobiliaria.
- The homepage and `/precios` show `¿Tu empresa tiene necesidades más allá de estos planes? Contacta con nosotros.` directly below the plans, with `Contacta con nosotros` linked to `mailto:hola@inquilink.es`.
- Trial activation requires a card and reveals the exact first billing date and amount before confirmation.

### Property and link

- An administrator can create, edit, publish, pause, and archive a property.
- Publishing automatically produces a unique, non-guessable public application link.
- Copying the link requires one action.
- A paused, archived, revoked, or invalid link cannot accept a new application.

### Applicant submission

- The public experience is entirely Spanish and works at 320 CSS pixels wide.
- An applicant must create an account or sign in before the form and document controls become available.
- Registration, verification, login, and password recovery preserve the source property and return the applicant to the correct application.
- An authenticated applicant can resume a saved draft and access only their own submitted applications.
- Consent evidence and the source property are recorded.
- A successful application appears only under the correct agency and property.
- Safe retries do not create unintended duplicate submissions.

### Agency workflow

- `Panel` shows operational counts and upcoming work.
- `Mis anuncios` shows every property with applicant counts and link actions.
- Opening a property shows the defined applicant columns at a glance.
- An authorized user can search/filter applicants, change status, add a note, and inspect private documents.
- The WhatsApp action opens the correct number with an editable property-aware message.
- An agent can create, update, cancel, and complete a viewing.

### Security

- Automated authorization tests prove that one agency cannot access another agency's records or documents.
- Uploaded documents are private and delivered only through authorized, expiring access.
- Sensitive applicant data is absent from URLs, analytics, and general application logs.

## 17. Decisions required before production launch

Only these unresolved decisions materially block launch:

1. Whether public prices include IVA and which billing countries are supported.
2. The retention period for unsuccessful applications and uploaded financial documents.
3. Final legal copy and controller/processor terms.
4. Maximum upload size and the chosen payment, email, and malware-scanning providers.

These decisions do not block a faithful prototype of the complete core workflow.
