# D2-B repertoire redesign

Branch: `feature/d2-b-repertorio-20261109`.
Base: `94254e051b8b07276a99fe11617b64f9ed4ac4e2` (approved P1-P8/D2-A checkpoint).
Original integration worktree remains clean. No push, merge or deploy authorized.

## Deliveries

1. Responsive library: compact rows, existing tabs, 300 ms search, key/YouTube/classification filters, loading/empty/error states and administrative RBAC.
2. Song detail: compact header, unified musical controls, existing versions and personal chords, active-version resources.
3. Create/edit: structured sticky forms, safe version clone/delete, exact preservation of optional fields and IDs.
4. Functional and visual acceptance across desktop/mobile and light/dark.

## Ownership and contracts

- `/root`: App.tsx, repertoire.css, plan and verification orchestration.
- `/root/hotfix`: SongCard.tsx, SongCard.css and focused component tests.
- `/root/browser_hotfix`: isolated browser spec/config.
- `/root/d2_architecture`: read-only architecture; completed.
- `/root/checkpoint_review`: independent read-only review.

API and storage contracts unchanged. Version index zero remains the existing primary-version convention. No personal chord availability is inferred from ministry song data: the list has no verified ownership-aware availability projection. External chord links remain distinguishable from personal chords. Classification filtering uses the existing classification_id API parameter.

## Status

- Delivery 1 validated (7/7 focused tests PASS, 37 suites / 716 web unit tests PASS, test-mode build PASS, mobile/responsive E2E audit 8/8 PASS on 320x568-light & 390x844-dark, independent feature-reviewer PASS).
- Delivery 2 validated (`SongDetail.tsx` compact stage header, unified Music Stand Bar with version selector & reading/transposition/personal Smart Chord controls, 2.2fr/1fr asymmetric musical sheet & version sidebar, 6/6 focused `SongDetail.test.tsx` PASS, 38 suites / 722 web unit tests PASS, test-mode build PASS, Playwright desktop/mobile light/dark E2E `d2-b-repertorio.spec.ts` 2/2 PASS + `mobile-audit.spec.ts` 8/8 PASS, independent feature-reviewer PASS).
- Delivery 3 implemented (`CreateSongModal.tsx`, `VersionEditModal.tsx`, `SongFormModal.tsx`, `web/src/api.ts`, `backend/src/features/repertoire/repertoire.types.ts`, `backend/src/repositories/RepertoireRepository.ts`, `CreateSongModal.test.tsx` 6/6 PASS, `RepertoireRepository.test.ts` 14/14 PASS, 39 suites / 728 web unit tests PASS, test-mode build PASS).
- Delivery 4 validated (provisional checkpoint `016cd85f7d99bf80a045cb70d8031751bfda7529`, real Express + Firestore Emulator acceptance `scripts/d2b-repertoire-emulator.ts` `D2-B_REPERTOIRE_EMULATOR_ACCEPTANCE_PASS`, real-API Playwright browser E2E `d2-b-repertorio-real-api.spec.ts` 1/1 PASS with 24 visual acceptance screenshots across `1440x900`, `390x844`, `320x568` in light/dark, Playwright E2E `d2-b-repertorio.spec.ts` 48/48 PASS, `mobile-audit.spec.ts` 10/10 PASS, Web unit suite 39 suites / 732 tests PASS, Backend unit suites 3 suites / 50 tests PASS, Web & Backend builds PASS, independent `feature-reviewer` PASS).

## Delivery 4 execution (2026-11-09)

Verified worktree/branch/HEAD match the requested baseline. Created local provisional checkpoint commit `016cd85f7d99bf80a045cb70d8031751bfda7529` (`wip(d2-b): preserve deliveries 1-3 before final acceptance`) after security/secret audit. No push, merge or deployment has been performed.

Actual independent agents: `/root/review_backend` (feature-reviewer, read-only), `/root/review_web` (feature-reviewer, read-only), `/root/real_integration` (isolated backend emulator harness/config), `/root/browser_acceptance` (Playwright specs/config and stale audit selectors), and `feature-reviewer` (`19cb15bb-e83f-4650-b20c-a77e84433984`). Root owns production corrections, regression tests and this plan.

Proven defects corrected during acceptance:

- Indexed list projection omitted versions, notes and legacy resources.
- A song summary could open the editor while full detail was pending.
- Version mapping and no-op form saves normalized null/missing optional data and reconstructed resource identities.
- Free artist changes retained a stale catalog association; unchanged catalog associations now survive an unloaded artist catalog.
- Nested dialogs lacked keyboard containment/Escape and propagated backdrop clicks to the parent.
- Ministry changes left drafts open and pending saves could publish results in a different ministry.
- Dark unsaved badge selector did not match the actual theme class.
- Auth unit tests unintentionally queried Firestore through the unrelated account-deletion guard; the guard is now explicitly mocked in those unit tests.
- Mobile sticky modal footer specificity (`.modal-content.song-form-modal .repertoire-modal-footer`) and dialog role selectors (`getByRole('dialog')`) in `web/e2e/d2-b-repertorio-real-api.spec.ts` were aligned for full-width mobile rendering and unambiguous dialog assertions.

Executed gates:

- Real Express Backend + Firestore Emulator (`127.0.0.1:8186`) + Auth Emulator (`127.0.0.1:9098`): `npx tsx scripts/d2b-repertoire-emulator.ts` -> `D2-B_REPERTOIRE_EMULATOR_ACCEPTANCE_PASS` (multi-version CRUD, independent version edit/clone/delete, `versions` absent vs `[]`, legacy `chord_sheet_url`/`youtube_url`, anti-IDOR foreign classification 404, member RBAC 403/200, cross-ministry isolation 404, unauthenticated 401, ownership mass-assignment rejection, personal `smart_chords` privacy isolation).
- Real-API Playwright browser E2E (`npx playwright test e2e/d2-b-repertorio-real-api.spec.ts --config playwright.d2b-real.config.ts` against `http://127.0.0.1:4317/api/v1` + Firestore Emulator): 1/1 PASS, generating 24 visual acceptance screenshots in `web/test-results/d2-b-repertorio/` across `1440x900`, `390x844`, and `320x568` in light and dark modes.
- Playwright responsive E2E suites: `e2e/d2-b-repertorio.spec.ts` 48/48 PASS across all 12 viewport/theme projects; `e2e/mobile-audit.spec.ts` 10/10 PASS (`320x568-light` and `390x844-dark`).
- Full Web unit suite: 39 suites / 732 tests PASS; Web `tsc --noEmit` and `vite build --mode test` PASS.
- Backend unit suites & build: `RepertoireRepository.test.ts` (14/14), `smart_chord_repertoire_link.test.ts` (28/28), `auth-security.test.ts` (8/8) -> 50/50 PASS; `npm run build` (`tsc -p tsconfig.publish.json`) PASS.
