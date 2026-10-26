# R4-M13 — Release blocker remediation

Status: COMPLETE for the local R4-M13 stage. Uncommitted patch; independent R4-M14 review is the next gate. No controlled CI authorization is implied.

Scope: R4-M12 findings only: deployed JWT fail-closed configuration; Web BPM type/omission preservation; bidirectional primary-version/legacy link synchronization; context-aware classification validation; read-only Preview CORS investigation. Existing `songs`, `users`, personal Smart Chords/link ownership, Firebase authentication and API route/RBAC contracts remain in place. No migration, Mobile/parser change, workflow change, commit, push, deployment or live database write.

Initial worktree: clean on `wip/repertoire-versions-smartchords-20261022`.

- [x] Read operating manual, memory, R4-M12 findings, relevant M20/R4-M11 plans and affected contracts/tests.
- [x] Enforce secure JWT configuration in deployed Preview/production; prove legacy-default token rejection and Firebase token compatibility using mocks.
- [x] Preserve BPM types/null/omission and omit unchanged editor values, including invalid legacy values.
- [x] Synchronize link representations for create/update/mixed/clear paths with persistence-equivalent tests.
- [x] Preserve unchanged orphan references in their original slots while rejecting new invalid and cross-tenant IDs.
- [x] Investigate exact Preview origin/allowlist via read-only checks; preserve strict CORS.
- [x] Run finite targeted regressions and Backend/Web builds; review diff and record actual results.

Link semantics: explicit primary links replace that link set; legacy scalar link fields patch their supported category; external_links replaces the external-link map; omitted fields preserve values. Mixed writes must agree for explicitly supplied categories or fail before persistence. Secondary links remain unchanged. Empty URLs/null scalars remove matching links. Compatibility projections derive from the resulting primary links.

Classification semantics: preserve missing IDs only when unchanged in the same pre-existing version (or same flat field); existing documents belonging to a different ministry always fail. New references must resolve in the current ministry. No cleanup of existing documents.

## Implementation and validation evidence

JWT: remotely deployed environments (including Preview even with NODE_ENV=development), production runtimes and explicit Preview mode reject missing, blank and publicly known development secrets. The configured secret is not transformed or rotated; JWT verification, Firebase ID-token authentication and production precedence remain unchanged. Isolated development/test without deployment flags remains available. New fixtures mock dotenv/Firebase and use no deployed secret values.

BPM: Web read/write mapping preserves number/string/null and omitted properties. Nonfinite numeric input is rejected before JSON can turn it into null. The song editor omits unchanged primary/secondary BPM values by stable version ID; the version editor retains the original value/type unless the BPM input changes. Explicit empty input clears; invalid explicit edits still fail validation. Backend update paths no longer manufacture null BPM or overwrite the flat BPM on version-name-only edits. Its BPM write schema remains strict and unchanged.

Links: a primary links array is an explicit replacement; flat scalar changes patch their supported category; external_links replaces the external map. Missing fields are preserved, including unspecified flat fields in inconsistent legacy documents. Mixed explicit representations must agree. Secondary links and custom identifiers/labels survive unrelated edits. Explicitly custom links (isCustom=true) retain external-map semantics even if their labels resemble standard categories. Ordinary Letra/“letras” links project to the legacy `letras` key. Create projections populate video/audio/chord compatibility fields, so YouTube list/search/indexed filtering reflects new saves. Removed create-schema external_links default injection to distinguish omission from explicit empty-map clear. No database migration or bulk repair.

Classifications: missing IDs are retained only in their original existing reference slots; new/moved IDs must resolve in the current ministry. Every effective existing document is still checked for a foreign ministry. Version-name-only edits do not clear flat orphan references in already inconsistent documents. No automatic cleanup.

Tests: added `jwt-preview-security.test.ts`, `repertoire.integrity.test.ts`, and `api.bpm-contract.test.tsx`; extended exact-origin CORS cases. Persistence doubles deep-clone reads and writes and never initialize a live Firebase connection. Initial broader regressions exposed two existing harness issues: auth-security.test.ts had not mocked account-deletion status and attempted an unavailable local emulator; its fixture now mocks that read and adds a positive deletion-blocking assertion. SongDetail's linked tabs can render before the effect activates the reader; its existing assertion now waits for the same rendered text. The unmodified-HEAD isolated test also passed, consistent with a timing issue; no SongDetail production code was changed. Early build checks also caught an unused test import and an implicit test parameter type; corrected.

Final Backend validation: **12 files / 286 tests PASS**, covering JWT config/forgery/Firebase compatibility, unified config, CORS HTTP pipeline, preview guards, repertoire versions/BPM/integrity/cursor, anti-IDOR, auth middleware/feature/preferences. Command from backend/: `npm test -- src/config/jwt-preview-security.test.ts src/config/unifiedConfig.test.ts src/config/cors.config.test.ts src/features/repertoire/repertoire.integrity.test.ts src/features/repertoire/repertoire.versions.test.ts src/features/repertoire/repertoire.bpm-contract.test.ts src/repositories/RepertoireRepository.test.ts src/repositories/idor-security.test.ts src/middleware/auth-security.test.ts src/middleware/preview-guard.test.ts src/features/auth/auth.feature.test.ts src/features/auth/user-preferences.test.ts --testTimeout=10000` (outer subprocess limit 120 seconds). HTTP cases required execution outside the sandbox to bind local ports. Final repertoire subset: 128 PASS.

Final Web validation: **4 files / 146 tests PASS**: `npm test -- src/api.test.ts src/api.bpm-contract.test.tsx src/components/SongCard.test.tsx src/components/SongDetail.test.tsx --testTimeout=10000` (outer limit 90 seconds). New BPM file: 66 PASS, rechecked after removing its unused import.

Backend `npm run build`: PASS (outer limit 120 seconds). Web `npm run build`: PASS (outer limit 120 seconds); existing Vite mixed-import/chunk-size warnings remain. `git diff --check`: PASS. No Flutter suite/APK or full Backend/Web suite run.

## Read-only operational findings

Exact Web Preview origin: `https://praise-app-m7tn-git-wip-repert-c49080-henriquecesarths-projects.vercel.app`, associated with Web deployment `dpl_FcrF4yyjwAF33ieiicWXRycXyDu9`. Canonical API Preview: `https://praise-app-git-wip-repertoire-1978b6-henriquecesarths-projects.vercel.app`.

Vercel metadata shows CORS_ORIGIN configured for both production and Preview, but the exact approved Web Preview origin is absent. No environment value or credential is recorded here. A read-only OPTIONS preflight to `/api/v1/auth/me` with that Origin, GET and authorization header returned HTTP 200 / Allow: GET, HEAD, without Access-Control-Allow-Origin or credential permission. This agrees with the intended strict allowlist implementation: **configuration mismatch**, not a CORS application bug. No CORS runtime change is needed. A separately authorized operator must add the exact origin to a Preview-scoped allowlist/override while preserving the production allowlist; do not authorize arbitrary Vercel subdomains. Browser revalidation remains pending that configuration action.

JWT_SECRET metadata includes Preview; whether its current value is nondefault is **Unknown / Not yet verified** (values not inspected). Ensure the existing secure setting reaches the future deployment; no rotation is needed when it is already secure, and none was performed.

Separate Vercel `backend` deployment `dpl_HhpHGDgKT7CHLcBStEhRnZHBDBTX` remains ERROR; its known fsPath adapter failure is an operational finding from R4-M12, outside application remediation. No project/target/workflow/environment setting was changed.

## Delivery gate

Ready for independent R4-M14 patch review. Controlled CI checkpoint/commit/push await that independent approval. No known remaining implementation blocker; pending operational CORS configuration and deployed end-to-end verification are explicitly separate. No source changes under Mobile, parser/import lifecycle, billing, WhatsApp, auth middleware/RBAC or deployment workflows. No live Firebase writes, releases, secrets changes, merges, commits or pushes.
