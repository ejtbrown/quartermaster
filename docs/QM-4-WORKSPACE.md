# QM-4 desktop estate workspace

Status: local implementation; not published or deployed. This document describes
source behavior with isolated browser verification, not completed real-device or live signed-in acceptance.

## User guide

Desktop entry opens Assets. On a phone-width viewport (639 CSS pixels or less),
people with asset-write permission start in Capture; read-only members start in
Assets. An explicit authorized section takes precedence. The experience is chosen
once when a workspace opens, so resizing or rotating does not replace active work.
Capture remains an explicit field workflow: sign-in never starts recording, reads
replies aloud, or asks for camera/microphone permission. Desktop entry does not
expose verbal capture. Existing mobile sessions survive a subsequent resize.

Use the sidebar's Everyday group for Assets, Maintenance and Locations. Planning
and Manage retain the existing insurance, incidents, accounting, reports, asset
types, rules, activity, team and settings tools, subject to existing permissions.
Mobile Quick navigation includes Assets so manual entry is always available.

Search and filters apply to the authorized collection on the server. Load more
extends the register; there is no client-only column sorting. Open an asset to see
Overview, Photos, Maintenance and Related records. Large displays show the register
and detail side by side; narrower displays dedicate the working area to detail.
Save confirms server completion; Cancel/Close protects genuinely unsaved work.
The URL carries section, workspace/asset identifiers, detail tab and applied filters,
not edited fields. Do not put confidential information in a search URL you share.
Back/Forward and closing detail are intended to restore list context and focus.
Unsent input remains in memory only; reload or closing the tab can lose it.

Locations shows named ancestor paths after the full location collection loads.
Follow a location to its exact-location asset filter. A site's assets do not include
its descendants automatically. After editing locations, use Refresh location
hierarchy to update the browser. Maintenance lists readable asset names and links
to that asset's Maintenance section.

Needs attention means exactly the `needs_attention` status. Retired, disposed and
out-of-service assets are not silently added to that count. Its shortcut clears
other filters so the results match the estate-wide count. Open/overdue maintenance
counts retain their separate meaning and existing UTC-date rule.

The register remains usable if summary or saved-draft loading fails. Failed asset
loading is distinct from an empty estate or a successful search with no matches.
Existing lost-acknowledgment retries, version conflicts, permission checks and
reauthentication remain in effect. Organization/identity changes clear the private
editor and reject URL context belonging to another workspace.

## Maintainer notes

- Base: `7e901893d3815436cf08e7ac9aafb5c65c213989` (QM-3). Approved artwork,
  fonts, semantic colors and favicon are unchanged.
- `navigation.tsx` centralizes entry choice, capability-filtered section parsing,
  workspace-scoped URLs, guarded history and focus/scroll restoration. No browser
  persistence, bearer-token changes, new cloud resources or background polling.
- `Workspace.tsx` retains the mounted register after first visiting it; auxiliary
  data loads independently. Asset detail is fetched by ID, including deep links to
  items outside the first list page. Refresh after a save restores the previously
  loaded page count.
- `LocationsBrowser.tsx` reads consecutive location pages before presenting the
  hierarchy. This is user-initiated by visiting Locations, with explicit refresh.
- `records.ts` adds `assetName` to tenant-scoped maintenance list results using the
  existing RLS context. `operations.ts` aligns attention summary SQL with its filter.
- Same-origin sign-in preserves a fragment destination. The retained compatibility
  callback still returns to `/`; it has not been replaced or weakened.
- Browser scenarios use the existing actual router/PGlite fixture and synthetic
  identities. No live customer data or live Cognito login is needed for them.

## Verification and remaining gates

Local type checking, web build, 162 Vitest tests and two Python operations tests
passed. The aggregate verification passed lint, types, tests and web build, then
stopped in the existing Linux-native worker packaging smoke: its packaged Sharp
modules do not load on macOS arm64. Packaging code was not changed to conceal this.
The repository check is run separately because the aggregate stops before it.

Playwright initially could not bind `127.0.0.1:4173` inside the sandbox
(`listen EPERM`). No approval reviewer denied the operation. The standard narrow
approval route subsequently permitted the unchanged loopback test configuration.
All **23 Chromium browser tests passed** with one worker, including 55-asset
pagination, 52-location hierarchy traversal, exact scroll/focus restoration,
repeated selection, guarded Back cancellation, mobile default and resize behavior,
read-only/organization isolation, expired-session retry, stale versions and lost
write acknowledgments. Desktop detail/register, mobile manual-entry and error-state
screenshots were inspected. Synthetic browser evidence does not replace real-device
or live signed-in acceptance, nor does it establish a measured five-second user
study result.

Public inspection on November 5 confirmed `/api/health` reports release
`7e901893d3815436cf08e7ac9aafb5c65c213989`. GET `/api/auth/login` returns 302 to
`/sign-in` (HEAD is unsupported and returns 404). The public app bundle initializes
its section to Assets, consistent with the inspected base. Remote `dev` still
points to that commit; no QM-4 branch exists remotely. Initial sandbox DNS failures
were resolved through the standard narrow read-only approval route, without sign-in
or customer-data access.

The reported live desktop-to-verbal entry still has **not** been reproduced or
explained in a signed-in session. Signed-in live acceptance needs separate
authorization. Publication, PR, merge, deployment, infrastructure, credentials/access
and customer-data testing remain outside this local implementation approval.
