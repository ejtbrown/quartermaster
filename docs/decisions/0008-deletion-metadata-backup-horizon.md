# 0008 — Deletion metadata follows the backup horizon

Date: 2026-09-25

Status: accepted

Decision owner: Erick Brown

Retain minimal, content-free deletion metadata for the backup horizon: currently 90 days after deletion, matching the accepted three-month backup convention. Retain the deletion timestamp and opaque identifiers needed to prevent deleted content from reappearing during restore. Do not retain the deleted asset/photo/transcript payload in this metadata. This governs purge/recovery tombstones; the separately accepted one-year, content-free audit-event policy is unchanged.

The implementation must use the configured backup horizon, not an unrelated indefinite tombstone policy. Before expiring a deletion marker, verify that no restore-eligible copy predating that deletion remains. If the recovery horizon is extended, reconcile marker retention before enabling those longer-lived copies. This protects deletion replay; it is not a new compliance-hold policy.

Compliance/exceptional holds remain an explicitly deferred design question. This decision does not settle whether deleted content may remain inaccessible inside retained backups until their normal expiry or must become immediately unrecoverable there. That question remains a real-data gate, not a blocker for the synthetic preview.

The owner explicitly authorized completion of Step 1: publish the reviewed development source and deploy the synthetic web preview and health-only API through GitHub → CodeBuild/CodePipeline at `qm.ejtbrown.com`, validating exact-commit release, HTTPS, WAF and denied direct-origin access. Authentication, real church data, AI, native applications, and production are outside this deployment increment.
