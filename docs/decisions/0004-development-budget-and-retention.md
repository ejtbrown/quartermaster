# Development budget, retention, and domain

Status: accepted constraints; purge details pending clarification

Decision date: 2026-09-07

Decision owner: Erick Brown

Follow-up: [decision 0005](0005-resized-photo-retention-and-development-deployment.md) answers the photo-retention and alert-recipient questions below and authorizes development deployment. The original decision text is retained for history; only backup-purge and the other noted Q-014 details remain unresolved.

## Accepted constraints

- Development spending envelope: USD 100 per month for Quartermaster development, not unrelated resources in the shared account. The implementation uses actual alerts at 50/80/100% and forecast alerts at 80/100% to fit the five-notification limit; the recipient address still needs to be supplied. Budget notifications are not a guaranteed billing cap.
- Original uploads and transcripts: 15 days. Audit records: one year. Backups: three months. The implementation initially expresses backup retention as 90 days, with this convention explicit in configuration.
- Deleting an asset or tenant purges the underlying data while retaining minimal metadata including the deletion timestamp. Retained tombstones must not embed the deleted names, descriptions, transcripts, photos, or financial values.
- Development DNS and email domain: `qm.ejtbrown.com`, replacing the previous development hostname. Production remains undecided. A domain is not an alert recipient or a configured mailbox.
- Begin building the development foundation. Production remains gated on church acceptance and a separate account.

## Questions that do not block scaffolding

- May resized asset photos remain after original uploads expire, or do all photo versions expire at 15 days?
- May deleted content remain in isolated backups until their retention expires, with deletion replay mandatory before a restore serves users, or must it immediately become unrecoverable there too?
- What address receives budget and operational alerts?

Destructive cleanup is not enabled until the photo/backup semantics are confirmed. Retention deadlines are enforced at access boundaries when the corresponding stores are implemented; eventual storage cleanup must not be confused with timely denial of access. Persist deletion metadata independently of the restored data and replay it before recovery acceptance. Retained metadata duration, exceptional holds, and other Q-014 details remain open; do not use an unspecified hold to silently ignore a deletion.

## Implementation implications

Aurora native PITR covers at most 35 days, so three-month recovery needs retained snapshots or another backup mechanism beyond PITR. Retaining a snapshot for 90 days does not make its recovery point 90 days old: continue targeting a newest completed point within 24 hours and restore within 24 hours. The longer retention changes billable backup bytes; the old small-data example is not a budget guarantee.

Sources checked 2026-09-07: [Aurora backup retention](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Backups.html), [AWS Budgets notification limitations](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).
