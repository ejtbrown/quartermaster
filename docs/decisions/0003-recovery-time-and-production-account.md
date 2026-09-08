# Recovery time and production account

Status: accepted

Decision date: 2026-09-07

Decision owner: Erick Brown

Source: Erick's confirmation of Q-031 and Q-032 following the [infrastructure and delivery decision](0002-regions-recovery-and-build-hosts.md).

## Decisions

- Q-031: A 24-hour recovery time after a regional disaster is acceptable. This accepts the proposed RTO; the separate preference for at most one day of data loss and tolerated seven-day ceiling remain unchanged.
- Q-032: Development/testing stays in the existing account selected by local AWS profile `default`. If the product is acceptable to the church, create a separate production AWS account and stand up production there. The production account is not needed to begin development.

## Design consequences

- Restore drills must measure elapsed recovery time and validate usable service, authentication, tenant isolation, and referenced media against the 24-hour target. Acceptance of the target is not evidence that recovery has already been tested.
- Retain the scale-to-zero, backup-and-restore design with no running disaster-recovery standby.
- Record church acceptance before production account bootstrap. Use shared Terraform modules with distinct account IDs, state, roles, resources, and environment configuration. Production account guards must reject the development account.
- Preserve development in its current account. Bootstrapping production is not an automatic migration of the whole project, a blanket copy of development data, or authorization to retire development resources. Any pilot-data transfer needs a scoped, validated cutover plan.
- The production account ID and credentials will be established during the later bootstrap workflow; these are execution inputs, not an unresolved account-topology choice. Per-account service eligibility and release checks remain required.

## Status and remaining work

The current [decision register](../../DESIGN.md#19-decision-register) contains 11 accepted decisions and 21 remaining questions (Q-010 through Q-030). Production domain, retention policy, mobile signing readiness, and the other affected release details remain open. No AWS account was created, application deployed, data migrated, or credential changed while recording this decision.
