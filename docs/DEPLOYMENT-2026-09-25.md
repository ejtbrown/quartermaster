# Development preview delivery — September 25

Status: deployment in progress; do not infer a successful release from this record until verification is recorded below.

The owner authorized Step 1: publish the reviewed source and deploy the synthetic web preview and health-only API through GitHub → CodeBuild/CodePipeline at `qm.ejtbrown.com`. This does not authorize production or enable real asset intake, authentication, AI, or content-purge workers.

[Decision 0008](decisions/0008-deletion-metadata-backup-horizon.md) also accepts deletion metadata for the backup horizon, currently 90 days after deletion, and defers compliance holds. Content deletion within retained backups remains unresolved; it does not block synthetic preview delivery.

## Preflight

- Default-profile STS matched the expected development account in the protected configuration; Ohio remains the workload region and Virginia the edge control plane.
- GitHub CodeConnections is AVAILABLE. The public repository still requires approval for all external PR contributors. No personal token is uploaded to AWS.
- Before this rollout, no CodeBuild project or CodePipeline exists, the CloudFront distribution is disabled, and qm A/AAAA aliases have not been published. The failed empty Free-plan stack was already deleted on September 24; no subscription recreation is planned.
- Existing data, backups, state, unrelated DNS/edge resources and native build hosts are outside the mutation scope. `.codex-resume`, protected inputs, state and saved plans remain ignored.

## Rollout evidence

Pending fresh-plan review, source publication, exact-plan application, pipeline release and live checks. See `RUNBOOK_ROLLOUT.md` for rollback and scope boundaries. Do not use earlier saved plans.
