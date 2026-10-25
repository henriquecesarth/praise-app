# R4-M5 — Schedule parity

Status: in progress.

Scope: visible palette swatches; deterministic positional song slots under the existing backend timeline schema; PWA-style scrolling detail sections; full-screen comments-backed chat; focused regression tests and WIP CI. No APK, production or database operations.

Contract: timeline persists only id/title/time/type. Use type Música and slot order, never unsupported songId fields. Resolve only numbered legacy placeholders or unique matching positional titles. Preserve customized titles and all non-song events. Viewing never writes.

Steps:
- [x] Inspect PWA, Mobile, backend schemas, tests and workflows.
- [ ] Implement synchronization, detail and chat.
- [ ] Add focused Mobile/PWA tests; static review.
- [ ] Commit/push WIP; inspect analyze and focused test CI; fix failures.

Validation: local Flutter unavailable on macOS 12; use existing remote validation workflow without APK. PWA build/tests locally where available.

Screenshots: not present in this conversation; actual PWA source is the visual reference.
