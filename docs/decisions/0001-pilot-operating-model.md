# Pilot operating model

Status: accepted

Decision date: 2026-09-06

Decision owner: Erick Brown

Source: Erick Brown's explicit answers to Q-001 through Q-004.

## Decisions

- Q-001: Erick Brown initially operates Quartermaster, is its designated data controller, and provides support. If the venture proves viable, he intends to incorporate an LLC and transfer the service to it. Each church has controls over its own data. Privacy and compliance are first-class requirements from the pilot onward.
- Q-002: Quartermaster is a multi-tenant SaaS offering. It starts with one church tenant and supports additional churches later using the same architecture.
- Q-003: The pilot focuses on air conditioners and appliances. More asset classes will be added incrementally. Versioned schemas and capture templates support this expansion; Erick owns product scope and may delegate template authoring.
- Q-004: Physical-work safety is the domain of the humans performing and supervising the work, who are the intended bearers of responsibility and liability for safe work. AI may remind them of safety concerns and record their observations. It does not decide that a task is safe, certify competence, or approve physical procedures. This records the intended operating policy; it does not determine the enforceability of liability terms.

## Design consequences

- Tenant isolation is present from the first release and tested with at least two synthetic tenants, even while only one church uses production.
- Church administrators control memberships, permissions, records, exports, data-lifecycle requests, and temporary support access under the service's supported policies.
- Erick's support access is scoped, time-limited, and audited. Service identity and privacy/support contacts are configurable to support a future LLC transfer without changing tenant IDs or rewriting historical audit actors.
- Privacy documentation maps the actual purposes and parties for church-directed and service-owned processing. Naming the operator does not replace that work or waive tenant controls.
- New asset classes reuse the common asset record and versioned schemas, prompts, image intents, and measurement definitions. Existing records retain their original schema version.
- Measurements and photographs can be skipped. The assistant accepts human-provided readings without requiring platform verification of trade qualifications and respects church-configured restrictions. Standard reminders are reviewed and versioned; generated hazardous procedures and claims of safety certification are outside the assistant's scope.

## Superseded assumptions

The initial operator, SaaS model, and pilot classes are no longer unresolved. The earlier requirement for Quartermaster to verify worker qualifications and approve physical-work procedures before recording readings is superseded by human responsibility with advisory AI reminders.

## Remaining work

Q-005 through Q-030 remain open in [the design register](../../DESIGN.md#192-remaining-questions). In particular, naming the operator does not settle retention, residency, consent, support hours, or the wording of customer terms. The actual pilot contains one church; workload estimates still need owner-approved user, asset, media, and voice volumes.

Subsequent update, 2026-09-07: Q-005 through Q-009 were accepted in [the infrastructure and build-host decision](0002-regions-recovery-and-build-hosts.md). The paragraph above records what remained open when this decision was accepted; the current status is in the design register.
