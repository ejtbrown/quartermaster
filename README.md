# Quartermaster

Quartermaster is a proposed voice-first, cloud-based enterprise asset management system for churches and similarly small operations. One responsive web application serves mobile field capture and desktop estate-wide search, analysis, maintenance planning, insurance, disaster assessment, and accounting exports. The first release is online-only; native applications and offline storage/synchronization are deferred under [decision 0007](docs/decisions/0007-online-only-mobile-web.md). Optional Home Screen installation does not add offline support.

Erick Brown initially operates and supports this multi-tenant SaaS. The pilot starts with one church and focuses on air conditioners and appliances, with additional tenants and asset classes supported as it grows. Each church controls its data; privacy and compliance are first-class requirements. Humans are responsible for physical-work safety, with AI providing advisory reminders and recording observations. The first four design decisions were [accepted on September 6, 2026](docs/decisions/0001-pilot-operating-model.md).

The immediate AWS region is Ohio (`us-east-2`), with `us-east-1` and `us-west-2` approved alternatives. Development/testing uses the account selected by the local `default` profile; Terraform, tags, and parameterized configuration support a later account move. The repository is public. GitHub Actions checks run on CodeBuild and CodePipeline orchestrates web/API deployments. These directions and the availability/recovery policy were [accepted on September 7, 2026](docs/decisions/0002-regions-recovery-and-build-hosts.md); decision 0007 removes native signing and the `mac-dev`/`linux-dev` build lane as launch dependencies without changing those hosts.

The target AWS architecture scales application compute to zero during idle periods. Aurora writers auto-pause at 0 ACU and Lambda/build jobs are on-demand. Standard CloudFront + WAF and tiered snapshots are accepted in [decision 0006](docs/decisions/0006-tiered-backups-and-standard-edge.md); retained data, credentials, WAF and activity remain billable. Availability is targeted at 99.5%, with a 60-second cold start. Backups should preferably limit data loss to one day at modest cost; up to a week is tolerated.

The accepted disaster recovery time is 24 hours. Development stays in the current account; if the church accepts the product, a separate production account will be created and bootstrapped with Terraform. These [two additional decisions](docs/decisions/0003-recovery-time-and-production-account.md) close Q-031/Q-032; later decisions and remaining feature-specific questions are recorded in the design register.

## Design set

- [End-to-end product and technical design](DESIGN.md)
- [AWS inventory](inventory.yaml)
- [AWS cost model](cost_model.md)
- [Cost and scalability review](DESIGN_REVIEW_COST_SCALABILITY.md)
- [Machine-actionable implementation backlog](codex_plan.json)
- [Rollout, rollback, and recovery runbook](RUNBOOK_ROLLOUT.md)

## Build status

The authenticated synthetic workspace is deployed at [qm.ejtbrown.com](https://qm.ejtbrown.com): invitation-only authentication, tenant authorization, editable assets/search, maintenance/readings, server-saved drafts and audit. The GitHub release pipeline, actual Aurora integration and independent public checks passed. Account creation and invitations remain deferred, so successful user/MFA enrollment and signed-in cloud browser saves are not yet verified. See the [workspace scope and runbook](docs/AUTHENTICATED-WORKSPACE.md) and [deployment record](docs/DEPLOYMENT-2026-09-25-AUTH.md).

Deletion metadata follows the backup horizon (currently 90 days after deletion), under [decision 0008](docs/decisions/0008-deletion-metadata-backup-horizon.md). Compliance holds remain deferred. The owner authorized completion of the synthetic web/health-API deployment; verified rollout evidence is recorded separately.

The development site is [qm.ejtbrown.com](https://qm.ejtbrown.com), with [release/configuration health](https://qm.ejtbrown.com/api/health). The automatic GitHub `dev` → CodePipeline → CodeBuild release path was verified for the earlier foundation preview; its [deployment evidence](docs/DEPLOYMENT-2026-09-25.md) remains historical. The workspace is synthetic-only: real church data, photo/voice capture, AI and deletion are not enabled. See [implementation status and next milestones](docs/IMPLEMENTATION.md).

The Ohio foundation retains private zero-minimum Aurora, protected storage, on-demand sessions, a $100 budget, seven-day PITR, 12-hour/seven-day snapshots and weekly/90-day snapshots. Three additive database migrations and a separate non-owner runtime credential support the workspace. No production deployment occurred.

The development budget is $100/month. Originals/transcripts are retained 15 days, audits one year, and backups three months (90-day initial convention). Resized photos have no age-based expiry and are purged when the user deletes them or their asset/tenant is purged; only minimal deletion metadata remains. The alert recipient is supplied privately. Backup-purge semantics remain unresolved and physical cleanup remains disabled. See [the accepted photo and deployment decision](docs/decisions/0005-resized-photo-retention-and-development-deployment.md).

The earlier backup/edge model estimated the steady-state database/secret/snapshot/WAF component at about $9.92/month with weekly historical snapshots and an illustrative 10 GB database, excluding activity and other services. It predates the additional runtime secret used by the authenticated workspace. Existing recovery points keep their expiry, so savings phase in. See [the cost model](cost_model.md) for assumptions and exclusions. The online-only web decision simplifies client engineering/distribution; it does not remove cloud AI or storage costs.
