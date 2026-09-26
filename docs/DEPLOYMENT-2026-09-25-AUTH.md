# Authenticated development workspace deployment — 2026-09-25

Status: infrastructure and database preparation completed; GitHub application release and independent public verification pending. This document will record the first successful release after verification. Later documentation commits may advance the live health SHA without changing functionality.

## Scope and account boundary

The owner authorized deployment but explicitly deferred account setup. No Cognito user, invitation or permanent workspace is created. The responsive application supports synthetic-only manual assets/search, maintenance, readings, private server drafts, audit, optimistic versions and idempotent writes. Photos, voice/AI, destructive operations and real church data remain disabled. Production and the native build hosts are untouched.

## Applied infrastructure and database

- Reviewed identity plan: four creates, two updates, no destroys; SHA-256 `1d70ce7f0df17cf9ebef865672dc95b65ab8bb0dbce5c1ba3d3349ccb2c136e0`. Invitation-only Cognito Lite/classic hosted UI, required authenticator-app MFA, public code/PKCE client, and a separate runtime secret container.
- Reviewed workspace plan: one create, two updates, no destroys; SHA-256 `86e0f78584fa55a0ef9d03c7e1a8e8475935986ab7850d749f037e6529040efc`. Exact database/runtime-secret permissions and auth-prefixed session access, 256 MB/30-second Lambda with five maximum concurrent executions, and release-mode validation. No provisioned concurrency, polling or warm database capacity.
- Explicit operator migrations 0001–0003 applied transactionally with a checksum ledger. Runtime uses `qm_runtime`, inheriting only `qm_app`; migration credentials never enter the application or CI deployment role. The exact migration owner has an explicit setup/recovery RLS policy because Aurora's owner is not a PostgreSQL superuser. The application cannot inherit that owner or bypass forced tenant RLS.
- Initial runtime secret populated using the AWS SDK, never Terraform state, CLI arguments or logs. Safe resume supports AWS's first-version CURRENT/PENDING behavior without permitting an ordinary rotation. Secret value and protected environment inputs are not committed.
- `check` passed for the actual runtime credential. `integration` passed against actual Aurora/Data API: tenant/role isolation, assets/tasks/readings/drafts, JSON/dates, mutation replay/conflicts, stale versions, rollback and membership revocation. Both freshly generated synthetic fixture tenants and their records were removed; no unrelated rows were touched.
- Aurora remains 0–4 ACU with five-minute auto-pause. Backup cadence, retention, normal CloudFront/WAF and the $100 development budget are unchanged. The extra runtime secret is a billable retained resource, not warm compute.

## Release validation

Local checks: 122 TypeScript/domain/PostgreSQL/policy tests, two Python operations tests, seven Chromium tests, eleven Terraform mock tests, formatting/types/repository checks and dependency audit passed. Actual compiled API/operator smoke checks run during builds and caught an ESM/SDK packaging issue before release. The standard CloudFront/WAF preflight also passed.

The non-scheduled `tools/verify-workspace.mjs` post-release check verifies exact release/static hashes, unsigned sessions and asset denial, login PKCE and secure browser binding, single-use login state, provider form availability, DynamoDB reads/writes/deletes, security headers, private-origin denial and desktop/mobile-viewport rendering. It deliberately uses an invalid authorization code, so it neither creates an account nor claims successful end-user authentication.

Successful Cognito password/TOTP enrollment, actual signed-in cloud browser saves, physical iPhone/Android testing, measured cold-start recovery and restore drills remain separate checks after the owner authorizes setup. Local browser tests use the actual API and PostgreSQL/RLS with injected identity/session storage, not a live Cognito identity.

## Next

After deployment verification: obtain approval for the initial login/workspace, invite that user, complete password/TOTP enrollment, grant an explicit synthetic membership with the operator tool, and exercise the signed-in cloud workflow. Continue authenticated photo ingestion and retention/purge/recovery gates before enabling real church records. See [the detailed workspace runbook](AUTHENTICATED-WORKSPACE.md).
