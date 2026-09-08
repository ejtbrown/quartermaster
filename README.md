# Quartermaster

Quartermaster is a proposed voice-first, cloud-based enterprise asset management system for churches and similarly small operations. The mobile app helps people capture and maintain asset records in the field; the web application supports estate-wide search, analysis, maintenance planning, insurance, disaster assessment, and accounting exports.

Erick Brown initially operates and supports this multi-tenant SaaS. The pilot starts with one church and focuses on air conditioners and appliances, with additional tenants and asset classes supported as it grows. Each church controls its data; privacy and compliance are first-class requirements. Humans are responsible for physical-work safety, with AI providing advisory reminders and recording observations. The first four design decisions were [accepted on September 6, 2026](docs/decisions/0001-pilot-operating-model.md).

The immediate AWS region is Ohio (`us-east-2`), with `us-east-1` and `us-west-2` approved alternatives. Development/testing uses the account selected by the local `default` profile; Terraform, tags, and parameterized configuration support a later account move. The repository is public. GitHub Actions checks run on CodeBuild, CodePipeline orchestrates deployments, and trusted native builds use the SSH hosts `mac-dev` for iOS and `linux-dev` for Android. These directions and the availability/recovery policy were [accepted on September 7, 2026](docs/decisions/0002-regions-recovery-and-build-hosts.md).

The target AWS architecture scales application compute to zero during idle periods. Aurora writers auto-pause at 0 ACU and Lambda/build jobs are on-demand. CloudFront Free is the intended edge plan, but AWS rejected the first subscription attempt; public hosting remains disabled pending resolution. Durable data and credentials remain billable: the illustrative mature database/secret/90-day-snapshot component is $36.26/month at a constant 10 GB database size, excluding activity and other services. Availability is targeted at 99.5%, with a 60-second cold start. Backups should preferably limit data loss to one day at modest cost; up to a week is tolerated.

The accepted disaster recovery time is 24 hours. Development stays in the current account; if the church accepts the product, a separate production account will be created and bootstrapped with Terraform. These [two additional decisions](docs/decisions/0003-recovery-time-and-production-account.md) close Q-031/Q-032, leaving 21 open questions in the design register.

## Design set

- [End-to-end product and technical design](DESIGN.md)
- [AWS inventory](inventory.yaml)
- [AWS cost model](cost_model.md)
- [Cost and scalability review](DESIGN_REVIEW_COST_SCALABILITY.md)
- [Machine-actionable implementation backlog](codex_plan.json)
- [Rollout, rollback, and recovery runbook](RUNBOOK_ROLLOUT.md)

## Build status

The development data/governance foundation is deployed in Ohio: private zero-minimum Aurora, protected state/media storage, on-demand sessions, a $100 budget, and 90-day database backups. The next increment implements GitHub → CodePipeline V2 → disposable CodeBuild releases and has provisioned private web/artifact buckets, a health-only Lambda, TLS, scoped roles and disabled CloudFront hosting. Release is blocked by the owner's pending GitHub connection authorization and AWS rejecting the FREE subscription. No authenticated application, public website release, or database migration is deployed. See [implementation status](docs/IMPLEMENTATION.md) and [the latest partial-deployment evidence](docs/DEPLOYMENT-2026-09-08.md). `qm.ejtbrown.com` is not yet a live endpoint.

The development budget is $100/month. Originals/transcripts are retained 15 days, audits one year, and backups three months (90-day initial convention). Resized photos have no age-based expiry and are purged when the user deletes them or their asset/tenant is purged; only minimal deletion metadata remains. The alert recipient is supplied privately. Backup-purge semantics remain unresolved and physical cleanup remains disabled. See [the accepted photo and deployment decision](docs/decisions/0005-resized-photo-retention-and-development-deployment.md).

The longer snapshot history changes the estimate: the illustrative steady-state development database/secret/snapshot component is about $36/month at 10 GB, before activity and other services. See [the updated cost model](cost_model.md#53-implemented-90-day-snapshot-policy-and-100-budget).
