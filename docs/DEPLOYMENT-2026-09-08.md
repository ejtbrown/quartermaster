# Development hosting and CI/CD — partial deployment

Date: 2026-09-08 UTC (2026-09-07 local).

Status: **blocked before public release**. This record supplements the completed September 7 data/governance foundation; it does not supersede its backup/privacy controls.

## Scope and changes

The user explicitly authorized GitHub → CodeBuild/CodePipeline infrastructure and deployment of the website/API and ready cloud components. Development only, STS-verified default-profile account, Ohio workload resources and Virginia global-edge control plane. No production, real-data intake, schema migration, signing-host changes or AI activation.

- Bootstrap: one repository-scoped CodeConnections resource added by reviewed saved plan; status remains PENDING until the owner completes the AWS/GitHub handshake.
- Delivery: a separate encrypted/locked backend key `dev/delivery.tfstate`, preserving foundation and bootstrap state. Saved plan `hosting.tfplan` SHA-256 `a319f256bb717bcc50b376b4b8266a2af9de3347ab0165798f12af7cca2b1071` contained 44 additions, zero changes/deletes. Guardrails and exact-account/zone checks passed before apply.
- 42 resources created successfully: private encrypted/versioned web/artifact buckets, TLS-only/OAC policies, log groups, constrained API/check/build/deploy/pipeline IAM roles and initial policies, arm64 Node 24 health Lambda and live alias, IAM-only function URL, CloudFront invocation permissions, certificate and validation record, two edge functions, two origin access controls, disabled CloudFront distribution and one-rule rate-limit WAF. No asset media was copied or deleted.
- The native CloudFormation FREE subscription stack was created but its Subscription resource failed. Terraform retains that stack as tainted; the stack is CREATE_FAILED. The final artifact-deployment IAM policy was not reached. Do not remove `prevent_destroy`, delete the stack, untaint it blindly, or rewrite state to bypass this failure.
- AWS reports: “The following resources are not eligible for this subscription tier” for the new distribution. No Pricing Plan Manager subscription exists. Read-only investigation found no Shield Advanced subscription, Firewall Manager management, shared application edge functions, prior pricing subscriptions or unsupported legacy origin access. The underlying eligibility reason remains unresolved; do not claim it is proven to be an account restriction.
- Public website remains disabled, with no qm A/AAAA aliases and no website files uploaded. Actual unsigned S3 and Lambda-origin HTTPS requests returned 403; the live Lambda resource policy grants only the exact CloudFront distribution through AWS_IAM/OAC. The Lambda is bootstrap health code only, not an application release from GitHub.
- Terraform definitions for the disposable checks runner, workflow webhook, two application release projects and dev-only V2 QUEUED pipeline are implemented but gated off pending the GitHub handshake. No remote pipeline or runner execution has been verified.
- GitHub repository settings now require approval for `all_external_contributors`, replacing `first_time_contributors`. No personal token was transferred to AWS and no signing hosts were modified.
- Python operations-alert relay and two content/scope tests are prepared, but the relay is not deployed or connected. Cognito, SES domain identity, operational alarms, regional recovery and actual application features remain unfinished.

## Local validation

The workspace passes formatting/type/build checks, 80 TypeScript/domain/PostgreSQL/policy tests, two Python alert-summary tests, two Chromium desktop/mobile browser tests, Terraform validation/mock tests, and dependency audit with no known vulnerabilities at this check. These tests do not prove that the not-yet-created pipeline can execute or that release rollback works against live AWS. Re-run the implemented `pnpm verify`, `pnpm infra:check`, `pnpm test:e2e`, and audit commands after edits.

Local account/configuration inputs, plans/logs, state, generated binaries/screenshots and `.codex-resume` are ignored; protected deployment inputs/plan files are mode 0600. Public source checks found no actual credential patterns, private account ID, or operator alert email in publishable source. The pattern scan is not a comprehensive external security review.

## Required next actions

1. Owner: complete `quartermaster-dev-github` in the Ohio AWS connections console, authorizing only this repository. Verify AVAILABLE before enabling the GitHub runner/webhook/pipeline.
2. Inspect the new distribution's pricing-plan screen for a detailed eligibility explanation, or use an owner-approved AWS support inquiry. No paid plan or pay-as-you-go security redesign is approved by this failure. Investigate a bounded compatible fix if evidence identifies one; do not weaken origin security to make Free eligibility pass.
3. After resolving eligibility, recover the failed stack with an explicitly reviewed non-destructive forward procedure. Inspect stack/resource state first; its Subscription has no physical ID. Terraform's taint must not lead to destruction of retained subscription/state resources. Verify the live FREE subscription with `pnpm edge:check`, not only stale stack outputs.
4. Review/apply a fresh plan enabling public hosting and the pipeline only when both gates pass. Publish exact reviewed main/dev source; require a dev push to complete source → verify/build → deploy/smoke. GitHub check jobs may remain queued until their runner exists; retry the exact reviewed revision after activation.
5. Verify HTTPS UI, `/api/health` commit, non-cached API responses, disabled asset routes, origin denial, monitoring and drift. Do not call deployment complete before these checks pass.

## Costs and rollback

The unbundled WAF currently adds about **$6/month**, prorated ($5 ACL + $1 rule); CloudFront being disabled does not remove that fee. No paid subscription is approved. This temporarily lowers the modeled scale-to-zero heuristic from target 9.7/10 to 8.7/10. The illustrative mature 10 GB database/secret/snapshot component remains $36.26/month; together about $42.26 before storage/activity/shared services. This is a scenario, not an observed bill. Once CI is active, an illustrative 100 monthly releases plus corresponding checks add about $13, with actual durations to be measured. See cost_model.md for current primary sources and assumptions. The $100 budget is not a hard cap; CostScope still was not discoverable for billing activation.

No failed resources or state were deleted. Leave public ingress off and preserve versioned objects and the failed stack while resolving the blocker. Application release rollback is implemented as restoring the prior Lambda alias and prior versioned index (when available), retaining all immutable assets; it remains unverified in live CI. Database rollback/destruction is never part of website deployment.
