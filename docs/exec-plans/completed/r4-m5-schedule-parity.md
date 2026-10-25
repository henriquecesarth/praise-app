# R4-M5 — Schedule parity

Status: complete.

Scope: visible palette swatches; deterministic positional song slots under the existing backend timeline schema; PWA-style scrolling detail sections; full-screen comments-backed chat; focused regression tests and WIP CI. No APK, production or database operations.

Contract: timeline persists only id/title/time/type. Use type Música and slot order, never unsupported songId fields. Resolve only numbered legacy placeholders or unique matching positional titles. Preserve customized titles and all non-song events. Viewing never writes.

Steps:
- [x] Inspect PWA, Mobile, backend schemas, tests and workflows.
- [x] Implement synchronization, detail and chat.
- [x] Add focused Mobile/PWA tests; static review.
- [x] Commit/push WIP; inspect analyze and focused test CI; fix failures.

Validation: local Flutter unavailable on macOS 12; use existing remote validation workflow without APK. PWA build/tests locally where available.

Screenshots: not present in this conversation; actual PWA source is the visual reference.

Implementation notes:
- Shared positional resolution rules in Mobile/PWA; legacy display is read-only. Unknown/customized song-slot titles are retained and not linked. Untouched slots added during the current draft are removed when their songs are undone; persisted/template slots survive removal.
- Full-screen chat uses a separate auto-disposed CommentsNotifier keyed by ministry/schedule/user, existing REST methods, chronological bubbles, explicit refresh and post-success refresh. User/tenant changes hide the screen and discard pending replies. Refresh cannot invalidate an in-flight send.
- Hero and large scrolling sections replace detail tabs only. Creation/edit tabs remain intact. Palette/clothing swatches preserve existing values and outline light colors.
- Checked out base was ci/r4-m5-mobile-validation-20261025 at 0a26926; preserved that existing work and integrated remote WIP commits before pushing only WIP. APK workflows remain manual or scoped to the separate CI branch; no APK build triggered.

Validation so far:
- PWA build: PASS (existing bundle/dynamic-import warnings).
- PWA focused component/helper tests: 9 PASS (existing component tests emit failed optional GET warnings under sandbox; no live writes).
- Final remote Flutter analyze: PASS, no issues. Focused tests (schedules, repertoire, Smart Chords, auth, core, Preview): 519 PASS, zero failures at 1f8ce596c4de27cc7f03be3a4321a8d8c6f2d191. Run https://github.com/henriquecesarth/praise-app/actions/runs/40193418867 .
- Concrete CI corrections: nullable test label and analyzer style/import; preserve pristine state after undoing song addition; scope duplicate UI labels; translate legacy event types; mutable test repository fixture after a failed send; select disabled IconButton directly instead of RawTooltip.

Limits: no physical Android validation, screenshots not attached in this conversation. Existing comments API returns the newest page (default 50); badge reports available message count, not an authoritative all-history total. No realtime delivery or new persistence fields/collections.

Outcome: visible stored palette colors; synchronized persisted positional song slots in Mobile/PWA; safe legacy resolution and repertoire navigation; large scrolling detail sections with connected timeline; full-screen internal comments chat with send/refresh/concurrency/session protections. Added 12 focused Mobile cases and 3 PWA cases, while preserving and adapting existing regression assertions. `git diff --check` passes. No APK, production deployment, or live database writes.
