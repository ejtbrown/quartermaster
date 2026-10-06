# 0008 — Deletion metadata follows the backup horizon

Date: 2026-09-25

Status: accepted

Decision owner: Erick Brown

Retain minimal, content-free deletion metadata for the backup horizon: currently 90 days after deletion, matching the accepted three-month backup convention. Retain the deletion timestamp and opaque identifiers needed to prevent deleted content from reappearing during restore. Do not retain the deleted asset/photo/transcript payload in this metadata. This governs purge/recovery tombstones; the separately accepted one-year, content-free audit-event policy is unchanged.

The implementation must use the configured backup horizon, not an unrelated indefinite tombstone policy. Before expiring a deletion marker, verify that no restore-eligible copy predating that deletion remains. If the recovery horizon is extended, reconcile marker retention before enabling those longer-lived copies. This protects deletion replay; it is not a new compliance-hold policy.

October 6 clarification accepted by Erick Brown: retained backups may keep inaccessible copies until their scheduled expiry, up to 90 days. Restore into isolation and replay the independent deletion ledger before permitting access. Purge live records, related photos and cached export copies through retryable cleanup; preserve only content-free recovery markers and the separately governed audit events. Immediate erasure from every retained backup is not required. Compliance/exceptional holds remain explicitly deferred.

The owner explicitly authorized completion of Step 1: publish the reviewed development source and deploy the synthetic web preview and health-only API through GitHub → CodeBuild/CodePipeline at `qm.ejtbrown.com`, validating exact-commit release, HTTPS, WAF and denied direct-origin access. Authentication, real church data, AI, native applications, and production are outside this deployment increment.
