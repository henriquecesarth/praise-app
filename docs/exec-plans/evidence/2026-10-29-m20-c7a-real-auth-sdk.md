# M20-C7A checkpoint - 2026-10-29

STATUS = BLOCKED; SECURITY GATE = NOT APPROVED. Branch `feat/m20-phase-2a-android-share`, HEAD `e3c4902e0d8786e164ea0686486c564f9dea1578`. Existing WIP preserved; no production auth source was edited in C7A.

## Real Firebase Android SDK results

Device: Lenovo TB-J616F `REDACTED_DEVICE_IDENTIFIER`; Firebase Auth/Firestore emulators and isolated backend used project `demo-m20-c1` only. See ignored logs in `mobile/build/m20-c7a/`.

- PASS: normal login; actual Authorization token `sub` equals Firebase SDK UID and backend `/auth/me` UID; session generation bound/stable.
- PASS: delayed login then logout; delayed signup then logout; A pending then B login. SDK, repository and notifier end at the expected null/B identities.
- PASS: real SDK token refresh A delayed through B login; old result rejected, B retained.
- PASS: controlled 401 causes real token refresh during A-to-B switch; stale request is not retried under B and does not invoke B logout.
- PASS: delayed `/auth/me` response after logout; interceptor error counter advances specifically and no stale profile is accepted.
- PASS (controlled transport cancellation): inject one `SESSION_CHANGED` transport cancellation with real SDK user B active; bootstrap recovers in exactly two profile attempts and retains B.
- PASS: physical Android `ACTION_SEND` reaches the app and is pending before authentication (`share-device-test2.log`, marker `M20_C7A_SHARE_HELD_PRE_LOGIN=PASS`).
- FAIL (reproduced twice): after that Share, login sets Firebase SDK UID but app `/auth/me` fails before HTTP response with `CircularDependencyError`, status absent, normalized `NETWORK_ERROR`; notifier remains `bootstrapError`, ministry remains `initializing`, and no import dispatch occurs. Logs `share-device-test.log`, `share-device-test2.log`.
- NOT EXECUTED: no successful Share -> login -> empty ministry -> import dispatch; no final test of the last harness edit. The worker proposed overriding `authRepositoryProvider` and `apiClientProvider` with explicit real instances after the observed circular dependency. This edit is un-analyzed and un-run. Root cause (test wiring or production app path): **Unknown / Not yet verified**.

The C7 production security correction remains present and unchanged: latest auth intent fences/serializes Firebase SDK mutations; logout invalidates session immediately; UID and generation fence profile/token results; interceptor discards old responses and does not log out a later B session. The physical tests give PASS evidence for those exercised cases. Full M20-C7A acceptance is not safe to declare while the app Share/login bootstrap fails.

## Changed in this C7A task

- `mobile/integration_test/m20_c7a_auth_sdk_test.dart` (untracked): new physical SDK scenarios; latest provider-wiring edit is unverified.
- `mobile/tool/m20_c7a_auth_proxy.mjs` (local test helper; inspect `git status`/ignore rules on handoff).
- `docs/exec-plans/active/2026-10-29-m20-c7a-real-auth-sdk.md`.
- This checkpoint.
- All pre-existing WIP remains; do not treat cumulative git diff as C7A-only. No commit/push/merge/deploy.

## Cleanup and handoff

Auth emulator, Firestore emulator, local backend and response proxy were stopped. Listener check: ports 9099, 8080, 3107, 19098 clear. Temporary ADB reverse mappings for 9099, 3107 and 19098 removed; pre-existing `gnirehtet tcp:31416` preserved. Device configuration was not changed. `git diff --check` exit 0. Logs are retained under ignored `mobile/build/m20-c7a/`.

Gemini handoff: start with this checkpoint and `share-device-test2.log`; preserve branch and WIP. First inspect/fix or disprove the `/auth/me` `CircularDependencyError` in the Share test provider graph without assuming production is secure or insecure. Then analyze the last unverified harness wiring, rerun only the Share physical scenario on local demo emulators, and obtain empty-ministry dispatch evidence. Re-run no passed SDK race tests unless relevant source changes. Staging/deploy remains outside this checkpoint and unexecuted.
