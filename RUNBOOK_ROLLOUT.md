# Quartermaster rollout and recovery runbook

Status: foundation and Step 1 synthetic web/health-API delivery are deployed. September 25 exact-commit CodePipeline release and independent live checks passed; see [deployment evidence](docs/DEPLOYMENT-2026-09-25.md). Standard CloudFront/WAF and tiered backups remain selected. Later full-product procedures remain planned; do not repeat completed bootstrap/cleanup plans.

Date: 2026-09-25 (living runbook; historical procedures are labeled)

Client scope: [decision 0007](docs/decisions/0007-online-only-mobile-web.md) accepts one online-only mobile/desktop web client. Native builds/signing, store distribution, the SSH coordinator, offline queues and background synchronization are not v1 release requirements. Verify foreground interruption/retry and acknowledgment-based save status instead. This documentation update performs no cloud deployment.

Deployment status: data/governance validated; website and health API live through CodeBuild/CodePipeline, with WAF and private origins. Identity, online mobile asset capture, AI and regional recovery remain pending.

Consult `docs/IMPLEMENTATION.md` for verified commands and the exact deployed subset. The dev domain is `qm.ejtbrown.com`; budget is $100/month. Originals/transcripts expire after 15 days, audits after one year, recent snapshots after seven days and weekly snapshots after 90 days. Deletion metadata follows the backup horizon, currently 90 days after deletion; compliance holds are deferred. Resized photos persist until photo/asset/tenant deletion. The alert recipient is supplied privately. Backup-content purge semantics and physical purge workers remain unresolved/unimplemented; do not enable destructive content lifecycle rules yet.

## Current development hosting and CI/CD milestone

### September 24 revision procedure

1. Run `pnpm verify`, `pnpm infra:check` and `pnpm test:e2e`. Check STS against the protected development account input and verify the existing Ohio backends. Preserve ignored inputs, plans, state and `.codex-resume`.
2. Save a fresh foundation plan: `terraform -chdir=infra/environments/dev plan -input=false -var-file=deployment.local.tfvars -out=tiered-backups.tfplan`. Protect files with mode 0600. Inspect the entire JSON/text plan and run `terraform -chdir=infra/environments/dev show -json tiered-backups.tfplan | pnpm policy:plan`. Require exactly one in-place backup-plan update, with 12-hour/seven-day and Sunday/90-day rules; no other managed changes. Record its checksum, apply that exact saved plan, verify live rules, run `pnpm deployment:check`, and require a fresh no-change plan. Existing recovery points retain their expiry; do not prune them. Validate upcoming scheduled jobs separately.
3. The owner explicitly authorized deletion of the failed empty `quartermaster-dev-edge-free` stack, replacing the retention proposal. Verify its exact account/region/ARN, CREATE_FAILED status, and absence of any Subscription physical ID. Remove the obsolete resource/removed block. For this one-off failure cleanup only, save a targeted `delete-failed-edge-stack.tfplan`; inspect it and require exactly one managed action: delete that exact stack, with no creates, replacements, forget actions or other updates. Generic CI guardrails continue rejecting deletions/forget operations; the separately authorized operator cleanup uses explicit exact-target assertions, not a permanent bypass. Apply the reviewed saved plan, verify AWS deletion and absence from Terraform state, and run a full post-cleanup plan. If obsolete root outputs remain after targeting, reconcile only those with a reviewed refresh-only plan; do not run `state rm`, `state push` or blind untaint. Never repeat the old saved Free/retention plans.
4. With `publish_site=false` and `enable_pipeline=false`, save/review a fresh `standard-edge-after-cleanup.tfplan`. Expected remaining changes are the distribution comment and the formerly blocked release IAM policy. The failed stack must not appear as any planned resource. Fix the empty S3/OAC serialization difference without ignoring origin security. New release-role permissions are exact distribution/WAF reads and account-level read-only `pricingplanmanager:ListSubscriptions` (the list API has no resource-level scope); no subscription mutation is granted. Record the plan checksum and validate live standard billing with `QM_EXPECTED_ACCOUNT_ID` and `QM_DISTRIBUTION_ID` supplied privately to `pnpm edge:check`.
5. GitHub connection was verified AVAILABLE on September 24; recheck before planning `enable_pipeline=true`. Preserve public-fork approval and checks/build/deploy role separation. Publish the reviewed dev commit only after the current source passes all checks; never release the old commit that still requires FREE. Main/production remain disabled.
6. Before publication verify IAM-only Lambda URL, signed OAC, private S3, WAF rate limiting and uncached API behavior. Apply an independently reviewed publication plan for only this distribution and qm A/AAAA records. Require successful exact-commit CodePipeline build/deploy and HTTPS smoke, correct health SHA, asset API still disabled, security headers, and direct unsigned origins denied. No public release is claimed before these checks pass.
7. On failure keep ingress off or restore prior versioned application pointers as appropriate. Never destroy backups, database or state. The explicitly authorized deletion of the failed empty stack is a one-off cleanup, not a general deletion exception. Roll back the backup cadence only through a new reviewed plan; changing a rule does not extend existing recovery-point expiry. Check actual billed snapshot GB and WAF/CloudFront usage after rollout; the $9.92 illustrative component subtotal and $100 budget are not billing caps.

### Historical September 8 procedure (Free-plan steps superseded above)

The retained subscription stack was CREATE_FAILED/tainted and the GitHub connection was PENDING. Do not repeat the old plan or permit Terraform replacement.

The subsequent user request authorizes publishing this public repository and deploying the existing synthetic website/health API through GitHub → CodePipeline V2 → CodeBuild. Production, native signing, real-data intake, schema application, and AI are not part of this delivery milestone. Commands below are implemented; the later full-product procedures remain targets.

1. Run `pnpm verify`, `pnpm infra:check`, `pnpm test:e2e`, and `pnpm audit --audit-level high`. `pnpm build` creates the initial API ZIP needed by Terraform. Check public-source files for secrets before committing; never stage resume state, local tfvars/backends, plans/logs, Terraform state, or build artifacts.
2. The GitHub connection is managed by `infra/bootstrap/github.tf`. The owner must complete the pending connection in the Ohio AWS console and authorize only `ejtbrown/quartermaster`. Never substitute or upload the operator's personal GitHub token. Check the connection is AVAILABLE before enabling the runner/webhook/pipeline.
3. The delivery root is `infra/environments/delivery`; its separate backend key is `dev/delivery.tfstate` in the already protected development state bucket. Initialize using its ignored `backend.local.hcl`; do not migrate/rewrite foundation state. Supply exact account, connection ARN and parent zone ID through protected `deployment.local.tfvars`. Initially leave `publish_site=false` and `enable_pipeline=false`.
4. Generate a fresh saved plan, inspect changes and IAM, run `terraform -chdir=infra/environments/delivery show -json hosting.tfplan | pnpm policy:plan`, record the plan SHA-256, and apply exactly that plan. Stop on any delete/replacement, unexpected DNS target, public origin, paid plan, warm fleet, or foundation changes. AWS resources without tag support are mapped by their Terraform dependency to tagged project resources.
5. Require the subscription stack to complete and independently verify its live Pricing Plan Manager subscription is ACTIVE and FREE with the expected distribution/web ACL. Only then plan/review/apply `publish_site=true`. This adds only qm's A/AAAA aliases and enables its distribution. Existing unrelated CloudFront distributions and the parent zone's subscription ownership are never changed. The retained FREE subscription has Terraform destruction protection and CloudFormation Retain policies; do not delete/cancel it as cleanup.
6. With the connection AVAILABLE, plan/review/apply `enable_pipeline=true`. Configure public-fork workflow approvals, publish the reviewed initial main/dev source, and verify a dev push starts CodePipeline automatically. Main has no production pipeline. GitHub Actions checks use their separate ephemeral CodeBuild runner; they cannot reach deployment roles, private media, secrets, state, or signing hosts. The CodePipeline build stage independently repeats validation before releasing, so a missing GitHub status cannot bypass build tests.
7. CodeBuild packages compiled files, SHA-256 hashes and exact source commit. The deploy role only reads pipeline artifacts, publishes this website/API, checks the FREE stack, and invalidates this distribution. It cannot apply Terraform, change IAM/DNS, read the database, or use AI. Initial platform provisioning and subsequent infrastructure changes require an operator-reviewed saved Terraform plan; application code deploys automatically.
8. Require pipeline success, exact `/api/health` release SHA, preview page HTTPS/security headers, non-cached API responses, `/api/assets` returning 404, and unsigned direct S3/function-URL requests denied. Recheck the API alias and private-origin policies. Do not call a sample-data preview a functioning asset system.
9. Releases upload immutable assets before switching pointers and retain previous files. On failed smoke, the deploy script restores the previous API alias and previous versioned `index.html` where one exists, then invalidates. It never deletes artifacts or rolls back a database. For the first deployment there may be no previous website; stop and fix forward if verification fails. Retain failed execution logs and exact artifact/commit evidence.

## Historical foundation-only initial deployment

The user authorized development deployment on 2026-09-07. This initial bootstrap uses local Terraform because the CI/CD infrastructure is not implemented. It does not deploy the web/API, publish code, run schema migrations, or create production. Never treat the `development_domain` output as evidence that DNS exists.

1. Use profile `default`, verify STS against the protected expected account ID, region `us-east-2`, and workspace `default`. Verify no existing Quartermaster resources/state would be overwritten. Keep `deployment.local.tfvars`, `backend.local.hcl`, all state and saved plans ignored and mode 0600. Preserve the bootstrap local state; do not migrate it implicitly.
2. Run `pnpm verify`, `pnpm infra:check` and `pnpm test:e2e`. Review the backup role: snapshot-only RDS actions, the exact source cluster, regional AWS Backup snapshot namespace, tag-limited deletion, the database encryption key, and the exact vault. It cannot run SSM commands, manage other compute, restore, or copy across regions. Validate an actual backup after deployment.
3. Run `AWS_PROFILE=default terraform -chdir=infra/bootstrap plan -input=false -var-file=deployment.local.tfvars -out=deployment.tfplan`. Inspect `terraform -chdir=infra/bootstrap show deployment.tfplan`; pipe its JSON to `pnpm policy:plan`. Require only the five expected creates, no deletion/replacement. Record `sha256sum infra/bootstrap/deployment.tfplan`, then apply that exact file with `AWS_PROFILE=default terraform -chdir=infra/bootstrap apply -input=false deployment.tfplan`.
4. Verify state bucket encryption, versioning, TLS-only policy, and all public access blocks. Initialize the previously empty dev backend using `AWS_PROFILE=default terraform -chdir=infra/environments/dev init -input=false -backend-config=backend.local.hcl`. The backend uses S3 encryption and lockfiles. Do not accept a migration prompt or use `-force-copy`.
5. Plan dev with `AWS_PROFILE=default terraform -chdir=infra/environments/dev plan -input=false -var-file=deployment.local.tfvars -out=deployment.tfplan`. Inspect the complete saved plan and run the same JSON guardrails. Require only the expected foundation creates, no deletion/replacement; record its SHA-256 and apply that exact file. Monitor to completion.
6. Re-plan with the same inputs and require no drift. With protected `QM_EXPECTED_ACCOUNT_ID` and `QM_ALERT_EMAIL`, run `pnpm deployment:check` to inspect database privacy, encryption, engine, managed secret, Data API, min/max/pause settings, media controls, sessions, backup selection/retention, budget and subscription. Observe RDS events/CloudWatch capacity without polling SQL to prove idle pause. A one-off `pnpm db:smoke` query may test waking; it is not a keepalive and must never be scheduled. No real data or migration is required. Only call its measured latency a cold start if pause was independently observed immediately beforehand.
7. Start one development database backup with the deployed selection's exact role/vault and 90-day retention; require completion and inspect its recovery point. This checks the narrowed role, not restoration or regional disaster recovery. Reconcile snapshot tags and deadline. Never delete the test snapshot as cleanup.
8. Activate `CostScope` when the cost-allocation tag becomes available, then verify `Active`. AWS discovery/reporting can lag; until then the tag-filtered budget cannot measure project spend reliably. Verify the operator confirms SNS; do not confirm on their behalf. Recheck costs as snapshots accumulate. Alerts are not a hard cap.

On failed creation, stop before dependent stages, retain state/logs and inspect read-only. Fix forward with a new reviewed plan; do not destroy partial resources, disable deletion protection, roll back state, or broaden role permissions blindly. The initial empty database has no application release to roll back. Production, schema writes, restore drills, physical purge, CI/CD and public ingress remain separate work.

## 1. Purpose and operating rules

This runbook governs initial environment creation and later application/infrastructure releases. It is intentionally conservative around data, identity, Terraform state, and production. It never uses `terraform destroy`, deletes state, or treats a fresh plan as equivalent to the reviewed plan.

Core rules:

- Development first; production only after dev acceptance.
- Build once per target/commit and deploy immutable checksummed artifacts.
- Apply the exact reviewed Terraform saved plan.
- Database changes use expand → deploy → migrate/backfill → verify → contract in a later release.
- Roll application code/configuration back only while schema compatibility is proven. Correct database changes forward; restore only for actual data loss/corruption under the recovery procedure.
- Stop on unrequested deletion/replacement, wrong account/region/branch, broadened IAM, public data access, missing backup, failed migration gate, or absent rollback evidence.
- Apply accepted Q-004: humans decide whether and how physical work is performed; AI reminders are advisory, readings are optional, and skipping never prevents saving an asset. Release checks verify that behavior and church-configured restrictions rather than certifying worker qualifications.
- Keep every Aurora instance at `min_capacity=0` with a five-minute auto-pause. Decision 0006 accepts standard CloudFront/WAF without changing the zero-idle-application-compute requirement.
- Do not send synthetic health, login warm-up, keepalive, empty scheduled scan, or outbox-poll traffic to the database. EventBridge Scheduler owns actual due work; delayed SQS triggers wake exact outbox batches; do not depend on `pg_cron` while Aurora can pause.
- Local development/testing uses profile `default` and explicit region `us-east-2`; verify the expected account ID before plan/apply. CI uses environment-specific roles and production placement must be explicitly configured, not inferred from the local profile.
- Preserve the accepted 99.5% availability, 60-second cold-start allowance, 24-hour regional recovery time, preferred 24-hour recovery-point age, and tolerated seven-day data-loss ceiling. A backup failure alerts immediately; measure recovery duration and data-loss age separately.
- Public-PR code executes only in disposable jobs; signing/deployment credentials and persistent `mac-dev`/`linux-dev` hosts receive only reviewed release work.

## 2. Prerequisites

### 2.1 Decisions

Before Phase 1 infrastructure:

- Q-001 through Q-004 are accepted by Erick Brown on 2026-09-06; preserve the decision record in `docs/decisions/0001-pilot-operating-model.md`.
- Q-005 through Q-009 are accepted on 2026-09-07 in `docs/decisions/0002-regions-recovery-and-build-hosts.md`: Ohio primary, approved US alternatives, existing development account, availability/data-loss targets, confirmed CI/CD, public repository, and owned mobile build hosts.
- Q-031/Q-032 are accepted on 2026-09-07 in `docs/decisions/0003-recovery-time-and-production-account.md`: a 24-hour RTO, development in the existing account, and a separate production account after church acceptance.
- Development can proceed now. Before production bootstrap, record church acceptance and establish the separate production account's exact ID, roles, and backend configuration. Resolve domain Q-010 and affected data-retention questions before the corresponding release work. Do not reopen accepted foundational decisions merely because execution inputs remain.
- The launch scope is one real church on the multi-tenant SaaS, initially using air-conditioner and appliance templates. Isolation tests use at least two synthetic tenants.
- Service identity and support/privacy contacts identify Erick Brown initially, and church data controls are included in pilot acceptance.
- AI workflows implement advisory reminders and optional data capture, without certifying a person or work site or generating hazardous physical procedures.
- Decision 0007 defers native releases and closes offline scope. Validate the online-only mobile browser workflow on actual iPhone/Android devices; native toolchains, signing credentials and a local coordinator are not prerequisites. Leave existing `mac-dev`/`linux-dev` configuration untouched.

Before each affected feature release, close its P1 questions from `DESIGN.md`.

### 2.2 Access and separation

- Operator has read-only organization/account discovery and a narrowly scoped deployment role for the named environment.
- Development's expected account ID is recorded in protected configuration and checked against `default` profile STS output. Production's expected account/role is recorded when its separate account is created after church acceptance. Account guards must require distinct development/production IDs, with separate state, resources, and roles; do not point production at the existing development account.
- Read-only account checks verify the intended standard CloudFront/WAF resources and absence of an unintended subscription association; Free-plan eligibility is no longer a gate.
- GitHub CodeConnections/CodeBuild runner integration targets only this repository and has branch/event filters.
- `dev` and `main` are protected. Required reviews/checks and production environment approval are enabled.
- No long-lived AWS keys are stored in GitHub or the repository.
- No App Store/Play credentials or signing material are required for the web release. Existing private material must not enter the repository or logs.

Observed on 2026-09-07: `default` authenticates and selects Ohio; GitHub reports the repository PUBLIC; both SSH hosts answer. Xcode 26.1.1 is present on the Mac, Java 17/Node are on the Linux command path, but complete mobile SDK/signing readiness has not been verified. The read-only checks did not register runners or configure either host.

### 2.3 Repository and tools

Expected tools after implementation:

- Node.js current project-pinned LTS, Corepack, pnpm.
- Terraform project-pinned version and provider lockfile.
- AWS CLI v2, `jq`, `actionlint`, and the selected Terraform policy scanner.
- PostgreSQL migration/test tooling selected by ADR.

From a clean checkout:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
actionlint .github/workflows/*.yml
terraform -chdir=infra/bootstrap fmt -check -recursive
terraform -chdir=infra/environments/dev fmt -check -recursive
terraform -chdir=infra/environments/prod fmt -check -recursive
```

All commands must pass. Never interpolate or print secrets into a command/log.

## 3. One-time bootstrap

Bootstrap is deliberately separate because Terraform cannot safely create its own state backend and deployment trust in the same ordinary stack.

### 3.1 Review

1. Resolve the management/bootstrap account and region through read-only identity checks.
2. Review backend bucket names, versioning, encryption, public-access blocks, lockfile support, lifecycle, and break-glass access.
3. Review dev/prod deployment role trust, permission boundaries, branch/environment conditions, and session duration.
4. Verify plans contain no state/resource deletion, public bucket/database, broad `*` data permissions, or unrelated account resources.

Planned commands:

```bash
aws sts get-caller-identity --profile default --region us-east-2
aws configure get region --profile default
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=infra/bootstrap show -no-color bootstrap.tfplan
```

### 3.2 Apply gate

Apply only when the displayed account/region and saved-plan checksum match the review evidence:

```bash
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
```

Post-bootstrap:

- Confirm state bucket versioning, public access blocks, TLS-only policy, and lock behavior.
- Assume each configured environment role and run `aws sts get-caller-identity`; verify it cannot assume another environment's role or access its data/state.
- Trigger a harmless pull-request check and confirm one ephemeral CodeBuild runner starts and terminates.
- Record bootstrap outputs without secrets.

Rollback: correct IAM/trust/backend configuration with a new reviewed Terraform plan. Do not delete the backend, state versions, connections, or accounts.

## 4. Normal CI/CD topology

### 4.1 Pull request checks

GitHub Actions is the workflow UI/control plane for pull requests to the public repository. Jobs execute on disposable CodeBuild-hosted Linux runners with a restricted role and run repository scripts:

```text
feature → PR to dev
  → format/lint/type/unit/contract/security/IaC checks
  → build artifacts and SBOM
  → offline Terraform validation (account-backed speculative plans run only after review)
```

Fork PRs receive no signing/deployment secrets, local SSH credentials, or private-network access. A workflow must not check out and run untrusted PR code under `pull_request_target`. Persistent local hosts are not public-PR runners; no native release lane is required in v1.

### 4.2 Development pipeline

CodePipeline V2 watches `dev` through CodeConnections:

```text
Source commit
  → CodeBuild verify/build
  → package immutable artifacts
  → Terraform dev saved plan
  → policy and destructive-change gate
  → apply saved plan
  → database expand migration
  → deploy services/web
  → smoke/integration/accessibility checks
  → record artifact, plan, migration, metrics, and cost dimensions
```

### 4.3 Production pipeline

Release PR flows `dev` → `main`. CodePipeline V2 watches `main`:

```text
Source commit
  → reproduce verify/build and checksums
  → production saved plan
  → policy/security/migration/backup review
  → manual production approval
  → apply the reviewed saved plan
  → expand migration
  → canary service/web deploy
  → smoke/SLO/security/cost checks
  → complete rollout or rollback
  → release tag/evidence
```

Production never deploys directly from `dev`, an unreviewed workspace, or an ad hoc locally rebuilt artifact. The same immutable web artifact serves both phone and desktop experiences.

### 4.4 Mobile browser release validation; native lane deferred

1. Release the shared `apps/web` artifact through the web/API pipeline; do not create native build/signing/custom-action jobs.
2. For the authenticated capture milestone, validate camera/microphone permissions, fallback controls, photo readability and foreground speech on actual iPhone Safari and Android Chrome. Record device/browser versions; responsive desktop screenshots alone are not sufficient.
3. Exercise denied permissions, session expiry, tab switching, screen lock, connection loss, interrupted uploads and lost save responses. Require explicit unsaved status, safe foreground retry and no duplicate committed records/media. Do not require unsent input to survive process death.
4. Verify acknowledged server drafts resume online, optimistic conflicts are visible, tenant responses are not persisted in browser application caches, and optional installation does not imply offline availability.
5. Retain compatibility with supported previous web releases/open tabs and warn before refreshing unsaved input. Do not rely on every browser immediately loading the new release.

`mac-dev` and `linux-dev` remain optional testing hosts; no changes to their keys, toolchains or services are implied. Public PRs cannot use persistent LAN machines as runners. The synthetic preview continues denying camera/microphone until the authenticated capture feature and its scoped permission/CSP/CORS changes are ready.

## 5. Environment rollout procedure

### 5.1 Preflight for each environment

1. Record release commit SHA, artifact checksums, environment, AWS account ID, region, current application version, schema version, and previous known-good artifact.
2. Confirm no unrelated/manual drift. Import/adopt drift before deployment or stop.
3. Verify latest successful automated backup and last restore-drill evidence.
4. Verify queues/DLQs are healthy, no incident is active, and cost/availability alarms are normal.
5. Review migration classification: additive, backfill, constraint/index, or contract/destructive.
6. Confirm supported previous web releases/open tabs remain compatible with the new server/schema.
7. Review expected cost delta and any policy exceptions.

Planned read/validation commands:

```bash
aws sts get-caller-identity --profile default --region us-east-2
aws configure get region --profile default
corepack pnpm ci:all
terraform -chdir=infra/environments/dev validate
terraform -chdir=infra/environments/prod validate
```

Run only the Terraform directory for the actual target in subsequent steps.

The commands above select local development/testing. A production pipeline uses its configured role and expected account instead; never let an inherited local `default` profile select production implicitly. Tag review requires Application, Environment, Owner, CostCenter, DataClass, and ManagedBy, plus a mapping for untaggable resources.

### 5.2 Plan

Development example:

```bash
terraform -chdir=infra/environments/dev init
terraform -chdir=infra/environments/dev plan -out=dev.tfplan
terraform -chdir=infra/environments/dev show -no-color dev.tfplan
```

Production example:

```bash
terraform -chdir=infra/environments/prod init
terraform -chdir=infra/environments/prod plan -out=prod.tfplan
terraform -chdir=infra/environments/prod show -no-color prod.tfplan
```

The pipeline stores the sensitive saved plan in its protected artifact store and supplies a checksum. Do not commit saved plans.

### 5.3 Plan review gate

Stop before apply if any of these appears unexpectedly:

- delete, replacement, forced recreation, state move/import, or resource address churn;
- database cluster/instance replacement, snapshot deletion, reduced backup/PITR, or KMS key change;
- public S3/database/Lambda URL, disabled OAC/WAF/TLS, or broader principal/action/resource;
- NAT gateway, ALB/NLB, public IPv4, interface endpoint, RDS Proxy, OpenSearch, Redis, container cluster, provisioned concurrency/model throughput/Aurora instance, or any nonzero Aurora minimum;
- logical replication, Aurora Global Database, zero-ETL integration, Babelfish, a synthetic keepalive, empty scheduled database scan, outbox poller, or required `pg_cron` job that could prevent or conflict with pause;
- CloudFront Free/paid-plan change, region/account/domain change, or reader removal/addition without the approved decision; any reader must be Serverless v2, zero-minimum, and tested to co-pause;
- logging/audit/alarms disabled or retention shortened without policy approval;
- a value derived from an unprotected environment variable/secret output.

Expected changes must map to the release plan/ADR and state their monthly cost, SLO impact, rollback, and owner.

### 5.4 Apply

Only the pipeline role applies the exact saved plan:

```bash
terraform -chdir=infra/environments/dev apply dev.tfplan
```

or

```bash
terraform -chdir=infra/environments/prod apply prod.tfplan
```

Do not run an unplanned `terraform apply` and do not regenerate a plan between approval and apply. A changed source, variable, provider, state, or artifact invalidates approval and requires a new review.

### 5.5 Database change sequencing

1. Expand: add nullable columns/tables/indexes or new enum/reference rows while old code still works.
2. Deploy server code that writes both representations if required and reads compatibly.
3. Deploy the shared mobile/desktop web client after server compatibility tests.
4. Backfill asynchronously in idempotent tenant/key batches with progress, rate, error, pause, and resume controls.
5. Verify counts, constraints, sampled values, RLS, query plans, and old/new client behavior.
6. Switch reads with a versioned feature flag.
7. Observe through at least the agreed compatibility window.
8. Contract in a separate release after supported previous web versions no longer depend on the old schema.

Never combine a destructive contract with the first deploy that introduces its replacement. Snapshot before material backfill/constraint work. Do not log row contents.

### 5.6 Application canary and rollout

- Route a small internal/test cohort to the new version via versioned alias/feature flag where feasible.
- Verify authentication and a read-only asset query first.
- Test one idempotent create/update in a designated synthetic tenant.
- Upload a known test image, confirm one queue job/variant/observation, and clean the synthetic business record through the supported test-data mechanism.
- Run a model-disabled/manual capture path.
- Run one bounded AI test only when the feature is enabled and budget is healthy.
- From a confirmed paused state, verify the first Data API-backed request shows the activation state, finishes within the cold SLO, uses no more than three attempts, and preserves the mutation idempotency key.
- Expand traffic after error/latency/queue/database/model metrics stay within thresholds for the defined observation period.

Web and API can roll out after server checks. Mobile browsers receive the same web release; retain compatibility with open tabs and warn before required refresh. Do not make a breaking server change depend on instant client uptake. Native store releases are deferred.

## 6. Acceptance checks

### 6.1 Functional

- Sign in/out, token refresh, MFA/recent-auth path, and revoked membership denial.
- Create/read/update an asset with idempotency and stale-version conflict.
- RLS adversarial request between two test tenants is denied.
- Direct S3 and Lambda Function URL origins are denied; CloudFront succeeds.
- Media upload/complete/process/variant/observation flow produces exactly one result.
- Online-only capture pauses visibly on connection loss; foreground retries after ambiguous responses do not duplicate records/media. Only acknowledged server state is labeled saved; no durable local queue is created.
- Search, bounded report, rule dry-run, and export respect tenant/capability scope.
- A committed outbox batch is delivered from its pre-commit delayed trigger; a trigger for a failed transaction is a no-op, duplicate triggers are idempotent, and no database poller runs.
- AI-disabled manual path works; AI proposals require configured confirmation.
- Physical-work measurements are optional, human-supplied readings do not require platform qualification verification, and skip/refusal immediately preserves the draft and any access constraint.
- The assistant makes no safety-certification claim or generated hazardous-procedure instruction and honors church-defined restrictions.

### 6.2 Reliability and performance

- Core errors meet the accepted 99.5% availability target; warm p95 meets the engineering latency target and cold activation completes within the accepted 60-second allowance.
- Database ACU, Data API latency/error, and I/O remain within expected bounds.
- Dev and production Aurora each reach zero ACU after five idle minutes when no real work is due.
- Warm, ordinary cold, and greater-than-24-hour deep-sleep activation meet their separate objectives; the UI displays “Starting Quartermaster” and the first operation neither fails nor duplicates.
- A production reader, if approved, also reaches zero and demonstrates the documented co-pause/resume/failover behavior.
- Queue age returns to steady state; DLQs stay empty.
- Lambda concurrency/throttles show core protection under an AI/media load test.
- Voice turn/image processing latency meets the approved objective or the UI shows correct delayed state.
- The newest completed recovery point includes recoverable database metadata and all referenced original media and is preferably no older than 24 hours. Backup failures/age violations alert and retry; seven days is the accepted cost-driven loss ceiling, not the default schedule or retention definition.

### 6.3 Security and privacy

- Edge headers/TLS/WAF/OAC and bucket/database public blocks are present.
- Authorization matrix, tenant-isolation, upload corpus, prompt-injection, and secret scans pass.
- Logs sampled from each service contain no JWTs, pre-signed URLs, raw image/audio, or prohibited sensitive fields.
- CloudTrail/application audit contains deployment and synthetic mutation events.
- Support, including Erick Brown, has no standing tenant-data access through ordinary support sessions; grants are scoped, expiring, and audited, with separately restricted administrative recovery access.
- Church administrators can exercise the enabled access, export, correction, and lifecycle controls; each feature documents its collection purpose, recipients, and retention/deletion behavior.

### 6.4 Cost

- Terraform plan contains no unapproved always-on resource.
- Resource tags and environment cost allocation appear.
- Product counters report core requests, Data API units, Aurora ACU/I/O/storage, voice minutes, model tokens/images, S3 bytes/requests, queue attempts, and log bytes.
- Actual/forecast budgets and anomaly monitors are healthy.
- Estimated cost per test unit stays within the model tolerance; unexplained variance blocks production completion.

## 7. Monitoring during rollout

Use a release dashboard keyed by commit/version and compare canary/current:

- CloudFront WAF blocks, origin 4xx/5xx, cache behavior, and transfer/request plan allowance.
- Lambda errors, throttles, concurrent executions, duration, cold starts.
- Data API errors/latency/payload-limit failures and Aurora ACU/CPU/I/O/storage/deadlocks/resume events.
- Aurora paused duration, time-to-pause, activation duration by idle age, activation attempts, and any unexplained wake-up.
- DynamoDB throttles, SQS age/receive count/DLQ, media/export/rule completion.
- Cognito sign-in/token errors and authorization denials.
- Transcribe grants/minutes/errors and Bedrock request/token/image/latency/schema/fallback/correction.
- Mobile browser upload/save failures, stale-version conflicts, permission failures and web client error rate.
- Estimated hourly/daily spend by service/environment.

Keep the deploy operator engaged through the canary and initial full-traffic observation window. A pipeline success status alone is not acceptance.

## 8. Rollback triggers

Rollback/disable the release when any approved threshold is crossed, including:

- tenant-boundary or authorization failure;
- data loss, corruption, duplicate consequential records, or incorrect financial/audit state;
- public origin/storage/database exposure or secret/sensitive-log disclosure;
- unsafe AI instruction/tool execution or confirmation bypass;
- sustained SLO/error burn, database saturation, or core starvation;
- queue/DLQ growth that cannot recover within the defined window;
- model/transcription spend rate or retries exceed circuit-breaker limits;
- a supported previous web release cannot perform a core workflow;
- infrastructure apply differs from the approved plan or changes the wrong account/region;
- backup/restore protection is degraded.

Security/tenant/data/safety triggers disable the affected path immediately and begin incident handling; do not wait for a statistical threshold.

## 9. Rollback procedures

### 9.1 Application or web defect

1. Disable the affected feature/model/workflow through the versioned configuration flag if that safely restores behavior.
2. Point the Lambda alias/web deployment manifest to the previous immutable artifact.
3. Invalidate only the necessary web entry objects; hashed assets remain immutable.
4. Run core smoke and compatibility checks.
5. Preserve failed artifact/log/correlation evidence.

Use the pipeline’s supported rollback job. Do not rebuild the “same” version locally.

### 9.2 AI/model defect or cost spike

1. Stop issuing new Transcribe grants or model admissions for the affected tenant/model/workflow.
2. Disable the media worker event mapping only if bounded queueing is safer than processing; monitor queue age/retention.
3. Route users to structured/manual capture and preserve drafts/originals.
4. Select the last evaluated prompt/workflow/model version after verifying current access/price.
5. Replay only explicitly selected idempotent messages; never bulk replay an entire DLQ blindly.

### 9.3 Infrastructure defect

1. Stop pipeline progression.
2. Determine whether previous Terraform configuration can be safely re-planned without deletion/replacement.
3. Create and review a new rollback plan; do not apply the old plan against changed state.
4. Apply only if exact target/account and non-destructive changes are verified.
5. If IAM/OAC exposure exists, first apply the smallest containment policy through the approved emergency path, then reconcile Terraform.

### 9.4 Database migration defect

- Additive schema: roll application artifact back if the old code is compatible; leave the unused additive schema.
- Bad backfill: pause worker, identify affected tenant/key ranges through audit/progress, deploy an idempotent corrective migration, and verify samples/counts.
- Constraint/index regression: remove/replace it only through a reviewed migration that does not discard data.
- Data corruption/loss: stop writes, preserve evidence, declare incident, choose PITR timestamp from audit/outbox, restore to a new cluster, validate, then switch through a reviewed plan. Never overwrite the source cluster during investigation.

## 10. Disaster recovery procedure

The primary region is Ohio, with Oregon the proposed backup target and N. Virginia an approved alternative. Restore usable service within the accepted 24-hour RTO (Q-031). Prefer a completed recovery point within 24 hours; up to seven days of lost server-acknowledged data is tolerated if shorter protection is disproportionately costly. Backup retention is three months (90-day initial convention). Q-014 still needs backup-purge and retained-metadata details. Resized photos require recovery copies after originals expire. Before serving a restore, replay deletions and expiry from an independent current ledger so deleted/expired content cannot reappear. This procedure must be exercised and timed before production recovery readiness is claimed.

1. Declare the incident, incident commander, affected region/services, and recovery point objective. Record the service interruption start and incident detection/declaration times; include detection and operator response in the elapsed recovery measurement against 24 hours, not just database restore time.
2. Freeze normal deployment and, when necessary, writes; preserve CloudTrail/application/queue evidence.
3. Select the latest verified cross-region Aurora recovery point at or before the incident boundary and check its actual age. Verify that the referenced original-media versions are recoverable too; report the resulting consistent cutoff and any loss beyond the 24-hour preference.
4. Restore to a new isolated cluster in the approved DR region/account. Do not replace the source.
5. Restore/repoint media only from verified versions/replicas/manifests; validate random SHA-256 samples.
6. Apply the pinned known-good Terraform/application artifacts for DR with region-aware endpoints and no unexpected public resources.
7. Recreate/validate Cognito configuration. Follow the approved user reset/re-verification procedure where credentials cannot be recovered.
8. Validate schema/migrations, row/entity counts, RLS adversarial tests, audit/outbox continuity, media checksums, sign-in, and critical workflows.
9. Change DNS only after approval and a reviewed plan; communicate RPO gap and feature limitations. Record when validated core service is usable again and the elapsed recovery time against the 24-hour target.
10. Monitor, recover pending durable server outbox work and acknowledged drafts, and prevent duplicate commits through durable idempotency records. Recreate expired sessions rather than assuming regional DynamoDB sessions survived. There is no client offline queue; unacknowledged browser input is not recoverable through server backups.
11. Fail back only as a separate planned migration after the original region is trusted and data divergence is resolved.

Quarterly restore drill:

```bash
corepack pnpm test:restore
```

The test must create an isolated recovery target through a reviewed ephemeral stack, validate it, and clean it up through the stack's documented safe procedure. Cleanup is never a broad recursive shell deletion or unreviewed `terraform destroy` against a shared environment.

### 10.1 Moving the project to another account

This is a future migration procedure, not an instruction to move the current project now. The accepted production plan is to keep development in the existing account and create a separate production account only after church acceptance. Reuse the target provisioning and validation steps below for that bootstrap; apply data-copy/cutover steps only to an explicitly approved pilot-data transfer. Do not retire development or copy all development data automatically.

1. Confirm the exact source/destination accounts, regions, application version, downtime/RPO window, and rollback path. Inventory both taggable Quartermaster resources and untaggable dependencies from Terraform and the resource mapping.
2. Bootstrap a new target backend/roles and review a target-stack plan with the same modules and target-specific variables. Preserve the original state and resources; a provider-account edit or state move does not transfer AWS resources.
3. Copy or restore database/media/artifacts, re-encrypt under target keys where needed, and re-establish Cognito identities or the documented reset flow, secrets, DNS/certificates, CodeConnections, and pipeline permissions. Check ownership/key-sharing restrictions before copying; no blanket key or credential rotation is inferred.
4. Validate tenant isolation, record counts, referenced media checksums, authentication, AI region routing, idempotency, and backup recovery in the target. Freeze or reconcile writes for the agreed cutover window and keep supported web-client API compatibility.
5. Cut over DNS/integration endpoints only as part of the approved migration execution, monitor, and preserve the source through the rollback window. Retiring source resources is a separately scoped decision with exact targets; tags alone never authorize deletion.

## 11. Post-rollout cost verification

Within 24 hours after each material release and monthly thereafter:

1. Compare product usage counters with AWS Cost and Usage/Cost Explorer dimensions.
2. Recalculate:

```text
dollars / active tenant
dollars / 1,000 core API requests
dollars / 1,000 Data API units
dollars / voice minute
dollars / 1,000 AI turns
dollars / 1,000 image analyses
dollars / stored media GB
retry multiplier by worker/model
```

3. Verify both environments reach zero ACU, use the five-minute timeout, and have no warm compute/network resource or artificial database traffic.
4. Verify every production database instance has minimum 0 ACU and the CloudFront plan remains Free unless a recorded exception explicitly changed those decisions.
5. Investigate variance above the approved tolerance by service, environment, model/workflow version, and tenant.
6. Update `cost_model.md` with measured assumptions and retrieval date; do not erase prior estimates without change history.
7. Do not purchase Reservations/Savings Plans/provisioned throughput until a stable utilization baseline and break-even calculation support the commitment.

## 12. Release evidence and handoff

Retain for each release:

- commit/release tag and immutable artifact/SBOM checksums;
- CI results and security/AI evaluation reports;
- Terraform saved-plan checksum, human review/approval, apply result, and post-apply state summary;
- database migration IDs, backfill status, and compatibility evidence;
- canary/full rollout metrics, smoke results, and cost-unit sample;
- incidents, rollback actions, or accepted exceptions;
- operator, start/end time, environment/account/region, and final deployment status.

State exactly one of: `not deployed`, `dev deployed and validated`, `production canary`, `production deployed and validated`, `rolled back`, or `recovery active`. Never infer production success from a green CI check alone.
