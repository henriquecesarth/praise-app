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
- Delivery 4 pending. D2-B is not complete.

## Delivery 4 execution (2026-11-09)

Verified worktree/branch/HEAD match the requested baseline. All initial tracked and untracked changes were preserved. No commit, staging, push, merge or deployment has been performed.

Actual independent agents: `/root/review_backend` (feature-reviewer, read-only), `/root/review_web` (feature-reviewer, read-only), `/root/real_integration` (isolated backend emulator harness/config), `/root/browser_acceptance` (Playwright specs/config and stale audit selectors). Root owns production corrections, regression tests and this plan. Effective model identity: Unknown / Not yet verified.

Proven defects corrected during acceptance:

- Indexed list projection omitted versions, notes and legacy resources.
- A song summary could open the editor while full detail was pending.
- Version mapping and no-op form saves normalized null/missing optional data and reconstructed resource identities.
- Free artist changes retained a stale catalog association; unchanged catalog associations now survive an unloaded artist catalog.
- Nested dialogs lacked keyboard containment/Escape and propagated backdrop clicks to the parent.
- Ministry changes left drafts open and pending saves could publish results in a different ministry.
- Dark unsaved badge selector did not match the actual theme class.
- Auth unit tests unintentionally queried Firestore through the unrelated account-deletion guard; the guard is now explicitly mocked in those unit tests.

Executed gates so far: full Web 39 suites / 732 tests PASS; focused post-review version form 9/9 PASS; backend repository/personal chord link 42/42 PASS; auth security 8/8 PASS; Backend TypeScript/build PASS; Web TypeScript/test-mode build PASS. Full logs for the final Web executions are in ignored `.logs/d2b-web-tests.log` and `.logs/d2b-web-build.log`.

Final Web independent static review PASS. Real emulator/API and complete browser acceptance are in progress; no real-persistence PASS is asserted here.
