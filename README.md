# Quartermaster

Quartermaster is a voice-first, cloud-based enterprise asset management system in development for churches and similarly small operations. One responsive web application serves mobile field capture and desktop estate-wide search, analysis, maintenance planning, insurance, disaster assessment, and accounting exports. The first release is online-only; native applications and offline storage/synchronization are deferred under [decision 0007](docs/decisions/0007-online-only-mobile-web.md). Optional Home Screen installation does not add offline support.

Erick Brown initially operates and supports this multi-tenant SaaS. The pilot starts with one church and focuses on air conditioners and appliances, with additional tenants and asset classes supported as it grows. Each church controls its data; privacy and compliance are first-class requirements. Humans are responsible for physical-work safety, with AI providing advisory reminders and recording observations. The first four design decisions were [accepted on September 6, 2026](docs/decisions/0001-pilot-operating-model.md).

The immediate AWS region is Ohio (`us-east-2`), with `us-east-1` and `us-west-2` approved alternatives. Development/testing uses the account selected by the local `default` profile; Terraform, tags, and parameterized configuration support a later account move. The repository is public. GitHub Actions checks run on CodeBuild and CodePipeline orchestrates web/API deployments. These directions and the availability/recovery policy were [accepted on September 7, 2026](docs/decisions/0002-regions-recovery-and-build-hosts.md); decision 0007 removes native signing and the `mac-dev`/`linux-dev` build lane as launch dependencies without changing those hosts.

The target AWS architecture scales application compute to zero during idle periods. Aurora writers auto-pause at 0 ACU and Lambda/build jobs are on-demand. Standard CloudFront + WAF and tiered snapshots are accepted in [decision 0006](docs/decisions/0006-tiered-backups-and-standard-edge.md); retained data, credentials, WAF and activity remain billable. Availability is targeted at 99.5%, with a 60-second cold start. Backups should preferably limit data loss to one day at modest cost; up to a week is tolerated.

The accepted disaster recovery time is 24 hours. Development stays in the current account; if the church accepts the product, a separate production account will be created and bootstrapped with Terraform. These [two additional decisions](docs/decisions/0003-recovery-time-and-production-account.md) close Q-031/Q-032; later decisions and remaining feature-specific questions are recorded in the design register.

## Design set

- [Accepted visual style guide (PDF)](docs/design/Quartermaster-Visual-Style-Guide-v1.pdf) — v1.0, adopted October 6, 2026; 20 pages of typography, color, component, help, responsive and accessibility standards. Editable source and font licenses are retained beside it.
- [End-to-end product and technical design](DESIGN.md)
- [AWS inventory](inventory.yaml)
- [AWS cost model](cost_model.md)
- [Cost and scalability review](DESIGN_REVIEW_COST_SCALABILITY.md)
- [Machine-actionable implementation backlog](codex_plan.json)
- [Rollout, rollback, and recovery runbook](RUNBOOK_ROLLOUT.md)

## Build status

The accepted visual system is implemented in the responsive client, with self-hosted Manrope/Source Sans 3, grouped navigation, explanatory help, asset sections, structured asset-type forms and accessible confirmation dialogs. First-party sign-in at `/sign-in` keeps the browser on `qm.ejtbrown.com` for passwords, invitations, TOTP enrollment/verification, recovery and reauthentication; Cognito remains the identity provider. Existing passwords and authenticators remain valid. See the current evidence in `docs/IMPLEMENTATION.md` before treating source as deployed.

The October operational increment replaces the synthetic register with ordinary workspaces and connected asset, photo, assisted capture, maintenance, insurance, incident, reporting, rules and administration workflows. See the [current workspace scope and runbook](docs/AUTHENTICATED-WORKSPACE.md) and [implementation/deployment evidence](docs/IMPLEMENTATION.md). The approved owner invitation was sent and an empty Quartermaster workspace created; no demo records are seeded. Human password/TOTP enrollment and real-phone testing remain separate acceptance checks.

Deletion metadata follows the backup horizon (currently 90 days after deletion), under [decision 0008](docs/decisions/0008-deletion-metadata-backup-horizon.md). Inaccessible backup copies may remain until expiry; replay deletions before restored access. Compliance holds remain deferred.

The development site is [qm.ejtbrown.com](https://qm.ejtbrown.com), with [release/configuration health](https://qm.ejtbrown.com/api/health). GitHub `dev` → CodePipeline → CodeBuild releases immutable API/worker versions and the responsive website. The [September deployment evidence](docs/DEPLOYMENT-2026-09-25.md) remains historical, not a description of the current feature scope.

The Ohio foundation retains private zero-minimum Aurora, protected storage, on-demand sessions, a $100 budget, seven-day PITR, 12-hour/seven-day snapshots and weekly/90-day snapshots. Migration 0004 adds operational tables and separate non-owner application/worker roles. No production deployment is included.

The development budget is $100/month. Originals/transcripts expire after 15 days, audits after one year, and backups within 90 days. Resized photos persist until photo/asset/tenant deletion. Deletion hides live content immediately, then retryable workers purge records, photo versions and cached exports. The independent deletion ledger protects restores. The alert recipient is configured privately. See [the photo policy](docs/decisions/0005-resized-photo-retention-and-development-deployment.md).

The earlier backup/edge model estimated the steady-state database/secret/snapshot/WAF component at about $9.92/month with weekly historical snapshots and an illustrative 10 GB database, excluding activity and other services. It predates the additional runtime secret used by the authenticated workspace. Existing recovery points keep their expiry, so savings phase in. See [the cost model](cost_model.md) for assumptions and exclusions. The online-only web decision simplifies client engineering/distribution; it does not remove cloud AI or storage costs.
