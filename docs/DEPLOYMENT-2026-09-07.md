# Development foundation deployment — 2026-09-07

Status: development data/governance foundation deployed and validated; not application-ready. Aurora was observed at zero ACUs and left idle.

## Scope and safeguards

- Target: the explicitly verified existing development account, profile `default`, Ohio (`us-east-2`), workspace `default`. No production resources, DNS/email-domain identities, schema writes, or customer data.
- Bootstrap: five additions, zero changes/deletions; completed. Private, encrypted, versioned, TLS-only state bucket verified. Bootstrap state remains protected locally; development state uses its encrypted S3 backend with lockfiles. No state migration occurred.
- Foundation: reviewed saved plan with 23 additions, zero changes/deletions; completed. The writer finished provisioning in 8m7s (initial creation, not cold-start latency). The data/governance scope is in `infra/environments/dev`; application ingress, authentication, CI/CD, mobile, and AI remain unimplemented.
- Saved plans and protected environment values are ignored and mode 0600. No Git commit or push has been made by this deployment session.
- Bootstrap applied-plan SHA-256: `152332b8ef7da70f7857503ac1bd0116e4b99e709adff2ce65443c419e96e8c1`.
- Foundation applied-plan SHA-256: `a57809efb20b16884c3df20cd9f135bbac2d10f76f476ed86ac47317ecdbbefd`.
- Follow-up parameter-only saved plan SHA-256: `5604b3c8d16c79f8880908432507ebbb6f2d920a61fef07b6d64a676740053de`; zero additions, one in-place update, no deletion/restart. AWS continued reporting `rds.logical_replication=0` as `engine-default` after an explicit write of 0. Removed that redundant Terraform override to avoid perpetual drift, retaining the pinned engine's default and explicit live verification. No parameter-wide `ignore_changes` was introduced. The AWS API confirms 0 and SQL confirms `wal_level=replica`; plan policy rejects nonzero logical-replication overrides.

## Validation

- 62 unit/policy/PostgreSQL tests, six Terraform mock tests, two Chromium browser tests, formatting/types/builds, and repository configuration checks pass.
- Actual plans passed the foundation guardrail checker and manual scope review. The checker is not a comprehensive IAM/security audit.
- IAM simulation allows snapshot creation for the exact Quartermaster source cluster and regional AWS Backup snapshot namespace. It denies snapshot creation for an unrelated source cluster and denies EC2/SSM operations. The custom role has no broad managed policy attached.
- The alert recipient is configured privately and SNS confirmation is verified. The budget's five actual/forecast notifications target the configured recipient. Operations publishers/alarms are not yet implemented; subscription confirmation alone is not proof of end-to-end alert delivery.
- SNS accepted one explicitly labeled deployment test message for the confirmed recipient. Inbox receipt was not independently verified.
- `CostScope` has not appeared in the AWS cost-allocation tag catalog. The tag-filtered budget exists but reliable spend attribution awaits activation/reporting.

- Final development plan has no changes after removing the redundant default-valued logical-replication override. The bootstrap plan also has no changes. No deletion/replacement, parameter-wide drift suppression, credential rotation, or state migration was used.
- `pnpm deployment:check` passed 32 read-only live checks at 17:13:47 UTC, including account, database/network/storage controls, effective SSL/logical-replication values, budget recipients, backup scope, and role restrictions. It reports cost-allocation readiness as a warning.
- The one-off Data API query succeeded at 17:13:01 UTC in 1,905 ms, one attempt, with `wal_level=replica`. No schema or data was written. This was a warm query, not evidence of the accepted 60-second cold-start target. Initial test failures were fixed by reading AWS-only parameters through the AWS API and allowing the normal non-outage `backing-up` status.
- The on-demand backup started at 17:08:50 UTC and completed at 17:12:51 UTC. Its recovery point is encrypted, tagged with the project/environment/cost scope, and scheduled for deletion at 2026-12-06 17:08:50 UTC (90 days). Its opaque job ID and account-specific recovery ARN remain available in AWS and private execution evidence; no test snapshot was deleted. This proves the narrowed backup role works, not restoration or regional disaster recovery.
- CloudWatch `AWS/RDS ServerlessDatabaseCapacity`, scoped to `quartermaster-dev-writer`, reported both minimum and maximum **0.0 ACU** for the 17:22, 17:23, and 17:24 UTC samples. This verifies idle scale-to-zero for the deployed writer. No further SQL was sent after the successful smoke; the database was left idle. This is a point-in-time behavior check, not a measured monthly availability or cost result.

## Remaining acceptance and follow-up

Idle pause was observed without additional SQL; the last successful query was at 17:13:01 UTC. Cold/deep-sleep resume testing, authenticated tenant integration, restore drills, regional recovery, application/CI/CD deployment, and real-data privacy paths remain separate gates. No completed snapshot alone proves regional RTO/RPO.

The idle interval is measured from the end of user connections, not just the last SQL response. CloudWatch still reported one connection through 17:15 UTC and zero from 17:16 UTC, with zero capacity observed from 17:22 UTC; allow for connection closure and metric timing when observing the five-minute pause. AWS also documents a longer minimum idle interval after administrative wake-ups; that was a possible explanation considered during observation, not an independently established cause here. Do not mistake a post-deployment sample for a steady-state billing measurement. See [Aurora auto-pause behavior](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html).

When AWS exposes `CostScope`, activate it with `aws ce update-cost-allocation-tags-status --profile default --region us-east-1 --cost-allocation-tags-status TagKey=CostScope,Status=Active` and verify `aws ce list-cost-allocation-tags --profile default --region us-east-1 --tag-keys CostScope`. Do not activate unrelated tags. Reporting can lag after activation; check actual billing rather than assuming notifications cap spending. The budget covers tagged Quartermaster development spending, not unrelated account resources.

Resized-photo retention is accepted, without age expiry until photo/asset/tenant deletion. The media bucket is empty; its original-only 15-day lifecycle intent remains disabled pending physical purge implementation and retained-backup deletion semantics. No real church data should be admitted yet.

See `RUNBOOK_ROLLOUT.md` for exact gates and safe fix-forward procedures. Never destroy partially created data resources or rewrite state as cleanup.
