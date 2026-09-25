# 0006 — Tiered database backups and standard CloudFront/WAF

Date: 2026-09-24

Status: accepted product/cost decisions; deployment evidence recorded separately

Decision owner: Erick Brown

## Decisions

- Keep seven days of Aurora point-in-time recovery and 12-hour snapshots retained for seven days.
- Keep one weekly snapshot for 90 days from creation. Engineering default: Sunday 00:00 UTC, overlapping the frequent snapshot window; AWS Backup keeps the longer retention when windows overlap.
- Do not retroactively delete or shorten existing recovery points. The new rules affect future snapshots, so savings phase in.
- Use standard pay-as-you-go CloudFront and WAF, not a Free flat-rate subscription. The existing one-ACL/one-rule baseline is about $6/month plus requests and other edge usage. This is an explicit exception to the original zero fixed edge-cost target, not permission for warm application compute or a paid flat-rate plan.
- Preserve private S3, IAM-only Lambda origins, always-signed OAC, uncached API responses and the current rate limiter. The $100 development budget remains unchanged.

At an illustrative constant 10 GB database, about 12 older weekly snapshots cost $2.52/month; database storage, one secret and WAF bring the modeled component subtotal to $9.92/month. This excludes activity and other storage/services. See the current-decision section in `cost_model.md` for formulas, sources and transition caveats.

## Deployment boundaries and remaining decisions

GitHub CodeConnections was verified AVAILABLE on this date. No further product choice is needed for the synthetic development preview and health-only API. The owner explicitly rejected retaining the failed Free-plan stack and authorized deleting `quartermaster-dev-edge-free` from AWS and Terraform. This supersedes the proposed `removed` block with `destroy=false`. Cleanup must verify that the stack has no created Subscription physical resource, delete only that exact failed stack through a reviewed saved Terraform plan, and preserve CloudFront, WAF and all application/data resources. See the deployment record for completion evidence.

Before real church data: decide whether deleted content may remain inaccessible in isolated backups until their 90-day expiry, with deletion replay before a restore serves users, or whether it must become immediately unrecoverable there. Specify retention of minimal deletion metadata and exceptional holds. Implement and verify authentication, tenant isolation, media expiry/purge, application audit, backup monitoring and recovery; these implementation tasks are not satisfied by publishing a preview. Production domain/account and native signing/store setup remain later release inputs.

The new cadence does not resolve purge policy or claim tested regional recovery. Same-region backups remain the only implemented recovery path; the preferred 24-hour RPO and accepted 24-hour RTO still require monitoring and restore evidence.
