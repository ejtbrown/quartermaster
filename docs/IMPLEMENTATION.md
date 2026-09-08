# Development implementation status

Status updated 2026-09-08 UTC: data/governance foundation deployed; hosting partially provisioned; automated release blocked. See the [foundation record](DEPLOYMENT-2026-09-07.md) and [current hosting/CI record](DEPLOYMENT-2026-09-08.md). This remains a synthetic preview, not the complete Quartermaster application.

## Current delivery increment

`infra/environments/delivery` implements an isolated Terraform backend, private S3 web/artifacts, an IAM/OAC-protected health-only Lambda URL, CloudFront/ACM/DNS, a rate-limit web ACL, the FREE subscription bridge, and separate CodeBuild check/build/deploy roles plus CodePipeline V2. Build scripts validate, package exact-commit checksums, test a published API version, promote the alias, publish the website, and smoke-test; prior live pointers are retained for rollback. Public-fork workflows now require approval for every external contributor.

The hosting apply created 42 resources successfully and preserved a failed CloudFormation stack. AWS rejected the distribution's FREE eligibility; the stack is CREATE_FAILED/tainted, and its destruction protection prevents an automatic destructive retry. No paid subscription was created. The distribution remains disabled and qm A/AAAA records were not created. The CodeConnections resource exists but is PENDING owner authorization. The runner, webhook, pipeline and final deployment policy have not been created; no cloud release has run. The operations relay has two local tests but is not wired/deployed. Identity/email, backup-age/failure monitoring and regional recovery remain unfinished.

Current local checks include 80 TypeScript/domain/PostgreSQL/policy tests, two Python alert-summary tests, two Chromium browser tests and nine Terraform mock-provider tests. The final verification results and cloud blockers are recorded in the latest deployment record. `pnpm edge:check` independently verifies the live FREE subscription and must fail while it is absent. Do not use the static CloudFormation outputs alone as proof after any later subscription change.

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

1. Confirm purge behavior inside 90-day backups. The photo-retention and alert-recipient decisions are accepted in decision 0005. Physical media cleanup is intentionally disabled. No real church data should be admitted before its access/expiry/purge paths are complete.
2. Implement Cognito/tenant-membership resolution, a non-owner Data API application credential, authenticated asset CRUD, idempotent commits/outbox, and native database integration tests. The master secret is migration-only; do not attach it to the application runtime.
3. Resolve the current edge eligibility/GitHub authorization blockers and finish the implemented hosting/pipeline deployment, then identity/email and operational monitoring. The configured shared workflow does not itself establish a secure runner project. See the September 8 partial-deployment record rather than repeating a failed plan.
4. Implement media access expiry, variants, uploads, content purge workers, audit physical expiry, minimal durable deletion ledger, and purge replay on restore. The SQL deletion metadata table alone is not an independent cross-region deletion ledger.
5. Implement cross-region database/media recovery, failure/backup-age alarms, and timed restore drills. The current same-region snapshot plan does not prove either regional RPO or RTO. Its custom snapshot-only role replaces the broad AWS-managed policy; restore/copy permissions must be separately reviewed when those features are implemented. Recovery copies must include resized photos after originals expire.
6. Implement native mobile/offline capture and local trusted build coordinator; then AI, maintenance, and reporting phases. Production stays disabled until church acceptance and creation of its separate account.

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
