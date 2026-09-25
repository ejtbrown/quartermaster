# Deferred native implementation boundary

Under [decision 0007](../../docs/decisions/0007-online-only-mobile-web.md), mobile field capture belongs in the shared responsive client at `apps/web`. The first release is online-only: no durable local draft/media/audio queue or background synchronization.

This directory is a deferred placeholder, not an active React Native application. Native builds, signing, stores and the SSH release coordinator are not launch prerequisites. The existing web preview remains synthetic; authenticated camera/voice capture is still implementation work, not an already-working feature.
