# Resized photo retention and development deployment

Status: accepted

Decision date: 2026-09-07

Decision owner: Erick Brown

- Keep resized asset photos without an age-based expiry while the user wants them and their asset exists. Explicit photo deletion, asset purge, or tenant purge removes the photos, including stored versions. Original uploads and transcripts still expire after 15 days.
- Resized photos must be separate from the `originals/` namespace. Their recovery copies are necessary: expired originals cannot regenerate them. Model their storage by the number and size of retained photos, not a 15-day rolling window.
- The operator supplied the budget/operations email recipient. Keep its value in protected environment configuration rather than publishing the personal address in this public repository. An SNS email subscription still requires the recipient to confirm it.
- Deploy the ready development foundation in the existing, verified account in `us-east-2`. This is not authorization to deploy production or admit real customer data through unfinished privacy and authentication paths.
- Purge behavior within retained backups remains unresolved. Physical media cleanup stays disabled pending that decision and implementation of version-aware purge. This does not block an empty development foundation.

This supplements decision 0004, answering its photo-retention and alert-recipient questions. Remaining Q-014 items include backup purge, tombstone retention duration, and exceptional holds.
