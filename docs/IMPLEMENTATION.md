# Development implementation status

## Current design revision — 2026-09-25

[Decision 0008](decisions/0008-deletion-metadata-backup-horizon.md) fixes deletion-metadata retention at the backup horizon (currently 90 days after deletion), defers compliance holds, and explicitly authorizes completion of the synthetic web/health-API deployment. Content deletion inside retained backups remains a separate real-data gate. Rollout progress is recorded in the September 25 deployment record.

[Decision 0007](decisions/0007-online-only-mobile-web.md) accepts one responsive web client for phone capture and desktop estate management, with **no offline capability in v1**. Native apps, signing/store releases, the SSH build coordinator, persistent local drafts/media/audio, and background synchronization are deferred. Safe foreground retry, optimistic concurrency, server-saved drafts, and truthful save status remain requirements. This is a design/backlog update; no new application feature or cloud deployment is implied.

The immediate next milestone is the existing synthetic website and health-only API through GitHub → CodeBuild/CodePipeline. The next functional milestone is a non-AI phone-to-desktop asset/photo workflow. See the ordered gates below.

## Latest verified cloud state — 2026-09-24

The tiered backup policy is **applied and verified**; a fresh foundation plan has no changes. The owner subsequently authorized complete cleanup of the failed empty Free-plan stack: it is now **deleted from AWS and Terraform resources**, not retained. Remaining standard-edge delivery changes are **unapplied**. See the [September 24 deployment record](DEPLOYMENT-2026-09-24.md) for exact scope, validation and remaining gates.

The owner accepted weekly historical database backups and standard pay-as-you-go CloudFront/WAF in [decision 0006](decisions/0006-tiered-backups-and-standard-edge.md). Source now preserves seven-day PITR and 12-hour/seven-day snapshots, adds weekly/90-day snapshots, and replaces Free-only release checks with exact distribution/WAF and subscription-association checks. Existing recovery points are untouched. GitHub CodeConnections is AVAILABLE, verified live. The obsolete stack retention block and state-forget bypass have been removed. These changes do not publish the website, create CI/CD, or establish real-data readiness. The September 8 account below is historical.

The [foundation record](DEPLOYMENT-2026-09-07.md) and [September 8 hosting/CI record](DEPLOYMENT-2026-09-08.md) remain historical evidence. This remains a synthetic preview, not the complete Quartermaster application.

## Current delivery increment

`infra/environments/delivery` implements an isolated Terraform backend, private S3 web/artifacts, an IAM/OAC-protected health-only Lambda URL, standard CloudFront/ACM/DNS, a rate-limit web ACL, and separate CodeBuild check/build/deploy roles plus CodePipeline V2. Build scripts validate, package exact-commit checksums, test a published API version, promote the alias, publish the website, and smoke-test; prior live pointers are retained for rollback. Public-fork workflows require approval for every external contributor. The Free subscription bridge has been removed.

The September 8 hosting apply created 42 resources and left a failed subscription stack; that empty stack was deleted from AWS and Terraform on September 24 with the owner's explicit authorization. No subscription exists. The distribution remains disabled and qm A/AAAA records have not been created. CodeConnections is AVAILABLE. The runner, webhook, pipeline and final deployment policy have not been created; no cloud release has run. The fresh post-cleanup plan contained only a distribution comment update and deployment-policy creation, but was not applied. Regenerate plans before the next rollout. The operations relay has two local tests but is not wired/deployed. Identity/email, backup-age/failure monitoring and regional recovery remain unfinished.

September 24 local checks include 86 TypeScript/domain/PostgreSQL/policy tests, two Python alert-summary tests, two Chromium browser tests and nine Terraform mock-provider tests; see the deployment record for scope and timing. `pnpm edge:check` verifies the exact standard distribution/WAF and absence of subscription associations. These checks do not establish authenticated capture or real-device browser readiness. The synthetic preview intentionally denies camera/microphone access; permission/CSP/CORS changes belong with the authenticated capture implementation.

## Original foundation milestone (historical)

- Pinned Node 24/pnpm/TypeScript workspace, lockfile, formatting/type checks, unit tests, dependency audit, and a basic source credential-pattern check.
- React estate preview with four explicitly synthetic assets, search, selection, and responsive layout. No login, persistent changes, or cloud data are represented as working.
- Shared runtime-validated asset/deletion metadata contracts; tested 15-day original/transcript deadlines, indefinite resized-photo retention until photo/asset/tenant deletion, one-calendar-year audit deadline, 90-day backup convention, tenant filtering, and $100 budget thresholds. These policies do not imply that uploads or physical purge workers exist yet.
- Health-only Lambda build. It neither queries the database nor exposes unfinished asset routes.
- Initial SQL schema with forced tenant RLS, a non-login/non-owner application role, optimistic-version-compatible asset rows, content-free deletion metadata, and append-only application audit access. Tests execute PostgreSQL in PGlite; this is not a substitute for Aurora/Data API integration testing.
- Terraform state bootstrap and Ohio development data/governance foundation: isolated subnets with no NAT, private Aurora Serverless v2 16.14 (0–4 ACU, 300-second pause, Data API), managed database credentials, private encrypted/versioned media bucket, on-demand sessions, operations email subscription, $100 project budget, and 12-hour same-region snapshots retained 90 days.
- Terraform mock-provider tests and a fail-closed plan checker for the implemented resource types, tags, zero-minimum capacity, public exposure controls, budget drift, and destructive changes. It is not a comprehensive security review.
- A pinned GitHub Actions verification workflow targeting the agreed disposable CodeBuild runner project. The project/webhook/CodeConnection and CodePipeline are not yet provisioned, so the workflow has not run remotely.

## Local commands

Use the Node version in `.node-version` and the pnpm version in `package.json`. On a host that only has Node 18, the following runs pinned tools without changing the system installation:

```bash
npm exec --yes --package=node@24.20.0 --package=pnpm@10.34.5 -- pnpm install --frozen-lockfile
npm exec --yes --package=node@24.20.0 --package=pnpm@10.34.5 -- pnpm verify
npm exec --yes --package=node@24.20.0 --package=pnpm@10.34.5 -- pnpm infra:check
npm exec --yes --package=node@24.20.0 --package=pnpm@10.34.5 -- pnpm dev
```

With those versions already on PATH, use `pnpm install --frozen-lockfile`, `pnpm verify`, `pnpm infra:check`, and `pnpm dev`. The preview binds to loopback, not the LAN. For browser checks, build first, then `pnpm exec playwright install chromium` and `pnpm test:e2e`. Browser-test screenshots are private local artifacts under `.local/`.

## Plan and apply boundary

`infra/bootstrap` can be planned with `AWS_PROFILE=default` and a protected `TF_VAR_expected_account_id`. `infra/environments/dev` requires the bootstrapped backend and a confirmed `alert_email`; no placeholder recipient is valid for actual deployment. Configure S3 backend `bucket`, `key=dev/terraform.tfstate`, `region=us-east-2`, `encrypt=true`, and `use_lockfile=true` in an ignored `*.local.hcl` file. Preserve bootstrap state, which is local until its separately reviewed migration.

The operator has supplied the real alert recipient; it is stored only in ignored, mode-0600 environment configuration. The development-only deployment procedure and rollback boundaries are in `RUNBOOK_ROLLOUT.md` under “Foundation-only initial deployment.” For read-only live verification, set `QM_EXPECTED_ACCOUNT_ID` and `QM_ALERT_EMAIL` privately and run `pnpm deployment:check`. The check never retrieves secret values or sends SQL; pending email confirmation and cost-tag activation are explicit warnings, not successful alert-delivery claims.

`pnpm db:smoke` is a separate, operator-only, read-only Data API smoke test using `QM_EXPECTED_ACCOUNT_ID`. It checks the database name and non-logical WAL without creating schema or retrieving the master secret's value. AWS parameter controls (required SSL and disabled logical replication) are checked through the AWS API by `deployment:check`, not assumed to be SQL-visible settings. The smoke **wakes Aurora** and must never be scheduled or used as a health check. It records query latency; that is not a cold-start measurement without independent evidence of an immediately preceding paused state.

Review a saved plan with `terraform show -json PLAN | pnpm policy:plan`. Plan files/state are sensitive and ignored. The authorized development foundation was applied from reviewed saved plans, including its SNS subscription and budget recipients. No account creation, DNS/email-domain identity, host configuration, signing operation, push, schema write, or real-data deletion occurred. Recording `qm.ejtbrown.com` does not create a DNS record or a mailbox.

Before enabling budget notifications, activate/verify `CostScope` as a cost allocation tag and account for untaggable charges and tagging/reporting delays. The compound `CostScope=Quartermaster-dev` tag avoids an OR across unrelated project/environment tags. Notifications use the supported five-entry limit: actual 50/80/100%, forecast 80/100%. They are not a hard billing ceiling, and the SNS email subscription requires recipient confirmation.

## Remaining build work and gates

1. **Deploy the synthetic dev preview.** Review/validate the pending source changes, publish the reviewed commit to `dev`, regenerate/review Terraform plans, finish standard-edge permissions, and provision the CodeBuild runner/webhook and CodePipeline. Release immutable web/health-API artifacts, enable the distribution/DNS, and verify HTTPS at `qm.ejtbrown.com`, exact deployed SHA, WAF and denied direct-origin access. GitHub authorization and Free eligibility are no longer blockers. Do not deploy stale saved plans or trigger the older remote Free-dependent release code. This milestone admits no real church data and needs no new product decision.
2. **Deliver one manual phone-to-desktop workflow.** Implement Cognito/server-side sessions, tenant membership/RLS, a non-owner Data API credential, migrations and actual Aurora integration tests. Add locations, asset CRUD, durable server drafts, idempotent commit/outbox, photo upload/variants and audit; capture an asset/photo in the phone browser and find/edit it in the desktop register. The master secret remains migration-only. No native client or offline queue is involved.
3. **Add assisted capture.** Implement foreground voice, approved transcription, browser speech output validation, image classification/nameplate extraction, confirmation/provenance, and transactional creation of the asset, readings, notes and maintenance items. Manual controls remain available while connected. Test actual iPhone Safari and Android Chrome, including permission denial, camera/microphone interruptions, screen lock, network loss, uncertain save responses, expired sessions and safe retry without duplicate records.
4. **Pass real-data/pilot gates before accepting church records.** Decide backup-purge semantics (isolated retention until expiry with deletion replay, versus immediate unrecoverability). Deletion metadata now follows the backup horizon, currently 90 days after deletion; compliance holds remain deferred under decision 0008. Complete media expiry/version-aware purge, audit expiry, deletion ledger/expiry and restore replay; implement operational alarms, budget attribution and approved-region recovery copies, then time a restore against the preferred 24-hour RPO and accepted 24-hour RTO. These controls may be built alongside steps 2–3; synthetic fixtures are required until they pass. Resized photos need recovery copies after originals expire. The current same-region snapshots alone do not prove regional recovery, and the SQL tombstone table alone is not an independent deletion ledger.
5. **Pilot, then production.** Validate the air-conditioner/appliance workflow with the church, refine the field UX, and expand maintenance/reporting incrementally. After church acceptance, create the separate production account, select its domain, and validate the same Terraform/release/recovery path with production configuration. Pilot acceptance does not automatically authorize transferring every development record.

Do not mark COST-003 through COST-011 complete based on scaffolding. Shared tests and Terraform validation cover implemented foundations only; use the full acceptance criteria in `codex_plan.json` for feature completion.

## Original foundation validation evidence (historical)

- `pnpm verify`: formatting and TypeScript checks; 62 unit/policy/PostgreSQL tests; web and health-only Lambda builds; YAML/JSON and basic source credential-pattern checks passed.
- `pnpm infra:check`: all three Terraform roots/modules validate; six mock-provider tests passed without cloud mutation.
- `pnpm test:e2e`: desktop search/selection and 390-pixel responsive layout passed in Chromium; both screenshots inspected. The browser tests launch and stop a loopback-only preview automatically.
- `pnpm audit --audit-level high`: no known vulnerabilities reported for the pinned dependency tree at this check.
- Actual-account bootstrap: five additions applied. Main foundation: 23 additions applied, followed by one parameter-only reconciliation update; zero deletion/replacement. Final development plan has no changes. Applied plan hashes and follow-up details are in the deployment record.
- `pnpm deployment:check`: 32 live control-plane checks passed, including private networking/storage, zero-minimum database capacity, SSL/logical-replication policy, backup scope, $100 budget thresholds and configured recipients. SNS is confirmed; cost-tag activation/reporting is still pending.
- One-off read-only Data API smoke succeeded in 1,905 ms with `wal_level=replica`. This warm query does not prove cold-start latency or authenticated tenant integration. The first encrypted AWS Backup recovery point completed and has a verified 90-day deletion deadline and project tags.
- Idle scale-to-zero is observed: CloudWatch reports minimum and maximum 0.0 ACU for the development writer at 17:22, 17:23, and 17:24 UTC. The database was left idle; no additional SQL was sent after the smoke.
- Authenticated Aurora/Data API integration, migrations, physical purge, cross-region recovery/restore, signed mobile builds, remote CI, and production have not been tested or deployed.

The cost skill's fresh Ohio check identified the larger snapshot-retention cost: approximately $36.26/month for the database/secret/90-day-snapshot component at steady state with an illustrative 10 GB database. Other activity, media, recovery copies, CI, and shared fees are extra. See `cost_model.md` §5.3; the retained-data cost is not a running-compute floor or a guarantee of staying below $100.
