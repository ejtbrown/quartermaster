# Regions, recovery, accounts, and build hosts

Status: accepted

Decision date: 2026-09-07

Decision owner: Erick Brown

Source: Erick's answers to Q-005 through Q-009. This extends the [pilot operating model](0001-pilot-operating-model.md).

## Decisions

- Q-005: Processing may happen in approved regions. Use `us-east-2` immediately; `us-east-1` and `us-west-2` are also approved when needed. Ohio is the regional workload default. Inference profiles must route only within the approved set; no global profile is implied.
- Q-006: 99.5% uptime and a 60-second cold start are acceptable. Prefer no more than one day of lost data if costs remain modest; a week is tolerable. Use backup/restore and retain scale-to-zero. Recovery duration is a separate unanswered detail, Q-031; the prior 24-hour RTO is still only a default.
- Q-007: The local `default` AWS profile reaches the account to use for development/testing. The project may move accounts later, so Terraform management, stable project/environment tags, and parameterized references are essential. Production account placement is separately tracked in Q-032.
- Q-008: GitHub Actions checks use CodeBuild runners, and CodePipeline orchestrates cloud builds/deployments through the same repository scripts. `dev` deploys development and `main` deploys production.
- Q-009: The repository is public. `mac-dev` is the local SSH alias for iOS build/signing; `linux-dev` is the alias for Ubuntu Android build/test work. Mobile work uses these existing machines through a trusted coordinator; public-PR jobs do not execute on them.

## Design consequences

- Keep workload and data defaults in Ohio, with explicit provider aliases for approved regional exceptions. Query model destination lists and assert that they are a subset of the approved regions.
- Prefer a recoverable point no older than 24 hours, including metadata and referenced media. Use native Aurora PITR/snapshots, copies to a configurable approved backup region, S3 versioned evidence copies, and measured recovery-point age. A 12-hour snapshot/copy cadence provides room for completion and retries. Seven days of retention is an initial engineering setting under Q-014; seven days of tolerated data loss does not mean the routine backup cadence should be weekly.
- Recovery uses no warm cross-region compute. Backup storage, changed-byte transfer, request charges, and restore drills remain explicit costs. Start with Oregon as the proposed secondary location and price it; using another approved region is a configuration choice.
- The default profile is used only by local bootstrap/development tooling. Record and check the target account ID in protected environment configuration; CI assumes dedicated roles. Production and dev always have separate state and resources, whether eventually placed in one account or different accounts.
- Required tags include Application, Environment, Owner, CostCenter, DataClass, and ManagedBy. A future move is a target-stack deployment plus data/identity/artifact migration and cutover. Merely changing provider credentials or Terraform state ownership does not move resources.
- The trusted mobile coordinator runs on this development host, pulls CodePipeline custom-action jobs over outbound HTTPS, and reaches the two local machines by SSH. It dispatches reviewed immutable commits, verifies artifact provenance/checksums, and reports job completion. AWS does not need inbound access to the LAN. Hosts may be offline between releases without affecting the cloud application.
- Public PRs run in disposable CodeBuild jobs with restricted permissions, no signing/deploy secrets, and no LAN access. Persistent mobile hosts are not general-purpose public-repository runners.

## Read-only evidence on 2026-09-07

- `default` profile authentication succeeded; its configured region is `us-east-2`. Account IDs and credential material are intentionally kept out of this public design record.
- GitHub reports `ejtbrown/quartermaster` as PUBLIC; no visibility change was necessary.
- `mac-dev` answered over SSH and reports Xcode 26.1.1. `linux-dev` answered over SSH with Java 17 and Node on its command path. Node was not found on the Mac's noninteractive SSH command path; Android SDK tools were not found on the Linux host's command path. These are readiness checks, not conclusions that the tools cannot be installed elsewhere.
- The Ohio Nova 2 Lite US inference profile is ACTIVE and lists `us-east-1`, `us-east-2`, and `us-west-2` destinations. No inference was invoked.
- Aurora PostgreSQL `db.serverless` offerings were returned in Ohio. Engine pinning and auto-pause/Data API integration remain implementation checks.
- The AWS Price List Query API confirmed Ohio core Aurora and Secrets Manager rates, Oregon Aurora backup/S3 storage rates, and Ohio-to-Oregon transfer rates; see [the cost model](../../cost_model.md).

## Remaining details

The original Q-010 through Q-030 remain open. Q-031 asks for disaster recovery time; Q-032 asks for the production account. Signing identities/store credentials, pinned host toolchains, backup retention and budget, and the final production domain remain implementation or release work. No account migration, deployment, host configuration, signing operation, or repository publication was performed as part of recording these decisions.

Subsequent update, 2026-09-07: Erick accepted Q-031/Q-032 in [the recovery-time and production-account decision](0003-recovery-time-and-production-account.md). The accepted RTO is 24 hours; development stays in the existing account, and a separate production account will be created if the church accepts the product. Earlier references in this record preserve what remained open when Q-005 through Q-009 were accepted.

Sources: [Nova model regions](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html), [Aurora auto-pause and snapshot behavior](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html), [CodePipeline custom action workers](https://docs.aws.amazon.com/codepipeline/latest/userguide/actions-create-custom-action.html), and [GitHub runner security](https://docs.github.com/en/actions/reference/security/secure-use).
