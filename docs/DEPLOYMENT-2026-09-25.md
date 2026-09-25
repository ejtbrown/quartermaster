# Development preview delivery — September 25

Status: Step 1 deployed and independently verified; synthetic preview only.

The owner authorized Step 1: publish the reviewed source and deploy the synthetic web preview and health-only API through GitHub → CodeBuild/CodePipeline at `qm.ejtbrown.com`. This does not authorize production or enable real asset intake, authentication, AI, or content-purge workers.

[Decision 0008](decisions/0008-deletion-metadata-backup-horizon.md) also accepts deletion metadata for the backup horizon, currently 90 days after deletion, and defers compliance holds. Content deletion within retained backups remains unresolved; it does not block synthetic preview delivery.

## Preflight

- Default-profile STS matched the expected development account in the protected configuration; Ohio remains the workload region and Virginia the edge control plane.
- GitHub CodeConnections is AVAILABLE. The public repository still requires approval for all external PR contributors. No personal token is uploaded to AWS.
- Before this rollout, no CodeBuild project or CodePipeline exists, the CloudFront distribution is disabled, and qm A/AAAA aliases have not been published. The failed empty Free-plan stack was already deleted on September 24; no subscription recreation is planned.
- Existing data, backups, state, unrelated DNS/edge resources and native build hosts are outside the mutation scope. `.codex-resume`, protected inputs, state and saved plans remain ignored.

## Rollout evidence

Reviewed saved plans passed the normal policy checks and were applied without deletion/replacement:

| Plan | Managed changes | SHA-256 |
|---|---|---|
| `publish-preview-20260925.tfplan` | Create the deploy policy and qm A/AAAA aliases; enable/update the existing CloudFront distribution | `67456e34da31ab17cb0fbe1fa0233d65286a566e00fb151e24112952ec6c9d9b` |
| `enable-ci-20260925.tfplan` | Create three CodeBuild projects, the checks webhook and the development CodePipeline | `9cea3a7c5821b6de58e7a5051d0f4cf57f57d71bdd92ac24ad62c8982f03341a` |
| `ci-toolchain-20260925.tfplan` | Update only the deploy project's installer/buildspec | `88a7e9ce310f1a86d62f02d0709b9143075c61a06145f72e705f1b80dd444382` |
| `alias-policy-20260925.tfplan` | Correct alias-management resource scope in the development deploy role | `c57029da6d8f1b2e7e53c2e6992b03e610a21965503fd56242730145aef1dc84` |

`publish_site` and `enable_pipeline` are now true in protected development inputs. The pipeline is V2/QUEUED, uses only `dev`, and has separate checks/build/deploy roles. Each project is an unprivileged on-demand Linux container with concurrency one and a 20-minute build limit; no warm fleet, NAT or production pipeline was added.

Source was published as `6d4980b`, followed by installer correction `ae9441a` and alias-permission correction `194680f`. Main is unchanged. The first two rollout executions exposed integration issues before any application-pointer mutation:

- The build image already owns `/usr/local/bin/node`; global installation failed with EEXIST. Pinned Node/pnpm now install in an isolated build-local prefix and PATH selects them explicitly. Both build and deploy jobs use this approach; regression tests cover it.
- Lambda GetAlias/UpdateAlias require the unqualified function ARN. The deploy policy now grants these operations only on `quartermaster-dev-api`, with no access to other functions; qualified invocation remains separate. See the [Lambda service authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_lambda.html). A regression check protects the scope.

GitHub Actions ran successfully on the disposable CodeBuild checks runner using workflow dispatch: runs [36156423475](https://github.com/ejtbrown/quartermaster/actions/runs/36156423475), [36156948918](https://github.com/ejtbrown/quartermaster/actions/runs/36156948918) and [36157509255](https://github.com/ejtbrown/quartermaster/actions/runs/36157509255). Push/PR triggers remain configured, but automatic Actions runs on these agent pushes were not observed; do not claim that event path was verified. Automatic **CodePipeline** dev-push triggering was observed as `WebhookV2`; its build stage independently repeats all release checks, including browser tests.

Earlier failed execution evidence is retained; do not retry obsolete Free-plan or pre-fix artifacts. See `RUNBOOK_ROLLOUT.md` for rollback and scope boundaries. No account migration, production deployment, schema application, church-data intake, content purge or native-host configuration occurred.

## Successful release and independent live verification

- Automatic dev-push execution `3621db62-16ea-48e2-9699-900a86721dcb` succeeded through Source, VerifyAndBuild and DeployDevelopment for `194680f3c140dfd86c9c6b28fc17281a9be6c3df`. The live Lambda alias points to published version 2. The website is [qm.ejtbrown.com](https://qm.ejtbrown.com); the [health endpoint](https://qm.ejtbrown.com/api/health) reports the exact release SHA and `assetApiReady: false`.
- Pipeline validation passed formatting/types, 89 unit/domain/PostgreSQL/policy tests, two operations tests, nine Terraform mock tests, two Chromium tests, dependency audit, immutable packaging and deployment smoke checks. Failed setup attempts did not bypass any gate.
- Independent live checks passed: HTTPS 200, HTTP-to-HTTPS 301, health `no-store`, exact release SHA, security/CSP/HSTS headers, noindex, and `/api/assets` returning 404. All three deployed static files match local build SHA-256 hashes.
- Direct unsigned S3 `index.html` and Lambda health requests both return 403. Live edge preflight confirms the exact standard CloudFront/WAF resources, expected rate limit and absence of a flat-rate subscription association. CloudFront is Enabled/Deployed; origins remain private.
- Live Chromium desktop and 390-pixel viewport checks passed search, selection, the explicit sample-data/no-save notice, no horizontal overflow and no page-script errors. Screenshots were inspected and remain private under `.local/`. These are not actual iPhone/Android capture tests; camera/microphone remain denied on this preview.
- Fresh foundation and delivery Terraform plans found no changes after the infrastructure corrections. No SQL was sent and no database health keepalive was introduced.

Follow-up documentation publication may produce a later commit SHA through the same automatic pipeline without changing application behavior. Verify the health SHA against that execution before handoff; the execution above is the first successful functional-release baseline, not a promise that its SHA remains latest forever.

## Remaining scope

Next is the authenticated, online-only phone-to-desktop asset/photo workflow. Cognito, tenant membership/application credentials, schema deployment, CRUD/media capture, AI, expiry/purge workers, operational alarm wiring, budget attribution and tested regional recovery remain unfinished. Deletion metadata follows the backup horizon; its physical expiry worker is not deployed. Compliance holds are deferred, and deletion of content inside retained backups remains a real-data gate. Production requires church acceptance and its separate account.
