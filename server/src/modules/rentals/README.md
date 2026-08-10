# Rental workflow module

All routes use `/api/v1`. Agency routes require the current session's agency membership; tenant routes require a verified tenant account. Resource lookups include the relevant `agency_id` or `tenant_user_id` in the SQL predicate and deliberately return `404` for out-of-scope identifiers.

## Property and intake links

- `POST /agency/properties`
- `GET /agency/properties?search=&state=&page=&pageSize=`
- `PATCH /agency/properties/:propertyId`
- `POST /agency/properties/:propertyId/publish`
- `POST /agency/properties/:propertyId/pause`
- `POST /agency/properties/:propertyId/archive`
- `POST /agency/properties/:propertyId/public-link/regenerate`
- `DELETE /agency/properties/:propertyId/public-link`
- `GET /public/properties/:token`

The public-link secret is stored as both a SHA-256 lookup hash and AES-256-GCM ciphertext bound to the property ID. This permits an authorized agency user to retrieve the current link without storing the raw bearer token. Publish and regeneration require `Idempotency-Key`; every lifecycle mutation requires `expectedVersion`. Concurrent stale mutations return `409`, and matching retries recover the single winning link. Pause and republish preserve it; only explicit regeneration rotates it. Paused links return `410`; revoked, superseded, archived, and invalid links cannot be resolved.

## Tenant applications and documents

- `GET|PUT /tenant/application-drafts/by-link/:token`
- `POST /tenant/applications/by-link/:token/submit`
- `GET /tenant/applications`
- `GET /tenant/applications/:applicationId`
- `POST /tenant/applications/:applicationId/withdraw`
- `POST|DELETE /tenant/applications/:applicationId/documents[/:documentId]`
- `POST /tenant/applications/:applicationId/documents/:documentId/access`
- `GET /documents/:documentId/content` with `Authorization: Bearer <temporary-document-token>`

Submission requires the verified account email, consent evidence, a client-generated submission key, and every requested document category. The unique tenant/property constraint is the final duplicate guard; matching retries return the existing result, while a different submission key returns a conflict rather than discarding changed input.

Documents accept PDF, JPEG, and PNG with extension, declared type, binary signature, base64, and configurable size validation. The local adapter persists files with private permissions under the explicitly configured mounted path. Its deterministic scanner applies a limited EICAR policy and is enabled only when `ALLOW_LOCAL_PROVIDERS=true`; production otherwise fails closed unless private storage and a real scanner are injected. Only a `clean` result is persisted, while infected/error results are rejected; issuance and download re-check that state. Access tokens expire (five minutes by default), are signed for one document and one user, require the same authenticated session, re-check ownership, and emit an audit event. A failed storage deletion leaves a non-downloadable tombstone for the worker to retry. Rejected and withdrawn applications are purged only when `APPLICATION_RETENTION_DAYS` is explicitly configured.

## Agency applicant workspace

- `GET /agency/properties/:propertyId/applications?page=&pageSize=`
- `GET /agency/applications/:applicationId`
- `PATCH /agency/applications/:applicationId/status`
- `PATCH /agency/applications/:applicationId/responsible-user`
- `POST /agency/applications/:applicationId/notes`
- `POST /agency/applications/:applicationId/whatsapp`
- `POST /agency/applications/:applicationId/documents/:documentId/access`

The only applicant statuses are `new`, `preselected`, `selected`, `rejected`, and `withdrawn`. Status changes append history and audit records. Document completeness and appointments are independent state dimensions and never change applicant status. WhatsApp returns an editable `wa.me` draft and records only that contact was initiated; it makes no delivery claim.

Submitted phone, individual/household income, household counts, and intended move-in date are dual-written to typed columns while the full validated payload remains in `draft_data`. Lists default to 25 rows and cap `pageSize` at 100; `data.pagination` exposes totals and `hasMore` without changing the existing array response.

## Appointments

- `GET /agency/appointments?page=&pageSize=` and `POST /agency/appointments`
- `PATCH /agency/appointments/:appointmentId` with `reschedule`, `cancel`, `complete`, or `no_show`

Appointments must be in the future when created or rescheduled. A responsible user must belong to the current agency. Overlap detection returns non-blocking `RESPONSIBLE_USER_OVERLAP` warnings. Closed appointments cannot transition again, and all material changes are audited.
Creation requires `Idempotency-Key`; business state, audit history, and tenant notification enter one database transaction. Rescheduling and cancellation use `expectedUpdatedAt` and enqueue their notification in the same transaction.
