# 0007 — Online-only mobile web

Date: 2026-09-25

Status: accepted

Decision owner: Erick Brown

## Decision

Use one responsive React web application for mobile field capture and desktop estate management. Defer native iOS/Android applications and their build, signing, store, and distribution workflows. Home Screen installation may be offered for convenience; it is optional and does not imply offline support.

The first release requires connectivity. Offline asset viewing, field capture, durable local drafts/media/audio, background synchronization, and offline conflict reconciliation are out of scope. The owner judged their complexity disproportionate to the expected need. Reintroducing offline support requires a new design decision, not an incremental acceptance requirement for this release.

This closes Q-013 and supersedes the native framework/local-storage portion of Q-025 and the native build requirements in Q-009/decision 0002. Public GitHub, CodeBuild-hosted GitHub Actions, CodePipeline, and the dev/main environment mapping are unchanged. Existing `mac-dev` and `linux-dev` hosts remain available; no host configuration, credentials, or resources are removed by this decision.

## Implementation consequences

- Implement both screen-size experiences in `apps/web`. Keep `apps/mobile` only as a deferred placeholder; no separate native release is a launch prerequisite.
- Require a live service connection for application operations. Show loss of connectivity, pause voice/capture, and offer an explicit retry after connection returns. Connectivity indicators are advisory; a successful server response is the authority for saving.
- Keep current-tab unsent input only in memory on a best-effort basis. Warn that reload, tab termination, or device restart can lose it. Do not promise recovery across an outage. Do not introduce a local asset database, durable upload/mutation queue, deferred audio, or an offline-serving service worker.
- Ordinary HTTP caching of public versioned JavaScript/CSS is fine; it is not an offline product. Do not persist tenant records, transcripts, media, or authenticated API responses in browser application caches. A user-selected source photo may independently remain in the user's device photo library; Quartermaster neither relies on nor manages that external copy.
- Distinguish unsaved input, a server-saved draft, pending media processing, and a committed asset. Only acknowledge each state after its server operation succeeds. Durable server-saved drafts use the recovery-protected data store; ephemeral conversation state is not a saved-record guarantee.
- Retain mutation idempotency, optimistic concurrency, bounded foreground retries, upload completion verification, and server-side queues/outbox recovery. A lost response must not cause duplicate assets or media on retry. These controls remain necessary without offline synchronization.
- Run voice and camera workflows in the foreground with explicit permission and touch/keyboard fallbacks. Browser speech output is an engineering default subject to real-device quality and privacy testing, not a promise of on-device-only synthesis. Use the approved cloud transcription path, not uncontrolled browser speech-recognition services.
- Use the existing server-side web session design; do not introduce native keychain storage or browser-persisted bearer tokens. Enable camera/microphone permissions and necessary CSP/CORS destinations only with the authenticated capture implementation, not on the synthetic preview.

## Delivery order and evidence

1. Publish reviewed delivery changes and finish GitHub → CodeBuild/CodePipeline deployment of the synthetic dev website and health-only API. Verify the deployed commit, HTTPS, WAF, and denied direct-origin access. No further product decision blocks this preview.
2. Deliver one non-AI vertical slice: sign in, resolve tenant permissions, create a location/asset, upload a photo, generate a resized image, save and audit the record, then find/edit it from the desktop register. Implement retention/purge and the operational controls needed before accepting real church data.
3. Add foreground voice, image classification/nameplate extraction, confirmation, and the transactional air-conditioner workflow. Test on actual iPhone Safari and Android Chrome, not just desktop viewport emulation.
4. Exercise permission denial, interrupted uploads, ambiguous save responses, expired sessions, conflicting edits, screen lock/tab switching, and loss/recovery of connectivity. Verify no false saved state or duplicate committed record. Process-death recovery of unsent input is explicitly not required.
5. Run the church pilot after the real-data gates pass; create the separate production account only after church acceptance.

The browser support floor and detailed UX are implementation choices to validate with pilot devices. Remaining product-policy gates before real data include deletion inside retained backups, deletion-metadata duration, and exceptional holds. This decision does not resolve those policies or claim that authentication, camera, voice, retention workers, or public delivery are already deployed. See [implementation status](../IMPLEMENTATION.md).
