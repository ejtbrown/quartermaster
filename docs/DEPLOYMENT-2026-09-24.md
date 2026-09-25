# Tiered backups applied; standard-edge delivery prepared

Date: 2026-09-24

## Applied development change

The owner accepted [decision 0006](decisions/0006-tiered-backups-and-standard-edge.md). Default-profile STS matched the protected development account; workload region is Ohio (`us-east-2`). The existing foundation backend was preserved.

Saved plan `tiered-backups.tfplan`, SHA-256 `20780d370ce36f0d5e35f84d21a91e5d16db12803822fbe949749cbfc42ba144`, passed guardrails and contained exactly one in-place change: `module.foundation.aws_backup_plan.database`. Apply completed: zero adds, one change, zero destroys. Live AWS rules now show:

| Recovery tier | Schedule | Retention from creation |
|---|---|---|
| Native Aurora PITR | Continuous | 7 days, unchanged |
| Recent snapshots | Every 12 hours, UTC | 7 days |
| Historical snapshots | Sunday 00:00 UTC | 90 days |

The weekly window overlaps the frequent rule; AWS Backup selects the longer retention. Existing recovery points were not deleted or shortened. The newest pre-change job completed successfully on September 24; future jobs under the new rules still require observation. A fresh complete foundation plan returned exit 0/no changes. No SQL, schema migration, database restart or recovery-point deletion was performed.

## Explicitly authorized failed-stack cleanup

The owner subsequently directed deletion of the failed stack from both AWS and Terraform, superseding the retain-in-AWS proposal below. Read-only checks reverified the exact development account, delivery backend/workspace, stack ARN in `us-east-1`, CREATE_FAILED status and the single failed Subscription with no physical resource ID. Standard CloudFront/WAF preflight passed; no subscription association existed.

Removed the obsolete Terraform `removed`/`destroy=false` block and the state-forget policy exception. A one-off targeted cleanup plan was independently checked for exactly one action: delete `aws_cloudformation_stack.edge_free`, with no other managed changes. Saved plan SHA-256: `1022d1589de33157cb9b3b226f430ea11683f5f3a53d3c105bd4a1d6dd19c01b`. Applying it completed with **zero adds, zero updates and one deletion**. AWS reports DELETE_COMPLETE; lookup by stack name returns the specific does-not-exist error, and Terraform resource state no longer contains the stack. No subscription, CloudFront distribution, WAF, application data or backup was deleted. Historical deployment records remain; the failed stack itself is not restored as a rollback.

The targeted plan is deliberately incomplete for the rest of delivery and was used only for this explicitly authorized failure cleanup. Generic CI guardrails still reject delete/forget actions. Do not reapply any older `hosting.tfplan` or `standard-edge.tfplan`; the source and state have changed. Remaining delivery deployment and publication are separate from this cleanup.

A reviewed refresh-only plan (`clean-edge-outputs.tfplan`, SHA-256 `f1962ef43af38bc89199a83051d145f536c8f7dcbbbc4e549c2329d3e276d1c2`) then removed the stale `free_plan_stack` output and recorded the standard billing output. It performed no AWS resource mutations; it also refreshed observed provider metadata from the earlier partial apply. The failed stack therefore has no active resource, retention block, output or special policy bypass left in Terraform. Cleanup validation re-ran `pnpm verify` (86 tests plus two operations tests), all nine Terraform mock tests, and live edge preflight successfully. Source remains local/uncommitted, with no website/pipeline publication in this cleanup.

The fresh full `standard-edge-after-cleanup.tfplan` is complete and passes normal policy checks. It contains only the previously pending CloudFront comment update and deploy IAM-policy creation, no deletion/forget/replacement and no failed-stack resource. It was not applied. Cleanup is complete; this is not a claim that the remaining delivery deployment has finished.

## Earlier delivery preparation (retention proposal superseded above)

The GitHub connection is now AVAILABLE. Live read-only checks verify the exact development distribution/WAF on standard billing, with no flat-rate subscription association. Source removes Free-only dependencies, retains WAF/private origins, and adds tested billing/configuration preflight. The failed `quartermaster-dev-edge-free` stack remains CREATE_FAILED and its Subscription has no physical ID.

The prepared `standard-edge.tfplan` is complete and contains only: one `forget` for that failed stack (AWS stack retained via `destroy=false`), one distribution-comment update, and creation of the previously blocked scoped deploy IAM policy. No cloud resource would be destroyed. Owner approval for the ownership removal was requested and has not been received. The policy checker correctly rejects this forget action without its explicit approval flag. **The delivery plan was not applied.** No Terraform state removal, stack deletion, new subscription, DNS publication or CI/CD provisioning occurred.

Website remains unpublished and no application release has run. Source changes remain local/uncommitted; do not deploy the old dev commit, whose release script still requires FREE. The approved next sequence is described in `RUNBOOK_ROLLOUT.md`: retire only the retained empty-stack record after approval, enable the authorized connection's pipeline, publish the reviewed commit, then validate exact-commit HTTPS release and private-origin denial. Real data, authentication/CRUD, AI, mobile and regional recovery remain later milestones.

## Validation and costs

- `pnpm verify`: formatting, types, 86 tests, two operations tests, build and public-source configuration checks passed.
- `pnpm infra:check`: four Terraform targets validated; all nine mock-provider tests passed.
- `pnpm test:e2e`: two Chromium tests passed. Edge preflight also bundles successfully and its live read-only check passes.
- `pnpm deployment:check`: all 32 read-only foundation checks passed, including the new retention tiers, unchanged seven-day PITR and private database. CostScope billing-tag activation remains an explicit warning; the project-filtered budget cannot yet reliably attribute spend. Monitoring/alert wiring and this cost-attribution step remain rollout work, not additional product decisions.
- Saved plans/logs are ignored and mode 0600. `.codex-resume` remains unchanged and ignored. No existing user changes were overwritten.

The cost skill preserved recent recovery and private ingress while reducing older snapshot count. At an illustrative steady 10 GB database, database/secret/older snapshots/WAF total about **$9.92/month**, versus the previous $42.26 component scenario. Existing backups phase out under their original deadlines; savings are not immediate. Activity, photo storage, CI, logs, DNS/shared services and regional recovery are extra. The scale-to-zero heuristic is **8.7/10**, retaining the accepted WAF fixed charge. See `cost_model.md` for provenance and exclusions.

Rollback the backup rule only through a new reviewed plan; that does not retroactively extend existing recovery-point lifetimes. Do not prune recovery points. The owner's failed-stack cleanup authorization applies only to that verified empty stack, not application/data resources.
