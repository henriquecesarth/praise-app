# Mobile Horizontal Overflow Audit

## Objective

Guarantee, with browser evidence, that public and authenticated Praise App screens fit between 320 px and 430 px without document-level horizontal scrolling or clipped functional content. Deliberately scrollable local containers are allowed only when they do not expand the document.

## Scope

- Audit the six requested viewports: 320x568, 360x800, 375x812, 390x844, 412x915, and 430x932.
- Exercise light and dark themes on the most important public/authenticated journeys.
- Cover repertoire lists/details/forms, folders, artists, Smart Chords, schedules/history/detail/editor tabs/chat/liturgy, ministry subsections, account/ministry menus, and their reachable modals.
- Test loading, empty, error, populated, and deliberately long-string fixtures where the active UI exposes those states.
- Change only web layout/tests and directly affected documentation. Backend/domain contracts remain out of scope.

## Implementation Plan

- [x] Expand the Playwright viewport matrix to all six requested dimensions (320x568, 360x800, 375x812, 390x844, 412x915, 430x932 in light/dark).
- [x] Add a reusable audit that checks html/body scroll widths and reports every visible element outside the viewport, while recognizing only explicit local scroll containers.
- [x] Expand isolated fixtures with realistic long names/emails/content and model empty/error/loading variants without external writes.
- [x] Reproduce and record failing screens/components before changing CSS.
- [x] Correct root layout, flex/grid intrinsic sizing, text wrapping, tabs, controls, cards, and dialogs with the smallest scoped CSS/component changes.
- [x] Validate each audited state and viewport; attach screenshots for 320, 360, 375, 390, 412, and 430 in light/dark on critical screens.
- [x] Run web unit tests/build, backend build, full Playwright suite, diff checks, and inspect generated screenshots.
- [x] Record final evidence and move this plan to `docs/exec-plans/completed/`.

## Validation and Evidence

- `npm test` in `web/`: 8 test files passed, 13 unit/component tests passed (100%).
- `npm run build` in `web/`: clean build, 0 errors.
- `npm run build` in `backend/`: clean build, 0 errors.
- `npm run test:e2e` in `web/`: 60 tests executed across 12 projects (6 viewports × 2 themes) with 49 passed and 11 skipped (PWA service worker offline fallback tests intentionally skipped in mock environment).
- Zero document horizontal overflow: `documentElement.scrollWidth <= innerWidth + 1` and `body.scrollWidth <= innerWidth + 1` across all audited screens and modals.
- Zero visible elements overflowing viewport boundaries.
- `git diff --check`: clean (0 errors).

## Decisions

- 2026-08-28: use production-preview Playwright with isolated API fixtures because layout measurements need a real browser and must not write external data.
- 2026-08-28: remove document-level overflow masking and scope scrollbar overrides only to specific local scrolling elements (`.tab-bar`, `.schedule-tabs-wrapper`, `.lyrics-box`, `.modal-form`, `.modal-body`, `.smart-chords-editor`).
- 2026-08-28: preserve approximately 44x44 touch targets and reflow/wrap surrounding layout instead of shrinking controls.
- 2026-08-28: set `.desktop-only` to `display: none !important` on `@media (max-width: 768px)` so tablet/mobile headers cleanly collapse secondary labels and retain primary icons.

## Status

Concluído com 100% de sucesso nos testes automatizados e builds.
